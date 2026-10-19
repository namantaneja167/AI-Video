// The planning document of an episode: brief, research (sources and claims) and the storyboard plan. It lives in the
// project database next to the episode, never inside it, so editing it cannot change anything a build depends on.
// Pure and shared by the server and the browser.
import {z} from 'zod';

export const CLAIM_KINDS = ['fact', 'assumption', 'proposed-wording'] as const;
export type ClaimKind = (typeof CLAIM_KINDS)[number];
export const CLAIM_LABEL: Record<ClaimKind, string> = {fact: 'Fact', assumption: 'Assumption', 'proposed-wording': 'Proposed wording'};
export const CLAIM_HELP: Record<ClaimKind, string> = {
  fact: 'A statement of what is true, which should rest on at least one source',
  assumption: 'Something the episode takes for granted; no source is claimed for it',
  'proposed-wording': 'A way of putting it that is offered for the script; not a claim about the world',
};

const id = z.string().regex(/^[a-z0-9][a-z0-9_-]*$/, 'use lowercase letters, digits, - or _');

/** http and https only: a saved link is a record for the author, and is never opened or fetched by the app. */
export function isHttpUrl(s: string): boolean {
  try { const u = new URL(s); return u.protocol === 'http:' || u.protocol === 'https:'; } catch { return false; }
}

export const ProvenanceSchema = z.object({importId: z.number().int(), sha256: z.string().regex(/^[a-f0-9]{64}$/), at: z.number(), source: z.string().max(300)}).strict();
export type Provenance = z.infer<typeof ProvenanceSchema>;

export const SourceSchema = z.object({
  id,
  title: z.string().min(1, 'a source needs a title').max(300),
  url: z.string().max(2000).refine(isHttpUrl, 'must be an http or https link').nullable(),
  publisher: z.string().max(200),
  /** Publication date when known: YYYY, YYYY-MM or YYYY-MM-DD. Empty when unknown. */
  published: z.string().regex(/^(\d{4}(-(0[1-9]|1[0-2])(-(0[1-9]|[12]\d|3[01]))?)?)?$/, 'use YYYY, YYYY-MM or YYYY-MM-DD, or leave it empty'),
  note: z.string().max(3000),
  /** Set only by the author, by hand. A saved link is never fetched or verified by the app. */
  checked: z.object({at: z.number(), note: z.string().max(500)}).nullable(),
  provenance: ProvenanceSchema.nullable(),
}).strict();
export type Source = z.infer<typeof SourceSchema>;

export const ClaimSchema = z.object({
  id,
  text: z.string().min(1, 'a claim needs its text').max(1500),
  kind: z.enum(CLAIM_KINDS),
  sourceIds: z.array(id).max(20),
  evidence: z.string().max(3000),
  caveat: z.string().max(3000),
  provenance: ProvenanceSchema.nullable(),
}).strict();
export type Claim = z.infer<typeof ClaimSchema>;

export const SbSceneSchema = z.object({
  id,
  segmentIds: z.array(id).max(200),
  /** A scene type id from the catalog, or "custom" for something that has to be built. */
  sceneType: z.string().min(1).max(60),
  intention: z.string().max(1500),
  mechanism: z.string().max(1500),
  pip: z.array(z.string().min(1).max(400)).max(12),
  /** The scene type's own parameters (what its cards, numbers or tables say), checked against that type's schema. Absent until someone writes them. */
  params: z.record(z.string(), z.unknown()).nullable().optional(),
  provenance: ProvenanceSchema.nullable(),
}).strict();
export type SbScene = z.infer<typeof SbSceneSchema>;

export const PlanSchema = z.object({
  schemaVersion: z.literal(1),
  id,
  title: z.string().min(1, 'the episode needs a title').max(200),
  audience: z.string().max(500),
  objective: z.string().max(1500),
  /** Approximate length the author is aiming for, in minutes. */
  durationMin: z.number().min(0.25).max(30).nullable(),
  notes: z.string().max(6000),
  sources: z.array(SourceSchema).max(200),
  claims: z.array(ClaimSchema).max(400),
  storyboard: z.array(SbSceneSchema).max(100),
  /** Where the current script came from, when it was imported. */
  script: z.object({provenance: ProvenanceSchema.nullable()}).strict(),
  /** Set when the storyboard was last applied to the episode: when, the episode's sequence number after it, and the scenes written. */
  applied: z.object({at: z.number(), episodeSeq: z.number().int(), sceneIds: z.array(id).max(100)}).strict().nullable().optional(),
}).strict();
export type PlanDoc = z.infer<typeof PlanSchema>;

export type PlanIssue = {path: string; message: string};
export function validatePlan(input: unknown): {ok: true; plan: PlanDoc} | {ok: false; issues: PlanIssue[]} {
  const r = PlanSchema.safeParse(input);
  if (r.success) return {ok: true, plan: r.data};
  return {ok: false, issues: r.error.issues.map((i) => ({path: pathOf(i.path), message: i.message}))};
}
export function pathOf(path: PropertyKey[]): string {
  let out = '';
  for (const k of path) out += typeof k === 'number' ? `[${k}]` : out ? `.${String(k)}` : String(k);
  return out || '(root)';
}

