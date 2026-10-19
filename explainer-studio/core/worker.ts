// JSON-lines workers and the model host. One audio worker process holds at most one model at a time; before a
// render the host unloads it and CONFIRMS the memory came back (or kills the worker and confirms it is gone).
//
// Protocol (one JSON object per line):
//   client -> worker  {"id": 1, "cmd": "load|generate|align|estimate|unload|status|shutdown", "params": {...}}
//   worker -> client  {"id": 1, "event": "progress", ...}  {"id": 1, "event": "result", "data": {...}}  {"id": 1, "event": "error", "message": "..."}
import type {ChildProcess} from 'node:child_process';
import {killOwned, lease, ownedAlive, ownedRssBytes, spawnOwned, type KillResult, type OwnerRegistry} from './proc.ts';

/** How a worker ended, and whether this app sent the signal that ended it. Recorded with the job event so a kill can be attributed. */
export type WorkerExitDetail = {
  pid: number | undefined;
  exit: {code: number | null; signal: string | null};
  uptimeMs: number;
  /** Each signal names the exact process (pid and start time) and the worker generation (owner `host:audio#<n>`) it went to. */
  studioSignals: {signal: string; at: number; reason: string; pid: number; start: string; owner: string}[];
  stderrTail: string;
};

export class WorkerCrashError extends Error {
  /** A worker dying is the one failure the runner may retry once automatically. */
  transient = true;
  detail?: WorkerExitDetail;
  constructor(message: string, detail?: WorkerExitDetail) {
    super(message);
    this.detail = detail;
  }
}
export class WorkerError extends Error {}

type Pending = {resolve: (v: any) => void; reject: (e: Error) => void; onEvent?: (e: any) => void; timer?: NodeJS.Timeout};

export class WorkerHandle {
  readonly child: ChildProcess;
  readonly owner: string;
  readonly reg: OwnerRegistry;
  exited = false;
  exitDetail: WorkerExitDetail | null = null;
  readonly startedAt = Date.now();
  stderrTail = '';
  private pending = new Map<number, Pending>();
  private nextId = 1;
  private buf = '';

  private constructor(reg: OwnerRegistry, owner: string, child: ChildProcess) {
    this.reg = reg;
    this.owner = owner;
    this.child = child;
    child.stdout!.setEncoding('utf8');
    child.stdout!.on('data', (d: string) => this.onData(d));
    child.stderr!.setEncoding('utf8');
    child.stderr!.on('data', (d: string) => { this.stderrTail = (this.stderrTail + d).slice(-4000); });
    child.stdin!.on('error', () => { /* worker gone; the exit handler rejects pending requests */ });
    const fail = (why: string, exit: {code: number | null; signal: string | null} | null) => {
      this.exited = true;
      let detail: WorkerExitDetail | undefined;
      let attribution = '';
      if (exit) {
        const sent = this.reg.signals.filter((x) => x.pid === child.pid && x.at >= this.startedAt);
        detail = {pid: child.pid, exit, uptimeMs: Date.now() - this.startedAt, studioSignals: sent.map((x) => ({signal: x.signal, at: x.at, reason: x.reason, pid: x.pid, start: x.start, owner: x.owner})), stderrTail: this.stderrTail.trim().split('\n').slice(-3).join(' | ')};
        this.exitDetail = detail;
        attribution = sent.length ? `; the studio sent ${sent.map((x) => x.signal).join(', ')} (${[...new Set(sent.map((x) => x.reason))].join('; ')})` : '; the studio sent it no signal';
      }
      for (const [, p] of this.pending) { if (p.timer) clearTimeout(p.timer); p.reject(new WorkerCrashError(`worker ${why}${attribution}${this.stderrTail ? `: ${this.stderrTail.trim().split('\n').slice(-3).join(' | ')}` : ''}`, detail)); }
      this.pending.clear();
    };
    child.on('exit', (code, sig) => fail(`exited (${sig ?? `code ${code}`})`, {code, signal: sig}));
    child.on('error', (e) => fail(`failed to start (${e.message})`, null));
  }

  static start(reg: OwnerRegistry, owner: string, role: string, cmd: string, args: string[], opts: {cwd?: string; env?: NodeJS.ProcessEnv} = {}): WorkerHandle {
    const child = spawnOwned(reg, owner, role, cmd, args, {cwd: opts.cwd, env: {...process.env, ...opts.env}, stdio: ['pipe', 'pipe', 'pipe']});
    return new WorkerHandle(reg, owner, child);
  }

  get pid(): number | undefined { return this.child.pid; }

  private onData(chunk: string): void {
    this.buf += chunk;
    const lines = this.buf.split('\n');
    this.buf = lines.pop()!;
    for (const line of lines) {
      if (!line.trim()) continue;
      let m: any;
      try { m = JSON.parse(line); } catch { continue; } // stray output from a library is not a protocol message
      const p = this.pending.get(m.id);
      if (!p) continue;
      if (m.event === 'progress') p.onEvent?.(m);
      else if (m.event === 'result') { if (p.timer) clearTimeout(p.timer); this.pending.delete(m.id); p.resolve(m.data); }
      else if (m.event === 'error') { if (p.timer) clearTimeout(p.timer); this.pending.delete(m.id); p.reject(new WorkerError(m.message ?? 'worker error')); }
    }
  }

