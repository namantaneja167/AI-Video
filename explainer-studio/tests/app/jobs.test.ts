// The job service on a seeded workspace with fake audio and render workers. Real: handlers, runner, timeline logic, mixer, hashes.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {after, before, describe, test} from 'node:test';
import {displayBuild, listBuilds} from '../../app/builds.ts';
import {RebuildError} from '../../app/jobs.ts';
import {toggleEmphasis} from '../../app/shared/edit.ts';
import {statusReport} from '../../core/artifacts.ts';
import {getEpisode, getEpisodeInfo} from '../../core/episodes.ts';
import {currentRows} from '../../core/state.ts';
import {EP, edit, fakeWorkspace, requestId, putSegmentBack, readSegment, setCaptionOnly, setSpoken, until, waitRebuild, type FakeWorkspace} from './jobs-fixture.ts';

let w: FakeWorkspace;
before(() => { w = fakeWorkspace(); });
after(async () => { await w.close(); });

const jobsOf = (rebuildId: string) => w.svc.list(EP, 100).filter((j) => j.rebuildId === rebuildId).sort((a, b) => a.id - b.id);
const kinds = (rebuildId: string) => jobsOf(rebuildId).map((j) => j.kind === 'tts.block' ? `${j.kind}:${j.subject}` : j.kind);
const takeId = (block: string) => currentRows(w.p, EP).find((r) => r.kind === 'take' && r.subject === block)!.artifact_id;
const start = (rid = requestId()) => w.svc.startRebuild(EP, {seq: getEpisodeInfo(w.p, EP).seq, requestId: rid});
const fresh = () => { const s = statusReport(w.p, EP); return Object.values(s.takes).every((t) => t.status === 'fresh') && s.timing.status === 'fresh' && s.mix.final.status === 'fresh' && s.render.final.status === 'fresh'; };

let s2Narrated: ReturnType<typeof readSegment>;

