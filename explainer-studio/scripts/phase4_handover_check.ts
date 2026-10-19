// One bounded real-model hand-over check, through the real runner, handlers and workers, in a TEMPORARY project:
//   narration (Qwen3-TTS, approved voice) -> timing (forced aligner) -> mix -> render (Remotion), one job at a time.
// It records which worker generation did what, every signal the app sent (with the process identity), the model-unload
// hand-overs (what the worker reported and its resident size before and after), and memory samples. It uses the smallest
// existing sample (one segment) and never touches the demo workspace, the approved reference or any approved sample.
//
//   node scripts/phase4_handover_check.ts --episode samples/dense-pip-fixture/episode.json --out out/phase4/handover-check
import {execFileSync} from 'node:child_process';
import {existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {addReference, statusReport} from '../core/artifacts.ts';
import {blobPath} from '../core/blobs.ts';
import {adoptEpisode} from '../core/episodes.ts';
import {makeHandlers} from '../core/handlers.ts';
import {sha256File} from '../core/hash.ts';
import {OwnerRegistry, systemMemory} from '../core/proc.ts';
import {Project} from '../core/project.ts';
import {JobRunner} from '../core/runner.ts';
import {setComponent} from '../core/state.ts';
import {unsupportedInputs} from '../core/support.ts';
import {captureRenderSources, defaultTools, mixParamsValue, timelineLogicValue, versionsValue, voiceRuntimeValue} from '../core/toolchain.ts';
import {ModelHost} from '../core/worker.ts';
import {EpisodeSchemaV2} from '../src/schema2.ts';
import {assertTemp} from '../tests/store/helpers.ts';

const root = resolve(import.meta.dirname, '..');
const arg = (name: string) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : undefined; };
const episodePath = resolve(arg('--episode') ?? (() => { throw new Error('--episode is required'); })());
const OUT = resolve(arg('--out') ?? (() => { throw new Error('--out is required'); })());
const TTS = {repo: 'mlx-community/Qwen3-TTS-12Hz-1.7B-Base-bf16', revision: 'a6eb4f68e4b056f1215157bb696209bc82a6db48'};
const ALIGN = {repo: 'mlx-community/Qwen3-ForcedAligner-0.6B-bf16', revision: '53c8c0e46733eec430e4b53dd6471d0e5dee45f8'};
const MASTER = {lufs: -16, true_peak_db: -1.5, lra: 11};
const log = (m: string) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`);

mkdirSync(OUT, {recursive: true});
const tmp = mkdtempSync(join(tmpdir(), 'studio-p4-handover-'));
assertTemp(tmp);
log(`temporary project: ${tmp}`);

const doc = EpisodeSchemaV2.parse(JSON.parse(readFileSync(episodePath, 'utf8')));
const approved = JSON.parse(readFileSync(join(root, 'reference/pip-voice/approved-v1/approved.json'), 'utf8'));
const refWav = join(root, 'reference/pip-voice/approved-v1', approved.files.wav.file);
const refBefore = sha256File(refWav).hash;
mkdirSync(join(tmp, 'episodes', doc.id), {recursive: true});
writeFileSync(join(tmp, 'episodes', doc.id, 'episode.json'), JSON.stringify(doc, null, 2));

const p = Project.open(tmp, {create: true});
adoptEpisode(p, `episodes/${doc.id}/episode.json`);
addReference(p, 'pip-voice-v1', refWav, {script: approved.script, model: TTS.repo});

const tools = defaultTools(root);
captureRenderSources(p, root);
setComponent(p, 'voiceRuntime', voiceRuntimeValue(p, {profile: 'pip-voice-v1', repo: TTS.repo, revision: TTS.revision, mlxAudio: '0.5.9', mlx: '0.32.4', maxTokens: 600, audioWorker: tools.audioWorker}));
setComponent(p, 'aligner', {id: ALIGN.repo, revision: ALIGN.revision, grid: '80 ms'});
setComponent(p, 'manualTiming', {});
setComponent(p, 'soundEvents', []);
setComponent(p, 'soundAssets', {});
setComponent(p, 'mixParams', mixParamsValue(tools.mix, {}));
setComponent(p, 'masteringParams', MASTER);
setComponent(p, 'timelineLogic', timelineLogicValue(root));
setComponent(p, 'versions', versionsValue(root, tools.renderWorker));
setComponent(p, 'renderSettings', {width: 1080, height: 1920, fps: 30, codec: 'h264', crf: 18, audio: 'aac'});

const reg = new OwnerRegistry(p.db, p.now);
const host = new ModelHost(reg, {cmd: join(root, '.venv-qwen/bin/python'), args: [tools.audioWorker], cwd: root});
const handlers = makeHandlers({root, qwenPython: join(root, '.venv-qwen/bin/python'), python: join(root, '.venv/bin/python'), renderConcurrency: 2});
const runner = new JobRunner(p, {host, reg, memory: systemMemory, pollMs: 1000, criticalSamples: 5, releaseBefore: (k) => k.startsWith('render.'), preflight: unsupportedInputs, handlers});

type Sample = {t: number; stage: string; pressure: number; swapMb: number | null; workerOwner: string | null; workerRssMb: number | null; loaded: string | null};
const samples: Sample[] = [];
let stage = 'start';
const t0 = Date.now();
const sampler = setInterval(() => {
  const m = systemMemory();
  const w = host.worker;
  const r = w && !w.exited ? w.rssBytes() : null;
  samples.push({t: Date.now() - t0, stage, pressure: m.pressure, swapMb: m.swapUsedMb, workerOwner: w && !w.exited ? w.owner : null, workerRssMb: r === null ? null : Math.round(r / 2 ** 20), loaded: host.loaded});
}, 1000);

const stages: {label: string; jobId: number; startedAt: number; finishedAt: number; state: string}[] = [];
async function run(label: string, spec: Parameters<JobRunner['enqueue']>[0]) {
  stage = label;
  const s = Date.now();
  log(`${label}: queued`);
  const id = runner.enqueue(spec);
  const tick = setInterval(() => { const pr = runner.getProgress(id); log(`  ${label}: ${pr.state} | ${pr.step ?? ''} | ${Math.round((pr.elapsedMs ?? 0) / 1000)} s`); }, 10_000);
  const row = await runner.waitFor(id);
  clearInterval(tick);
  stages.push({label, jobId: id, startedAt: s - t0, finishedAt: Date.now() - t0, state: row.state});
  log(`${label}: ${row.state}${row.error ? ` (${row.error})` : ''} in ${((Date.now() - s) / 1000).toFixed(1)} s`);
  if (row.state !== 'succeeded') throw new Error(`${label} ended ${row.state}: ${row.error}`);
  return row;
}

const ep = doc.id;
let failure: unknown;
let report: any = {};
try {
  const block = doc.narration.blocks[0].id;
  await run(`narration ${block}`, {episodeId: ep, jobKind: 'tts.block', subject: block});
  await run('timing (aligner)', {episodeId: ep, jobKind: 'timing.build'});
  await run('mix final', {episodeId: ep, jobKind: 'mix.final'});
  await run('render final', {episodeId: ep, jobKind: 'render.final'});
  stage = 'idle shutdown';
  const liveBefore = host.worker && !host.worker.exited ? {owner: host.worker.owner, pid: host.worker.pid} : null;
  const signalsBeforeShutdown = reg.signals.length;
  await host.shutdown();
  const gracefulShutdown = {workerBefore: liveBefore, signalsSentByShutdown: reg.signals.slice(signalsBeforeShutdown), workerAfter: host.worker ? host.worker.owner : null};

  const events = p.db.prepare("SELECT id, job_id, at, kind, data_json FROM job_events WHERE kind IN ('handover','running','finished','progress','auto-retry','failed') ORDER BY id").all() as any[];
  const handovers = events.filter((e) => e.kind === 'handover').map((e) => ({eventId: e.id, jobId: e.job_id, ...JSON.parse(e.data_json)}));
  const generations = (p.db.prepare("SELECT owner, pid, start, role, recorded_at, gone_at FROM job_procs WHERE owner LIKE 'host:audio#%' ORDER BY recorded_at").all() as any[])
    .map((r) => ({owner: r.owner, pid: r.pid, start: r.start, role: r.role, recordedAt: r.recorded_at, goneAt: r.gone_at}));
  const attempts = p.db.prepare('SELECT job_id, n, state, started_at, finished_at, error, peak_rss_bytes, pressure_max FROM job_attempts ORDER BY id').all();
  const jobStart = (label: string) => Number((events.find((e) => e.kind === 'running' && e.job_id === stages.find((s) => s.label === label)!.jobId))?.at ?? 0);
  const renderHandover = handovers.find((h) => h.reason === 'before render.final');
  const alignHandover = handovers.find((h) => /switching from tts to aligner/.test(h.reason));
  const MB = 2 ** 20;

  const checks: {check: string; ok: boolean; detail: string}[] = [];
  const add = (check: string, ok: boolean, detail: string) => checks.push({check, ok, detail});
  add('every stage succeeded, one at a time', stages.every((s) => s.state === 'succeeded') && stages.every((s, i) => i === 0 || s.startedAt >= stages[i - 1].finishedAt - 50), stages.map((s) => `${s.label} ${((s.finishedAt - s.startedAt) / 1000).toFixed(1)} s`).join('; '));
  add('no automatic retry and no failed attempt', attempts.every((a: any) => a.state === 'succeeded'), JSON.stringify(attempts.map((a: any) => [a.job_id, a.n, a.state])));
  add('tts -> aligner: the first model was released or its worker stopped and confirmed gone', !!alignHandover && (alignHandover.outcome === 'released' || alignHandover.outcome === 'killed'), alignHandover ? `${alignHandover.outcome}; before ${Math.round((alignHandover.rssBeforeBytes ?? 0) / MB)} MiB (worker reported ${Math.round((alignHandover.mlxBeforeBytes ?? 0) / MB)} MiB held), after ${Math.round((alignHandover.rssAfterBytes ?? 0) / MB)} MiB; ack ${JSON.stringify(alignHandover.ack)}` : 'no hand-over recorded');
  add('before render: memory release confirmed (never "kill-unconfirmed")', !!renderHandover && (renderHandover.outcome === 'released' || renderHandover.outcome === 'killed'), renderHandover ? `${renderHandover.outcome}; before ${Math.round((renderHandover.rssBeforeBytes ?? 0) / MB)} MiB (reported held ${Math.round((renderHandover.mlxBeforeBytes ?? 0) / MB)} MiB), after ${Math.round((renderHandover.rssAfterBytes ?? 0) / MB)} MiB (threshold ${Math.round(renderHandover.thresholdBytes / MB)} MiB); ack ${JSON.stringify(renderHandover.ack)}` : 'no hand-over recorded');
  add('the render started only after the hand-over', !!renderHandover && renderHandover.at <= jobStart('render final'), `hand-over at ${renderHandover?.at}, render running at ${jobStart('render final')}`);
  const during = samples.filter((s) => s.stage === 'render final');
  add('during the render no audio model was loaded and the worker (if any) held little', during.every((s) => s.loaded === null && (s.workerRssMb ?? 0) < renderHandover?.thresholdBytes / MB), `render samples: ${during.length}; loaded ${[...new Set(during.map((s) => s.loaded))].join(',')}; max worker MiB ${Math.max(0, ...during.map((s) => s.workerRssMb ?? 0))}`);
  const owners = [...new Set(generations.map((g) => g.owner))];
  add('worker generations are numbered and distinct', owners.length >= 1 && owners.every((o) => /^host:audio#\d+$/.test(o)), owners.join(', '));
  const byGen = Object.fromEntries(owners.map((o) => [o, reg.signals.filter((s) => s.owner === o).map((s) => `${s.signal} pid ${s.pid} (${s.reason})`)]));
  add('every signal names a worker generation and a process identity', reg.signals.every((s) => /^host:audio#\d+$/.test(s.owner) || s.owner.startsWith('attempt:')) && reg.signals.every((s) => s.pid > 0 && !!s.start), `${reg.signals.length} signals: ${JSON.stringify(byGen)}`);
  add('the idle shutdown stopped the worker without any signal', gracefulShutdown.signalsSentByShutdown.length === 0 && gracefulShutdown.workerAfter === null, JSON.stringify({before: gracefulShutdown.workerBefore, signals: gracefulShutdown.signalsSentByShutdown.length}));
  add('the approved voice reference is unchanged', sha256File(refWav).hash === refBefore, refBefore.slice(0, 16));
  let streak = 0; let longest = 0;
  for (const x of samples) { streak = x.pressure >= 4 ? streak + 1 : 0; longest = Math.max(longest, streak); }
  add('critical memory pressure never lasted as long as the runner\'s stop rule (5 consecutive samples)', longest < 5, `${samples.filter((x) => x.pressure >= 4).length} of ${samples.length} samples at level 4, longest run ${longest}; max swap ${Math.max(0, ...samples.map((x) => x.swapMb ?? 0))} MB; peak worker ${Math.max(0, ...samples.map((x) => x.workerRssMb ?? 0))} MiB`);

  const cur = (kind: string, subject: string) => p.db.prepare('SELECT a.blob_hash h, a.meta_json m FROM current c JOIN artifacts a ON a.id=c.artifact_id WHERE c.episode_id=? AND c.kind=? AND c.subject=?').get(ep, kind, subject) as any;
  const mp4 = join(OUT, `${doc.id}_check.mp4`);
  if (existsSync(mp4)) rmSync(mp4, {force: true});
  writeFileSync(mp4, readFileSync(blobPath(p, cur('render', 'final').h)));
  const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_name,width,height,duration', '-of', 'json', mp4], {encoding: 'utf8'}));
  report = {
    when: new Date().toISOString(), tempProject: tmp, episode: {id: doc.id, file: episodePath, text: doc.narration.segments.map((s) => s.text)},
    stages, checks, allChecksPass: checks.every((c) => c.ok), handovers, workerGenerations: generations, signals: reg.signals, gracefulShutdown, attempts,
    takeMeta: JSON.parse(cur('take', doc.narration.blocks[0].id).m), timingMeta: JSON.parse(cur('timing', 'timeline').m), renderMeta: JSON.parse(cur('render', 'final').m),
    status: statusReport(p, ep), output: {mp4, sha256: sha256File(mp4).hash, probe},
    memory: {samples, peakWorkerRssMb: Math.max(0, ...samples.map((s) => s.workerRssMb ?? 0)), maxPressure: Math.max(0, ...samples.map((s) => s.pressure)), maxSwapMb: Math.max(0, ...samples.map((s) => s.swapMb ?? 0))},
  };
  writeFileSync(join(OUT, 'handover-report.json'), JSON.stringify(report, null, 2));
  for (const c of checks) log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.check}: ${c.detail}`);
  log(`done: ${checks.filter((c) => c.ok).length}/${checks.length} checks pass; report ${join(OUT, 'handover-report.json')}`);
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
