// Scene parameter schemas for the scene library (pure zod, no React): validated when an episode is saved.
import {z} from 'zod';

export const Pip10xParams = z.object({}).strict();

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

export const PIP_SCENE_TYPES = ['pip-scene-10x', 'context-window', 'pip-dense-fixture'] as const;
