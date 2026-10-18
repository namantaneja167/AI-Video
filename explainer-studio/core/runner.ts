// Persistent job runner. Jobs are rows in the project database (queued, preparing, running, ...), each attempt is a
// row, every process a job starts is recorded with its identity, and progress is stored as it happens.
//
//   * one HEAVY job at a time (TTS, alignment, mix, render); light jobs run beside it up to a small limit;
//   * every job runs on the immutable snapshot taken when it was enqueued;
//   * before a render starts the model host unloads the audio model and confirms memory was released;
//   * cancel stops only processes recorded as owned by the job's attempt (identity-checked), then frees the slot;
//   * a worker crash is retried once automatically; everything else needs a manual retry.
import type {ChildProcess, SpawnOptions} from 'node:child_process';
import {mkdirSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import type {EpisodeV2} from '../src/schema2.ts';
import {createJob, finishJob, getSnapshot, type JobKind, type NewJob, type SnapshotManifest} from './artifacts.ts';
import {readBlob} from './blobs.ts';
import {all, get} from './db.ts';
import type {Project} from './project.ts';
import {killOwned, OwnerRegistry, ownedRssBytes, spawnOwned, systemMemory, type MemoryProbe} from './proc.ts';
import {WorkerCrashError, type Handover, type ModelHost} from './worker.ts';

export class PreflightError extends Error {}
export class CancelledError extends Error {}

export type ProgressUpdate = {step: string; /** Only when the handler knows a real total (frames rendered of frames to render). */ fraction?: number; detail?: unknown};
export type JobResult = {blobHash: string; meta?: Record<string, unknown>; seed?: number};

export type JobCtx = {
  p: Project;
  jobId: number;
  kind: JobKind;
  subject: string;
  episodeId: string;
  attempt: number;
  owner: string;
  ws: string;
  doc: EpisodeV2;
  snapshot: SnapshotManifest;
  params: Record<string, unknown>;
  signal: AbortSignal;
  reg: OwnerRegistry;
  host: ModelHost | null;
  progress: (u: ProgressUpdate) => void;
  spawn: (role: string, cmd: string, args: string[], opts?: SpawnOptions) => ChildProcess;
  /** Allow this job (and so its cancellation) to stop the shared audio worker it is using. */
  leaseHost: () => void;
};
export type JobHandler = (ctx: JobCtx) => Promise<JobResult>;

export type JobRow = {
  id: number; episode_id: string; kind: JobKind; subject: string; snapshot_id: string; state: string; lane: 'heavy' | 'light';
  attempts: number; error: string | null; artifact_id: number | null; created_at: number; started_at: number | null; finished_at: number | null; params_json: string;
};
export const TERMINAL = new Set(['succeeded', 'outdated', 'failed', 'cancelled', 'cached']);

export type RunnerOptions = {
  handlers: Partial<Record<JobKind, JobHandler>>;
  host?: ModelHost | null;
  memory?: MemoryProbe;
  reg?: OwnerRegistry;
  maxLight?: number;
  autoRetries?: number;
  /** Process/memory sampling period while a job runs. */
  pollMs?: number;
  /** Consecutive critical-pressure samples that stop the job (the Qwen runs used 5 samples 2 s apart). */
  criticalSamples?: number;
  /** Kinds that must not start while an audio model is loaded. */
  releaseBefore?: (kind: JobKind) => boolean;
  killGraceMs?: number;
};

type Active = {
  job: JobRow; ctl: AbortController; attemptId: number; owner: string; reason: 'cancel' | 'memory' | null; memoryMessage?: string;
  done: Promise<void>; lastStep: string | null; lastWrite: number; peakRss: number; pressureMax: number; critical: number; cancelKill?: {confirmed: boolean; reason?: string};
};

export class JobRunner {
  readonly p: Project;
  readonly reg: OwnerRegistry;
  readonly host: ModelHost | null;
  private handlers: RunnerOptions['handlers'];
  private o: Required<Pick<RunnerOptions, 'maxLight' | 'autoRetries' | 'pollMs' | 'criticalSamples' | 'killGraceMs'>> & RunnerOptions;
  private active = new Map<number, Active>();
  private waiters = new Map<number, ((j: JobRow) => void)[]>();
  private idleWaiters: (() => void)[] = [];
  private stopped = false;

  constructor(p: Project, o: RunnerOptions) {
    this.p = p;
    this.reg = o.reg ?? new OwnerRegistry(p.db, p.now);
    this.host = o.host ?? null;
    this.handlers = o.handlers;
    this.o = {maxLight: 2, autoRetries: 1, pollMs: 500, criticalSamples: 5, killGraceMs: 1500, ...o};
    if (this.host) this.host.onHandover = (h) => this.event(null, null, 'handover', h);
  }

  // ---- queue -----------------------------------------------------------------------------------------------
  enqueue(spec: NewJob): number {
    const {jobId} = createJob(this.p, spec, 'queued');
    this.event(jobId, null, 'queued', {kind: spec.jobKind, subject: spec.subject ?? null});
    this.kick();
    return jobId;
  }

  /** Manual retry of a failed or cancelled job: same snapshot, a new attempt. */
  retry(jobId: number): void {
    const j = this.row(jobId);
    if (j.state !== 'failed' && j.state !== 'cancelled') throw new Error(`job ${jobId} is ${j.state}; only failed or cancelled jobs can be retried`);
    this.p.tx('retry', () => {
      this.p.db.prepare("UPDATE jobs SET state='queued', error=NULL, finished_at=NULL WHERE id=?").run(jobId);
      this.event(jobId, null, 'retry', {attempt: j.attempts + 1});
    });
    this.kick();
  }

  row(jobId: number): JobRow {
    const r = get<JobRow>(this.p.db.prepare('SELECT * FROM jobs WHERE id=?'), jobId);
    if (!r) throw new Error(`no job ${jobId}`);
    return r;
  }

  /** Resolves when the job reaches a terminal state. */
  waitFor(jobId: number): Promise<JobRow> {
    const r = this.row(jobId);
    if (TERMINAL.has(r.state)) return Promise.resolve(r);
    return new Promise((res) => this.waiters.set(jobId, [...(this.waiters.get(jobId) ?? []), res]));
  }

  /** Resolves when nothing is queued or running. */
  idle(): Promise<void> {
    if (this.isIdle()) return Promise.resolve();
    return new Promise((res) => this.idleWaiters.push(res));
  }
  private isIdle(): boolean {
    return this.active.size === 0 && !get(this.p.db.prepare("SELECT 1 FROM jobs WHERE state='queued'"));
  }

  private kick(): void {
    queueMicrotask(() => this.schedule());
  }

  private schedule(): void {
    if (this.stopped) return;
    const queued = all<JobRow>(this.p.db.prepare("SELECT * FROM jobs WHERE state='queued' ORDER BY id"));
    for (const job of queued) {
      if (this.active.has(job.id)) continue;
      const heavyBusy = job.lane === 'heavy' && get(this.p.db.prepare("SELECT 1 FROM jobs WHERE lane='heavy' AND state IN ('preparing','running','cancelling')"));
      const lightRunning = [...this.active.values()].filter((a) => a.job.lane === 'light').length;
      if (heavyBusy) continue; // one heavy job at a time, strictly in queue order
      if (job.lane === 'light' && lightRunning >= this.o.maxLight) continue;
      this.begin(job);
      if (job.lane === 'heavy') break;
    }
    if (this.isIdle()) { for (const w of this.idleWaiters.splice(0)) w(); }
  }

  stop(): void { this.stopped = true; }

  // ---- events and progress -------------------------------------------------------------------------------------
  event(jobId: number | null, attemptId: number | null, kind: string, data: unknown): void {
    this.p.db.prepare('INSERT INTO job_events(job_id,attempt_id,at,kind,data_json) VALUES(?,?,?,?,?)').run(jobId ?? 0, attemptId, this.p.now(), kind, JSON.stringify(data ?? {}));
  }

  /** What a UI may show: the real step, elapsed time, and a fraction ONLY if the handler reported a real total. */
  getProgress(jobId: number): {state: string; attempt: number; step: string | null; fraction: number | null; elapsedMs: number | null; detail: unknown; error: string | null} {
    const j = this.row(jobId);
    const att = get<{id: number; started_at: number; finished_at: number | null}>(this.p.db.prepare('SELECT id, started_at, finished_at FROM job_attempts WHERE job_id=? ORDER BY n DESC LIMIT 1'), jobId);
    const ev = att ? get<{data_json: string}>(this.p.db.prepare("SELECT data_json FROM job_events WHERE job_id=? AND attempt_id=? AND kind='progress' ORDER BY id DESC LIMIT 1"), jobId, att.id) : undefined;
    const d = ev ? (JSON.parse(ev.data_json) as {step: string; fraction: number | null; detail: unknown}) : null;
    const elapsed = att ? (att.finished_at ?? this.p.now()) - att.started_at : null;
    return {state: j.state, attempt: j.attempts, step: d?.step ?? (j.state === 'queued' ? 'waiting in queue' : null), fraction: d?.fraction ?? null, elapsedMs: elapsed, detail: d?.detail ?? null, error: j.error};
  }

  // ---- running a job ---------------------------------------------------------------------------------------
  private begin(job: JobRow): void {
    const n = job.attempts + 1;
    const attemptId = this.p.tx('begin', () => {
      this.p.db.prepare("UPDATE jobs SET state='preparing', attempts=?, started_at=COALESCE(started_at, ?), error=NULL WHERE id=?").run(n, this.p.now(), job.id);
      return Number(this.p.db.prepare("INSERT INTO job_attempts(job_id,n,state,started_at) VALUES(?,?, 'preparing', ?)").run(job.id, n, this.p.now()).lastInsertRowid);
    });
    const act: Active = {job: {...job, attempts: n}, ctl: new AbortController(), attemptId, owner: `attempt:${attemptId}`, reason: null, done: Promise.resolve(), lastStep: null, lastWrite: 0, peakRss: 0, pressureMax: 0, critical: 0};
    this.active.set(job.id, act);
    act.done = this.run(act).catch(() => { /* run() records its own outcome */ }).finally(() => {
      this.active.delete(job.id);
      const now = this.row(job.id);
      if (TERMINAL.has(now.state)) { for (const w of this.waiters.get(job.id) ?? []) w(now); this.waiters.delete(job.id); } // an auto-retry stays pending
      this.schedule();
    });
  }

  private setAttempt(act: Active, state: string, error?: string): void {
    this.p.db.prepare('UPDATE job_attempts SET state=?, error=?, finished_at=?, peak_rss_bytes=?, pressure_max=? WHERE id=?').run(state, error ?? null, this.p.now(), act.peakRss || null, act.pressureMax || null, act.attemptId);
  }

  private async run(act: Active): Promise<void> {
    const {job} = act;
    const handler = this.handlers[job.kind];
    const ws = join(this.p.tmpDir, `${job.id}-${job.attempts}`);
    let timer: NodeJS.Timeout | undefined;
    let outcome: {state: 'failed' | 'cancelled' | 'queued'; error?: string} | null = null;
    try {
      if (!handler) throw new Error(`no handler for ${job.kind}`);
      const mem = this.o.memory?.();
      if (mem && mem.pressure >= 4) throw new PreflightError(`memory pressure is critical (level ${mem.pressure}); not starting a heavy job`);
      if (job.lane === 'heavy' && this.host && this.o.releaseBefore?.(job.kind)) {
        const h: Handover = await this.host.unloadAndConfirm(`before ${job.kind}`);
        this.event(job.id, act.attemptId, 'handover', h);
        if (h.outcome === 'kill-unconfirmed') throw new PreflightError(`could not confirm the audio model was released before ${job.kind}: ${h.detail ?? ''}`);
      }
      if (act.ctl.signal.aborted) throw new CancelledError('cancelled while preparing');
      mkdirSync(ws, {recursive: true});
      this.p.tx('running', () => {
        this.p.db.prepare("UPDATE jobs SET state='running' WHERE id=? AND state='preparing'").run(job.id);
        this.p.db.prepare("UPDATE job_attempts SET state='running' WHERE id=?").run(act.attemptId);
        this.event(job.id, act.attemptId, 'running', {});
      });
      timer = setInterval(() => this.sample(act), this.o.pollMs);
      const snapshot = getSnapshot(this.p, job.snapshot_id);
      const doc = JSON.parse(readBlob(this.p, snapshot.docBlob).toString()) as EpisodeV2;
      const ctx: JobCtx = {
        p: this.p, jobId: job.id, kind: job.kind, subject: job.subject, episodeId: job.episode_id, attempt: job.attempts, owner: act.owner, ws, doc, snapshot,
        params: JSON.parse(job.params_json), signal: act.ctl.signal, reg: this.reg, host: this.host,
        progress: (u) => this.progress(act, u),
        spawn: (role, cmd, args, opts = {}) => spawnOwned(this.reg, act.owner, role, cmd, args, {...opts, env: {...process.env, ...opts.env, STUDIO_JOB: String(job.id), STUDIO_ATTEMPT: String(act.attemptId)}}),
        leaseHost: () => this.host?.leaseTo(act.owner),
      };
      const aborted = new Promise<never>((_, rej) => act.ctl.signal.addEventListener('abort', () => rej(new CancelledError(act.reason === 'memory' ? 'stopped by the memory guard' : 'cancelled'))));
      aborted.catch(() => {});
      const result = await Promise.race([handler(ctx), aborted]);
      if (act.ctl.signal.aborted) throw new CancelledError('cancelled');
      const fin = finishJob(this.p, job.id, result);
      this.setAttempt(act, 'succeeded');
      this.event(job.id, act.attemptId, 'finished', fin);
    } catch (e) {
      const err = e as Error;
      if (act.reason === 'memory') outcome = {state: 'failed', error: act.memoryMessage ?? 'stopped by the memory guard'};
      else if (act.reason === 'cancel' || err instanceof CancelledError) {
        outcome = act.cancelKill && !act.cancelKill.confirmed
          ? {state: 'failed', error: `cancelled, but could not confirm that every process stopped: ${act.cancelKill.reason ?? 'unknown'}`}
          : {state: 'cancelled'};
      } else if (err instanceof WorkerCrashError && job.attempts <= this.o.autoRetries) outcome = {state: 'queued', error: err.message};
      else outcome = {state: 'failed', error: err.message};
    } finally {
      if (timer) clearInterval(timer);
      this.sample(act);
      if (act.reason) await killOwned(this.reg, act.owner, {graceMs: this.o.killGraceMs}).catch(() => undefined); // includes the leased worker
      else this.reg.release(act.owner, 'host-lease'); // a worker that is still healthy keeps running for the next job
      await killOwned(this.reg, act.owner, {graceMs: this.o.killGraceMs}).catch(() => undefined); // leftovers (ffmpeg, browsers)
      this.reg.release(act.owner);
      rmSync(ws, {recursive: true, force: true});
    }
    if (outcome) {
      this.p.tx('settle', () => {
        const cur = this.row(job.id);
        if (TERMINAL.has(cur.state) && cur.state !== 'failed') return;
        this.p.db.prepare('UPDATE jobs SET state=?, error=?, finished_at=? WHERE id=?').run(outcome!.state, outcome!.error ?? null, outcome!.state === 'queued' ? null : this.p.now(), job.id);
        this.setAttempt(act, outcome!.state === 'queued' ? 'failed' : outcome!.state, outcome!.error);
        this.event(job.id, act.attemptId, outcome!.state === 'queued' ? 'auto-retry' : outcome!.state, {error: outcome!.error ?? null});
      });
    }
  }

  private progress(act: Active, u: ProgressUpdate): void {
    if (act.ctl.signal.aborted) return;
    if (u.fraction !== undefined && !(Number.isFinite(u.fraction) && u.fraction >= 0 && u.fraction <= 1)) throw new Error(`progress fraction must be within 0..1 (got ${u.fraction}); omit it when the total is unknown`);
    const now = Date.now();
    if (u.step === act.lastStep && now - act.lastWrite < 250) return;
    act.lastStep = u.step;
    act.lastWrite = now;
    this.event(act.job.id, act.attemptId, 'progress', {step: u.step, fraction: u.fraction ?? null, detail: u.detail ?? null});
  }

  /** Record owned processes and their memory; stop the job if pressure stays critical. */
  private sample(act: Active): void {
    try { act.peakRss = Math.max(act.peakRss, ownedRssBytes(this.reg, act.owner)); } catch { /* inspection unavailable: peak simply not updated */ }
    const m = this.o.memory?.();
    if (!m) return;
    act.pressureMax = Math.max(act.pressureMax, m.pressure);
    act.critical = m.pressure >= 4 ? act.critical + 1 : 0;
    if (act.critical >= this.o.criticalSamples && !act.reason) {
      act.reason = 'memory';
      act.memoryMessage = `memory pressure stayed critical for ${act.critical} consecutive samples; the job was stopped`;
      act.ctl.abort();
      void killOwned(this.reg, act.owner, {graceMs: this.o.killGraceMs});
    }
  }

  // ---- cancellation ----------------------------------------------------------------------------------------
  /** Stop a job. Queued jobs are simply cancelled; running jobs have every process they own stopped and confirmed. */
  async cancel(jobId: number): Promise<JobRow> {
    const j = this.row(jobId);
    if (j.state === 'queued') {
      this.p.tx('cancel', () => {
        this.p.db.prepare("UPDATE jobs SET state='cancelled', finished_at=? WHERE id=? AND state='queued'").run(this.p.now(), jobId);
        this.event(jobId, null, 'cancelled', {while: 'queued'});
      });
      for (const w of this.waiters.get(jobId) ?? []) w(this.row(jobId));
      this.waiters.delete(jobId);
      this.schedule();
      return this.row(jobId);
    }
    const act = this.active.get(jobId);
    if (!act) return j; // already finished
    act.reason = 'cancel';
    this.p.tx('cancelling', () => {
      this.p.db.prepare("UPDATE jobs SET state='cancelling' WHERE id=? AND state IN ('preparing','running')").run(jobId);
      this.p.db.prepare("UPDATE job_attempts SET state='cancelling' WHERE id=?").run(act.attemptId);
      this.event(jobId, act.attemptId, 'cancelling', {});
    });
    act.ctl.abort();
    act.cancelKill = await killOwned(this.reg, act.owner, {graceMs: this.o.killGraceMs, handles: []});
    await act.done;
    return this.row(jobId);
  }

  async shutdown(): Promise<void> {
    this.stop();
    await this.host?.shutdown();
  }
}

export {systemMemory};
