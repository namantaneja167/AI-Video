// Phase 2 controlled production-path run, in a TEMPORARY project, through the real job handlers and workers:
//   narration -> forced alignment -> mastered mix -> final render -> measurements.
// Reads the repository (code, approved reference); writes only to the temp project and to out/phase2/<name>/.
// Nothing in the real studio, the approved reference or the prototype is modified.
//
//   node scripts/phase2_final.ts [--import-takes <dir>] [--out <dir>]
//
// --import-takes uses saved WAVs (<dir>/take-<block>.wav) from an earlier real generation instead of generating again.
// They enter the project as ordinary takes whose metadata says where they came from. Everything after narration is real.
import {execFileSync} from 'node:child_process';
import {copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {addReference, statusReport} from '../core/artifacts.ts';
import {blobPath, putFile} from '../core/blobs.ts';
import {adoptEpisode} from '../core/episodes.ts';
import {makeHandlers} from '../core/handlers.ts';
import {sha256File} from '../core/hash.ts';
import {OwnerRegistry, systemMemory} from '../core/proc.ts';
import {Project} from '../core/project.ts';
import {JobRunner, type JobHandler} from '../core/runner.ts';
import {setComponent} from '../core/state.ts';
import {unsupportedInputs} from '../core/support.ts';
import {captureRenderSources, defaultTools, mixParamsValue, timelineLogicValue, versionsValue, voiceRuntimeValue} from '../core/toolchain.ts';
import {ModelHost} from '../core/worker.ts';
import {migrateV1ToV2} from '../src/migrate.ts';
import {EpisodeSchemaV2} from '../src/schema2.ts';
import {assertTemp} from '../tests/store/helpers.ts';

const root = resolve(import.meta.dirname, '..');
const arg = (name: string) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : undefined; };
const importDir = arg('--import-takes') ? resolve(arg('--import-takes')!) : undefined;
const OUT = resolve(arg('--out') ?? join(root, 'out', 'phase2', 'final'));
const TTS = {repo: 'mlx-community/Qwen3-TTS-12Hz-1.7B-Base-bf16', revision: 'a6eb4f68e4b056f1215157bb696209bc82a6db48'};
const ALIGN = {repo: 'mlx-community/Qwen3-ForcedAligner-0.6B-bf16', revision: '53c8c0e46733eec430e4b53dd6471d0e5dee45f8'};
const MASTER = {lufs: -16, true_peak_db: -1.5, lra: 11};
const log = (m: string) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`);

mkdirSync(OUT, {recursive: true});
const tmp = mkdtempSync(join(tmpdir(), 'studio-p2-final-'));
assertTemp(tmp);
log(`temporary project: ${tmp}`);

// ---- the episode: the existing preview "join-multiplication" as its own episode of two blocks ------------------------
const v1 = JSON.parse(readFileSync(join(root, 'episodes/join-fanout/episode.json'), 'utf8'));
const keep = new Set<string>(v1.previews['join-multiplication'].segments);
const filtered = {
  ...v1, id: 'join-multiplication-pip', title: 'Join multiplication (Pip voice, Phase 2 validation)',
  narration: {segments: v1.narration.segments.filter((s: any) => keep.has(s.id))},
  scenes: v1.scenes.map((s: any) => ({...s, segments: s.segments.filter((x: string) => keep.has(x))})).filter((s: any) => s.segments.length),
  events: v1.events.filter((e: any) => keep.has(e.segment)), chapters: v1.chapters.filter((c: any) => keep.has(c.segment)), previews: {},
};
const approved = JSON.parse(readFileSync(join(root, 'reference/pip-voice/approved-v1/approved.json'), 'utf8'));
const refWav = join(root, 'reference/pip-voice/approved-v1', approved.files.wav.file);
const refBefore = sha256File(refWav).hash;
const doc = EpisodeSchemaV2.parse({
  ...migrateV1ToV2(filtered), voice: {engine: 'qwen3-tts', profile: 'pip-voice-v1'},
  narration: {segments: filtered.narration.segments, blocks: [{id: 'b1', segments: ['s04', 's05'], gapAfterSec: 0.4}, {id: 'b2', segments: ['s06', 's07']}]},
});
mkdirSync(join(tmp, 'episodes', doc.id), {recursive: true});
writeFileSync(join(tmp, 'episodes', doc.id, 'episode.json'), JSON.stringify(doc, null, 2));

const p = Project.open(tmp, {create: true});
adoptEpisode(p, `episodes/${doc.id}/episode.json`);
addReference(p, 'pip-voice-v1', refWav, {script: approved.script, model: TTS.repo});

// ---- record every setting the way the product does -----------------------------------------------------------------
const tools = defaultTools(root);
captureRenderSources(p, root);
setComponent(p, 'voiceRuntime', voiceRuntimeValue(p, {profile: 'pip-voice-v1', repo: TTS.repo, revision: TTS.revision, mlxAudio: '0.5.9', mlx: '0.32.4', maxTokens: 600, audioWorker: tools.audioWorker}));
setComponent(p, 'aligner', {id: ALIGN.repo, revision: ALIGN.revision, grid: '80 ms'});
setComponent(p, 'manualTiming', {});
setComponent(p, 'soundEvents', []);
setComponent(p, 'soundAssets', {});
setComponent(p, 'mixParams', mixParamsValue(tools.mix));
setComponent(p, 'masteringParams', MASTER);
setComponent(p, 'timelineLogic', timelineLogicValue(root));
setComponent(p, 'versions', versionsValue(root, tools.renderWorker));
setComponent(p, 'renderSettings', {width: 1080, height: 1920, fps: 30, codec: 'h264', crf: 18, audio: 'aac'});

// ---- runner with the REAL workers ---------------------------------------------------------------------------------
const host = new ModelHost(new OwnerRegistry(p.db, p.now), {cmd: join(root, '.venv-qwen/bin/python'), args: [tools.audioWorker], cwd: root});
const handlers = makeHandlers({root, qwenPython: join(root, '.venv-qwen/bin/python'), python: join(root, '.venv/bin/python'), renderConcurrency: 2});
const importedTake: JobHandler = async (ctx) => {
  const src = join(importDir!, `take-${ctx.subject}.wav`);
  const {hash} = putFile(ctx.p, src);
  return {blobHash: hash, seed: 11, meta: {cacheHit: false, imported: {from: src, sha256: hash, note: 'saved from the earlier real generation of this block; not regenerated in this run'}}};
};
const runner = new JobRunner(p, {
  host, reg: host['reg'], memory: systemMemory, pollMs: 1000, criticalSamples: 5, releaseBefore: (k) => k.startsWith('render.'), preflight: unsupportedInputs,
  handlers: {...handlers, ...(importDir ? {'tts.block': importedTake} : {})},
});

const samples: {t: number; stage: string; pressure: number; swapMb: number | null; workerRssMb: number | null}[] = [];
let stage = 'start';
const t0 = Date.now();
const sampler = setInterval(() => {
  const m = systemMemory();
  const r = host.worker?.rssBytes() ?? null;
  samples.push({t: Date.now() - t0, stage, pressure: m.pressure, swapMb: m.swapUsedMb, workerRssMb: r === null ? null : Math.round(r / 2 ** 20)});
}, 2000);

const timings: Record<string, number> = {};
async function run(label: string, spec: Parameters<JobRunner['enqueue']>[0]) {
  stage = label;
  const s = Date.now();
  log(`${label}: queued`);
  const id = runner.enqueue(spec);
  const tick = setInterval(() => { const pr = runner.getProgress(id); log(`  ${label}: ${pr.state} | ${pr.step ?? ''}${pr.fraction !== null ? ` ${(pr.fraction * 100).toFixed(0)}%` : ''} | ${Math.round((pr.elapsedMs ?? 0) / 1000)} s`); }, 10_000);
  const row = await runner.waitFor(id);
  clearInterval(tick);
  timings[label] = Math.round((Date.now() - s) / 100) / 10;
  log(`${label}: ${row.state}${row.error ? ` (${row.error})` : ''} in ${timings[label]} s`);
  if (row.state !== 'succeeded') throw new Error(`${label} ended ${row.state}: ${row.error}`);
  return row;
}

const ep = doc.id;
const cur = (kind: string, subject: string) => p.db.prepare('SELECT a.id, a.blob_hash h, a.meta_json m FROM current c JOIN artifacts a ON a.id=c.artifact_id WHERE c.episode_id=? AND c.kind=? AND c.subject=?').get(ep, kind, subject) as any;
let report: any = {};
let failure: unknown;
try {
  const take = [await run('narration b1', {episodeId: ep, jobKind: 'tts.block', subject: 'b1'}), await run('narration b2', {episodeId: ep, jobKind: 'tts.block', subject: 'b2'})];
  const jt = await run('timing (aligner)', {episodeId: ep, jobKind: 'timing.build'});
  const jm = await run('mix final (mastering)', {episodeId: ep, jobKind: 'mix.final'});
  const jr = await run('render final', {episodeId: ep, jobKind: 'render.final'});

  const mp4 = join(OUT, 'PIPELINE-VALIDATION-SAMPLE_join-multiplication_final.mp4');
  const wav = join(OUT, 'mastered-mix.wav');
  const tlf = join(OUT, 'timeline.json');
  for (const f of [mp4, wav, tlf]) if (existsSync(f)) rmSync(f, {force: true});
  copyFileSync(blobPath(p, cur('render', 'final').h), mp4);
  copyFileSync(blobPath(p, cur('mix', 'final').h), wav);
  copyFileSync(blobPath(p, cur('timing', 'timeline').h), tlf);
  const measuredFile = join(OUT, 'measurements.json');
  const stdout = execFileSync(join(root, '.venv-qwen/bin/python'), [join(root, 'scripts/phase2_measure.py'), mp4, wav, tlf, measuredFile, String(MASTER.lufs), String(MASTER.true_peak_db)], {encoding: 'utf8'});
  log(`measurements:\n${stdout}`);
  const meas = JSON.parse(readFileSync(measuredFile, 'utf8'));
  const meta = (kind: string, subject: string) => JSON.parse(cur(kind, subject).m);
  report = {
    when: new Date().toISOString(), tempProject: tmp, scene: 'join-fanout preview join-multiplication (segments s04-s07, tables-lab)', narration: importDir ? `imported from ${importDir}` : 'generated in this run',
    stageSeconds: timings, jobs: {take: take.map((t) => t.id), timing: jt.id, mix: jm.id, render: jr.id},
    takeMeta: [meta('take', 'b1'), meta('take', 'b2')], timingMeta: meta('timing', 'timeline'), mixMeta: meta('mix', 'final'), renderMeta: meta('render', 'final'),
    handovers: p.db.prepare("SELECT job_id, data_json FROM job_events WHERE kind='handover' AND job_id<>0 ORDER BY id").all().map((r: any) => ({jobId: r.job_id, ...JSON.parse(r.data_json)})),
    attempts: p.db.prepare('SELECT job_id, n, state, started_at, finished_at, peak_rss_bytes, pressure_max FROM job_attempts ORDER BY id').all(),
    measurements: meas, status: statusReport(p, ep), referenceUnchanged: sha256File(refWav).hash === refBefore,
    outputs: {mp4, mastered_wav: wav, timeline: tlf, mp4_sha256: sha256File(mp4).hash},
    memory: {samples, peakWorkerRssMb: Math.max(0, ...samples.map((s) => s.workerRssMb ?? 0)), maxPressure: Math.max(0, ...samples.map((s) => s.pressure)), maxSwapMb: Math.max(0, ...samples.map((s) => s.swapMb ?? 0))},
  };
  writeFileSync(join(OUT, 'validation-report.json'), JSON.stringify(report, null, 2));
  log(`done. final video: ${mp4}`);
} catch (e) {
  failure = e;
  console.error(e);
} finally {
  clearInterval(sampler);
  await runner.shutdown();
  p.close();
  if (existsSync(tmp)) { assertTemp(tmp); rmSync(tmp, {recursive: true, force: true}); }
}
if (failure) process.exit(1);
