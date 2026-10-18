// The narrow set of synthesized sound accents (from the prototype's scripts/pip_scene_timing.py) and the validation of
// the `soundEvents` setting. Pure: used by the mix preflight in Node. No assets, no downloads: every accent is a
// short synthesized sound made by workers/accents.py.
export const ACCENTS = ['pop', 'ding', 'chime', 'thump', 'tick', 'whoosh', 'swish'] as const;
export type Accent = (typeof ACCENTS)[number];

type ParamSpec = {kind: 'number'; min: number; max: number} | {kind: 'int'; min: number; max: number} | {kind: 'bool'} | {kind: 'freqs'};
/** Allowed parameters per accent, with ranges; anything else is rejected. */
export const ACCENT_PARAMS: Record<Accent, Record<string, ParamSpec>> = {
  pop: {f: {kind: 'number', min: 100, max: 4000}, dur: {kind: 'number', min: 0.03, max: 1}},
  ding: {f: {kind: 'number', min: 100, max: 4000}, dur: {kind: 'number', min: 0.1, max: 2}},
  chime: {freqs: {kind: 'freqs'}, dur: {kind: 'number', min: 0.2, max: 2}},
  thump: {dur: {kind: 'number', min: 0.05, max: 1}},
  tick: {f: {kind: 'number', min: 500, max: 6000}},
  whoosh: {dur: {kind: 'number', min: 0.1, max: 1.5}, up: {kind: 'bool'}, seed: {kind: 'int', min: 0, max: 9999}},
  swish: {dur: {kind: 'number', min: 0.1, max: 1.5}, seed: {kind: 'int', min: 0, max: 9999}},
};

export type AccentEvent = {accent: Accent; cue?: string; scene?: string; t?: number; dt?: number; gainDb: number; params?: Record<string, unknown>};
export const ACCENT_BUS_RANGE = {accentBusDb: [-40, 0], accentDuck: [0, 0.9]} as const;

/** Reasons a `soundEvents` value cannot be mixed. Empty means it can. */
export function accentProblems(events: unknown): string[] {
  if (events === undefined || events === null) return [];
  if (!Array.isArray(events)) return ['Sound events must be a list.'];
  const out: string[] = [];
  events.forEach((e, i) => {
    const at = `Sound event ${i + 1}`;
    if (typeof e !== 'object' || e === null) { out.push(`${at} must be an object.`); return; }
    const ev = e as Record<string, unknown>;
    const known = ['accent', 'cue', 'scene', 't', 'dt', 'gainDb', 'params'];
    const extra = Object.keys(ev).filter((k) => !known.includes(k));
    if (extra.length) out.push(`${at}: field(s) ${extra.join(', ')} are not supported.`);
    if (!ACCENTS.includes(ev.accent as Accent)) { out.push(`${at}: "${String(ev.accent)}" is not one of the supported accents (${ACCENTS.join(', ')}); there are no sound assets or other sounds in this build.`); return; }
    const hasCue = ev.cue !== undefined, hasT = ev.t !== undefined;
    if (hasCue === hasT) out.push(`${at}: give exactly one of "cue" (with an optional "dt") or "t".`);
    if (hasCue && typeof ev.cue !== 'string') out.push(`${at}: "cue" must be a name.`);
    if (hasT && !(typeof ev.t === 'number' && ev.t >= 0 && ev.t <= 600)) out.push(`${at}: "t" must be seconds from 0 to 600.`);
    if (ev.dt !== undefined && !(typeof ev.dt === 'number' && Math.abs(ev.dt) <= 10)) out.push(`${at}: "dt" must be within 10 seconds.`);
    if (!(typeof ev.gainDb === 'number' && ev.gainDb >= -40 && ev.gainDb <= 6)) out.push(`${at}: gainDb must be a number from -40 to 6.`);
    const spec = ACCENT_PARAMS[ev.accent as Accent];
    for (const [k, v] of Object.entries((ev.params ?? {}) as Record<string, unknown>)) {
      const s = spec[k];
      if (!s) { out.push(`${at}: ${String(ev.accent)} has no parameter "${k}" (allowed: ${Object.keys(spec).join(', ') || 'none'}).`); continue; }
      if (s.kind === 'number' && !(typeof v === 'number' && v >= s.min && v <= s.max)) out.push(`${at}: ${k} must be a number from ${s.min} to ${s.max}.`);
      if (s.kind === 'int' && !(Number.isInteger(v) && (v as number) >= s.min && (v as number) <= s.max)) out.push(`${at}: ${k} must be an integer from ${s.min} to ${s.max}.`);
      if (s.kind === 'bool' && typeof v !== 'boolean') out.push(`${at}: ${k} must be true or false.`);
      if (s.kind === 'freqs' && !(Array.isArray(v) && v.length >= 1 && v.length <= 4 && v.every((x) => typeof x === 'number' && x >= 100 && x <= 4000))) out.push(`${at}: ${k} must be 1 to 4 frequencies from 100 to 4000.`);
    }
  });
  return out;
}

const r3 = (x: number) => Math.round(x * 1000) / 1000;
/** Event times in seconds. `cues` is {sceneId: {cue: time}}; a cue without a scene is looked up in every scene and must be unambiguous. */
export function accentTimes(events: AccentEvent[], cues: Record<string, Record<string, number>> | undefined): number[] {
  return events.map((e, i) => {
    if (e.t !== undefined) return r3(e.t);
    const scenes = e.scene ? [e.scene] : Object.keys(cues ?? {}).filter((s) => cues![s]?.[e.cue!] !== undefined);
    if (scenes.length !== 1) throw new Error(`sound event ${i + 1}: cue "${e.cue}" ${scenes.length ? 'is in several scenes; name the scene' : 'is not provided by any scene'}`);
    const base = cues?.[scenes[0]]?.[e.cue!];
    if (base === undefined) throw new Error(`sound event ${i + 1}: scene "${scenes[0]}" has no cue "${e.cue}"`);
    return r3(base + (e.dt ?? 0));
  });
}
