// The planning store: plan documents, their history, and the record of every import. Same rules as episodes: the database is
// the only authority, saves carry the sequence number they were made against, and nothing is overwritten silently.
// Accepting an import writes the plan, the episode and the import's outcome in ONE transaction, or nothing at all.
import {createHash} from 'node:crypto';
import {all, get} from '../core/db.ts';
import {ConflictError, createEpisode, createRevision, getEpisode, getEpisodeInfo, listEpisodes, saveEpisode, writeProjection} from '../core/episodes.ts';
import {applyBrandDefaults} from '../core/brand.ts';
import {hashJson} from '../core/hash.ts';
import type {Project} from '../core/project.ts';
import type {EpisodeV2} from '../src/schema2.ts';
import {applyImport, type Selection} from './shared/importing.ts';
import {parseInput, type ParseResult, type Proposal, type Shape} from './shared/packet.ts';
import {newPlan, slugify, uniqueId, validatePlan, type PlanDoc, type PlanIssue} from './shared/plan.ts';
import {planApplication, productionBlockers, type Application} from './shared/storyboard.ts';

export class PlanValidationError extends Error { issues: PlanIssue[]; constructor(message: string, issues: PlanIssue[]) { super(message); this.name = 'PlanValidationError'; this.issues = issues; } }
export class PlanConflictError extends Error {}
export class UnknownPlanError extends Error {}
export class ImportStateError extends Error {}
/** Applying the storyboard was refused; `problems` says why, scene by scene. */
export class ApplyError extends Error { problems: string[]; constructor(message: string, problems: string[]) { super(message); this.name = 'ApplyError'; this.problems = problems; } }

type PlanRow = {id: string; doc_json: string; doc_hash: string; seq: number; created_at: number; updated_at: number};
const row = (p: Project, id: string): PlanRow => {
  const r = get<PlanRow>(p.db.prepare('SELECT * FROM plans WHERE id=?'), id);
  if (!r) throw new UnknownPlanError(`no plan "${id}" in this workspace`);
  return r;
};
export const planExists = (p: Project, id: string): boolean => !!get(p.db.prepare('SELECT 1 FROM plans WHERE id=?'), id);
export const listPlanIds = (p: Project): string[] => all<{id: string}>(p.db.prepare('SELECT id FROM plans ORDER BY id')).map((r) => r.id);

export type StoredPlan = {plan: PlanDoc; seq: number; docHash: string; createdAt: number; updatedAt: number};
export function getPlan(p: Project, id: string): StoredPlan {
  const r = row(p, id);
  return {plan: JSON.parse(r.doc_json) as PlanDoc, seq: r.seq, docHash: r.doc_hash, createdAt: r.created_at, updatedAt: r.updated_at};
}

function validated(input: unknown): PlanDoc {
  const v = validatePlan(input);
  if (!v.ok) throw new PlanValidationError(`the plan is invalid:\n${v.issues.map((i) => `  - ${i.path}: ${i.message}`).join('\n')}`, v.issues);
  return v.plan;
}

function writeRevision(p: Project, doc: PlanDoc, docHash: string, kind: string, label: string | null): number {
  const n = (get<{n: number | null}>(p.db.prepare('SELECT MAX(number) AS n FROM plan_revisions WHERE plan_id=?'), doc.id)?.n ?? 0) + 1;
  p.db.prepare('INSERT INTO plan_revisions(plan_id,number,kind,label,doc_hash,doc_json,created_at) VALUES(?,?,?,?,?,?,?)').run(doc.id, n, kind, label, docHash, JSON.stringify(doc), p.now());
  return n;
}

/** A new draft. The id comes from the title and never collides with an existing plan or episode. */
export function createPlan(p: Project, input: {title: string; audience?: string; objective?: string; durationMin?: number | null; brand?: 'pip-explains'}): StoredPlan {
  const title = String(input.title ?? '').trim();
  const id = uniqueId(slugify(title), [...listPlanIds(p), ...listEpisodes(p)]);
  const doc = validated(newPlan({id, title, audience: input.audience, objective: input.objective, durationMin: input.durationMin ?? null, ...(input.brand ? {brand: input.brand} : {})}));
  const hash = hashJson(doc);
  p.tx('create-plan', () => {
    p.db.prepare('INSERT INTO plans(id,doc_json,doc_hash,seq,created_at,updated_at) VALUES(?,?,?,1,?,?)').run(id, JSON.stringify(doc), hash, p.now(), p.now());
    writeRevision(p, doc, hash, 'create', 'draft started');
  });
  return getPlan(p, id);
}