  request<T = any>(cmd: string, params: Record<string, unknown> = {}, opts: {onEvent?: (e: any) => void; timeoutMs?: number} = {}): Promise<T> {
    if (this.exited) return Promise.reject(new WorkerCrashError(`worker is not running${this.exitDetail ? ` (it ended earlier: ${this.exitDetail.exit.signal ?? `code ${this.exitDetail.exit.code}`}, ${this.exitDetail.studioSignals.length ? `the studio sent ${this.exitDetail.studioSignals.map((x) => x.signal).join(', ')}` : 'the studio sent it no signal'})` : ''}`, this.exitDetail ?? undefined));
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      const p: Pending = {resolve, reject, onEvent: opts.onEvent};
      if (opts.timeoutMs) p.timer = setTimeout(() => { this.pending.delete(id); reject(new WorkerError(`worker did not answer "${cmd}" within ${opts.timeoutMs} ms`)); }, opts.timeoutMs);
      this.pending.set(id, p);
      this.child.stdin!.write(JSON.stringify({id, cmd, params}) + '\n');
    });
  }

  rssBytes(): number | null {
    try { return ownedRssBytes(this.reg, this.owner); } catch { return null; }
  }

  /** Stop this worker (and what it spawned) with identity checks; the handle is used only if the process table is unreadable. */
  terminate(graceMs = 1500, why = 'stopping the audio worker'): Promise<KillResult> {
    return killOwned(this.reg, this.owner, {graceMs, handles: [this.child], why});
  }
}

export type Handover = {
  at: number;
  reason: string;
  outcome: 'no-worker' | 'released' | 'killed' | 'kill-unconfirmed';
  rssBeforeBytes: number | null;
  /** What the framework itself reported as held just before unload (MLX buffers are largely invisible to resident size). */
  mlxBeforeBytes?: number | null;
  ack: {activeBytes: number; cacheBytes: number; peakBytes?: number} | null;
  rssAfterBytes: number | null;
  thresholdBytes: number;
  waitedMs: number;
  detail?: string;
};

export type HostOptions = {
  cmd: string;
  args: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  owner?: string;
  /** After unload, the worker must be below this resident size, otherwise it is killed. */
  rssThresholdBytes?: number;
  /** Memory the worker itself reports as still held after unload must be at most this. */
  residualBytes?: number;
  unloadTimeoutMs?: number;
  killGraceMs?: number;
};

export class ModelHost {
  readonly reg: OwnerRegistry;
  readonly opts: Required<HostOptions>;
  worker: WorkerHandle | null = null;
  loaded: string | null = null;
  handovers: Handover[] = [];
  private spawned = 0;
  /** Workers being shut down. A new model is not loaded, and a render does not start, until these have exited: one model in memory at a time. */
  private retiring = new Set<Promise<void>>();
  /** Receives every transition, so the runner can persist it. */
  onHandover?: (h: Handover) => void;

  constructor(reg: OwnerRegistry, o: HostOptions) {
    this.reg = reg;
    this.opts = {
      owner: 'host:audio', rssThresholdBytes: 1.5 * 2 ** 30, residualBytes: 64 * 2 ** 20, unloadTimeoutMs: 30_000, killGraceMs: 1500, cwd: process.cwd(), env: {}, ...o,
    };
  }

  ensureWorker(): WorkerHandle {
    if (this.worker && !this.worker.exited) return this.worker;
    this.worker = null;
    this.loaded = null;
    // One owner per worker process: stopping one worker (an idle shutdown, a late cleanup) can never reach a worker started after it.
    const w = WorkerHandle.start(this.reg, `${this.opts.owner}#${++this.spawned}`, 'audio-worker', this.opts.cmd, this.opts.args, {cwd: this.opts.cwd, env: this.opts.env});
    w.child.on('exit', () => {
      if (this.worker === w) { this.worker = null; this.loaded = null; }
      try { this.reg.release(w.owner, 'audio-worker'); } catch { /* the project was closed first: its recovery retires the record */ }
    });
    this.worker = w;
    return w;
  }

  /** Give a job the right to stop this worker (a cancelled generation can only be stopped by stopping the worker). */
  leaseTo(attemptOwner: string): void {
    if (this.worker?.pid !== undefined) lease(this.reg, attemptOwner, this.worker.pid, 'host-lease');
  }

  /** Load `model`, first unloading (and confirming) whatever else is loaded: never two models at once. */
  async ensureModel(model: string, params: Record<string, unknown> = {}, onEvent?: (e: any) => void): Promise<void> {
    await this.settleRetired();
    this.ensureWorker();
    if (this.loaded === model) return;
    if (this.loaded) await this.unloadAndConfirm(`switching from ${this.loaded} to ${model}`);
    await this.ensureWorker().request('load', {model, ...params}, {onEvent, timeoutMs: 10 * 60_000});
    this.loaded = model;
  }

