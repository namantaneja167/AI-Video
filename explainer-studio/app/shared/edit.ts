// Pure edits to an episode document. Each returns a new document; the input is never changed.
import type {EpisodeV2, Note} from '../../src/schema2.ts';
import {wordsOf} from './compare.ts';

type Seg = EpisodeV2['narration']['segments'][number];
type Range = NonNullable<Seg['emphasis']>[number];

export type EditResult = {doc: EpisodeV2; /** Plain sentences about anything the edit had to drop or move. */ notes: string[]};

const withSegment = (doc: EpisodeV2, id: string, fn: (s: Seg) => Seg): EpisodeV2 => ({
  ...doc,
  narration: {...doc.narration, segments: doc.narration.segments.map((s) => (s.id === id ? fn(s) : s))},
});
const clean = (s: Seg): Seg => {
  const out = {...s};
  if (!out.emphasis?.length) delete out.emphasis;
  if (out.speech === undefined || out.speech === '') delete out.speech;
  return out;
};

/** Keeps each emphasised phrase on the words it covers: the same phrase is found again in the new words, or dropped. */
export function remapEmphasis(oldRanges: Range[], newText: string): {ranges: Range[]; dropped: string[]} {
  const words = wordsOf(newText);
  const ranges: Range[] = [];
  const dropped: string[] = [];
  let from = 0;
  for (const r of oldRanges) {
    const phrase = r.text.split(/\s+/).filter(Boolean);
    let at = -1;
    for (let i = from; i + phrase.length <= words.length; i++) {
      if (phrase.every((w, k) => words[i + k] === w)) { at = i; break; }
    }
    if (at < 0) dropped.push(r.text);
    else { ranges.push({from: at, to: at + phrase.length, text: r.text}); from = at + phrase.length; }
  }
  return {ranges, dropped};
}

export function setSegmentText(doc: EpisodeV2, id: string, text: string): EditResult {
  const notes: string[] = [];
  const next = withSegment(doc, id, (s) => {
    const {ranges, dropped} = remapEmphasis(s.emphasis ?? [], text);
    if (dropped.length) notes.push(`Emphasis on "${dropped.join('", "')}" was removed because those words are no longer in ${id}.`);
    // caption phrases that no longer spell the words would be drawn instead of them: the line breaks are chosen again from the new words
    const phrasesStillSpell = !s.captions || wordsOf(s.captions.join(' ')).join(' ') === wordsOf(text).join(' ');
    if (!phrasesStillSpell) notes.push(`The caption line breaks of ${id} were reset because its words changed; the video chooses new breaks.`);
    const {captions: _old, ...rest} = s;
    return clean({...(phrasesStillSpell ? s : rest), text, emphasis: ranges});
  });
  return {doc: next, notes};
}

export const setSpeech = (doc: EpisodeV2, id: string, speech: string): EpisodeV2 => withSegment(doc, id, (s) => clean({...s, speech}));

export const setPauseAfter = (doc: EpisodeV2, id: string, sec: number | undefined): EpisodeV2 =>
  withSegment(doc, id, (s) => {
    const n = {...s};
    if (sec === undefined) delete n.pauseAfter; else n.pauseAfter = sec;
    return n;
  });

/** Turns emphasis on or off for one displayed word. Neighbouring emphasised words form one range. */
export function toggleEmphasis(doc: EpisodeV2, id: string, wordIndex: number): EpisodeV2 {
  return withSegment(doc, id, (s) => {
    const words = wordsOf(s.text);
    if (wordIndex < 0 || wordIndex >= words.length) return s;
    const on = new Set<number>();
    for (const r of s.emphasis ?? []) for (let i = r.from; i < r.to; i++) on.add(i);
    if (on.has(wordIndex)) on.delete(wordIndex); else on.add(wordIndex);
    const ranges: Range[] = [];
    for (let i = 0; i < words.length; i++) {
      if (!on.has(i)) continue;
      let j = i;
      while (on.has(j + 1)) j++;
      ranges.push({from: i, to: j + 1, text: words.slice(i, j + 1).join(' ')});
      i = j;
    }
    return clean({...s, emphasis: ranges});
  });
}

export const emphasisSet = (s: Seg): Set<number> => {
  const on = new Set<number>();
  for (const r of s.emphasis ?? []) for (let i = r.from; i < r.to; i++) on.add(i);
  return on;
};

export type NoteDraft = {text: string; type: Note['type']; timeSec?: number; segment?: string; render?: Note['render']};

/** Adds a review note (status open) with the next free id. Returns null when there is no text. The input is never changed. */
export function addNote(doc: EpisodeV2, draft: NoteDraft): {doc: EpisodeV2; note: Note} | null {
  const text = draft.text.trim();
  if (!text) return null;
  const used = new Set(doc.reviewNotes.map((n) => n.id));
  let k = doc.reviewNotes.length + 1;
  while (used.has(`n${k}`)) k++;
  const note: Note = {
    id: `n${k}`, text, type: draft.type, status: 'open',
    ...(draft.segment ? {anchor: {segment: draft.segment}} : {}),
    ...(draft.timeSec !== undefined ? {timeSec: Math.round(draft.timeSec * 100) / 100} : {}),
    ...(draft.render ? {render: draft.render} : {}),
  };
  return {doc: {...doc, reviewNotes: [...doc.reviewNotes, note]}, note};
}
