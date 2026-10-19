// Rebuilds and the jobs tray, on the project's own persistent job runner and handlers. This file adds no scheduler:
// it decides WHICH jobs a rebuild needs (from the dependency hashes), queues them on the runner in dependency order, and
// shows what the runner recorded. A rebuild is not a table of its own: each of its jobs carries {rebuild: {...}} in its params.
//
//   narration (one job per block that needs it) -> timing -> final mix -> final video
//
// A later step is queued only when the earlier ones have succeeded, because its inputs include their outputs. If the episode
// is edited meanwhile, the chain pauses instead of mixing documents. After a restart nothing is started again by itself.
import {existsSync, readFileSync} from 'node:fs';
import {findArtifactByInputs, getSnapshot, selectArtifact, statusReport, type JobKind} from '../core/artifacts.ts';
import {expectedNow} from '../core/artifacts.ts';
import {all, get} from '../core/db.ts';
import {getEpisodeInfo, listEpisodes} from '../core/episodes.ts';
import {makeHandlers, type HandlerEnv} from '../core/handlers.ts';
import {OwnerRegistry, systemMemory} from '../core/proc.ts';
import type {Project} from '../core/project.ts';
import {JobRunner, type JobRow, type RunnerOptions} from '../core/runner.ts';
import {unsupportedInputs} from '../core/support.ts';
import {captureRenderSources, defaultTools, renderToolProblems, renderSourceProblems, versionsValue, type ToolPaths} from '../core/toolchain.ts';
import {ModelHost, type HostOptions} from '../core/worker.ts';
import {currentRows, getComponentHashes, getComponentValues, setComponent} from '../core/state.ts';
import type {SnapshotManifest} from '../core/artifacts.ts';
import {buildPlan} from './plan.ts';
import type {MeasuredRuns} from './shared/costs.ts';
import type {ActiveWork, Plan} from './shared/plan-types.ts';

export type Stage = 'narration' | 'timing' | 'mix' | 'render' | 'checks';
export type BuildMode = 'draft' | 'final';
const GROUPS: Stage[] = ['narration', 'timing', 'mix', 'render'];
const kindOf = (stage: Stage, mode: BuildMode): JobKind => (stage === 'narration' ? 'tts.block' : stage === 'timing' ? 'timing.build' : stage === 'mix' ? `mix.${mode}` : stage === 'render' ? `render.${mode}` : 'check.suite');
const STAGE_OF: Record<string, Stage> = {'tts.block': 'narration', 'timing.build': 'timing', 'mix.final': 'mix', 'render.final': 'render', 'mix.draft': 'mix', 'render.draft': 'render', 'check.suite': 'checks'};
const ACTIVE = new Set(['queued', 'preparing', 'running', 'cancelling']);

export class RebuildError extends Error {
  code: 'busy' | 'changed' | 'blocked' | 'nothing' | 'unknown';
  detail: Record<string, unknown>;
  constructor(code: RebuildError['code'], message: string, detail: Record<string, unknown> = {}) {
    super(message);
    this.code = code;
    this.detail = detail;
  }
}

type RebuildMeta = {id: string; episodeId: string; docHash: string; seq: number; index: number; startedAt: number; requestId: string; /** Absent in rebuilds made before drafts existed: those are final builds. */ mode?: BuildMode};
const modeOf = (m: RebuildMeta): BuildMode => m.mode ?? 'final';

export type JobView = {
  id: number; episodeId: string; kind: string; stage: Stage; subject: string; label: string; state: string; attempts: number; createdAt: number; startedAt: number | null; finishedAt: number | null;
  elapsedMs: number | null; step: string | null; fraction: number | null; detail: unknown; error: string | null; friendlyError: string | null; note: string | null;
  rebuildId: string | null; revision: number | null; cacheHit: boolean; canCancel: boolean; canRetry: boolean;
  /** The seed a narration job generates with (a re-roll uses a new one). */
  seed: number | null;
  /** What the page should say it is doing: the recorded step, unless the engine does not agree with it (then what is really happening). */
  displayStep: string | null;
};

