// Episode documents: transactional saves, immutable revisions, and the episode.json projection.
//
// The database is the authority. episode.json is written from it after each commit (atomically) and is only
// ever overwritten when its bytes are known to be ours. Anything else is an external change, held for the
// author to import or discard.
import {closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, writeFileSync, writeSync} from 'node:fs';
import {dirname, isAbsolute, join, relative} from 'node:path';
import {EpisodeSchema} from '../src/schema.ts';
import {losslessV1, migrateV1ToV2, validateEpisodeV2, type Issue} from '../src/migrate.ts';
import type {EpisodeV2} from '../src/schema2.ts';
import {all, get} from './db.ts';
import {hashJson, sha256, stableStringify} from './hash.ts';
import type {Project} from './project.ts';
import {collectRefs} from './state.ts';

export class ValidationError extends Error {
  issues: Issue[];
  constructor(message: string, issues: Issue[]) {
    super(message);
    this.name = 'ValidationError';
    this.issues = issues;
  }
}
export class ConflictError extends Error {}
export class UnknownEpisodeError extends Error {}
export class EpisodeExistsError extends Error {}
export class ExternalParseError extends Error {}

export type ProjectionState = 'in-sync' | 'lag' | 'missing' | 'external';
export type ProjectionAction = {episodeId: string; action: 'in-sync' | 'rewritten' | 'recreated' | 'external'};
export type SaveResult = {changed: boolean; seq: number; docHash: string; revision: number | null; projection: 'written' | 'external-pending' | 'unchanged' | 'error'};

const PERMANENT = new Set(['milestone', 'approval', 'final', 'adopt', 'restore']);
export const isPermanentRevision = (kind: string): boolean => PERMANENT.has(kind);

// ---- reading ---------------------------------------------------------------------------------------------------

type EpisodeRow = {id: string; doc_json: string; doc_hash: string; seq: number; updated_at: number; ops_since_checkpoint: number; last_checkpoint_at: number};

function row(p: Project, id: string): EpisodeRow {
  const r = get<EpisodeRow>(p.db.prepare('SELECT * FROM episodes WHERE id=?'), id);
  if (!r) throw new UnknownEpisodeError(`no episode "${id}" in this project`);
  return r;
}

export const getEpisode = (p: Project, id: string): EpisodeV2 => JSON.parse(row(p, id).doc_json) as EpisodeV2;
export const getEpisodeInfo = (p: Project, id: string): {seq: number; docHash: string} => {
  const r = row(p, id);
  return {seq: r.seq, docHash: r.doc_hash};
};
export const listEpisodes = (p: Project): string[] => all<{id: string}>(p.db.prepare('SELECT id FROM episodes ORDER BY id')).map((r) => r.id);

function validated(input: unknown): EpisodeV2 {
  const v = validateEpisodeV2(input);
  if (!v.ok) throw new ValidationError(`episode is invalid:\n${v.issues.map((i) => `  - ${i.path}: ${i.message}`).join('\n')}`, v.issues);
  return v.episode;
}

// ---- projection bytes ------------------------------------------------------------------------------------------

/** v1 when v2 converts losslessly (the legacy commands keep working), otherwise v2 (which they refuse clearly). */
export function projectionBytes(doc: EpisodeV2): string {
  return JSON.stringify(losslessV1(doc) ?? doc, null, 2) + '\n';
}

const rel = (p: Project, path: string): string => (isAbsolute(path) ? relative(p.root, path) : path);

// ---- adopt / save ----------------------------------------------------------------------------------------------