describe('rebuilds with fake workers', {timeout: 600_000}, () => {
  test('the first rebuild plans every stage, shows measured costs, and runs the heavy jobs one at a time in dependency order', async () => {
    const plan = w.svc.plan(EP);
    assert.deepEqual(plan.blockers, []);
    assert.deepEqual(plan.steps.map((s) => `${s.key}:${s.action}`), ['take:b1:run', 'take:b2:run', 'timing:run', 'mix:final:run', 'render:final:run']);
    assert.ok(plan.total.known >= 4, 'measured durations exist for these stages');
    assert.equal(plan.steps[0].estimate?.measured, true);
    const r = start();
    assert.equal(r.repeated, false);
    await waitRebuild(w.svc, r.rebuildId, ['complete', 'failed']);
    assert.deepEqual(kinds(r.rebuildId), ['tts.block:b1', 'tts.block:b2', 'timing.build', 'mix.final', 'render.final']);
    const jobs = jobsOf(r.rebuildId);
    assert.ok(jobs.every((j) => j.state === 'succeeded'), jobs.map((j) => `${j.label}: ${j.state} ${j.error ?? ''}`).join('; '));
    for (let i = 1; i < jobs.length; i++) assert.ok(jobs[i].startedAt! >= jobs[i - 1].finishedAt!, `${jobs[i].label} started before ${jobs[i - 1].label} finished`);
    assert.ok(fresh());
    const builds = listBuilds(w.p, EP);
    assert.equal(builds.length, 2, 'the imported baseline stays as an earlier build');
    assert.ok(builds[0].render, 'the new build has its video');
    assert.equal(builds[1].imported !== null, true);
    assert.equal(w.svc.measuredRuns().runs.some((x) => x.source.startsWith('a rebuild in this workspace')), true, 'real runs are recorded as measurements');
  });

  test('a repeated click is the same rebuild, and a second rebuild cannot start while one is active', async () => {
    setCaptionOnly(w.p, 's2', 'That limit is called its context window.');
    const rid = requestId();
    const a = start(rid);
    const b = start(rid);
    assert.equal(b.repeated, true);
    assert.equal(b.rebuildId, a.rebuildId);
    assert.throws(() => start(), (e: unknown) => e instanceof RebuildError && e.code === 'busy');
    await waitRebuild(w.svc, a.rebuildId, ['complete', 'failed']);
    assert.deepEqual(kinds(a.rebuildId), ['timing.build', 'mix.final', 'render.final'], 'a caption-only edit reuses the narration');
    assert.ok(fresh());
    assert.throws(() => start(), (e: unknown) => e instanceof RebuildError && e.code === 'nothing');
  });

  test('an emphasis-only edit rebuilds just the video, and the video draws the emphasis of its own document', async () => {
    const before = getEpisode(w.p, EP);
    edit(w.p, (d) => toggleEmphasis(d, 's1', 0));
    const plan = w.svc.plan(EP);
    assert.deepEqual(plan.steps.map((s) => `${s.key}:${s.action}`), ['take:b1:current', 'take:b2:current', 'timing:current', 'mix:final:current', 'render:final:run']);
    const specCopy = join(w.tmp, 'render-spec.json');
    process.env.FAKE_RENDER_SPEC_COPY = specCopy;
    try {
      const r = start();
      await waitRebuild(w.svc, r.rebuildId, ['complete', 'failed']);
      assert.deepEqual(kinds(r.rebuildId), ['render.final']);
    } finally { delete process.env.FAKE_RENDER_SPEC_COPY; }
    const spec = JSON.parse(readFileSync(specCopy, 'utf8'));
    const cap = spec.inputProps.data.timeline.captions.find((c: any) => c.segment === 's1');
    assert.deepEqual(cap.emphasis?.[0], [0, 1], 'word 0 of s1 is emphasised in the rendered timeline');
    assert.notDeepEqual(getEpisode(w.p, EP).narration.segments[0].emphasis, before.narration.segments[0].emphasis);
  });

  test('a spoken-text edit regenerates only the affected block; the other block keeps its take', async () => {
    const keep = takeId('b2');
    s2Narrated = readSegment(w.p, 's2');
    setSpoken(w.p, 's2', 'That limit is its whole context window.');
    const plan = w.svc.plan(EP);
    assert.deepEqual(plan.steps.map((s) => `${s.key}:${s.action}`), ['take:b1:run', 'take:b2:current', 'timing:run', 'mix:final:run', 'render:final:run']);
    assert.match(plan.steps[0].why[0], /Spoken text changed in s2/);
    const r = start();
    await waitRebuild(w.svc, r.rebuildId, ['complete', 'failed']);
    assert.deepEqual(kinds(r.rebuildId), ['tts.block:b1', 'timing.build', 'mix.final', 'render.final']);
    assert.equal(takeId('b2'), keep, 'block b2 was not touched');
    assert.ok(fresh());
  });

  test('going back to text that was narrated before reuses the saved take instead of generating it again', async () => {
    putSegmentBack(w.p, s2Narrated); // undo: the words narrated by the first rebuild, exactly as they were
    const plan = w.svc.plan(EP);
    assert.deepEqual(plan.steps.map((x) => `${x.key}:${x.action}`), ['take:b1:reuse', 'take:b2:current', 'timing:reuse', 'mix:final:reuse', 'render:final:reuse'], 'timing, mix and video made from these exact inputs are selected too: the segment is exactly as it was when they were built');
    assert.equal(plan.steps[0].estimate, null);
    assert.match(plan.steps[0].why.join(' '), /saved take for exactly this text/);
    const r = start();
    await waitRebuild(w.svc, r.rebuildId, ['complete', 'failed']);
    const take = jobsOf(r.rebuildId).find((j) => j.kind === 'tts.block')!;
    assert.deepEqual(kinds(r.rebuildId), ['tts.block:b1'], 'only the take lookup ran');
    assert.match(w.svc.rebuilds(EP, 20).find((x) => x.id === r.rebuildId)!.message, /Reused without rebuilding: Timing and captions, Final audio mix, Final video/);
    assert.equal(take.cacheHit, true);
    assert.match(take.note ?? '', /Reused a saved take/);
    assert.ok(fresh());
  });

  test('inputs this build cannot apply are refused before any work, with the segment to fix', async () => {
    const before = w.svc.list(EP, 100).length;
    edit(w.p, (d) => ({...d, narration: {...d.narration, segments: d.narration.segments.map((s) => (s.id === 's1' ? {...s, pauseAfter: 0.5} : s))}}));
    const plan = w.svc.plan(EP);
    assert.equal(plan.blockers.length, 1);
    assert.deepEqual(plan.blockers[0].segments, ['s1']);
    assert.match(plan.blockers[0].message, /Start a new block after that segment, or remove the pause/);
    assert.throws(() => start(), (e: unknown) => e instanceof RebuildError && e.code === 'blocked');
    assert.equal(w.svc.list(EP, 100).length, before, 'nothing was queued');
    edit(w.p, (d) => ({...d, narration: {...d.narration, segments: d.narration.segments.map((s) => { const {pauseAfter: _p, ...rest} = s; return s.id === 's1' ? rest : s; })}}));
    assert.deepEqual(w.svc.plan(EP).blockers, []);
  });

  test('removing a word the scene times its animation on is refused before any narration is paid for', () => {
    const before = w.svc.list(EP, 100).length;
    setSpoken(w.p, 's2', 'That limit is its whole window.');
    const plan = w.svc.plan(EP);
    assert.equal(plan.blockers.length, 1);
    assert.match(plan.blockers[0].message, /"label" moment on the word "context" in segment s2/);
    assert.deepEqual(plan.blockers[0].segments, ['s2']);
    assert.throws(() => start(), (e: unknown) => e instanceof RebuildError && e.code === 'blocked');
    assert.equal(w.svc.list(EP, 100).length, before);
    setSpoken(w.p, 's2', 'That limit is its whole context window.');
  });

  test('a stale plan is refused: the episode was saved again after the summary was made', async () => {
    setCaptionOnly(w.p, 's3', 'Your text is cut into small pieces, called tokens.');
    const seq = getEpisodeInfo(w.p, EP).seq;
    setCaptionOnly(w.p, 's3', 'Your text is cut into small pieces called tokens!');
    assert.throws(() => w.svc.startRebuild(EP, {seq, requestId: requestId()}), (e: unknown) => e instanceof RebuildError && e.code === 'changed');
  });

  test('an edit while a job runs: the job finishes on its recorded inputs, is kept as an earlier build, and is not shown as matching the new text', async () => {
    process.env.FAKE_RENDER_FRAMES = '50'; process.env.FAKE_RENDER_STEP_MS = '60';
    try {
      const r = start();
      await until('render running', () => w.svc.list(EP, 100).find((j) => j.rebuildId === r.rebuildId && j.kind === 'render.final' && j.state === 'running'), 120_000);
      const before = listBuilds(w.p, EP)[0];
      setCaptionOnly(w.p, 's4', 'Each token uses up some room, always.');
      await waitRebuild(w.svc, r.rebuildId, ['stopped', 'complete', 'failed']);
      const render = jobsOf(r.rebuildId).find((j) => j.kind === 'render.final')!;
      assert.equal(render.state, 'outdated');
      assert.match(render.note ?? '', /earlier build/);
      assert.equal(w.svc.rebuilds(EP, 20).find((x) => x.id === r.rebuildId)!.state, 'stopped');
      const status = statusReport(w.p, EP);
      assert.notEqual(status.render.final.status, 'fresh');
      const shown = displayBuild(w.p, EP, listBuilds(w.p, EP), null, status)!;
      assert.equal(shown.matchesLatestEdits, false, 'it is not presented as matching the newer edit');
      assert.ok(before.id, 'the build existed before');
    } finally { delete process.env.FAKE_RENDER_FRAMES; delete process.env.FAKE_RENDER_STEP_MS; }
    // the author rebuilds again to include the edit
    const again = start();
    await waitRebuild(w.svc, again.rebuildId, ['complete', 'failed']);
    assert.ok(fresh());
  });

  test('cancelling stops the job and keeps what already finished; the earlier build with a video stays available; retry finishes the rebuild', async () => {
    setCaptionOnly(w.p, 's5', 'The reply uses room too, as well.');
    const videoBuild = listBuilds(w.p, EP).find((b) => b.render)!;
    process.env.FAKE_RENDER_FRAMES = '300'; process.env.FAKE_RENDER_STEP_MS = '50'; process.env.FAKE_RENDER_CHILDREN = '1';
    let rid = '';
    try {
      rid = start().rebuildId;
      const job = await until('render running', () => w.svc.list(EP, 100).find((j) => j.rebuildId === rid && j.kind === 'render.final' && j.state === 'running'), 120_000);
      await w.svc.cancel(job.id);
    } finally { delete process.env.FAKE_RENDER_FRAMES; delete process.env.FAKE_RENDER_STEP_MS; delete process.env.FAKE_RENDER_CHILDREN; }
    const render = jobsOf(rid).find((j) => j.kind === 'render.final')!;
    assert.equal(render.state, 'cancelled');
    assert.equal(w.svc.rebuilds(EP, 20).find((x) => x.id === rid)!.state, 'cancelled');
    assert.ok(jobsOf(rid).filter((j) => j.kind !== 'render.final').every((j) => j.state === 'succeeded'), 'earlier steps are kept');
    assert.ok(listBuilds(w.p, EP).some((b) => b.id === videoBuild.id && b.render), 'the earlier build with a video is still available');
    assert.equal(w.svc.activeWork(EP), null, 'nothing is left running');
    w.svc.retry(render.id);
    await waitRebuild(w.svc, rid, ['complete', 'failed']);
    assert.equal(w.svc.list(EP, 100).find((j) => j.id === render.id)!.state, 'succeeded');
    assert.equal(w.svc.list(EP, 100).find((j) => j.id === render.id)!.attempts, 2);
    assert.ok(fresh());
  });

  test('a failed step shows the real reason, keeps the earlier build, and Retry continues the rebuild', async () => {
    setCaptionOnly(w.p, 's6', 'In many models, input and output share a single budget.');
    process.env.FAKE_RENDER_FAIL = 'the renderer ran out of something (test)';
    let rid = '';
    try {
      rid = start().rebuildId;
      await waitRebuild(w.svc, rid, ['failed']);
    } finally { delete process.env.FAKE_RENDER_FAIL; }
    const render = jobsOf(rid).find((j) => j.kind === 'render.final')!;
    assert.equal(render.state, 'failed');
    assert.match(render.friendlyError ?? '', /ran out of something/);
    assert.equal(render.canRetry, true);
    assert.ok(listBuilds(w.p, EP).some((b) => b.render));
    w.svc.retry(render.id);
    await waitRebuild(w.svc, rid, ['complete']);
    assert.ok(fresh());
  });

  test('builds are paired by what they were made from: the preview never combines a new timing with an old mix', async () => {
    const status = statusReport(w.p, EP);
    const builds = listBuilds(w.p, EP);
    for (const b of builds) {
      const shown = displayBuild(w.p, EP, builds, b.id, status)!;
      const ts = JSON.stringify(shown.builtDoc.narration.blocks);
      assert.ok(ts.length > 0);
      assert.equal(shown.audio.matchesTiming, true);
    }
    // After narration changes but before timing is rebuilt, the new timing does not exist, so the newest build is still a complete one.
    setSpoken(w.p, 's1', 'A model can only read some of it at once.');
    const r = start();
    await until('narration finished', () => w.svc.list(EP, 100).find((j) => j.rebuildId === r.rebuildId && j.kind === 'tts.block' && j.state === 'succeeded'), 120_000);
    await waitRebuild(w.svc, r.rebuildId, ['complete', 'failed']);
    const latest = listBuilds(w.p, EP)[0];
    const timing = w.p.db.prepare('SELECT snapshot_id, blob_hash FROM artifacts WHERE id=?').get(latest.timingId) as {blob_hash: string};
    const mixSnap = w.p.db.prepare('SELECT snapshot_id FROM artifacts WHERE id=?').get(latest.mixId) as {snapshot_id: string};
    const mixManifest = JSON.parse((w.p.db.prepare('SELECT manifest_json FROM snapshots WHERE id=?').get(mixSnap.snapshot_id) as {manifest_json: string}).manifest_json);
    assert.equal(mixManifest.blobs.timing, timing.blob_hash, 'the newest mix placed its accents on exactly this timing');
  });
});

