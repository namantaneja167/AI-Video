// Regression tests for the worker SIGKILL found in the demo workspace (job 11, attempt 6): a finished job's cleanup chased the
// worker's helper child for seconds, the idle shutdown then overlapped the next job, and the shutdown's owner-wide kill
// reached the NEW worker. Each test below fails on the code as it was and passes on the fix.
import assert from 'node:assert/strict';
import {execFileSync, spawn, type ChildProcess} from 'node:child_process';
import {join} from 'node:path';
import {afterEach, describe, test} from 'node:test';
import {putBytes} from '../../core/blobs.ts';
import {adoptEpisode, getEpisode} from '../../core/episodes.ts';
import {descendantsOf, killOwned, OwnerRegistry, snapshotProcs} from '../../core/proc.ts';
import {JobRunner, type JobHandler} from '../../core/runner.ts';
import {ModelHost, WorkerCrashError} from '../../core/worker.ts';
import {newProject, setAllComponents, type TestProject} from './helpers.ts';

const py = process.env.PYTHON ?? 'python3';
const FAKE = join(process.cwd(), 'tests/store/fake-worker.py');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const stat = (pid: number): string => { try { return execFileSync('ps', ['-o', 'stat=', '-p', String(pid)], {encoding: 'utf8'}).trim(); } catch { return ''; } };
const runningNotZombie = (pid: number) => { const s = stat(pid); return s !== '' && !s.startsWith('Z'); };

let t: TestProject | undefined;
const hosts: ModelHost[] = [];
const runners: JobRunner[] = [];
const loose: ChildProcess[] = [];
afterEach(async () => {
  for (const r of runners.splice(0)) r.stop();
  for (const h of hosts.splice(0)) await h.shutdown().catch(() => {});
  for (const c of loose.splice(0)) { try { process.kill(-c.pid!, 'SIGKILL'); } catch { c.kill('SIGKILL'); } }
  t?.close();
  t = undefined;
});

function fixture(env: NodeJS.ProcessEnv = {}, killGraceMs = 400) {
  t = newProject();
  adoptEpisode(t.p, 'episodes/join-fanout/episode.json');
  setAllComponents(t.p, t.root);
  const reg = new OwnerRegistry(t.p.db, t.p.now);
  const host = new ModelHost(reg, {cmd: py, args: [FAKE], env, killGraceMs});
  hosts.push(host);
  return {reg, host};
}
const quick: JobHandler = async (ctx) => ({blobHash: putBytes(ctx.p, `${ctx.kind}:${ctx.jobId}`).hash});

describe('stopping one audio worker never reaches another', () => {
  test('a stale handle stopping late does not kill the worker that replaced it', async () => {
    const {host} = fixture();
    const w1 = host.ensureWorker();
    await host.request('status');
    await host.shutdown();
    assert.equal(w1.exited, true);
    const w2 = host.ensureWorker();
    await host.request('status');
    assert.notEqual(w2.owner, w1.owner, 'each worker has its own owner, so one kill cannot reach the other');
    await w1.terminate(300, 'late cleanup of the old worker');
    await sleep(300);
    assert.equal(w2.exited, false, 'the new worker is still running');
    assert.ok(alive(w2.pid!));
  });

  test('a shutdown in progress does not hand the old worker to the next job, and does not stop its replacement', async () => {
    const {host} = fixture({FAKE_SLOW_EXIT: '0.7'});
    const w1 = host.ensureWorker();
    await host.request('status');
    const shuttingDown = host.shutdown();
    const w2 = host.ensureWorker(); // a job starting right now
    assert.notEqual(w2, w1, 'a worker that is being shut down is not given to a new job');
    await host.request('status');
    await host.ensureModel('tts');
    assert.equal(w1.exited, true, 'a model is not loaded while the previous worker is still winding down: one model in memory at a time');
    await shuttingDown;
    await sleep(2000); // longer than the kill grace
    assert.equal(w2.exited, false, 'the replacement survived the old worker\'s shutdown');
    assert.equal(host.worker, w2, 'the host still refers to the replacement');
  });
});

