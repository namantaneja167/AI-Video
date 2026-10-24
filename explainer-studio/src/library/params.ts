// Scene parameter schemas for the scene library (pure zod, no React): validated when an episode is saved.
import {z} from 'zod';

export const CacheJourneyParams = z.object({}).strict();

export const Pip10xParams = z.object({}).strict();

/**
 * Tokens explainer. Every piece, id and count shown comes from a real tokenizer run (samples/ai-maxxing-01/
 * tokenizer-evidence.json); the scene never invents a split. Ids belong to the named tokenizer only.
 */
export const TokenJourneyParams = z.object({
  tokenizer: z.object({name: z.string().min(1).max(60), note: z.string().min(1).max(120)}).strict(),
  example: z.object({
    text: z.string().min(1).max(80),
    pieces: z.array(z.string().min(1)).min(2).max(16),
    ids: z.array(z.number().int().min(0)).min(2).max(16),
  }).strict(),
  comparison: z.object({
    english: z.object({text: z.string().min(1).max(60), tokens: z.number().int().min(1).max(500)}).strict(),
    hindi: z.object({text: z.string().min(1).max(60), tokens: z.number().int().min(1).max(500)}).strict(),
  }).strict(),
}).strict().superRefine((p, ctx) => {
  if (p.example.pieces.join('') !== p.example.text) ctx.addIssue({code: 'custom', path: ['example', 'pieces'], message: 'the pieces must spell the text exactly when joined'});
  if (p.example.ids.length !== p.example.pieces.length) ctx.addIssue({code: 'custom', path: ['example', 'ids'], message: 'there must be one id for each piece'});
});

/** The AI context-window explainer. The token pieces are illustrative: a real tokenizer is not run. */
export const ContextWindowParams = z
  .object({
    prompt: z.string().min(1).max(80),
    /** The prompt cut into pieces for display. Must spell the prompt exactly (checked). */
    pieces: z.array(z.string().min(1)).min(2).max(12),
    capacity: z.number().int().min(20).max(120),
    inputTokens: z.number().int().min(1),
    outputTokens: z.number().int().min(1),
    note: z.string().min(1).max(120).default('Simplified. Token pieces are illustrative, not from a real tokenizer.'),
  })
  .superRefine((p, ctx) => {
    if (p.pieces.join('') !== p.prompt) ctx.addIssue({code: 'custom', path: ['pieces'], message: 'the pieces must spell the prompt exactly when joined'});
    if (p.inputTokens + p.outputTokens > p.capacity) ctx.addIssue({code: 'custom', path: ['outputTokens'], message: 'input plus output must fit in the capacity'});
    if (p.inputTokens < p.pieces.length) ctx.addIssue({code: 'custom', path: ['inputTokens'], message: 'the input must have at least as many tokens as the prompt has pieces'});
  });

/** A dense layout fixture: many small cards, to exercise the layout fit check. */
export const DenseFixtureParams = z.object({
  title: z.string().min(1).max(60),
  columns: z.number().int().min(2).max(4),
  cards: z.array(z.object({label: z.string().min(1).max(24), value: z.string().min(1).max(16)})).min(4).max(24),
});

// ---- pip-cards: the reusable Pip scene. Content is the author's (cards of text); everything Pip does is a listed action. ----
/** Where in the scene something happens: a line of the scene (position, from 0) and optionally a spoken word in it. */
export const PipAt = z.object({
  segment: z.number().int().min(0).max(40),
  word: z.union([z.string().min(1).max(40), z.number().int().min(0).max(80)]).optional(),
  edge: z.enum(['start', 'end']).optional(),
}).strict();
export const PIP_ACTIONS = ['point', 'look', 'nod', 'hop', 'smile'] as const;
export type PipAction = (typeof PIP_ACTIONS)[number];
/** What each action needs and does, in the words the controls and the checks use. */
export const PIP_ACTION_INFO: Record<PipAction, {label: string; needsCard: boolean; help: string}> = {
  point: {label: 'Point at a card', needsCard: true, help: 'Raises his hand and points at the card; he looks at it too'},
  look: {label: 'Look at a card', needsCard: true, help: 'Turns his gaze to the card and keeps it there'},
  nod: {label: 'Nod', needsCard: false, help: 'A small nod'},
  hop: {label: 'Hop', needsCard: false, help: 'A small hop of excitement'},
  smile: {label: 'Smile', needsCard: false, help: 'A broader smile for a moment'},
};

export const PipCardsParams = z.object({
  title: z.string().min(1).max(60).optional(),
  cards: z.array(z.object({
    heading: z.string().min(1).max(36),
    body: z.string().max(110).default(''),
    /** When the card appears; absent = at the start of the scene line with the card's own position. */
    at: PipAt.optional(),
  }).strict()).min(1).max(4),
  actions: z.array(z.object({
    do: z.enum(PIP_ACTIONS),
    at: PipAt,
    /** The card pointed or looked at (position, from 0). */
    card: z.number().int().min(0).max(3).optional(),
  }).strict()).max(8).default([]),
  /** Pip breathes and sways a little while nothing else happens. */
  idle: z.boolean().default(true),
}).strict().superRefine((p, ctx) => {
  p.actions.forEach((a, i) => {
    if (PIP_ACTION_INFO[a.do].needsCard && a.card === undefined) ctx.addIssue({code: 'custom', path: ['actions', i, 'card'], message: `"${a.do}" needs the card it is aimed at`});
    if (a.card !== undefined && a.card >= p.cards.length) ctx.addIssue({code: 'custom', path: ['actions', i, 'card'], message: `there is no card ${a.card + 1}; the scene has ${p.cards.length}`});
    if (!PIP_ACTION_INFO[a.do].needsCard && a.card !== undefined) ctx.addIssue({code: 'custom', path: ['actions', i, 'card'], message: `"${a.do}" is not aimed at a card`});
  });
});

export const PIP_SCENE_TYPES = ['pip-scene-10x', 'context-window', 'pip-dense-fixture', 'pip-cards', 'cache-journey', 'token-journey', 'rotating-ticket', 'prompt-injection', 'ticket-motion'] as const;