export class LinkError extends Error {}

/**
 * Give an episode that was made without a planning document (created from files, a script or the project API) the planning document the
 * app's steps work on. Purely additive: one new row in `plans` and its first revision. The episode, its takes, builds and history are not
 * read for rewriting and not changed, and since a plan is never part of what a build depends on, nothing becomes out of date.
 * The brief and the storyboard are written down from what the episode already holds (title, learning objective, sources, scenes) and
 * say so in the notes; nothing is invented (no audience, no claims). The plan has the episode's id, which is how the two are connected.
 */
export function linkPlanToEpisode(p: Project, episodeId: string, o: {audience?: string; brand?: boolean} = {}): StoredPlan {
  if (!listEpisodes(p).includes(episodeId)) throw new LinkError(`there is no episode "${episodeId}" in this project`);
  if (planExists(p, episodeId)) throw new LinkError(`episode "${episodeId}" already has its planning document`);
  const doc = getEpisode(p, episodeId);
  const info = getEpisodeInfo(p, episodeId);
  const isUrl = (u: string | undefined): u is string => !!u && /^https?:\/\//i.test(u);
  const hasHook = !!doc.scenes[0]?.openingHook;
  const plan = validated({
    ...newPlan({id: episodeId, title: doc.title, audience: o.audience ?? '', objective: doc.learningObjective, durationMin: null, ...(o.brand && hasHook ? {brand: 'pip-explains' as const} : {})}),
    notes: `Linked to the existing episode "${episodeId}" (episode revision ${info.seq}) on ${new Date(p.now()).toISOString().slice(0, 10)}. The objective, sources and scenes below were copied from the episode itself; nothing was researched or imported. Fill in the audience, claims and intentions yourself.`,
    sources: doc.sources.map((s, i) => ({id: `src${i + 1}`, title: s.title, url: isUrl(s.url) ? s.url : null, publisher: '', published: '', note: s.note ?? (s.url && !isUrl(s.url) ? s.url : ''), checked: null, provenance: null})),
    storyboard: doc.scenes.map((s, i) => ({id: `sb${i + 1}`, segmentIds: s.segments, sceneType: s.type, intention: '', mechanism: '', pip: [], params: (s.params ?? null) as Record<string, unknown> | null, provenance: null})),
  });
  const hash = hashJson(plan);
  p.tx('link-plan', () => {
    p.db.prepare('INSERT INTO plans(id,doc_json,doc_hash,seq,created_at,updated_at) VALUES(?,?,?,1,?,?)').run(episodeId, JSON.stringify(plan), hash, p.now(), p.now());
    writeRevision(p, plan, hash, 'link', 'linked to the existing episode');
  });
  return getPlan(p, episodeId);
}

export type PlanSave = {changed: boolean; seq: number; revision: number | null};
export function savePlan(p: Project, id: string, input: unknown, opts: {baseSeq: number; kind?: string; label?: string}): PlanSave {
  const doc = validated(input);
  if (doc.id !== id) throw new PlanValidationError(`document id "${doc.id}" does not match plan "${id}"`, [{path: 'id', message: 'must not change'}]);
  const hash = hashJson(doc);
  return p.tx('save-plan', () => {
    const cur = row(p, id);
    if (cur.seq !== opts.baseSeq) throw new PlanConflictError(`plan "${id}" changed since seq ${opts.baseSeq} (now ${cur.seq})`);
    if (hash === cur.doc_hash) return {changed: false, seq: cur.seq, revision: null};
    const seq = cur.seq + 1;
    p.db.prepare('UPDATE plans SET doc_json=?, doc_hash=?, seq=?, updated_at=? WHERE id=?').run(JSON.stringify(doc), hash, seq, p.now(), id);
    return {changed: true, seq, revision: writeRevision(p, doc, hash, opts.kind ?? 'edit', opts.label ?? null)};
  });
}

