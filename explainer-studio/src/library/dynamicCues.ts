// Cue rules for scenes whose cues depend on their own parameters (the fixed-cue scenes keep their rules in sceneSpecs.ts).
// Kept apart from sceneSpecs.ts and cues.ts on purpose: those two are fingerprinted as "timeline logic" in recorded projects.
// Pure: used by the timing job, the preflight, the checks and the composition preview.
import {PipCardsParams} from './params.ts';
import {resolveCues, type CueRef, type CueSegment, type CueSpec} from './cues.ts';
import {SCENE_CUES} from './sceneSpecs.ts';
import {TICKET_MOTION_CUES} from './ticketCues.ts';
import type {AccentEvent} from './accents.ts';

/** Scenes timed on words of their own script. Their rules are part of the timing's inputs (see core/deps.ts), not of the timeline-logic fingerprint. */
export const DOCUMENT_SCENE_CUES: Record<string, CueSpec> = {'ticket-motion': TICKET_MOTION_CUES};

export type SceneLike = {id?: string; type: string; params: unknown; segments: string[]};

const at = (a: {segment: number; word?: string | number; edge?: 'start' | 'end'}, dt: number): CueRef => ({segment: a.segment, at: a.word !== undefined ? {word: a.word} : a.edge ?? 'start', dt});

/** `card1..cardN` (a card appears), `action1..actionM` (something Pip does) and `voice_end`; undefined when the scene has none. */
export function sceneCueSpec(scene: SceneLike): CueSpec | undefined {
  const fixed = SCENE_CUES[scene.type] ?? DOCUMENT_SCENE_CUES[scene.type];
  if (fixed) return fixed;
  if (scene.type !== 'pip-cards') return undefined;
  const p = PipCardsParams.safeParse(scene.params);
  if (!p.success) return undefined;
  const last = Math.max(0, scene.segments.length - 1);
  const spec: CueSpec = {};
  p.data.cards.forEach((c, i) => { spec[`card${i + 1}`] = at(c.at ?? {segment: Math.min(i, last)}, -0.05); });
  p.data.actions.forEach((a, j) => { spec[`action${j + 1}`] = at(a.at, 0); });
  spec.voice_end = {segment: last, at: 'end'};
  return spec;
}

/** Cue times for every scene whose rules come from its parameters. `segments` are the timeline's, by id. */
export function dynamicCues(scenes: SceneLike[], segments: CueSegment[]): Record<string, Record<string, number>> {
  const byId = new Map(segments.map((s) => [s.id, s]));
  const out: Record<string, Record<string, number>> = {};
  for (const sc of scenes) {
    if (SCENE_CUES[sc.type]) continue;
    const spec = sceneCueSpec(sc);
    if (spec && sc.id) out[sc.id] = resolveCues(spec, sc.segments.map((id) => byId.get(id)!));
  }
  return out;
}

/** True when any scene's cue rules depend on its parameters (and so on the document, not on the scene type alone). */
export const hasDynamicCues = (scenes: SceneLike[]): boolean => scenes.some((s) => !SCENE_CUES[s.type] && sceneCueSpec(s) !== undefined);

/** Why sound events cannot be placed on this episode's scenes: a cue no scene provides, one several provide, or a named scene without it. Empty means every cue resolves. */
export function accentCueProblems(events: AccentEvent[], scenes: SceneLike[]): string[] {
  const names = new Map(scenes.filter((s) => s.id).map((s) => [s.id!, new Set(Object.keys(sceneCueSpec(s) ?? {}))]));
  const out: string[] = [];
  events.forEach((e, i) => {
    if (e.cue === undefined) return;
    const at = `Sound event ${i + 1} (${e.accent})`;
    if (e.scene) {
      if (!names.has(e.scene)) out.push(`${at} names scene "${e.scene}", which this episode does not have.`);
      else if (!names.get(e.scene)!.has(e.cue)) out.push(`${at}: scene "${e.scene}" has no cue "${e.cue}".`);
      return;
    }
    const hits = [...names].filter(([, c]) => c.has(e.cue!)).map(([id]) => id);
    if (!hits.length) out.push(`${at} is placed on the cue "${e.cue}", which no scene of this episode provides.`);
    else if (hits.length > 1) out.push(`${at} is placed on the cue "${e.cue}", which several scenes provide (${hits.join(', ')}); name the scene.`);
  });
  return out;
}
