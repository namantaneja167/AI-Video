// The opening hook of an episode: pure helpers shared by the page and the tests. The hook is the first scene's `openingHook`; the episode's
// own schema (first scene only, Pip style only, trimmed, 1 to 48 characters) is the validation, not a second copy of its rules.
import type {EpisodeV2} from '../../src/schema2.ts';
import {EpisodeSchemaV2, SceneSchemaV2} from '../../src/schema2.ts';
import {DEFAULT_PIP_LAYOUT} from '../../src/library/scenes/pipCardsGeometry.ts';

export const HOOK_MAX = 48;

/** The episode with its first scene's hook set (or taken away with null). Every other part is the same object. */
export function withHook(doc: EpisodeV2, hook: string | null): EpisodeV2 {
  return {...doc, scenes: doc.scenes.map((s, i) => {
    if (i !== 0) return s;
    const {openingHook: _old, ...rest} = s as typeof s & {openingHook?: string};
    return (hook ? {...rest, openingHook: hook} : rest) as typeof s;
  })};
}

/** Why this hook cannot be saved, from the episode's own schema. Empty when it can (an empty text is "no hook", which is allowed here). */
export function hookProblems(doc: EpisodeV2, text: string): string[] {
  const t = text.trim();
  if (!t) return [];
  if (t.length > HOOK_MAX) return [`The hook is ${t.length} characters; at most ${HOOK_MAX} fit the opening.`];
  const r = EpisodeSchemaV2.safeParse(withHook(doc, t));
  if (r.success) return [];
  return r.error.issues.filter((i) => i.path.includes('openingHook')).map((i) => i.message);
}

/** Soft guidance only: 4 to 8 words reads best. It never blocks a save. */
export function hookAdvice(text: string): {words: number; note: string | null} {
  const words = text.split(/\s+/).filter(Boolean).length;
  return {words, note: words === 0 ? null : words < 4 ? 'a little short: 4 to 8 words usually reads best' : words > 8 ? 'long: 4 to 8 words usually reads best' : null};
}

/**
 * The document the opening preview draws: the episode with this hook. While the episode still has only its stand-in scene (a dark-style
 * card scene that a Pip-style episode cannot draw), a plain Pip card scene takes its place, in the preview only.
 */
export function openingPreviewDoc(doc: EpisodeV2, hook: string): EpisodeV2 {
  const standIn = doc.scenes.length === 1 && doc.scenes[0].type === 'cards';
  if (!standIn) return withHook(doc, hook.trim());
  const scene = SceneSchemaV2.parse({id: 'opening-preview', type: 'pip-cards', segments: doc.narration.segments.map((s) => s.id), params: {cards: [{heading: 'Scenes come next', body: ''}], actions: [], idle: true}, layout: DEFAULT_PIP_LAYOUT});
  return withHook({...doc, scenes: [scene]}, hook.trim());
}
