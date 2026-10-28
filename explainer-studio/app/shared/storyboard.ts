// What the storyboard can honestly promise, and how an accepted storyboard becomes the episode's scenes. The scene types this
// app has are listed as plain data (kept in step with the episode schema by a test); each planned scene is checked against the
// type's own schema, its cue rules and its layout's fit check, and only a complete, valid plan can be applied.
import type {EpisodeV2} from '../../src/schema2.ts';
import {SceneSchemaV2} from '../../src/schema2.ts';
import {sceneCueSpec} from '../../src/library/dynamicCues.ts';
import {PipCardsParams} from '../../src/library/params.ts';
import {DEFAULT_PIP_LAYOUT, PIP_CARDS_LAYOUTS, pipCardsFit} from '../../src/library/scenes/pipCardsGeometry.ts';
import {spokenOf} from './compare.ts';
import type {PlanDoc, SbScene} from './plan.ts';

export const CUSTOM_SCENE = 'custom';
export const PLACEHOLDER_SCENE_ID = 'storyboard-pending';

export type Reuse = 'data-driven' | 'own-content-only' | 'test-fixture' | 'custom';
/** `pip`: drawn in Pip's warm-paper style. A type that is not cannot appear in a Pip-style episode. */
export type SceneTypeInfo = {id: string; label: string; reuse: Reuse; summary: string; look: string; pip: boolean};

export const SCENE_TYPES: SceneTypeInfo[] = [
  {id: 'pip-cards', label: 'Pip cards', reuse: 'data-driven', look: 'Pip, warm paper', pip: true, summary: 'One to four cards of your own text beside Pip, who does only the actions you list (point, look, nod, hop, smile)'},
  {id: 'cards', label: 'Cards (dark style)', reuse: 'data-driven', look: 'dark (legacy)', pip: false, summary: 'One to four cards in the dark legacy style; not available in Pip-style episodes'},
  {id: 'kpi-mismatch', label: 'Dashboard mismatch', reuse: 'data-driven', look: 'dark (legacy)', pip: false, summary: 'Pipeline checks passing while a dashboard number disagrees with the expected one (dark style)'},
  {id: 'tables-lab', label: 'Tables lab', reuse: 'data-driven', look: 'dark (legacy)', pip: false, summary: 'Small tables and a wrong and a fixed SQL query, run for real (dark style)'},
  {id: 'rotating-ticket', label: 'Rotating ticket: live code, screenshot and gate reader', reuse: 'own-content-only', look: 'Pip, warm paper', pip: true, summary: 'A live pass and its frozen screenshot checked against a reader time window; tied to the Tech Under the Hood 01 script'},
  {id: 'ticket-motion', label: 'Rotating ticket, in motion: assembly, copy, time, reader', reuse: 'own-content-only', look: 'Pip, warm paper', pip: true, summary: 'Hook-first opening; one pass assembles, a screenshot lifts off it, the live code changes, and the code data travels to a reader that compares it with its window; tied to the Tech Under the Hood 01 script'},
  {id: 'prompt-injection', label: 'Prompt injection: task versus page text', reuse: 'own-content-only', look: 'Pip, warm paper', pip: true, summary: 'A user task and planted page text competing for an agent; tied to the AI Maxxing 02 script. Optional params.treatment (interface, investigation, mechanism, and their -r2 revisions) redraws the passage s2 to s4 as a presentation proof'},
  {id: 'token-journey', label: 'Tokens: text, pieces, numbers and counts', reuse: 'own-content-only', look: 'Pip, warm paper', pip: true, summary: 'A message cut into the pieces a real tokenizer produces, their ids, and the token counts; tied to the AI Maxxing tokens script'},
  {id: 'cache-journey', label: 'Caching: miss, hit and refresh', reuse: 'own-content-only', look: 'Pip, warm paper', pip: true, summary: 'A price request, a cached copy, a hit, stale data and explicit invalidation; tied to the caching sample script'},
  {id: 'context-window', label: 'Context window explainer', reuse: 'own-content-only', look: 'Pip, warm paper', pip: true, summary: 'Built for one explainer, timed on named words in its eight narration lines'},
  {id: 'pip-scene-10x', label: 'Pip scene', reuse: 'own-content-only', look: 'Pip, warm paper', pip: true, summary: 'The preserved Pip prototype scene, timed on named words in its own script'},
  {id: 'pip-dense-fixture', label: 'Dense layout test', reuse: 'test-fixture', look: 'Pip, warm paper', pip: true, summary: 'A fixture for testing dense layouts, not a scene for an episode'},
  {id: CUSTOM_SCENE, label: 'Custom scene (to be built)', reuse: 'custom', look: 'whatever it is designed to be', pip: true, summary: 'Something no existing scene type does. A developer has to build it before it can be produced'},
];
export const sceneTypeInfo = (id: string): SceneTypeInfo | undefined => SCENE_TYPES.find((t) => t.id === id);
export const isPipStyle = (style: string | undefined): boolean => style === 'pip-paper' || style === 'pip-paper-bundled';

