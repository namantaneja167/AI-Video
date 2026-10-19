// The idle shutdown of the audio worker must not race a job that starts while it runs: the job gets a fresh worker, runs once
// (no automatic retry), and nothing the shutdown does signals the new worker. (This is what failed in the demo workspace.)
import assert from 'node:assert/strict';
import {after, before, describe, test} from 'node:test';
import {all} from '../../core/db.ts';
import {EP, fakeWorkspace, type FakeWorkspace} from './jobs-fixture.ts';

let w: FakeWorkspace;
before(() => {
  w = fakeWorkspace({
    idleShutdownMs: 60_000, // the timer never fires during the test; the test triggers the idle check itself
    host: {rssThresholdBytes: 800 * 2 ** 20, killGraceMs: 600, env: {FAKE_SLOW_EXIT: '0.8', FAKE_RESOURCE_TRACKER: '1'}},
  });
});
after(async () => { await w.close(); });

describe('idle shutdown and a new lease', {timeout: 120_000}, () => {
  test('a job that starts while the idle worker is being shut down gets a fresh worker and runs once, and no signal reaches that worker', async () => {
    const run = (block: string) => w.svc.runner.enqueue({episodeId: EP, jobKind: 'tts.block', subject: block});
    const first = await w.svc.runner.waitFor(run('b1'));
    assert.equal(first.state, 'succeeded');
    const host = w.svc.host;
    const old = host.worker!;
    assert.ok(old && !old.exited, 'the worker is idle but alive');

    const stopping = w.svc.checkIdle(0); // the idle shutdown begins (the worker takes 0.8 s to exit)
    const id = run('b2'); // and a job arrives while it is winding down
    const second = await w.svc.runner.waitFor(id);
    await stopping;

    assert.equal(second.state, 'succeeded');
    assert.equal(second.attempts, 1, 'it ran once: no worker died under it, so no automatic retry');
    const events = all<{kind: string}>(w.p.db.prepare('SELECT kind FROM job_events WHERE job_id=?'), id).map((e) => e.kind);
    assert.equal(events.includes('auto-retry'), false);
    const fresh = host.worker!;
    assert.ok(fresh && fresh !== old, 'the job was given a new worker');
    assert.equal(old.exited, true, 'the old one is gone');
    assert.equal(fresh.exited, false, 'the new one is alive after the shutdown finished');
    const sent = host.reg.signals;
    assert.equal(sent.some((s) => s.pid === fresh.pid || s.owner === fresh.owner), false, 'nothing was sent to the new worker');
    for (const s of sent.filter((x) => x.pid === old.pid)) assert.equal(s.owner, old.owner, 'every signal to the old worker names its generation');
  });
});
