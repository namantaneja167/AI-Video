// Jobs on immutable snapshots, outputs, freshness, approvals and approved references.
import {existsSync} from 'node:fs';
import type {EpisodeV2} from '../src/schema2.ts';
import {blobPath, putBytes, putFile, requireBlob, verifyBlob} from './blobs.ts';
import {all, get} from './db.ts';
import {
  APPROVAL_COMPONENTS, computeExpected, RENDER_PARTS, UNSET, type ComponentHashes, type Expected, type RenderKind, type UpstreamBlobs,
} from './deps.ts';
import {createRevision, getEpisode} from './episodes.ts';
import {hashJson, sha256File, stableStringify} from './hash.ts';
import {CHECKS_VERSION} from './checks.ts';
import {COVER_FRAME, COVER_VERSION} from './coverSpec.ts';
import type {Project} from './project.ts';
import {collectRefs, currentRows, getComponentHashes, getComponentValues, upstreamBlobs} from './state.ts';

export class JobError extends Error {}
export class ApprovalError extends Error {
  problems: string[];
  constructor(message: string, problems: string[]) {
    super(message);
    this.name = 'ApprovalError';
    this.problems = problems;
  }
}
export class ApprovalVoidError extends Error {
  changed: string[];
  constructor(message: string, changed: string[]) {
    super(message);
    this.name = 'ApprovalVoidError';
    this.changed = changed;
  }
}
export class ReferenceImmutableError extends Error {}

export const JOB_KINDS = {
  'tts.block': {kind: 'take'},
  'timing.build': {kind: 'timing', subject: 'timeline'},
  'mix.draft': {kind: 'mix', subject: 'draft'},
  'mix.final': {kind: 'mix', subject: 'final'},
  'render.draft': {kind: 'render', subject: 'draft'},
  'render.final': {kind: 'render', subject: 'final'},
  // The production checks of one rendered video (the subject is that render's artifact id).
  'check.suite': {kind: 'check'},
  // The cover image of one rendered video (the subject is that render's artifact id).
  'cover.build': {kind: 'cover'},
  // The silent opening animatic of the episode as it is now (not tied to a build).
  'animatic.build': {kind: 'animatic', subject: 'opening'},
  // A short window of the episode as it is now, drawn from its recorded timing and final mix (the subject names the window).
  'proof.build': {kind: 'proof'},
} as const;
export type JobKind = keyof typeof JOB_KINDS;

type Target = {kind: string; subject: string};
const targetOf = (jobKind: JobKind, subject?: string): Target => {
  const t = JOB_KINDS[jobKind];
  return {kind: t.kind, subject: 'subject' in t ? t.subject : (subject ?? '')};
};

/** The inputs of a check run: the exact bytes of the video and the version of the check suite. */
export function checkInputsHash(p: Project, renderArtifactId: number): string {
  const r = get<{blob_hash: string; kind: string}>(p.db.prepare('SELECT blob_hash, kind FROM artifacts WHERE id=?'), renderArtifactId);
  if (!r || r.kind !== 'render') throw new JobError(`artifact ${renderArtifactId} is not a rendered video`);
  return hashJson({kind: 'check', render: r.blob_hash, version: CHECKS_VERSION});
}

/** The inputs of a cover: the exact bytes of the video, the frame and the drawing version. */
export function coverInputsHash(p: Project, renderArtifactId: number): string {
  const r = get<{blob_hash: string; kind: string}>(p.db.prepare('SELECT blob_hash, kind FROM artifacts WHERE id=?'), renderArtifactId);
  if (!r || r.kind !== 'render') throw new JobError(`artifact ${renderArtifactId} is not a rendered video`);
  return hashJson({kind: 'cover', render: r.blob_hash, frame: COVER_FRAME, version: COVER_VERSION});
}

/** A proof clip is current while everything a final render would be made from is what it was drawn from. */
export const proofInputsHash = (e: Expected, subject: string): string => hashJson({kind: 'proof', render: e.render.final.hash, subject});

