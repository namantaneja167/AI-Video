import assert from 'node:assert/strict';
import {spawn, type ChildProcess} from 'node:child_process';
import {existsSync, readdirSync} from 'node:fs';
import {join} from 'node:path';
import {afterEach, describe, test} from 'node:test';
import {putBytes} from '../../core/blobs.ts';
import {adoptEpisode, getEpisode, saveEpisode} from '../../core/episodes.ts';
import {descendantsOf, killOwned, OwnerRegistry, snapshotProcs, type PsFn} from '../../core/proc.ts';
import {Project} from '../../core/project.ts';
import {JobRunner, type JobHandler, type RunnerOptions} from '../../core/runner.ts';
import {ModelHost, WorkerCrashError} from '../../core/worker.ts';
import {plain} from '../helpers.ts';
import {newProject, setAllComponents, type Clock, type TestProject} from './helpers.ts';

const realClock = (): Clock => ({t: 0, now: () => Date.now(), advance: () => {}});

let t: TestProject | undefined;
const decoys: ChildProcess[] = [];
const runners: JobRunner[] = [];
afterEach(async () => {
  for (const r of runners.splice(0)) { r.stop(); await r.host?.shutdown().catch(() => {}); }
  for (const d of decoys.splice(0)) { try { process.kill(-d.pid!, 'SIGKILL'); } catch { d.kill('SIGKILL'); } } // each decoy has its own group
  t?.close();
  t = undefined;
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
async function until(cond: () => boolean, ms = 5000, what = 'condition') {
  const t0 = Date.now();
  while (!cond()) { if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${what}`); await sleep(25); }
}
const decoy = (cmd = 'sleep', args = ['300']) => { const c = spawn(cmd, args, {stdio: 'ignore', detached: true}); decoys.push(c); return c; };

function setup(o: Partial<RunnerOptions> = {}, seed = true) {
  t = newProject({clock: realClock()});
  if (seed) {
    adoptEpisode(t.p, 'episodes/join-fanout/episode.json');
    setAllComponents(t.p, t.root);
  }
  const r = new JobRunner(t.p, {pollMs: 80, killGraceMs: 600, ...o, handlers: o.handlers ?? {}});
  runners.push(r);
  return r;
}
const blob = (p: Project, s: string) => putBytes(p, s).hash;
const quick: JobHandler = async (ctx) => ({blobHash: blob(ctx.p, `${ctx.kind}:${ctx.subject}:${ctx.jobId}`)});
const FAKE = ['tests/store/fake-worker.py'];
const py = process.env.PYTHON ?? 'python3';
const hostFor = (r: {reg: OwnerRegistry}, env: NodeJS.ProcessEnv = {}, o: Record<string, unknown> = {}) => new ModelHost(r.reg, {cmd: py, args: [join(process.cwd(), FAKE[0])], env, ...o});
const events = (p: Project, jobId: number) => p.db.prepare('SELECT kind, data_json FROM job_events WHERE job_id=? ORDER BY id').all(jobId).map((e) => ({kind: e.kind as string, data: JSON.parse(e.data_json as string)}));
const procInspectable = (() => { try { snapshotProcs(); return true; } catch { return false; } })();

describe('persistent jobs and attempts', () => {
  test('a job moves queued -> running -> succeeded in the database, with an attempt, events, and a fresh output', async () => {
    const r = setup({handlers: {'timing.build': quick}});
    const id = r.enqueue({episodeId: 'join-fanout', jobKind: 'timing.build'});
    assert.equal(r.row(id).state, 'queued');
    const done = await r.waitFor(id);
    assert.equal(done.state, 'succeeded');
    const att = t!.p.db.prepare('SELECT n, state, finished_at FROM job_attempts WHERE job_id=?').all(id);
    assert.deepEqual(att.map((a) => [a.n, a.state]), [[1, 'succeeded']]);
    assert.deepEqual(events(t!.p, id).map((e) => e.kind), ['queued', 'running', 'finished']);
    assert.equal(t!.p.db.prepare("SELECT COUNT(*) c FROM current WHERE kind='timing'").get()!.c, 1, 'the output became the current timing');
  });

  test('the queue is persistent: a queued job survives a restart and is run by the next runner', async () => {
    const r = setup({handlers: {}});
    const id = r.enqueue({episodeId: 'join-fanout', jobKind: 'timing.build'});
    r.stop();
    t!.p.close();
    t!.p = Project.open(t!.root, {now: t!.clock.now});
    assert.equal(t!.p.recovery.interruptedJobs.length, 0, 'queued jobs are not interrupted');
    const r2 = new JobRunner(t!.p, {pollMs: 80, handlers: {'timing.build': quick}});
    runners.push(r2);
    r2.enqueue({episodeId: 'join-fanout', jobKind: 'mix.draft'}); // wakes the scheduler; the old queued job runs first (FIFO)
    const done = await r2.waitFor(id);
    assert.equal(done.state, 'succeeded');
  });

  test('one HEAVY job at a time, strictly in queue order, even when many are queued at once', async () => {
    let running = 0;
    let maxRunning = 0;
    const order: number[] = [];
    const slow: JobHandler = async (ctx) => {
      running++; maxRunning = Math.max(maxRunning, running); order.push(ctx.jobId);
      await sleep(80);
      running--;
      return quick(ctx);
    };
    const r = setup({handlers: {'timing.build': slow, 'mix.draft': slow, 'mix.final': slow, 'render.draft': slow}});
    const ids = ['timing.build', 'mix.draft', 'mix.final', 'render.draft'].map((k) => r.enqueue({episodeId: 'join-fanout', jobKind: k as any}));
    await r.idle();
    assert.equal(maxRunning, 1);
    assert.deepEqual(order, ids);
    assert.equal(t!.p.db.prepare("SELECT COUNT(*) c FROM jobs WHERE state IN ('succeeded','outdated')").get()!.c, 4, 'downstream jobs finish as outdated when an upstream output they were snapshotted before replaced it');
  });

  test('light jobs run beside a heavy one (up to the limit) and never take the heavy slot', async () => {
    let heavyRunning = false;
    let lightSeenWithHeavy = 0;
    let lightNow = 0;
    let lightMax = 0;
    const heavy: JobHandler = async (ctx) => { heavyRunning = true; await sleep(400); heavyRunning = false; return quick(ctx); };
    const light: JobHandler = async (ctx) => {
      lightNow++; lightMax = Math.max(lightMax, lightNow);
      if (heavyRunning) lightSeenWithHeavy++;
      await sleep(150);
      lightNow--;
      return quick(ctx);
    };
    const r = setup({maxLight: 2, handlers: {'render.draft': heavy, 'mix.draft': light, 'mix.final': light, 'timing.build': light}});
    r.enqueue({episodeId: 'join-fanout', jobKind: 'render.draft'});
    for (const k of ['mix.draft', 'mix.final', 'timing.build'] as const) r.enqueue({episodeId: 'join-fanout', jobKind: k, lane: 'light'});
    await r.idle();
    assert.equal(lightMax, 2, 'at most the light limit at once');
    assert.ok(lightSeenWithHeavy >= 1, 'light work overlapped the heavy job');
  });

  test('a job finished after the project moved on is OUTDATED; the current output is untouched (snapshot rule)', async () => {
    const r = setup({
      handlers: {'timing.build': async (ctx) => {
        const d = plain(getEpisode(ctx.p, ctx.episodeId));
        saveEpisode(ctx.p, ctx.episodeId, {...d, narration: {...d.narration, segments: d.narration.segments.map((s: any, i: number) => (i ? s : {...s, text: `${s.text} Edited meanwhile.`}))}});
        assert.doesNotMatch(ctx.doc.narration.segments[0].text, /Edited meanwhile/, 'the job still sees its frozen snapshot');
        return quick(ctx);
      }},
    });
    const id = r.enqueue({episodeId: 'join-fanout', jobKind: 'timing.build'});
    const done = await r.waitFor(id);
    assert.equal(done.state, 'outdated');
    assert.equal(t!.p.db.prepare("SELECT COUNT(*) c FROM current WHERE kind='timing'").get()!.c, 0);
    assert.equal(t!.p.db.prepare('SELECT outdated FROM artifacts WHERE id=?').get(done.artifact_id!)!.outdated, 1);
  });
});

describe('failure and retry', () => {
  test('a failing job is recorded, frees the heavy slot at once, and can be retried as a new attempt on the same snapshot', async () => {
    let calls = 0;
    const flaky: JobHandler = async (ctx) => { if (++calls === 1) throw new Error('disk full'); return quick(ctx); };
    const r = setup({handlers: {'timing.build': flaky, 'mix.draft': quick}});
    const a = r.enqueue({episodeId: 'join-fanout', jobKind: 'timing.build'});
    const b = r.enqueue({episodeId: 'join-fanout', jobKind: 'mix.draft'});
    const failed = await r.waitFor(a);
    assert.deepEqual([failed.state, failed.error], ['failed', 'disk full']);
    assert.equal((await r.waitFor(b)).state, 'succeeded', 'the next heavy job started after the failure');
    const snap = r.row(a).snapshot_id;
    r.retry(a);
    assert.equal((await r.waitFor(a)).state, 'succeeded');
    assert.equal(r.row(a).snapshot_id, snap);
    assert.deepEqual(t!.p.db.prepare('SELECT n, state FROM job_attempts WHERE job_id=? ORDER BY n').all(a).map((x) => [x.n, x.state]), [[1, 'failed'], [2, 'succeeded']]);
    assert.throws(() => r.retry(a), /only failed or cancelled/);
  });

  test('a worker crash is retried ONCE automatically; a second crash is a failure', async () => {
    let calls = 0;
    const crashy: JobHandler = async (ctx) => { if (++calls < 2) throw new WorkerCrashError('worker exited (signal SIGSEGV)'); return quick(ctx); };
    const r = setup({handlers: {'timing.build': crashy}});
    const id = r.enqueue({episodeId: 'join-fanout', jobKind: 'timing.build'});
    assert.equal((await r.waitFor(id)).state, 'succeeded');
    assert.deepEqual(events(t!.p, id).map((e) => e.kind).filter((k) => k === 'auto-retry'), ['auto-retry']);
    assert.equal(r.row(id).attempts, 2);

    const always: JobHandler = async () => { throw new WorkerCrashError('worker exited again'); };
    const r2 = new JobRunner(t!.p, {pollMs: 80, handlers: {'mix.draft': always}});
    runners.push(r2);
    const id2 = r2.enqueue({episodeId: 'join-fanout', jobKind: 'mix.draft'});
    const f = await r2.waitFor(id2);
    assert.equal(f.state, 'failed');
    assert.equal(f.attempts, 2);
  });

  test('an ordinary error is not retried automatically', async () => {
    let calls = 0;
    const r = setup({handlers: {'timing.build': async () => { calls++; throw new Error('bad input'); }}});
    const id = r.enqueue({episodeId: 'join-fanout', jobKind: 'timing.build'});
    assert.equal((await r.waitFor(id)).state, 'failed');
    assert.equal(calls, 1);
  });

  test('a job with no handler fails clearly', async () => {
    const r = setup({handlers: {}});
    const id = r.enqueue({episodeId: 'join-fanout', jobKind: 'timing.build'});
    assert.match((await r.waitFor(id)).error!, /no handler/);
  });
});

describe('progress is truthful', () => {
  test('no fraction unless the handler has a real total; elapsed time and the current step are always shown', async () => {
    let seen: ReturnType<JobRunner['getProgress']> | undefined;
    const r = setup({
      handlers: {'timing.build': async (ctx) => {
        ctx.progress({step: 'generating block blk01', detail: {generatedSeconds: 2.4}});
        await sleep(300);
        seen = r.getProgress(ctx.jobId);
        return quick(ctx);
      }},
    });
    const id = r.enqueue({episodeId: 'join-fanout', jobKind: 'timing.build'});
    assert.equal(r.getProgress(id).step, 'waiting in queue');
    await r.waitFor(id);
    assert.equal(seen!.step, 'generating block blk01');
    assert.equal(seen!.fraction, null, 'unknown total: no invented percentage');
    assert.ok(seen!.elapsedMs! >= 250, `elapsed ${seen!.elapsedMs}`);
    assert.deepEqual(seen!.detail, {generatedSeconds: 2.4});
  });

  test('a real fraction is passed through; an impossible one is rejected instead of displayed', async () => {
    let mid: number | null = null;
    const r = setup({
      handlers: {'timing.build': async (ctx) => {
        ctx.progress({step: 'rendering', fraction: 0.5, detail: {renderedFrames: 15, totalFrames: 30}});
        mid = r.getProgress(ctx.jobId).fraction;
        ctx.progress({step: 'rendering more', fraction: 1.5});
        return quick(ctx);
      }},
    });
    const id = r.enqueue({episodeId: 'join-fanout', jobKind: 'timing.build'});
    const f = await r.waitFor(id);
    assert.equal(mid, 0.5);
    assert.match(f.error!, /fraction must be within 0\.\.1/);
  });
});

describe('cancellation stops only what the job owns', () => {
  const treeHandler = (pids: number[]): JobHandler => async (ctx) => {
    const c = ctx.spawn('worker', 'sh', ['-c', 'sleep 300 & sleep 300 & wait'], {stdio: 'ignore'});
    await sleep(350);
    pids.push(c.pid!, ...descendantsOf(snapshotProcs(), [c.pid!]));
    ctx.progress({step: 'working'});
    await new Promise(() => {});
    return quick(ctx);
  };

  test('cancelling a running job stops its whole process tree, spares look-alike processes, frees the slot and the workspace', {skip: !procInspectable && 'process inspection unavailable'}, async () => {
    const pids: number[] = [];
    const r = setup({handlers: {'timing.build': treeHandler(pids), 'mix.draft': quick}});
    const unrelated = [decoy(), decoy('sh', ['-c', 'sleep 300 & sleep 300 & wait']), decoy('node', ['-e', 'setTimeout(()=>{},300000)']), decoy('python3', ['-c', 'import time; time.sleep(300)'])];
    const a = r.enqueue({episodeId: 'join-fanout', jobKind: 'timing.build'});
    const b = r.enqueue({episodeId: 'join-fanout', jobKind: 'mix.draft'});
    await until(() => pids.length >= 3, 5000, 'owned processes');
    assert.ok(pids.every(alive));
    const ws = join(t!.p.tmpDir, `${a}-1`);
    assert.ok(existsSync(ws), 'job workspace exists while running');
    const done = await r.cancel(a);
    assert.equal(done.state, 'cancelled');
    assert.ok(pids.every((p) => !alive(p)), 'every owned process (including grandchildren) is gone');
    assert.ok(unrelated.every((d) => alive(d.pid!)), 'unrelated processes, even with identical command lines, were not touched');
    assert.equal(existsSync(ws), false, 'workspace removed');
    assert.equal(t!.p.db.prepare('SELECT COUNT(*) c FROM job_procs WHERE gone_at IS NULL').get()!.c, 0);
    assert.equal((await r.waitFor(b)).state, 'succeeded', 'the heavy slot was released and the next job ran');
  });

  test('a process that ignores SIGTERM is escalated to SIGKILL, and the cancellation is confirmed', {skip: !procInspectable && 'process inspection unavailable'}, async () => {
    const pids: number[] = [];
    const r = setup({handlers: {'timing.build': async (ctx) => {
      const c = ctx.spawn('worker', 'sh', ['-c', 'trap "" TERM; sleep 300 & wait'], {stdio: 'ignore'});
      await sleep(350);
      pids.push(c.pid!, ...descendantsOf(snapshotProcs(), [c.pid!]));
      await new Promise(() => {});
      return quick(ctx);
    }}});
    const a = r.enqueue({episodeId: 'join-fanout', jobKind: 'timing.build'});
    await until(() => pids.length >= 2, 5000, 'owned processes');
    assert.equal((await r.cancel(a)).state, 'cancelled');
    assert.ok(pids.every((p) => !alive(p)));
  });

  test('cancelling a queued job needs no processes and leaves the queue moving', async () => {
    const hold: JobHandler = async (ctx) => { await sleep(200); return quick(ctx); };
    const r = setup({handlers: {'timing.build': hold, 'mix.draft': quick, 'mix.final': quick}});
    r.enqueue({episodeId: 'join-fanout', jobKind: 'timing.build'});
    const mid = r.enqueue({episodeId: 'join-fanout', jobKind: 'mix.draft'});
    const last = r.enqueue({episodeId: 'join-fanout', jobKind: 'mix.final'});
    assert.equal((await r.cancel(mid)).state, 'cancelled');
    assert.equal((await r.waitFor(last)).state, 'succeeded');
    assert.equal(r.row(mid).state, 'cancelled');
  });

  test('a cancelled job can be retried', {skip: !procInspectable && 'process inspection unavailable'}, async () => {
    let n = 0;
    const r = setup({handlers: {'timing.build': async (ctx) => { if (++n === 1) await new Promise(() => {}); return quick(ctx); }}});
    const id = r.enqueue({episodeId: 'join-fanout', jobKind: 'timing.build'});
    await until(() => r.row(id).state === 'running', 3000, 'running');
    await r.cancel(id);
    assert.equal(r.row(id).state, 'cancelled');
    r.retry(id);
    assert.equal((await r.waitFor(id)).state, 'succeeded');
  });

  test('identity checks: a recorded pid whose start time no longer matches is NOT killed', {skip: !procInspectable && 'process inspection unavailable'}, async () => {
    t = newProject({seed: false});
    const reg = new OwnerRegistry(t.p.db, t.p.now);
    const victim = decoy();
    reg.record('attempt:99', victim.pid!, 'Mon Jan  1 00:00:00 2001', 'worker'); // a reused pid: same number, different process
    const res = await killOwned(reg, 'attempt:99', {graceMs: 300});
    assert.equal(res.confirmed, true);
    assert.deepEqual(res.signalled, []);
    assert.ok(alive(victim.pid!), 'the process that merely shares the pid was left alone');
    assert.equal(t.p.db.prepare('SELECT COUNT(*) c FROM job_procs WHERE gone_at IS NULL').get()!.c, 0, 'the stale record was retired');
  });

  test('if the process table cannot be read, nothing unverified is killed and the result says it is unconfirmed', async () => {
    t = newProject({seed: false});
    const broken: PsFn = () => { throw new Error('ps: operation not permitted'); };
    const reg = new OwnerRegistry(t.p.db, t.p.now, broken);
    const bystander = decoy();
    reg.record('attempt:7', bystander.pid!, 'Mon Jan  1 00:00:00 2001', 'worker');
    const res = await killOwned(reg, 'attempt:7', {graceMs: 200});
    assert.equal(res.confirmed, false);
    assert.match(res.reason!, /process inspection unavailable/);
    assert.ok(alive(bystander.pid!));
  });

  test('a cancellation that cannot be confirmed is reported as a failure, not as a clean cancel', async () => {
    const broken: PsFn = () => { throw new Error('ps blocked'); };
    const r = setup({handlers: {'timing.build': async () => { await new Promise(() => {}); return {blobHash: 'x'}; }}});
    const r2 = new JobRunner(t!.p, {pollMs: 50, reg: new OwnerRegistry(t!.p.db, t!.p.now, broken), handlers: {'timing.build': async () => { await new Promise(() => {}); return {blobHash: 'x'}; }}});
    runners.push(r2);
    r.stop();
    const id = r2.enqueue({episodeId: 'join-fanout', jobKind: 'timing.build'});
    await until(() => r2.row(id).state === 'running', 3000, 'running');
    const done = await r2.cancel(id);
    assert.equal(done.state, 'failed');
    assert.match(done.error!, /could not confirm that every process stopped/);
  });
});

describe('restart recovery without orphans', () => {
  test('after kill -9 of the runner process, reopening the project stops its leftover workers and fails the job as interrupted', {skip: !procInspectable && 'process inspection unavailable'}, async () => {
    t = newProject();
    adoptEpisode(t.p, 'episodes/join-fanout/episode.json');
    setAllComponents(t.p, t.root);
    t.p.close();
    const unrelated = [decoy(), decoy('sh', ['-c', 'sleep 301 & sleep 301 & wait'])];
    const child = spawn(process.execPath, [join(import.meta.dirname, 'runner-child.ts'), t.root], {stdio: ['ignore', 'pipe', 'inherit']});
    const info: {pids: number[]; job: number} = await new Promise((res, rej) => {
      let buf = '';
      child.stdout.on('data', (d: Buffer) => { buf += d; const m = /READY (.*)\n/.exec(buf); if (m) res(JSON.parse(m[1])); });
      child.on('exit', () => rej(new Error('runner child exited early')));
    });
    assert.ok(info.pids.length >= 3);
    child.kill('SIGKILL');
    await new Promise((r) => child.on('exit', r));
    assert.ok(info.pids.every(alive), 'the workers outlived their runner: this is the orphan scenario');
    t.p = Project.open(t.root, {now: t.clock.now});
    assert.deepEqual(t.p.recovery.interruptedJobs, [info.job]);
    assert.equal(t.p.recovery.processInspection, 'ok');
    assert.ok(info.pids.every((p) => t!.p.recovery.reapedProcesses.includes(p)));
    await until(() => info.pids.every((p) => !alive(p)), 3000, 'orphans to be gone');
    assert.ok(unrelated.every((d) => alive(d.pid!)), 'unrelated processes survive recovery');
    const row = t.p.db.prepare('SELECT state, error FROM jobs WHERE id=?').get(info.job)!;
    assert.deepEqual([row.state, row.error], ['failed', 'interrupted']);
    assert.equal(t.p.db.prepare("SELECT state FROM job_attempts WHERE job_id=?").get(info.job)!.state, 'failed');
    assert.equal(existsSync(join(t.p.tmpDir, `${info.job}-1`)), false, 'the workspace was removed');
    // and the interrupted job can be retried
    const r = new JobRunner(t.p, {pollMs: 80, handlers: {'timing.build': quick}});
    runners.push(r);
    r.retry(info.job);
    assert.equal((await r.waitFor(info.job)).state, 'succeeded');
  });

  test('recovery with no readable process table touches nothing and reports that', async () => {
    t = newProject({seed: false});
    const reg = new OwnerRegistry(t.p.db, t.p.now, () => { throw new Error('blocked'); });
    const bystander = decoy();
    reg.record('attempt:1', bystander.pid!, 'Mon Jan  1 00:00:00 2001', 'worker');
    const {reapAllSync} = await import('../../core/proc.ts');
    const res = reapAllSync(reg, 100);
    assert.equal(res.inspection, 'unavailable');
    assert.deepEqual(res.reaped, []);
    assert.ok(alive(bystander.pid!));
    assert.equal(reg.liveAll().length, 1, 'the record is kept so a later start can retry');
  });

  test('startup with no recorded processes does not even need to inspect the process table', () => {
    t = newProject({seed: false});
    t.p.close();
    t.p = Project.open(t.root, {now: t.clock.now});
    assert.equal(t.p.recovery.processInspection, 'not-needed');
    assert.deepEqual(readdirSync(t.p.tmpDir), []);
  });
});

describe('model host: unload and confirm before rendering', () => {
  const MB = 2 ** 20;
  const renderProbe = (log: Record<string, unknown>): JobHandler => async (ctx) => {
    log.loadedAtStart = ctx.host!.loaded;
    log.workerAliveAtStart = !!ctx.host!.worker && !ctx.host!.worker.exited;
    log.rssAtStart = ctx.host!.worker?.rssBytes() ?? null;
    return quick(ctx);
  };
  async function loadedHost(r: JobRunner, env: NodeJS.ProcessEnv = {}, hostOpts: Record<string, unknown> = {}) {
    const host = hostFor(r, env, {rssThresholdBytes: 150 * MB, residualBytes: 16 * MB, unloadTimeoutMs: 1500, killGraceMs: 500, ...hostOpts});
    await host.ensureModel('tts', {hold_mb: 400});
    return host;
  }
  const mk = async (env: NodeJS.ProcessEnv = {}, hostOpts: Record<string, unknown> = {}, log: Record<string, unknown> = {}) => {
    t = newProject();
    adoptEpisode(t.p, 'episodes/join-fanout/episode.json');
    setAllComponents(t.p, t.root);
    const bootstrap = new JobRunner(t.p, {pollMs: 80, handlers: {}});
    runners.push(bootstrap);
    const host = await loadedHost(bootstrap, env, hostOpts);
    const r = new JobRunner(t.p, {pollMs: 80, host, killGraceMs: 500, releaseBefore: (k) => k.startsWith('render.'), handlers: {'render.draft': renderProbe(log), 'tts.block': quick}});
    runners.push(r);
    return {r, host, log};
  };
  const handovers = (jobId: number) => events(t!.p, jobId).filter((e) => e.kind === 'handover').map((e) => e.data);

  test('the model is unloaded and its release CONFIRMED (memory measured before and after) before the render handler starts', {skip: !procInspectable && 'process inspection unavailable'}, async () => {
    const {r, host, log} = await mk();
    const rssLoaded = host.worker!.rssBytes()!;
    assert.ok(rssLoaded > 350 * MB, `model memory is really resident (${(rssLoaded / MB).toFixed(0)} MiB)`);
    const id = r.enqueue({episodeId: 'join-fanout', jobKind: 'render.draft'});
    assert.equal((await r.waitFor(id)).state, 'succeeded');
    const [h] = handovers(id);
    assert.equal(h.outcome, 'released');
    assert.ok(h.rssBeforeBytes > 350 * MB && h.rssAfterBytes < 150 * MB, `rss ${h.rssBeforeBytes} -> ${h.rssAfterBytes}`);
    assert.equal(h.ack.activeBytes, 0);
    assert.equal(log.loadedAtStart, null);
    assert.ok((log.rssAtStart as number) < 150 * MB, 'at render start the worker holds almost nothing');
  });

  test('a worker that acknowledges but keeps its memory is killed, its exit confirmed, and only then does the render start', {skip: !procInspectable && 'process inspection unavailable'}, async () => {
    const {r, host, log} = await mk({FAKE_IGNORE_UNLOAD: '1'});
    const pid = host.worker!.pid!;
    const id = r.enqueue({episodeId: 'join-fanout', jobKind: 'render.draft'});
    assert.equal((await r.waitFor(id)).state, 'succeeded');
    assert.equal(handovers(id)[0].outcome, 'killed');
    assert.equal(alive(pid), false);
    assert.equal(log.workerAliveAtStart, false);
  });

  test('a worker that never answers unload is killed after the timeout', {skip: !procInspectable && 'process inspection unavailable'}, async () => {
    const {r, host} = await mk({FAKE_NO_UNLOAD_REPLY: '1'});
    const pid = host.worker!.pid!;
    const id = r.enqueue({episodeId: 'join-fanout', jobKind: 'render.draft'});
    assert.equal((await r.waitFor(id)).state, 'succeeded');
    const [h] = handovers(id);
    assert.equal(h.outcome, 'killed');
    assert.match(h.detail, /no acknowledgement/);
    assert.equal(alive(pid), false);
  });

  test('a worker that ignores SIGTERM as well is still stopped (SIGKILL) before the render starts', {skip: !procInspectable && 'process inspection unavailable'}, async () => {
    const {r, host} = await mk({FAKE_NO_UNLOAD_REPLY: '1', FAKE_IGNORE_TERM: '1'});
    const pid = host.worker!.pid!;
    const id = r.enqueue({episodeId: 'join-fanout', jobKind: 'render.draft'});
    assert.equal((await r.waitFor(id)).state, 'succeeded');
    assert.equal(alive(pid), false);
  });

  test('if release cannot be confirmed the render does NOT start: it fails while preparing and the slot is free', async () => {
    t = newProject();
    adoptEpisode(t.p, 'episodes/join-fanout/episode.json');
    setAllComponents(t.p, t.root);
    const broken: PsFn = () => { throw new Error('ps blocked'); };
    const regBroken = new OwnerRegistry(t.p.db, t.p.now, broken);
    const host = hostFor({reg: regBroken}, {FAKE_NO_UNLOAD_REPLY: '1'}, {unloadTimeoutMs: 400, killGraceMs: 300});
    await host.ensureModel('tts', {hold_mb: 20});
    let ran = false;
    const r = new JobRunner(t.p, {pollMs: 80, host, reg: regBroken, killGraceMs: 300, releaseBefore: (k) => k.startsWith('render.'), handlers: {'render.draft': async (ctx) => { ran = true; return quick(ctx); }, 'tts.block': quick}});
    runners.push(r);
    const id = r.enqueue({episodeId: 'join-fanout', jobKind: 'render.draft'});
    const f = await r.waitFor(id);
    assert.equal(ran, false, 'the render handler never ran');
    assert.equal(f.state, 'failed');
    assert.match(f.error!, /could not confirm the audio model was released/);
    assert.equal(handovers(id)[0].outcome, 'kill-unconfirmed');
    const next = r.enqueue({episodeId: 'join-fanout', jobKind: 'tts.block', subject: getEpisode(t.p, 'join-fanout').narration.blocks[0].id});
    assert.equal((await r.waitFor(next)).state, 'succeeded', 'the heavy slot is free');
    const w = host.worker; // ps is blocked in this test, so the runner (correctly) could not stop it: the test cleans up its own worker
    if (w && !w.exited) { w.child.kill('SIGKILL'); await new Promise((res) => w.child.once('exit', res)); }
  });

  test('non-render jobs do not trigger an unload; with no worker loaded the hand-over is a recorded no-op', async () => {
    t = newProject();
    adoptEpisode(t.p, 'episodes/join-fanout/episode.json');
    setAllComponents(t.p, t.root);
    const host = hostFor({reg: new OwnerRegistry(t.p.db, t.p.now)});
    const r = new JobRunner(t.p, {pollMs: 80, host, releaseBefore: (k) => k.startsWith('render.'), handlers: {'render.draft': quick, 'mix.draft': quick}});
    runners.push(r);
    const a = r.enqueue({episodeId: 'join-fanout', jobKind: 'mix.draft'});
    const b = r.enqueue({episodeId: 'join-fanout', jobKind: 'render.draft'});
    await r.waitFor(b);
    assert.deepEqual(handovers(a), []);
    assert.equal(handovers(b)[0].outcome, 'no-worker');
  });

  test('only one model at a time: switching models unloads the first (confirmed) and the worker refuses a second load', {skip: !procInspectable && 'process inspection unavailable'}, async () => {
    t = newProject({seed: false});
    const reg = new OwnerRegistry(t.p.db, t.p.now);
    const host = hostFor({reg}, {}, {rssThresholdBytes: 150 * MB, residualBytes: 16 * MB});
    await host.ensureModel('tts', {hold_mb: 200});
    await assert.rejects(host.worker!.request('load', {model: 'aligner'}), /already loaded/);
    await host.ensureModel('aligner', {hold_mb: 100});
    assert.equal(host.loaded, 'aligner');
    const [h] = host.handovers;
    assert.equal(h.outcome, 'released');
    assert.match(h.reason, /switching from tts to aligner/);
    await host.shutdown();
    assert.equal(host.worker, null);
  });

  test('cancelling a job that is using the audio worker stops that worker and its children (and only those)', {skip: !procInspectable && 'process inspection unavailable'}, async () => {
    t = newProject();
    adoptEpisode(t.p, 'episodes/join-fanout/episode.json');
    setAllComponents(t.p, t.root);
    const reg = new OwnerRegistry(t.p.db, t.p.now);
    const host = hostFor({reg}, {}, {killGraceMs: 400});
    const unrelated = [decoy('python3', ['-c', 'import time; time.sleep(300)']), decoy()];
    let workerPid = 0;
    let kids: number[] = [];
    const r = new JobRunner(t.p, {pollMs: 80, host, reg, killGraceMs: 400, handlers: {'tts.block': async (ctx) => {
      await ctx.host!.ensureModel('tts', {hold_mb: 20});
      ctx.leaseHost();
      workerPid = ctx.host!.worker!.pid!;
      const gen = ctx.host!.request('generate', {out_wav: join(ctx.ws, 'x.wav'), children: 2, hang: true});
      gen.catch(() => {});
      await sleep(600);
      kids = descendantsOf(snapshotProcs(), [workerPid]);
      await gen;
      return quick(ctx);
    }}});
    runners.push(r);
    const id = r.enqueue({episodeId: 'join-fanout', jobKind: 'tts.block', subject: getEpisode(t.p, 'join-fanout').narration.blocks[0].id});
    await until(() => kids.length >= 2, 6000, 'worker children');
    assert.equal((await r.cancel(id)).state, 'cancelled');
    assert.equal(alive(workerPid), false);
    assert.ok(kids.every((k) => !alive(k)));
    assert.ok(unrelated.every((d) => alive(d.pid!)));
    assert.equal(host.worker, null, 'the host noticed its worker is gone');
  });

  test('cancelling a job that is using the audio worker stops a child that moved to its own process group and the grandchildren it spawned (found by parentage, not by group)', {skip: !procInspectable && 'process inspection unavailable'}, async () => {
    t = newProject();
    adoptEpisode(t.p, 'episodes/join-fanout/episode.json');
    setAllComponents(t.p, t.root);
    const reg = new OwnerRegistry(t.p.db, t.p.now);
    const host = hostFor({reg}, {}, {killGraceMs: 400});
    const unrelated = [decoy('python3', ['-c', 'import time; time.sleep(300)']), decoy()];
    let workerPid = 0;
    let kids: number[] = [];
    const r = new JobRunner(t.p, {pollMs: 80, host, reg, killGraceMs: 400, handlers: {'tts.block': async (ctx) => {
      await ctx.host!.ensureModel('tts', {hold_mb: 20});
      ctx.leaseHost();
      workerPid = ctx.host!.worker!.pid!;
      const gen = ctx.host!.request('generate', {out_wav: join(ctx.ws, 'x.wav'), children: 1, new_session: true, hang: true});
      gen.catch(() => {});
      await sleep(600);
      kids = descendantsOf(snapshotProcs(), [workerPid]);
      await gen;
      return quick(ctx);
    }}});
    runners.push(r);
    const id = r.enqueue({episodeId: 'join-fanout', jobKind: 'tts.block', subject: getEpisode(t.p, 'join-fanout').narration.blocks[0].id});
    await until(() => kids.length >= 3, 6000, 'worker children');
    assert.notEqual(snapshotProcs().get(kids[0])!.pgid, snapshotProcs().get(workerPid)!.pgid, 'the child really left the worker\'s process group');
    assert.equal((await r.cancel(id)).state, 'cancelled');
    assert.equal(alive(workerPid), false);
    assert.ok(kids.every((k) => !alive(k)));
    assert.ok(unrelated.every((d) => alive(d.pid!)));
    assert.equal(host.worker, null, 'the host noticed its worker is gone');
  });
});

describe('memory guard', () => {
  test('critical memory pressure for the configured number of consecutive samples stops the job and its processes', {skip: !procInspectable && 'process inspection unavailable'}, async () => {
    const pids: number[] = [];
    let level = 1;
    const r = setup({memory: () => ({pressure: level, swapUsedMb: null}), criticalSamples: 3, handlers: {'timing.build': async (ctx) => {
      const c = ctx.spawn('worker', 'sleep', ['300'], {stdio: 'ignore'});
      pids.push(c.pid!);
      level = 4; // pressure goes critical and stays there
      await new Promise(() => {});
      return quick(ctx);
    }}});
    const id = r.enqueue({episodeId: 'join-fanout', jobKind: 'timing.build'});
    const f = await r.waitFor(id);
    assert.equal(f.state, 'failed');
    assert.match(f.error!, /memory pressure stayed critical for 3 consecutive samples/);
    assert.ok(pids.every((p) => !alive(p)));
    assert.equal(t!.p.db.prepare('SELECT pressure_max m FROM job_attempts WHERE job_id=?').get(id)!.m, 4);
  });

  test('a single critical sample does not stop the job (the same 5-in-a-row rule as the Qwen runs)', async () => {
    let n = 0;
    const r = setup({memory: () => ({pressure: ++n === 3 ? 4 : 1, swapUsedMb: null}), criticalSamples: 3, handlers: {'timing.build': async (ctx) => { await sleep(500); return quick(ctx); }}});
    const id = r.enqueue({episodeId: 'join-fanout', jobKind: 'timing.build'});
    assert.equal((await r.waitFor(id)).state, 'succeeded');
  });

  test('a heavy job does not start while pressure is already critical', async () => {
    let ran = false;
    const r = setup({memory: () => ({pressure: 4, swapUsedMb: null}), handlers: {'timing.build': async (ctx) => { ran = true; return quick(ctx); }}});
    const id = r.enqueue({episodeId: 'join-fanout', jobKind: 'timing.build'});
    const f = await r.waitFor(id);
    assert.equal(ran, false);
    assert.match(f.error!, /memory pressure is critical/);
  });

  test('peak resident memory of the job\'s own processes is measured and stored on the attempt', {skip: !procInspectable && 'process inspection unavailable'}, async () => {
    const r = setup({handlers: {'timing.build': async (ctx) => {
      const c = ctx.spawn('worker', 'python3', ['-c', 'b = bytearray(120*1024*1024)\nfor i in range(0, len(b), 4096): b[i]=1\nimport time; time.sleep(1.2)'], {stdio: 'ignore'});
      await new Promise((res) => c.on('exit', res));
      return quick(ctx);
    }}});
    const id = r.enqueue({episodeId: 'join-fanout', jobKind: 'timing.build'});
    await r.waitFor(id);
    const peak = t!.p.db.prepare('SELECT peak_rss_bytes p FROM job_attempts WHERE job_id=?').get(id)!.p as number;
    assert.ok(peak > 100 * MB_(), `peak ${peak}`);
  });
});
const MB_ = () => 2 ** 20;