  async request<T = any>(cmd: string, params: Record<string, unknown> = {}, opts: {onEvent?: (e: any) => void; timeoutMs?: number} = {}): Promise<T> {
    return this.ensureWorker().request<T>(cmd, params, opts);
  }

  /**
   * Unload the model and confirm the memory was released. Released means: the worker acknowledged, reports almost
   * nothing held, and its resident size is under the threshold. Anything else and the worker is stopped and the
   * exit confirmed. If neither can be confirmed the outcome is `kill-unconfirmed` and callers must not proceed.
   */
  async unloadAndConfirm(reason: string): Promise<Handover> {
    await this.settleRetired();
    const t0 = Date.now();
    const w = this.worker && !this.worker.exited ? this.worker : null;
    const rec: Handover = {at: t0, reason, outcome: 'no-worker', rssBeforeBytes: null, ack: null, rssAfterBytes: null, thresholdBytes: this.opts.rssThresholdBytes, waitedMs: 0};
    if (!w) { this.worker = null; this.loaded = null; return this.finish(rec, t0); }
    rec.rssBeforeBytes = w.rssBytes();
    try { rec.mlxBeforeBytes = (await w.request<{active_bytes?: number}>('status', {}, {timeoutMs: 5000})).active_bytes ?? null; } catch { rec.mlxBeforeBytes = null; }
    let ack: Handover['ack'] = null;
    try {
      const r = await w.request<{active_bytes: number; cache_bytes: number; peak_bytes?: number}>('unload', {}, {timeoutMs: this.opts.unloadTimeoutMs});
      ack = {activeBytes: r.active_bytes, cacheBytes: r.cache_bytes, peakBytes: r.peak_bytes};
    } catch (e) {
      rec.detail = `no acknowledgement: ${(e as Error).message}`;
    }
    rec.ack = ack;
    rec.rssAfterBytes = w.exited ? 0 : w.rssBytes();
    const heldOk = ack !== null && ack.activeBytes <= this.opts.residualBytes && ack.cacheBytes <= this.opts.residualBytes;
    const rssOk = rec.rssAfterBytes !== null && rec.rssAfterBytes <= this.opts.rssThresholdBytes;
    if (heldOk && rssOk) {
      this.loaded = null;
      rec.outcome = 'released';
      return this.finish(rec, t0);
    }
    rec.detail = (rec.detail ? `${rec.detail}; ` : '') + (heldOk ? `worker still holds ${rec.rssAfterBytes === null ? 'unknown memory' : `${(rec.rssAfterBytes / 2 ** 20).toFixed(0)} MiB`} after unload` : 'worker did not confirm release');
    const kill = await w.terminate(this.opts.killGraceMs, `${reason}: the model's release could not be confirmed`);
    if (kill.confirmed && this.worker === w) { this.worker = null; this.loaded = null; } // an unconfirmed worker stays referenced: it may still hold the model, and a later stop must be able to retry
    rec.outcome = kill.confirmed ? 'killed' : 'kill-unconfirmed';
    if (!kill.confirmed) rec.detail += `; ${kill.reason ?? 'could not confirm the worker stopped'}`;
    return this.finish(rec, t0);
  }

  private finish(rec: Handover, t0: number): Handover {
    rec.waitedMs = Date.now() - t0;
    this.handovers.push(rec);
    this.onHandover?.(rec);
    return rec;
  }

  /** Wait until every worker that was being shut down has exited. */
  async settleRetired(): Promise<void> {
    while (this.retiring.size) await Promise.allSettled([...this.retiring]);
  }

  async shutdown(): Promise<void> {
    const w = this.worker;
    if (w && !w.exited) {
      this.worker = null; // retired first: work that starts while this worker winds down gets a fresh one, never this one
      this.loaded = null;
      const done = this.stopWorker(w);
      this.retiring.add(done);
      done.finally(() => this.retiring.delete(done)).catch(() => undefined);
    } else {
      this.worker = null;
      this.loaded = null;
    }
    await this.settleRetired();
  }

  private async stopWorker(w: WorkerHandle): Promise<void> {
    try { await w.request('shutdown', {}, {timeoutMs: 3000}); } catch { /* terminate below */ }
    // A worker that was asked to shut down gets time to do it (and its helper child to follow it); signals are for one that does not.
    const until = Date.now() + this.opts.killGraceMs;
    try { while (Date.now() < until && ownedAlive(this.reg, w.owner)) await new Promise((r) => setTimeout(r, 40)); } catch { /* cannot inspect: terminate below decides */ }
    await w.terminate(this.opts.killGraceMs, 'shutting down the audio worker');
    if (!w.exited) await new Promise<void>((res) => { const t = setTimeout(res, this.opts.killGraceMs + 500); w.child.once('exit', () => { clearTimeout(t); res(); }); }); // let the exit be observed before the caller closes the project
  }
}