describe('undoing an edit reuses everything that was built from those exact inputs', {timeout: 300_000}, () => {
  let u: FakeWorkspace;
  before(() => { u = fakeWorkspace(); });
  after(async () => { await u.close(); });

  test('nothing runs when the earlier text comes back; the earlier build is selected again', async () => {
    const first = u.svc.startRebuild(EP, {seq: getEpisodeInfo(u.p, EP).seq, requestId: requestId()});
    await waitRebuild(u.svc, first.rebuildId, ['complete', 'failed']);
    const original = currentRows(u.p, EP).map((r) => `${r.kind}:${r.subject}:${r.artifact_id}`).sort();
    const s3Original = readSegment(u.p, 's3');
    setCaptionOnly(u.p, 's3', 'Your text is cut into small pieces, called tokens.');
    const second = u.svc.startRebuild(EP, {seq: getEpisodeInfo(u.p, EP).seq, requestId: requestId()});
    await waitRebuild(u.svc, second.rebuildId, ['complete', 'failed']);
    assert.notDeepEqual(currentRows(u.p, EP).map((r) => `${r.kind}:${r.subject}:${r.artifact_id}`).sort(), original);
    const jobsBefore = u.svc.list(EP, 100).length;
    putSegmentBack(u.p, s3Original); // undo: the original caption again, exactly as it was
    const plan = u.svc.plan(EP);
    assert.deepEqual(plan.steps.map((x) => `${x.key}:${x.action}`), ['take:b1:current', 'take:b2:current', 'timing:reuse', 'mix:final:reuse', 'render:final:reuse']);
    assert.equal(plan.total.known + plan.total.unknown, 0, 'nothing to time: nothing runs');
    const third = u.svc.startRebuild(EP, {seq: getEpisodeInfo(u.p, EP).seq, requestId: requestId()});
    assert.deepEqual(third.jobIds, [], 'no job was needed');
    assert.deepEqual(third.reused, ['Timing and captions', 'Final audio mix', 'Final video']);
    assert.equal(u.svc.list(EP, 100).length, jobsBefore, 'no job was created');
    const s = statusReport(u.p, EP);
    assert.ok(s.timing.status === 'fresh' && s.mix.final.status === 'fresh' && s.render.final.status === 'fresh');
    assert.deepEqual(currentRows(u.p, EP).map((r) => `${r.kind}:${r.subject}:${r.artifact_id}`).sort(), original, 'the first build is current again, nothing was rebuilt or deleted');
  });
});