export type SceneKind = 'reusable' | 'own-content' | 'custom' | 'unsupported';
export const KIND_LABEL: Record<SceneKind, string> = {reusable: 'Reusable', 'own-content': 'Tied to particular content', custom: 'Needs custom implementation', unsupported: 'Unsupported'};

/**
 * Where a scene stands. Only `ready` means it can be put into the episode as it is:
 * ready = a scene type this app has (in this episode's style), parameters that pass that type's own schema, the narration its
 * cues need, and a layout its content fits;
 * incomplete = such a type, but content, cue words or fit are missing or wrong (it can become ready by supplying them);
 * custom = needs a scene that does not exist yet and has to be implemented; unsupported = not a scene type this app has.
 */
export type SceneState = 'ready' | 'incomplete' | 'custom' | 'unsupported';
export const STATE_LABEL: Record<SceneState, string> = {ready: 'Ready: type available, parameters valid', incomplete: 'Incomplete: needs content, cue words or room', custom: 'Custom: needs implementation', unsupported: 'Unsupported type'};

export type SceneCheck = {id: string; kind: SceneKind; state: SceneState; typeLabel: string; blockers: string[]; notes: string[]};
export type StoryboardCheck = {
  scenes: SceneCheck[];
  /** Narration segments no planned scene covers. */
  unassigned: string[];
  /** Segments planned into more than one scene. */
  doubled: string[];
  counts: Record<SceneState, number>;
  /** What the check found, in words. */
  summary: string;
  /** What stands in the way of producing the planned storyboard; empty only when every scene is ready and covers the narration. */
  problems: string[];
  producible: boolean;
};

type SegText = {id: string; text: string; speech?: string};
const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9]/g, '');

/** Cue words a scene needs found in the narration planned for it. Mirrors what timing would refuse later. */
export function cueProblems(type: string, segmentIds: string[], seg: Map<string, SegText>, params?: unknown): string[] {
  const spec = sceneCueSpec({type, params, segments: segmentIds});
  if (!spec) return [];
  const out: string[] = [];
  for (const [name, ref] of Object.entries(spec)) {
    if ('t' in ref) continue;
    const id = typeof ref.segment === 'number' ? segmentIds[ref.segment] : segmentIds.includes(ref.segment) ? ref.segment : undefined;
    const where = typeof ref.segment === 'number' ? `line ${ref.segment + 1} of the scene` : `segment ${ref.segment}`;
    const s = id ? seg.get(id) : undefined;
    if (!s) { out.push(`The "${name}" moment needs ${where}, which is not planned into this scene.`); continue; }
    if (typeof ref.at !== 'object') continue;
    const ws = spokenOf(s as never).split(/\s+/).filter(Boolean);
    const key = ref.at.word;
    const found = typeof key === 'number' ? key < ws.length : ws.some((w) => norm(w) === norm(key));
    if (!found) out.push(`The "${name}" moment is timed on the word "${key}" in ${where} (${s.id}), which does not contain it.`);
  }
  return [...new Set(out)];
}

type ForSchema = {id: string; sceneType: string; segmentIds: string[]; params?: Record<string, unknown> | null; layout?: unknown};

/** The scene as the episode document would hold it, or the reasons it cannot: the type's own schema decides, not this module. */
export function episodeSceneFor(sc: ForSchema): {ok: true; scene: EpisodeV2['scenes'][number]} | {ok: false; problems: string[]} {
  const pip = sceneTypeInfo(sc.sceneType)?.pip ?? false;
  const r = SceneSchemaV2.safeParse({id: sc.id, type: sc.sceneType, segments: sc.segmentIds, params: sc.params ?? undefined, ...(sc.layout ? {layout: sc.layout} : pip ? {layout: DEFAULT_PIP_LAYOUT} : {})});
  if (r.success) return {ok: true, scene: r.data};
  return {ok: false, problems: r.error.issues.map((i) => (i.path[0] === 'params' && i.path.length === 1 ? 'no parameters are recorded' : `${i.path.join('.')}: ${i.message}`))};
}

