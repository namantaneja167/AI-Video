// Explicit project backups: a self-contained, checksummed folder; and verified restore into an empty folder.
import {chmodSync, copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, rmdirSync, statSync, writeFileSync} from 'node:fs';
import {dirname, join, posix, resolve, sep} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {blobPath} from './blobs.ts';
import {all, get, openDb, readSchemaVersion, SCHEMA_VERSION} from './db.ts';
import {reachableBlobs} from './gc.ts';
import {sha256, sha256File} from './hash.ts';
import {Project, type RecoveryReport} from './project.ts';

export class BackupError extends Error {}
export class BackupVerifyError extends Error {
  problems: string[];
  constructor(message: string, problems: string[]) {
    super(message);
    this.name = 'BackupVerifyError';
    this.problems = problems;
  }
}
export class RestoreTargetError extends Error {}

/** Source material copied into the backup so it stands alone. Generated media is never listed here. */
export const DEFAULT_TRACKED = ['episodes', 'sources', 'reference', 'public/assets', 'public/fonts'];

type Entry = {kind: 'db' | 'blob' | 'file'; path: string; sha256: string; bytes: number};
export type Manifest = {format: 1; createdAt: number; schemaVersion: number; includeDrafts: boolean; files: Entry[]};

function walk(base: string, rel: string): string[] {
  const abs = join(base, rel);
  if (!existsSync(abs)) return [];
  const out: string[] = [];
  for (const name of readdirSync(abs).sort()) {
    if (name === '.DS_Store') continue;
    const r = join(rel, name);
    const st = statSync(join(base, r));
    if (st.isDirectory()) out.push(...walk(base, r));
    else if (st.isFile()) out.push(r);
  }
  return out;
}

const isEmptyDir = (d: string): boolean => readdirSync(d).filter((n) => n !== '.DS_Store').length === 0;

function copyVerified(src: string, dest: string, expect?: string): {sha256: string; bytes: number} {
  mkdirSync(dirname(dest), {recursive: true});
  const a = sha256File(src);
  if (expect && a.hash !== expect) throw new BackupError(`${src} does not match its recorded hash; refusing to copy damaged data`);
  copyFileSync(src, dest);
  const b = sha256File(dest);
  if (b.hash !== a.hash) throw new BackupError(`copy of ${src} was corrupted in transit`);
  return {sha256: a.hash, bytes: a.bytes};
}

/** Remove, from the copied database, everything that refers to blobs the backup does not carry. */
function pruneCopy(dbFile: string, keep: Set<string>): void {
  const db = openDb(dbFile);
  try {
    const drop = all<{hash: string}>(db.prepare('SELECT hash FROM blobs')).map((b) => b.hash).filter((h) => !keep.has(h));
    db.exec('BEGIN');
    for (const h of drop) {
      db.prepare('DELETE FROM current WHERE artifact_id IN (SELECT id FROM artifacts WHERE blob_hash=?)').run(h);
      db.prepare('DELETE FROM artifacts WHERE blob_hash=?').run(h);
      db.prepare('DELETE FROM revision_refs WHERE blob_hash=?').run(h);
      db.prepare('DELETE FROM snapshot_refs WHERE blob_hash=?').run(h);
      db.prepare('DELETE FROM fileset_files WHERE blob_hash=?').run(h);
      db.prepare('DELETE FROM blobs WHERE hash=?').run(h);
    }
    db.exec('UPDATE jobs SET artifact_id=NULL WHERE artifact_id IS NOT NULL AND artifact_id NOT IN (SELECT id FROM artifacts)');
    db.exec('COMMIT');
    db.exec('PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode=DELETE; VACUUM');
  } finally {
    db.close();
  }
}

export type BackupSummary = {dest: string; blobs: number; files: number; bytes: number; manifestSha256: string};