describe('a helper that cannot be killed does not hold things up', () => {
  test('killOwned does not wait on a zombie (a killed child whose parent has not collected it)', async () => {
    t = newProject();
    const reg = new OwnerRegistry(t.p.db, t.p.now);
    const parent = spawn(py, ['-c', 'import subprocess,sys,time\nc=subprocess.Popen(["python3","-c","import signal,time;signal.signal(signal.SIGTERM,signal.SIG_IGN);time.sleep(300)"])\nprint(c.pid,flush=True)\ntime.sleep(300)'], {stdio: ['ignore', 'pipe', 'ignore'], detached: true});
    loose.push(parent);
    const childPid = Number(await new Promise<string>((res) => parent.stdout!.once('data', (d: Buffer) => res(String(d).trim()))));
    const info = snapshotProcs().get(childPid)!;
    reg.record('zombie-test', childPid, info.start, 'descendant'); // the owner owns only the child; its parent keeps running
    const t0 = Date.now();
    const r = await killOwned(reg, 'zombie-test', {graceMs: 300});
    assert.equal(r.confirmed, true);
    assert.ok(Date.now() - t0 < 3500, `stopping took ${Date.now() - t0} ms; a zombie was waited on`);
    assert.equal(stat(childPid).startsWith('Z') || stat(childPid) === '', true, 'the child is dead');
    assert.ok(alive(parent.pid!), 'its parent was not touched');
  });

  test('a finished job leaves the worker (and its helper child) running and settles promptly', async () => {
    const {reg, host} = fixture({FAKE_RESOURCE_TRACKER: '1'}, 500);
    let workerPid = 0;
    let helper = 0;
    const r = new JobRunner(t!.p, {pollMs: 80, host, reg, killGraceMs: 500, handlers: {'tts.block': async (ctx) => {
      ctx.host!.ensureWorker();
      ctx.leaseHost();
      workerPid = ctx.host!.worker!.pid!;
      await sleep(500); // long enough for the sampler to see (and record) the worker's helper child
      helper = descendantsOf(snapshotProcs(), [workerPid])[0];
      return quick(ctx);
    }}});
    runners.push(r);
    const id = r.enqueue({episodeId: 'join-fanout', jobKind: 'tts.block', subject: getEpisode(t!.p, 'join-fanout').narration.blocks[0].id});
    const t0 = Date.now();
    const done = await r.waitFor(id);
    assert.equal(done.state, 'succeeded');
    const settled = Date.now() - t0;
    assert.ok(helper > 0, 'the worker has a helper child');
    assert.ok(settled < 2500, `the job took ${settled} ms to settle: its cleanup went after the worker's helper`);
    assert.ok(runningNotZombie(workerPid), 'the worker is still running for the next job');
    assert.ok(runningNotZombie(helper), 'the worker\'s helper child was left alone');
  });
});

describe('a worker that ends is explained', () => {
  test('an outside SIGKILL says the studio sent nothing', async () => {
    const {host} = fixture();
    const w = host.ensureWorker();
    await host.request('status');
    const pending = host.request('generate', {out_wav: '/dev/null', hang: true});
    await sleep(100);
    process.kill(w.pid!, 'SIGKILL');
    const err = await pending.then(() => null, (e) => e as WorkerCrashError);
    assert.ok(err instanceof WorkerCrashError);
    assert.match(err.message, /SIGKILL/);
    assert.match(err.message, /the studio sent it no signal/);
    assert.deepEqual(err.detail?.studioSignals, []);
    assert.equal(err.detail?.exit.signal, 'SIGKILL');
  });

  test('a stop by the studio lists the signals it sent and why', async () => {
    const {host} = fixture({FAKE_IGNORE_TERM: '1'});
    const w = host.ensureWorker();
    await host.request('status');
    const pending = host.request('generate', {out_wav: '/dev/null', hang: true});
    await sleep(100);
    await w.terminate(300, 'test stop');
    const err = await pending.then(() => null, (e) => e as WorkerCrashError);
    assert.ok(err instanceof WorkerCrashError);
    assert.deepEqual(err.detail?.studioSignals.map((s) => [s.signal, s.reason]), [['SIGTERM', 'test stop'], ['SIGKILL', 'test stop']]);
    assert.match(err.message, /the studio sent SIGTERM, SIGKILL \(test stop\)/);
  });

  test('a worker crash records memory and exit details in the job events', async () => {
    const {reg, host} = fixture();
    let calls = 0;
    const r = new JobRunner(t!.p, {pollMs: 80, host, reg, killGraceMs: 400, autoRetries: 0, memory: () => ({pressure: 2, swapUsedMb: 12}), handlers: {'tts.block': async (ctx) => {
      calls++;
      ctx.host!.ensureWorker();
      ctx.leaseHost();
      const gen = ctx.host!.request('generate', {out_wav: join(ctx.ws, 'x.wav'), hang: true});
      await sleep(200);
      process.kill(ctx.host!.worker!.pid!, 'SIGKILL');
      return gen;
    }}});
    runners.push(r);
    const id = r.enqueue({episodeId: 'join-fanout', jobKind: 'tts.block', subject: getEpisode(t!.p, 'join-fanout').narration.blocks[0].id});
    const done = await r.waitFor(id);
    assert.equal(done.state, 'failed');
    assert.equal(calls, 1);
    const ev = t!.p.db.prepare("SELECT data_json FROM job_events WHERE job_id=? AND kind='failed'").get(id) as {data_json: string};
    const data = JSON.parse(ev.data_json);
    assert.equal(data.diagnostics.worker.exit.signal, 'SIGKILL');
    assert.deepEqual(data.diagnostics.worker.studioSignals, []);
    assert.deepEqual(data.diagnostics.memory, {pressure: 2, swapUsedMb: 12});
    assert.ok(data.diagnostics.pressureMaxThisAttempt >= 2);
  });
});

