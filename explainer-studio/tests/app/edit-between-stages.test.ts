// What happens when the author edits while a rebuild is between its steps. The rule: a step is only ever started on the text the
// rebuild began with. If the saved text has changed by the time the next step is due, the rebuild pauses, says why, keeps what
// finished, and the author rebuilds to include the edit. A retried step runs on its own recorded inputs and is kept as an earlier
// build if the text has moved on. Nothing is silently run on new text.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {after, before, describe, test} from 'node:test';
import {listBuilds} from '../../app/builds.ts';
import {RebuildError} from '../../app/jobs.ts';
import {statusReport} from '../../core/artifacts.ts';
import {getEpisode, getEpisodeInfo} from '../../core/episodes.ts';
import {currentRows} from '../../core/state.ts';
import {EP, edit, fakeWorkspace, requestId, setCaptionOnly, setSpoken, until, waitRebuild, type FakeWorkspace} from './jobs-fixture.ts';

let w: FakeWorkspace;
const start = () => w.svc.startRebuild(EP, {seq: getEpisodeInfo(w.p, EP).seq, requestId: requestId()});
const jobsOf = (rid: string) => w.svc.list(EP, 100).filter((j) => j.rebuildId === rid).sort((a, b) => a.id - b.id);
const kinds = (rid: string) => jobsOf(rid).map((j) => (j.kind === 'tts.block' ? `${j.kind}:${j.subject}` : j.kind));
const rebuild = (rid: string) => w.svc.rebuilds(EP, 20).find((r) => r.id === rid)!;
const currentId = (kind: string, subject: string) => currentRows(w.p, EP).find((r) => r.kind === kind && r.subject === subject)?.artifact_id;
const fresh = () => { const s = statusReport(w.p, EP); return Object.values(s.takes).every((t) => t.status === 'fresh') && s.timing.status === 'fresh' && s.mix.final.status === 'fresh' && s.render.final.status === 'fresh'; };

before(async () => {
  w = fakeWorkspace();
  // one complete rebuild first, so the workspace holds a build made by this app
  const r = start();
  await waitRebuild(w.svc, r.rebuildId, ['complete', 'failed']);
});
after(async () => { await w.close(); });

