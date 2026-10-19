// What the preview shows versus what the author has edited. Pure; used by the browser UI and by tests.
// Rule: the preview always shows the LAST BUILD (its scene, timeline and narration). Current edits are listed, never mixed in,
// except caption emphasis, which can be shown live while the caption words are the ones the build was made from.
import type {EpisodeV2} from '../../src/schema2.ts';
import {emphasisPerCaption} from '../../src/library/emphasis.ts';

type Seg = EpisodeV2['narration']['segments'][number];
export const spokenOf = (s: Seg): string => s.speech ?? s.text;
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
/** Emphasis differs when the ranges differ on unchanged words, or the emphasised phrases differ on changed words (a shifted range alone is not a change). */
const emphasisDiffers = (cur: Seg, old: Seg): boolean =>
  cur.text === old.text ? !same(cur.emphasis ?? [], old.emphasis ?? []) : !same((cur.emphasis ?? []).map((r) => r.text), (old.emphasis ?? []).map((r) => r.text));
/** The displayed words, exactly as the schema counts them for emphasis. */
export const wordsOf = (t: string): string[] => t.split(/\s+/).filter(Boolean);

export type SegmentDiff = {id: string; text: boolean; spoken: boolean; captions: boolean; emphasis: boolean; added: boolean};
export type DocDiff = {
  segments: Record<string, SegmentDiff>;
  removed: string[];
  /** The narration the audio was built from is not what the document says now. */
  narrationDiffers: boolean;
  /** Caption text or phrasing differs from what the timeline was built from. */
  captionsDiffer: boolean;
  sceneDiffers: boolean;
  any: boolean;
};

export function compareToBuild(built: EpisodeV2, current: EpisodeV2): DocDiff {
  const b = new Map(built.narration.segments.map((s) => [s.id, s]));
  const segments: Record<string, SegmentDiff> = {};
  for (const s of current.narration.segments) {
    const o = b.get(s.id);
    segments[s.id] = o
      ? {id: s.id, text: s.text !== o.text, spoken: spokenOf(s) !== spokenOf(o), captions: !same(s.captions, o.captions), emphasis: emphasisDiffers(s, o), added: false}
      : {id: s.id, text: true, spoken: true, captions: true, emphasis: false, added: true};
  }
  const removed = built.narration.segments.filter((s) => !current.narration.segments.some((c) => c.id === s.id)).map((s) => s.id);
  const order = (d: EpisodeV2) => d.narration.segments.map((s) => s.id).join(',');
  const narrationDiffers =
    removed.length > 0 || order(built) !== order(current) || Object.values(segments).some((d) => d.spoken || d.added) ||
    !same(built.voice, current.voice) || !same(built.pacing, current.pacing) || !same(built.narration.blocks, current.narration.blocks);
  const captionsDiffer = removed.length > 0 || Object.values(segments).some((d) => d.text || d.captions || d.added);
  const sceneDiffers = !same(built.scenes, current.scenes) || built.style !== current.style || !same(built.chapters, current.chapters) || !same(built.beats, current.beats);
  return {segments, removed, narrationDiffers, captionsDiffer, sceneDiffers, any: narrationDiffers || captionsDiffer || sceneDiffers || Object.values(segments).some((d) => d.emphasis)};
}

export type TimelineLike = {captions: ({segment: string; words: unknown[]; emphasis?: [number, number][]} & Record<string, unknown>)[]} & Record<string, unknown>;
export type Preview<T extends TimelineLike> = {
  episode: {id: string; style: string; scenes: EpisodeV2['scenes']};
  timeline: T;
  /** Segments whose emphasis is shown from the current edits. */
  live: string[];
  /** Segments whose emphasis edit cannot be shown yet, with the reason. */
  blocked: {id: string; reason: string}[];
};

/** The scene and timeline as built; emphasis from the current edits only where the caption words are the built ones. */
export function previewFor<T extends TimelineLike>(built: EpisodeV2, timeline: T, current: EpisodeV2): Preview<T> {
  const live: string[] = [];
  const blocked: Preview<T>['blocked'] = [];
  const cur = new Map(current.narration.segments.map((s) => [s.id, s]));
  const merged = built.narration.segments.map((o) => {
    const c = cur.get(o.id);
    if (!c || !emphasisDiffers(c, o)) return o;
    if (c.text !== o.text) { blocked.push({id: o.id, reason: 'its words changed after the build, so its emphasis is shown as built until the timing is rebuilt'}); return o; }
    const n = wordsOf(c.text).length;
    if ((c.emphasis ?? []).some((r) => !(r.from >= 0 && r.from < r.to && r.to <= n))) { blocked.push({id: o.id, reason: 'an emphasis range does not fit the words yet'}); return o; }
    live.push(o.id);
    return {...o, emphasis: c.emphasis};
  });
  const per = emphasisPerCaption(timeline.captions, merged);
  const captions = timeline.captions.map((cap, i) => {
    const {emphasis: _drop, ...rest} = cap;
    return per[i] ? {...rest, emphasis: per[i]} : rest;
  });
  return {episode: {id: built.id, style: built.style, scenes: built.scenes}, timeline: {...timeline, captions} as T, live, blocked};
}

const segList = (ids: string[]) => ids.join(', ');
/** Plain sentences for the banner above the preview. */
export function differenceLines(diff: DocDiff, preview: {live: string[]; blocked: {id: string; reason: string}[]}): string[] {
  const out: string[] = [];
  const d = Object.values(diff.segments);
  const spoken = d.filter((x) => x.spoken || x.added).map((x) => x.id);
  const capOnly = d.filter((x) => (x.text || x.captions) && !x.spoken && !x.added).map((x) => x.id);
  if (spoken.length) out.push(`Spoken text changed in ${segList(spoken)}. The audio you hear is the narration built for the earlier words.`);
  if (capOnly.length) out.push(`Caption text changed in ${segList(capOnly)}. The captions you see are the ones built earlier.`);
  if (diff.removed.length) out.push(`Segments removed since the build: ${segList(diff.removed)}.`);
  if (diff.sceneDiffers) out.push('Scene settings changed. The scene you see is the one built earlier.');
  if (preview.live.length) out.push(`Emphasis in ${segList(preview.live)} is shown live from your edits.`);
  for (const b of preview.blocked) out.push(`Emphasis in ${b.id}: ${b.reason}.`);
  return out;
}
