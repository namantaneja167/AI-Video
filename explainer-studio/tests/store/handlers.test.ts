// The real handlers against FAKE workers: real SQLite project, real timeline wrapper and real mix script, a fake audio worker
// and a fake render worker (no models, no browser). Proves scheduling, caching, labels, progress, cancellation and isolation.
import assert from 'node:assert/strict';
import {existsSync, readdirSync, readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {afterEach, describe, test} from 'node:test';
import {adoptEpisode, getEpisode, saveEpisode} from '../../core/episodes.ts';
import {addReference, statusReport} from '../../core/artifacts.ts';
import {blobPath} from '../../core/blobs.ts';
import {makeHandlers} from '../../core/handlers.ts';
import {descendantsOf, OwnerRegistry, snapshotProcs} from '../../core/proc.ts';
import {JobRunner} from '../../core/runner.ts';
import {setComponent} from '../../core/state.ts';
import {wavDuration} from '../../core/timeline.ts';
import {ModelHost} from '../../core/worker.ts';
import {newProject, setAllComponents, type Clock, type TestProject} from './helpers.ts';

const realClock = (): Clock => ({t: 0, now: () => Date.now(), advance: () => {}});
const py = process.env.PYTHON ?? 'python3';
const EP = 'join-fanout';
let t: TestProject | undefined;
const runners: JobRunner[] = [];
afterEach(async () => {
  for (const r of runners.splice(0)) { r.stop(); await r.host?.shutdown().catch(() => {}); }
  t?.close();
  t = undefined;
  for (const k of ['FAKE_RENDER_CHILDREN', 'FAKE_RENDER_STEP_MS', 'FAKE_RENDER_FRAMES', 'FAKE_RENDER_FAIL']) delete process.env[k];
});
const until = async (cond: () => boolean, ms = 8000, what = 'condition') => {
  const t0 = Date.now();
  while (!cond()) { if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${what}`); await new Promise((r) => setTimeout(r, 25)); }
};
let inspectable = true;
try { snapshotProcs(); } catch { inspectable = false; }
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };

function setup(aligner: 'estimated' | 'aligned' = 'estimated') {
  t = newProject({clock: realClock()});
  adoptEpisode(t.p, `episodes/${EP}/episode.json`);
  setAllComponents(t.p, t.root);
  const ref = join(t.root, 'ref.wav');
  writeFileSync(ref, readFileSync('tests/fixtures/silence-ref.wav', {flag: 'r'}));
  addReference(t.p, 'pip-voice-v1', ref, {script: 'Ten times faster.'});
  const doc = getEpisode(t.p, EP);
  saveEpisode(t.p, EP, {...doc, voice: {engine: 'qwen3-tts', profile: 'pip-voice-v1'}});
  setComponent(t.p, 'voiceRuntime', {engine: 'qwen3-tts', model: 'fake', referenceSha: 'x'});
  setComponent(t.p, 'masteringParams', {lufs: -16, true_peak_db: -1.5, lra: 11});
  setComponent(t.p, 'aligner', aligner === 'aligned' ? {id: 'qwen3-forced-aligner', revision: 'fake'} : {id: 'estimated'});
  const host = new ModelHost(new OwnerRegistry(t.p.db, t.p.now), {cmd: py, args: [join(process.cwd(), 'tests/store/fake-worker.py')], rssThresholdBytes: 800 * 2 ** 20, killGraceMs: 600});
  const r = new JobRunner(t.p, {
    pollMs: 80, killGraceMs: 600, host, reg: host['reg'], releaseBefore: (k) => k.startsWith('render.'),
    handlers: makeHandlers({root: process.cwd(), qwenPython: '.venv-qwen/bin/python', python: '.venv/bin/python', renderWorker: join(process.cwd(), 'tests/store/fake-render-worker.ts')}),
  });
  runners.push(r);
  return {r, t: t!, host};
}
const blocksOf = (tp: TestProject) => getEpisode(tp.p, EP).narration.blocks.map((b) => b.id);
const events = (tp: TestProject, jobId: number, kind: string) => tp.p.db.prepare('SELECT data_json FROM job_events WHERE job_id=? AND kind=? ORDER BY id').all(jobId, kind).map((r: any) => JSON.parse(r.data_json));
async function ttsAll(r: JobRunner, tp: TestProject) {
  const ids = blocksOf(tp).map((b) => r.enqueue({episodeId: EP, jobKind: 'tts.block', subject: b}));
  return {ids, rows: await Promise.all(ids.map((i) => r.waitFor(i)))};
}
const meta = (tp: TestProject, jobId: number) => JSON.parse((tp.p.db.prepare('SELECT a.meta_json m FROM jobs j JOIN artifacts a ON a.id=j.artifact_id WHERE j.id=?').get(jobId) as any).m);

describe('narration → timing → mix → render with fake workers', () => {
  test('every stage runs, everything ends fresh, and the audio, the timeline and the render agree', {skip: !inspectable && 'process inspection unavailable (the hand-over before a render cannot be confirmed without it)'}, async () => {
    const {r, t: tp} = setup();
    const {rows} = await ttsAll(r, tp);
    assert.ok(rows.length >= 2, 'a multi-block episode');
    assert.ok(rows.every((x) => x.state === 'succeeded'), rows.map((x) => x.error).join('|'));
    const timing = await r.waitFor(r.enqueue({episodeId: EP, jobKind: 'timing.build'}));
    assert.equal(timing.state, 'succeeded', timing.error ?? '');
    const mix = await r.waitFor(r.enqueue({episodeId: EP, jobKind: 'mix.draft'}));
    assert.equal(mix.state, 'succeeded', mix.error ?? '');
    const render = await r.waitFor(r.enqueue({episodeId: EP, jobKind: 'render.draft'}));
    assert.equal(render.state, 'succeeded', render.error ?? '');
    const st = statusReport(tp.p, EP);
    assert.deepEqual([st.timing.status, st.mix.draft.status, st.render.draft.status, ...Object.values(st.takes).map((x) => x.status)].filter((s) => s !== 'fresh'), []);
    // the mix and the timeline describe the same length
    const tl = JSON.parse(readFileSync(blobPath(tp.p, (tp.p.db.prepare("SELECT a.blob_hash h FROM current c JOIN artifacts a ON a.id=c.artifact_id WHERE c.episode_id=? AND c.kind='timing'").get(EP) as any).h), 'utf8'));
    const mixBlob = (tp.p.db.prepare("SELECT a.blob_hash h FROM current c JOIN artifacts a ON a.id=c.artifact_id WHERE c.episode_id=? AND c.kind='mix' AND c.subject='draft'").get(EP) as any).h;
    assert.ok(Math.abs(wavDuration(blobPath(tp.p, mixBlob)).seconds - tl.durationSec) < 0.001, 'mix length equals the timeline duration');
    assert.equal(wavDuration(blobPath(tp.p, mixBlob)).sampleRate, 48000);
    // the timing source is labelled
    assert.equal(tl.source, 'qwen-estimated');
    assert.ok(Object.values(tl.timingSources).every((s) => s === 'estimated'));
    assert.equal(meta(tp, timing.id).source, 'qwen-estimated');
    // the render was preceded by a confirmed hand-over of the audio model
    assert.equal(events(tp, render.id, 'handover')[0].outcome, 'released');
    assert.equal(tp.p.db.prepare("SELECT COUNT(*) c FROM job_procs WHERE gone_at IS NULL AND owner LIKE 'attempt:%'").get()!.c, 0);
  });

  test('with the aligner configured, the model switch is confirmed and the timeline says "aligned"', {skip: !inspectable && 'process inspection unavailable (the hand-over before a render cannot be confirmed without it)'}, async () => {
    const {r, t: tp, host} = setup('aligned');
    await ttsAll(r, tp);
    assert.equal(host.loaded, 'tts');
    const timing = await r.waitFor(r.enqueue({episodeId: EP, jobKind: 'timing.build'}));
    assert.equal(timing.state, 'succeeded', timing.error ?? '');
    assert.equal(host.loaded, 'aligner');
    assert.equal(host.handovers.at(-1)!.outcome, 'released');
    assert.match(host.handovers.at(-1)!.reason, /switching from tts to aligner/);
    assert.equal(meta(tp, timing.id).source, 'qwen-aligned');
  });

  test('selective regeneration: edit one sentence and exactly one block regenerates; the rest are cache hits', async () => {
    const {r, t: tp} = setup();
    const first = await ttsAll(r, tp);
    assert.ok(first.ids.every((id) => meta(tp, id).cacheHit === false), 'the first pass generated every block');
    const doc = getEpisode(tp.p, EP);
    const victim = doc.narration.blocks[1];
    const segId = victim.segments[0];
    saveEpisode(tp.p, EP, {...doc, narration: {...doc.narration, segments: doc.narration.segments.map((s) => (s.id === segId ? {...s, text: `${s.text} Really.`, ...(s.speech ? {speech: `${s.speech} Really.`} : {}), captions: undefined} : s))}});
    const second = await ttsAll(r, tp);
    assert.ok(second.rows.every((x) => x.state === 'succeeded'));
    const hits = second.ids.map((id) => meta(tp, id).cacheHit);
    assert.equal(hits.filter((h) => h === false).length, 1, 'exactly one block regenerated');
    assert.equal(hits.filter((h) => h === true).length, blocksOf(tp).length - 1);
    assert.equal(hits[1], false, 'and it is the edited block');
    const gen = second.ids.filter((id) => events(tp, id, 'progress').some((e) => e.step === 'generating speech'));
    assert.deepEqual(gen, [second.ids[1]], 'only the edited block reached the voice model');
    assert.equal(statusReport(tp.p, EP).notFresh.filter((x) => x.startsWith('take:')).length, 0, 'every take is fresh again');
  });

  test('progress is truthful: speech generation shows the step and elapsed time but never a percentage; a render shows its real fraction', {skip: !inspectable && 'process inspection unavailable (the hand-over before a render cannot be confirmed without it)'}, async () => {
    const {r, t: tp} = setup();
    const {ids} = await ttsAll(r, tp);
    for (const id of ids) {
      const ps = events(tp, id, 'progress');
      assert.ok(ps.length > 0);
      assert.ok(ps.every((e) => e.fraction === null), 'no invented percentage while the total is unknown');
    }
    await r.waitFor(r.enqueue({episodeId: EP, jobKind: 'timing.build'}));
    await r.waitFor(r.enqueue({episodeId: EP, jobKind: 'mix.draft'}));
    process.env.FAKE_RENDER_FRAMES = '6'; process.env.FAKE_RENDER_STEP_MS = '300'; // the runner stores a step update at most every 250 ms
    const id = r.enqueue({episodeId: EP, jobKind: 'render.draft'});
    await r.waitFor(id);
    const fr = events(tp, id, 'progress').filter((e) => e.step === 'rendering').map((e) => e.fraction);
    assert.ok(fr.length >= 2 && fr.every((f) => f >= 0 && f <= 1));
    assert.deepEqual([...fr].sort((a, b) => a - b), fr, 'fractions never go backwards');
  });

  test('a render without a timing or a mix stops in preparation with a clear reason', async () => {
    const {r} = setup();
    const j = await r.waitFor(r.enqueue({episodeId: EP, jobKind: 'render.draft'}));
    assert.equal(j.state, 'failed');
    assert.match(j.error!, /the timing does not exist yet/);
  });

  test('a failing render worker fails the job with its message and frees the slot', {skip: !inspectable && 'process inspection unavailable (the hand-over before a render cannot be confirmed without it)'}, async () => {
    const {r} = setup();
    await ttsAll(r, t!);
    await r.waitFor(r.enqueue({episodeId: EP, jobKind: 'timing.build'}));
    await r.waitFor(r.enqueue({episodeId: EP, jobKind: 'mix.draft'}));
    process.env.FAKE_RENDER_FAIL = 'chromium could not start';
    const j = await r.waitFor(r.enqueue({episodeId: EP, jobKind: 'render.draft'}));
    assert.equal(j.state, 'failed');
    assert.match(j.error!, /chromium could not start/);
    delete process.env.FAKE_RENDER_FAIL;
    const retry = await r.waitFor(r.enqueue({episodeId: EP, jobKind: 'render.draft'}));
    assert.equal(retry.state, 'succeeded');
  });

  test('cancelling a render stops the render worker and its children, leaves no partial file, and the next job starts at once', {skip: !inspectable && 'process inspection unavailable'}, async () => {
    const {r, t: tp} = setup();
    await ttsAll(r, tp);
    await r.waitFor(r.enqueue({episodeId: EP, jobKind: 'timing.build'}));
    await r.waitFor(r.enqueue({episodeId: EP, jobKind: 'mix.draft'}));
    process.env.FAKE_RENDER_CHILDREN = '2';
    process.env.FAKE_RENDER_FRAMES = '200';
    process.env.FAKE_RENDER_STEP_MS = '100';
    const id = r.enqueue({episodeId: EP, jobKind: 'render.draft'});
    await until(() => events(tp, id, 'progress').some((e) => e.step === 'rendering' && e.fraction > 0), 15000, 'rendering');
    const owned = tp.p.db.prepare("SELECT pid FROM job_procs WHERE gone_at IS NULL AND owner LIKE 'attempt:%'").all().map((x: any) => x.pid as number);
    const all = new Set([...owned, ...descendantsOf(snapshotProcs(), owned)]);
    assert.ok(all.size >= 3, `the worker and its two children were running (${all.size})`);
    const done = await r.cancel(id);
    assert.equal(done.state, 'cancelled');
    await until(() => [...all].every((p) => !alive(p)), 4000, 'all processes gone');
    assert.deepEqual(existsSync(tp.p.tmpDir) ? readdirSync(tp.p.tmpDir) : [], [], 'no job workspace or partial output is left');
    delete process.env.FAKE_RENDER_CHILDREN; process.env.FAKE_RENDER_FRAMES = '3'; process.env.FAKE_RENDER_STEP_MS = '10';
    const next = await r.waitFor(r.enqueue({episodeId: EP, jobKind: 'render.draft'}));
    assert.equal(next.state, 'succeeded', 'the heavy slot was free');
  });
});