export function createBackup(p: Project, dest: string, opts: {includeDrafts?: boolean; trackedDirs?: string[]} = {}): BackupSummary {
  if (existsSync(dest) && !isEmptyDir(dest)) throw new BackupError(`${dest} exists and is not empty`);
  mkdirSync(dest, {recursive: true});
  const includeDrafts = opts.includeDrafts ?? false;
  const keep = reachableBlobs(p, {includeDrafts});
  const files: Entry[] = [];

  const dbFile = join(dest, 'project.sqlite');
  p.db.exec(`VACUUM INTO '${dbFile.replace(/'/g, "''")}'`);
  pruneCopy(dbFile, keep);
  const dbSum = sha256File(dbFile);
  files.push({kind: 'db', path: 'project.sqlite', sha256: dbSum.hash, bytes: dbSum.bytes});

  const registered = new Set(all<{hash: string}>(p.db.prepare('SELECT hash FROM blobs')).map((b) => b.hash));
  for (const hash of [...keep].sort()) {
    if (!registered.has(hash)) continue;
    const src = blobPath(p, hash);
    if (!existsSync(src)) throw new BackupError(`blob ${hash} is referenced by retained state but its file is missing; run verify before backing up`);
    const rel = join('blobs', hash.slice(0, 2), hash);
    const s = copyVerified(src, join(dest, rel), hash);
    files.push({kind: 'blob', path: rel, ...s});
  }
  for (const dir of opts.trackedDirs ?? DEFAULT_TRACKED) {
    for (const rel of walk(p.root, dir)) {
      const s = copyVerified(join(p.root, rel), join(dest, 'files', rel));
      files.push({kind: 'file', path: join('files', rel), ...s});
    }
  }
  const manifest: Manifest = {format: 1, createdAt: p.now(), schemaVersion: SCHEMA_VERSION, includeDrafts, files};
  const text = JSON.stringify(manifest, null, 1) + '\n';
  writeFileSync(join(dest, 'manifest.json'), text);
  writeFileSync(join(dest, 'manifest.json.sha256'), sha256(text) + '\n');
  return {dest, blobs: files.filter((f) => f.kind === 'blob').length, files: files.filter((f) => f.kind === 'file').length, bytes: files.reduce((a, f) => a + f.bytes, 0), manifestSha256: sha256(text)};
}

const HASH = /^[0-9a-f]{64}$/;
const BLOB_PATH = /^blobs\/([0-9a-f]{2})\/([0-9a-f]{64})$/;
const FORBIDDEN_FIRST = new Set(['.studio', '.git']);

/** Where an entry lands, relative to the project root. Only call on validated entries. */
const destinationOf = (e: Entry): string => (e.kind === 'db' ? '.studio/project.sqlite' : e.kind === 'blob' ? `.studio/${e.path}` : e.path.slice('files/'.length));

function pathProblem(path: unknown): string | null {
  if (typeof path !== 'string' || path === '') return 'path must be a non-empty string';
  if (path.includes('\0') || path.includes('\\')) return 'path contains a NUL or backslash';
  if (path.startsWith('/') || /^[a-zA-Z]:/.test(path)) return 'path is absolute';
  if (path.endsWith('/')) return 'path ends with a slash';
  const segs = path.split('/');
  if (segs.some((x) => x === '' || x === '.' || x === '..')) return 'path has an empty, "." or ".." segment';
  if (posix.normalize(path) !== path) return 'path is not normalised';
  return null;
}

/**
 * Check the whole manifest before anything is read or written: shape, kinds, normalised relative paths,
 * allowed destinations, required database entry, duplicates and conflicting destinations.
 */
