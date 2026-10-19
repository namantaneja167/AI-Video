// A composition preview for an episode that has no narration or timing yet: the real scenes drawn on a clock made up from word
// counts. It is only for looking at layout, content and the order of cues. It has no audio, its times are guesses, and it is
// never a build; the Scenes step labels it so wherever it is shown. Pure.
import type {EpisodeV2} from '../../src/schema2.ts';
import {resolveCues, type CueSegment} from '../../src/library/cues.ts';
import {sceneCueSpec} from '../../src/library/dynamicCues.ts';
import type {LibData, TlCaption} from '../../src/library/types.ts';

const WORD_SEC = (w: string) => 0.14 + 0.05 * w.length;
const CAPTION_WORDS = 6;

export type EstimatedPreview = {data: LibData; durationSec: number; problems: string[]};

export function estimatedPreview(doc: EpisodeV2): EstimatedPreview {
  const problems: string[] = [];
  let t = doc.pacing.leadInSec;
  const segments: (CueSegment & {id: string})[] = [];
  const captions: TlCaption[] = [];
  for (const seg of doc.narration.segments) {
    const words = (seg.speech ?? seg.text).split(/\s+/).filter(Boolean).map((text) => {
      const w = {text, start: Math.round(t * 1000) / 1000, end: Math.round((t + WORD_SEC(text)) * 1000) / 1000};
      t += WORD_SEC(text) + 0.03;
      return w;
    });
    segments.push({id: seg.id, start: words[0].start, end: words[words.length - 1].end, words});
    const shown = seg.text.split(/\s+/).filter(Boolean);
    for (let i = 0; i < shown.length; i += CAPTION_WORDS) {
      const chunk = shown.slice(i, i + CAPTION_WORDS);
      captions.push({segment: seg.id, text: chunk.join(' '), words: words.slice(i, i + CAPTION_WORDS).slice(0, chunk.length)});
    }
    t += doc.pacing.segmentGapSec + (seg.pauseAfter ?? 0);
  }
  const durationSec = Math.round((t + doc.pacing.tailSec) * 1000) / 1000;
  const byId = new Map(segments.map((s) => [s.id, s]));
  const cues: Record<string, Record<string, number>> = {};
  const scenes = doc.scenes.map((sc, i) => {
    const first = byId.get(sc.segments[0]);
    return {id: sc.id, type: sc.type, start: i === 0 || !first ? 0 : Math.max(0, first.start - 0.4), end: 0};
  });
  scenes.forEach((s, i) => { s.end = i + 1 < scenes.length ? scenes[i + 1].start : durationSec; });
  for (const sc of doc.scenes) {
    const spec = sceneCueSpec(sc);
    if (!spec) continue;
    try { cues[sc.id] = resolveCues(spec, sc.segments.map((id) => byId.get(id)!)); } catch (e) { problems.push(`Scene ${sc.id}: ${(e as Error).message}`); }
  }
  return {
    data: {episode: {id: doc.id, style: doc.style, scenes: doc.scenes as never}, timeline: {version: 1, durationSec, audio: '', segments, captions, scenes, cues}, previewOnly: true},
    durationSec, problems,
  };
}
