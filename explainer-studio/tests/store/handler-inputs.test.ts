// Queued jobs run on what was recorded when they were queued, never on newer settings, and refuse when that cannot be done.
// Pattern: enqueue (inputs are frozen synchronously), change the project, then let the job run (the runner starts it on the next tick).
import assert from 'node:assert/strict';
import {copyFileSync, appendFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, describe, test} from 'node:test';
import {ReferenceImmutableError, addReference, statusReport} from '../../core/artifacts.ts';
import {blobPath} from '../../core/blobs.ts';
import {getEpisode, saveEpisode} from '../../core/episodes.ts';
import {planCleanup, reachableBlobs} from '../../core/gc.ts';
import {snapshotProcs} from '../../core/proc.ts';
import {PreflightError, type JobRunner} from '../../core/runner.ts';
import {setComponent} from '../../core/state.ts';
import {getComponentValue} from '../../core/state.ts';
import {mixParamsValue, voiceRuntimeValue} from '../../core/toolchain.ts';
import {EP, FAKE_AUDIO, MIX, fixture, makeCheckout, recordSettings, removeCheckout, writeReference, type Fixture, type Settings} from './handler-fixture.ts';
import {newProject, type TestProject} from './helpers.ts';
import {adoptEpisode} from '../../core/episodes.ts';

const fixtures: Fixture[] = [];
const cleanup: (() => void)[] = [];
afterEach(async () => {
  for (const f of fixtures.splice(0)) { f.r.stop(); await f.host.shutdown().catch(() => {}); f.t.close(); }
  for (const c of cleanup.splice(0)) c();
  for (const k of ['FAKE_RENDER_FAIL', 'FAKE_RENDER_FRAMES', 'FAKE_RENDER_STEP_MS', 'FAKE_LOG']) delete process.env[k];
});
const inspectable = (() => { try { snapshotProcs(); return true; } catch { return false; } })();
const needsPs = {skip: !inspectable && 'process inspection unavailable (the hand-over before a render cannot be confirmed without it)'};

const use = (o: Parameters<typeof fixture>[0] = {}) => { const f = fixture(o); fixtures.push(f); return f; };
const meta = (t: TestProject, jobId: number) => JSON.parse((t.p.db.prepare('SELECT a.meta_json m FROM jobs j JOIN artifacts a ON a.id=j.artifact_id WHERE j.id=?').get(jobId) as any).m);
const events = (t: TestProject, jobId: number, kind: string) => t.p.db.prepare('SELECT data_json FROM job_events WHERE job_id=? AND kind=? ORDER BY id').all(jobId, kind).map((r: any) => JSON.parse(r.data_json));
const run = async (f: Fixture, jobKind: any, subject?: string) => f.r.waitFor(f.r.enqueue({episodeId: EP, jobKind, subject}));
const allTakes = async (f: Fixture) => { for (const b of f.blocks) assert.equal((await run(f, 'tts.block', b)).state, 'succeeded'); };
const current = (t: TestProject, kind: string, subject: string) => t.p.db.prepare('SELECT a.id, a.blob_hash h FROM current c JOIN artifacts a ON a.id=c.artifact_id WHERE c.episode_id=? AND c.kind=? AND c.subject=?').get(EP, kind, subject) as any;
const wavPeak = (path: string) => { const b = readFileSync(path); let m = 0; for (let i = 44; i + 1 < b.length; i += 2) m = Math.max(m, Math.abs(b.readInt16LE(i))); return m; };
const tmpFile = (name: string) => { const d = mkdtempSync(join(tmpdir(), 'studio-p2-in-')); cleanup.push(() => rmSync(d, {recursive: true, force: true})); return join(d, name); };

