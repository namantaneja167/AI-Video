// Migration foundation (Phase 0): v1 -> v2, v2 -> v1 for the legacy CLI, and v2 validation.
// Pure functions. v2 validation reuses the v1 rules by checking the downgraded episode, so the shared
// rules (scene tiling, cue vocabulary, captions, previews) cannot diverge between the two formats.
import {createHash} from 'node:crypto';
import {EpisodeSchema, type Episode} from './schema.ts';
import {EpisodeSchemaV2, type EpisodeV2, type Layout} from './schema2.ts';

export const MIGRATION_TOOL = 'migrateV1ToV2@1';
/** Blocks are grouped greedily up to this many caption words; a longer segment is its own block. */
export const BLOCK_MAX_WORDS = 60;

const words = (text: string): string[] => text.split(/\s+/).filter(Boolean);
const pad = (n: number, width = 2): string => String(n).padStart(width, '0');

export const DEFAULT_LAYOUT: Layout = {
  template: 'legacy-stage',
  captionZone: 'bottom',
  mascot: {mode: 'hidden', position: 'bottom-left', scale: 0.55},
};

/** JSON with sorted keys, so equal data always hashes equally. */
export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    const o = value as Record<string, unknown>;
    return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex');

export function planBlocks(segments: {id: string; text: string}[], maxWords = BLOCK_MAX_WORDS): {id: string; segments: string[]}[] {
  const blocks: {id: string; segments: string[]}[] = [];
  let cur: string[] = [];
  let count = 0;
  const flush = () => {
    if (cur.length) blocks.push({id: `blk${pad(blocks.length + 1)}`, segments: cur});
    cur = [];
    count = 0;
  };
  for (const s of segments) {
    const n = words(s.text).length;
    if (cur.length && count + n > maxWords) flush();
    cur.push(s.id);
    count += n;
  }
  flush();
  return blocks;
}

/** Accepts raw v1 JSON (validated here) and returns a validated v2 episode. */
export function migrateV1ToV2(input: unknown): EpisodeV2 {
  const v1 = EpisodeSchema.parse(input);
  const segText = new Map(v1.narration.segments.map((s) => [s.id, s.text]));
  const v2 = {
    schemaVersion: 2 as const,
    id: v1.id,
    title: v1.title,
    learningObjective: v1.learningObjective,
    status: v1.status,
    voice: {engine: 'kokoro' as const, ...v1.voice},
    pacing: v1.pacing,
    narration: {segments: v1.narration.segments, blocks: planBlocks(v1.narration.segments)},
    chapters: v1.chapters,
    scenes: v1.scenes.map((s) => ({...s, layout: structuredClone(DEFAULT_LAYOUT)})),
    beats: v1.events.map((e, i) => {
      const anchorText = typeof e.at === 'object' && 'word' in e.at ? words(segText.get(e.segment) ?? '')[e.at.word] : undefined;
      return {
        id: `b${pad(i + 1, 3)}`,
        segment: e.segment,
        at: e.at,
        ...(anchorText !== undefined ? {anchorText} : {}),
        ...(e.cue !== undefined ? {cue: e.cue} : {}),
        ...(e.expression !== undefined ? {expression: e.expression} : {}),
      };
    }),
    sources: v1.sources,
    reviewNotes: v1.reviewNotes.map((n, i) => ({id: `note${pad(i + 1)}`, text: n.text, type: 'general' as const, status: n.resolved ? ('resolved' as const) : ('open' as const)})),
    previews: v1.previews,
    migration: {from: 1 as const, tool: MIGRATION_TOOL, sourceSha256: sha256(stableStringify(v1))},
  };
  return EpisodeSchemaV2.parse(v2);
}

export type Downgrade = {episode: Episode; warnings: string[]};
export type DowngradeOptions = {
  /** Allow a lossy conversion. Without it any loss throws. */
  acknowledgeLoss?: boolean;
  /** `production` is what the legacy render commands use: a voice that v1 cannot name is never replaced. */
  purpose?: 'export' | 'production';
};