export type NewPlan = {id: string; title: string; audience?: string; objective?: string; durationMin?: number | null};
export const newPlan = (n: NewPlan): PlanDoc => ({
  schemaVersion: 1, id: n.id, title: n.title.trim(), audience: (n.audience ?? '').trim(), objective: (n.objective ?? '').trim(),
  durationMin: n.durationMin ?? null, notes: '', sources: [], claims: [], storyboard: [], script: {provenance: null},
});

export function slugify(title: string): string {
  const s = title.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48).replace(/-+$/, '');
  return s || 'episode';
}
export function uniqueId(base: string, taken: Iterable<string>): string {
  const t = new Set(taken);
  if (!t.has(base)) return base;
  for (let n = 2; ; n++) { const c = `${base.slice(0, 44)}-${n}`; if (!t.has(c)) return c; }
}
/** The next free id with a prefix: src1, src2, ... */
export function nextId(prefix: string, existing: {id: string}[]): string {
  const max = Math.max(0, ...existing.map((e) => Number(new RegExp(`^${prefix}(\\d+)$`).exec(e.id)?.[1] ?? 0)));
  return `${prefix}${max + 1}`;
}

// ---- editing (each returns a new plan) ----------------------------------------------------------------------------
export const withSource = (p: PlanDoc, s: Source): PlanDoc => ({...p, sources: p.sources.some((x) => x.id === s.id) ? p.sources.map((x) => (x.id === s.id ? s : x)) : [...p.sources, s]});
export const withoutSource = (p: PlanDoc, id_: string): PlanDoc => ({...p, sources: p.sources.filter((s) => s.id !== id_), claims: p.claims.map((c) => ({...c, sourceIds: c.sourceIds.filter((x) => x !== id_)}))});
export const withClaim = (p: PlanDoc, c: Claim): PlanDoc => ({...p, claims: p.claims.some((x) => x.id === c.id) ? p.claims.map((x) => (x.id === c.id ? c : x)) : [...p.claims, c]});
export const withoutClaim = (p: PlanDoc, id_: string): PlanDoc => ({...p, claims: p.claims.filter((c) => c.id !== id_)});
export const withScene = (p: PlanDoc, s: SbScene): PlanDoc => ({...p, storyboard: p.storyboard.some((x) => x.id === s.id) ? p.storyboard.map((x) => (x.id === s.id ? s : x)) : [...p.storyboard, s]});
export const withoutScene = (p: PlanDoc, id_: string): PlanDoc => ({...p, storyboard: p.storyboard.filter((s) => s.id !== id_)});

export const blankSource = (p: PlanDoc): Source => ({id: nextId('src', p.sources), title: '', url: null, publisher: '', published: '', note: '', checked: null, provenance: null});
export const blankClaim = (p: PlanDoc): Claim => ({id: nextId('c', p.claims), text: '', kind: 'fact', sourceIds: [], evidence: '', caveat: '', provenance: null});
export const blankScene = (p: PlanDoc): SbScene => ({id: nextId('sb', p.storyboard), segmentIds: [], sceneType: 'custom', intention: '', mechanism: '', pip: [], params: null, provenance: null});

// ---- what the author should look at -------------------------------------------------------------------------------
export type Warning = {tone: 'warn' | 'info'; text: string; claim?: string; source?: string};
export function researchWarnings(p: PlanDoc): Warning[] {
  const out: Warning[] = [];
  const ids = new Set(p.sources.map((s) => s.id));
  for (const c of p.claims) {
    const unknown = c.sourceIds.filter((s) => !ids.has(s));
    if (unknown.length) out.push({tone: 'warn', claim: c.id, text: `Claim ${c.id} points at ${unknown.join(', ')}, which is not in the source list.`});
    if (c.kind === 'fact' && c.sourceIds.length === 0) out.push({tone: 'warn', claim: c.id, text: `Claim ${c.id} is a fact with no source.`});
    if (c.kind === 'fact' && c.sourceIds.length > 0 && c.sourceIds.every((s) => p.sources.find((x) => x.id === s)?.checked == null)) out.push({tone: 'info', claim: c.id, text: `Claim ${c.id} rests only on sources you have not checked.`});
  }
  for (const s of p.sources) if (!s.url && !s.note.trim()) out.push({tone: 'info', source: s.id, text: `Source ${s.id} has neither a link nor a note saying where it is.`});
  return out;
}

export const stageStates = (p: PlanDoc, hasEpisode: boolean) => ({
  idea: !!p.objective.trim() && !!p.audience.trim(),
  research: p.sources.length + p.claims.length > 0,
  script: hasEpisode,
  storyboard: p.storyboard.length > 0,
});