describe('a queued job runs on the settings recorded when it was queued', () => {
  test('final mastering targets: changed after enqueue, the job still masters to the recorded target, is outdated, and says so', async () => {
    const f = use();
    await allTakes(f);
    const id = f.r.enqueue({episodeId: EP, jobKind: 'mix.final'});
    setComponent(f.t.p, 'masteringParams', {lufs: -20, true_peak_db: -2, lra: 11});
    const row = await f.r.waitFor(id);
    assert.equal(row.state, 'outdated', row.error ?? '');
    const m = meta(f.t, id);
    assert.deepEqual(m.used.mastering, {lufs: -16, true_peak_db: -1.5, lra: 11});
    assert.equal(m.target.lufs, -16, 'the mix script received the recorded target');
    assert.equal(current(f.t, 'mix', 'final'), undefined, 'an outdated output never becomes current');
    assert.notEqual(statusReport(f.t.p, EP).mix.final.status, 'fresh');
    const again = await run(f, 'mix.final');
    assert.equal(again.state, 'succeeded');
    assert.equal(meta(f.t, again.id).used.mastering.lufs, -20, 'a new job uses the new target');
    assert.equal(statusReport(f.t.p, EP).mix.final.status, 'fresh');
  });

  test('voice gain is applied from the recorded mix parameters', async () => {
    const f = use();
    await allTakes(f);
    const quiet = await run(f, 'mix.draft');
    const peak0 = wavPeak(blobPath(f.t.p, current(f.t, 'mix', 'draft').h));
    assert.equal(quiet.state, 'succeeded');
    const id = f.r.enqueue({episodeId: EP, jobKind: 'mix.draft'});
    setComponent(f.t.p, 'mixParams', mixParamsValue(MIX, {voiceGainDb: -12}));
    await f.r.waitFor(id);
    assert.equal(meta(f.t, id).used.voiceGainDb, 0, 'the queued job keeps the gain it was queued with');
    setComponent(f.t.p, 'mixParams', mixParamsValue(MIX, {voiceGainDb: 6}));
    assert.equal((await run(f, 'mix.draft')).state, 'succeeded');
    const peak6 = wavPeak(blobPath(f.t.p, current(f.t, 'mix', 'draft').h));
    assert.ok(Math.abs(peak6 / peak0 - 2) < 0.03, `+6 dB doubles the peak (${peak6 / peak0})`);
  });

  test('render settings: a queued final render keeps its recorded quality; a retry after a failure still does', needsPs, async () => {
    const f = use();
    await allTakes(f);
    for (const k of ['timing.build', 'mix.final']) assert.equal((await run(f, k)).state, 'succeeded');
    process.env.FAKE_RENDER_FAIL = 'browser crashed';
    const id = f.r.enqueue({episodeId: EP, jobKind: 'render.final'});
    setComponent(f.t.p, 'renderSettings', {width: 1080, height: 1920, fps: 30, codec: 'h264', crf: 30, audio: 'aac'});
    const failed = await f.r.waitFor(id);
    assert.equal(failed.state, 'failed');
    delete process.env.FAKE_RENDER_FAIL;
    f.r.retry(id);
    const row = await f.r.waitFor(id);
    assert.equal(row.state, 'outdated', row.error ?? '');
    assert.equal(meta(f.t, id).crf, 18, 'the render worker was given the recorded crf, not the newer one');
    assert.equal(meta(f.t, id).used.settings.crf, 18);
    assert.equal(row.attempts, 2);
    assert.equal(current(f.t, 'render', 'final'), undefined);
    const fresh = await run(f, 'render.final');
    assert.equal(meta(f.t, fresh.id).crf, 30);
    assert.equal(statusReport(f.t.p, EP).render.final.status, 'fresh');
  });

  test('aligner configuration: a queued timing job aligns even if the project switched to the estimate afterwards', async () => {
    const f = use({aligner: 'aligned'});
    const log = tmpFile('log.jsonl');
    process.env.FAKE_LOG = log; // the worker reads it when it starts, so set it before the first job
    await allTakes(f);
    const id = f.r.enqueue({episodeId: EP, jobKind: 'timing.build'});
    setComponent(f.t.p, 'aligner', {id: 'estimated'});
    const row = await f.r.waitFor(id);
    assert.equal(row.state, 'outdated', row.error ?? '');
    assert.equal(meta(f.t, id).source, 'qwen-aligned');
    assert.equal(meta(f.t, id).alignerRevision, 'rev-a');
    const sent = readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l)).filter((l) => l.cmd);
    assert.deepEqual(sent.filter((s) => s.cmd === 'check').map((s) => s.expect.model_revision), ['rev-a'], 'the worker was asked once to confirm the revision the recorded settings assume');
    assert.ok(sent.some((s) => s.cmd === 'align'));
    const again = await run(f, 'timing.build');
    assert.equal(meta(f.t, again.id).source, 'qwen-estimated');
  });

  test('voice: a queued narration job uses the reference, transcript, revision and token limit recorded at enqueue', async () => {
    const f = use();
    const log = tmpFile('log.jsonl');
    process.env.FAKE_LOG = log;
    const block = f.blocks[0];
    const refBefore = getComponentValue<any>(f.t.p, 'voiceRuntime')!.referenceSha256;
    const id = f.r.enqueue({episodeId: EP, jobKind: 'tts.block', subject: block});
    writeReference(f.t, 'pip-voice-v2', 'A different transcript.', 900);
    const doc = getEpisode(f.t.p, EP);
    saveEpisode(f.t.p, EP, {...doc, voice: {engine: 'qwen3-tts', profile: 'pip-voice-v2'}});
    setComponent(f.t.p, 'voiceRuntime', voiceRuntimeValue(f.t.p, {profile: 'pip-voice-v2', repo: 'fake/model', revision: 'rev-2', mlxAudio: '1', mlx: '1', maxTokens: 900, audioWorker: FAKE_AUDIO}));
    const row = await f.r.waitFor(id);
    assert.equal(row.state, 'outdated', row.error ?? '');
    const [sent] = readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.equal(sent.ref_sha256, refBefore);
    assert.equal(sent.ref_text, 'Ten times faster.');
    assert.equal(sent.max_tokens, 600);
    assert.equal(sent.expect.model_revision, 'rev-1');
    assert.equal(meta(f.t, id).used.referenceSha256, refBefore);
    const next = await run(f, 'tts.block', block);
    assert.equal(meta(f.t, next.id).used.revision, 'rev-2', 'the next job uses the new voice');
    assert.notEqual(meta(f.t, next.id).used.referenceSha256, refBefore);
  });

  test('an approved reference can never be replaced under its name', () => {
    const f = use();
    assert.doesNotThrow(() => addReference(f.t.p, 'pip-voice-v1', join(f.t.root, 'pip-voice-v1.wav'), {script: 'x'}), 'recording identical content again changes nothing');
    writeFileSync(join(f.t.root, 'other.wav'), Buffer.concat([readFileSync(join(f.t.root, 'pip-voice-v1.wav'))].map((b) => { const c = Buffer.from(b); c.writeInt16LE(77, 44); return c; })));
    assert.throws(() => addReference(f.t.p, 'pip-voice-v1', join(f.t.root, 'other.wav'), {script: 'x'}), ReferenceImmutableError);
  });

  test('a recorded voice runtime that does not match the reference refuses the job before the model loads', async () => {
    const f = use();
    setComponent(f.t.p, 'voiceRuntime', {...getComponentValue<any>(f.t.p, 'voiceRuntime')!, referenceTranscriptSha256: 'f'.repeat(64)});
    const row = await run(f, 'tts.block', f.blocks[0]);
    assert.equal(row.state, 'failed');
    assert.match(row.error!, /not the reference \(audio and transcript\) recorded/);
    assert.equal(f.host.worker, null, 'no model was loaded');
  });

  test('executed scripts: the audio worker and the mix script must match what was recorded', async () => {
    const worker = tmpFile('audio-worker.py');
    const mix = tmpFile('mix.py');
    copyFileSync(FAKE_AUDIO, worker);
    copyFileSync(MIX, mix);
    const f = use({audioWorker: worker, mixScript: mix});
    const ok = await run(f, 'tts.block', f.blocks[0]);
    assert.equal(ok.state, 'succeeded', ok.error ?? '');
    for (const b of f.blocks.slice(1)) await run(f, 'tts.block', b);
    appendFileSync(mix, '\n# edited after the mix parameters were recorded\n');
    const mixRow = await run(f, 'mix.draft');
    assert.equal(mixRow.state, 'failed');
    assert.match(mixRow.error!, /mix script changed/);
    appendFileSync(worker, '\n# edited\n');
    const stale = f.blocks[0];
    const doc = getEpisode(f.t.p, EP);
    saveEpisode(f.t.p, EP, {...doc, narration: {...doc.narration, segments: doc.narration.segments.map((s) => (s.id === doc.narration.blocks[0].segments[0] ? {...s, text: `${s.text} Again.`, speech: s.speech ? `${s.speech} Again.` : undefined, captions: undefined} : s))}});
    const ttsRow = await run(f, 'tts.block', stale);
    assert.equal(ttsRow.state, 'failed');
    assert.match(ttsRow.error!, /audio worker script changed/);
  });

  test('a worker whose model revision or library differs from the recorded settings refuses the whole timing job; it does not fall back to the estimate', async () => {
    const f = use({aligner: 'aligned'});
    await allTakes(f);
    process.env.FAKE_CHECK_FAIL = 'recorded model revision rev-a does not match the pinned revision';
    cleanup.push(() => { delete process.env.FAKE_CHECK_FAIL; });
    await f.host.shutdown(); // the next job starts a worker that sees the variable
    const row = await run(f, 'timing.build');
    assert.equal(row.state, 'failed');
    assert.match(row.error!, /does not match the pinned revision/);
    assert.equal(f.t.p.db.prepare("SELECT COUNT(*) c FROM job_events WHERE kind='finished' AND job_id=?").get(row.id)!.c, 0);
  });

  test('timeline logic: a fingerprint that no longer matches the files refuses the timing job before any model loads', async () => {
    const f = use({aligner: 'aligned'});
    await allTakes(f);
    setComponent(f.t.p, 'timelineLogic', {'pipeline/timeline.py': '0'.repeat(64)});
    const row = await run(f, 'timing.build');
    assert.equal(row.state, 'failed');
    assert.match(row.error!, /timeline logic files changed/);
    assert.notEqual(f.host.loaded, 'aligner');
  });
});