/** Take an existing episode.json under management. The file is left exactly as it is until the next save. */
export function adoptEpisode(p: Project, path: string): {id: string; seq: number} {
  const relPath = rel(p, path);
  if (relPath.startsWith('..')) throw new Error('episode files must live inside the project');
  const abs = join(p.root, relPath);
  const bytes = readFileSync(abs);
  let raw: any;
  try { raw = JSON.parse(bytes.toString('utf8')); } catch (e) { throw new ValidationError(`${relPath} is not valid JSON: ${(e as Error).message}`, []); }
  let doc: EpisodeV2;
  if (raw?.schemaVersion === 2) doc = validated(raw);
  else {
    const v1 = EpisodeSchema.safeParse(raw);
    if (!v1.success) throw new ValidationError(`${relPath} is not a valid episode`, v1.error.issues.map((i) => ({path: i.path.join('.') || '(root)', message: i.message})));
    doc = validated(migrateV1ToV2(raw));
  }
  if (get(p.db.prepare('SELECT 1 FROM episodes WHERE id=?'), doc.id)) throw new EpisodeExistsError(`episode "${doc.id}" is already in this project`);
  const docHash = hashJson(doc);
  const fileHash = sha256(bytes);
  return p.tx('adopt', () => {
    const seq = Number(p.db.prepare('INSERT INTO ops(episode_id,kind,doc_hash,projection_hash,at) VALUES(?,?,?,?,?)').run(doc.id, 'adopt', docHash, fileHash, p.now()).lastInsertRowid);
    p.db.prepare('INSERT INTO episodes(id,doc_json,doc_hash,seq,updated_at,ops_since_checkpoint,last_checkpoint_at) VALUES(?,?,?,?,?,0,?)').run(doc.id, JSON.stringify(doc), docHash, seq, p.now(), p.now());
    p.db.prepare('INSERT INTO projections(episode_id,path,confirmed_hash,confirmed_seq) VALUES(?,?,?,?)').run(doc.id, relPath, fileHash, seq);
    createRevision(p, doc.id, {kind: 'adopt', label: `adopted from ${relPath}`});
    return {id: doc.id, seq};
  });
}

export type SaveOptions = {baseSeq?: number; kind?: string; label?: string; forceProjection?: boolean};

/** One transaction: validate, record the op, replace the working document, maybe checkpoint. Then project. */
export function saveEpisode(p: Project, id: string, input: unknown, opts: SaveOptions = {}): SaveResult {
  const doc = validated(input);
  if (doc.id !== id) throw new ValidationError(`document id "${doc.id}" does not match episode "${id}"`, [{path: 'id', message: 'must not change'}]);
  const docHash = hashJson(doc);
  const bytes = projectionBytes(doc);
  const res = p.tx('save', () => {
    const cur = row(p, id);
    if (opts.baseSeq !== undefined && opts.baseSeq !== cur.seq) throw new ConflictError(`episode "${id}" changed since seq ${opts.baseSeq} (now ${cur.seq})`);
    if (docHash === cur.doc_hash) return {changed: false, seq: cur.seq, docHash, revision: null as number | null};
    const seq = Number(p.db.prepare('INSERT INTO ops(episode_id,kind,doc_hash,projection_hash,at) VALUES(?,?,?,?,?)').run(id, opts.kind ?? 'edit', docHash, sha256(bytes), p.now()).lastInsertRowid);
    const ops = cur.ops_since_checkpoint + 1;
    p.db.prepare('UPDATE episodes SET doc_json=?, doc_hash=?, seq=?, updated_at=?, ops_since_checkpoint=? WHERE id=?').run(JSON.stringify(doc), docHash, seq, p.now(), ops, id);
    let revision: number | null = null;
    if (opts.kind && opts.kind !== 'edit') revision = createRevision(p, id, {kind: opts.kind, label: opts.label});
    else if (ops >= p.policy.checkpointOps || p.now() - cur.last_checkpoint_at >= p.policy.checkpointMs) revision = createRevision(p, id, {kind: 'auto'});
    return {changed: true, seq, docHash, revision};
  });
  if (!res.changed) return {...res, projection: 'unchanged'};
  let projection: SaveResult['projection'];
  try {
    projection = writeProjection(p, id, {force: opts.forceProjection});
  } catch {
    projection = 'error'; // state is committed; the next open or save reconciles the file
  }
  return {...res, projection};
}

// ---- revisions -------------------------------------------------------------------------------------------------

export type RevisionInfo = {number: number; kind: string; label: string | null; docHash: string; createdAt: number};