/** Everything that stands in the way of one scene, whether it comes from the plan or from the episode. */
export function checkSceneInput(sc: ForSchema, seg: Map<string, SegText>, style?: string): SceneCheck {
  const info = sceneTypeInfo(sc.sceneType);
  const blockers: string[] = [];
  const notes: string[] = [];
  const missing = sc.segmentIds.filter((id) => !seg.has(id));
  if (!sc.segmentIds.length) blockers.push('No narration is assigned to this scene.');
  if (missing.length) blockers.push(`It refers to ${missing.join(', ')}, which ${missing.length === 1 ? 'is' : 'are'} not in the script.`);
  let kind: SceneKind;
  let state: SceneState = 'incomplete';
  if (!info) {
    kind = 'unsupported'; state = 'unsupported';
    blockers.push(`"${sc.sceneType}" is not a scene type this app has. Pick one from the list, or mark the scene as custom.`);
  } else if (info.reuse === 'custom') {
    kind = 'custom'; state = 'custom';
    blockers.push('A custom scene has to be designed and built by a developer before it can be produced.');
  } else if (info.reuse === 'test-fixture') {
    kind = 'unsupported'; state = 'unsupported';
    blockers.push(`${info.label} is a test fixture, not a scene for an episode.`);
  } else if (isPipStyle(style) && !info.pip) {
    kind = 'unsupported'; state = 'unsupported';
    blockers.push(`${info.label} is drawn only in the dark legacy style; this episode uses Pip's warm-paper style. Use "Pip cards" for cards of text.`);
  } else {
    kind = info.reuse === 'own-content-only' ? 'own-content' : 'reusable';
    const made = episodeSceneFor({...sc, segmentIds: sc.segmentIds.length ? sc.segmentIds : ['x']});
    if (!made.ok) blockers.push(`Its parameters are not complete: ${made.problems.slice(0, 4).join('; ')}${made.problems.length > 4 ? `; and ${made.problems.length - 4} more` : ''}.`);
    const cp = cueProblems(info.id, sc.segmentIds.filter((id) => seg.has(id)), seg, sc.params);
    if (cp.length) blockers.push(...cp.slice(0, 5), ...(cp.length > 5 ? [`and ${cp.length - 5} more moments the narration does not match.`] : []));
    if (made.ok && made.scene.type === 'pip-cards') {
      const template = (made.scene.layout as {template?: string} | undefined)?.template;
      const parsed = PipCardsParams.parse(made.scene.params);
      const fit = pipCardsFit(parsed, template);
      if (fit.length) blockers.push(...fit.slice(0, 4).map((f) => `Layout "${template}": ${f}.`), ...(fit.length > 4 ? [`and ${fit.length - 4} more layout problems.`] : []));
      if (made.scene.layout && !(PIP_CARDS_LAYOUTS as readonly string[]).includes(template ?? '')) blockers.push(`Layout "${template}" is not one this scene is drawn in (${PIP_CARDS_LAYOUTS.join(', ')}).`);
      const zone = (made.scene.layout as {captionZone?: string} | undefined)?.captionZone;
      if (zone && zone !== 'bottom' && zone !== 'off') blockers.push(`Caption position "${zone}" is not drawn by this renderer; use "bottom" or "off".`);
    }
    if (info.reuse === 'own-content-only') notes.push('This scene was built for one specific piece of narration; it fits here only because its cues match.');
    else if (!info.pip) notes.push(`This type is drawn in the ${info.look} look.`);
    if (!blockers.length) state = 'ready';
  }
  return {id: sc.id, kind, state, typeLabel: info?.label ?? sc.sceneType, blockers, notes};
}