export type PlanRevision = {number: number; kind: string; label: string | null; createdAt: number; docHash: string; isCurrent: boolean; summary: string};
export function listPlanRevisions(p: Project, id: string): PlanRevision[] {
  const cur = row(p, id).doc_hash;
  const rows = all<{number: number; kind: string; label: string | null; created_at: number; doc_hash: string; doc_json: string}>(p.db.prepare('SELECT number, kind, label, created_at, doc_hash, doc_json FROM plan_revisions WHERE plan_id=? ORDER BY number'), id);
  let prev: PlanDoc | null = null;
  const out = rows.map((r) => {
    const doc = JSON.parse(r.doc_json) as PlanDoc;
    const summary = describeChange(prev, doc);
    prev = doc;
    return {number: r.number, kind: r.kind, label: r.label, createdAt: r.created_at, docHash: r.doc_hash, isCurrent: r.doc_hash === cur, summary};
  });
  return out.reverse();
}
function describeChange(a: PlanDoc | null, b: PlanDoc): string {
  if (!a) return 'Draft started';
  const out: string[] = [];
  const j = JSON.stringify;
  if (a.title !== b.title || a.audience !== b.audience || a.objective !== b.objective || a.durationMin !== b.durationMin || a.notes !== b.notes) out.push('brief');
  if (j(a.sources) !== j(b.sources)) out.push(`sources (${a.sources.length} to ${b.sources.length})`);
  if (j(a.claims) !== j(b.claims)) out.push(`claims (${a.claims.length} to ${b.claims.length})`);
  if (j(a.storyboard) !== j(b.storyboard)) out.push(`storyboard (${a.storyboard.length} to ${b.storyboard.length} scenes)`);
  return out.length ? `Changed ${out.join(', ')}` : 'No change';
}

/** Restore never rewrites history: the old plan becomes the current one and a new revision. The episode is not touched. */
export function restorePlanRevision(p: Project, id: string, number: number, baseSeq: number): PlanSave {
  const r = get<{doc_json: string}>(p.db.prepare('SELECT doc_json FROM plan_revisions WHERE plan_id=? AND number=?'), id, number);
  if (!r) throw new UnknownPlanError(`plan "${id}" has no revision ${number}`);
  const res = savePlan(p, id, JSON.parse(r.doc_json), {baseSeq, kind: 'restore', label: `restored revision ${number}`});
  if (res.changed) return res;
  const cur = row(p, id);
  return {changed: false, seq: cur.seq, revision: null};
}

// ---- imports -------------------------------------------------------------------------------------------------------------------
export type ImportRow = {id: number; planId: string; createdAt: number; via: 'paste' | 'file'; sourceName: string | null; shape: Shape; sha256: string; bytes: number; state: 'proposed' | 'accepted' | 'rejected'; resolvedAt: number | null; result: {summary: string[]} | null};
type ImportDb = {id: number; plan_id: string; created_at: number; via: string; source_name: string | null; shape: string; sha256: string; content: string; proposal_json: string; state: string; resolved_at: number | null; result_json: string | null};
const importRow = (p: Project, planId: string, id: number): ImportDb => {
  const r = get<ImportDb>(p.db.prepare('SELECT * FROM imports WHERE plan_id=? AND id=?'), planId, id);
  if (!r) throw new UnknownPlanError(`plan "${planId}" has no import #${id}`);
  return r;
};
const toRow = (r: ImportDb): ImportRow => ({id: r.id, planId: r.plan_id, createdAt: r.created_at, via: r.via as ImportRow['via'], sourceName: r.source_name, shape: r.shape as Shape, sha256: r.sha256, bytes: Buffer.byteLength(r.content), state: r.state as ImportRow['state'], resolvedAt: r.resolved_at, result: r.result_json ? JSON.parse(r.result_json) : null});
export const listImports = (p: Project, planId: string): ImportRow[] => all<ImportDb>(p.db.prepare('SELECT * FROM imports WHERE plan_id=? ORDER BY id DESC'), planId).map(toRow);
export function getImport(p: Project, planId: string, id: number): ImportRow & {content: string; proposal: Proposal} {
  const r = importRow(p, planId, id);
  return {...toRow(r), content: r.content, proposal: JSON.parse(r.proposal_json) as Proposal};
}