describe('render sources, assets and toolchain are verified against what was recorded', () => {
  const withCheckout = async () => {
    const dir = makeCheckout();
    cleanup.push(() => removeCheckout(dir));
    const f = use({sourceRoot: dir});
    await allTakes(f);
    for (const k of ['timing.build', 'mix.final']) assert.equal((await run(f, k)).state, 'succeeded');
    return {f, dir};
  };

  test('a source file edited after the render was queued stops the render before it starts; reverting it lets a retry run', needsPs, async () => {
    const {f, dir} = await withCheckout();
    const file = join(dir, 'src/scenes/a.tsx');
    const original = readFileSync(file, 'utf8');
    const id = f.r.enqueue({episodeId: EP, jobKind: 'render.final'});
    writeFileSync(file, 'export const A = 2;\n');
    const row = await f.r.waitFor(id);
    assert.equal(row.state, 'failed');
    assert.match(row.error!, /src\/scenes\/a\.tsx changed/);
    assert.equal(events(f.t, id, 'progress').length, 0, 'the render worker never started');
    writeFileSync(file, original);
    f.r.retry(id);
    const ok = await f.r.waitFor(id);
    assert.equal(ok.state, 'succeeded', ok.error ?? '');
    assert.equal(meta(f.t, id).used.sourcesVerifiedAgainstRecorded, true);
  });

  test('an added source file, a changed asset and a different installed Remotion are each refused', needsPs, async () => {
    const {f, dir} = await withCheckout();
    writeFileSync(join(dir, 'src/extra.ts'), 'export {};\n');
    let row = await run(f, 'render.final');
    assert.match(row.error!, /src\/extra\.ts was added/);
    rmSync(join(dir, 'src/extra.ts'));
    writeFileSync(join(dir, 'public/assets/a.txt'), 'changed asset\n');
    row = await run(f, 'render.final');
    assert.match(row.error!, /assets: public\/assets\/a\.txt changed/);
    writeFileSync(join(dir, 'public/assets/a.txt'), 'asset a\n');
    writeFileSync(join(dir, 'node_modules/remotion/package.json'), '{"version":"4.0.999"}\n');
    row = await run(f, 'render.final');
    assert.match(row.error!, /remotion 4\.0\.999 is installed, 4\.0\.536 was recorded/);
    writeFileSync(join(dir, 'node_modules/remotion/package.json'), '{"version":"4.0.536"}\n');
    assert.equal((await run(f, 'render.final')).state, 'succeeded');
  });

  test('render settings the worker cannot apply are refused, not ignored', needsPs, async () => {
    const f = use();
    await allTakes(f);
    for (const k of ['timing.build', 'mix.final']) await run(f, k);
    setComponent(f.t.p, 'renderSettings', {width: 1080, height: 1920, fps: 60, codec: 'h264', crf: 18, audio: 'aac', hdr: true});
    const row = await run(f, 'render.final');
    assert.equal(row.state, 'failed');
    assert.match(row.error!, /hdr are not supported/);
    assert.match(row.error!, /fps=60 is not supported/);
  });
});

