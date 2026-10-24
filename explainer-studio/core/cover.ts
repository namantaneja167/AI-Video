// The cover image of one rendered video: a clean 1080 x 1920 frame of that video's own branded opening, drawn without captions by the
// same browser engine from the same recorded inputs the video was rendered from. It is an artifact of its own (kind "cover", subject =
// the render's artifact id), so which video it belongs to is a fact in the project, not a file name. It is current only while that video
// is: a change that makes the video out of date (the hook, the script, the sound, the scenes) makes the cover outdated with it.
import {existsSync, readFileSync} from 'node:fs';
import {coverInputsHash, getSnapshot, statusReport} from './artifacts.ts';
import {COVER_FRAME, COVER_SIZE, COVER_VERSION, pngSize} from './coverSpec.ts';
import {blobPath, readBlob} from './blobs.ts';
import {all, get} from './db.ts';
import type {Project} from './project.ts';
import type {EpisodeV2} from '../src/schema2.ts';

export {COVER_FRAME, COVER_SIZE, COVER_VERSION, pngSize};

export class CoverError extends Error {}

export type CoverState = 'none' | 'running' | 'fresh' | 'outdated';
export type CoverInfo = {
  state: CoverState;
  renderArtifactId: number;
  coverArtifactId: number | null;
  /** The hook the video's opening shows, read from the video's own recorded document. */
  hook: string | null;
  fileSha256: string | null;
  bytes: number | null;
  width: number | null;
  height: number | null;
  frame: number | null;
  builtAt: number | null;
  /** The SHA-256 of the video the cover was drawn for. */
  renderSha256: string;
  /** Why an outdated cover is outdated, in words; null otherwise. */
  why: string | null;
};

type Row = {id: number; blob_hash: string; inputs_hash: string; meta_json: string; created_at: number};

/** The cover of one video, as it stands now. Computed on every call, never stored. */
export function coverFor(p: Project, episodeId: string, renderArtifactId: number): CoverInfo {
  const render = get<{id: number; subject: string; blob_hash: string; snapshot_id: string | null}>(p.db.prepare("SELECT id, subject, blob_hash, snapshot_id FROM artifacts WHERE id=? AND episode_id=? AND kind='render'"), renderArtifactId, episodeId);
  if (!render) throw new CoverError(`artifact ${renderArtifactId} is not a rendered video of episode "${episodeId}"`);
  let hook: string | null = null;
  try { if (render.snapshot_id) hook = (JSON.parse(readBlob(p, getSnapshot(p, render.snapshot_id).docBlob).toString()) as EpisodeV2).scenes[0]?.openingHook ?? null; } catch { /* a video without a readable record has no known hook */ }
  const base = {renderArtifactId, renderSha256: render.blob_hash, hook};
  const running = !!get(p.db.prepare("SELECT 1 FROM jobs WHERE episode_id=? AND kind='cover.build' AND subject=? AND state IN ('queued','preparing','running','cancelling')"), episodeId, String(renderArtifactId));
  const cur = get<Row>(p.db.prepare("SELECT a.id, a.blob_hash, a.inputs_hash, a.meta_json, a.created_at FROM current c JOIN artifacts a ON a.id=c.artifact_id WHERE c.episode_id=? AND c.kind='cover' AND c.subject=?"), episodeId, String(renderArtifactId));
  const none = (): CoverInfo => ({...base, state: running ? 'running' : 'none', coverArtifactId: null, fileSha256: null, bytes: null, width: null, height: null, frame: null, builtAt: null, why: null});
  if (!cur || !existsSync(blobPath(p, cur.blob_hash)) || cur.inputs_hash !== coverInputsHash(p, renderArtifactId)) return none();
  const meta = JSON.parse(cur.meta_json) as {width?: number; height?: number; frame?: number; bytes?: number};
  const kind = render.subject as 'draft' | 'final';
  const st = statusReport(p, episodeId).render[kind];
  let why: string | null = null;
  if (st.artifactId !== renderArtifactId) why = `A newer ${kind} video has been made since this one, so this cover belongs to an earlier video.`;
  else if (st.status !== 'fresh') why = `The video it belongs to is out of date (${st.reasons.join('; ') || st.status}): something that appears in the video changed after it was made, such as the hook, the script, the scenes or the sound.`;
  return {...base, state: running ? 'running' : why ? 'outdated' : 'fresh', coverArtifactId: cur.id, fileSha256: cur.blob_hash, bytes: meta.bytes ?? readFileSync(blobPath(p, cur.blob_hash)).length, width: meta.width ?? null, height: meta.height ?? null, frame: meta.frame ?? null, builtAt: cur.created_at, why};
}

/** Every cover this episode has, for the artifact list. */
export const coverArtifacts = (p: Project, episodeId: string) => all<{id: number; subject: string; blob_hash: string}>(p.db.prepare("SELECT id, subject, blob_hash FROM artifacts WHERE episode_id=? AND kind='cover' ORDER BY id"), episodeId);