describe('a worker asked to shut down is not signalled', () => {
  test('a graceful shutdown sends no signal, to the worker or to its helper child', async () => {
    const {reg, host} = fixture({FAKE_RESOURCE_TRACKER: '1'});
    const w = host.ensureWorker();
    await host.request('status');
    w.rssBytes(); // records the helper child as owned, as the runner's sampler does
    await host.shutdown();
    assert.equal(w.exited, true);
    assert.deepEqual(reg.signals, [], 'nothing was signalled');
  });
});

describe('signals are attributed to the exact worker', () => {
  test('every signal names the process (pid and start time) and generation it went to, and none goes to the replacement', async () => {
    const {reg, host} = fixture({FAKE_IGNORE_TERM: '1', FAKE_SLOW_EXIT: '0.8'}, 300);
    const w1 = host.ensureWorker();
    await host.request('status');
    const start1 = snapshotProcs().get(w1.pid!)!.start;
    const stopping = host.shutdown();
    const w2 = host.ensureWorker(); // a new job arrives while the first is being stopped
    await host.request('status');
    const start2 = snapshotProcs().get(w2.pid!)!.start;
    await stopping;
    await sleep(1000);
    assert.equal(w2.exited, false, 'the replacement is untouched');
    const toFirst = reg.signals.filter((x) => x.pid === w1.pid);
    assert.ok(toFirst.length > 0, 'the first worker was signalled, because it ignored SIGTERM and lingered');
    for (const x of toFirst) {
      assert.equal(x.owner, w1.owner, 'the signal names the first worker\'s generation');
      assert.equal(x.start, start1, 'and its exact process identity');
      assert.match(x.reason, /shutting down the audio worker/);
    }
    // identity is pid AND start time; start times have one-second resolution, so the start alone proves nothing
    assert.equal(reg.signals.some((x) => (x.pid === w2.pid && x.start === start2) || x.owner === w2.owner), false, 'nothing was sent to the second worker');
    assert.notEqual(w1.owner, w2.owner);
    assert.match(w1.owner, /^host:audio#\d+$/);
  });

  test('the exit record of a stopped worker carries the same identity', async () => {
    const {host} = fixture({FAKE_IGNORE_TERM: '1'});
    const w = host.ensureWorker();
    await host.request('status');
    const start = snapshotProcs().get(w.pid!)!.start;
    const pending = host.request('generate', {out_wav: '/dev/null', hang: true});
    await sleep(100);
    await w.terminate(300, 'identity check');
    const err = await pending.then(() => null, (e) => e as WorkerCrashError);
    assert.ok(err?.detail);
    assert.ok(err.detail.studioSignals.length >= 2);
    for (const x of err.detail.studioSignals) assert.deepEqual([x.pid, x.start, x.owner], [w.pid, start, w.owner]);
  });
});
