// Sound events and mix parameters belong to ONE episode. They are ordinary components recorded at the episode's own scope
// (an episode-scoped row overrides the project-wide one for that episode only); the project-wide rows are the default every new
// episode starts from, and that default has no accents. Nothing here filters one episode's events by another's scenes.
import type {AccentEvent} from '../src/library/accents.ts';
import {accentCueProblems} from '../src/library/dynamicCues.ts';
import {all, get} from './db.ts';
import {getEpisode, listEpisodes} from './episodes.ts';
import {hashJson} from './hash.ts';
import type {Project} from './project.ts';
import {getComponentValue, setComponent} from './state.ts';
import {soundSettingsProblems, MIX_PARAM_KEYS} from './support.ts';

export class SoundSettingsError extends Error {
  problems: string[];
  constructor(message: string, problems: string[]) {
    super(message);
    this.name = 'SoundSettingsError';
    this.problems = problems;
  }
}

export type SoundInput = {soundEvents?: AccentEvent[]; mixParams?: {voiceGainDb?: number; accentBusDb?: number; accentDuck?: number}};
type Row = {scope: string; name: string; hash: string; value_json: string};
const SOUND_NAMES = ['soundEvents', 'mixParams'] as const;

/** Which of the two settings this episode records for itself (the rest it takes from the project default). */
export function ownSoundSettings(p: Project, episodeId: string): {soundEvents: boolean; mixParams: boolean} {
  const has = (name: string) => !!get(p.db.prepare('SELECT 1 FROM components WHERE scope=? AND name=?'), episodeId, name);
  return {soundEvents: has('soundEvents'), mixParams: has('mixParams')};
}

/**
 * Record sound events and/or mix parameters for one episode. Events are checked against the accents this build can mix and
 * against the episode's own scenes: a cue no scene provides is refused here, as it would be by the preflight and the mix.
 * Other episodes are not touched: only this episode's expected hashes change.
 */
export function recordEpisodeSound(p: Project, episodeId: string, input: SoundInput): {soundEvents: string | null; mixParams: string | null} {
  const doc = getEpisode(p, episodeId);
  const problems: string[] = [];
  if (input.soundEvents) problems.push(...soundSettingsProblems({soundEvents: input.soundEvents}), ...accentCueProblems(input.soundEvents, doc.scenes as never));
  let mix: Record<string, unknown> | null = null;
  if (input.mixParams) {
    const sha = getComponentValue<{mixScriptSha256?: string}>(p, 'mixParams', episodeId)?.mixScriptSha256;
    const extra = Object.keys(input.mixParams).filter((k) => !MIX_PARAM_KEYS.includes(k) || k === 'mixScriptSha256');
    if (extra.length) problems.push(`Mix parameter(s) ${extra.join(', ')} cannot be set here; settable: voiceGainDb, accentBusDb, accentDuck.`);
    if (!sha) problems.push('The mix script is not recorded in this workspace, so mix parameters cannot be recorded.');
    else mix = {...input.mixParams, mixScriptSha256: sha};
    if (mix) problems.push(...soundSettingsProblems({mixParams: mix}));
  }
  if (problems.length) throw new SoundSettingsError(`These sound settings cannot be recorded for "${episodeId}":\n- ${problems.join('\n- ')}`, problems);
  return p.tx('record-episode-sound', () => ({
    soundEvents: input.soundEvents ? setComponent(p, 'soundEvents', input.soundEvents, episodeId) : null,
    mixParams: mix ? setComponent(p, 'mixParams', mix, episodeId) : null,
  }));
}

/** Give an episode back the project default for its sound settings (no accents). Other episodes are not touched. */
export function clearEpisodeSound(p: Project, episodeId: string): void {
  p.tx('clear-episode-sound', () => { for (const n of SOUND_NAMES) p.db.prepare('DELETE FROM components WHERE scope=? AND name=?').run(episodeId, n); });
}

export type ScopeReport = {done: boolean; episodes: string[]; reason: string};

/**
 * A workspace made before sound settings were per episode has one project-wide set, recorded with its one built episode. Those
 * exact rows (same values, same hashes, so nothing built from them goes out of date) are copied to each episode that has a built
 * mix or video, and the project default is then set to "no accents, default mix levels", which is what new episodes start from.
 * Safe to run on every start: it does nothing once the layout is as described.
 */
export function scopeSoundToEpisodes(p: Project): ScopeReport {
  const star = new Map(all<Row>(p.db.prepare("SELECT scope, name, hash, value_json FROM components WHERE scope='*' AND name IN ('soundEvents','mixParams')")).map((r) => [r.name, r]));
  const events = star.get('soundEvents');
  const mix = star.get('mixParams');
  const levels = mix ? (JSON.parse(mix.value_json) as Record<string, unknown>) : {};
  const custom = (events ? (JSON.parse(events.value_json) as unknown[]).length > 0 : false) || ['voiceGainDb', 'accentBusDb', 'accentDuck'].some((k) => levels[k] !== undefined);
  if (!custom) return {done: false, episodes: [], reason: 'the project default already has no accents and default mix levels'};
  const built = listEpisodes(p).filter((id) => !!get(p.db.prepare("SELECT 1 FROM artifacts WHERE episode_id=? AND kind IN ('mix','render')"), id));
  if (!built.length) return {done: false, episodes: [], reason: 'no episode has a built mix or video, so there is nothing the project-wide sound settings were recorded with'};
  p.tx('scope-sound-settings', () => {
    const copy = p.db.prepare('INSERT OR IGNORE INTO components(scope,name,hash,value_json,blob_hash,updated_at) SELECT ?,name,hash,value_json,NULL,updated_at FROM components WHERE scope=? AND name=?');
    for (const id of built) for (const r of star.values()) copy.run(id, '*', r.name);
    setComponent(p, 'soundEvents', []);
    setComponent(p, 'mixParams', {mixScriptSha256: levels.mixScriptSha256});
    p.db.prepare("INSERT INTO meta(key,value) VALUES('sound_settings_scoped',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(JSON.stringify({at: p.now(), episodes: built, eventsHash: events?.hash ?? null, mixParamsHash: mix ? hashJson(JSON.parse(mix.value_json)) : null}));
  });
  return {done: true, episodes: built, reason: 'copied the recorded rows to the episodes that were built with them'};
}