export function checkStoryboard(plan: PlanDoc, segments: SegText[], style?: string): StoryboardCheck {
  const seg = new Map(segments.map((s) => [s.id, s]));
  const scenes = plan.storyboard.map((sc) => checkSceneInput(sc, seg, style));
  const used = new Map<string, number>();
  for (const sc of plan.storyboard) for (const id of sc.segmentIds) used.set(id, (used.get(id) ?? 0) + 1);
  const unassigned = segments.filter((s) => !used.has(s.id)).map((s) => s.id);
  const doubled = [...used].filter(([, n]) => n > 1).map(([id]) => id);
  const counts: Record<SceneState, number> = {ready: 0, incomplete: 0, custom: 0, unsupported: 0};
  for (const s of scenes) counts[s.state]++;
  const n = scenes.length;
  const problems: string[] = [];
  let summary: string;
  if (!n) { summary = 'No scenes are planned in the storyboard yet.'; problems.push(summary); }
  else {
    summary = `${counts.ready} of ${n} planned scene${n === 1 ? ' is' : 's are'} ready` + [counts.incomplete && `${counts.incomplete} incomplete (content, cue words or room missing)`, counts.custom && `${counts.custom} custom (need implementation)`, counts.unsupported && `${counts.unsupported} of an unsupported type`].filter(Boolean).map((t) => `, ${t as string}`).join('') + '.';
    if (counts.ready < n) problems.push(summary);
  }
  if (n && unassigned.length) problems.push(`${unassigned.length} narration segment${unassigned.length === 1 ? ' is' : 's are'} in no scene (${unassigned.slice(0, 6).join(', ')}${unassigned.length > 6 ? ', ...' : ''}).`);
  if (n && doubled.length) problems.push(`${doubled.length} narration segment${doubled.length === 1 ? ' is' : 's are'} planned into more than one scene (${doubled.slice(0, 6).join(', ')}).`);
  return {scenes, unassigned, doubled, counts, summary, problems, producible: !problems.length};
}

/** The episode written when a script is accepted before any scene exists: one stand-in scene the build must never treat as real. */
export const isPlaceholderEpisode = (doc: EpisodeV2): boolean => doc.scenes.length === 1 && doc.scenes[0].id === PLACEHOLDER_SCENE_ID;

/** The scenes the episode would hold if every planned scene were applied; null while any is not ready. */
export function episodeScenesFromPlan(plan: PlanDoc, segments: SegText[], style?: string): EpisodeV2['scenes'] | null {
  if (!checkStoryboard(plan, segments, style).producible) return null;
  const out: EpisodeV2['scenes'] = [];
  for (const sc of plan.storyboard) { const r = episodeSceneFor(sc); if (!r.ok) return null; out.push(r.scene); }
  return out;
}

// ---- applying -------------------------------------------------------------------------------------------------------------
export type SceneChange = {id: string; change: 'new' | 'changed' | 'same' | 'removed'; before: string | null; after: string | null};
export type Application = {
  /** The scenes that would be written; null while anything blocks. */
  scenes: EpisodeV2['scenes'] | null;
  /** Everything that blocks, scene by scene, in the author's words. */
  problems: string[];
  changes: SceneChange[];
  /** The episode already has scene work that is not the stand-in: applying replaces it and needs an explicit yes. */
  replaces: boolean;
  confirm: string[];
};

/** One line saying what a scene is, for the preview. */
export function describeScene(s: EpisodeV2['scenes'][number]): string {
  const base = `${sceneTypeInfo(s.type)?.label ?? s.type} · lines ${s.segments.length > 1 ? `${s.segments[0]} to ${s.segments[s.segments.length - 1]}` : s.segments[0]}`;
  if (s.type !== 'pip-cards') return base;
  const p = PipCardsParams.safeParse(s.params);
  return p.success ? `${base} · ${p.data.cards.length} card${p.data.cards.length === 1 ? '' : 's'} (${p.data.cards.map((c) => `"${c.heading}"`).join(', ')}) · ${p.data.actions.length} Pip action${p.data.actions.length === 1 ? '' : 's'} · layout ${(s.layout as {template: string}).template}` : base;
}

