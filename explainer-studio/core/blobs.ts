// Content-addressed blob store. Bytes live in .studio/blobs/<aa>/<sha256>; meaning lives in the database.
// Order matters: the file is complete and renamed into place before any row references it, so a crash can
// leave an unreferenced file but never a reference to a missing one.
import {
  chmodSync, closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, renameSync, rmSync, statSync, writeSync,
} from 'node:fs';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
import {all, get} from './db.ts';
import {sha256File} from './hash.ts';
import type {Project} from './project.ts';

export class MissingBlobError extends Error {}
export class CorruptBlobError extends Error {}

export const blobPath = (p: Project, hash: string): string => join(p.blobDir, hash.slice(0, 2), hash);

function fsyncDir(dir: string): void {
  const fd = openSync(dir, 'r');
  try { fsyncSync(fd); } finally { closeSync(fd); }
}

function register(p: Project, hash: string, bytes: number): void {
  p.db.prepare('INSERT OR IGNORE INTO blobs(hash, bytes, created_at) VALUES(?,?,?)').run(hash, bytes, p.now());
}

function install(p: Project, tmp: string, hash: string, bytes: number): void {
  const dest = blobPath(p, hash);
  mkdirSync(join(p.blobDir, hash.slice(0, 2)), {recursive: true});
  // A same-named file of a different size is damage, not a duplicate: replace it atomically.
  if (!existsSync(dest) || statSync(dest).size !== bytes) {
    chmodSync(tmp, 0o444);
    renameSync(tmp, dest);
    fsyncDir(join(p.blobDir, hash.slice(0, 2)));
  } else {
    rmSync(tmp, {force: true});
  }
  register(p, hash, bytes);
}

export function putBytes(p: Project, data: Uint8Array | string): {hash: string; bytes: number} {
  const buf = typeof data === 'string' ? Buffer.from(data) : Buffer.from(data);
  const hash = createHash('sha256').update(buf).digest('hex');
  const tmp = join(p.tmpDir, `put-${process.pid}-${p.now()}-${Math.random().toString(36).slice(2)}`);
  const fd = openSync(tmp, 'w');
  try { writeSync(fd, buf); fsyncSync(fd); } finally { closeSync(fd); }
  install(p, tmp, hash, buf.length);
  return {hash, bytes: buf.length};
}

/** Streams a file into the store (hash and copy in one pass). The source is never modified. */
export function putFile(p: Project, source: string): {hash: string; bytes: number} {
  const tmp = join(p.tmpDir, `put-${process.pid}-${p.now()}-${Math.random().toString(36).slice(2)}`);
  const h = createHash('sha256');
  const inFd = openSync(source, 'r');
  const outFd = openSync(tmp, 'w');
  const buf = Buffer.allocUnsafe(1 << 20);
  let bytes = 0;
  try {
    for (;;) {
      const n = readSync(inFd, buf, 0, buf.length, null);
      if (!n) break;
      h.update(buf.subarray(0, n));
      writeSync(outFd, buf, 0, n);
      bytes += n;
    }
    fsyncSync(outFd);
  } finally {
    closeSync(inFd);
    closeSync(outFd);
  }
  const hash = h.digest('hex');
  install(p, tmp, hash, bytes);
  return {hash, bytes};
}

/** Cheap check used when something references a blob: registered, present, right size. */
export function requireBlob(p: Project, hash: string): void {
  const row = get<{bytes: number}>(p.db.prepare('SELECT bytes FROM blobs WHERE hash=?'), hash);
  if (!row) throw new MissingBlobError(`blob ${hash} is not registered`);
  const f = blobPath(p, hash);
  if (!existsSync(f)) throw new MissingBlobError(`blob ${hash} is registered but its file is missing`);
  if (statSync(f).size !== row.bytes) throw new CorruptBlobError(`blob ${hash} has the wrong size`);
}

/** Full check: re-hash the bytes. Used for approvals, approved references, restore and verify. */
export function verifyBlob(p: Project, hash: string): void {
  requireBlob(p, hash);
  if (sha256File(blobPath(p, hash)).hash !== hash) throw new CorruptBlobError(`blob ${hash} does not match its hash`);
}

export const readBlob = (p: Project, hash: string): Buffer => {
  verifyBlob(p, hash);
  return readFileSync(blobPath(p, hash));
};

export type VerifyReport = {checked: number; missing: string[]; corrupt: string[]; orphanFiles: string[]};

/** Re-hash every registered blob; list files the database does not know about. */
export function verifyAll(p: Project): VerifyReport {
  const report: VerifyReport = {checked: 0, missing: [], corrupt: [], orphanFiles: []};
  const known = new Set<string>();
  for (const b of all<{hash: string; bytes: number}>(p.db.prepare('SELECT hash, bytes FROM blobs'))) {
    known.add(b.hash);
    report.checked++;
    const f = blobPath(p, b.hash);
    if (!existsSync(f)) report.missing.push(b.hash);
    else {
      const r = sha256File(f);
      if (r.hash !== b.hash || r.bytes !== b.bytes) report.corrupt.push(b.hash);
    }
  }
  report.orphanFiles = listBlobFiles(p).filter((h) => !known.has(h));
  return report;
}

export function listBlobFiles(p: Project): string[] {
  const out: string[] = [];
  if (!existsSync(p.blobDir)) return out;
  for (const d of readdirSync(p.blobDir)) {
    const sub = join(p.blobDir, d);
    if (statSync(sub).isDirectory()) for (const f of readdirSync(sub)) out.push(f);
  }
  return out;
}
