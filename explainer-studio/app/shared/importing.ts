// What accepting an import would do, worked out before anything is written, and the documents it would write. Pure.
// The server applies the result in one transaction; the browser shows the same preview. Nothing here is fetched or run.
import type {EpisodeV2} from '../../src/schema2.ts';
import {MAX_SEGMENTS, type Proposal, type ProposedSegment} from './packet.ts';
import {nextId, type Claim, type PlanDoc, type Provenance, type SbScene, type Source} from './plan.ts';
import {PLACEHOLDER_SCENE_ID, isPlaceholderEpisode} from './storyboard.ts';

export class ImportError extends Error {}

export type Selection = {
  /** Positions in the proposal's own lists. */
  sources: number[];
  claims: number[];
  /** The rows to accept, as the author adjusted them; null leaves the script alone. */
  script: ProposedSegment[] | null;
  storyboard: boolean;
  /** The author has seen what will be replaced and agrees. */
  confirmReplace: boolean;
};
export const defaultSelection = (p: Proposal): Selection => ({sources: p.sources.map((_, i) => i), claims: p.claims.map((_, i) => i), script: p.script ? p.script.map((r) => ({...r})) : null, storyboard: !!p.storyboard, confirmReplace: false});

export type ExistingEpisode = {doc: EpisodeV2; seq: number} | null;
export type ApplyArgs = {plan: PlanDoc; episode: ExistingEpisode; proposal: Proposal; selection: Selection; meta: Provenance};

export type RowChange = 'new' | 'same' | 'changed' | 'removed';
export type Preview = {
  sources: {index: number; title: string; url: string | null; action: 'add' | 'already-recorded'; matches?: string}[];
  claims: {index: number; text: string; kind: string; lostLinks: number[]}[];
  script: {mode: 'none' | 'create' | 'replace' | 'unchanged' | 'blocked'; blocked?: string; rows: {id: string | null; before: string | null; after: string | null; change: RowChange}[]};
  storyboard: {mode: 'none' | 'new' | 'replace'; existing: number; incoming: number};
  /** Replacing something the author already has needs an explicit yes. */
  confirm: string[];
  problems: string[];
};
export type ImportResult = {
  plan: PlanDoc;
  episode: {mode: 'none' | 'create' | 'replace'; doc?: EpisodeV2};
  summary: string[];
  label: string;
};

// ---- sources ---------------------------------------------------------------------------------------------------------------
export function urlKey(u: string): string {
  try {
    const x = new URL(u);
    return `${x.hostname.toLowerCase().replace(/^www\./, '')}${x.pathname.replace(/\/+$/, '')}${x.search}`;
  } catch { return u.trim().toLowerCase(); }
}
const titleKey = (t: string) => t.toLowerCase().replace(/\s+/g, ' ').trim();
export function findSource(sources: Source[], s: {title: string; url: string | null}): Source | undefined {
  return sources.find((x) => (s.url && x.url ? urlKey(x.url) === urlKey(s.url) : !s.url && !x.url && titleKey(x.title) === titleKey(s.title)));
}

// ---- episode documents ---------------------------------------------------------------------------------------------------
const wordCount = (s: string) => s.split(/\s+/).filter(Boolean).length;

/** Consecutive segments narrated together: up to 60 words (about 20 seconds), never splitting a segment. */
export function makeBlocks(segments: {id: string; text: string; speech?: string}[]): EpisodeV2['narration']['blocks'] {
  const blocks: EpisodeV2['narration']['blocks'] = [];
  let cur: string[] = [];
  let n = 0;
  for (const s of segments) {
    const w = wordCount(s.speech ?? s.text);
    if (cur.length && n + w > 60) { blocks.push({id: `b${blocks.length + 1}`, segments: cur}); cur = []; n = 0; }
    cur.push(s.id);
    n += w;
  }
  if (cur.length) blocks.push({id: `b${blocks.length + 1}`, segments: cur});
  return blocks;
}

