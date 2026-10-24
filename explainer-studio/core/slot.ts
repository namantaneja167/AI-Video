// Machine-wide production slot. The job runner already runs one heavy job at a time WITHIN a project; two apps open on two
// projects would each start one. On a 16 GB Mac that is two models or renders at once, so every heavy job also takes this
// one slot, shared by all Explainer Studio processes of the same user.
//
// The claim is one row in a small SQLite file. SQLite's file locking is the OS-backed primitive: taking the row happens inside
// one `BEGIN IMMEDIATE` transaction, which the operating system serialises across processes and releases if the process dies
// (the half-done transaction is rolled back). So acquisition, stale recovery and release are each one exclusive transaction:
//   * there is no lock file or mutex to recover, so two recoverers cannot both act on the same stale claim: the second one
//     waits for the first to commit and then sees the first one's fresh claim;
//   * a claim is removed only `WHERE token = ours` inside the transaction, so a late or repeated release after ownership changed
//     deletes nothing.
//
// Who counts as "gone": the claim records the holder app's pid and start time and its project folder. A claim is stale only when
// BOTH the app is confirmed gone (no such pid, or the pid has another start time) AND no process that project's own registry
// (job_procs, the records the job runner keeps for its workers) still lists is alive with the recorded identity. So an app that
// dies while its heavy worker keeps running keeps the slot held until the worker ends (or the project is opened again, which
// stops its recorded leftovers through the existing recovery). Anything that cannot be inspected is "unknown", and unknown
// never lets a second job in. Nothing here signals, stops or inspects another project's work beyond reading those records.
//
// A waiting request holds nothing: it is a queued job in its own project, so cancelling it touches only that project.
// Limits: one machine and one local disk (SQLite file locks are not reliable on a network folder); workers a project never
// recorded are not known.
import {randomBytes} from 'node:crypto';
import {existsSync, mkdirSync} from 'node:fs';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {defaultProbe, judgeHolder, type ProcessProbe} from './lock.ts';
import {descendantsOf, isZombie, snapshotProcs} from './proc.ts';

export type SlotClaim = {project: string; projectRoot: string; /** Plain words: what the job is. */ job: string};
export type SlotHolder = SlotClaim & {pid: number; started: string | null; token: string; since: number};
export type Orphan = {pid: number; role: string};
export type SlotRead =
  | {state: 'free'; /** A holder that was confirmed gone and will be replaced by the next claim. */ stale: SlotHolder | null}
  | {state: 'held'; holder: SlotHolder; mine: boolean; /** The holder's app is gone but processes its project recorded are still running: the slot stays held. */ orphans: Orphan[]}
  | {state: 'unknown'; why: string; holder: SlotHolder | null};
export type SlotAttempt = {ok: true; holder: SlotHolder; release: () => void} | {ok: false; why: string; holder: SlotHolder | null; unknown: boolean; orphans: Orphan[]};

/** Processes a project's registry still lists as running, with the identity they were recorded with. */
export type RecordedWorkers = {alive: Orphan[]} | {unknown: string};
export type WorkerLookup = (projectRoot: string) => RecordedWorkers;

/** Where the slot lives. STUDIO_SLOT_DIR overrides it (tests use a temporary folder). */
export function defaultSlotDir(): string {
  return process.env.STUDIO_SLOT_DIR || join(homedir(), '.explainer-studio');
}

export const SLOT_SCHEMA = 'CREATE TABLE IF NOT EXISTS claim(id INTEGER PRIMARY KEY CHECK (id = 1), token TEXT NOT NULL, pid INTEGER NOT NULL, started TEXT, project TEXT NOT NULL, project_root TEXT NOT NULL, job TEXT NOT NULL, since INTEGER NOT NULL)';