export function createRevision(p: Project, id: string, opts: {kind: string; label?: string; reuseByDoc?: boolean}): number {
  return p.tx('revision', () => {
    const cur = row(p, id);
    const refs = collectRefs(p, id);
    const last = get<{id: number; number: number; doc_hash: string}>(p.db.prepare('SELECT id, number, doc_hash FROM revisions WHERE episode_id=? ORDER BY number DESC LIMIT 1'), id);
    if (opts.reuseByDoc) {
      const same = get<{number: number}>(p.db.prepare('SELECT number FROM revisions WHERE episode_id=? AND doc_hash=? ORDER BY number DESC LIMIT 1'), id, cur.doc_hash);
      if (same) return same.number;
    }
    if (opts.kind === 'auto' && last && last.doc_hash === cur.doc_hash) {
      const old = all<{role: string; blob_hash: string}>(p.db.prepare('SELECT role, blob_hash FROM revision_refs WHERE revision_id=?'), last.id);
      if (stableStringify(Object.fromEntries(old.map((r) => [r.role, r.blob_hash]))) === stableStringify(refs)) {
        p.db.prepare('UPDATE episodes SET ops_since_checkpoint=0, last_checkpoint_at=? WHERE id=?').run(p.now(), id);
        return last.number;
      }
    }
    const number = (last?.number ?? 0) + 1;
    const revId = Number(p.db.prepare('INSERT INTO revisions(episode_id,number,kind,label,doc_hash,doc_json,created_at) VALUES(?,?,?,?,?,?,?)').run(id, number, opts.kind, opts.label ?? null, cur.doc_hash, cur.doc_json, p.now()).lastInsertRowid);
    const ins = p.db.prepare('INSERT INTO revision_refs(revision_id,role,blob_hash) VALUES(?,?,?)');
    for (const [role, hash] of Object.entries(refs)) ins.run(revId, role, hash);
    p.db.prepare('UPDATE episodes SET ops_since_checkpoint=0, last_checkpoint_at=? WHERE id=?').run(p.now(), id);
    return number;
  });
}

export const listRevisions = (p: Project, id: string): RevisionInfo[] =>
  all<{number: number; kind: string; label: string | null; doc_hash: string; created_at: number}>(
    p.db.prepare('SELECT number, kind, label, doc_hash, created_at FROM revisions WHERE episode_id=? ORDER BY number'), id,
  ).map((r) => ({number: r.number, kind: r.kind, label: r.label, docHash: r.doc_hash, createdAt: r.created_at}));

export function getRevision(p: Project, id: string, number: number): EpisodeV2 {
  const r = get<{doc_json: string}>(p.db.prepare('SELECT doc_json FROM revisions WHERE episode_id=? AND number=?'), id, number);
  if (!r) throw new UnknownEpisodeError(`episode "${id}" has no revision r${number}`);
  return JSON.parse(r.doc_json) as EpisodeV2;
}

/** Restore never rewrites history: the old document becomes the working document and a new revision. */
export function restoreRevision(p: Project, id: string, number: number): SaveResult {
  const doc = getRevision(p, id, number);
  const res = saveEpisode(p, id, doc, {kind: 'restore', label: `restored r${number}`});
  if (!res.changed) {
    const n = createRevision(p, id, {kind: 'restore', label: `restored r${number}`});
    return {...res, revision: n};
  }
  return res;
}

export type DocChange = {path: string; before: unknown; after: unknown};
export function diffDocs(a: unknown, b: unknown, path = ''): DocChange[] {
  if (stableStringify(a) === stableStringify(b)) return [];
  const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
  if (!isObj(a) || !isObj(b) || Array.isArray(a) !== Array.isArray(b)) return [{path: path || '(root)', before: a, after: b}];
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].flatMap((k) => diffDocs((a as any)[k], (b as any)[k], path ? `${path}.${k}` : k));
}

// ---- projection ------------------------------------------------------------------------------------------------

type ProjRow = {episode_id: string; path: string; confirmed_hash: string | null; confirmed_seq: number; external_hash: string | null; external_detected_at: number | null};
const projRow = (p: Project, id: string): ProjRow => get<ProjRow>(p.db.prepare('SELECT * FROM projections WHERE episode_id=?'), id)!;

