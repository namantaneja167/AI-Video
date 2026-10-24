// Proof clips: a short window of an episode drawn from its recorded timing and final mix, as its own artifact (kind "proof", subject
// "<label>@<from>-<to>"). Not a build: nothing else depends on it and it never moves an approval. Current while everything a final
// render would be made from is what the clip was drawn from (the document's scenes, the timing, the mix, the render sources).
import {existsSync, readFileSync} from 'node:fs';
import {expectedNow, proofInputsHash} from './artifacts.ts';
import {blobPath} from './blobs.ts';
import {all} from './db.ts';
import type {Project} from './project.ts';

export const PROOF_LABEL = /^[a-z0-9][a-z0-9-]{0,31}$/;
export const proofSubject = (label: string, from: number, to: number): string => `${label}@${from}-${to}`;

export type ProofInfo = {subject: string; label: string; from: number; to: number; state: 'fresh' | 'outdated'; artifactId: number; fileSha256: string; bytes: number; builtAt: number; frames: number | null};

export function proofsFor(p: Project, episodeId: string): ProofInfo[] {
  const rows = all<{id: number; subject: string; blob_hash: string; inputs_hash: string; meta_json: string; created_at: number}>(
    p.db.prepare("SELECT a.id, a.subject, a.blob_hash, a.inputs_hash, a.meta_json, a.created_at FROM current c JOIN artifacts a ON a.id=c.artifact_id WHERE c.episode_id=? AND c.kind='proof' ORDER BY a.id"), episodeId);
  if (!rows.length) return [];
  const {expected} = expectedNow(p, episodeId);
  return rows.filter((r) => existsSync(blobPath(p, r.blob_hash))).map((r) => {
    const m = /^(.+)@([\d.]+)-([\d.]+)$/.exec(r.subject);
    const meta = JSON.parse(r.meta_json) as {bytes?: number; frames?: number};
    return {subject: r.subject, label: m?.[1] ?? r.subject, from: Number(m?.[2] ?? 0), to: Number(m?.[3] ?? 0), state: r.inputs_hash === proofInputsHash(expected, r.subject) ? 'fresh' as const : 'outdated' as const,
      artifactId: r.id, fileSha256: r.blob_hash, bytes: meta.bytes ?? readFileSync(blobPath(p, r.blob_hash)).length, builtAt: r.created_at, frames: meta.frames ?? null};
  });
}
