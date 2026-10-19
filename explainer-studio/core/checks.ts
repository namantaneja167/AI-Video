// Production checks: what can be computed about the narration, the captions, the fonts and layout, the audio mastering and the video
// file itself. Every function here is pure (it gets measurements, not files), so each check has fixtures that must fail and ones
// that must pass. A result is labelled measured (computed from the file or the data), heuristic (a warning from a rule of thumb),
// partial (only part of the content could be examined) or manual (only a person can judge; the app can only record that it happened).
//
// What these checks cannot do, said once: they cannot prove that every word was spoken (alignment gives times to the text it is
// given, so a dropped word is not detectable this way), they cannot verify the look or correctness of a custom scene, and they say
// nothing about whether the content is factually right.
import type {EpisodeV2} from '../src/schema2.ts';
import {MIN_FONT} from '../src/library/fit.ts';
import {CAPTION_BAND, LAYOUTS, SAFE, mascotBox, type Rect} from '../src/library/layouts.ts';
import type {ProbeElement, ProbeSample} from '../src/library/probeTypes.ts';
import {hashJson} from './hash.ts';
import type {AudioMeasure, MediaProbe, VideoMeasure, WavFacts} from './media.ts';
import {captionNumbers, missingSpoken, normalizeSpoken} from './numberWords.ts';

export const CHECKS_VERSION = 'checks-1';

export type CheckKind = 'measured' | 'heuristic' | 'partial' | 'manual';
/** unchecked: not examined by the app (partial coverage, or a manual item). info: a fact, not a pass. */
export type CheckStatus = 'pass' | 'warn' | 'fail' | 'unchecked' | 'info';
export type CheckSection = 'narration' | 'captions' | 'layout' | 'mastering' | 'custom';
export type CheckItem = {id: string; section: CheckSection; title: string; kind: CheckKind; status: CheckStatus; detail: string; lines?: string[]};

const mk = (section: CheckSection, id: string, title: string, kind: CheckKind, status: CheckStatus, detail: string, lines: string[] = []): CheckItem => ({id, section, title, kind, status, detail, ...(lines.length ? {lines} : {})});
/** pass when there is nothing to report, otherwise the given failure status with its lines. */
const verdict = (section: CheckSection, id: string, title: string, kind: CheckKind, lines: string[], passText: string, failText: (n: number) => string, bad: 'fail' | 'warn' = 'fail'): CheckItem =>
  lines.length ? mk(section, id, title, kind, bad, failText(lines.length), lines) : mk(section, id, title, kind, 'pass', passText);

const spokenOf = (s: EpisodeV2['narration']['segments'][number]) => s.speech ?? s.text;
const words = (s: string) => s.split(/\s+/).filter(Boolean);
const r1 = (n: number) => Math.round(n * 10) / 10;
const r2 = (n: number) => Math.round(n * 100) / 100;

// ---- narration (spec 7.1) ------------------------------------------------------------------------------------------
export const NARRATION_LIMITS = {
  /** Words per second outside this range cannot be a natural reading of the text: a take that is far too short or far too long. */
  wpsHard: [1.0, 6.0] as const,
  /** Outside this range the pace is unusual (a warning only). */
  wpsSoft: [1.8, 4.2] as const,
  longestInnerSilenceSec: 1.5,
  minSpeechRatio: 0.25,
  minQuarterSpeechRatio: 0.15,
  /** The last 10 ms still this loud: the audio was cut off, not finished. */
  endLoudDb: -20,
  leadingSilenceWarnSec: 1.0,
  segmentSecPerWord: [0.08, 2.0] as const,
};

export type TakeInput = {present: boolean; error?: string; facts?: WavFacts};
export type TimingInput = {source: string | null; durationSec: number; segments: {id: string; start: number; end: number}[]};