const placeholderScene = (plan: PlanDoc, ids: string[]): EpisodeV2['scenes'][number] => ({
  id: PLACEHOLDER_SCENE_ID, type: 'cards', segments: ids,
  layout: {template: 'legacy-stage', captionZone: 'bottom', mascot: {mode: 'hidden', position: 'bottom-left', scale: 0.55}},
  params: {title: plan.title, cards: [{heading: 'No scenes yet', lines: [{text: 'A stand-in. This episode has a script but no scenes; they are planned in the storyboard and made in a later step.', tone: 'neutral'}]}]},
});

function newEpisode(plan: PlanDoc, rows: ProposedSegment[]): EpisodeV2 {
  const segments = rows.map((r, i) => ({id: `s${i + 1}`, text: r.text.trim(), ...(r.speech ? {speech: r.speech} : {}), ...(r.pauseAfter !== undefined ? {pauseAfter: r.pauseAfter} : {})}));
  return {
    schemaVersion: 2, id: plan.id, title: plan.title, learningObjective: plan.objective, status: 'draft', style: 'pip-paper-bundled',
    voice: {engine: 'qwen3-tts', profile: 'pip-voice-v1'}, pacing: {leadInSec: 0.5, tailSec: 1.2, segmentGapSec: 0.3},
    narration: {segments, blocks: makeBlocks(segments)}, chapters: [], scenes: [placeholderScene(plan, segments.map((s) => s.id))], beats: [], sources: [], reviewNotes: [], previews: {},
  } as EpisodeV2;
}

/** Segment ids are kept by position, and a segment whose text is unchanged keeps everything the author set on it. */
function replaceScript(plan: PlanDoc, doc: EpisodeV2, rows: ProposedSegment[]): EpisodeV2 {
  const old = doc.narration.segments;
  const taken = new Set(old.map((s) => s.id));
  const segments = rows.map((r, i) => {
    const prev = old[i];
    const text = r.text.trim();
    if (prev && prev.text === text) {
      const keep = {...prev};
      if (r.speech !== undefined) keep.speech = r.speech;
      if (r.pauseAfter !== undefined) keep.pauseAfter = r.pauseAfter;
      return keep;
    }
    const id = prev ? prev.id : nextId('s', [...taken].map((x) => ({id: x})));
    taken.add(id);
    return {id, text, ...(r.speech ? {speech: r.speech} : {}), ...(r.pauseAfter !== undefined ? {pauseAfter: r.pauseAfter} : {})};
  });
  const ids = segments.map((s) => s.id);
  const gone = old.map((s) => s.id).filter((id) => !ids.includes(id));
  const sameIds = ids.length === old.length && ids.every((id, i) => id === old[i].id);
  return {
    ...doc,
    narration: {segments, blocks: sameIds ? doc.narration.blocks : makeBlocks(segments)},
    scenes: [placeholderScene(plan, ids)] as EpisodeV2['scenes'],
    reviewNotes: doc.reviewNotes.map((n) => (n.anchor && gone.includes(n.anchor.segment) ? {...n, anchor: undefined} : n)),
  };
}