export function classifyProjection(p: Project, id: string): {state: ProjectionState; fileHash: string | null} {
  const pr = projRow(p, id);
  const file = join(p.root, pr.path);
  if (!existsSync(file)) return {state: 'missing', fileHash: null};
  const fileHash = sha256(readFileSync(file));
  const cur = row(p, id);
  if (fileHash === pr.confirmed_hash && pr.confirmed_seq === cur.seq) return {state: 'in-sync', fileHash};
  // Bytes we wrote or were about to write: the last confirmed file plus anything committed since.
  const pending = all<{projection_hash: string | null}>(p.db.prepare('SELECT projection_hash FROM ops WHERE episode_id=? AND seq>?'), id, pr.confirmed_seq).map((o) => o.projection_hash);
  if (fileHash === pr.confirmed_hash || pending.includes(fileHash)) return {state: 'lag', fileHash};
  return {state: 'external', fileHash};
}

function atomicWrite(path: string, text: string): void {
  mkdirSync(dirname(path), {recursive: true});
  const tmp = `${path}.${process.pid}.tmp`;
  const fd = openSync(tmp, 'w');
  try { writeSync(fd, text); fsyncSync(fd); } finally { closeSync(fd); }
  renameSync(tmp, path);
  const dfd = openSync(dirname(path), 'r');
  try { fsyncSync(dfd); } finally { closeSync(dfd); }
}

/** Never overwrites bytes that are not ours unless `force` (an explicit author decision). */
export function writeProjection(p: Project, id: string, opts: {force?: boolean} = {}): 'written' | 'external-pending' {
  const cls = classifyProjection(p, id);
  if (cls.state === 'external' && !opts.force) {
    p.db.prepare('UPDATE projections SET external_hash=?, external_detected_at=COALESCE(external_detected_at, ?) WHERE episode_id=?').run(cls.fileHash, p.now(), id);
    return 'external-pending';
  }
  const doc = getEpisode(p, id);
  const text = projectionBytes(doc);
  atomicWrite(join(p.root, projRow(p, id).path), text);
  p.tx('projection-confirm', () => {
    p.db.prepare('UPDATE projections SET confirmed_hash=?, confirmed_seq=?, external_hash=NULL, external_detected_at=NULL WHERE episode_id=?').run(sha256(text), row(p, id).seq, id);
  });
  return 'written';
}

/** Boot-time reconciliation of every projection (recovery protocol step 6). */
export function reconcileProjections(p: Project): ProjectionAction[] {
  const out: ProjectionAction[] = [];
  for (const id of listEpisodes(p)) {
    const cls = classifyProjection(p, id);
    if (cls.state === 'in-sync') out.push({episodeId: id, action: 'in-sync'});
    else if (cls.state === 'external') {
      writeProjection(p, id);
      out.push({episodeId: id, action: 'external'});
    } else {
      writeProjection(p, id);
      out.push({episodeId: id, action: cls.state === 'missing' ? 'recreated' : 'rewritten'});
    }
  }
  return out;
}

export type ExternalChange = {episodeId: string; path: string; fileHash: string; detectedAt: number | null};

/** Episodes whose episode.json no longer matches anything this project wrote. */
export function externalChanges(p: Project): ExternalChange[] {
  const out: ExternalChange[] = [];
  for (const id of listEpisodes(p)) {
    const cls = classifyProjection(p, id);
    if (cls.state !== 'external') continue;
    const pr = projRow(p, id);
    out.push({episodeId: id, path: pr.path, fileHash: cls.fileHash!, detectedAt: pr.external_detected_at});
  }
  return out;
}

/**
 * Merge a hand-edited v1 file into the current v2 document without losing what v1 cannot express:
 * blocks that still partition the segments, scene layouts, beat ids and review-note details are kept.
 */