export function checkNarration(doc: EpisodeV2, takes: Record<string, TakeInput>, timing: TimingInput | null): CheckItem[] {
  const L = NARRATION_LIMITS;
  const seg = new Map(doc.narration.segments.map((s) => [s.id, s]));
  const blocks = doc.narration.blocks.map((b) => ({id: b.id, segs: b.segments, words: b.segments.reduce((n, id) => n + words(spokenOf(seg.get(id)!)).length, 0), take: takes[b.id]}));
  const missing: string[] = [], dur: string[] = [], pace: string[] = [], energy: string[] = [], gaps: string[] = [], ends: string[] = [], tails: string[] = [];
  for (const b of blocks) {
    const where = `block ${b.id} (segments ${b.segs.join(', ')})`;
    if (!b.take?.present) { missing.push(`${where}: no selected take with an audio file${b.take?.error ? ` (${b.take.error})` : ''}`); continue; }
    const f = b.take.facts;
    if (!f) { missing.push(`${where}: the audio cannot be read${b.take.error ? ` (${b.take.error})` : ''}`); continue; }
    const wps = f.durationSec > 0 ? b.words / f.durationSec : 0;
    if (wps < L.wpsHard[0] || wps > L.wpsHard[1]) dur.push(`${where}: ${b.words} words in ${f.durationSec} s is ${r1(wps)} words a second, outside what a reading of this text can be (${L.wpsHard[0]} to ${L.wpsHard[1]})`);
    else if (wps < L.wpsSoft[0] || wps > L.wpsSoft[1]) pace.push(`${where}: ${r1(wps)} words a second is unusual (usual: ${L.wpsSoft[0]} to ${L.wpsSoft[1]})`);
    const dead = f.quarterSpeechRatio.map((q, i) => (q < L.minQuarterSpeechRatio ? i + 1 : 0)).filter(Boolean);
    if (f.speechRatio < L.minSpeechRatio) energy.push(`${where}: speech-level sound in only ${Math.round(f.speechRatio * 100)}% of the take`);
    else if (dead.length) energy.push(`${where}: almost no speech-level sound in quarter ${dead.join(', ')} of the take (a dropout, or a stretch of silence)`);
    if (f.longestInnerSilenceSec > L.longestInnerSilenceSec) gaps.push(`${where}: a silent gap of ${f.longestInnerSilenceSec} s inside the take (limit ${L.longestInnerSilenceSec} s)`);
    if (f.endPeakDb > L.endLoudDb) ends.push(`${where}: the last 10 ms are still at ${f.endPeakDb} dBFS: the audio stops abruptly instead of finishing`);
    else if (f.trailingSilenceSec < 0.02) tails.push(`${where}: no trailing silence (the take ends within 20 ms of its last sound)`);
    if (f.leadingSilenceSec > L.leadingSilenceWarnSec) tails.push(`${where}: ${f.leadingSilenceSec} s of silence before the first word`);
  }
  const items: CheckItem[] = [
    verdict('narration', 'narration.takes', 'Every block has a selected take whose audio file exists and can be read', 'measured', missing, `${blocks.length} of ${blocks.length} blocks have a readable take`, (n) => `${n} block${n === 1 ? '' : 's'} without a usable take`),
    verdict('narration', 'narration.duration', 'Each block\'s duration is plausible for its word count', 'measured', dur, 'every block is within the plausible range of words per second', (n) => `${n} block${n === 1 ? '' : 's'} outside the plausible range`),
    verdict('narration', 'narration.pace', 'Pace of each block is in the usual range', 'heuristic', pace, 'every block is at a usual pace', (n) => `${n} block${n === 1 ? ' has' : 's have'} an unusual pace`, 'warn'),
    verdict('narration', 'narration.energy', 'Speech-level sound runs across each block', 'measured', energy, 'every block has speech-level sound throughout', (n) => `${n} block${n === 1 ? '' : 's'} with missing speech-level sound`),
    verdict('narration', 'narration.gaps', 'No silent gap inside a block is longer than the limit', 'measured', gaps, `no silent gap over ${L.longestInnerSilenceSec} s`, (n) => `${n} block${n === 1 ? '' : 's'} with a long silent gap`),
    verdict('narration', 'narration.ending', 'No block ends abruptly (the final samples are not still loud)', 'measured', ends, 'every block ends quietly', (n) => `${n} block${n === 1 ? '' : 's'} cut off`),
    verdict('narration', 'narration.edges', 'Silence at the edges of each block', 'heuristic', tails, 'edges look normal', (n) => `${n} thing${n === 1 ? '' : 's'} to listen for`, 'warn'),
  ];
  // timing plausibility (spec section 6): label the source and look for impossible times
  if (!timing) items.push(mk('narration', 'narration.alignment', 'Timing is plausible', 'measured', 'unchecked', 'There is no timing for this video to examine.'));
  else {
    const lines: string[] = [];
    let prev = 0;
    for (const s of timing.segments) {
      const w = words(spokenOf(seg.get(s.id) ?? {id: s.id, text: ''} as never)).length || 1;
      if (!(s.end > s.start)) lines.push(`segment ${s.id}: ends (${r2(s.end)} s) before it starts (${r2(s.start)} s)`);
      else if (s.start < prev - 0.01) lines.push(`segment ${s.id}: starts at ${r2(s.start)} s, before the previous segment ends (${r2(prev)} s)`);
      else if (s.end > timing.durationSec + 0.05) lines.push(`segment ${s.id}: ends at ${r2(s.end)} s, after the audio (${r2(timing.durationSec)} s)`);
      else if ((s.end - s.start) / w < L.segmentSecPerWord[0] || (s.end - s.start) / w > L.segmentSecPerWord[1]) lines.push(`segment ${s.id}: ${r2(s.end - s.start)} s for ${w} word${w === 1 ? '' : 's'} is not a plausible duration`);
      prev = Math.max(prev, s.end);
    }
    const label = timing.source ?? 'unknown';
    const it = verdict('narration', 'narration.alignment', 'Timing is plausible', 'measured', lines, `segment times are ordered, inside the audio and plausible; timing source: ${label}`, (n) => `${n} segment time${n === 1 ? '' : 's'} not plausible`);
    items.push(it);
    if (label !== 'aligned') items.push(mk('narration', 'narration.timing-source', 'Timing source', 'measured', label === 'estimated' ? 'warn' : 'info', label === 'estimated' ? 'The timing is estimated from the audio, not aligned to the words, so captions and cues may drift from the speech.' : `Timing source: ${label}.`));
  }
  items.push(
    mk('narration', 'narration.words', 'Every word was actually spoken', 'manual', 'unchecked', 'Not checked by the app. Alignment gives times to the text it is given, so it cannot show that a word was left out. Listening is required.'),
    mk('narration', 'narration.seams', 'The joins between blocks sound acceptable', 'manual', 'unchecked', 'Blocks are generated separately and can differ slightly in delivery. Whether a join is audible is a listening judgement.'),
  );
  return items;
}