describe('an edit between two steps of a rebuild', {timeout: 300_000}, () => {
  test('pauses the rebuild before the next step, starts nothing on the new text, keeps what finished, and says so', async () => {
    setSpoken(w.p, 's2', 'That limit is its whole context window.'); // narration of block b1 must run again
    const timingBefore = currentId('timing', 'timeline');
    const r = start();
    const narration = r.jobIds[0];
    // The edit lands as soon as the first step has finished and before the runner queues the second.
    void w.svc.runner.waitFor(narration).then(() => setCaptionOnly(w.p, 's5', 'The reply uses room too, as well.'));
    await waitRebuild(w.svc, r.rebuildId, ['paused']);

    const view = rebuild(r.rebuildId);
    assert.equal(view.pausedBecause, 'edited');
    assert.equal(view.canContinue, false, 'it cannot simply continue: that would run on text it did not begin with');
    assert.match(view.message, /you edited the episode after this rebuild started/);
    assert.match(view.message, /never swaps its inputs/);
    assert.match(view.message, /Finished and kept: Narration, block b1/);
    assert.deepEqual(kinds(r.rebuildId), ['tts.block:b1'], 'no later step was queued');
    assert.equal(jobsOf(r.rebuildId)[0].state, 'succeeded');
    assert.equal(w.svc.activeWork(EP), null, 'nothing is running');
    const events = w.p.db.prepare("SELECT data_json FROM job_events WHERE kind='rebuild-paused'").all() as {data_json: string}[];
    assert.ok(events.some((e) => /edited after the rebuild started/.test(e.data_json)), 'the pause is recorded in the job events, with its reason');

    await new Promise((res) => setTimeout(res, 1200)); // a pause is not a delay: nothing starts later either
    assert.deepEqual(kinds(r.rebuildId), ['tts.block:b1']);
    assert.equal(currentId('timing', 'timeline'), timingBefore, 'the timing was not rebuilt from either text');
    assert.throws(() => w.svc.continueRebuild(r.rebuildId), (e: unknown) => e instanceof RebuildError && e.code === 'changed', 'Continue is refused for the same reason');

    // The author rebuilds to include the edit: the finished narration is reused, nothing is generated twice.
    const plan = w.svc.plan(EP);
    assert.equal(plan.steps.find((s) => s.key === 'take:b1')?.action, 'current', 'the narration that finished is already the current take');
    const again = start();
    await waitRebuild(w.svc, again.rebuildId, ['complete', 'failed']);
    assert.equal(rebuild(again.rebuildId).state, 'complete', JSON.stringify(jobsOf(again.rebuildId).map((j) => [j.label, j.state, j.error])));
    assert.deepEqual(kinds(again.rebuildId), ['timing.build', 'mix.final', 'render.final']);
    assert.ok(fresh());
    assert.equal(getEpisode(w.p, EP).narration.segments.find((s) => s.id === 's5')!.text.includes('as well'), true);
    assert.ok(listBuilds(w.p, EP).some((b) => b.render), 'earlier builds are still there');
  });

  test('an edit that is undone before the next step is due does not pause it: the step runs on the text the rebuild began with', async () => {
    setCaptionOnly(w.p, 's3', 'Your text is cut into small pieces, called tokens.');
    const asStarted = getEpisode(w.p, EP);
    const r = start();
    const first = r.jobIds[0]; // timing: the caption edit needs no new narration
    void w.svc.runner.waitFor(first).then(() => {
      setCaptionOnly(w.p, 's4', 'Each token uses up some room, always.');
      edit(w.p, () => asStarted); // and back to exactly the text the rebuild began with
    });
    await waitRebuild(w.svc, r.rebuildId, ['complete', 'paused', 'failed']);
    assert.equal(rebuild(r.rebuildId).state, 'complete', `the saved text is identical to what the rebuild began with: ${JSON.stringify(jobsOf(r.rebuildId).map((j) => [j.label, j.state, j.error]))}`);
    assert.deepEqual(kinds(r.rebuildId), ['timing.build', 'mix.final', 'render.final']);
    assert.ok(fresh());
  });

  test('retrying a step after the text has moved on runs on that step\'s own recorded inputs, is kept as an earlier build, and does not continue the chain', async () => {
    setCaptionOnly(w.p, 's2', 'That limit is called its context window.');
    process.env.FAKE_RENDER_FAIL = 'the renderer ran out of something (test)';
    let rid = '';
    try {
      rid = start().rebuildId;
      await waitRebuild(w.svc, rid, ['failed']);
    } finally { delete process.env.FAKE_RENDER_FAIL; }
    const render = jobsOf(rid).find((j) => j.kind === 'render.final')!;
    assert.equal(render.state, 'failed');
    const specCopy = join(w.tmp, 'render-spec-retry.json');
    const movedOn = 'That limit is named its context window.';
    setCaptionOnly(w.p, 's2', movedOn); // the author keeps editing while the failed step waits
    process.env.FAKE_RENDER_SPEC_COPY = specCopy;
    try {
      w.svc.retry(render.id);
      await until('the retried step to finish', () => { const j = w.svc.list(EP, 100).find((x) => x.id === render.id)!; return ['succeeded', 'outdated', 'failed'].includes(j.state) ? j.state : undefined; }, 120_000);
    } finally { delete process.env.FAKE_RENDER_SPEC_COPY; }
    const done = w.svc.list(EP, 100).find((x) => x.id === render.id)!;
    assert.equal(done.state, 'outdated', 'its result is not the current text, so it is not current');
    assert.match(done.note ?? '', /earlier build/);
    const spec = JSON.parse(readFileSync(specCopy, 'utf8'));
    const cap = spec.inputProps.data.timeline.captions.map((c: any) => c.text ?? c.words?.map((x: any) => x.text).join(' ')).join(' | ');
    assert.doesNotMatch(cap, /named/, 'the video was drawn from the text recorded when the step was queued, not the newer text');
    assert.notEqual(statusReport(w.p, EP).render.final.status, 'fresh');
    assert.equal(rebuild(rid).state, 'stopped');
    assert.equal(jobsOf(rid).length, 3, 'no further step was added');
    await new Promise((res) => setTimeout(res, 800));
    assert.equal(jobsOf(rid).length, 3);
    // rebuilding includes the newer edit
    const again = start();
    await waitRebuild(w.svc, again.rebuildId, ['complete', 'failed']);
    assert.ok(fresh());
  });
});