describe('recorded inputs that cannot be recovered are refused explicitly', () => {
  test('a take blob removed from the project: the mix refuses and nothing is regenerated', async () => {
    const f = use();
    await allTakes(f);
    const victim = current(f.t, 'take', f.blocks[1]).h;
    const id = f.r.enqueue({episodeId: EP, jobKind: 'mix.draft'});
    rmSync(blobPath(f.t.p, victim));
    const row = await f.r.waitFor(id);
    assert.equal(row.state, 'failed');
    assert.match(row.error!, /take for block "[^"]+" recorded for this job .* is no longer in the project; refusing to use anything else/);
    assert.equal(f.t.p.db.prepare("SELECT COUNT(*) c FROM jobs WHERE kind='tts.block'").get()!.c, f.blocks.length, 'no narration job was started to replace it');
  });

  test('a snapshot written by an older build (no recorded settings) is refused', async () => {
    const f = use();
    await allTakes(f);
    const id = f.r.enqueue({episodeId: EP, jobKind: 'mix.draft'});
    const snap = f.t.p.db.prepare('SELECT s.id, s.manifest_json m FROM jobs j JOIN snapshots s ON s.id=j.snapshot_id WHERE j.id=?').get(id) as any;
    const m = JSON.parse(snap.m);
    delete m.componentValues;
    f.t.p.db.prepare('UPDATE snapshots SET manifest_json=? WHERE id=?').run(JSON.stringify(m), snap.id);
    const row = await f.r.waitFor(id);
    assert.equal(row.state, 'failed');
    assert.match(row.error!, /older build that did not record its settings/);
  });

  test('the document blob of a job missing: the job will not run on anything else', async () => {
    const f = use();
    const id = f.r.enqueue({episodeId: EP, jobKind: 'tts.block', subject: f.blocks[0]});
    const snap = f.t.p.db.prepare('SELECT s.manifest_json m FROM jobs j JOIN snapshots s ON s.id=j.snapshot_id WHERE j.id=?').get(id) as any;
    rmSync(blobPath(f.t.p, JSON.parse(snap.m).docBlob));
    const row = await f.r.waitFor(id);
    assert.equal(row.state, 'failed');
    assert.match(row.error!, /inputs recorded for this job cannot be recovered/);
  });

  test('cleanup keeps the blobs of a failed job so it can be retried on its own inputs', async () => {
    const f = use();
    await allTakes(f);
    const failed = await run(f, 'render.draft'); // no timing yet: fails in preparation
    assert.equal(failed.state, 'failed');
    const old = current(f.t, 'take', f.blocks[0]).h;
    const doc = getEpisode(f.t.p, EP);
    saveEpisode(f.t.p, EP, {...doc, narration: {...doc.narration, segments: doc.narration.segments.map((s) => (s.id === doc.narration.blocks[0].segments[0] ? {...s, text: `${s.text} Again.`, speech: s.speech ? `${s.speech} Again.` : undefined, captions: undefined} : s))}});
    assert.equal((await run(f, 'tts.block', f.blocks[0])).state, 'succeeded');
    assert.notEqual(current(f.t, 'take', f.blocks[0]).h, old);
    assert.ok(reachableBlobs(f.t.p).has(old), 'the old take is still referenced by the failed job');
    assert.ok(!planCleanup(f.t.p, {graceMs: 0}).blobs.some((b) => b.hash === old));
  });
});