// ---- the plan -------------------------------------------------------------------------------------------------------------------
export function planImport(a: ApplyArgs): {preview: Preview; result: ImportResult | null} {
  const {plan, episode, proposal, selection, meta} = a;
  const problems: string[] = [];
  const confirm: string[] = [];
  const summary: string[] = [];
  const preview: Preview = {sources: [], claims: [], script: {mode: 'none', rows: []}, storyboard: {mode: 'none', existing: plan.storyboard.length, incoming: 0}, confirm, problems};
  let next = {...plan};

  // sources
  const idOfSource = new Map<number, string>();
  const chosenSources = selection.sources.filter((i) => proposal.sources[i]);
  for (const i of chosenSources) {
    const ps = proposal.sources[i];
    const dup = findSource(next.sources, ps);
    if (dup) { idOfSource.set(i, dup.id); preview.sources.push({index: i, title: ps.title, url: ps.url, action: 'already-recorded', matches: dup.id}); continue; }
    const s: Source = {id: nextId('src', next.sources), title: ps.title, url: ps.url, publisher: ps.publisher, published: ps.published, note: ps.note, checked: null, provenance: meta};
    next = {...next, sources: [...next.sources, s]};
    idOfSource.set(i, s.id);
    preview.sources.push({index: i, title: ps.title, url: ps.url, action: 'add'});
  }
  const added = preview.sources.filter((s) => s.action === 'add').length;
  if (added) summary.push(`${added} source${added === 1 ? '' : 's'} added`);
  const dups = preview.sources.length - added;
  if (dups) summary.push(`${dups} source${dups === 1 ? ' was' : 's were'} already recorded and not added again`);

  // claims
  let claimsAdded = 0;
  for (const i of selection.claims.filter((i) => proposal.claims[i])) {
    const pc = proposal.claims[i];
    const lost: number[] = [];
    const sourceIds: string[] = [];
    for (const ref of pc.sources) {
      if (typeof ref === 'string') { if (next.sources.some((s) => s.id === ref)) sourceIds.push(ref); else problems.push(`Claim ${i + 1} refers to the source "${ref}", which is not in this episode's research.`); }
      else if (idOfSource.has(ref)) sourceIds.push(idOfSource.get(ref)!);
      else lost.push(ref);
    }
    const c: Claim = {id: nextId('c', next.claims), text: pc.text, kind: pc.kind, sourceIds: [...new Set(sourceIds)], evidence: pc.evidence, caveat: pc.caveat, provenance: meta};
    next = {...next, claims: [...next.claims, c]};
    preview.claims.push({index: i, text: pc.text, kind: pc.kind, lostLinks: lost});
    claimsAdded++;
  }
  if (claimsAdded) summary.push(`${claimsAdded} claim${claimsAdded === 1 ? '' : 's'} added`);

  // script
  let finalIds: string[] | null = episode ? episode.doc.narration.segments.map((s) => s.id) : null;
  let episodeOut: ImportResult['episode'] = {mode: 'none'};
  if (selection.script) {
    const rows = selection.script.map((r) => ({...r, text: r.text.trim()}));
    const before = episode?.doc.narration.segments ?? [];
    if (!rows.length) problems.push('The script has no segments.');
    else if (rows.some((r) => !r.text)) problems.push(`Segment ${rows.findIndex((r) => !r.text) + 1} is empty. Fill it in or remove it.`);
    else if (rows.length > MAX_SEGMENTS) problems.push(`The script has ${rows.length} segments; this version takes at most ${MAX_SEGMENTS}.`);
    else if (!episode) {
      const doc = newEpisode(next, rows);
      preview.script = {mode: 'create', rows: rows.map((r, i) => ({id: `s${i + 1}`, before: null, after: r.text, change: 'new' as const}))};
      episodeOut = {mode: 'create', doc};
      finalIds = doc.narration.segments.map((s) => s.id);
      summary.push(`Script accepted: ${rows.length} segments. The episode is created from it`);
    } else if (!isPlaceholderEpisode(episode.doc)) {
      preview.script = {mode: 'blocked', blocked: 'This episode already has scenes, beats or markers that are tied to its segments. Edit its text in the editor; importing a new script over it is not supported in this version.', rows: []};
      problems.push(preview.script.blocked!);
    } else {
      const doc = replaceScript(next, episode.doc, rows);
      const ids = doc.narration.segments.map((s) => s.id);
      const gone = before.filter((s) => !ids.includes(s.id));
      const dangling = [...doc.beats.map((b) => b.segment), ...doc.chapters.map((c) => c.segment), ...Object.values(doc.previews).flatMap((v) => v.segments)].filter((id) => gone.some((g) => g.id === id));
      const out: Preview['script']['rows'] = [];
      doc.narration.segments.forEach((s, i) => { const b = before.find((x) => x.id === s.id); out.push({id: s.id, before: b?.text ?? null, after: s.text, change: !b ? 'new' : b.text === s.text ? 'same' : 'changed'}); void i; });
      for (const g of gone) out.push({id: g.id, before: g.text, after: null, change: 'removed'});
      preview.script = {mode: out.every((r) => r.change === 'same') ? 'unchanged' : 'replace', rows: out};
      if (dangling.length) { preview.script = {...preview.script, mode: 'blocked', blocked: `Beats or markers point at ${[...new Set(dangling)].join(', ')}, which this script would remove.`}; problems.push(preview.script.blocked!); }
      else if (preview.script.mode === 'replace') {
        const changed = out.filter((r) => r.change !== 'same').length;
        confirm.push(`Replace the script: ${changed} of ${out.length} lines change (${out.filter((r) => r.change === 'changed').length} edited, ${out.filter((r) => r.change === 'new').length} new, ${out.filter((r) => r.change === 'removed').length} removed). The earlier version stays in History.`);
        finalIds = ids; // the storyboard in the same step is read against the new script
        if (selection.confirmReplace) { episodeOut = {mode: 'replace', doc}; summary.push(`Script replaced: ${changed} lines changed`); }
      } else summary.push('The script is the same as the one already accepted');
    }
  }

  // storyboard
  if (selection.storyboard && proposal.storyboard) {
    preview.storyboard = {mode: plan.storyboard.length ? 'replace' : 'new', existing: plan.storyboard.length, incoming: proposal.storyboard.length};
    if (!finalIds) problems.push('The storyboard refers to script segments, but there is no script yet. Accept a script first or in the same step.');
    else {
      const scenes: SbScene[] = [];
      let bad = false;
      proposal.storyboard.forEach((ps, i) => {
        const ids = ps.segments.map((n) => finalIds![n - 1]);
        if (ids.some((x) => x === undefined)) { problems.push(`Storyboard scene ${i + 1} refers to segment ${ps.segments[ids.findIndex((x) => x === undefined)]}, but the script has ${finalIds!.length} segments.`); bad = true; return; }
        scenes.push({id: `sb${i + 1}`, segmentIds: ids, sceneType: ps.sceneType, intention: ps.intention, mechanism: ps.mechanism, pip: ps.pip, params: ps.params ?? null, provenance: meta});
      });
      if (!bad) {
        if (plan.storyboard.length) confirm.push(`Replace the storyboard: ${plan.storyboard.length} planned scene${plan.storyboard.length === 1 ? '' : 's'} become ${scenes.length}. The earlier plan stays in the plan's history.`);
        if (!plan.storyboard.length || selection.confirmReplace) { next = {...next, storyboard: scenes}; summary.push(`Storyboard accepted: ${scenes.length} planned scene${scenes.length === 1 ? '' : 's'}`); }
      }
    }
  }
  if (selection.script && episodeOut.mode !== 'none') next = {...next, script: {provenance: meta}};

  const needs = confirm.length > 0 && !selection.confirmReplace;
  const nothing = !summary.length && !problems.length && !needs;
  if (nothing) problems.push('Nothing is selected to accept.');
  const label = `Imported from ${meta.source} (#${meta.importId}, ${meta.sha256.slice(0, 12)})`;
  return {preview, result: problems.length || needs ? null : {plan: next, episode: episodeOut, summary, label}};
}

export function applyImport(a: ApplyArgs): ImportResult {
  const {preview, result} = planImport(a);
  if (result) return result;
  if (preview.problems.length) throw new ImportError(preview.problems.join(' '));
  throw new ImportError(`This needs your confirmation first: ${preview.confirm.join(' ')}`);
}