function inputsFor(e: Expected, t: Target, p?: Project): string {
  if (t.kind === 'proof') return proofInputsHash(e, t.subject);
  if (t.kind === 'check') return checkInputsHash(p!, Number(t.subject));
  if (t.kind === 'cover') return coverInputsHash(p!, Number(t.subject));
  if (t.kind === 'animatic') return e.animatic;
  if (t.kind === 'take') return e.take[t.subject];
  if (t.kind === 'timing') return e.timing;
  if (t.kind === 'mix') return e.mix[t.subject as RenderKind];
  return e.render[t.subject as RenderKind].hash;
}

export function expectedNow(p: Project, episodeId: string): {doc: EpisodeV2; expected: Expected; components: ComponentHashes; up: UpstreamBlobs} {
  const doc = getEpisode(p, episodeId);
  const components = getComponentHashes(p, episodeId);
  const up = upstreamBlobs(p, episodeId, doc);
  return {doc, expected: computeExpected(doc, components, up), components, up};
}

// ---- jobs ------------------------------------------------------------------------------------------------------

/** `componentValues` are the plain-value settings as they were at enqueue (absent in snapshots made by older builds). */
export type SnapshotManifest = {episodeId: string; revision: number; docHash: string; docBlob: string; components: ComponentHashes; componentValues?: Record<string, unknown>; blobs: UpstreamBlobs; expected: Expected};

/** Freeze the episode and its inputs for one job. The job reads only from this snapshot. */
export type NewJob = {episodeId: string; jobKind: JobKind; subject?: string; lane?: 'heavy' | 'light'; params?: Record<string, unknown>};

/** Freeze the inputs and record the job. `startJob` creates it running; the runner creates it queued. */
export function createJob(p: Project, opts: NewJob, state: 'queued' | 'running'): {jobId: number; snapshotId: string; inputsHash: string; revision: number} {
  const target = targetOf(opts.jobKind, opts.subject);
  return p.tx('start-job', () => {
    const {doc, expected, components, up} = expectedNow(p, opts.episodeId);
    if (target.kind === 'take' && !doc.narration.blocks.some((b) => b.id === target.subject)) throw new JobError(`block "${target.subject}" does not exist`);
    const revision = createRevision(p, opts.episodeId, {kind: 'job', reuseByDoc: true});
    const docBlob = putBytes(p, JSON.stringify(doc)).hash;
    const manifest: SnapshotManifest = {episodeId: opts.episodeId, revision, docHash: hashJson(doc), docBlob, components, componentValues: getComponentValues(p, opts.episodeId), blobs: up, expected};
    const snapshotId = hashJson(manifest);
    if (!get(p.db.prepare('SELECT 1 FROM snapshots WHERE id=?'), snapshotId)) {
      p.db.prepare('INSERT INTO snapshots(id,episode_id,revision_number,manifest_json,created_at) VALUES(?,?,?,?,?)').run(snapshotId, opts.episodeId, revision, stableStringify(manifest), p.now());
      const ins = p.db.prepare('INSERT INTO snapshot_refs(snapshot_id,role,blob_hash) VALUES(?,?,?)');
      ins.run(snapshotId, 'doc', docBlob);
      for (const [role, hash] of Object.entries(collectRefs(p, opts.episodeId))) ins.run(snapshotId, role, hash);
    }
    const jobId = Number(
      p.db.prepare('INSERT INTO jobs(episode_id,kind,subject,snapshot_id,state,created_at,lane,params_json) VALUES(?,?,?,?,?,?,?,?)')
        .run(opts.episodeId, opts.jobKind, target.subject, snapshotId, state, p.now(), opts.lane ?? 'heavy', stableStringify(opts.params ?? {})).lastInsertRowid,
    );
    return {jobId, snapshotId, inputsHash: inputsFor(expected, target, p), revision};
  });
}

export const startJob = (p: Project, opts: NewJob) => createJob(p, opts, 'running');

export const getSnapshot = (p: Project, snapshotId: string): SnapshotManifest =>
  JSON.parse(get<{manifest_json: string}>(p.db.prepare('SELECT manifest_json FROM snapshots WHERE id=?'), snapshotId)!.manifest_json);

export type FinishResult = {artifactId: number; outcome: 'current' | 'outdated'; selected: boolean};

/**
 * Record a job's output. In one transaction: if the snapshot's inputs still equal the current inputs the output
 * becomes the current artifact; otherwise it is kept as outdated and nothing current changes. A completed job
 * never moves the approved file.
 */