describe('inputs this build cannot apply are rejected before expensive work', () => {
  const refused = (f: Fixture, jobKind: any, subject: string | undefined, re: RegExp) => {
    assert.throws(() => f.r.enqueue({episodeId: EP, jobKind, subject}), (e: unknown) => e instanceof PreflightError && re.test(e.message));
    assert.equal(f.t.p.db.prepare('SELECT COUNT(*) c FROM jobs').get()!.c, 0, 'nothing was queued');
    assert.equal(f.host.worker, null, 'no worker was started');
  };

  test('a pause inside a block (join-fanout as authored, s07 mid-block) is rejected with a way out; the same episode with a block boundary works', async () => {
    const t = newProject({clock: { t: 0, now: () => Date.now(), advance: () => {} }});
    adoptEpisode(t.p, `episodes/${EP}/episode.json`);
    writeReference(t);
    const doc = getEpisode(t.p, EP);
    saveEpisode(t.p, EP, {...doc, voice: {engine: 'qwen3-tts', profile: 'pip-voice-v1'}});
    recordSettings(t, process.cwd());
    const f = use({project: t});
    refused(f, 'tts.block', f.blocks[0], /pause\(s\) inside a narration block \(s07\).*Start a new block after that segment/s);
    const g = use();
    assert.equal((await run(g, 'tts.block', g.blocks[0])).state, 'succeeded', 'the boundary after s07 makes it supported');
  });

  test('manual timing corrections', () => {
    const f = use();
    setComponent(f.t.p, 'manualTiming', {words: {s04: {0: {start: 1.2}}}});
    refused(f, 'timing.build', undefined, /Manual timing corrections are set, but this build does not apply them/);
  });

  test('sound events, sound assets and unsupported mix parameters', () => {
    const f = use();
    // Synthesized accents are supported now; anything else is still refused, with the reason.
    setComponent(f.t.p, 'soundEvents', [{at: 's04', sound: 'pop'}]);
    refused(f, 'mix.draft', undefined, /Sound event 1: .*not supported/);
    setComponent(f.t.p, 'soundEvents', [{accent: 'laser', cue: 'x', gainDb: 0}]);
    refused(f, 'mix.draft', undefined, /"laser" is not one of the supported accents/);
    setComponent(f.t.p, 'soundEvents', [{accent: 'pop', cue: 'x', gainDb: 0, params: {color: 'red'}}]);
    refused(f, 'mix.draft', undefined, /pop has no parameter "color"/);
    setComponent(f.t.p, 'soundEvents', []);
    setComponent(f.t.p, 'soundAssets', {pop: 'abc'});
    refused(f, 'mix.draft', undefined, /Sound assets are set/);
    setComponent(f.t.p, 'soundAssets', {});
    setComponent(f.t.p, 'mixParams', {...mixParamsValue(MIX), reverb: 0.3});
    refused(f, 'mix.draft', undefined, /Mix parameter\(s\) reverb are not supported/);
    setComponent(f.t.p, 'mixParams', {...mixParamsValue(MIX), voiceGainDb: 40});
    refused(f, 'mix.draft', undefined, /voiceGainDb must be a number from -24 to 12/);
  });

  test('a job queued before the unsupported setting appeared keeps running on what it was queued with; one queued after is refused by the handler too', async () => {
    const f = use();
    await allTakes(f);
    const id = f.r.enqueue({episodeId: EP, jobKind: 'timing.build'});
    setComponent(f.t.p, 'manualTiming', {words: {}, note: 'later'});
    const row = await f.r.waitFor(id);
    assert.equal(row.state, 'outdated', row.error ?? ''); // ran on the recorded (empty) manual timing; its inputs are stale now
    const g = use({runner: {preflight: undefined}}); // a runner without the enqueue check: the handler still refuses, before loading anything
    setComponent(g.t.p, 'manualTiming', {words: {x: 1}});
    const bad = await run(g, 'tts.block', g.blocks[0]);
    assert.equal(bad.state, 'failed');
    assert.match(bad.error!, /Manual timing corrections are set/);
    assert.equal(g.host.worker, null);
  });

  test('ordinary supported settings (no manual timing, no sounds, empty mix parameters) are accepted and run', async () => {
    const f = use();
    let id = 0;
    assert.doesNotThrow(() => { id = f.r.enqueue({episodeId: EP, jobKind: 'tts.block', subject: f.blocks[0]}); });
    assert.equal((await f.r.waitFor(id)).state, 'succeeded');
  });
});
