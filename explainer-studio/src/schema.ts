// Single source of truth for the episode format. Imported by Remotion and by scripts/validate.ts
// (which the Python pipeline calls), so it must stay free of project-relative imports.
import {z} from 'zod';

export const EXPRESSIONS = ['neutral', 'thinking', 'surprised', 'happy', 'concerned', 'pointing'] as const;
export type Expression = (typeof EXPRESSIONS)[number];

const id = z.string().regex(/^[a-z0-9][a-z0-9_-]*$/, 'use lowercase letters, digits, - or _');

export const WordSchema = z.object({text: z.string(), start: z.number(), end: z.number()});

// ---------- scene parameters ----------

export const KpiMismatchParams = z.object({
  pipelineChecks: z.array(z.string()).min(1).max(5),
  dashboard: z.object({label: z.string(), value: z.string()}),
  expected: z.object({label: z.string(), value: z.string()}),
});

export const TablesLabParams = z.object({
  currency: z.string().default('₹'),
  orders: z.array(z.object({id: z.number().int(), amount: z.number()})).min(1).max(4),
  history: z
    .array(z.object({id: z.number().int(), orderId: z.number().int(), status: z.string(), at: z.string()}))
    .min(1)
    .max(12),
  inspectOrderId: z.number().int(),
  // SQL is shown on screen and executed by `studio.py verify` against these same tables.
  wrongSql: z.string(),
  fixedSql: z.string(),
});

const Tone = z.enum(['neutral', 'good', 'bad', 'code']);
export const CardsParams = z.object({
  title: z.string(),
  cards: z
    .array(
      z.object({
        heading: z.string(),
        tag: z.string().optional(),
        lines: z.array(z.object({text: z.string(), tone: Tone.default('neutral')})).min(1).max(6),
      }),
    )
    .min(1)
    .max(4),
});

export type KpiMismatchParamsT = z.infer<typeof KpiMismatchParams>;
export type TablesLabParamsT = z.infer<typeof TablesLabParams>;
export type CardsParamsT = z.infer<typeof CardsParams>;

// Cue names each scene type understands. Events with other cue names are rejected.
export const SCENE_CUES = {
  'kpi-mismatch': ['checks', 'dashboard', 'expected', 'mismatch'],
  'tables-lab': [
    'show-orders',
    'show-history',
    'grain-note',
    'join-start',
    'sum-start',
    'counts',
    'inspect-order',
    'repair-start',
    'pick-latest',
    'rejoin',
    'fixed-sum',
  ],
  cards: ['card-1', 'card-2', 'card-3', 'card-4'],
} as const;

const sceneBase = {id, segments: z.array(id).min(1)};
export const SceneSchema = z.discriminatedUnion('type', [
  z.object({...sceneBase, type: z.literal('kpi-mismatch'), params: KpiMismatchParams}),
  z.object({...sceneBase, type: z.literal('tables-lab'), params: TablesLabParams}),
  z.object({...sceneBase, type: z.literal('cards'), params: CardsParams}),
]);
export type Scene = z.infer<typeof SceneSchema>;

// ---------- episode ----------

export const SegmentSchema = z.object({
  id,
  /** Text shown in captions. */
  text: z.string().min(1),
  /** Optional text for the voice when it should differ from the caption (symbols, IDs). */
  speech: z.string().optional(),
  /** Optional caption phrases; their words must concatenate to `text`. Auto-chunked when omitted. */
  captions: z.array(z.string().min(1)).optional(),
  /** Extra silence after this segment, seconds. */
  pauseAfter: z.number().min(0).max(5).optional(),
});

export const AtSchema = z.union([
  z.literal('start'),
  z.literal('end'),
  z.object({word: z.number().int().min(0)}),
  z.object({offset: z.number().min(0)}),
]);
export type At = z.infer<typeof AtSchema>;

export const EventSchema = z
  .object({
    segment: id,
    at: AtSchema.default('start'),
    cue: z.string().optional(),
    expression: z.enum(EXPRESSIONS).optional(),
  })
  .refine((e) => e.cue !== undefined || e.expression !== undefined, 'event needs a cue or an expression');

