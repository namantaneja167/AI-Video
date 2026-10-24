// DRAFT episode format v2 (Phase 0 foundation). Not used by Remotion or the legacy CLI yet.
// Authoring content only: render state, takes, approvals and timing live in the project database, not here.
// Shared building blocks come from schema.ts so v1 and v2 cannot drift apart. Use .ts import suffixes
// because Node scripts and tests load this file directly.
import {z} from 'zod';
import {AtSchema, CardsParams, EXPRESSIONS, KpiMismatchParams, TablesLabParams} from './schema.ts';
import {INJECTION_TREATMENTS} from './library/scenes/injection/passage.ts';
import {ContextWindowParams, DenseFixtureParams, Pip10xParams, PipCardsParams, CacheJourneyParams, TokenJourneyParams} from './library/params.ts';

const id = z.string().regex(/^[a-z0-9][a-z0-9_-]*$/, 'use lowercase letters, digits, - or _');

export const LAYOUT_TEMPLATES = ['legacy-stage', 'split-dense', 'full-stage-peek', 'mascot-focus', 'two-up', 'stack', 'card-over-pip', 'content-led', 'dense-pip'] as const;
export const CAPTION_ZONES = ['bottom', 'lower-third', 'top', 'off'] as const;
export const MASCOT_MODES = ['docked', 'floating', 'peek', 'hidden'] as const;
export const MASCOT_POSITIONS = [
  'top-left', 'top-center', 'top-right',
  'middle-left', 'middle-center', 'middle-right',
  'bottom-left', 'bottom-center', 'bottom-right',
] as const;
export const NOTE_TYPES = ['voice', 'visual', 'copy', 'timing', 'factual', 'general'] as const;
export const NOTE_STATUSES = ['open', 'resolved', 'wont-fix'] as const;

export const MascotSchema = z.object({
  mode: z.enum(MASCOT_MODES).default('hidden'),
  position: z.enum(MASCOT_POSITIONS).default('bottom-left'),
  scale: z.number().min(0.1).max(1.5).default(0.55),
});

export const LayoutSchema = z.object({
  // `legacy-stage` is the fixed v1 geometry (theme.ts STAGE/BAND/CAPTION) with no mascot.
  template: z.enum(LAYOUT_TEMPLATES).default('legacy-stage'),
  captionZone: z.enum(CAPTION_ZONES).default('bottom'),
  mascot: MascotSchema.prefault({}),
});
export type Layout = z.infer<typeof LayoutSchema>;

const sceneBase = {id, openingUntilCue: id.optional(), openingOverlap: z.boolean().optional(), seriesLabel: z.string().trim().min(1).max(40).optional(), openingHook: z.string().trim().min(1).max(48).optional(), segments: z.array(id).min(1), layout: LayoutSchema.prefault({})};
export const SceneSchemaV2 = z.discriminatedUnion('type', [
  z.object({...sceneBase, type: z.literal('kpi-mismatch'), params: KpiMismatchParams}),
  z.object({...sceneBase, type: z.literal('tables-lab'), params: TablesLabParams}),
  z.object({...sceneBase, type: z.literal('cards'), params: CardsParams}),
  // Pip scenes (warm paper). `pip-scene-10x` is the prototype's own component, adopted unchanged.
  z.object({...sceneBase, type: z.literal('pip-scene-10x'), params: Pip10xParams.prefault({})}),
  z.object({...sceneBase, type: z.literal('cache-journey'), params: CacheJourneyParams.prefault({})}),
  z.object({...sceneBase, type: z.literal('token-journey'), params: TokenJourneyParams}),
  ...(['rotating-ticket', 'ticket-motion'] as const).map((type) => z.object({...sceneBase, type: z.literal(type), params: z.object({}).strict()})),
  // `treatment` opts the shared passage in to one of the presentation proofs; absent is the baseline scene.
  z.object({...sceneBase, type: z.literal('prompt-injection'), params: z.object({treatment: z.enum(INJECTION_TREATMENTS).optional()}).strict()}),
  z.object({...sceneBase, type: z.literal('context-window'), params: ContextWindowParams}),
  z.object({...sceneBase, type: z.literal('pip-dense-fixture'), params: DenseFixtureParams}),
  // The reusable Pip scene: cards of the author's own text, with Pip's actions listed explicitly.
  z.object({...sceneBase, type: z.literal('pip-cards'), params: PipCardsParams}),
]);

export const VoiceSchemaV2 = z.discriminatedUnion('engine', [
  z.object({engine: z.literal('kokoro'), lang: z.string().default('a'), voice: z.string().default('af_heart'), speed: z.number().default(1)}),
  // Profiles (approved reference, model snapshot, sampling policy) are project records referenced by id.
  z.object({engine: z.literal('qwen3-tts'), profile: id}),
]);

export const SegmentSchemaV2 = z.object({
  id,
  text: z.string().min(1),
  speech: z.string().optional(),
  captions: z.array(z.string().min(1)).optional(),
  pauseAfter: z.number().min(0).max(5).optional(),
  /**
   * Caption emphasis as word ranges over the displayed words of `text` (split on spaces), end exclusive. `text` repeats the
   * emphasised words so that an edit to the sentence is noticed instead of silently emphasising other words. Styling is
   * the renderer's; the spoken text is never marked up.
   */
  emphasis: z.array(z.object({from: z.number().int().min(0), to: z.number().int().min(1), text: z.string().min(1)})).optional(),
});