export class LossyDowngradeError extends Error {
  warnings: string[];
  constructor(message: string, warnings: string[]) {
    super(message);
    this.name = 'LossyDowngradeError';
    this.warnings = warnings;
  }
}
export class UnsupportedVoiceConversionError extends LossyDowngradeError {
  constructor(message: string, warnings: string[]) {
    super(message, warnings);
    this.name = 'UnsupportedVoiceConversionError';
  }
}

const customBlocks = (v2: EpisodeV2): boolean =>
  stableStringify(v2.narration.blocks.map((b) => ({id: b.id, segments: b.segments}))) !== stableStringify(planBlocks(v2.narration.segments));

/** Builds the v1 JSON without validating it, so callers can choose between throwing and collecting issues. */
function buildV1(v2: EpisodeV2): {v1: {reviewNotes: {text: string; resolved: boolean}[]}; warnings: string[]; voiceLoss: string | null} {
  const warnings: string[] = [];
  let voiceLoss: string | null = null;

  let voice;
  if (v2.voice.engine === 'kokoro') {
    const {lang, voice: name, speed} = v2.voice;
    voice = {lang, voice: name, speed};
  } else {
    voiceLoss = `voice engine "${v2.voice.engine}" cannot be expressed in v1; the v1 formats can only name a Kokoro voice`;
    warnings.push(voiceLoss);
    voice = undefined;
  }
  if (customBlocks(v2)) warnings.push('custom narration blocks dropped (v1 has no blocks; they would be re-planned)');

  const customGaps = v2.narration.blocks.filter((b) => b.gapAfterSec !== undefined).length;
  if (customGaps) warnings.push(`${customGaps} block gap(s) dropped (v1 has no block gaps)`);

  v2.scenes.forEach((s) => {
    if (stableStringify(s.layout) !== stableStringify(DEFAULT_LAYOUT)) warnings.push(`scene "${s.id}": layout "${s.layout.template}" and mascot settings dropped (v1 uses the fixed legacy stage)`);
  });
  const nonLegacy = v2.reviewNotes.filter((n) => n.type !== 'general' || n.anchor || n.timeSec !== undefined || n.render || n.status === 'wont-fix').length;
  if (nonLegacy) warnings.push(`${nonLegacy} review note(s) lose type, anchor, timestamp, render or won't-fix status`);

  const v1 = {
    schemaVersion: 1,
    id: v2.id,
    title: v2.title,
    learningObjective: v2.learningObjective,
    status: v2.status,
    ...(voice ? {voice} : {}),
    pacing: v2.pacing,
    narration: {segments: v2.narration.segments},
    chapters: v2.chapters,
    scenes: v2.scenes.map(({layout: _layout, ...scene}) => scene),
    events: v2.beats.map((b) => ({
      segment: b.segment,
      at: b.at,
      ...(b.cue !== undefined ? {cue: b.cue} : {}),
      ...(b.expression !== undefined ? {expression: b.expression} : {}),
    })),
    sources: v2.sources,
    reviewNotes: v2.reviewNotes.map((n) => ({text: n.text, resolved: n.status === 'resolved'})),
    previews: v2.previews,
  };
  return {v1, warnings, voiceLoss};
}

/**
 * v2 -> v1 for the legacy commands. Anything v1 cannot express is listed in `warnings`.
 *  - lossless: returns the episode with no warnings;
 *  - lossy: throws LossyDowngradeError unless `acknowledgeLoss` is set;
 *  - a non-Kokoro voice with purpose `production`: always throws UnsupportedVoiceConversionError. A Kokoro
 *    voice is never substituted for another engine in production, acknowledged or not.
 * An acknowledged export that replaces the voice carries a visible note in the exported review notes.
 */
