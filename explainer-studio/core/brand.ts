// The Pip Explains defaults a new episode starts from (docs/studio/pip-brand-standards.md): the quiet opening chime, recorded for that
// episode only and exactly once. Older episodes are never touched unless the author asks for it. Everything here goes through
// recordEpisodeSound, so the usual validation applies and no other episode's settings change.
import type {AccentEvent} from '../src/library/accents.ts';
import type {Project} from './project.ts';
import {recordEpisodeSound} from './soundSettings.ts';
import {getComponentValue} from './state.ts';

/** The synthesized chime at 0.12 s, -21 dB, under the narration through the normal accent bus. */
export const OPENING_SIGNATURE: AccentEvent = {t: 0.12, accent: 'chime', gainDb: -21};
/** The accent bus levels the caching episode was mixed with: quiet accents, voice untouched. */
export const BRAND_MIX = {voiceGainDb: 0, accentBusDb: -12, accentDuck: 0.7} as const;

/** The opening chime is the plain accent at 0.12 s: not attached to a scene cue, whatever its level. */
export const isOpeningSignature = (e: AccentEvent): boolean => e.accent === 'chime' && e.t === 0.12 && e.cue === undefined && e.scene === undefined && (e.dt ?? 0) === 0;

export type SignatureState = {/** How many opening chimes the episode records (it must be 0 or 1). */ count: number; events: number};

export function openingSignature(p: Project, episodeId: string): SignatureState {
  const events = getComponentValue<AccentEvent[]>(p, 'soundEvents', episodeId) ?? [];
  return {count: events.filter(isOpeningSignature).length, events: events.length};
}

/** Make sure the episode records the opening chime exactly once: add it if missing, drop copies beyond the first. Idempotent. */
export function ensureOpeningSignature(p: Project, episodeId: string): {changed: boolean; removedDuplicates: number; count: 1} {
  const events = getComponentValue<AccentEvent[]>(p, 'soundEvents', episodeId) ?? [];
  const sig = events.filter(isOpeningSignature);
  if (sig.length === 1) return {changed: false, removedDuplicates: 0, count: 1};
  const kept = sig.length === 0 ? [OPENING_SIGNATURE, ...events] : events.filter((e, i) => !isOpeningSignature(e) || i === events.findIndex(isOpeningSignature));
  recordEpisodeSound(p, episodeId, {soundEvents: kept});
  return {changed: true, removedDuplicates: Math.max(0, sig.length - 1), count: 1};
}

/** Take the opening chime (all copies) out of the episode's own events. Nothing else about its sound changes. */
export function removeOpeningSignature(p: Project, episodeId: string): {changed: boolean} {
  const events = getComponentValue<AccentEvent[]>(p, 'soundEvents', episodeId) ?? [];
  if (!events.some(isOpeningSignature)) return {changed: false};
  recordEpisodeSound(p, episodeId, {soundEvents: events.filter((e) => !isOpeningSignature(e))});
  return {changed: true};
}

/** What a new Pip Explains episode starts with: the chime once, and the quiet accent bus levels. Safe to run again. */
export function applyBrandDefaults(p: Project, episodeId: string): void {
  const hasOwnMix = !!p.db.prepare('SELECT 1 FROM components WHERE scope=? AND name=?').get(episodeId, 'mixParams');
  ensureOpeningSignature(p, episodeId);
  // the levels need the recorded mix script; a project without one is not set up for production yet and keeps the defaults
  if (!hasOwnMix && getComponentValue<{mixScriptSha256?: string}>(p, 'mixParams')?.mixScriptSha256) recordEpisodeSound(p, episodeId, {mixParams: {...BRAND_MIX}});
}