/** Read what was pasted. Only a valid result is stored; an invalid one changes nothing and leaves no record. */
export function submitImport(p: Project, planId: string, input: {text: string; via: 'paste' | 'file'; sourceName?: string}): {ok: true; import: ReturnType<typeof getImport>} | {ok: false; shape: Shape | null; errors: {path: string; message: string}[]} {
  const stored = getPlan(p, planId);
  const hasEpisode = listEpisodes(p).includes(planId);
  const parsed: ParseResult = parseInput(input.text, {existingSourceIds: stored.plan.sources.map((s) => s.id), existingScriptSegments: hasEpisode ? getEpisode(p, planId).narration.segments.length : null});
  if (!parsed.ok) return parsed;
  const sha = createHash('sha256').update(input.text, 'utf8').digest('hex');
  const id = Number(p.db.prepare('INSERT INTO imports(plan_id,created_at,via,source_name,shape,sha256,content,proposal_json,state) VALUES(?,?,?,?,?,?,?,?,?)').run(planId, p.now(), input.via, input.sourceName?.slice(0, 200) ?? null, parsed.proposal.shape, sha, input.text, JSON.stringify(parsed.proposal), 'proposed').lastInsertRowid);
  return {ok: true, import: getImport(p, planId, id)};
}

export function rejectImport(p: Project, planId: string, id: number): void {
  p.tx('reject-import', () => {
    const r = importRow(p, planId, id);
    if (r.state !== 'proposed') throw new ImportStateError(`import #${id} was already ${r.state}`);
    p.db.prepare("UPDATE imports SET state='rejected', resolved_at=?, result_json=? WHERE id=?").run(p.now(), JSON.stringify({summary: ['Not accepted. Nothing was changed.']}), id);
  });
}

export type AcceptResult = {planSeq: number; episodeSeq: number | null; summary: string[]; episodeCreated: boolean; projection: string | null};
export function acceptImport(p: Project, planId: string, id: number, o: {selection: Selection; basePlanSeq: number; baseEpisodeSeq: number | null}): AcceptResult {
  let touched: string | null = null;
  const res = p.tx('accept-import', () => {
    const cur = row(p, planId);
    if (cur.seq !== o.basePlanSeq) throw new PlanConflictError(`plan "${planId}" changed since seq ${o.basePlanSeq} (now ${cur.seq})`);
    const imp = importRow(p, planId, id);
    if (imp.state !== 'proposed') throw new ImportStateError(`import #${id} was already ${imp.state}`);
    const has = listEpisodes(p).includes(planId);
    let episode: {doc: EpisodeV2; seq: number} | null = null;
    if (has) {
      const info = getEpisodeInfo(p, planId);
      if (o.baseEpisodeSeq !== info.seq) throw new ConflictError(`episode "${planId}" changed since seq ${String(o.baseEpisodeSeq)} (now ${info.seq})`);
      episode = {doc: getEpisode(p, planId), seq: info.seq};
    }
    const plan = JSON.parse(cur.doc_json) as PlanDoc;
    const out = applyImport({plan, episode, proposal: JSON.parse(imp.proposal_json) as Proposal, selection: o.selection, meta: {importId: id, sha256: imp.sha256, at: p.now(), source: imp.source_name ?? (imp.via === 'file' ? 'file' : 'pasted text')}});
    const nextPlan = validated(out.plan);
    const hash = hashJson(nextPlan);
    let planSeq = cur.seq;
    if (hash !== cur.doc_hash) {
      planSeq = cur.seq + 1;
      p.db.prepare('UPDATE plans SET doc_json=?, doc_hash=?, seq=?, updated_at=? WHERE id=?').run(JSON.stringify(nextPlan), hash, planSeq, p.now(), planId);
      writeRevision(p, nextPlan, hash, 'import', out.label);
    }
    let episodeSeq: number | null = episode?.seq ?? null;
    if (out.episode.mode === 'create') {
      const c = createEpisode(p, out.episode.doc, {label: out.label, skipProjection: true});
      episodeSeq = c.seq;
      touched = planId;
      if (nextPlan.brand === 'pip-explains') applyBrandDefaults(p, planId); // the quiet opening chime, once, for this episode only
    } else if (out.episode.mode === 'replace') {
      const s = saveEpisode(p, planId, out.episode.doc, {baseSeq: episode!.seq, kind: 'script-import', label: out.label, skipProjection: true});
      episodeSeq = s.seq;
      if (s.changed) touched = planId;
    }
    p.db.prepare("UPDATE imports SET state='accepted', resolved_at=?, result_json=? WHERE id=?").run(p.now(), JSON.stringify({summary: out.summary, planSeq, episodeSeq}), id);
    return {planSeq, episodeSeq, summary: out.summary, episodeCreated: out.episode.mode === 'create'};
  });
  let projection: string | null = null;
  if (touched) { try { projection = writeProjection(p, touched); } catch { projection = 'error'; } }
  return {...res, projection};
}