export function downgradeV2ToV1(input: EpisodeV2, options: DowngradeOptions = {}): Downgrade {
  const purpose = options.purpose ?? 'export';
  const ep = EpisodeSchemaV2.parse(input);
  const {v1, warnings, voiceLoss} = buildV1(ep);
  if (voiceLoss && purpose === 'production')
    throw new UnsupportedVoiceConversionError(
      `episode "${ep.id}" uses voice engine "${ep.voice.engine}", which the legacy Kokoro commands cannot run. ` +
        'Refusing to substitute a Kokoro voice: use the Qwen pipeline for this episode, or export with --accept-loss for inspection only.',
      warnings,
    );
  if (warnings.length && !options.acknowledgeLoss)
    throw new LossyDowngradeError(`converting "${ep.id}" to v1 would lose information; acknowledge it explicitly to continue:\n  - ${warnings.join('\n  - ')}`, warnings);
  if (voiceLoss) v1.reviewNotes.push({text: `LOSSY EXPORT from v2: ${voiceLoss}. Not for production.`, resolved: false});
  return {episode: EpisodeSchema.parse(v1), warnings};
}

/** The v1 form if v2 -> v1 loses nothing, otherwise null. Never throws on loss. */
export function losslessV1(input: EpisodeV2): Episode | null {
  const {v1, warnings} = buildV1(EpisodeSchemaV2.parse(input));
  return warnings.length ? null : EpisodeSchema.parse(v1);
}

export type Issue = {path: string; message: string};
export type V2Result = {ok: true; episode: EpisodeV2} | {ok: false; issues: Issue[]};

const fmt = (path: PropertyKey[]): string => path.map(String).join('.') || '(root)';

/** Structure, v2-only rules, then every v1 rule (applied to the downgraded episode; `events` is reported as `beats`). */
export function validateEpisodeV2(input: unknown): V2Result {
  const parsed = EpisodeSchemaV2.safeParse(input);
  if (!parsed.success) return {ok: false, issues: parsed.error.issues.map((i) => ({path: fmt(i.path), message: i.message}))};
  const ep = parsed.data;
  const issues: Issue[] = [];
  const add = (path: string, message: string) => issues.push({path, message});

  const segIds = ep.narration.segments.map((s) => s.id);
  const flat = ep.narration.blocks.flatMap((b) => b.segments);
  if (flat.length !== segIds.length || flat.some((s, i) => s !== segIds[i]))
    add('narration.blocks', `blocks must list every segment exactly once, in narration order (got ${flat.join(',')})`);
  const dup = (label: string, ids: string[]) => {
    if (new Set(ids).size !== ids.length) add(label, `duplicate ${label} ids`);
  };
  dup('narration.blocks', ep.narration.blocks.map((b) => b.id));
  dup('beats', ep.beats.map((b) => b.id));
  dup('reviewNotes', ep.reviewNotes.map((n) => n.id));

  ep.scenes.forEach((s, i) => {
    if (s.layout.template === 'legacy-stage' && s.layout.mascot.mode !== 'hidden')
      add(`scenes.${i}.layout.mascot.mode`, 'the legacy-stage layout has no mascot slot; choose another template or hide the mascot');
  });
  const known = new Set(segIds);
  ep.reviewNotes.forEach((n, i) => {
    if (n.anchor && !known.has(n.anchor.segment)) add(`reviewNotes.${i}.anchor.segment`, `note anchors to unknown segment "${n.anchor.segment}"`);
  });

  if (!issues.length) {
    const legacy = EpisodeSchema.safeParse(buildV1(ep).v1);
    if (!legacy.success) for (const i of legacy.error.issues) add(fmt(i.path).replace(/^events/, 'beats'), i.message);
  }
  return issues.length ? {ok: false, issues} : {ok: true, episode: ep};
}

export type AnchorStatus = {beatId: string; status: 'ok' | 'edited' | 'out-of-range' | 'unknown'};

/** For word-anchored beats: is the anchor word still the one the beat was placed on? */
export function checkAnchors(ep: EpisodeV2): AnchorStatus[] {
  const text = new Map(ep.narration.segments.map((s) => [s.id, s.text]));
  return ep.beats.map((b) => {
    if (typeof b.at !== 'object' || !('word' in b.at)) return {beatId: b.id, status: 'ok'};
    const w = words(text.get(b.segment) ?? '');
    if (b.at.word >= w.length) return {beatId: b.id, status: 'out-of-range'};
    if (b.anchorText === undefined) return {beatId: b.id, status: 'unknown'};
    return {beatId: b.id, status: w[b.at.word] === b.anchorText ? 'ok' : 'edited'};
  });
}
