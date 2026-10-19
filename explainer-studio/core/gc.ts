// Reachability, revision thinning and cleanup. Nothing referenced by retained project state is ever removed.
//
// Cleanup is two steps: planCleanup builds a plan WITHOUT changing anything (including which revisions would be
// thinned and which blobs that frees); executeCleanup applies exactly that plan, but only if the project state
// it was computed from is unchanged. If anything relevant changed, a new preview is required.
import {existsSync, readdirSync, rmSync, statSync} from 'node:fs';
import {join} from 'node:path';
import {blobPath, listBlobFiles} from './blobs.ts';
import {all, get, RETAINED_SQL} from './db.ts';
import {isPermanentRevision, listEpisodes} from './episodes.ts';
import {hashJson} from './hash.ts';
import type {Project} from './project.ts';

const DAY = 86_400_000;

export class StalePlanError extends Error {}

/**
 * Every blob reachable from retained state:
 *  - all remaining revisions' references (selected takes, outputs, component file sets);
 *  - current outputs, approved files, approved references, pinned outputs, component file sets;
 *  - the snapshots of running jobs and of failed or cancelled jobs (they can be retried on the same inputs).
 * Component manifests pull in the files they list. `includeDrafts: false` leaves out draft renders (for backups).
 * `excludeRevisionIds` answers "what would be reachable if these revisions were gone?" for cleanup planning.
 */
export function reachableBlobs(p: Project, opts: {includeDrafts?: boolean; excludeRevisionIds?: Set<number>} = {}): Set<string> {
  const drafts = opts.includeDrafts ?? true;
  const keep = new Set<string>();
  const add = (rows: {blob_hash: string}[]) => rows.forEach((r) => keep.add(r.blob_hash));
  const notDraftRole = drafts ? '' : " AND role <> 'render:draft'";
  const notDraftArt = drafts ? '' : " AND NOT (a.kind='render' AND a.subject='draft')";
  const exclude = opts.excludeRevisionIds?.size ? ` AND revision_id NOT IN (${[...opts.excludeRevisionIds].map(Number).join(',')})` : '';
  const q = (sql: string) => add(all<{blob_hash: string}>(p.db.prepare(sql)));
  q(`SELECT blob_hash FROM revision_refs WHERE 1=1${notDraftRole}${exclude}`);
  q(`SELECT a.blob_hash FROM current c JOIN artifacts a ON a.id=c.artifact_id WHERE 1=1${notDraftArt}`);
  q('SELECT a.blob_hash FROM approvals ap JOIN artifacts a ON a.id=ap.artifact_id');
  q('SELECT file_sha256 AS blob_hash FROM approvals');
  // every saved narration take, selected or not: re-rolls are the author's alternatives, expensive to make again and never regenerated identically
  q("SELECT blob_hash FROM artifacts WHERE kind='take'");
  q('SELECT blob_hash FROM refs');
  q(`SELECT a.blob_hash FROM artifacts a WHERE a.pinned=1${notDraftArt}`);
  q('SELECT blob_hash FROM components WHERE blob_hash IS NOT NULL');
  q(`SELECT blob_hash FROM snapshot_refs WHERE snapshot_id IN (SELECT snapshot_id FROM jobs WHERE state IN ${RETAINED_SQL})${notDraftRole}`);
  // what approval rested on, and the check report of every video that is kept (its review screen reads it)
  q('SELECT a.blob_hash FROM approval_review ar JOIN artifacts a ON a.id=ar.checks_artifact_id');
  for (const c of all<{blob_hash: string; render_hash: string}>(p.db.prepare("SELECT c.blob_hash, r.blob_hash AS render_hash FROM artifacts c JOIN artifacts r ON r.id=CAST(c.subject AS INTEGER) AND r.kind='render' WHERE c.kind='check'"))) {
    if (keep.has(c.render_hash)) keep.add(c.blob_hash);
  }
  const children = p.db.prepare('SELECT blob_hash FROM fileset_files WHERE manifest_hash=?');
  for (const h of [...keep]) add(all<{blob_hash: string}>(children, h));
  return keep;
}

export type ThinPolicy = {keepRecent: number; dailyDays: number};
export const DEFAULT_THIN: ThinPolicy = {keepRecent: 50, dailyDays: 30};

/**
 * Which automatic revisions would go: keep the newest `keepRecent`, then one per day for `dailyDays`, then one per
 * week. Milestones, approvals, final-render, adopt and restore revisions, the newest revision, and any revision
 * an approval points at are never chosen. Changes nothing.
 */
