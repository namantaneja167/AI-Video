// Components (fonts, code, settings...) and the references a revision or snapshot captures.
import {join} from 'node:path';
import {putBytes, putFile} from './blobs.ts';
import {all, get} from './db.ts';
import {COMPONENT_NAMES, UNSET, type ComponentHashes, type ComponentName, type UpstreamBlobs} from './deps.ts';
import {hashJson, stableStringify} from './hash.ts';
import type {Project} from './project.ts';
import type {EpisodeV2} from '../src/schema2.ts';

/** Record a plain-value component (settings, versions...). Returns its hash. Scope `*` is project-wide. */
export function setComponent(p: Project, name: ComponentName, value: unknown, scope = '*'): string {
  if (!COMPONENT_NAMES.includes(name)) throw new Error(`unknown component "${name}"`);
  const hash = hashJson(value);
  p.db
    .prepare(
      `INSERT INTO components(scope,name,hash,value_json,blob_hash,updated_at) VALUES(?,?,?,?,NULL,?)
       ON CONFLICT(scope,name) DO UPDATE SET hash=excluded.hash, value_json=excluded.value_json, blob_hash=NULL, updated_at=excluded.updated_at`,
    )
    .run(scope, name, hash, stableStringify(value), p.now());
  return hash;
}

/**
 * Copy files into the blob store and record the set as a component (assets, fonts, code, theme). The hash is
 * that of the manifest, so any file change, addition or removal changes it. Paths are relative to baseDir.
 */
export function captureFileSet(p: Project, name: ComponentName, baseDir: string, relPaths: string[], scope = '*'): {hash: string; files: number} {
  const entries = [...new Set(relPaths)].sort().map((rel) => {
    const {hash, bytes} = putFile(p, join(baseDir, rel));
    return {path: rel, sha256: hash, bytes};
  });
  const manifest = putBytes(p, stableStringify({name, files: entries}));
  p.tx('capture-fileset', () => {
    const ins = p.db.prepare('INSERT OR IGNORE INTO fileset_files(manifest_hash,path,blob_hash) VALUES(?,?,?)');
    for (const e of entries) ins.run(manifest.hash, e.path, e.sha256);
    p.db
      .prepare(
        `INSERT INTO components(scope,name,hash,value_json,blob_hash,updated_at) VALUES(?,?,?,?,?,?)
         ON CONFLICT(scope,name) DO UPDATE SET hash=excluded.hash, value_json=excluded.value_json, blob_hash=excluded.blob_hash, updated_at=excluded.updated_at`,
      )
      .run(scope, name, manifest.hash, JSON.stringify({files: entries.length}), manifest.hash, p.now());
  });
  return {hash: manifest.hash, files: entries.length};
}

/** Episode-specific component if present, else the project-wide one, else "unset". */
export function getComponentHashes(p: Project, episodeId: string): ComponentHashes {
  const out = {} as ComponentHashes;
  const q = p.db.prepare('SELECT hash FROM components WHERE scope=? AND name=?');
  for (const name of COMPONENT_NAMES) out[name] = get<{hash: string}>(q, episodeId, name)?.hash ?? get<{hash: string}>(q, '*', name)?.hash ?? UNSET;
  return out;
}

/** Plain-value components (not file sets) as they are now; a job snapshot freezes these at enqueue. */
export function getComponentValues(p: Project, episodeId: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const q = p.db.prepare('SELECT value_json, blob_hash FROM components WHERE scope=? AND name=?');
  for (const name of COMPONENT_NAMES) {
    const r = get<{value_json: string; blob_hash: string | null}>(q, episodeId, name) ?? get<{value_json: string; blob_hash: string | null}>(q, '*', name);
    if (r && r.blob_hash === null) out[name] = JSON.parse(r.value_json);
  }
  return out;
}

export function getComponentValue<T = unknown>(p: Project, name: ComponentName, episodeId?: string): T | undefined {
  const q = p.db.prepare('SELECT value_json FROM components WHERE scope=? AND name=?');
  const r = (episodeId ? get<{value_json: string}>(q, episodeId, name) : undefined) ?? get<{value_json: string}>(q, '*', name);
  return r ? (JSON.parse(r.value_json) as T) : undefined;
}

export type CurrentRow = {kind: string; subject: string; artifact_id: number; inputs_hash: string; blob_hash: string; meta_json: string; outdated: number};

export function currentRows(p: Project, episodeId: string): CurrentRow[] {
  return all<CurrentRow>(
    p.db.prepare(
      `SELECT c.kind, c.subject, c.artifact_id, a.inputs_hash, a.blob_hash, a.meta_json, a.outdated
       FROM current c JOIN artifacts a ON a.id = c.artifact_id WHERE c.episode_id=? ORDER BY c.kind, c.subject`,
    ),
    episodeId,
  );
}

/** Blob hashes of the current outputs, shaped for dependency hashing. */
export function upstreamBlobs(p: Project, episodeId: string, doc: EpisodeV2): UpstreamBlobs {
  const rows = currentRows(p, episodeId);
  const find = (kind: string, subject: string) => rows.find((r) => r.kind === kind && r.subject === subject)?.blob_hash ?? null;
  return {
    takes: Object.fromEntries(doc.narration.blocks.map((b) => [b.id, find('take', b.id)])),
    timing: find('timing', 'timeline'),
    mix: {draft: find('mix', 'draft'), final: find('mix', 'final')},
  };
}

/** What a revision (or job snapshot) pins: selected takes, current outputs and the component file sets. */
export function collectRefs(p: Project, episodeId: string): Record<string, string> {
  const refs: Record<string, string> = {};
  for (const r of currentRows(p, episodeId)) refs[r.kind === 'take' ? `take:${r.subject}` : `${r.kind}:${r.subject}`] = r.blob_hash;
  for (const c of all<{name: string; blob_hash: string}>(
    p.db.prepare("SELECT name, blob_hash FROM components WHERE blob_hash IS NOT NULL AND (scope='*' OR scope=?)"),
    episodeId,
  ))
    refs[`component:${c.name}`] = c.blob_hash;
  return refs;
}

export const readComponentFiles = (p: Project, manifestHash: string): {path: string; blob_hash: string}[] =>
  all(p.db.prepare('SELECT path, blob_hash FROM fileset_files WHERE manifest_hash=? ORDER BY path'), manifestHash);