/** Read-only look at the project's own record of its workers, identity-checked against the process table. */
export const recordedWorkers: WorkerLookup = (projectRoot) => {
  const file = join(projectRoot, '.studio', 'project.sqlite');
  if (!existsSync(file)) return {alive: []};
  let rows: {pid: number; start: string; role: string}[];
  let db: DatabaseSync | null = null;
  try {
    db = new DatabaseSync(file, {readOnly: true});
    db.exec('PRAGMA busy_timeout = 1000');
    rows = db.prepare('SELECT pid, start, role FROM job_procs WHERE gone_at IS NULL').all() as typeof rows;
  } catch (e) {
    return {unknown: `the worker records of ${projectRoot} cannot be read (${(e as Error).message})`};
  } finally { try { db?.close(); } catch { /* closed */ } }
  if (!rows.length) return {alive: []};
  let procs;
  try { procs = snapshotProcs(); } catch (e) { return {unknown: `the process table cannot be read (${(e as Error).message})`}; }
  const roots = rows.filter((r) => procs.get(r.pid)?.start === r.start && !isZombie(procs.get(r.pid)!));
  const below = descendantsOf(procs, roots.map((r) => r.pid)).filter((pid) => !roots.some((r) => r.pid === pid) && !isZombie(procs.get(pid)!));
  return {alive: [...roots.map((r) => ({pid: r.pid, role: r.role})), ...below.map((pid) => ({pid, role: 'descendant'}))]};
};

type Row = {token: string; pid: number; started: string | null; project: string; project_root: string; job: string; since: number};
const toHolder = (r: Row): SlotHolder => ({token: r.token, pid: r.pid, started: r.started, project: r.project, projectRoot: r.project_root, job: r.job, since: r.since});
type Judged = {kind: 'live'; orphans: Orphan[]} | {kind: 'stale'} | {kind: 'unknown'; why: string};

export class ProductionSlot {
  readonly dir: string;
  readonly path: string;
  private db: DatabaseSync | null = null;
  private busyMs: number;
  private probe: ProcessProbe;
  private workers: WorkerLookup;
  private hooks: {afterStaleJudged?: (stale: SlotHolder) => void};
  private held = new Map<string, () => void>();

  constructor(o: {dir?: string; probe?: ProcessProbe; workers?: WorkerLookup; /** How long a claim waits for another process's transaction (the app stays responsive: it is milliseconds in practice). */ busyMs?: number; /** Test hook: runs inside the exclusive transaction between judging a claim stale and replacing it. */ hooks?: {afterStaleJudged?: (stale: SlotHolder) => void}} = {}) {
    this.dir = o.dir ?? defaultSlotDir();
    this.path = join(this.dir, 'production-slot.sqlite');
    this.probe = o.probe ?? defaultProbe;
    this.workers = o.workers ?? recordedWorkers;
    this.busyMs = o.busyMs ?? 250;
    this.hooks = o.hooks ?? {};
    mkdirSync(this.dir, {recursive: true});
  }

  private conn(): DatabaseSync {
    if (!this.db) {
      const db = new DatabaseSync(this.path);
      try {
        db.exec(`PRAGMA busy_timeout = ${this.busyMs}; PRAGMA journal_mode = DELETE; PRAGMA synchronous = FULL`);
        db.exec(SLOT_SCHEMA);
      } catch (e) { try { db.close(); } catch { /* closed */ } throw e; }
      this.db = db;
    }
    return this.db;
  }
  close(): void { try { this.db?.close(); } catch { /* closed */ } this.db = null; }

  private rowOf(db: DatabaseSync): Row | undefined { return db.prepare('SELECT token, pid, started, project, project_root, job, since FROM claim WHERE id = 1').get() as Row | undefined; }

  private judge(h: SlotHolder): Judged {
    const app = judgeHolder({pid: h.pid, started: h.started}, this.probe(h.pid));
    if (app.kind === 'live') return {kind: 'live', orphans: []};
    if (app.kind === 'unknown') return {kind: 'unknown', why: app.why};
    const w = this.workers(h.projectRoot);
    if ('unknown' in w) return {kind: 'unknown', why: `${h.project}'s app is gone but its workers cannot be checked: ${w.unknown}`};
    return w.alive.length ? {kind: 'live', orphans: w.alive} : {kind: 'stale'};
  }