export const EpisodeSchema = z
  .object({
    schemaVersion: z.literal(1),
    id,
    title: z.string(),
    learningObjective: z.string(),
    status: z.enum(['draft', 'approved']).default('draft'),
    voice: z.object({lang: z.string().default('a'), voice: z.string().default('af_heart'), speed: z.number().default(1)}).prefault({}),
    pacing: z
      .object({
        leadInSec: z.number().min(0).default(0.5),
        tailSec: z.number().min(0).default(1.2),
        segmentGapSec: z.number().min(0).default(0.3),
      })
      .prefault({}),
    narration: z.object({segments: z.array(SegmentSchema).min(1)}),
    chapters: z.array(z.object({label: z.string().max(14), segment: id})).default([]),
    scenes: z.array(SceneSchema).min(1),
    events: z.array(EventSchema).default([]),
    sources: z.array(z.object({title: z.string(), url: z.string().optional(), note: z.string().optional()})).default([]),
    reviewNotes: z.array(z.object({text: z.string(), resolved: z.boolean().default(false)})).default([]),
    previews: z.record(id, z.object({segments: z.array(id).min(1)})).prefault({}),
  })
  .superRefine((ep, ctx) => {
    const fail = (message: string, path: (string | number)[] = []) => ctx.addIssue({code: 'custom', message, path});
    const segIds = ep.narration.segments.map((s) => s.id);
    const segIndex = new Map(segIds.map((s, i) => [s, i]));
    if (segIndex.size !== segIds.length) fail('duplicate segment ids', ['narration', 'segments']);

    ep.narration.segments.forEach((s, i) => {
      if (!s.captions) return;
      const want = s.text.split(/\s+/).filter(Boolean).length;
      const got = s.captions.join(' ').split(/\s+/).filter(Boolean).length;
      if (want !== got) fail(`caption phrases have ${got} words but text has ${want}`, ['narration', 'segments', i, 'captions']);
      else if (s.captions.join(' ').replace(/\s+/g, ' ').trim() !== s.text.replace(/\s+/g, ' ').trim())
        fail('caption phrases must spell exactly the same words as text', ['narration', 'segments', i, 'captions']);
    });

    // Scenes must tile the narration in order, with no gaps or overlaps.
    const flat = ep.scenes.flatMap((s) => s.segments);
    if (flat.length !== segIds.length || flat.some((s, i) => s !== segIds[i]))
      fail(`scenes must list every segment exactly once, in narration order (got ${flat.join(',')})`, ['scenes']);

    const sceneOf = new Map<string, Scene>();
    ep.scenes.forEach((sc) => sc.segments.forEach((s) => sceneOf.set(s, sc)));
    if (new Set(ep.scenes.map((s) => s.id)).size !== ep.scenes.length) fail('duplicate scene ids', ['scenes']);

    ep.events.forEach((e, i) => {
      const seg = ep.narration.segments[segIndex.get(e.segment) ?? -1];
      if (!seg) return fail(`event references unknown segment "${e.segment}"`, ['events', i, 'segment']);
      if (typeof e.at === 'object' && 'word' in e.at && e.at.word >= seg.text.split(/\s+/).filter(Boolean).length)
        fail(`word ${e.at.word} is beyond the end of segment "${e.segment}"`, ['events', i, 'at']);
      const scene = sceneOf.get(e.segment);
      if (e.cue && scene && !(SCENE_CUES[scene.type] as readonly string[]).includes(e.cue))
        fail(`cue "${e.cue}" is not valid for scene type "${scene.type}" (${SCENE_CUES[scene.type].join(', ')})`, ['events', i, 'cue']);
    });

    ep.chapters.forEach((c, i) => {
      if (!segIndex.has(c.segment)) fail(`chapter references unknown segment "${c.segment}"`, ['chapters', i]);
    });

    Object.entries(ep.previews).forEach(([name, p]) => {
      const idx = p.segments.map((s) => segIndex.get(s));
      if (idx.some((i) => i === undefined)) return fail(`preview "${name}" references an unknown segment`, ['previews', name]);
      if (idx.some((v, k) => k > 0 && v !== (idx[k - 1] as number) + 1)) fail(`preview "${name}" must be consecutive segments`, ['previews', name]);
    });
  });

export type Episode = z.infer<typeof EpisodeSchema>;
export type EpisodeInput = z.input<typeof EpisodeSchema>;

// ---------- timeline (generated by the Python pipeline, consumed by Remotion) ----------

export const TimelineSchema = z.object({
  version: z.literal(1),
  episodeId: z.string(),
  variant: z.string(),
  source: z.enum(['kokoro', 'imported', 'qwen-aligned', 'qwen-estimated', 'qwen-mixed']),
  /** Per segment: how its word times were obtained. Absent for Kokoro/imported timelines. */
  timingSources: z.record(z.string(), z.enum(['aligned', 'estimated', 'manual'])).optional(),
  audio: z.string(),
  durationSec: z.number().positive(),
  segments: z.array(z.object({id, start: z.number(), end: z.number(), words: z.array(WordSchema)})),
  captions: z.array(z.object({segment: id, text: z.string(), start: z.number(), end: z.number(), words: z.array(WordSchema), /** Word ranges within this phrase to emphasise ([from, to), end exclusive). */ emphasis: z.array(z.tuple([z.number().int(), z.number().int()])).optional()})),
  events: z.array(z.object({segment: id, time: z.number(), cue: z.string().optional(), expression: z.enum(EXPRESSIONS).optional()})),
  scenes: z.array(z.object({id, type: z.string(), start: z.number(), end: z.number()})),
  chapters: z.array(z.object({label: z.string(), start: z.number()})),
  /** Named cue times per scene id, resolved from the scene's cue rules and these word times. */
  cues: z.record(z.string(), z.record(z.string(), z.number())).optional(),
  /** Mouth opening (0..1) per video frame, from the narration audio. */
  mouth: z.array(z.number()).optional(),
});
export type Timeline = z.infer<typeof TimelineSchema>;
