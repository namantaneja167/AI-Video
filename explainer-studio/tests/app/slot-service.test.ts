// What the app shows about the machine-wide production slot (the slot and runner themselves are tested in tests/store/slot.test.ts).
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, test} from 'node:test';
import {ProductionSlot} from '../../core/slot.ts';
import {EP, fakeWorkspace, until, type FakeWorkspace} from './jobs-fixture.ts';

const cleanup: (() => Promise<void> | void)[] = [];
afterEach(async () => { for (const c of cleanup.splice(0)) await c(); });

test('the view says who holds the slot, a waiting heavy job says what it waits for, and cancelling it leaves the holder alone', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'studio-slot-app-'));
  cleanup.push(() => rmSync(dir, {recursive: true, force: true}));
  const w: FakeWorkspace = fakeWorkspace({slot: {slot: new ProductionSlot({dir}), project: 'Demo', projectRoot: '/tmp/this-project', pollMs: 40}});
  cleanup.push(() => w.close());
  assert.equal(w.svc.slotView().state, 'free');

  const other = new ProductionSlot({dir}).tryAcquire({project: 'Journey', projectRoot: '/tmp/other-project', job: 'Final video'});
  assert.ok(other.ok);
  const v = w.svc.slotView();
  assert.equal(v.state, 'other');
  assert.equal(v.holder?.project, 'Journey');
  assert.match(v.summary, /Journey is using the production slot \(Final video\)\. Heavy work here waits; editing and review are not affected\./);

  const id = w.svc.runner.enqueue({episodeId: EP, jobKind: 'timing.build'});
  await until('the job to be seen waiting for the slot', () => w.svc.slotView().waitingJobId === id);
  const job = w.svc.list(EP).find((j) => j.id === id)!;
  assert.equal(job.state, 'queued');
  assert.equal(job.displayStep, 'waiting for Journey to finish: Final video');
  assert.equal(w.svc.slotView().holder?.project, 'Journey');

  await w.svc.cancel(id);
  assert.equal(w.svc.list(EP).find((j) => j.id === id)!.state, 'cancelled');
  assert.equal(w.svc.slotView().state, 'other', 'cancelling this project\'s waiting job did not release or disturb the holder');
  other.release();
  assert.equal(w.svc.slotView().state, 'free');
});

test('without a slot the view says the one-at-a-time rule is this project only', async () => {
  const w = fakeWorkspace();
  cleanup.push(() => w.close());
  const v = w.svc.slotView();
  assert.equal(v.enabled, false);
  assert.equal(v.state, 'disabled');
});
