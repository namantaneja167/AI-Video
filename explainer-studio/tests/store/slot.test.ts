// The machine-wide production slot: one heavy job at a time across every app instance and project. Controlled workers and plain
// child processes only (no model, render or real job).
import assert from 'node:assert/strict';
import {spawn, type ChildProcess} from 'node:child_process';
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, describe, test} from 'node:test';
import {DatabaseSync} from 'node:sqlite';
import {putBytes} from '../../core/blobs.ts';
import {adoptEpisode, getEpisode, saveEpisode} from '../../core/episodes.ts';
import {Project} from '../../core/project.ts';
import {JobRunner, type JobHandler} from '../../core/runner.ts';
import {ProductionSlot, SLOT_SCHEMA, type SlotHolder} from '../../core/slot.ts';
import {newProject, setAllComponents, type TestProject} from './helpers.ts';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(cond: () => boolean, ms = 8000, what = 'condition') {
  const t0 = Date.now();
  while (!cond()) { if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${what}`); await sleep(25); }
}
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };

const dirs: string[] = [];
const children: ChildProcess[] = [];
const spawnedPids: number[] = [];
const decoys: ChildProcess[] = [];
const projects: TestProject[] = [];
const runners: JobRunner[] = [];
const slots: ProductionSlot[] = [];
const slotDir = () => { const d = mkdtempSync(join(tmpdir(), 'studio-slot-test-')); dirs.push(d); return d; };
const mkSlot = (dir: string, o: ConstructorParameters<typeof ProductionSlot>[0] = {}) => { const s = new ProductionSlot({dir, ...o}); slots.push(s); return s; };
afterEach(() => {
  for (const r of runners.splice(0)) r.stop();
  // only processes this test started
  for (const c of children.splice(0)) { try { c.kill('SIGKILL'); } catch { /* gone */ } }
  for (const pid of spawnedPids.splice(0)) { try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ } }
  for (const d of decoys.splice(0)) { try { d.kill('SIGKILL'); } catch { /* gone */ } }
  for (const s of slots.splice(0)) s.close();
  for (const t of projects.splice(0)) { try { t.close(); } catch { /* closed */ } }
  for (const d of dirs.splice(0)) rmSync(d, {recursive: true, force: true});
});

function child(args: string[], ready = /READY (.*)\n/): Promise<{proc: ChildProcess; info: string}> {
  const proc = spawn(process.execPath, [join(import.meta.dirname, 'slot-child.ts'), ...args], {stdio: ['ignore', 'pipe', 'inherit']});
  children.push(proc);
  return new Promise((res, rej) => {
    let buf = '';
    proc.stdout!.on('data', (d: Buffer) => { buf += d; const m = ready.exec(buf); if (m) res({proc, info: m[1]}); });
    proc.on('exit', () => rej(new Error(`child exited early: ${buf}`)));
  });
}
const exited = (c: ChildProcess) => new Promise<void>((r) => { if (c.exitCode !== null || c.signalCode !== null) r(); else c.on('exit', () => r()); });
const claim = (project: string) => ({project, projectRoot: `/tmp/no-such-project-${project}`, job: 'Final video'});
const DEAD_PID = 2_147_483_000; // no such process
/** Write a claim straight into the slot database, as a holder that has since died would have left it. */
function seedClaim(dir: string, h: Partial<SlotHolder> & {project: string}) {
  const db = new DatabaseSync(join(dir, 'production-slot.sqlite'));
  db.exec(SLOT_SCHEMA);
  db.prepare('INSERT INTO claim(id, token, pid, started, project, project_root, job, since) VALUES(1, ?, ?, ?, ?, ?, ?, ?)')
    .run(h.token ?? 'seeded', h.pid ?? DEAD_PID, h.started ?? 'Mon Jan  1 00:00:00 1990', h.project, h.projectRoot ?? `/tmp/no-such-project-${h.project}`, h.job ?? 'Final video', 1);
  db.close();
}
const heldBy = (dir: string) => { const s = mkSlot(dir).read(); return s.state === 'held' ? s.holder : null; };

describe('the slot itself', () => {
  test('only one claim at a time; the second is told who holds it; release hands it over', () => {
    const dir = slotDir();
    const a = mkSlot(dir);
    const b = mkSlot(dir);
    const first = a.tryAcquire(claim('Journey'));
    assert.ok(first.ok);
    const second = b.tryAcquire(claim('Demo'));
    assert.ok(!second.ok);
    assert.equal(second.holder?.project, 'Journey');
    assert.equal(second.holder?.job, 'Final video');
    assert.match(second.why, /Journey is using the production slot/);
    first.release();
    const third = b.tryAcquire(claim('Demo'));
    assert.ok(third.ok);
    third.release();
    assert.deepEqual(b.read(), {state: 'free', stale: null});
  });

  test('a delayed old unlock after ownership changed removes nothing: the new owner keeps the slot', () => {
    const dir = slotDir();
    const a = mkSlot(dir); // the old owner
    const first = a.tryAcquire(claim('Old'));
    assert.ok(first.ok);
    // the old owner's app dies without releasing (its pid no longer exists) and has no recorded workers
    const db = new DatabaseSync(join(dir, 'production-slot.sqlite'));
    db.prepare('UPDATE claim SET pid = ?, started = ? WHERE token = ?').run(DEAD_PID, 'Mon Jan  1 00:00:00 1990', first.holder.token);
    db.close();
    const b = mkSlot(dir);
    assert.equal(b.read().state, 'free');
    const second = b.tryAcquire(claim('New'));
    assert.ok(second.ok, 'the stale claim was replaced');
    first.release(); // the old unlock arrives late
    first.release(); // and again
    a.releaseAll();
    const now = heldBy(dir);
    assert.equal(now?.project, 'New');
    assert.equal(now?.token, second.holder.token);
    second.release();
    assert.deepEqual(mkSlot(dir).read(), {state: 'free', stale: null});
  });

  test('simultaneous recovery of one stale claim (deterministic): a second recoverer cannot act inside the first one\'s recovery and cannot remove its replacement', () => {
    const dir = slotDir();
    seedClaim(dir, {project: 'Crashed'});
    let inside: ReturnType<ProductionSlot['tryAcquire']> | undefined;
    let b!: ProductionSlot;
    const a = mkSlot(dir, {hooks: {afterStaleJudged: () => { inside = b.tryAcquire(claim('Second')); }}});
    b = mkSlot(dir, {busyMs: 30});
    const first = a.tryAcquire(claim('First'));
    assert.ok(first.ok, 'the first recoverer replaced the stale claim');
    assert.ok(inside && !inside.ok && /claiming the slot at this moment/.test(inside.why), 'the second recoverer was held out while the first was mid-recovery');
    const after = b.tryAcquire(claim('Second'));
    assert.ok(!after.ok && after.holder?.token === first.holder.token, 'afterwards the second sees the first\'s fresh claim');
    assert.equal(heldBy(dir)?.project, 'First', 'the replacement was not deleted');
    first.release();
  });

  test('simultaneous recovery by eight processes: exactly one wins and its claim stands', async () => {
    const dir = slotDir();
    seedClaim(dir, {project: 'Crashed'});
    const go = join(dir, 'go');
    const racers = await Promise.all(Array.from({length: 8}, (_, i) => {
      const proc = spawn(process.execPath, [join(import.meta.dirname, 'slot-child.ts'), 'race', dir, `Racer${i}`, go], {stdio: ['ignore', 'pipe', 'inherit']});
      children.push(proc);
      return new Promise<{proc: ChildProcess; line: Promise<string>}>((res) => {
        let buf = '';
        const line = new Promise<string>((l) => { proc.stdout!.on('data', (d: Buffer) => { buf += d; const m = /(WON|LOST) (.*)\n/.exec(buf); if (m) l(`${m[1]} ${m[2]}`); }); });
        res({proc, line});
      });
    }));
    await sleep(600); // every racer is spinning on the start file
    writeFileSync(go, 'go');
    const results = await Promise.all(racers.map((r) => r.line));
    const won = results.filter((r) => r.startsWith('WON'));
    assert.equal(won.length, 1, `exactly one winner, got ${JSON.stringify(results)}`);
    assert.equal(results.filter((r) => r.startsWith('LOST')).length, 7);
    const winnerPid = Number(won[0].split(' ')[1]);
    const h = heldBy(dir);
    assert.equal(h?.pid, winnerPid, 'the standing claim belongs to the winner');
    assert.ok(alive(winnerPid));
  });

  test('an owner that was killed (kill -9, no cleanup) is recovered: its slot is free and taken over', async () => {
    const dir = slotDir();
    const {proc, info} = await child(['claim', dir, 'Crashing']);
    const slot = mkSlot(dir);
    assert.equal(slot.read().state, 'held');
    assert.ok(!slot.tryAcquire(claim('Waiting')).ok, 'a live owner keeps it');
    proc.kill('SIGKILL');
    await exited(proc);
    const gone = slot.read();
    assert.equal(gone.state, 'free');
    assert.equal(gone.state === 'free' && gone.stale?.project, 'Crashing');
    const got = slot.tryAcquire(claim('Waiting'));
    assert.ok(got.ok, 'taken over once the owner is confirmed gone');
    assert.equal(alive(Number(info)), false);
    got.release();
  });

  test('a record whose pid now belongs to a different process (pid reuse) is stale', () => {
    const dir = slotDir();
    seedClaim(dir, {project: 'Old', pid: process.pid, started: 'Mon Jan  1 00:00:00 1990'});
    const slot = mkSlot(dir);
    assert.equal(slot.read().state, 'free');
    const got = slot.tryAcquire(claim('New'));
    assert.ok(got.ok);
    got.release();
  });

  test('anything that cannot be inspected never lets a second job in', () => {
    const dir = slotDir();
    const first = mkSlot(dir).tryAcquire(claim('Holder'));
    assert.ok(first.ok);
    const blind = mkSlot(dir, {probe: () => ({state: 'alive', started: null, reason: 'process inspection unavailable (blocked)'})});
    const r = blind.tryAcquire(claim('Other'));
    assert.ok(!r.ok && r.unknown);
    assert.equal(blind.read().state, 'unknown');
    first.release();

    seedClaim(dir, {project: 'Gone-app'}); // app confirmed gone, but its project's workers cannot be read
    const noRecords = mkSlot(dir, {workers: () => ({unknown: 'the registry is unreadable'})});
    const r2 = noRecords.tryAcquire(claim('Other'));
    assert.ok(!r2.ok && r2.unknown && /cannot be checked/.test(r2.why));
    assert.equal(heldBy(dir)?.project ?? 'still-there', 'still-there', 'the claim was left alone');
    assert.equal(new DatabaseSync(join(dir, 'production-slot.sqlite')).prepare('SELECT project FROM claim').get()?.project, 'Gone-app');
  });

  test('an unreadable slot database is "unknown" and is left untouched', () => {
    const dir = slotDir();
    writeFileSync(join(dir, 'production-slot.sqlite'), 'this is not a database');
    const slot = mkSlot(dir);
    assert.equal(slot.read().state, 'unknown');
    const r = slot.tryAcquire(claim('Other'));
    assert.ok(!r.ok && r.unknown);
    assert.equal(readFileSync(join(dir, 'production-slot.sqlite'), 'utf8'), 'this is not a database');
  });

  test('a process killed in the middle of its exclusive transaction frees the lock by itself: no recovery step, no stale lock', async () => {
    const dir = slotDir();
    mkSlot(dir).read(); // creates the database
    const {proc} = await child(['lockdb', dir]);
    const waiting = mkSlot(dir, {busyMs: 100});
    const t0 = Date.now();
    const r = waiting.tryAcquire(claim('Blocked'));
    assert.ok(!r.ok && !r.unknown && /claiming the slot at this moment/.test(r.why));
    assert.ok(Date.now() - t0 < 1500, 'the refusal is prompt');
    assert.equal(waiting.read().state, 'free', 'reading is not blocked by the other transaction');
    proc.kill('SIGKILL');
    await exited(proc);
    const got = waiting.tryAcquire(claim('Blocked'));
    assert.ok(got.ok, 'the operating system released the dead process\'s lock');
    got.release();
  });

  test('waiting never signals the owner: a live owner in another process is untouched however long we wait', async () => {
    const dir = slotDir();
    const {proc, info} = await child(['claim', dir, 'Busy']);
    const slot = mkSlot(dir);
    for (let i = 0; i < 20; i++) { assert.ok(!slot.tryAcquire(claim('Waiting')).ok); await sleep(10); }
    assert.ok(alive(Number(info)));
    assert.equal(proc.exitCode, null);
    assert.equal(proc.signalCode, null);
    const src = readFileSync(join(import.meta.dirname, '../../core/slot.ts'), 'utf8').replace(/^\s*\/\/.*$/gm, '');
    assert.doesNotMatch(src, /\.kill\(|killOwned|SIGTERM|SIGKILL|unlinkSync|rmSync/, 'the slot has no way to signal a process and no lock file to remove');
  });
});

describe('the job runner with the slot (controlled handlers)', () => {
  function project(): TestProject {
    const t = newProject();
    adoptEpisode(t.p, 'episodes/join-fanout/episode.json');
    setAllComponents(t.p, t.root);
    projects.push(t);
    return t;
  }
  function runnerFor(t: TestProject, name: string, dir: string, handler: JobHandler) {
    const r = new JobRunner(t.p, {pollMs: 80, killGraceMs: 400, slot: {slot: mkSlot(dir), project: name, projectRoot: t.root, pollMs: 40}, handlers: {'timing.build': handler, 'mix.draft': handler, 'tts.block': handler}});
    runners.push(r);
    return r;
  }
  const holderNow = (dir: string) => heldBy(dir)?.project ?? null;
  const decoy = () => { const d = spawn('sleep', ['300'], {stdio: 'ignore'}); decoys.push(d); return d; };
  const quick: JobHandler = async (ctx) => ({blobHash: putBytes(ctx.p, `q${ctx.kind}${ctx.jobId}`).hash});

  test('two projects never run heavy jobs at the same time, and both finish', async () => {
    const dir = slotDir();
    let now = 0; let peak = 0; let total = 0;
    const work: JobHandler = async (ctx) => { now++; total++; peak = Math.max(peak, now); await sleep(150); now--; return {blobHash: putBytes(ctx.p, `w${ctx.jobId}${Math.random()}`).hash}; };
    const a = runnerFor(project(), 'Journey', dir, work);
    const b = runnerFor(project(), 'Demo', dir, work);
    const ids = [a.enqueue({episodeId: 'join-fanout', jobKind: 'timing.build'}), b.enqueue({episodeId: 'join-fanout', jobKind: 'timing.build'})];
    const done = await Promise.all([a.waitFor(ids[0]), b.waitFor(ids[1])]);
    assert.deepEqual(done.map((j) => j.state), ['succeeded', 'succeeded']);
    assert.equal(total, 2);
    assert.equal(peak, 1, 'never two heavy jobs at once');
    assert.equal(holderNow(dir), null, 'the slot was released');
  });

  test('a waiting request shows who holds the slot, can be cancelled on its own, and leaves the owner untouched', async () => {
    const dir = slotDir();
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    let ownerAborted = false;
    const a = runnerFor(project(), 'Journey', dir, async (ctx) => { ctx.signal.addEventListener('abort', () => { ownerAborted = true; }); await gate; return {blobHash: putBytes(ctx.p, 'a').hash}; });
    const bt = project();
    const b = runnerFor(bt, 'Demo', dir, async () => { throw new Error('must never run'); });
    const aId = a.enqueue({episodeId: 'join-fanout', jobKind: 'timing.build'});
    await until(() => a.row(aId).state === 'running');
    const bId = b.enqueue({episodeId: 'join-fanout', jobKind: 'timing.build'});
    await until(() => b.slotWaiting()?.jobId === bId);
    assert.equal(b.slotWaiting()!.holder?.project, 'Journey');
    assert.equal(b.row(bId).state, 'queued');
    const ev = bt.p.db.prepare("SELECT data_json FROM job_events WHERE job_id=? AND kind='waiting-for-slot'").all(bId);
    assert.equal(ev.length, 1, 'recorded once, not on every look');
    assert.equal((JSON.parse(ev[0].data_json as string) as {holder: {project: string}}).holder.project, 'Journey');
    const cancelled = await b.cancel(bId);
    assert.equal(cancelled.state, 'cancelled');
    assert.equal(b.slotWaiting(), null);
    assert.equal(holderNow(dir), 'Journey', 'the owner still holds it');
    assert.equal(a.row(aId).state, 'running');
    assert.equal(ownerAborted, false);
    release();
    assert.equal((await a.waitFor(aId)).state, 'succeeded');
    assert.equal(holderNow(dir), null);
  });

  test('light jobs and editing are not held up by a heavy job waiting for the slot', async () => {
    const dir = slotDir();
    const held = mkSlot(dir).tryAcquire(claim('Elsewhere'));
    assert.ok(held.ok);
    const ran: string[] = [];
    const bt = project();
    const b = runnerFor(bt, 'Demo', dir, async (ctx) => { ran.push(ctx.kind); return {blobHash: putBytes(ctx.p, `x${ctx.kind}${ctx.jobId}`).hash}; });
    const heavy = b.enqueue({episodeId: 'join-fanout', jobKind: 'timing.build'});
    const light = b.enqueue({episodeId: 'join-fanout', jobKind: 'mix.draft', lane: 'light'});
    assert.equal((await b.waitFor(light)).state, 'succeeded');
    assert.deepEqual(ran, ['mix.draft']);
    assert.equal(b.row(heavy).state, 'queued');
    held.release(); // then the waiting job starts by itself
    assert.equal((await b.waitFor(heavy)).state, 'succeeded');
    assert.deepEqual(ran, ['mix.draft', 'timing.build']);
  });

  for (const how of ['succeeds', 'fails', 'is cancelled'] as const) {
    test(`the slot is released when the job ${how}, and the next waiting project proceeds`, async () => {
      const dir = slotDir();
      let release!: () => void;
      const gate = new Promise<void>((r) => { release = r; });
      const a = runnerFor(project(), 'Journey', dir, async (ctx) => {
        if (how === 'is cancelled') await new Promise(() => {}); // aborted by cancel
        await gate;
        if (how === 'fails') throw new Error('controlled failure');
        return {blobHash: putBytes(ctx.p, 'ok').hash};
      });
      const b = runnerFor(project(), 'Demo', dir, async (ctx) => ({blobHash: putBytes(ctx.p, 'b').hash}));
      const aId = a.enqueue({episodeId: 'join-fanout', jobKind: 'timing.build'});
      await until(() => holderNow(dir) === 'Journey');
      const bId = b.enqueue({episodeId: 'join-fanout', jobKind: 'timing.build'});
      await until(() => b.slotWaiting()?.jobId === bId);
      if (how === 'is cancelled') await a.cancel(aId); else release();
      const aDone = await a.waitFor(aId);
      assert.equal(aDone.state, how === 'succeeds' ? 'succeeded' : how === 'fails' ? 'failed' : 'cancelled');
      assert.equal((await b.waitFor(bId)).state, 'succeeded');
      await until(() => holderNow(dir) === null);
    });
  }

  test('shutting the runner down releases the slot even while a job is still running', async () => {
    const dir = slotDir();
    const a = runnerFor(project(), 'Journey', dir, async () => { await new Promise(() => {}); return {blobHash: ''}; });
    const id = a.enqueue({episodeId: 'join-fanout', jobKind: 'timing.build'});
    await until(() => holderNow(dir) === 'Journey');
    await a.shutdown();
    assert.equal(holderNow(dir), null);
    await a.cancel(id); // end the controlled handler so the test leaves nothing running
  });

  test('the owner app crashes (kill -9) with no worker running: the other project then runs by itself', async () => {
    const dir = slotDir();
    const mine = mkSlot(dir);
    const {proc} = await child(['claim', dir, 'Crashing project']);
    const bt = project();
    const ran: number[] = [];
    const b = runnerFor(bt, 'Demo', dir, async (ctx) => { ran.push(ctx.jobId); return {blobHash: putBytes(ctx.p, 'b').hash}; });
    const id = b.enqueue({episodeId: 'join-fanout', jobKind: 'timing.build'});
    await until(() => b.slotWaiting()?.jobId === id);
    assert.equal(b.slotWaiting()!.holder?.project, 'Crashing project');
    await sleep(300);
    assert.deepEqual(ran, [], 'still waiting while the owner is alive');
    proc.kill('SIGKILL');
    await exited(proc);
    assert.equal((await b.waitFor(id)).state, 'succeeded');
    assert.deepEqual(ran, [id]);
    await until(() => holderNow(dir) === null);
    assert.equal(mine.read().state, 'free');
  });

  describe('app death while its heavy worker survives', () => {
    /** Project A's app runs a heavy job whose worker is a recorded owned process, then dies without cleanup. */
    async function appDiedWorkerAlive(dir: string) {
      const a = newProject();
      adoptEpisode(a.p, 'episodes/join-fanout/episode.json');
      setAllComponents(a.p, a.root);
      a.p.close();
      projects.push(a);
      const {proc, info} = await child(['runner', dir, a.root, 'Project A'], /READY (\{.*\})\n/);
      const {pids, app} = JSON.parse(info) as {pids: number[]; app: number};
      spawnedPids.push(...pids);
      assert.ok(pids.length >= 3);
      proc.kill('SIGKILL');
      await exited(proc);
      assert.equal(alive(app), false, 'the app is gone');
      assert.ok(pids.every(alive), 'its worker and the worker\'s helpers are still running');
      return {a, pids};
    }

    test('the other project does not start heavy work merely because the app pid is gone; light work and editing continue; nothing unrelated is touched', {skip: process.platform === 'win32'}, async () => {
      const dir = slotDir();
      const unrelated = decoy();
      const {pids} = await appDiedWorkerAlive(dir);
      const bt = project();
      const ran: string[] = [];
      const b = runnerFor(bt, 'Project B', dir, async (ctx) => { ran.push(ctx.kind); return {blobHash: putBytes(ctx.p, `r${ctx.kind}${ctx.jobId}`).hash}; });
      const heavy = b.enqueue({episodeId: 'join-fanout', jobKind: 'timing.build'});
      await until(() => b.slotWaiting()?.jobId === heavy);
      const w = b.slotWaiting()!;
      assert.equal(w.holder?.project, 'Project A');
      assert.ok(w.orphans >= 1, 'it is waiting on the surviving worker, and says so');
      const view = mkSlot(dir).read();
      assert.ok(view.state === 'held' && view.orphans.length >= 1);

      // editing and light work stay available while heavy work is blocked
      const light = b.enqueue({episodeId: 'join-fanout', jobKind: 'mix.draft', lane: 'light'});
      assert.equal((await b.waitFor(light)).state, 'succeeded');
      const doc = structuredClone(getEpisode(bt.p, 'join-fanout'));
      doc.title = 'edited while blocked';
      saveEpisode(bt.p, 'join-fanout', doc);
      assert.equal(getEpisode(bt.p, 'join-fanout').title, 'edited while blocked');

      await sleep(500);
      assert.equal(b.row(heavy).state, 'queued', 'still not started');
      assert.deepEqual(ran, ['mix.draft']);
      assert.ok(pids.every(alive), 'the worker was not signalled by the project that is waiting');
      assert.ok(alive(unrelated.pid!));
    });

    test('recovery after the owned worker has exited: the claim is stale and the other project proceeds', async () => {
      const dir = slotDir();
      const unrelated = decoy();
      const {pids} = await appDiedWorkerAlive(dir);
      const bt = project();
      const b = runnerFor(bt, 'Project B', dir, quick);
      const id = b.enqueue({episodeId: 'join-fanout', jobKind: 'timing.build'});
      await until(() => (b.slotWaiting()?.orphans ?? 0) >= 1);
      for (const pid of pids) { try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ } } // the controlled worker ends (ours: this test started it)
      await until(() => pids.every((p) => !alive(p)), 4000, 'the worker to end');
      assert.equal((await b.waitFor(id)).state, 'succeeded');
      await until(() => holderNow(dir) === null);
      assert.ok(alive(unrelated.pid!));
    });

    test('recovery through the existing mechanism: opening the dead app\'s project again stops its recorded leftovers (and only those), which frees the slot', async () => {
      const dir = slotDir();
      const unrelated = decoy();
      const {a, pids} = await appDiedWorkerAlive(dir);
      const bt = project();
      const b = runnerFor(bt, 'Project B', dir, quick);
      const id = b.enqueue({episodeId: 'join-fanout', jobKind: 'timing.build'});
      await until(() => (b.slotWaiting()?.orphans ?? 0) >= 1);
      const reopened = Project.open(a.root); // project recovery: identity-checked reaping of what this project recorded
      assert.ok(pids.some((p) => reopened.recovery.reapedProcesses.includes(p)), 'recovery stopped the recorded worker');
      reopened.close();
      assert.equal((await b.waitFor(id)).state, 'succeeded');
      assert.ok(pids.every((p) => !alive(p)));
      assert.ok(alive(unrelated.pid!), 'an unrelated process was not touched');
      await until(() => holderNow(dir) === null);
    });
  });

  test('while acquisition is blocked by another process\'s transaction, heavy work waits, light work, editing and the page keep going, and it proceeds by itself when that process dies', async () => {
    const dir = slotDir();
    mkSlot(dir).read();
    const {proc} = await child(['lockdb', dir]);
    const bt = project();
    const ran: string[] = [];
    const b = runnerFor(bt, 'Demo', dir, async (ctx) => { ran.push(ctx.kind); return {blobHash: putBytes(ctx.p, `l${ctx.kind}${ctx.jobId}`).hash}; });
    let worst = 0; let last = Date.now();
    const ticker = setInterval(() => { const n = Date.now(); worst = Math.max(worst, n - last); last = n; }, 20);
    try {
      const heavy = b.enqueue({episodeId: 'join-fanout', jobKind: 'timing.build'});
      const light = b.enqueue({episodeId: 'join-fanout', jobKind: 'mix.draft', lane: 'light'});
      assert.equal((await b.waitFor(light)).state, 'succeeded');
      const doc = structuredClone(getEpisode(bt.p, 'join-fanout'));
      doc.title = 'edited while acquisition is blocked';
      saveEpisode(bt.p, 'join-fanout', doc);
      await sleep(600);
      assert.equal(b.row(heavy).state, 'queued');
      assert.ok(worst < 800, `the event loop stayed responsive (longest gap ${worst} ms)`);
      assert.equal(mkSlot(dir).read().state, 'free', 'the page can still read the slot');
      proc.kill('SIGKILL');
      await exited(proc);
      assert.equal((await b.waitFor(heavy)).state, 'succeeded');
      assert.deepEqual(ran, ['mix.draft', 'timing.build']);
    } finally { clearInterval(ticker); }
  });
});