export function finishJob(p: Project, jobId: number, out: {blobHash: string; meta?: Record<string, unknown>; seed?: number}): FinishResult {
  return p.tx('finish-job', () => {
    const job = get<{id: number; episode_id: string; kind: JobKind; subject: string; snapshot_id: string; state: string}>(p.db.prepare('SELECT * FROM jobs WHERE id=?'), jobId);
    if (!job) throw new JobError(`no job ${jobId}`);
    if (job.state !== 'running') throw new JobError(`job ${jobId} is ${job.state}, not running`);
    requireBlob(p, out.blobHash);
    const snap = getSnapshot(p, job.snapshot_id);
    const target = targetOf(job.kind, job.subject);
    const built = inputsFor(snap.expected, target, p);
    const now = inputsFor(expectedNow(p, job.episode_id).expected, target, p);
    const outcome = built === now ? 'current' : 'outdated';
    const meta = {...(out.meta ?? {}), ...(target.kind === 'take' ? {seed: out.seed ?? 0} : {})};
    const cacheKey = target.kind === 'take' ? hashJson({inputs: built, seed: out.seed ?? 0}) : null;
    const artifactId = Number(
      p.db
        .prepare('INSERT INTO artifacts(episode_id,kind,subject,inputs_hash,cache_key,blob_hash,meta_json,snapshot_id,revision_number,outdated,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
        .run(job.episode_id, target.kind, target.subject, built, cacheKey, out.blobHash, stableStringify(meta), job.snapshot_id, snap.revision, outcome === 'outdated' ? 1 : 0, p.now()).lastInsertRowid,
    );
    let selected = false;
    if (outcome === 'current') {
      const cur = get<{inputs_hash: string}>(
        p.db.prepare('SELECT a.inputs_hash FROM current c JOIN artifacts a ON a.id=c.artifact_id WHERE c.episode_id=? AND c.kind=? AND c.subject=?'),
        job.episode_id, target.kind, target.subject,
      );
      // A re-roll of an already fresh take stays unselected; the author picks it explicitly.
      if (target.kind !== 'take' || !cur || cur.inputs_hash !== now) {
        setCurrent(p, job.episode_id, target, artifactId);
        selected = true;
      }
    }
    p.db.prepare('UPDATE jobs SET state=?, artifact_id=?, finished_at=? WHERE id=?').run(outcome === 'current' ? 'succeeded' : 'outdated', artifactId, p.now(), jobId);
    return {artifactId, outcome, selected};
  });
}

export function failJob(p: Project, jobId: number, error: string): void {
  p.tx('fail-job', () => {
    p.db.prepare("UPDATE jobs SET state='failed', error=?, finished_at=? WHERE id=? AND state='running'").run(error, p.now(), jobId);
  });
}

export const getJob = (p: Project, jobId: number) => get<{id: number; state: string; error: string | null; artifact_id: number | null}>(p.db.prepare('SELECT id, state, error, artifact_id FROM jobs WHERE id=?'), jobId);

function setCurrent(p: Project, episodeId: string, t: Target, artifactId: number): void {
  p.db
    .prepare('INSERT INTO current(episode_id,kind,subject,artifact_id) VALUES(?,?,?,?) ON CONFLICT(episode_id,kind,subject) DO UPDATE SET artifact_id=excluded.artifact_id')
    .run(episodeId, t.kind, t.subject, artifactId);
}

/** An existing output made from exactly these inputs whose file is still there: it can be reused instead of rebuilt. */
export function findArtifactByInputs(p: Project, episodeId: string, kind: string, subject: string, inputsHash: string): {artifactId: number; blobHash: string} | undefined {
  const rows = all<{id: number; blob_hash: string}>(p.db.prepare('SELECT id, blob_hash FROM artifacts WHERE episode_id=? AND kind=? AND subject=? AND inputs_hash=? ORDER BY id DESC'), episodeId, kind, subject, inputsHash);
  const hit = rows.find((r) => existsSync(blobPath(p, r.blob_hash)));
  return hit && {artifactId: hit.id, blobHash: hit.blob_hash};
}

/** Make an existing output the current one. Nothing is built or deleted. */
export function selectArtifact(p: Project, episodeId: string, artifactId: number): void {
  p.tx('select-artifact', () => {
    const a = get<{episode_id: string; kind: string; subject: string; blob_hash: string}>(p.db.prepare('SELECT episode_id, kind, subject, blob_hash FROM artifacts WHERE id=?'), artifactId);
    if (!a || a.episode_id !== episodeId) throw new JobError(`artifact ${artifactId} does not belong to episode "${episodeId}"`);
    requireBlob(p, a.blob_hash);
    setCurrent(p, episodeId, {kind: a.kind, subject: a.subject}, artifactId);
  });
}

/** The author's choice among takes for a block. */
export function selectTake(p: Project, episodeId: string, blockId: string, artifactId: number): void {
  p.tx('select-take', () => {
    const a = get<{episode_id: string; kind: string; subject: string; blob_hash: string}>(p.db.prepare('SELECT episode_id, kind, subject, blob_hash FROM artifacts WHERE id=?'), artifactId);
    if (!a || a.episode_id !== episodeId || a.kind !== 'take' || a.subject !== blockId) throw new JobError(`artifact ${artifactId} is not a take for block "${blockId}"`);
    requireBlob(p, a.blob_hash);
    setCurrent(p, episodeId, {kind: 'take', subject: blockId}, artifactId);
  });
}

/** Cache lookup: an existing take for the same text, voice runtime and seed is reused instead of regenerated. */
export function findTake(p: Project, episodeId: string, blockId: string, seed: number): {artifactId: number; blobHash: string} | undefined {
  return findTakeByInputs(p, episodeId, blockId, expectedNow(p, episodeId).expected.take[blockId], seed);
}

/** The same lookup against explicit inputs, so a job can use the inputs of its own snapshot. */
export function findTakeByInputs(p: Project, episodeId: string, blockId: string, inputsHash: string, seed: number): {artifactId: number; blobHash: string} | undefined {
  const key = hashJson({inputs: inputsHash, seed});
  const r = get<{id: number; blob_hash: string}>(
    p.db.prepare("SELECT id, blob_hash FROM artifacts WHERE episode_id=? AND kind='take' AND subject=? AND cache_key=? ORDER BY id DESC LIMIT 1"), episodeId, blockId, key,
  );
  return r && existsSync(blobPath(p, r.blob_hash)) ? {artifactId: r.id, blobHash: r.blob_hash} : undefined;
}

export const listArtifacts = (p: Project, episodeId: string) =>
  all<{id: number; kind: string; subject: string; outdated: number; revision_number: number | null; blob_hash: string; meta_json: string}>(
    p.db.prepare('SELECT id, kind, subject, outdated, revision_number, blob_hash, meta_json FROM artifacts WHERE episode_id=? ORDER BY id'), episodeId,
  );

export function pinArtifact(p: Project, artifactId: number, pinned = true): void {
  p.db.prepare('UPDATE artifacts SET pinned=? WHERE id=?').run(pinned ? 1 : 0, artifactId);
}

// ---- freshness -------------------------------------------------------------------------------------------------

export type Freshness = 'fresh' | 'stale' | 'none' | 'missing';
export type StatusEntry = {status: Freshness; artifactId?: number; reasons: string[]};
export type Status = {
  takes: Record<string, StatusEntry>;
  timing: StatusEntry;
  mix: Record<RenderKind, StatusEntry>;
  render: Record<RenderKind, StatusEntry>;
  /** Everything that is not fresh, as `kind:subject`, for badges and cost estimates. */
  notFresh: string[];
  unsetComponents: string[];
};

/** Computed, never stored: an output is fresh only if its recorded inputs equal today's and everything upstream is fresh. */
export function statusReport(p: Project, episodeId: string): Status {
  const {doc, expected, components} = expectedNow(p, episodeId);
  const rows = currentRows(p, episodeId);
  const find = (kind: string, subject: string) => rows.find((r) => r.kind === kind && r.subject === subject);
  const entry = (kind: string, subject: string, want: string): StatusEntry => {
    const r = find(kind, subject);
    if (!r) return {status: 'none', reasons: ['no output yet']};
    if (!existsSync(blobPath(p, r.blob_hash))) return {status: 'missing', artifactId: r.artifact_id, reasons: ['output file is missing']};
    if (r.inputs_hash !== want) return {status: 'stale', artifactId: r.artifact_id, reasons: ['inputs changed since it was built']};
    return {status: 'fresh', artifactId: r.artifact_id, reasons: []};
  };
  const upstream = (e: StatusEntry, deps: [string, StatusEntry][]): StatusEntry => {
    const bad = deps.filter(([, d]) => d.status !== 'fresh');
    if (!bad.length) return e;
    const reasons = [...e.reasons, ...bad.map(([n]) => `upstream ${n} is not fresh`)];
    return {...e, status: e.status === 'none' || e.status === 'missing' ? e.status : 'stale', reasons};
  };

  const takes: Record<string, StatusEntry> = {};
  for (const b of doc.narration.blocks) takes[b.id] = entry('take', b.id, expected.take[b.id]);
  const takeDeps = Object.entries(takes).map(([id, e]) => [`take ${id}`, e] as [string, StatusEntry]);
  const timing = upstream(entry('timing', 'timeline', expected.timing), takeDeps);
  const accents = components.soundEvents !== UNSET && components.soundEvents !== hashJson([]);
  const mix = {} as Status['mix'];
  const render = {} as Status['render'];
  for (const k of ['draft', 'final'] as const) {
    mix[k] = upstream(entry('mix', k, expected.mix[k]), accents ? [...takeDeps, ['timing', timing] as [string, StatusEntry]] : takeDeps);
    render[k] = upstream(entry('render', k, expected.render[k].hash), [['timing', timing], [`mix ${k}`, mix[k]]]);
  }
  const notFresh = [
    ...Object.entries(takes).filter(([, e]) => e.status !== 'fresh').map(([id]) => `take:${id}`),
    ...(timing.status !== 'fresh' ? ['timing'] : []),
    ...(['draft', 'final'] as const).flatMap((k) => [...(mix[k].status !== 'fresh' ? [`mix:${k}`] : []), ...(render[k].status !== 'fresh' ? [`render:${k}`] : [])]),
  ];
  return {takes, timing, mix, render, notFresh, unsetComponents: Object.entries(components).filter(([, h]) => h === UNSET).map(([n]) => n)};
}

// ---- approval --------------------------------------------------------------------------------------------------

export const SIGNOFFS = ['listened', 'watchedPhoneSize', 'customScenesReviewed', 'notesResolved'] as const;
export type Signoffs = Record<(typeof SIGNOFFS)[number], boolean>;

/**
 * Record approval of the current final render. Everything is checked first and all problems are reported together.
 * This is the only operation that moves the approved-file pointer.
 */
export function approve(p: Project, episodeId: string, signoffs: Signoffs, inSameTransaction?: (approvalId: number) => void): number {
  const problems: string[] = [];
  const status = statusReport(p, episodeId);
  const cur = currentRows(p, episodeId).find((r) => r.kind === 'render' && r.subject === 'final');
  if (!cur) problems.push('there is no final render');
  else {
    try { verifyBlob(p, cur.blob_hash); } catch (e) { problems.push(`the final render file cannot be verified: ${(e as Error).message}`); }
    if (status.render.final.status !== 'fresh') problems.push(`the final render is ${status.render.final.status}: ${status.render.final.reasons.join('; ')}`);
    if (JSON.parse(cur.meta_json).mastered !== true) problems.push('the final render is not marked as mastered; only a mastered file can be approved');
  }
  const {components, expected} = expectedNow(p, episodeId);
  const unset = APPROVAL_COMPONENTS.filter((c) => components[c] === UNSET);
  if (unset.length) problems.push(`these inputs are not recorded: ${unset.join(', ')}`);
  const missing = SIGNOFFS.filter((s) => signoffs?.[s] !== true);
  if (missing.length) problems.push(`manual sign-offs missing: ${missing.join(', ')}`);
  if (problems.length) throw new ApprovalError(`cannot approve:\n  - ${problems.join('\n  - ')}`, problems);

  p.autoBackup('pre-approval'); // VACUUM cannot run inside a transaction
  return p.tx('approve', () => {
    const revision = createRevision(p, episodeId, {kind: 'approval', label: 'approved final render'});
    const id = Number(
      p.db
        .prepare('INSERT INTO approvals(episode_id,artifact_id,file_sha256,parts_json,inputs_hash,revision_number,signoffs_json,approved_at) VALUES(?,?,?,?,?,?,?,?)')
        .run(episodeId, cur!.artifact_id, cur!.blob_hash, stableStringify(expected.render.final.parts), expected.render.final.hash, revision, stableStringify(signoffs), p.now()).lastInsertRowid,
    );
    p.db.prepare('INSERT INTO approved(episode_id,approval_id) VALUES(?,?) ON CONFLICT(episode_id) DO UPDATE SET approval_id=excluded.approval_id').run(episodeId, id);
    inSameTransaction?.(id);
    return id;
  });
}

export type ApprovalStatus = {state: 'none' | 'valid' | 'void'; approvalId?: number; changed: string[]; revision?: number};

/** Computed on every call: approval is void as soon as any hashed input differs from what was approved. */
export function approvalStatus(p: Project, episodeId: string): ApprovalStatus {
  const a = get<{id: number; artifact_id: number; file_sha256: string; parts_json: string; inputs_hash: string; revision_number: number}>(
    p.db.prepare('SELECT ap.* FROM approved d JOIN approvals ap ON ap.id=d.approval_id WHERE d.episode_id=?'), episodeId,
  );
  if (!a) return {state: 'none', changed: []};
  const {expected} = expectedNow(p, episodeId);
  const now = expected.render.final;
  const changed: string[] = [];
  if (now.hash !== a.inputs_hash) {
    const then = JSON.parse(a.parts_json) as Record<string, string>;
    for (const part of RENDER_PARTS) if (then[part] !== now.parts[part]) changed.push(part);
  }
  try { requireBlob(p, a.file_sha256); } catch { changed.push('file'); }
  return {state: changed.length ? 'void' : 'valid', approvalId: a.id, changed, revision: a.revision_number};
}

/** The approved file, re-hashed. Throws if approval is void or the bytes no longer match. */
export function getApprovedFile(p: Project, episodeId: string): {path: string; sha256: string; bytes: number} {
  const s = approvalStatus(p, episodeId);
  if (s.state === 'none') throw new ApprovalVoidError('there is no approved final render', []);
  if (s.state === 'void') throw new ApprovalVoidError(`approval is void; changed: ${s.changed.join(', ')}`, s.changed);
  const a = get<{file_sha256: string}>(p.db.prepare('SELECT file_sha256 FROM approvals WHERE id=?'), s.approvalId);
  try { verifyBlob(p, a!.file_sha256); } catch (e) { throw new ApprovalVoidError(`the approved file is damaged: ${(e as Error).message}`, ['file']); }
  const path = blobPath(p, a!.file_sha256);
  return {path, sha256: a!.file_sha256, bytes: sha256File(path).bytes};
}

// ---- approved references ---------------------------------------------------------------------------------------

/** Ingest an approved reference (for example the voice reference). Immutable once recorded. */
export function addReference(p: Project, name: string, source: string, meta: Record<string, unknown> = {}): {hash: string} {
  const {hash} = putFile(p, source);
  verifyBlob(p, hash);
  return p.tx('add-reference', () => {
    const cur = get<{blob_hash: string}>(p.db.prepare('SELECT blob_hash FROM refs WHERE name=?'), name);
    if (cur && cur.blob_hash !== hash) throw new ReferenceImmutableError(`approved reference "${name}" already exists with different content; references are never overwritten`);
    if (!cur) p.db.prepare('INSERT INTO refs(name,blob_hash,source_path,meta_json,approved_at) VALUES(?,?,?,?,?)').run(name, hash, source, stableStringify(meta), p.now());
    return {hash};
  });
}

export function getReference(p: Project, name: string): {hash: string; path: string; meta: Record<string, unknown>} {
  const r = get<{blob_hash: string; meta_json: string}>(p.db.prepare('SELECT blob_hash, meta_json FROM refs WHERE name=?'), name);
  if (!r) throw new JobError(`no approved reference "${name}"`);
  verifyBlob(p, r.blob_hash);
  return {hash: r.blob_hash, path: blobPath(p, r.blob_hash), meta: JSON.parse(r.meta_json)};
}