  /** What the slot is right now. Never changes anything. */
  read(): SlotRead {
    let row: Row | undefined;
    try { row = this.rowOf(this.conn()); } catch (e) {
      return {state: 'unknown', why: isBusy(e) ? 'the slot is being updated by another process' : `the slot record cannot be read (${(e as Error).message})`, holder: null};
    }
    if (!row) return {state: 'free', stale: null};
    const h = toHolder(row);
    const j = this.judge(h);
    if (j.kind === 'stale') return {state: 'free', stale: h};
    if (j.kind === 'unknown') return {state: 'unknown', why: j.why, holder: h};
    return {state: 'held', holder: h, mine: this.held.has(h.token), orphans: j.orphans};
  }

  /** Take the slot if it is free (or its holder is confirmed gone). Never waits for the holder and never touches its processes. */
  tryAcquire(claim: SlotClaim): SlotAttempt {
    let db: DatabaseSync;
    const refuse = (why: string, holder: SlotHolder | null, unknown: boolean, orphans: Orphan[] = []): SlotAttempt => ({ok: false, why, holder, unknown, orphans});
    try {
      db = this.conn();
      db.exec('BEGIN IMMEDIATE');
    } catch (e) {
      return isBusy(e) ? refuse('another process is claiming the slot at this moment', null, false) : refuse(`the slot cannot be used (${(e as Error).message})`, null, true);
    }
    let committed = false;
    try {
      const row = this.rowOf(db);
      if (row) {
        const h = toHolder(row);
        const j = this.judge(h);
        if (j.kind === 'live') return refuse(j.orphans.length ? `${h.project}'s app has stopped but its work is still running` : `${h.project} is using the production slot`, h, false, j.orphans);
        if (j.kind === 'unknown') return refuse(j.why, h, true);
        this.hooks.afterStaleJudged?.(h);
        db.prepare('DELETE FROM claim WHERE token = ?').run(h.token);
      }
      const me = this.probe(process.pid);
      const holder: SlotHolder = {...claim, pid: process.pid, started: me.state === 'alive' ? me.started : null, token: randomBytes(8).toString('hex'), since: Date.now()};
      db.prepare('INSERT INTO claim(id, token, pid, started, project, project_root, job, since) VALUES(1, ?, ?, ?, ?, ?, ?, ?)').run(holder.token, holder.pid, holder.started, holder.project, holder.projectRoot, holder.job, holder.since);
      db.exec('COMMIT');
      committed = true;
      const release = () => this.release(holder.token);
      this.held.set(holder.token, release);
      process.once('exit', release); // a normal exit never leaves the slot behind; a kill is recovered by the identity check
      return {ok: true, holder, release};
    } catch (e) {
      return refuse(`the slot cannot be used (${(e as Error).message})`, null, true);
    } finally {
      if (!committed) { try { db.exec('ROLLBACK'); } catch { /* nothing open */ } }
    }
  }

  /** Give the slot up. Removes only the claim with this token, so a late or repeated release cannot free someone else's slot. */
  release(token: string): void {
    const fn = this.held.get(token);
    if (!fn) return;
    let last: unknown;
    for (let attempt = 0; attempt < 20; attempt++) {
      try {
        const db = this.conn();
        db.exec('BEGIN IMMEDIATE');
        try { db.prepare('DELETE FROM claim WHERE token = ?').run(token); db.exec('COMMIT'); } catch (e) { try { db.exec('ROLLBACK'); } catch { /* nothing open */ } throw e; }
        this.held.delete(token);
        process.removeListener('exit', fn);
        return;
      } catch (e) { last = e; if (!isBusy(e)) break; }
    }
    throw new Error(`could not release the production slot: ${(last as Error).message}`);
  }

  /** Release every claim this object made (shutdown). */
  releaseAll(): void { for (const t of [...this.held.keys()]) this.release(t); }
}

const isBusy = (e: unknown): boolean => (e as {errcode?: number}).errcode === 5 || /database is locked|busy/i.test((e as Error).message);