/** The audio engine as it really is, read from the model host and from the one heavy job the runner is running, so the two cannot disagree. */
export type EngineView = {
  worker: 'none' | 'running';
  pid: number | null;
  loaded: string | null;
  activity: 'stopped' | 'idle' | 'loading' | 'generating' | 'aligning' | 'releasing' | 'stopping' | 'working-elsewhere';
  summary: string;
  /** Resident set size (RSS) of the worker process. Not the total memory the model uses (MLX's unified-memory buffers are mostly not in it). */
  rssBytes: number | null;
  /** The heavy job this describes, if any. */
  job: {id: number; kind: string; subject: string; state: string; step: string | null} | null;
  lastHandover: {at: number; outcome: string; reason: string; rssBeforeBytes: number | null; rssAfterBytes: number | null} | null;
  /** Milliseconds until an idle worker is stopped, when it is idle and will be. */
  idleStopInMs: number | null;
};
export type RebuildView = {id: string; episodeId: string; startedAt: number; state: 'queued' | 'running' | 'complete' | 'failed' | 'cancelled' | 'stopped' | 'paused'; message: string; jobIds: number[]; canContinue: boolean; canCancel: boolean; revision: number | null;
  /** Why a paused rebuild is paused: the author edited after it began (new rebuild needed), or the app stopped (it can simply continue). */
  pausedBecause: 'edited' | 'restart' | null;
  /** Steps of this rebuild that finished, by plain name. */
  finished: string[]};

export type JobServiceOptions = {
  project: Project;
  env: HandlerEnv;
  /** Interpreter of the audio worker (the Qwen environment). */
  workerPython: string;
  /** measured-runs.json of the workspace, if any. */
  measuredFile?: string | null;
  runner?: Partial<RunnerOptions>;
  host?: Partial<HostOptions>;
  /** Stop the idle audio worker (and so free its memory) after this long with no work. */
  idleShutdownMs?: number;
};

/** The error text of a step that was waiting when the app stopped; shown as a plain sentence. */
const NOT_STARTED = 'not-started-after-restart';

export class JobService {
  readonly p: Project;
  readonly runner: JobRunner;
  readonly host: ModelHost;
  readonly tools: ToolPaths;
  private o: JobServiceOptions;
  private listeners = new Set<() => void>();
  private requests = new Map<string, string>();
  /** Rebuilds this process is still driving; after a restart there are none, so an unfinished chain shows as paused. */
  private watching = new Map<string, number>();
  private timer: NodeJS.Timeout;
  private digest = '';
  private idleSince: number | null = null;
  private closed = false;
  private sourceRoot: string;
  private seed: number;
  /** The seed a first generation of a block uses; a re-roll uses a new one. */
  get defaultSeed(): number { return this.seed; }

  constructor(o: JobServiceOptions) {
    this.o = o;
    this.p = o.project;
    const env = o.env;
    this.sourceRoot = env.sourceRoot ?? env.root;
    this.seed = env.defaultSeed ?? 11;
    this.tools = {...defaultTools(env.root), ...(env.audioWorker ? {audioWorker: env.audioWorker} : {}), ...(env.mixScript ? {mix: env.mixScript} : {}), ...(env.renderWorker ? {renderWorker: env.renderWorker} : {}), ...(env.probeWorker ? {probeWorker: env.probeWorker} : {}), ...(env.timelineFiles ? {timeline: env.timelineFiles} : {})};
    const reg = new OwnerRegistry(this.p.db, this.p.now);
    this.host = new ModelHost(reg, {cmd: o.workerPython, args: [this.tools.audioWorker], cwd: env.root, ...o.host});
    this.runner = new JobRunner(this.p, {
      host: this.host, reg, memory: systemMemory, pollMs: 1000, criticalSamples: 5, releaseBefore: (k) => k.startsWith('render.') || k === 'check.suite', preflight: unsupportedInputs,
      handlers: makeHandlers(env), ...o.runner,
    });
    this.leaveNothingWaiting();
    this.timer = setInterval(() => void this.tick(), 400);
    this.timer.unref();
  }

  /**
   * Work that was only waiting when the app stopped is not started by the new process: nothing expensive restarts by itself.
   * Left as 'queued' it would look like work in progress forever (blocking Retry and new rebuilds) while nothing runs it, so it
   * is cancelled, with the reason, and can be retried like any other step.
   */
  private leaveNothingWaiting(): void {
    for (const j of all<JobRow>(this.p.db.prepare("SELECT * FROM jobs WHERE state='queued'"))) {
      this.p.db.prepare("UPDATE jobs SET state='cancelled', error=?, finished_at=? WHERE id=? AND state='queued'").run(NOT_STARTED, this.p.now(), j.id);
      this.runner.event(j.id, null, 'cancelled', {while: 'queued', because: 'the app restarted before it started'});
    }
  }