export function planThinning(p: Project, episodeId: string, policy: ThinPolicy = DEFAULT_THIN): {id: number; number: number}[] {
  const now = p.now();
  const revs = all<{id: number; number: number; kind: string; created_at: number}>(p.db.prepare('SELECT id, number, kind, created_at FROM revisions WHERE episode_id=? ORDER BY number DESC'), episodeId);
  const newest = revs[0]?.number;
  const approvedRevs = new Set(all<{revision_number: number}>(p.db.prepare('SELECT revision_number FROM approvals WHERE episode_id=?'), episodeId).map((r) => r.revision_number));
  const thinnable = revs.filter((r) => !isPermanentRevision(r.kind) && r.number !== newest && !approvedRevs.has(r.number));
  const drop: {id: number; number: number}[] = [];
  const seen = new Set<string>();
  thinnable.forEach((r, i) => {
    if (i < policy.keepRecent) return;
    const bucket = now - r.created_at <= policy.dailyDays * DAY ? `d${Math.floor(r.created_at / DAY)}` : `w${Math.floor(r.created_at / (7 * DAY))}`;
    if (seen.has(bucket)) drop.push({id: r.id, number: r.number});
    else seen.add(bucket);
  });
  return drop;
}

/** Thin one episode now. Returns the removed revision numbers. */
export function thinRevisions(p: Project, episodeId: string, policy: ThinPolicy = DEFAULT_THIN): number[] {
  const drop = planThinning(p, episodeId, policy);
  p.tx('thin', () => { for (const d of drop) p.db.prepare('DELETE FROM revisions WHERE id=?').run(d.id); });
  return drop.map((d) => d.number);
}

export type CleanupPlan = {
  /** Hash of every piece of state the plan depends on; execution refuses to run if it differs. */
  fingerprint: string;
  now: number;
  cutoff: number;
  graceMs: number;
  thin: ThinPolicy | false;
  /** Revision numbers that would be thinned, per episode. */
  thinned: Record<string, number[]>;
  thinnedIds: number[];
  reachable: number;
  blobs: {hash: string; bytes: number}[];
  orphanFiles: string[];
  tmpEntries: string[];
  freedBytes: number;
};
export type GcReport = CleanupPlan & {applied: boolean};

function listings(p: Project): {orphans: {name: string; mtime: number}[]; tmp: {name: string; mtime: number}[]} {
  const known = new Set(all<{hash: string}>(p.db.prepare('SELECT hash FROM blobs')).map((b) => b.hash));
  return {
    orphans: listBlobFiles(p).filter((h) => !known.has(h)).sort().map((name) => ({name, mtime: statSync(blobPath(p, name)).mtimeMs})),
    tmp: (existsSync(p.tmpDir) ? readdirSync(p.tmpDir).sort() : []).map((name) => ({name, mtime: statSync(join(p.tmpDir, name)).mtimeMs})),
  };
}

function fingerprintOf(p: Project, params: unknown): string {
  const q = (sql: string) => all(p.db.prepare(sql)).map((r) => ({...r}));
  const l = listings(p);
  return hashJson({
    params,
    revisions: q('SELECT id, episode_id, number, kind, doc_hash, created_at FROM revisions ORDER BY id'),
    revisionRefs: q('SELECT revision_id, role, blob_hash FROM revision_refs ORDER BY revision_id, role'),
    current: q('SELECT episode_id, kind, subject, artifact_id FROM current ORDER BY episode_id, kind, subject'),
    artifacts: q('SELECT id, blob_hash, pinned, outdated FROM artifacts ORDER BY id'),
    approvals: q('SELECT id, artifact_id, file_sha256 FROM approvals ORDER BY id'),
    approved: q('SELECT * FROM approved ORDER BY episode_id'),
    refs: q('SELECT name, blob_hash FROM refs ORDER BY name'),
    components: q('SELECT scope, name, hash, blob_hash FROM components ORDER BY scope, name'),
    filesets: q('SELECT manifest_hash, path, blob_hash FROM fileset_files ORDER BY manifest_hash, path'),
    blobs: q('SELECT hash, bytes, created_at FROM blobs ORDER BY hash'),
    jobs: q('SELECT id, state, snapshot_id FROM jobs ORDER BY id'),
    snapshotRefs: q(`SELECT snapshot_id, role, blob_hash FROM snapshot_refs WHERE snapshot_id IN (SELECT snapshot_id FROM jobs WHERE state IN ${RETAINED_SQL}) ORDER BY snapshot_id, role`),
    orphanFiles: l.orphans,
    tmp: l.tmp,
  });
}

/**
 * Compute what cleanup would do, including revision thinning, without changing anything: which revisions are
 * thinned, then which blobs become unreachable (and old enough) as a result.
 */