export function validateManifest(m: unknown): {problems: string[]; manifest: Manifest | null} {
  const problems: string[] = [];
  const o = m as Record<string, unknown> | null;
  if (typeof o !== 'object' || o === null || Array.isArray(o)) return {problems: ['manifest is not an object'], manifest: null};
  if (o.format !== 1) problems.push(`unsupported manifest format ${String(o.format)}`);
  if (!Number.isInteger(o.schemaVersion) || (o.schemaVersion as number) < 1 || (o.schemaVersion as number) > SCHEMA_VERSION) problems.push(`unsupported schema version ${String(o.schemaVersion)}`);
  if (typeof o.createdAt !== 'number' || !Number.isFinite(o.createdAt)) problems.push('createdAt must be a number');
  if (typeof o.includeDrafts !== 'boolean') problems.push('includeDrafts must be a boolean');
  if (!Array.isArray(o.files)) return {problems: [...problems, 'files must be an array'], manifest: null};

  const seenPath = new Set<string>();
  const seenDest = new Map<string, string>();
  let dbEntries = 0;
  o.files.forEach((raw, i) => {
    const e = raw as Record<string, unknown>;
    const tag = `files[${i}]`;
    if (typeof e !== 'object' || e === null) return problems.push(`${tag} is not an object`);
    const bad = (msg: string) => problems.push(`${tag} (${String(e.path)}): ${msg}`);
    if (e.kind !== 'db' && e.kind !== 'blob' && e.kind !== 'file') return bad(`invalid kind "${String(e.kind)}"`);
    const pp = pathProblem(e.path);
    if (pp) return bad(pp);
    const path = e.path as string;
    if (typeof e.sha256 !== 'string' || !HASH.test(e.sha256)) bad('sha256 must be 64 lowercase hex characters');
    if (!Number.isInteger(e.bytes) || (e.bytes as number) < 0) bad('bytes must be a non-negative integer');
    if (e.kind === 'db') {
      dbEntries++;
      if (path !== 'project.sqlite') bad('the database entry must be project.sqlite');
    } else if (e.kind === 'blob') {
      const mt = BLOB_PATH.exec(path);
      if (!mt) bad('blob path must be blobs/<aa>/<sha256>');
      else if (mt[2] !== e.sha256 || mt[1] !== mt[2].slice(0, 2)) bad('blob name does not match its sha256');
    } else {
      if (!path.startsWith('files/') || path.length === 'files/'.length) bad('file path must be under files/');
      else if (FORBIDDEN_FIRST.has(path.slice('files/'.length).split('/')[0])) bad('files may not be restored into .studio or .git');
    }
    if (seenPath.has(path)) return bad('duplicate path');
    seenPath.add(path);
    const dest = destinationOf(e as unknown as Entry).normalize('NFC').toLowerCase(); // case-insensitive file systems collide too
    const other = seenDest.get(dest);
    if (other) bad(`destination collides with ${other}`);
    else seenDest.set(dest, path);
  });
  if (dbEntries !== 1) problems.push(`manifest must contain exactly one database entry (found ${dbEntries})`);
  const dests = [...seenDest.keys()];
  for (const d of dests) if (dests.some((x) => x !== d && x.startsWith(d + '/'))) problems.push(`${seenDest.get(d)} is both a file and a folder for other entries`);
  return {problems, manifest: problems.length ? null : (o as unknown as Manifest)};
}

/** A source file must be a regular file reached without passing through any symlink, inside the backup folder. */
function sourceProblem(base: string, rel: string): string | null {
  let cur = base;
  for (const seg of rel.split('/')) {
    cur = join(cur, seg);
    let st;
    try { st = lstatSync(cur); } catch { return 'is missing'; }
    if (st.isSymbolicLink()) return 'goes through a symbolic link';
  }
  if (!lstatSync(cur).isFile()) return 'is not a regular file';
  const real = realpathSync(cur);
  if (!real.startsWith(realpathSync(base) + sep)) return 'resolves outside the backup folder';
  return null;
}

export function verifyBackup(dir: string): {ok: boolean; problems: string[]; manifest: Manifest | null} {
  const mPath = join(dir, 'manifest.json');
  const mProblem = existsSync(mPath) ? sourceProblem(dir, 'manifest.json') : 'is missing';
  if (mProblem) return {ok: false, problems: [`manifest.json ${mProblem}`], manifest: null};
  const text = readFileSync(mPath, 'utf8');
  const problems: string[] = [];
  const side = existsSync(mPath + '.sha256') && !sourceProblem(dir, 'manifest.json.sha256') ? readFileSync(mPath + '.sha256', 'utf8').trim() : null;
  if (side !== sha256(text)) problems.push('manifest.json does not match its recorded checksum');
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { return {ok: false, problems: [...problems, 'manifest.json is not valid JSON'], manifest: null}; }
  const v = validateManifest(raw);
  if (!v.manifest) return {ok: false, problems: [...problems, ...v.problems], manifest: null}; // nothing is read from unvalidated paths
  for (const f of v.manifest.files) {
    const sp = sourceProblem(dir, f.path);
    if (sp) { problems.push(`${f.path} ${sp}`); continue; }
    const s = sha256File(join(dir, f.path));
    if (s.hash !== f.sha256 || s.bytes !== f.bytes) problems.push(`${f.path} is damaged (checksum or size differs)`);
  }
  return {ok: problems.length === 0, problems, manifest: v.manifest};
}