  // ---- change notification (the server turns this into events) ----------------------------------------------------
  onChange(fn: () => void): () => void { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  private emit() { for (const l of this.listeners) l(); }
  private async tick(): Promise<void> {
    if (this.closed) return;
    try {
      const d = JSON.stringify([all(this.p.db.prepare('SELECT id, state, attempts, finished_at FROM jobs')), get(this.p.db.prepare('SELECT max(id) AS m FROM job_events')), [this.host.worker?.pid ?? null, !!this.host.worker && !this.host.worker.exited, this.host.loaded]]); // the engine too: a worker stopping on its own changes what the page shows
      if (d !== this.digest) { this.digest = d; this.emit(); }
      await this.checkIdle();
    } catch { /* the project was closed while the timer fired */ }
  }

  /** Stop the audio worker (and free its memory) once nothing has been queued or running for the configured time. */
  async checkIdle(idleMs: number = this.o.idleShutdownMs ?? 8000): Promise<void> {
    const busy = !!get(this.p.db.prepare("SELECT 1 FROM jobs WHERE state IN ('queued','preparing','running','cancelling')"));
    if (busy) { this.idleSince = null; return; }
    if (this.host.worker && !this.host.worker.exited) {
      this.idleSince ??= Date.now();
      if (Date.now() - this.idleSince >= idleMs) { this.idleSince = null; await this.host.shutdown(); }
    }
  }

  // ---- measurements for estimates --------------------------------------------------------------------------------
  /** Recorded runs of this sample plus every real (not cached, not imported) job this workspace has finished. */
  measuredRuns(): MeasuredRuns {
    const runs: MeasuredRuns['runs'] = [];
    if (this.o.measuredFile && existsSync(this.o.measuredFile)) runs.push(...(JSON.parse(readFileSync(this.o.measuredFile, 'utf8')) as MeasuredRuns).runs);
    const rows = all<{id: number; kind: string; subject: string; started_at: number; finished_at: number; meta_json: string}>(this.p.db.prepare(
      `SELECT j.id, j.kind, j.subject, a.started_at, a.finished_at, ar.meta_json FROM jobs j
         JOIN job_attempts a ON a.job_id=j.id AND a.state='succeeded' JOIN artifacts ar ON ar.id=j.artifact_id
        WHERE j.state IN ('succeeded','outdated') AND a.finished_at IS NOT NULL ORDER BY j.id`));
    for (const r of rows) {
      const meta = JSON.parse(r.meta_json) as {cacheHit?: boolean; imported?: unknown; words?: number; loadSec?: number; genSec?: number; durationSec?: number};
      if (meta.cacheHit || meta.imported || !(r.kind in STAGE_OF)) continue;
      const stage = STAGE_OF[r.kind];
      const take = stage === 'narration' && typeof meta.words === 'number' ? {words: meta.words, ...(typeof meta.loadSec === 'number' ? {loadSec: meta.loadSec} : {}), ...(typeof meta.genSec === 'number' ? {genSec: meta.genSec} : {}), ...(typeof meta.durationSec === 'number' ? {audioSec: meta.durationSec} : {})} : {};
      runs.push({kind: stage === 'narration' ? 'take' : stage === 'timing' ? 'timing' : stage, subject: stage === 'narration' ? r.subject : stage === 'timing' ? 'timeline' : r.kind.split('.')[1], seconds: Math.round((r.finished_at - r.started_at) / 100) / 10, source: `a rebuild in this workspace (job ${r.id})`, when: new Date(r.finished_at).toISOString().slice(0, 10), ...take});
    }
    return {version: 1, runs};
  }

  // ---- planning --------------------------------------------------------------------------------------------------
  activeWork(episodeId: string): ActiveWork | null {
    const rows = all<JobRow>(this.p.db.prepare("SELECT * FROM jobs WHERE episode_id=? AND state IN ('queued','preparing','running','cancelling') ORDER BY id"), episodeId);
    if (!rows.length) return null;
    const r = rows.find((x) => x.state !== 'queued') ?? rows[0];
    const meta = (JSON.parse(r.params_json) as {rebuild?: RebuildMeta}).rebuild;
    return {rebuildId: meta?.id ?? null, jobs: rows.length, description: `${this.label(r.kind, r.subject)} is ${r.state === 'queued' ? 'waiting' : r.state}`};
  }

  plan(episodeId: string, mode: BuildMode = 'final'): Plan {
    return buildPlan(this.p, episodeId, {tools: this.tools, sourceRoot: this.sourceRoot, seed: this.seed, measured: this.measuredRuns()}, this.activeWork(episodeId), mode);
  }

  /** Why the recorded render sources or tools no longer match the working copy; empty when they match. */
  renderDrift(episodeId: string): string[] {
    const values = getComponentValues(this.p, episodeId);
    return [
      ...renderSourceProblems(this.p, {components: getComponentHashes(this.p, episodeId)} as SnapshotManifest, this.sourceRoot),
      ...renderToolProblems(this.sourceRoot, values.versions as never, this.tools.renderWorker),
    ];
  }

  private sourceDrift(episodeId: string): {sources: boolean; tools: boolean} {
    const values = getComponentValues(this.p, episodeId);
    return {
      sources: renderSourceProblems(this.p, {components: getComponentHashes(this.p, episodeId)} as SnapshotManifest, this.sourceRoot).length > 0,
      tools: renderToolProblems(this.sourceRoot, values.versions as never, this.tools.renderWorker).length > 0,
    };
  }

  // ---- starting, continuing, cancelling, retrying -------------------------------------------------------------------
  startRebuild(episodeId: string, req: {seq: number; requestId: string; mode?: BuildMode}): {rebuildId: string; jobIds: number[]; repeated: boolean; reused: string[]} {
    const known = this.requests.get(req.requestId);
    if (known) return {rebuildId: known, jobIds: this.jobsOf(known).map((j) => j.id), repeated: true, reused: []};
    if (!listEpisodes(this.p).includes(episodeId)) throw new RebuildError('unknown', `No episode "${episodeId}" in this workspace.`);
    const active = this.activeWork(episodeId);
    if (active) throw new RebuildError('busy', `A rebuild is already in progress (${active.description}). Wait for it or cancel it first.`, {active});
    const info = getEpisodeInfo(this.p, episodeId);
    if (info.seq !== req.seq) throw new RebuildError('changed', 'The episode was saved again after this summary was made. Review the new summary before starting.', {seq: info.seq});
    const mode: BuildMode = req.mode ?? 'final';
    const plan = this.plan(episodeId, mode);
    if (plan.blockers.length) throw new RebuildError('blocked', 'This episode cannot be rebuilt yet.', {blockers: plan.blockers});
    if (plan.nothingToDo) throw new RebuildError('nothing', 'Everything is already up to date; there is nothing to rebuild.');
    const drift = this.sourceDrift(episodeId);
    if (drift.sources) captureRenderSources(this.p, this.sourceRoot);
    if (drift.tools) setComponent(this.p, 'versions', versionsValue(this.sourceRoot, this.tools.renderWorker));
    const meta: RebuildMeta = {id: `rb-${Date.now().toString(36)}`, episodeId, docHash: info.docHash, seq: info.seq, index: -1, startedAt: Date.now(), requestId: req.requestId, mode};
    this.requests.set(req.requestId, meta.id);
    const {ids, reused} = this.advance(meta);
    if (!ids.length && !reused.length) throw new RebuildError('nothing', 'Everything is already up to date; there is nothing to rebuild.');
    this.emit();
    return {rebuildId: meta.id, jobIds: ids, repeated: false, reused};
  }

  /** What each stage still needs, from the dependency hashes as they are now. */
  private needed(episodeId: string, stage: Stage, mode: BuildMode = 'final'): string[] {
    const st = statusReport(this.p, episodeId);
    if (stage === 'narration') return Object.entries(st.takes).filter(([, e]) => e.status !== 'fresh').map(([id]) => id);
    const e = stage === 'timing' ? st.timing : stage === 'mix' ? st.mix[mode] : st.render[mode];
    return e.status !== 'fresh' ? [''] : [];
  }

  /** An output made earlier from exactly the inputs a stage now has is selected instead of rebuilt. Returns its label if one was selected. */
  private reuseExisting(episodeId: string, stage: Stage, mode: BuildMode = 'final'): string | null {
    if (stage === 'narration') return null; // narration has its own cache inside the handler
    const {expected} = expectedNow(this.p, episodeId);
    const [kind, subject, hash] = stage === 'timing' ? ['timing', 'timeline', expected.timing] : stage === 'mix' ? ['mix', mode, expected.mix[mode]] : ['render', mode, expected.render[mode].hash];
    const hit = findArtifactByInputs(this.p, episodeId, kind, subject, hash);
    if (!hit) return null;
    const cur = currentRows(this.p, episodeId).find((r) => r.kind === kind && r.subject === subject);
    if (cur?.artifact_id === hit.artifactId) return null;
    selectArtifact(this.p, episodeId, hit.artifactId);
    return this.label(kindOf(stage, mode), '');
  }

  /** Queue the next stage (after `meta.index`) that has work, selecting saved outputs where they already match. */
  private advance(meta: RebuildMeta, anchor?: number): {ids: number[]; reused: string[]} {
    const reused: string[] = [];
    const record = (at: number | undefined) => { if (reused.length && at !== undefined) this.note(at, `reused without rebuilding: ${reused.join(', ')}`, 'rebuild-reused', {labels: reused}); };
    for (let i = meta.index + 1; i < GROUPS.length; i++) {
      const stage = GROUPS[i];
      const label = this.reuseExisting(meta.episodeId, stage, modeOf(meta));
      if (label) reused.push(label);
      const subjects = this.needed(meta.episodeId, stage, modeOf(meta));
      if (!subjects.length) continue;
      const next = {...meta, index: i};
      const ids = subjects.map((subject) => this.runner.enqueue({episodeId: meta.episodeId, jobKind: kindOf(stage, modeOf(meta)), ...(subject ? {subject} : {}), params: {rebuild: next, ...(stage === 'narration' ? {seed: this.seed} : {})}}));
      record(ids[0]);
      void this.watch(next);
      return {ids, reused};
    }
    record(anchor);
    return {ids: [], reused};
  }

  private jobsOf(rebuildId: string): JobRow[] {
    return all<JobRow>(this.p.db.prepare('SELECT * FROM jobs WHERE params_json LIKE ? ORDER BY id'), `%"id":"${rebuildId}"%`).filter((j) => (JSON.parse(j.params_json) as {rebuild?: RebuildMeta}).rebuild?.id === rebuildId);
  }
  private metaOf(j: JobRow): RebuildMeta | null { return (JSON.parse(j.params_json) as {rebuild?: RebuildMeta}).rebuild ?? null; }

  /** Wait for every job of this stage group, then queue the next one if all succeeded and the episode is unchanged. */
  private async watch(meta: RebuildMeta): Promise<void> {
    this.watching.set(meta.id, (this.watching.get(meta.id) ?? 0) + 1);
    try {
      const group = this.jobsOf(meta.id).filter((j) => this.metaOf(j)!.index === meta.index);
      await Promise.all(group.map((j) => this.runner.waitFor(j.id)));
      if (this.closed) return;
      const rows = this.jobsOf(meta.id).filter((j) => this.metaOf(j)!.index === meta.index);
      if (rows.some((j) => j.state !== 'succeeded')) return; // failed, cancelled or outdated: the chain stops and the tray says why
      if (this.jobsOf(meta.id).some((j) => this.metaOf(j)!.index > meta.index)) return; // already advanced (a retry finished late)
      if (getEpisodeInfo(this.p, meta.episodeId).docHash !== meta.docHash) { this.note(rows[rows.length - 1].id, 'paused: the episode was edited after the rebuild started, so the next step was not started on the new text', 'rebuild-paused', {because: 'edited', fromRevision: meta.seq}); return; }
      this.advance(meta, rows[rows.length - 1].id);
    } catch (e) {
      if (!this.closed) this.note(0, `could not continue: ${(e as Error).message}`);
    } finally {
      this.watching.set(meta.id, (this.watching.get(meta.id) ?? 1) - 1);
    }
  }
  private note(jobId: number, text: string, kind = 'rebuild-note', extra: Record<string, unknown> = {}) { try { this.runner.event(jobId, null, kind, {text, ...extra}); } catch { /* project closed */ } }

  /** After a restart or a pause: queue the next stage of a rebuild whose earlier stages all succeeded. */
  continueRebuild(rebuildId: string): number[] {
    const jobs = this.jobsOf(rebuildId);
    if (!jobs.length) throw new RebuildError('unknown', 'That rebuild is not known.');
    const last = this.metaOf(jobs[jobs.length - 1])!;
    if (this.activeWork(last.episodeId)) throw new RebuildError('busy', 'Work is already in progress for this episode.');
    if (jobs.some((j) => j.state !== 'succeeded')) throw new RebuildError('blocked', 'An earlier step did not succeed. Retry it from the jobs list first.');
    if (getEpisodeInfo(this.p, last.episodeId).docHash !== last.docHash) throw new RebuildError('changed', 'You edited the episode after this rebuild started. Start a new rebuild to include your edits.');
    const max = Math.max(...jobs.map((j) => this.metaOf(j)!.index));
    return this.advance({...last, index: max}, jobs[jobs.length - 1].id).ids;
  }

  async cancel(jobId: number): Promise<JobRow> {
    const r = await this.runner.cancel(jobId);
    this.emit();
    return r;
  }

  /** Cancel everything a rebuild still has queued or running. Only the jobs' own processes are stopped. */
  async cancelRebuild(rebuildId: string): Promise<void> {
    const open = this.jobsOf(rebuildId).filter((j) => ACTIVE.has(j.state));
    for (const j of open.filter((x) => x.state === 'queued')) await this.runner.cancel(j.id);
    for (const j of open.filter((x) => x.state !== 'queued')) await this.runner.cancel(j.id);
    this.emit();
  }

  retry(jobId: number): void {
    const j = this.runner.row(jobId);
    const meta = this.metaOf(j);
    // Other steps of the same rebuild may be waiting or running (they share the one heavy lane); work from anywhere else blocks a retry.
    const elsewhere = meta && all<JobRow>(this.p.db.prepare("SELECT * FROM jobs WHERE episode_id=? AND state IN ('queued','preparing','running','cancelling')"), j.episode_id).some((x) => this.metaOf(x)?.id !== meta.id);
    if (elsewhere) throw new RebuildError('busy', 'Other work is in progress for this episode. Retry once it finishes.');
    this.runner.retry(jobId);
    if (meta) void this.watch(meta);
    this.emit();
  }

  /** Queue the production checks of one rendered video. Nothing else is started; the result is a check report stored with the project. */
  startChecks(episodeId: string, renderArtifactId: number): number {
    const r = get<{kind: string; episode_id: string}>(this.p.db.prepare('SELECT kind, episode_id FROM artifacts WHERE id=?'), renderArtifactId);
    if (!r || r.kind !== 'render' || r.episode_id !== episodeId) throw new RebuildError('unknown', 'That is not a rendered video of this episode.');
    const open = all<JobRow>(this.p.db.prepare("SELECT * FROM jobs WHERE episode_id=? AND kind='check.suite' AND subject=? AND state IN ('queued','preparing','running','cancelling')"), episodeId, String(renderArtifactId));
    if (open.length) return open[0].id;
    const id = this.runner.enqueue({episodeId, jobKind: 'check.suite', subject: String(renderArtifactId), params: {renderArtifactId}});
    this.emit();
    return id;
  }

  // ---- what the tray shows -----------------------------------------------------------------------------------------
  label(kind: string, subject: string): string {
    const stage = STAGE_OF[kind];
    if (kind === 'check.suite') return 'Production checks';
    return stage === 'narration' ? `Narration, block ${subject}` : stage === 'timing' ? 'Timing and captions' : stage === 'mix' ? (kind === 'mix.draft' ? 'Draft audio mix' : 'Final audio mix') : kind === 'render.draft' ? 'Draft video' : 'Final video';
  }

  list(episodeId?: string, limit = 40, engine: EngineView = this.engine()): JobView[] {
    const rows = episodeId ? all<JobRow>(this.p.db.prepare('SELECT * FROM jobs WHERE episode_id=? ORDER BY id DESC LIMIT ?'), episodeId, limit) : all<JobRow>(this.p.db.prepare('SELECT * FROM jobs ORDER BY id DESC LIMIT ?'), limit);
    return rows.map((r) => this.view(r, engine));
  }

  private view(r: JobRow, engine: EngineView = this.engine()): JobView {
    const pr = this.runner.getProgress(r.id);
    const meta = this.metaOf(r);
    const art = r.artifact_id ? get<{meta_json: string}>(this.p.db.prepare('SELECT meta_json FROM artifacts WHERE id=?'), r.artifact_id) : undefined;
    const cacheHit = !!art && (JSON.parse(art.meta_json) as {cacheHit?: boolean}).cacheHit === true;
    let revision: number | null = null;
    try { revision = getSnapshot(this.p, r.snapshot_id).revision; } catch { /* snapshot gone */ }
    const interrupted = r.error === 'interrupted';
    const friendly = r.error === null ? null : interrupted ? 'The app stopped while this was running. Nothing was lost. You can retry it when you are ready.'
      : r.error === NOT_STARTED ? 'The app restarted before this step started, so it was not started. Nothing was lost. You can retry it when you are ready.'
      : r.error.replace(/\n- /g, ' - ').replace(/\n/g, ' ');
    const note = r.state === 'outdated' ? 'Finished, but your edits changed its inputs while it ran. It is kept as an earlier build and is not used for the current text.'
      : r.state === 'succeeded' && cacheHit ? 'Reused a saved take for exactly this text; nothing was generated.'
      : r.state === 'cancelled' ? 'Cancelled. Anything already finished is kept.' : null;
    return {
      id: r.id, episodeId: r.episode_id, kind: r.kind, stage: STAGE_OF[r.kind], subject: r.subject, label: this.label(r.kind, r.subject), state: r.state, attempts: r.attempts, createdAt: r.created_at, startedAt: r.started_at, finishedAt: r.finished_at,
      elapsedMs: pr.elapsedMs, step: pr.step, fraction: pr.fraction, detail: pr.detail, error: r.error, friendlyError: friendly, note, rebuildId: meta?.id ?? null, revision, cacheHit,
      canCancel: r.state === 'queued' || r.state === 'preparing' || r.state === 'running', canRetry: r.state === 'failed' || r.state === 'cancelled',
      seed: ((): number | null => { const s = (JSON.parse(r.params_json) as {seed?: unknown}).seed; return typeof s === 'number' ? s : null; })(),
      displayStep: this.displayStep(r, pr.step, engine),
    };
  }

  /** The step a job is shown at. A job never claims to be generating speech while the engine is not holding the voice model. */
  private displayStep(r: JobRow, step: string | null, engine: EngineView): string | null {
    if (r.state === 'queued') return 'waiting in the queue';
    if (r.kind === 'tts.block' && r.state === 'running' && step === 'generating speech' && !(engine.loaded === 'tts' && engine.worker === 'running')) return 'waiting for the voice engine';
    return step;
  }

  /** Worker, loaded model and the heavy job in one reading. */
  engine(): EngineView {
    const w = this.host.worker && !this.host.worker.exited ? this.host.worker : null;
    const heavy = get<JobRow>(this.p.db.prepare("SELECT * FROM jobs WHERE lane='heavy' AND state IN ('preparing','running','cancelling') ORDER BY id LIMIT 1"));
    const step = heavy ? this.runner.getProgress(heavy.id).step : null;
    const loaded = w ? this.host.loaded : null;
    const last = this.host.handovers.at(-1) ?? null;
    let activity: EngineView['activity'] = w ? 'idle' : 'stopped';
    let summary = w ? (loaded ? `The ${loaded === 'tts' ? 'voice' : loaded} model is loaded and the engine is idle.` : 'The audio worker is running with no model loaded.') : 'The voice engine is not running. Nothing is loaded and it holds no memory.';
    if (heavy) {
      const kind = heavy.kind;
      if (heavy.state === 'cancelling') { activity = 'stopping'; summary = 'Stopping the job and the processes it started; the engine is released when that is confirmed.'; }
      else if (kind === 'tts.block') {
        if (heavy.state === 'preparing' || step === null) summary = `Starting the job. ${summary}`;
        else if (step === 'loading the voice model' || (step === 'generating speech' && loaded !== 'tts')) { activity = 'loading'; summary = 'Loading the voice model.'; }
        else if (step === 'generating speech') { activity = 'generating'; summary = `The voice model is loaded and generating block ${heavy.subject}.`; }
        else { activity = loaded ? 'idle' : 'stopped'; summary = step.startsWith('cache hit') ? 'Reusing a saved take: the engine is not needed for it.' : summary; }
      } else if (kind === 'timing.build') {
        if (/loading the aligner/.test(step ?? '') || (/aligning/.test(step ?? '') && loaded !== 'aligner')) { activity = 'loading'; summary = 'Loading the alignment model.'; }
        else if (/aligning/.test(step ?? '')) { activity = 'aligning'; summary = 'The alignment model is loaded and measuring word times.'; }
        else { activity = loaded ? 'idle' : 'stopped'; summary = `Building the timeline (${step ?? 'starting'}).`; }
      } else if (kind.startsWith('render.') && heavy.state === 'preparing') { activity = 'releasing'; summary = 'Releasing the audio model before the video render starts.'; }
      else { activity = loaded ? 'working-elsewhere' : 'stopped'; summary = `${this.label(kind, heavy.subject)} is running${loaded ? ` while the ${loaded} model is still loaded` : '; the audio model is not loaded'}.`; }
    }
    return {
      worker: w ? 'running' : 'none', pid: w?.pid ?? null, loaded, activity, summary, rssBytes: w?.rssBytes() ?? null,
      job: heavy ? {id: heavy.id, kind: heavy.kind, subject: heavy.subject, state: heavy.state, step} : null,
      lastHandover: last ? {at: last.at, outcome: last.outcome, reason: last.reason, rssBeforeBytes: last.rssBeforeBytes, rssAfterBytes: last.rssAfterBytes} : null,
      idleStopInMs: !heavy && w && this.idleSince !== null ? Math.max(0, (this.o.idleShutdownMs ?? 8000) - (Date.now() - this.idleSince)) : null,
    };
  }

  rebuilds(episodeId: string, limit = 5): RebuildView[] {
    const byId = new Map<string, JobRow[]>();
    for (const j of all<JobRow>(this.p.db.prepare("SELECT * FROM jobs WHERE episode_id=? AND params_json LIKE '%\"rebuild\"%' ORDER BY id"), episodeId)) {
      const m = this.metaOf(j);
      if (m) byId.set(m.id, [...(byId.get(m.id) ?? []), j]);
    }
    const out: RebuildView[] = [];
    for (const [id, jobs] of [...byId].slice(-limit).reverse()) {
      const meta = this.metaOf(jobs[jobs.length - 1])!;
      const states = jobs.map((j) => j.state);
      let state: RebuildView['state'];
      let message: string;
      let canContinue = false;
      let pausedBecause: RebuildView['pausedBecause'] = null;
      const finished = [...new Set(jobs.filter((j) => j.state === 'succeeded').map((j) => this.label(j.kind, j.subject)))];
      if (states.some((s) => ACTIVE.has(s))) { state = states.every((s) => s === 'queued') ? 'queued' : 'running'; message = 'Rebuild in progress'; }
      else if (states.includes('failed')) { state = 'failed'; message = 'A step failed. The earlier build is still available.'; }
      else if (states.includes('cancelled')) { state = 'cancelled'; message = 'Cancelled. The earlier build is still available.'; }
      else if (states.includes('outdated')) { state = 'stopped'; message = 'Stopped: your edits changed the inputs while a step was running. Its result is kept as an earlier build. Rebuild again to include your edits.'; }
      else if ((this.watching.get(id) ?? 0) > 0) { state = 'running'; message = 'Starting the next step'; }
      else {
        const max = Math.max(...jobs.map((j) => this.metaOf(j)!.index));
        const left = GROUPS.slice(max + 1).some((s) => this.needed(episodeId, s, modeOf(meta)).length > 0);
        const edited = getEpisodeInfo(this.p, episodeId).docHash !== meta.docHash;
        if (!left) { state = 'complete'; message = 'Rebuild finished'; }
        else if (edited) {
          state = 'paused'; pausedBecause = 'edited';
          message = `Paused because you edited the episode after this rebuild started. The remaining steps were not started: they would have used your new text instead of the text this rebuild began with, and a rebuild never swaps its inputs part-way. ${finished.length ? `Finished and kept: ${finished.join(', ')}. ` : ''}Use Rebuild to include your edits; anything finished that still applies is reused.`;
        } else { state = 'paused'; pausedBecause = 'restart'; message = 'Paused before the remaining steps (for example after the app restarted). Nothing was started automatically.'; canContinue = true; }
      }
      const reusedLabels = all<{data_json: string}>(this.p.db.prepare(`SELECT data_json FROM job_events WHERE kind='rebuild-reused' AND job_id IN (${jobs.map(() => '?').join(',')})`), ...jobs.map((j) => j.id)).flatMap((e) => (JSON.parse(e.data_json) as {labels: string[]}).labels);
      if (reusedLabels.length) message += `${/[.!?]$/.test(message) ? '' : '.'} Reused without rebuilding: ${[...new Set(reusedLabels)].join(', ')}.`;
      out.push({id, episodeId, startedAt: meta.startedAt, state, message, jobIds: jobs.map((j) => j.id), canContinue, canCancel: states.some((s) => ACTIVE.has(s)), revision: this.view(jobs[0]).revision, pausedBecause, finished});
    }
    return out;
  }

  /** Stop work cleanly (running jobs are cancelled, which stops only their own processes) and release the audio worker. */
  async shutdown(): Promise<void> {
    this.closed = true;
    clearInterval(this.timer);
    const open = all<JobRow>(this.p.db.prepare("SELECT * FROM jobs WHERE state IN ('queued','preparing','running')"));
    for (const j of open) { try { await this.runner.cancel(j.id); } catch { /* already settled */ } }
    this.runner.stop();
    await this.runner.shutdown();
  }
}