/** For the rebuild plan: why this episode cannot be produced yet, according to its planning document. Empty for episodes without one. */
export function planningBlockers(p: Project, episodeId: string): {message: string}[] {
  if (!planExists(p, episodeId)) return [];
  return productionBlockers(getPlan(p, episodeId).plan, getEpisode(p, episodeId));
}

/** What applying the storyboard would do to this episode right now. Nothing is written. */
export function previewApplication(p: Project, planId: string): {application: Application; planSeq: number; episodeSeq: number} {
  const stored = getPlan(p, planId);
  if (!listEpisodes(p).includes(planId)) throw new ApplyError('This draft has no script yet, so there is no episode to put scenes into.', ['Accept a script first.']);
  return {application: planApplication(stored.plan, getEpisode(p, planId)), planSeq: stored.seq, episodeSeq: getEpisodeInfo(p, planId).seq};
}

export type ApplyResult = {planSeq: number; episodeSeq: number; revision: number | null; scenes: number; projection: string | null};
/**
 * Put a complete, valid storyboard into the episode as its scenes: one transaction that saves the episode through the normal
 * path (so it is a revision, with the sequence check) and notes the application in the plan's history. Narration is untouched.
 */
export function applyStoryboard(p: Project, planId: string, o: {basePlanSeq: number; baseEpisodeSeq: number; confirmReplace: boolean}): ApplyResult {
  const res = p.tx('apply-storyboard', () => {
    const cur = row(p, planId);
    if (cur.seq !== o.basePlanSeq) throw new PlanConflictError(`plan "${planId}" changed since seq ${o.basePlanSeq} (now ${cur.seq})`);
    if (!listEpisodes(p).includes(planId)) throw new ApplyError('This draft has no script yet, so there is no episode to put scenes into.', ['Accept a script first.']);
    const info = getEpisodeInfo(p, planId);
    if (info.seq !== o.baseEpisodeSeq) throw new ConflictError(`episode "${planId}" changed since seq ${o.baseEpisodeSeq} (now ${info.seq})`);
    const plan = JSON.parse(cur.doc_json) as PlanDoc;
    const doc = getEpisode(p, planId);
    const app = planApplication(plan, doc);
    if (!app.scenes) throw new ApplyError(`The storyboard cannot be applied yet: ${app.problems.length} problem${app.problems.length === 1 ? '' : 's'}.`, app.problems);
    if (app.replaces && !o.confirmReplace) throw new ApplyError(`This needs your confirmation first: ${app.confirm.join(' ')}`, app.confirm);
    // the scene work being replaced is kept as a revision of its own, even if it was never checkpointed
    if (app.replaces) createRevision(p, planId, {kind: 'scenes-before', label: 'Before the storyboard was applied', reuseByDoc: true});
    const saved = saveEpisode(p, planId, {...doc, scenes: app.scenes}, {baseSeq: o.baseEpisodeSeq, kind: 'scenes-apply', label: `Scenes applied from the storyboard (${app.scenes.length} scene${app.scenes.length === 1 ? '' : 's'})`, skipProjection: true});
    const next = validated({...plan, applied: {at: p.now(), episodeSeq: saved.seq, sceneIds: app.scenes.map((s) => s.id)}});
    const hash = hashJson(next);
    const planSeq = cur.seq + 1;
    p.db.prepare('UPDATE plans SET doc_json=?, doc_hash=?, seq=?, updated_at=? WHERE id=?').run(JSON.stringify(next), hash, planSeq, p.now(), planId);
    writeRevision(p, next, hash, 'apply', `scenes applied to the episode (${app.scenes.length})`);
    return {planSeq, episodeSeq: saved.seq, revision: saved.revision, scenes: app.scenes.length};
  });
  let projection: string | null = null;
  try { projection = writeProjection(p, planId); } catch { projection = 'error'; }
  return {...res, projection};
}