/** Checks on the staged copy of the database, before it can become the project. */
function stagedProblems(stage: string, manifest: Manifest): string[] {
  const problems: string[] = [];
  const dbFile = join(stage, '.studio', 'project.sqlite');
  let db: DatabaseSync | null = null;
  try {
    db = new DatabaseSync(dbFile, {readOnly: true});
    const q = get<{quick_check: string}>(db.prepare('PRAGMA quick_check'))?.quick_check;
    if (q !== 'ok') return [`restored database failed its integrity check: ${q}`];
    const v = readSchemaVersion(db);
    if (v < 1 || v > SCHEMA_VERSION) problems.push(`restored database has unsupported schema version ${v}`);
    else {
      if (all(db.prepare('PRAGMA foreign_key_check')).length) problems.push('restored database has broken references');
      const inDb = new Set(all<{hash: string}>(db.prepare('SELECT hash FROM blobs')).map((b) => b.hash));
      const shipped = new Set(manifest.files.filter((f) => f.kind === 'blob').map((f) => f.sha256));
      for (const h of inDb) if (!shipped.has(h)) problems.push(`database references blob ${h} that the backup does not contain`);
      for (const h of shipped) if (!inDb.has(h)) problems.push(`backup contains blob ${h} that the database does not know`);
    }
  } catch (e) {
    problems.push(`restored database cannot be read: ${(e as Error).message.split('\n')[0]}`);
  } finally {
    try { db?.close(); } catch { /* unusable handle */ }
  }
  return problems;
}

/**
 * Restore into an empty (or new) folder. Order: verify the whole manifest and every file; stage everything in a
 * sibling folder, confirming each destination stays inside it; validate the staged database and run the normal
 * recovery protocol on it; only then publish with one rename. An existing project is never overwritten and a
 * failed restore leaves nothing behind.
 */
export function restoreBackup(backupDir: string, target: string): RecoveryReport {
  const v = verifyBackup(backupDir);
  if (!v.ok || !v.manifest) throw new BackupVerifyError(`backup is damaged or incomplete:\n  - ${v.problems.join('\n  - ')}`, v.problems);
  if (existsSync(target)) {
    if (!statSync(target).isDirectory() || !isEmptyDir(target)) throw new RestoreTargetError(`${target} is not empty; restore only into an empty folder`);
  }
  const stage = `${target}.restoring-${process.pid}`;
  rmSync(stage, {recursive: true, force: true});
  mkdirSync(stage, {recursive: true});
  const stageReal = realpathSync(stage);
  let report: RecoveryReport;
  try {
    for (const f of v.manifest.files) {
      const dest = resolve(stage, destinationOf(f));
      if (!dest.startsWith(stage + sep)) throw new BackupError(`${f.path} would be written outside the restore folder`);
      mkdirSync(dirname(dest), {recursive: true});
      if (!realpathSync(dirname(dest)).startsWith(stageReal)) throw new BackupError(`${f.path} would be written outside the restore folder`);
      const s = copyVerified(join(backupDir, f.path), dest, f.sha256);
      if (s.sha256 !== f.sha256) throw new BackupError(`${f.path} changed while restoring`);
      if (f.kind === 'blob') chmodSync(dest, 0o444);
    }
    for (const d of ['blobs', 'tmp', 'backups']) mkdirSync(join(stage, '.studio', d), {recursive: true});
    const bad = stagedProblems(stage, v.manifest);
    if (bad.length) throw new BackupVerifyError(`restored database is not usable:\n  - ${bad.join('\n  - ')}`, bad);
    const staged = Project.open(stage); // the same recovery protocol every project gets, run before publishing
    report = staged.recovery;
    staged.close();
    mkdirSync(dirname(target), {recursive: true});
    if (existsSync(target)) rmdirSync(target);
    renameSync(stage, target);
  } catch (e) {
    rmSync(stage, {recursive: true, force: true});
    throw e;
  }
  return report;
}
