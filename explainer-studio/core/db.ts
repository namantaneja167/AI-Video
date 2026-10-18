// Project database: schema, migrations and transaction helper. SQLite is the single authority for project state.
import {DatabaseSync, type StatementSync} from 'node:sqlite';

/** Job states that hold a snapshot and, for the heavy lane, the single heavy slot. */
export const ACTIVE_STATES = ['queued', 'preparing', 'running', 'cancelling'] as const;
/** Jobs whose snapshot must stay recoverable: running ones, and failed or cancelled ones that can still be retried. */
export const RETAINED_SQL = `(${[...ACTIVE_STATES, 'failed', 'cancelled'].map((s) => `'${s}'`).join(',')})`;
export const ACTIVE_SQL = `(${ACTIVE_STATES.map((s) => `'${s}'`).join(',')})`;

const DDL_V1 = `
CREATE TABLE meta(key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE blobs(hash TEXT PRIMARY KEY, bytes INTEGER NOT NULL, created_at INTEGER NOT NULL);

CREATE TABLE episodes(
  id TEXT PRIMARY KEY, doc_json TEXT NOT NULL, doc_hash TEXT NOT NULL, seq INTEGER NOT NULL,
  updated_at INTEGER NOT NULL, ops_since_checkpoint INTEGER NOT NULL DEFAULT 0, last_checkpoint_at INTEGER NOT NULL);
CREATE TABLE ops(
  seq INTEGER PRIMARY KEY AUTOINCREMENT, episode_id TEXT NOT NULL, kind TEXT NOT NULL, doc_hash TEXT NOT NULL,
  projection_hash TEXT, at INTEGER NOT NULL);
CREATE INDEX ops_episode ON ops(episode_id, seq);

CREATE TABLE revisions(
  id INTEGER PRIMARY KEY AUTOINCREMENT, episode_id TEXT NOT NULL, number INTEGER NOT NULL, kind TEXT NOT NULL,
  label TEXT, doc_hash TEXT NOT NULL, doc_json TEXT NOT NULL, created_at INTEGER NOT NULL, UNIQUE(episode_id, number));
CREATE TABLE revision_refs(
  revision_id INTEGER NOT NULL REFERENCES revisions(id) ON DELETE CASCADE, role TEXT NOT NULL,
  blob_hash TEXT NOT NULL REFERENCES blobs(hash), PRIMARY KEY(revision_id, role));

CREATE TABLE projections(
  episode_id TEXT PRIMARY KEY, path TEXT NOT NULL, confirmed_hash TEXT, confirmed_seq INTEGER NOT NULL DEFAULT 0,
  external_hash TEXT, external_detected_at INTEGER);

CREATE TABLE components(
  scope TEXT NOT NULL, name TEXT NOT NULL, hash TEXT NOT NULL, value_json TEXT NOT NULL,
  blob_hash TEXT REFERENCES blobs(hash), updated_at INTEGER NOT NULL, PRIMARY KEY(scope, name));
CREATE TABLE fileset_files(
  manifest_hash TEXT NOT NULL, path TEXT NOT NULL, blob_hash TEXT NOT NULL REFERENCES blobs(hash),
  PRIMARY KEY(manifest_hash, path));

CREATE TABLE snapshots(
  id TEXT PRIMARY KEY, episode_id TEXT NOT NULL, revision_number INTEGER NOT NULL, manifest_json TEXT NOT NULL,
  created_at INTEGER NOT NULL);
CREATE TABLE snapshot_refs(
  snapshot_id TEXT NOT NULL REFERENCES snapshots(id), role TEXT NOT NULL,
  blob_hash TEXT NOT NULL REFERENCES blobs(hash), PRIMARY KEY(snapshot_id, role));
CREATE TABLE jobs(
  id INTEGER PRIMARY KEY AUTOINCREMENT, episode_id TEXT NOT NULL, kind TEXT NOT NULL, subject TEXT NOT NULL,
  snapshot_id TEXT NOT NULL REFERENCES snapshots(id), state TEXT NOT NULL, artifact_id INTEGER, error TEXT,
  created_at INTEGER NOT NULL, finished_at INTEGER);

CREATE TABLE artifacts(
  id INTEGER PRIMARY KEY AUTOINCREMENT, episode_id TEXT NOT NULL, kind TEXT NOT NULL, subject TEXT NOT NULL,
  inputs_hash TEXT NOT NULL, cache_key TEXT, blob_hash TEXT NOT NULL REFERENCES blobs(hash),
  meta_json TEXT NOT NULL DEFAULT '{}', snapshot_id TEXT REFERENCES snapshots(id), revision_number INTEGER,
  outdated INTEGER NOT NULL DEFAULT 0, pinned INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL);
CREATE INDEX artifacts_cache ON artifacts(episode_id, kind, subject, cache_key);
CREATE TABLE current(
  episode_id TEXT NOT NULL, kind TEXT NOT NULL, subject TEXT NOT NULL,
  artifact_id INTEGER NOT NULL REFERENCES artifacts(id), PRIMARY KEY(episode_id, kind, subject));

CREATE TABLE approvals(
  id INTEGER PRIMARY KEY AUTOINCREMENT, episode_id TEXT NOT NULL, artifact_id INTEGER NOT NULL REFERENCES artifacts(id),
  file_sha256 TEXT NOT NULL, parts_json TEXT NOT NULL, inputs_hash TEXT NOT NULL, revision_number INTEGER NOT NULL,
  signoffs_json TEXT NOT NULL, approved_at INTEGER NOT NULL);
CREATE TABLE approved(episode_id TEXT PRIMARY KEY, approval_id INTEGER NOT NULL REFERENCES approvals(id));

CREATE TABLE refs(
  name TEXT PRIMARY KEY, blob_hash TEXT NOT NULL REFERENCES blobs(hash), source_path TEXT, meta_json TEXT NOT NULL,
  approved_at INTEGER NOT NULL);
CREATE TABLE ui_state(key TEXT PRIMARY KEY, value TEXT NOT NULL);
`;