/** What applying the storyboard would do to this episode, and why it cannot yet. Pure: nothing is written. */
export function planApplication(plan: PlanDoc, doc: EpisodeV2): Application {
  const segments = doc.narration.segments;
  const check = checkStoryboard(plan, segments, doc.style);
  const problems: string[] = [];
  if (!plan.storyboard.length) problems.push('No scenes are planned in the storyboard yet.');
  check.scenes.forEach((c, i) => { for (const b of c.blockers) problems.push(`Scene ${i + 1} (${c.typeLabel}, ${plan.storyboard[i].id}): ${b}`); });
  if (plan.storyboard.length) {
    const flat = plan.storyboard.flatMap((s) => s.segmentIds);
    const want = segments.map((s) => s.id);
    if (check.unassigned.length) problems.push(`Narration with no scene: ${check.unassigned.join(', ')}. Every line must belong to a scene.`);
    if (check.doubled.length) problems.push(`Narration in more than one scene: ${check.doubled.join(', ')}.`);
    if (!check.unassigned.length && !check.doubled.length && flat.every((id) => want.includes(id)) && flat.join(',') !== want.join(',')) problems.push(`The scenes must follow the narration in order, without gaps (the script runs ${want.join(', ')}; the scenes run ${flat.join(', ')}).`);
  }
  const built = problems.length ? null : episodeScenesFromPlan(plan, segments, doc.style);
  // the opening hook belongs to the episode's first scene: a storyboard that does not set one never takes it away
  const carried = doc.scenes[0]?.openingHook;
  const scenes = built && carried && !built[0]?.openingHook ? [{...built[0], openingHook: carried} as EpisodeV2['scenes'][number], ...built.slice(1)] : built;
  const existing = isPlaceholderEpisode(doc) ? [] : doc.scenes;
  const next = scenes ?? [];
  const changes: SceneChange[] = [
    ...next.map((s): SceneChange => { const old = existing.find((x) => x.id === s.id); return {id: s.id, change: !old ? 'new' : JSON.stringify(old) === JSON.stringify(s) ? 'same' : 'changed', before: old ? describeScene(old) : null, after: describeScene(s)}; }),
    ...existing.filter((o) => !next.some((s) => s.id === o.id)).map((o): SceneChange => ({id: o.id, change: 'removed', before: describeScene(o), after: null})),
  ];
  const differs = changes.filter((c) => c.change !== 'same');
  const replaces = existing.length > 0 && differs.length > 0;
  const confirm = replaces ? [`This episode already has ${existing.length} scene${existing.length === 1 ? '' : 's'} of its own. Applying changes ${differs.length} of them (${differs.filter((c) => c.change === 'changed').length} changed, ${differs.filter((c) => c.change === 'new').length} new, ${differs.filter((c) => c.change === 'removed').length} removed). Parameters, layout and actions you set on those scenes are replaced. The earlier version stays in History.`] : [];
  if (scenes && !differs.length) problems.push('The episode already has exactly these scenes; there is nothing to apply.');
  return {scenes: problems.length ? null : scenes, problems, changes, replaces, confirm};
}

/** Reasons a rebuild must not start, from the plan while the episode still has its stand-in scene, from its own scenes after. */
export function productionBlockers(plan: PlanDoc, doc: EpisodeV2): {message: string}[] {
  const hook = plan.brand === 'pip-explains' && isPipStyle(doc.style) && !doc.scenes[0]?.openingHook ? [{message: 'This is a Pip Explains episode and its opening hook is not set. Enter it on the Script or Scenes step (at most 48 characters): the opening, its sound and the cover come from it.'}] : [];
  if (!isPlaceholderEpisode(doc)) return [...hook, ...sceneBlockers(doc).map((message) => ({message}))];
  const check = checkStoryboard(plan, doc.narration.segments, doc.style);
  return [
    ...hook,
    {message: check.producible ? 'The planned scenes are ready but have not been applied to this episode: it still has only its stand-in scene.' : 'This episode has only a stand-in scene: its planned scenes have not been applied to it.'},
    ...check.problems.map((m) => ({message: `Storyboard: ${m}`})),
  ];
}

/** What stops the episode's own scenes from being produced: a scene that is not ready, or narration no scene covers. */
export function sceneBlockers(doc: EpisodeV2): string[] {
  const out: string[] = [];
  episodeSceneProblems(doc).forEach(({id, check}, i) => { for (const b of check.blockers) out.push(`Scene ${i + 1} (${check.typeLabel}, ${id}): ${b}`); });
  const used = new Set(doc.scenes.flatMap((s) => s.segments));
  const loose = doc.narration.segments.filter((s) => !used.has(s.id)).map((s) => s.id);
  if (loose.length) out.push(`Narration with no scene: ${loose.join(', ')}.`);
  return out;
}

/** Problems with the scenes the episode actually holds (not the plan): what the Scenes step and the preflight report. */
export function episodeSceneProblems(doc: EpisodeV2): {id: string; check: SceneCheck}[] {
  const seg = new Map(doc.narration.segments.map((s) => [s.id, s]));
  return doc.scenes.map((s) => ({id: s.id, check: checkSceneInput({id: s.id, sceneType: s.type, segmentIds: s.segments, params: s.params as Record<string, unknown>, layout: s.layout}, seg, doc.style)}));
}
