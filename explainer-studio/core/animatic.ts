// The five-second opening animatic of an episode: a silent preview of the branded opening and the first scene's first beat, drawn
// by the render engine on an estimated clock. It is an artifact of its own (kind "animatic", subject "opening"), current only while
// the script, the scenes, the hook and the render sources are what it was drawn from. It is a planning aid: never a build, never
// narrated, and its times are guesses.
import {existsSync, readFileSync} from 'node:fs';
import {expectedNow} from './artifacts.ts';
import {ANIMATIC_FRAMES, ANIMATIC_SEC} from './animaticSpec.ts';
import {blobPath} from './blobs.ts';
import {get} from './db.ts';
import type {Project} from './project.ts';

export {ANIMATIC_FRAMES, ANIMATIC_SEC};

export type AnimaticState = 'none' | 'running' | 'fresh' | 'outdated';
export type AnimaticInfo = {
  state: AnimaticState;
  artifactId: number | null;
  hook: string | null;
  seriesLabel: string | null;
  fileSha256: string | null;
  bytes: number | null;
  builtAt: number | null;
  why: string | null;
};

/** The animatic as it stands now. Computed on every call, never stored. */
export function animaticFor(p: Project, episodeId: string): AnimaticInfo {
  const running = !!get(p.db.prepare("SELECT 1 FROM jobs WHERE episode_id=? AND kind='animatic.build' AND state IN ('queued','preparing','running','cancelling')"), episodeId);
  const cur = get<{id: number; blob_hash: string; inputs_hash: string; meta_json: string; created_at: number}>(
    p.db.prepare("SELECT a.id, a.blob_hash, a.inputs_hash, a.meta_json, a.created_at FROM current c JOIN artifacts a ON a.id=c.artifact_id WHERE c.episode_id=? AND c.kind='animatic' AND c.subject='opening'"), episodeId);
  const none: AnimaticInfo = {state: running ? 'running' : 'none', artifactId: null, hook: null, seriesLabel: null, fileSha256: null, bytes: null, builtAt: null, why: null};
  if (!cur || !existsSync(blobPath(p, cur.blob_hash))) return none;
  const meta = JSON.parse(cur.meta_json) as {hook?: string; seriesLabel?: string | null; bytes?: number};
  const fresh = cur.inputs_hash === expectedNow(p, episodeId).expected.animatic;
  return {
    state: running ? 'running' : fresh ? 'fresh' : 'outdated', artifactId: cur.id, hook: meta.hook ?? null, seriesLabel: meta.seriesLabel ?? null,
    fileSha256: cur.blob_hash, bytes: meta.bytes ?? readFileSync(blobPath(p, cur.blob_hash)).length, builtAt: cur.created_at,
    why: fresh ? null : 'The hook, the script, the scenes or the render sources changed after this animatic was drawn.',
  };
}