/** A generation unit: consecutive segments narrated in one pass. */
export const BlockSchema = z.object({
  id,
  segments: z.array(id).min(1),
  /** Explicit silence after this block, seconds. Absent = the engine's natural pause plus pacing. */
  gapAfterSec: z.number().min(0).max(10).optional(),
});

export const BeatSchema = z
  .object({
    id,
    segment: id,
    at: AtSchema.default('start'),
    /** The word the beat was anchored to when `at` is a word index; used to notice later edits. */
    anchorText: z.string().optional(),
    cue: z.string().optional(),
    expression: z.enum(EXPRESSIONS).optional(),
  })
  .refine((b) => b.cue !== undefined || b.expression !== undefined, 'beat needs a cue or an expression');

export const NOTE_EVENTS = ['created', 'edited', 'resolved', 'wont-fix', 'reopened', 'reassessed'] as const;

export const NoteSchema = z.object({
  id,
  text: z.string(),
  type: z.enum(NOTE_TYPES).default('general'),
  status: z.enum(NOTE_STATUSES).default('open'),
  anchor: z.object({segment: id, word: z.number().int().min(0).optional()}).optional(),
  timeSec: z.number().min(0).optional(),
  /** The video the note was written against: its artifact id and kind, the build it belongs to, and the file's SHA-256. */
  render: z.object({id: z.string(), kind: z.enum(['draft', 'final']), build: z.string().optional(), sha256: z.string().optional()}).optional(),
  /** The review round it was written in (a round belongs to one video). */
  round: z.number().int().min(1).optional(),
  /** What the note was written about, kept exactly as it was then, so a later edit never rewrites it. */
  context: z.object({
    segmentText: z.string(), speech: z.string().optional(), segmentHash: z.string(), sceneId: z.string().optional(), sceneHash: z.string().optional(), at: z.number(),
  }).optional(),
  /** The author looked at the note again after the content changed and said it still applies (the hashes it now stands against). */
  reassessed: z.object({at: z.number(), segmentHash: z.string(), sceneHash: z.string().optional()}).optional(),
  createdAt: z.number().optional(),
  events: z.array(z.object({at: z.number(), kind: z.enum(NOTE_EVENTS), text: z.string().optional()})).optional(),
});
export type Note = z.infer<typeof NoteSchema>;

export const EpisodeSchemaV2 = z.object({
  schemaVersion: z.literal(2),
  id,
  title: z.string(),
  learningObjective: z.string(),
  // Mirror of the v1 field. Approval is a project record; this value is not evidence of approval.
  status: z.enum(['draft', 'approved']).default('draft'),
  /**
   * Visual style of the whole episode: the dark legacy look; Pip's warm paper with the system font stack (the prototype's
   * typography, the reference for comparisons); or Pip's warm paper with the bundled, redistributable fonts. Pip styles
   * use the dark caption pill with orange emphasis.
   */
  style: z.enum(['legacy-dark', 'pip-paper', 'pip-paper-bundled']).default('legacy-dark'),
  voice: VoiceSchemaV2,
  pacing: z
    .object({
      leadInSec: z.number().min(0).default(0.5),
      tailSec: z.number().min(0).default(1.2),
      segmentGapSec: z.number().min(0).default(0.3),
    })
    .prefault({}),
  narration: z.object({segments: z.array(SegmentSchemaV2).min(1), blocks: z.array(BlockSchema).min(1)}),
  chapters: z.array(z.object({label: z.string().max(14), segment: id})).default([]),
  scenes: z.array(SceneSchemaV2).min(1),
  beats: z.array(BeatSchema).default([]),
  sources: z.array(z.object({title: z.string(), url: z.string().optional(), note: z.string().optional()})).default([]),
  reviewNotes: z.array(NoteSchema).default([]),
  previews: z.record(id, z.object({segments: z.array(id).min(1)})).prefault({}),
  migration: z.object({from: z.literal(1), tool: z.string(), sourceSha256: z.string()}).optional(),
}).superRefine((ep, ctx) => {
  ep.scenes.forEach((s, i) => {
    if (s.openingHook && (i !== 0 || ep.style === 'legacy-dark')) ctx.addIssue({code: 'custom', path: ['scenes', i, 'openingHook'], message: 'the branded opening belongs only on the first scene of a Pip-style episode'});
  });
  ep.narration.segments.forEach((seg, si) => {
    if (!seg.emphasis) return;
    const words = seg.text.split(/\s+/).filter(Boolean);
    let prevEnd = 0;
    seg.emphasis.forEach((r, ri) => {
      const path = ['narration', 'segments', si, 'emphasis', ri];
      if (r.to > words.length || r.from >= r.to) ctx.addIssue({code: 'custom', path, message: `emphasis ${r.from}-${r.to} is outside the ${words.length} words of "${seg.id}"`});
      else if (r.from < prevEnd) ctx.addIssue({code: 'custom', path, message: 'emphasis ranges must be in order and must not overlap'});
      else if (words.slice(r.from, r.to).join(' ') !== r.text) ctx.addIssue({code: 'custom', path: [...path, 'text'], message: `the emphasised words are now "${words.slice(r.from, r.to).join(' ')}", not "${r.text}"; update the range`});
      prevEnd = Math.max(prevEnd, r.to);
    });
  });
});
export type EpisodeV2 = z.infer<typeof EpisodeSchemaV2>;
