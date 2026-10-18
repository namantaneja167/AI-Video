// Phase 2 controlled integration: REAL Qwen narration with the approved Pip voice -> REAL forced alignment -> mix ->
// REAL Remotion render, through the job runner, in a TEMPORARY project. Reads the repository (code, approved reference);
// writes only to the temp project and to out/phase2/integration/. Nothing in the real studio, the approved reference or
// the prototype is modified.
//
//   node scripts/phase2_integration.ts
//
// Scene: the existing `join-fanout` preview "join-multiplication" (segments s04-s07, the tables-lab scene), narrated by
// the approved Pip voice instead of Kokoro, as one episode of two blocks, rendered by the generic composition.
import {execFileSync} from 'node:child_process';
import {copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {addReference, statusReport} from '../core/artifacts.ts';
import {blobPath} from '../core/blobs.ts';
import {adoptEpisode} from '../core/episodes.ts';
import {makeHandlers} from '../core/handlers.ts';
import {sha256File} from '../core/hash.ts';
import {Project} from '../core/project.ts';
import {systemMemory} from '../core/proc.ts';
import {JobRunner} from '../core/runner.ts';
import {captureFileSet, setComponent} from '../core/state.ts';
import {ModelHost} from '../core/worker.ts';
import {EpisodeSchemaV2} from '../src/schema2.ts';
import {migrateV1ToV2} from '../src/migrate.ts';
import {assertTemp} from '../tests/store/helpers.ts';

const root = resolve(import.meta.dirname, '..');
const OUT = join(root, 'out', 'phase2', 'integration');
const TTS = {repo: 'mlx-community/Qwen3-TTS-12Hz-1.7B-Base-bf16', revision: 'a6eb4f68e4b056f1215157bb696209bc82a6db48'};
const ALIGN = {repo: 'mlx-community/Qwen3-ForcedAligner-0.6B-bf16', revision: '53c8c0e46733eec430e4b53dd6471d0e5dee45f8'};
const log = (m: string) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`);

mkdirSync(OUT, {recursive: true});
const tmp = mkdtempSync(join(tmpdir(), 'studio-p2-integration-'));
assertTemp(tmp);
log(`temporary project: ${tmp}`);

// ---- the episode: preview "join-multiplication" as its own episode with two blocks ------------------------------------
const v1 = JSON.parse(readFileSync(join(root, 'episodes/join-fanout/episode.json'), 'utf8'));
const keep = new Set<string>(v1.previews['join-multiplication'].segments);
const filtered = {
  ...v1, id: 'join-multiplication-pip', title: 'Join multiplication (Pip voice, Phase 2 integration)',
  narration: {segments: v1.narration.segments.filter((s: any) => keep.has(s.id))},
  scenes: v1.scenes.map((s: any) => ({...s, segments: s.segments.filter((x: string) => keep.has(x))})).filter((s: any) => s.segments.length),
  events: v1.events.filter((e: any) => keep.has(e.segment)), chapters: v1.chapters.filter((c: any) => keep.has(c.segment)), previews: {},
};
const approved = JSON.parse(readFileSync(join(root, 'reference/pip-voice/approved-v1/approved.json'), 'utf8'));
const refWav = join(root, 'reference/pip-voice/approved-v1', approved.files.wav.file);
const refBefore = sha256File(refWav).hash;
const doc = EpisodeSchemaV2.parse({
  ...migrateV1ToV2(filtered),
  voice: {engine: 'qwen3-tts', profile: 'pip-voice-v1'},
  narration: {segments: filtered.narration.segments, blocks: [{id: 'b1', segments: ['s04', 's05'], gapAfterSec: 0.4}, {id: 'b2', segments: ['s06', 's07']}]},
});
mkdirSync(join(tmp, 'episodes', doc.id), {recursive: true});
writeFileSync(join(tmp, 'episodes', doc.id, 'episode.json'), JSON.stringify(doc, null, 2));

const p = Project.open(tmp, {create: true});
adoptEpisode(p, `episodes/${doc.id}/episode.json`);
addReference(p, 'pip-voice-v1', refWav, {script: approved.script, model: TTS.repo, sampling: approved.sampling});

// ---- recorded components ---------------------------------------------------------------------------------------
const walk = (dir: string): string[] => readdirSync(join(root, dir), {withFileTypes: true}).flatMap((e) => (e.isDirectory() ? (e.name === 'art' || e.name === 'generated' ? [] : walk(join(dir, e.name))) : [join(dir, e.name)]));
captureFileSet(p, 'code', root, [...walk('src'), 'package.json']);
captureFileSet(p, 'theme', root, ['src/theme.ts']);
captureFileSet(p, 'assets', root, ['public/assets/manifest.json']);
setComponent(p, 'fonts', {note: 'system font stack from src/theme.ts; this composition loads no font files'});
const logicFiles = ['pipeline/timeline.py', 'pipeline/timeline_cli.py', 'core/timeline.ts'];
setComponent(p, 'timelineLogic', Object.fromEntries(logicFiles.map((f) => [f, sha256File(join(root, f)).hash])));
setComponent(p, 'voiceRuntime', {engine: 'qwen3-tts', model: TTS.repo, revision: TTS.revision, mlxAudio: '0.5.9', mlx: '0.32.4', referenceSha256: refBefore, sampling: approved.sampling, seedDefault: 11});
setComponent(p, 'aligner', {id: ALIGN.repo, revision: ALIGN.revision, grid: '80 ms'});
setComponent(p, 'manualTiming', {});
setComponent(p, 'soundEvents', []);
setComponent(p, 'soundAssets', {});
setComponent(p, 'mixParams', {narrationOnly: true});
setComponent(p, 'masteringParams', {lufs: -16, true_peak_db: -1.5, lra: 11});
setComponent(p, 'versions', {remotion: '4.0.536', node: process.version, ffmpeg: execFileSync('ffmpeg', ['-version'], {encoding: 'utf8'}).split('\n')[0]});
setComponent(p, 'renderSettings', {width: 1080, height: 1920, fps: 30, codec: 'h264', crf: 18, audio: 'aac'});

// ---- runner with the REAL workers ---------------------------------------------------------------------------------
const host = new ModelHost(new (await import('../core/proc.ts')).OwnerRegistry(p.db, p.now), {cmd: join(root, '.venv-qwen/bin/python'), args: [join(root, 'workers/audio_worker.py')], cwd: root});
const runner = new JobRunner(p, {
  host, reg: host['reg'], memory: systemMemory, pollMs: 1000, criticalSamples: 5, releaseBefore: (k) => k.startsWith('render.'),
  handlers: makeHandlers({root, qwenPython: join(root, '.venv-qwen/bin/python'), python: join(root, '.venv/bin/python'), renderConcurrency: 2}),
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
let report: any = {};
try {
  const j1 = await run('tts b1', {episodeId: ep, jobKind: 'tts.block', subject: 'b1'});
  const j2 = await run('tts b2', {episodeId: ep, jobKind: 'tts.block', subject: 'b2'});
  const jt = await run('timing', {episodeId: ep, jobKind: 'timing.build'});
  const jm = await run('mix draft', {episodeId: ep, jobKind: 'mix.draft'});
  const jr = await run('render draft', {episodeId: ep, jobKind: 'render.draft'});
  stage = 'cache-check';
  const c1 = await run('tts b1 again (cache)', {episodeId: ep, jobKind: 'tts.block', subject: 'b1'});
  const c2 = await run('tts b2 again (cache)', {episodeId: ep, jobKind: 'tts.block', subject: 'b2'});

  const cur = (kind: string, subject: string) => p.db.prepare('SELECT a.id, a.blob_hash h, a.meta_json m FROM current c JOIN artifacts a ON a.id=c.artifact_id WHERE c.episode_id=? AND c.kind=? AND c.subject=?').get(ep, kind, subject) as any;
  const mp4 = join(OUT, 'pip-join-multiplication-draft.mp4');
  copyFileSync(blobPath(p, cur('render', 'draft').h), mp4);
  copyFileSync(blobPath(p, cur('timing', 'timeline').h), join(OUT, 'timeline.json'));
  copyFileSync(blobPath(p, cur('mix', 'draft').h), join(OUT, 'mix-draft.wav'));
  for (const b of ['b1', 'b2']) copyFileSync(blobPath(p, cur('take', b).h), join(OUT, `take-${b}.wav`));
  const attempts = p.db.prepare('SELECT job_id, n, state, started_at, finished_at, peak_rss_bytes, pressure_max FROM job_attempts ORDER BY id').all();
  const handovers = p.db.prepare("SELECT job_id, data_json FROM job_events WHERE kind='handover' ORDER BY id").all().map((r: any) => ({jobId: r.job_id, ...JSON.parse(r.data_json)}));
  const progressSample = (jobId: number) => p.db.prepare("SELECT data_json FROM job_events WHERE job_id=? AND kind='progress' ORDER BY id").all(jobId).map((r: any) => JSON.parse(r.data_json)).map((d: any) => ({step: d.step, fraction: d.fraction}));
  const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', mp4], {encoding: 'utf8'}));
  const tl = JSON.parse(readFileSync(join(OUT, 'timeline.json'), 'utf8'));
  report = {
    when: new Date().toISOString(), tempProject: tmp, scene: 'join-fanout preview join-multiplication (segments s04-s07, tables-lab)', blocks: doc.narration.blocks,
    jobs: {tts_b1: j1.id, tts_b2: j2.id, timing: jt.id, mix: jm.id, render: jr.id}, stageSeconds: timings,
    takeMeta: [JSON.parse(cur('take', 'b1').m), JSON.parse(cur('take', 'b2').m)], timingMeta: JSON.parse(cur('timing', 'timeline').m), mixMeta: JSON.parse(cur('mix', 'draft').m), renderMeta: JSON.parse(cur('render', 'draft').m),
    cacheCheck: {b1: JSON.parse(p.db.prepare('SELECT a.meta_json m FROM jobs j JOIN artifacts a ON a.id=j.artifact_id WHERE j.id=?').get(c1.id)!.m as string).cacheHit, b2: JSON.parse(p.db.prepare('SELECT a.meta_json m FROM jobs j JOIN artifacts a ON a.id=j.artifact_id WHERE j.id=?').get(c2.id)!.m as string).cacheHit},
    attempts, handovers, renderProgress: progressSample(jr.id).filter((_, i, a) => i % Math.max(1, Math.floor(a.length / 12)) === 0), ttsProgressSteps: [...new Set(progressSample(j1.id).map((x) => x.step))],
    timelineSource: tl.source, timingSources: tl.timingSources, timelineDurationSec: tl.durationSec,
    video: {bytes: statSync(mp4).size, format: probe.format.format_name, duration: Number(probe.format.duration), streams: probe.streams.map((s: any) => ({type: s.codec_type, codec: s.codec_name, w: s.width, h: s.height, fps: s.r_frame_rate, rate: s.sample_rate, dur: s.duration}))},
    status: statusReport(p, ep),
    referenceUnchanged: sha256File(refWav).hash === refBefore,
    memorySamples: samples, peakWorkerRssMb: Math.max(0, ...samples.map((s) => s.workerRssMb ?? 0)), maxPressure: Math.max(0, ...samples.map((s) => s.pressure)), maxSwapMb: Math.max(0, ...samples.map((s) => s.swapMb ?? 0)),
  };
  writeFileSync(join(OUT, 'integration-report.json'), JSON.stringify(report, null, 2));
  log(`done. video: ${mp4}`);
} finally {
  clearInterval(sampler);
  await runner.shutdown();
  p.close();
  if (existsSync(tmp)) { assertTemp(tmp); rmSync(tmp, {recursive: true, force: true}); }
}
console.log(JSON.stringify({stageSeconds: report.stageSeconds, peakWorkerRssMb: report.peakWorkerRssMb, maxPressure: report.maxPressure, video: report.video, handovers: report.handovers, cacheCheck: report.cacheCheck}, null, 1));