// Phase 2: persistent queue, attempts, owned processes, and truthful progress events.
const DDL_V2 = `
ALTER TABLE jobs ADD COLUMN lane TEXT NOT NULL DEFAULT 'heavy';
ALTER TABLE jobs ADD COLUMN params_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE jobs ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE jobs ADD COLUMN started_at INTEGER;
CREATE TABLE job_attempts(
  id INTEGER PRIMARY KEY AUTOINCREMENT, job_id INTEGER NOT NULL REFERENCES jobs(id), n INTEGER NOT NULL, state TEXT NOT NULL,
  started_at INTEGER NOT NULL, finished_at INTEGER, error TEXT, peak_rss_bytes INTEGER, pressure_max INTEGER, UNIQUE(job_id, n));
CREATE TABLE job_procs(
  owner TEXT NOT NULL, pid INTEGER NOT NULL, start TEXT NOT NULL, role TEXT NOT NULL, recorded_at INTEGER NOT NULL,
  gone_at INTEGER, PRIMARY KEY(owner, pid, start));
CREATE TABLE job_events(
  id INTEGER PRIMARY KEY AUTOINCREMENT, job_id INTEGER NOT NULL, attempt_id INTEGER, at INTEGER NOT NULL, kind TEXT NOT NULL,
  data_json TEXT NOT NULL);
CREATE INDEX job_events_job ON job_events(job_id, id);
`;

/** Forward-only migrations, index = version - 1. Each runs in a transaction after a database copy is taken. */
export const MIGRATIONS: string[] = [DDL_V1, DDL_V2];
export const SCHEMA_VERSION = MIGRATIONS.length;

export function openDb(path: string): DatabaseSync {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  return db;
}

export type Row = Record<string, any>;
export const get = <T = Row>(stmt: StatementSync, ...params: any[]): T | undefined => stmt.get(...params) as T | undefined;
export const all = <T = Row>(stmt: StatementSync, ...params: any[]): T[] => stmt.all(...params) as T[];

export function readSchemaVersion(db: DatabaseSync): number {
  const t = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='meta'").get();
  if (!t) return 0;
  const r = get<{value: string}>(db.prepare("SELECT value FROM meta WHERE key='schema_version'"));
  return r ? Number(r.value) : 0;
}

export function migrate(db: DatabaseSync, from: number): void {
  for (let v = from; v < MIGRATIONS.length; v++) {
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(MIGRATIONS[v]);
      db.prepare("INSERT INTO meta(key,value) VALUES('schema_version',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(String(v + 1));
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }
}
