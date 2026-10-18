// Builds the prototype scene's `Timing` from the pipeline's timeline (segments, words, captions, cues, mouth).
import type {Timing} from '../art/pip-scene/rig';

type Word = {text: string; start: number; end: number};
type Tl = {
  durationSec: number;
  segments: {id: string; start: number; end: number; words: Word[]}[];
  captions: {segment: string; text: string; words: Word[]}[];
  mouth?: number[];
};

/** Phrase ids follow the prototype: p1..p4, p5a/p5b (a segment with several captions), p6a, p6b. */
export const phraseIds = (tl: Tl): string[] => {
  const perSeg: Record<string, number> = {};
  tl.captions.forEach((c) => (perSeg[c.segment] = (perSeg[c.segment] ?? 0) + 1));
  const seen: Record<string, number> = {};
  return tl.captions.map((c) => {
    const base = c.segment.replace(/^s/, '');
    const i = (seen[c.segment] = (seen[c.segment] ?? 0) + 1) - 1;
    return perSeg[c.segment] > 1 ? `p${base}${String.fromCharCode(97 + i)}` : `p${base}`;
  });
};

export function pipTimingFromTimeline(tl: Tl, cues: Record<string, number>, o: {fps: number; audio: string; leadSec: number; tailSec: number}): Timing {
  const ids = phraseIds(tl);
  const narrEnd = Math.max(...tl.segments.map((s) => s.end));
  return {
    fps: o.fps,
    durationSec: tl.durationSec,
    frames: Math.ceil(tl.durationSec * o.fps),
    leadSec: o.leadSec,
    narrationSeed: 0,
    narrationDurationSec: narrEnd - o.leadSec,
    audio: o.audio,
    segments: tl.segments.map((s) => ({id: s.id, text: tl.captions.filter((c) => c.segment === s.id).map((c) => c.text).join(' '), start: s.start, end: s.end})),
    phrases: tl.captions.map((c, i) => ({id: ids[i], text: c.text, start: c.words[0].start, end: c.words[c.words.length - 1].end, exact: true})),
    cues,
    mouth: tl.mouth ?? [],
  } as unknown as Timing;
}
