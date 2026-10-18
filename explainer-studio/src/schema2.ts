// DRAFT episode format v2 (Phase 0 foundation). Not used by Remotion or the legacy CLI yet.
// Authoring content only: render state, takes, approvals and timing live in the project database, not here.
// Shared building blocks come from schema.ts so v1 and v2 cannot drift apart. Use .ts import suffixes
// because Node scripts and tests load this file directly.
import {z} from 'zod';
import {AtSchema, CardsParams, EXPRESSIONS, KpiMismatchParams, TablesLabParams} from './schema.ts';

const id = z.string().regex(/^[a-z0-9][a-z0-9_-]*$/, 'use lowercase letters, digits, - or _');

export const LAYOUT_TEMPLATES = ['legacy-stage', 'split-dense', 'full-stage-peek', 'mascot-focus', 'two-up', 'stack'] as const;
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

const sceneBase = {id, segments: z.array(id).min(1), layout: LayoutSchema.prefault({})};
export const SceneSchemaV2 = z.discriminatedUnion('type', [
  z.object({...sceneBase, type: z.literal('kpi-mismatch'), params: KpiMismatchParams}),
  z.object({...sceneBase, type: z.literal('tables-lab'), params: TablesLabParams}),
  z.object({...sceneBase, type: z.literal('cards'), params: CardsParams}),
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

export const NoteSchema = z.object({
  id,
  text: z.string(),
  type: z.enum(NOTE_TYPES).default('general'),
  status: z.enum(NOTE_STATUSES).default('open'),
  anchor: z.object({segment: id, word: z.number().int().min(0).optional()}).optional(),
  timeSec: z.number().min(0).optional(),
  render: z.object({id: z.string(), kind: z.enum(['draft', 'final'])}).optional(),
});
export type Note = z.infer<typeof NoteSchema>;

export const EpisodeSchemaV2 = z.object({
  schemaVersion: z.literal(2),
  id,
  title: z.string(),
  learningObjective: z.string(),
  // Mirror of the v1 field. Approval is a project record; this value is not evidence of approval.
  status: z.enum(['draft', 'approved']).default('draft'),
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
});
export type EpisodeV2 = z.infer<typeof EpisodeSchemaV2>;
