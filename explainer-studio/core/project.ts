// Opening a project runs the recovery protocol: lock, integrity check, migrations, blob/job/projection reconciliation.
import {copyFileSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {all, get, MIGRATIONS, migrate, openDb, readSchemaVersion, SCHEMA_VERSION} from './db.ts';
import {reconcileProjections, type ProjectionAction} from './episodes.ts';
import {hashJson} from './hash.ts';
import {OwnerRegistry, reapAllSync} from './proc.ts';
import {acquireLock, defaultProbe, lockVerdict, ProjectLockedError, releaseLock, type ProcessProbe} from './lock.ts';

export {ProjectLockedError};
export class NotAProjectError extends Error {}
export class ProjectTooNewError extends Error {}
export class CorruptProjectError extends Error {
  backups: string[];
  constructor(message: string, backups: string[]) {
    super(message);
    this.name = 'CorruptProjectError';
    this.backups = backups;
  }
}

export type Clock = () => number;
export type RecoveryReport = {
  created: boolean;
  schemaMigratedFrom: number | null;
  missingBlobs: string[];
  interruptedJobs: number[];
  /** Recorded worker processes that were still alive after a crash and were stopped (identity-verified). */
  reapedProcesses: number[];
  processInspection: 'ok' | 'unavailable' | 'not-needed';
  projections: ProjectionAction[];
  backupTaken: string | null;
};

const DB_FILE = 'project.sqlite';
export const DEFAULT_MASTERING = {integratedLufs: -16, truePeakDb: -1.5};
const BACKUP_KEEP = 10;

export class Project {
  readonly root: string;
  readonly dir: string;
  readonly db: DatabaseSync;
  now: Clock;
  /** Test seam: called inside the outermost transaction just before COMMIT. */
  hooks: {beforeCommit?: (label: string) => void} = {};
  recovery!: RecoveryReport;
  /** Automatic revision checkpoints: after this many edits or this long since the last one. */
  policy = {checkpointOps: 20, checkpointMs: 5 * 60_000};
  private depth = 0;
  private lockPath: string;

  private constructor(root: string, db: DatabaseSync, now: Clock) {
    this.root = root;
    this.dir = join(root, '.studio');
    this.db = db;
    this.now = now;
    this.lockPath = join(this.dir, 'lock');
  }

  get blobDir(): string { return join(this.dir, 'blobs'); }
  get tmpDir(): string { return join(this.dir, 'tmp'); }
  get backupDir(): string { return join(this.dir, 'backups'); }

  static open(root: string, opts: {create?: boolean; now?: Clock; backupIntervalMs?: number; probe?: ProcessProbe} = {}): Project {
    const now = opts.now ?? Date.now;
    const dir = join(root, '.studio');
    const dbPath = join(dir, DB_FILE);
    const existed = existsSync(dbPath);
    if (!existed && !opts.create) throw new NotAProjectError(`${root} has no project database; create one with init`);
    for (const d of ['', 'blobs', 'tmp', 'backups']) mkdirSync(join(dir, d), {recursive: true});

    acquireLock(join(dir, 'lock'), opts.probe ?? defaultProbe);
    let db: DatabaseSync | null = null;
    try {
      let verdict = 'ok';
      try {
        db = openDb(dbPath);
        if (existed) verdict = get<{quick_check: string}>(db.prepare('PRAGMA quick_check'))?.quick_check ?? 'no result';
      } catch (e) {
        verdict = (e as Error).message; // e.g. "file is not a database"
      }
      if (existed && verdict !== 'ok') {
        try { db?.close(); } catch { /* unusable handle */ }
        db = null;
        throw new CorruptProjectError(`project database failed its integrity check (${verdict}); restore the newest automatic backup`, Project.listBackups(dir));
      }
      if (!db) throw new Error('could not open the project database');
      const p = new Project(root, db, now);
      const from = readSchemaVersion(db);
      if (from > SCHEMA_VERSION) throw new ProjectTooNewError(`project schema ${from} is newer than this build (${SCHEMA_VERSION})`);
      const report: RecoveryReport = {created: !existed, schemaMigratedFrom: null, missingBlobs: [], interruptedJobs: [], reapedProcesses: [], processInspection: 'not-needed', projections: [], backupTaken: null};
      if (from < MIGRATIONS.length) {
        if (from > 0) report.backupTaken = p.autoBackup('pre-migration');
        migrate(db, from);
        report.schemaMigratedFrom = from;
      }
      if (!existed) p.initDefaults();
      p.reconcileBlobs(report);
      p.reconcileJobs(report);
      report.projections = reconcileProjections(p);
      if (existed && !report.backupTaken && p.backupDue(opts.backupIntervalMs ?? 6 * 3600_000)) report.backupTaken = p.autoBackup('scheduled');
      p.recovery = report;
      return p;
    } catch (e) {
      try { db?.close(); } catch { /* already closed */ }
      releaseLock(join(dir, 'lock'));
      throw e;
    }
  }

  close(): void {
    this.db.close();
    releaseLock(this.lockPath);
  }

  // ---- transactions ----------------------------------------------------------------------------------------
  tx<T>(label: string, fn: () => T): T {
    if (this.depth > 0) return fn();
    this.db.exec('BEGIN IMMEDIATE');
    this.depth = 1;
    try {
      const r = fn();
      this.hooks.beforeCommit?.(label);
      this.db.exec('COMMIT');
      return r;
    } catch (e) {
      try { this.db.exec('ROLLBACK'); } catch { /* already rolled back */ }
      throw e;
    } finally {
      this.depth = 0;
    }
  }

  // ---- small state -----------------------------------------------------------------------------------------
  private initDefaults(): void {
    const set = this.db.prepare('INSERT OR IGNORE INTO meta(key,value) VALUES(?,?)');
    set.run('created_at', String(this.now()));
    set.run('project_id', `${this.now().toString(36)}-${process.pid.toString(36)}`);
    // Mastering targets are settings, not constants: changing them stales final mixes and renders.
    const value = JSON.stringify(DEFAULT_MASTERING);
    this.db.prepare('INSERT OR IGNORE INTO components(scope,name,hash,value_json,blob_hash,updated_at) VALUES(?,?,?,?,NULL,?)')
      .run('*', 'masteringParams', hashJson(DEFAULT_MASTERING), value, this.now());
  }

  getUiState(key: string): string | undefined {
    return get<{value: string}>(this.db.prepare('SELECT value FROM ui_state WHERE key=?'), key)?.value;
  }
  setUiState(key: string, value: string): void {
    this.db.prepare('INSERT INTO ui_state(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, value);
  }

  // ---- recovery steps --------------------------------------------------------------------------------------
  private reconcileBlobs(report: RecoveryReport): void {
    for (const b of all<{hash: string; bytes: number}>(this.db.prepare('SELECT hash, bytes FROM blobs'))) {
      const f = join(this.blobDir, b.hash.slice(0, 2), b.hash);
      if (!existsSync(f)) report.missingBlobs.push(b.hash);
    }
  }

  private reconcileJobs(report: RecoveryReport): void {
    const active = all<{id: number; state: string}>(this.db.prepare("SELECT id, state FROM jobs WHERE state IN ('preparing','running','cancelling')"));
    this.tx('reconcile-jobs', () => {
      for (const j of active) {
        const state = j.state === 'cancelling' ? 'cancelled' : 'failed';
        this.db.prepare('UPDATE jobs SET state=?, error=?, finished_at=? WHERE id=?').run(state, 'interrupted', this.now(), j.id);
        this.db.prepare("UPDATE job_attempts SET state=?, error='interrupted', finished_at=? WHERE job_id=? AND finished_at IS NULL").run(state, this.now(), j.id);
        this.db.prepare("INSERT INTO job_events(job_id,at,kind,data_json) VALUES(?,?,'interrupted','{}')").run(j.id, this.now());
        report.interruptedJobs.push(j.id);
      }
    });
    // Workers that outlived a crash: stop only what is recorded, with the same pid AND start time.
    const reaped = reapAllSync(new OwnerRegistry(this.db, this.now));
    report.reapedProcesses = reaped.reaped;
    report.processInspection = reaped.inspection;
    for (const j of active) {
      for (const d of readdirSync(this.tmpDir)) if (d === String(j.id) || d.startsWith(`${j.id}-`)) rmSync(join(this.tmpDir, d), {recursive: true, force: true});
    }
  }

  // ---- automatic database backups --------------------------------------------------------------------------
  static listBackups(dir: string): string[] {
    const d = join(dir, 'backups');
    if (!existsSync(d)) return [];
    const stamp = (f: string) => Number(/^db-(\d+)-/.exec(f)?.[1] ?? 0);
    return readdirSync(d).filter((f) => /^db-.*\.sqlite$/.test(f)).sort((a, b) => stamp(b) - stamp(a) || (a < b ? 1 : -1)).map((f) => join(d, f));
  }

  private backupDue(intervalMs: number): boolean {
    const latest = Project.listBackups(this.dir)[0];
    if (!latest) return true;
    const m = /^db-(\d+)-/.exec(latest.split('/').pop()!);
    return !m || this.now() - Number(m[1]) >= intervalMs;
  }

  /** Consistent copy of the live database (VACUUM INTO); keeps the newest few. Returns the file path. */
  autoBackup(reason: string): string {
    let n = 0;
    let path: string;
    do {
      path = join(this.backupDir, `db-${this.now()}-${reason}${n ? `-${n}` : ''}.sqlite`);
      n++;
    } while (existsSync(path));
    this.db.exec(`VACUUM INTO '${path.replace(/'/g, "''")}'`);
    for (const old of Project.listBackups(this.dir).slice(BACKUP_KEEP)) rmSync(old, {force: true});
    return path;
  }
}

/** null if the file is a usable project database, otherwise why not. Opens read-only: a backup is never modified. */
function candidateProblem(file: string): string | null {
  let db: DatabaseSync | null = null;
  try {
    db = new DatabaseSync(file, {readOnly: true});
    const q = get<{quick_check: string}>(db.prepare('PRAGMA quick_check'))?.quick_check;
    if (q !== 'ok') return `integrity check: ${q}`;
    const v = readSchemaVersion(db);
    if (v < 1 || v > SCHEMA_VERSION) return `unsupported schema version ${v}`;
    return null;
  } catch (e) {
    return (e as Error).message.split('\n')[0];
  } finally {
    try { db?.close(); } catch { /* handle already unusable */ }
  }
}

export type RecoverResult = {restoredFrom: string; movedAside: string; skipped: {path: string; reason: string}[]};

/**
 * Replace a damaged database with the newest backup that passes its own checks. Candidates that are unreadable
 * or fail integrity are skipped and older ones tried. The chosen backup is first copied and the COPY validated;
 * only then is the current database moved aside (never deleted) and the copy put in place. If anything fails
 * after that point the original files are put back. Call with the project closed.
 */
export function recoverFromBackup(root: string, opts: {probe?: ProcessProbe} = {}): RecoverResult {
  const dir = join(root, '.studio');
  const v = lockVerdict(join(dir, 'lock'), opts.probe ?? defaultProbe);
  if (v && v.kind !== 'stale') throw new ProjectLockedError(v.kind === 'live' ? `project is open in another process (pid ${v.pid})` : `cannot tell whether the project is in use: ${v.why}`);
  const dbPath = join(dir, DB_FILE);
  const skipped: RecoverResult['skipped'] = [];
  for (const candidate of Project.listBackups(dir)) {
    const bad = candidateProblem(candidate);
    if (bad) { skipped.push({path: candidate, reason: bad}); continue; }
    const staged = join(dir, `project.sqlite.recovering-${process.pid}`);
    try {
      copyFileSync(candidate, staged);
      const badCopy = candidateProblem(staged);
      if (badCopy) { skipped.push({path: candidate, reason: `copy failed validation: ${badCopy}`}); rmSync(staged, {force: true}); continue; }
    } catch (e) {
      rmSync(staged, {force: true});
      skipped.push({path: candidate, reason: (e as Error).message});
      continue;
    }
    const aside = join(dir, `project.sqlite.corrupt-${Date.now()}`);
    const moved: string[] = [];
    try {
      for (const ext of ['', '-wal', '-shm']) {
        if (existsSync(dbPath + ext)) { renameSync(dbPath + ext, aside + ext); moved.push(ext); }
      }
      renameSync(staged, dbPath);
    } catch (e) {
      for (const ext of moved) renameSync(aside + ext, dbPath + ext);
      rmSync(staged, {force: true});
      throw e;
    }
    return {restoredFrom: candidate, movedAside: aside, skipped};
  }
  throw new Error(`no usable automatic backup found${skipped.length ? ` (skipped: ${skipped.map((x) => `${x.path}: ${x.reason}`).join('; ')})` : ''}`);
}