export function planCleanup(p: Project, opts: {graceMs?: number; thin?: ThinPolicy | false} = {}): CleanupPlan {
  const now = p.now();
  const graceMs = opts.graceMs ?? 14 * DAY;
  const thin = opts.thin ?? false;
  const cutoff = now - graceMs;
  const thinned: Record<string, number[]> = {};
  const thinnedIds: number[] = [];
  if (thin) {
    for (const id of listEpisodes(p)) {
      const drop = planThinning(p, id, thin);
      if (drop.length) thinned[id] = drop.map((d) => d.number);
      thinnedIds.push(...drop.map((d) => d.id));
    }
  }
  const reach = reachableBlobs(p, {excludeRevisionIds: new Set(thinnedIds)});
  const blobs = all<{hash: string; bytes: number; created_at: number}>(p.db.prepare('SELECT hash, bytes, created_at FROM blobs ORDER BY hash'))
    .filter((b) => !reach.has(b.hash) && b.created_at <= cutoff)
    .map((b) => ({hash: b.hash, bytes: b.bytes}));
  const l = listings(p);
  return {
    fingerprint: fingerprintOf(p, {now, graceMs, thin, thinnedIds}),
    now, cutoff, graceMs, thin, thinned, thinnedIds,
    reachable: reach.size,
    blobs,
    orphanFiles: l.orphans.filter((o) => o.mtime <= cutoff).map((o) => o.name),
    tmpEntries: l.tmp.filter((t) => t.mtime <= cutoff).map((t) => t.name),
    freedBytes: blobs.reduce((a, b) => a + b.bytes, 0),
  };
}

/** What a plan will do, as one hash: lets a caller confirm that what runs is what was previewed. */
export const planDigest = (plan: CleanupPlan): string =>
  hashJson({thinnedIds: plan.thinnedIds, blobs: plan.blobs.map((b) => b.hash), orphanFiles: plan.orphanFiles, tmpEntries: plan.tmpEntries});

/** Apply exactly the plan, or refuse. Database changes are one transaction; file removal follows the commit. */
export function executeCleanup(p: Project, plan: CleanupPlan): GcReport {
  p.tx('gc', () => {
    const now = fingerprintOf(p, {now: plan.now, graceMs: plan.graceMs, thin: plan.thin, thinnedIds: plan.thinnedIds});
    if (now !== plan.fingerprint) throw new StalePlanError('the project changed since this cleanup was previewed; nothing was removed. Run a new preview.');
    for (const id of plan.thinnedIds) p.db.prepare('DELETE FROM revisions WHERE id=?').run(id);
    for (const {hash} of plan.blobs) {
      const protectedRow = get(
        p.db.prepare('SELECT 1 FROM artifacts a WHERE a.blob_hash=? AND (EXISTS (SELECT 1 FROM current c WHERE c.artifact_id=a.id) OR EXISTS (SELECT 1 FROM approvals ap WHERE ap.artifact_id=a.id))'), hash,
      );
      if (protectedRow) throw new Error(`cleanup invariant violated: blob ${hash} is both unreachable and current or approved`);
      p.db.prepare('DELETE FROM artifacts WHERE blob_hash=?').run(hash);
      p.db.prepare('DELETE FROM snapshot_refs WHERE blob_hash=?').run(hash);
      p.db.prepare('DELETE FROM fileset_files WHERE blob_hash=?').run(hash);
      p.db.prepare('DELETE FROM blobs WHERE hash=?').run(hash);
    }
    const reach = reachableBlobs(p);
    const clash = plan.blobs.filter((b) => reach.has(b.hash));
    if (clash.length) throw new Error(`cleanup invariant violated: ${clash.length} planned blob(s) are still referenced`); // rolls back
  });
  for (const {hash} of plan.blobs) rmSync(blobPath(p, hash), {force: true});
  for (const h of plan.orphanFiles) rmSync(blobPath(p, h), {force: true});
  for (const e of plan.tmpEntries) rmSync(join(p.tmpDir, e), {recursive: true, force: true});
  return {...plan, applied: true};
}

/**
 * Dry run unless `apply`. A dry run returns the exact plan an apply would execute. `apply` with a `plan` runs that
 * plan (and fails if the state moved on); `apply` without one plans and executes in a single step.
 */
export function gc(p: Project, opts: {apply?: boolean; graceMs?: number; thin?: ThinPolicy | false; plan?: CleanupPlan} = {}): GcReport {
  if (!opts.apply) return {...(opts.plan ?? planCleanup(p, opts)), applied: false};
  return executeCleanup(p, opts.plan ?? planCleanup(p, opts));
}