// ---- captions versus spoken text (spec 7.2) ----------------------------------------------------------------------------
export type CaptionDiff = {segment: string; hash: string; captionOnly: string[]; spokenOnly: string[]; confirmed: boolean};

const SYMBOLS = /[₹$€£%&+=#@<>×÷]/;
const needsOverride = (text: string) => /\d/.test(text) || SYMBOLS.test(text);
const tokens = (s: string) => normalizeSpoken(s).trim().split(' ').filter(Boolean);

export const captionDiffHash = (text: string, spoken: string): string => hashJson({text, spoken}).slice(0, 16);

/** `isConfirmed(segment, hash)`: the author confirmed this exact caption and speech pair as intentionally different. */
export function checkCaptions(doc: EpisodeV2, isConfirmed: (segment: string, hash: string) => boolean): {items: CheckItem[]; diffs: CaptionDiff[]} {
  const phrases: string[] = [], overrides: string[] = [], numbers: string[] = [];
  const diffs: CaptionDiff[] = [];
  for (const s of doc.narration.segments) {
    if (s.captions && normalizeSpoken(s.captions.join(' ')) !== normalizeSpoken(s.text)) phrases.push(`segment ${s.id}: the caption phrases do not spell the segment text`);
    const spoken = spokenOf(s);
    if (needsOverride(s.text) && s.speech === undefined) overrides.push(`segment ${s.id}: the caption "${s.text}" has digits or symbols, but no spoken text says how to read them`);
    else if (s.speech !== undefined && needsOverride(s.speech)) overrides.push(`segment ${s.id}: the spoken text still contains digits or symbols the voice would have to guess`);
    if (s.speech !== undefined) for (const n of captionNumbers(s.text)) { const m = missingSpoken(s.speech, n); if (m) numbers.push(`segment ${s.id}: ${m}`); }
    const a = tokens(s.text), b = tokens(spoken);
    const inB = new Set(b), inA = new Set(a);
    const captionOnly = [...new Set(a.filter((w) => !inB.has(w)))], spokenOnly = [...new Set(b.filter((w) => !inA.has(w)))];
    if (captionOnly.length || spokenOnly.length) { const hash = captionDiffHash(s.text, spoken); diffs.push({segment: s.id, hash, captionOnly, spokenOnly, confirmed: isConfirmed(s.id, hash)}); }
  }
  const open = diffs.filter((d) => !d.confirmed);
  const diffLines = open.map((d) => `segment ${d.segment}: only in the caption: ${d.captionOnly.join(' ') || 'nothing'}; only in the speech: ${d.spokenOnly.join(' ') || 'nothing'}`);
  const items = [
    verdict('captions', 'captions.phrases', 'Caption phrases spell exactly the segment text', 'measured', phrases, 'every segment\'s phrases spell its text', (n) => `${n} segment${n === 1 ? '' : 's'} whose phrases differ`),
    verdict('captions', 'captions.overrides', 'A spoken text exists wherever the caption has digits or symbols', 'measured', overrides, 'every caption with digits or symbols has a spoken reading', (n) => `${n} segment${n === 1 ? '' : 's'} need a spoken reading`),
    verdict('captions', 'captions.numbers', 'Spoken numbers match the caption', 'measured', numbers, 'every number in a caption is spoken correctly', (n) => `${n} number${n === 1 ? '' : 's'} not spoken as written`),
    open.length
      ? mk('captions', 'captions.diff', 'Words that differ between caption and speech are confirmed by the author', 'measured', 'fail', `${open.length} difference${open.length === 1 ? '' : 's'} to confirm (or fix)`, diffLines)
      : mk('captions', 'captions.diff', 'Words that differ between caption and speech are confirmed by the author', 'measured', 'pass', diffs.length ? `${diffs.length} intentional difference${diffs.length === 1 ? '' : 's'}, each confirmed by the author for exactly this wording` : 'caption and speech use the same words'),
  ];
  return {items, diffs};
}

// ---- fonts, overflow, obscured content (spec 7.3) -----------------------------------------------------------------------
export type SceneProbeInfo = {id: string; type: string; /** null when the layout is not one of the known geometries. */ layoutId: string | null; captionsOn: boolean; mascotShown: boolean};
export type LayoutInput = {style: string; /** false when the episode renders through a path the probe does not reach (the legacy renderer). */ probed: boolean; samples: ProbeSample[]; scenes: SceneProbeInfo[]};

/** Scenes that are code written for one episode (spec tier 3): nothing about them is verified beyond the generic checks. */
export const TIER3_SCENES = new Set(['pip-scene-10x', 'context-window', 'pip-dense-fixture']);

const inside = (r: Rect, box: Rect) => r.x >= box.x - 0.5 && r.y >= box.y - 0.5 && r.x + r.w <= box.x + box.w + 0.5 && r.y + r.h <= box.y + box.h + 0.5;
const overlap = (a: Rect, b: Rect) => Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > 1 && Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > 1;
const VISIBLE = 0.98;

type Hit = {rule: string; where: string; frames: number[]};
const collect = (m: Map<string, Hit>, rule: string, where: string, frame: number) => {
  const k = `${rule}|${where}`;
  const h = m.get(k) ?? {rule, where, frames: []};
  h.frames.push(frame);
  m.set(k, h);
};
const hitLines = (m: Map<string, Hit>, rules: string[]): string[] => [...m.values()].filter((h) => rules.includes(h.rule)).map((h) => `${h.where} (frame${h.frames.length === 1 ? '' : 's'} ${h.frames.slice(0, 4).join(', ')}${h.frames.length > 4 ? ', ...' : ''})`);

export function analyzeLayout(i: LayoutInput): CheckItem[] {
  const out: CheckItem[] = [];
  if (!i.probed) {
    out.push(mk('layout', 'layout.coverage', 'Fonts, overflow and overlaps', 'partial', 'unchecked', 'This episode renders through the legacy path, which has no probe. Fonts, text overflow and overlaps were not examined; only the file checks apply. Look at the video yourself.'));
    return out;
  }
  const scenes = new Map(i.scenes.map((s) => [s.id, s]));
  // an element that overshoots while it enters is judged where it rests; one only ever sampled mid-entrance is listed, not judged
  const rests = new Set(i.samples.flatMap((s) => s.elements.filter((e) => !e.moving).map((e) => `${s.scene}|${e.id}`)));
  const onlyMoving = new Set(i.samples.flatMap((s) => s.elements.filter((e) => e.moving && e.kind !== 'zone' && !rests.has(`${s.scene}|${e.id}`)).map((e) => `${s.scene}: ${e.id}`)));
  const hits = new Map<string, Hit>();
  const stacks = new Map<string, {first: string; resolved: string | null}>();
  const markedScenes = new Set<string>();
  let faces: ProbeSample['faces'] = [];
  for (const s of i.samples) {
    faces = s.faces.length >= faces.length ? s.faces : faces;
    for (const f of s.fonts) stacks.set(f.stack, {first: f.first, resolved: f.resolved});
    const info = scenes.get(s.scene);
    const layout = info?.layoutId ? LAYOUTS[info.layoutId] : undefined;
    const mbox = info?.mascotShown && layout?.mascot ? mascotBox(layout.mascot) : null;
    const shown = s.elements.filter((e) => e.opacity >= VISIBLE && e.rect.w > 0 && e.rect.h > 0);
    const essential = shown.filter((e) => e.kind !== 'zone' && e.essential && !e.moving);
    if (s.elements.some((e) => e.kind !== 'zone')) markedScenes.add(s.scene);
    const label = (e: ProbeElement) => `${s.scene}: ${e.id}`;
    for (const e of shown) {
      if (e.kind === 'text' && e.clipped && (e.clipped.x || e.clipped.y)) collect(hits, 'overflow', `${label(e)} "${(e.text ?? '').slice(0, 30)}" runs past its ${e.clipped.x && e.clipped.y ? 'box' : e.clipped.x ? 'width' : 'height'}`, s.frame);
      if (e.kind === 'text' && e.fontPx !== undefined) {
        const min = e.essential ? MIN_FONT.essential : MIN_FONT.secondary;
        if (e.fontPx < min) collect(hits, 'size', `${label(e)} is drawn at ${e.fontPx} px; the minimum is ${min} px`, s.frame);
      }
      if ((e.kind === 'zone' || e.essential) && !e.moving && !inside(e.rect, SAFE)) collect(hits, 'safe', `${label(e)} reaches outside the safe area`, s.frame);
    }
    for (const e of essential) {
      if (info?.captionsOn && e.kind !== 'zone' && overlap(e.rect, CAPTION_BAND)) collect(hits, 'overlap', `${label(e)} overlaps the caption zone`, s.frame);
      if (mbox && !e.mayOverlapMascot && overlap(e.rect, mbox)) collect(hits, 'overlap', `${label(e)} overlaps Pip's box`, s.frame);
    }
    for (let a = 0; a < essential.length; a++) for (let b = a + 1; b < essential.length; b++) {
      const x = essential[a], y = essential[b];
      if (x.parent === y.id || y.parent === x.id) continue;
      if (overlap(x.rect, y.rect)) collect(hits, 'overlap', `${s.scene}: ${x.id} overlaps ${y.id}`, s.frame);
    }
  }
  const textSeen = i.samples.some((s) => s.elements.some((e) => e.kind === 'text'));
  // fonts
  const fontLines: string[] = [], fontWarn: string[] = [];
  for (const f of faces) if (f.status === 'error') fontLines.push(`the font face ${f.family} ${f.weight} failed to load`);
  for (const [stack, v] of stacks) {
    if (v.resolved === null) fontLines.push(`text set in "${stack.slice(0, 60)}" falls back to a generic font: none of its named families is available`);
    else if (v.resolved !== v.first) {
      if (i.style === 'pip-paper-bundled') fontLines.push(`the bundled font "${v.first}" is not in use: the page fell back to "${v.resolved}"`);
      else fontWarn.push(`the first choice "${v.first}" is not available; "${v.resolved}" is used instead`);
    }
  }
  if (!textSeen) out.push(mk('layout', 'layout.fonts', 'Declared fonts are loaded; no fallback font is used', 'partial', 'unchecked', 'No text element was marked in any sampled frame, so no font could be examined.'));
  else {
    out.push(verdict('layout', 'layout.fonts', 'Declared fonts are loaded; no fallback font is used', 'measured', fontLines, `${stacks.size} font list${stacks.size === 1 ? '' : 's'} examined in the same browser engine that renders the video: ${[...stacks.values()].map((v) => v.resolved ?? 'generic').join(', ')} in use${i.style === 'pip-paper-bundled' ? '' : ' (the system font stack cannot be tested as a single face)'}`, (n) => `${n} font problem${n === 1 ? '' : 's'}`));
    if (fontWarn.length) out.push(mk('layout', 'layout.fonts-stack', 'Font choice within the stack', 'heuristic', 'warn', 'A later font in the list is used.', fontWarn));
  }
  const fixedFont = i.style === 'pip-paper-bundled' ? i.scenes.filter((s) => s.type === 'pip-scene-10x') : [];
  if (fixedFont.length) out.push(mk('layout', 'layout.fonts-fixed', 'Scenes that do not use the bundled fonts', 'partial', 'unchecked', `${fixedFont.length} scene${fixedFont.length === 1 ? '' : 's'} in a bundled-font episode always draw the frozen prototype's own system font stack, so the text there depends on the fonts installed on the machine that renders it. The check above does not cover it.`, fixedFont.map((s) => `${s.id} (${s.type}): prototype system fonts`)));
  out.push(
    verdict('layout', 'layout.overflow', 'Essential text does not overflow its box', 'measured', hitLines(hits, ['overflow']), `no overflow in ${i.samples.length} sampled frame${i.samples.length === 1 ? '' : 's'} (DOM text only)`, (n) => `${n} overflow${n === 1 ? '' : 's'}`),
    verdict('layout', 'layout.overlap', 'Essential boxes stay clear of each other, the caption zone, Pip\'s box and the unsafe areas', 'measured', hitLines(hits, ['overlap', 'safe']), 'no overlap or intrusion in the sampled frames (Pip\'s box is taken from the layout geometry, not measured)', (n) => `${n} overlap${n === 1 ? '' : 's'}`),
    verdict('layout', 'layout.size', 'Smallest drawn text is at least the layout minimum', 'measured', hitLines(hits, ['size']), 'every marked text is at or above its minimum size', (n) => `${n} text${n === 1 ? '' : 's'} too small`),
  );
  if (onlyMoving.size) out.push(mk('layout', 'layout.entrance', 'Elements only seen while entering', 'partial', 'unchecked', `${onlyMoving.size} element${onlyMoving.size === 1 ? ' was' : 's were'} only in the sampled frames while still moving into place, so its position at rest was not examined (an entrance can overshoot the safe area for a moment; that is not judged).`, [...onlyMoving].slice(0, 8)));
  const unmarked = i.scenes.filter((s) => !markedScenes.has(s.id));
  out.push(unmarked.length
    ? mk('layout', 'layout.coverage', 'Every scene had marked elements to examine', 'partial', 'unchecked', `${unmarked.length} of ${i.scenes.length} scene${i.scenes.length === 1 ? '' : 's'} only partly checked: nothing in them is marked as essential text or box, so overflow, overlap and size could not be measured there.`, unmarked.map((s) => `${s.id} (${s.type}): no marked elements`))
    : mk('layout', 'layout.coverage', 'Every scene had marked elements to examine', 'measured', 'pass', `all ${i.scenes.length} scene${i.scenes.length === 1 ? ' has' : 's have'} marked elements that were measured`));
  const tier3 = i.scenes.filter((s) => TIER3_SCENES.has(s.type));
  out.push(tier3.length
    ? mk('custom', 'custom.scenes', 'Custom scenes (written for one episode) are only checked generically', 'partial', 'unchecked', `${tier3.length} scene${tier3.length === 1 ? '' : 's'} of this kind: none supplies checks of its own, so only the generic and file checks apply. The app does not claim to verify their content or look; the frames need to be looked at (a manual item at approval).`, tier3.map((s) => `${s.id} (${s.type}): generic checks only`))
    : mk('custom', 'custom.scenes', 'Custom scenes (written for one episode) are only checked generically', 'measured', 'pass', 'this video has no custom scene'));
  return out;
}

// ---- the video file and its mastering (spec 7.4) ------------------------------------------------------------------------
export const FILE_TOLERANCE = {durationSec: 0.35, audioVideoSec: 0.2, decodeSec: 0.3, frames: 3, lufs: 1.0, truePeakOver: 0.2};

export type FileInput = {
  kind: 'draft' | 'final';
  /** The hash the project recorded for this video, and the hash of the bytes now (null when the file cannot be read). */
  recordedSha256: string; actualSha256: string | null; fileError?: string;
  probe: MediaProbe | null; probeError?: string;
  audio: AudioMeasure | null; video: VideoMeasure | null;
  expected: {durationSec: number; width: number; height: number; fps: number};
  target: {lufs: number; truePeakDb: number} | null;
  /** The render's own record says its audio was mastered. */
  markedMastered: boolean | undefined;
};

export function checkFile(i: FileInput): CheckItem[] {
  const T = FILE_TOLERANCE;
  const items: CheckItem[] = [];
  const short = (h: string | null) => (h ? h.slice(0, 12) : 'none');
  items.push(i.actualSha256 === i.recordedSha256 && !i.fileError
    ? mk('mastering', 'file.hash', 'The file is the one the project recorded (SHA-256)', 'measured', 'pass', `SHA-256 ${short(i.actualSha256)}… matches the recorded hash`)
    : mk('mastering', 'file.hash', 'The file is the one the project recorded (SHA-256)', 'measured', 'fail', i.fileError ? `The file cannot be read: ${i.fileError}` : `The bytes hash to ${short(i.actualSha256)}…, but ${short(i.recordedSha256)}… was recorded: the file was changed after it was rendered.`));
  const c: string[] = [];
  if (!i.probe) c.push(i.probeError ?? 'the file cannot be read as video');
  else {
    const v = i.probe.video, a = i.probe.audio;
    if (!v) c.push('no video stream');
    else {
      if (v.codec !== 'h264') c.push(`video codec ${v.codec}, expected h264`);
      if (v.width !== i.expected.width || v.height !== i.expected.height) c.push(`video size ${v.width} x ${v.height}, expected ${i.expected.width} x ${i.expected.height}`);
      if (v.fps !== null && Math.abs(v.fps - i.expected.fps) > 0.05) c.push(`${r2(v.fps)} frames a second, expected ${i.expected.fps}`);
    }
    if (!a) c.push('no audio stream');
    else if (a.codec !== 'aac') c.push(`audio codec ${a.codec}, expected aac`);
  }
  items.push(verdict('mastering', 'file.container', 'The file is a valid video with the expected streams', 'measured', c, `h264 ${i.expected.width} x ${i.expected.height} at ${i.expected.fps} fps with an aac audio track`, (n) => `${n} problem${n === 1 ? '' : 's'} with the file's structure`));
  const d: string[] = [];
  if (i.probe) {
    const dur = i.probe.durationSec;
    if (dur === null || Math.abs(dur - i.expected.durationSec) > T.durationSec) d.push(`the file is ${dur === null ? 'of unknown length' : `${r2(dur)} s long`}, the timing says ${r2(i.expected.durationSec)} s`);
    const va = i.probe.video?.durationSec, aa = i.probe.audio?.durationSec;
    if (va != null && aa != null && Math.abs(va - aa) > T.audioVideoSec) d.push(`audio is ${r2(aa)} s and video ${r2(va)} s long`);
  }
  if (i.video) {
    const frames = Math.round(i.expected.durationSec * i.expected.fps);
    if (i.video.errors.length) d.push(`decoding the video reported: ${i.video.errors[0]}`);
    if (Math.abs(i.video.decodedFrames - frames) > T.frames) d.push(`${i.video.decodedFrames} video frames could be decoded, ${frames} were expected: the file is cut short or damaged`);
  } else if (i.probe) d.push('the video was not decoded');
  if (i.audio) {
    if (i.audio.errors.length) d.push(`decoding the audio reported: ${i.audio.errors[0]}`);
    if (Math.abs(i.audio.decodedSec - i.expected.durationSec) > T.durationSec + T.decodeSec) d.push(`${r2(i.audio.decodedSec)} s of audio could be decoded, ${r2(i.expected.durationSec)} s were expected`);
  } else if (i.probe) d.push('the audio was not decoded');
  items.push(verdict('mastering', 'file.decode', 'The file decodes completely and is as long as the timing says', 'measured', d, 'the whole video and audio decode without errors and match the timing', (n) => `${n} problem${n === 1 ? '' : 's'} when reading the file through`));
  if (i.kind === 'draft') {
    items.push(mk('mastering', 'mastering.loudness', 'Audio meets the loudness and true-peak targets', 'measured', 'info', `Not mastered. This is a draft: its audio is the unmastered mix${i.audio?.integratedLufs != null ? ` (measured ${i.audio.integratedLufs} LUFS, true peak ${i.audio.truePeakDbtp} dBTP)` : ''}. A draft cannot be approved or exported.`));
    return items;
  }
  const m: string[] = [];
  if (!i.target) m.push('no mastering targets are recorded for this video');
  else if (!i.audio || i.audio.integratedLufs === null || i.audio.truePeakDbtp === null) m.push('the loudness of the file could not be measured');
  else {
    if (Math.abs(i.audio.integratedLufs - i.target.lufs) > T.lufs) m.push(`integrated loudness is ${i.audio.integratedLufs} LUFS; the target is ${i.target.lufs} LUFS (tolerance ${T.lufs} LU)`);
    if (i.audio.truePeakDbtp > i.target.truePeakDb + T.truePeakOver) m.push(`true peak is ${i.audio.truePeakDbtp} dBTP; the limit is ${i.target.truePeakDb} dBTP (tolerance ${T.truePeakOver} dB)`);
  }
  items.push(verdict('mastering', 'mastering.loudness', 'The audio decoded from the final file meets the loudness and true-peak targets', 'measured', m, i.target && i.audio ? `${i.audio.integratedLufs} LUFS integrated (target ${i.target.lufs}) and ${i.audio.truePeakDbtp} dBTP true peak (limit ${i.target.truePeakDb}), measured on the audio inside the file` : 'measured', (n) => `${n} target${n === 1 ? '' : 's'} missed`));
  items.push(i.markedMastered === true
    ? mk('mastering', 'mastering.flag', 'The final render is recorded as mastered', 'measured', 'pass', 'its record says the mastering chain was applied')
    : mk('mastering', 'mastering.flag', 'The final render is recorded as mastered', 'measured', 'fail', 'its record does not say the mastering chain was applied'));
  return items;
}

// ---- the report ---------------------------------------------------------------------------------------------------------
export type CheckSummary = {pass: number; warn: number; fail: number; unchecked: number; info: number};
export type CheckReport = {
  version: string;
  renderArtifactId: number;
  renderKind: 'draft' | 'final';
  fileSha256: string;
  items: CheckItem[];
  summary: CheckSummary;
  /** No item failed. Warnings, partial coverage and manual items do not make it fail, and none of them is a pass either. */
  passed: boolean;
  captionDiffs: CaptionDiff[];
  sampled: {frames: number; scenes: string[]};
  limits: string[];
};

export const REPORT_LIMITS = [
  'A word the voice dropped cannot be detected by these checks: alignment gives times to the text it is given. Listening is the only way.',
  'Custom scenes (code written for one episode) get the generic and file checks only; their look and content are not verified.',
  'Playback and ticked boxes record that something was done; they do not show that anyone paid attention or that the content is correct.',
  'Heuristic warnings are rules of thumb and may be wrong in either direction.',
];

export function summarize(items: CheckItem[]): CheckSummary {
  const s: CheckSummary = {pass: 0, warn: 0, fail: 0, unchecked: 0, info: 0};
  for (const it of items) s[it.status]++;
  return s;
}

export function buildReport(o: {renderArtifactId: number; renderKind: 'draft' | 'final'; fileSha256: string; items: CheckItem[]; captionDiffs: CaptionDiff[]; sampled: {frames: number; scenes: string[]}}): CheckReport {
  const summary = summarize(o.items);
  return {version: CHECKS_VERSION, renderArtifactId: o.renderArtifactId, renderKind: o.renderKind, fileSha256: o.fileSha256, items: o.items, summary, passed: summary.fail === 0, captionDiffs: o.captionDiffs, sampled: o.sampled, limits: REPORT_LIMITS};
}
