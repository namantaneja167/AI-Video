// Audio layout, timing assembly and the thin wrapper around pipeline/timeline.py.
//
// The layout (where each block's take sits in the episode audio) is shared by the mix and the timeline, so the two
// cannot disagree about durations. It depends only on take durations, pacing and block gaps: not on the aligner.
import {readFileSync} from 'node:fs';
import type {EpisodeV2} from '../src/schema2.ts';

export type Layout = {leadInSec: number; blocks: {id: string; offsetSec: number; durationSec: number; gapAfterSec: number}[]; tailSec: number; totalSec: number};

const r3 = (x: number) => Math.round(x * 1000) / 1000;

/**
 * lead-in, then each take, then the block's gap (its own `gapAfterSec`, else the pacing default), and after the last
 * take the tail. A segment's `pauseAfter` inside a block is NOT applied: the take is one continuous recording.
 */
export function planLayout(doc: EpisodeV2, durations: Record<string, number>): Layout {
  let t = doc.pacing.leadInSec;
  const blocks = doc.narration.blocks.map((b, i) => {
    const d = durations[b.id];
    if (!(d > 0)) throw new Error(`no take duration for block "${b.id}"`);
    const last = i === doc.narration.blocks.length - 1;
    const gap = last ? doc.pacing.tailSec : (b.gapAfterSec ?? doc.pacing.segmentGapSec);
    const out = {id: b.id, offsetSec: r3(t), durationSec: r3(d), gapAfterSec: gap};
    t += d + gap;
    return out;
  });
  return {leadInSec: doc.pacing.leadInSec, blocks, tailSec: doc.pacing.tailSec, totalSec: r3(t)};
}

/** Duration of a PCM WAV from its header (chunk walk, so LIST chunks and the like are fine). */
export function wavDuration(path: string): {seconds: number; sampleRate: number} {
  const b = readFileSync(path);
  if (b.toString('ascii', 0, 4) !== 'RIFF' || b.toString('ascii', 8, 12) !== 'WAVE') throw new Error(`${path} is not a WAV file`);
  let o = 12, rate = 0, align = 0, bytes = -1;
  while (o + 8 <= b.length) {
    const id = b.toString('ascii', o, o + 4);
    const size = b.readUInt32LE(o + 4);
    if (id === 'fmt ') { rate = b.readUInt32LE(o + 12); align = b.readUInt16LE(o + 20); }
    if (id === 'data') { bytes = Math.min(size, b.length - o - 8); break; }
    o += 8 + size + (size % 2);
  }
  if (bytes < 0 || !rate || !align) throw new Error(`${path} has no readable audio data`);
  return {seconds: bytes / align / rate, sampleRate: rate};
}

export type WordT = {text: string; start: number; end: number};
export type SegTime = {id: string; start: number | null; end: number | null; words: WordT[]};
export type TimingSource = 'aligned' | 'estimated' | 'manual';
export type BlockTiming = {blockId: string; source: TimingSource; segments: SegTime[]};

/** Move each block's local times to episode time and collect the per-segment source labels. */
export function assembleSegTimings(layout: Layout, blocks: BlockTiming[]) {
  const segTimings: Record<string, {start: number; end: number; words: WordT[]}> = {};
  const timingSources: Record<string, TimingSource> = {};
  for (const bt of blocks) {
    const at = layout.blocks.find((b) => b.id === bt.blockId);
    if (!at) throw new Error(`block "${bt.blockId}" is not in the layout`);
    for (const s of bt.segments) {
      if (s.start === null || s.end === null || !s.words.length) throw new Error(`segment "${s.id}" has no timed words`);
      segTimings[s.id] = {start: r3(at.offsetSec + s.start), end: r3(at.offsetSec + s.end), words: s.words.map((w) => ({text: w.text, start: r3(at.offsetSec + w.start), end: r3(at.offsetSec + w.end)}))};
      timingSources[s.id] = bt.source;
    }
  }
  const kinds = new Set(Object.values(timingSources));
  const source = kinds.size === 1 && kinds.has('aligned') ? 'qwen-aligned' : kinds.size === 1 && kinds.has('estimated') ? 'qwen-estimated' : 'qwen-mixed';
  return {segTimings, timingSources, source} as const;
}

/** What pipeline/timeline.py reads from an episode: narration, scenes, events, chapters. No voice, so any engine works. */
export function timelineEpisode(doc: EpisodeV2) {
  return {
    id: doc.id,
    narration: {segments: doc.narration.segments},
    scenes: doc.scenes.map((s) => ({id: s.id, type: s.type, segments: s.segments})),
    events: doc.beats.map((b) => ({segment: b.segment, at: b.at, ...(b.cue !== undefined ? {cue: b.cue} : {}), ...(b.expression !== undefined ? {expression: b.expression} : {})})),
    chapters: doc.chapters,
  };
}

export type TimelineRequest = {episode: unknown; segTimings: unknown; source: string; variant: string; audioDuration: number; timingSources?: Record<string, TimingSource>};
/** Runs a command with stdin text and returns stdout; the job handler supplies one that registers the process as owned. */
export type RunText = (cmd: string, args: string[], stdin: string) => Promise<string>;

export async function buildTimelineViaPython(run: RunText, python: string, cli: string, req: TimelineRequest): Promise<any> {
  return JSON.parse(await run(python, [cli], JSON.stringify(req)));
}