export function reconcileV1Import(base: EpisodeV2, incoming: unknown): EpisodeV2 {
  const m = migrateV1ToV2(incoming);
  const out: EpisodeV2 = structuredClone(m);

  const segIds = m.narration.segments.map((s) => s.id);
  const baseFlat = base.narration.blocks.flatMap((b) => b.segments);
  if (baseFlat.length === segIds.length && baseFlat.every((s, i) => s === segIds[i])) out.narration.blocks = structuredClone(base.narration.blocks);

  const layouts = new Map(base.scenes.map((s) => [s.id, s.layout]));
  out.scenes = out.scenes.map((s) => (layouts.has(s.id) ? {...s, layout: structuredClone(layouts.get(s.id)!)} : s));

  const free = [...base.beats];
  const used = new Set(base.beats.map((b) => b.id));
  let next = 1;
  const freshId = () => {
    while (used.has(`b${String(next).padStart(3, '0')}`)) next++;
    const id = `b${String(next).padStart(3, '0')}`;
    used.add(id);
    return id;
  };
  const same = (a: EpisodeV2['beats'][number], b: EpisodeV2['beats'][number]) =>
    a.segment === b.segment && stableStringify(a.at) === stableStringify(b.at) && a.cue === b.cue && a.expression === b.expression;
  out.beats = m.beats.map((b) => {
    const i = free.findIndex((u) => same(u, b));
    if (i >= 0) return {...b, id: free.splice(i, 1)[0].id};
    return {...b, id: freshId()};
  });

  const notes = [...base.reviewNotes];
  const usedNotes = new Set(notes.map((n) => n.id));
  let nn = 1;
  out.reviewNotes = m.reviewNotes.map((n) => {
    const i = notes.findIndex((b) => b.text === n.text);
    if (i >= 0) {
      const [b] = notes.splice(i, 1);
      return (b.status === 'resolved') === (n.status === 'resolved') ? b : {...b, status: n.status};
    }
    while (usedNotes.has(`note${String(nn).padStart(2, '0')}`)) nn++;
    const id = `note${String(nn).padStart(2, '0')}`;
    usedNotes.add(id);
    return {...n, id};
  });
  if (base.migration) out.migration = base.migration;
  return out;
}

/** Accept the externally edited file as a new revision (explicit author action). */
export function importExternal(p: Project, id: string): {imported: boolean; revision: number | null; reason?: string} {
  const cls = classifyProjection(p, id);
  if (cls.state !== 'external') return {imported: false, revision: null, reason: `episode.json is ${cls.state}; nothing to import`};
  const pr = projRow(p, id);
  const text = readFileSync(join(p.root, pr.path), 'utf8');
  let raw: any;
  try { raw = JSON.parse(text); } catch (e) { throw new ExternalParseError(`${pr.path} is not valid JSON: ${(e as Error).message}`); }
  const base = getEpisode(p, id);
  let doc: EpisodeV2;
  if (raw?.schemaVersion === 2) doc = validated(raw);
  else {
    const v1 = EpisodeSchema.safeParse(raw);
    if (!v1.success) throw new ExternalParseError(`${pr.path} is not a valid episode:\n${v1.error.issues.map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`).join('\n')}`);
    doc = validated(reconcileV1Import(base, raw));
  }
  if (doc.id !== id) throw new ExternalParseError(`${pr.path} now has id "${doc.id}", expected "${id}"`);
  if (hashJson(doc) === row(p, id).doc_hash) {
    // Same content, different bytes (formatting): accept the file as ours, no new revision.
    p.tx('accept-external', () => {
      p.db.prepare('UPDATE projections SET confirmed_hash=?, confirmed_seq=?, external_hash=NULL, external_detected_at=NULL WHERE episode_id=?').run(cls.fileHash, row(p, id).seq, id);
    });
    return {imported: false, revision: null, reason: 'content identical to the project; file accepted as is'};
  }
  const res = saveEpisode(p, id, doc, {kind: 'import', label: `imported external edit of ${pr.path}`, forceProjection: true});
  return {imported: true, revision: res.revision};
}

/** Discard an external edit in favour of the project's version; the edited bytes are kept in .studio/backups. */
export function keepProjectVersion(p: Project, id: string): {savedAs: string | null} {
  const cls = classifyProjection(p, id);
  let savedAs: string | null = null;
  if (cls.state === 'external') {
    savedAs = join(p.backupDir, `external-${id}-${cls.fileHash!.slice(0, 12)}.json`);
    writeFileSync(savedAs, readFileSync(join(p.root, projRow(p, id).path)));
  }
  writeProjection(p, id, {force: true});
  return {savedAs};
}
