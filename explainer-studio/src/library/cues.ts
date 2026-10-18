// Named cue times for a scene, resolved from word and segment times. Pure and self-contained: it runs in Node (the mix
// places accents on cues) and in the browser bundle (the scene performs on cues).
export type CueAt = 'start' | 'end' | {word: number | string};
/** `segment` is an id, or a number: the position within the scene's own segments (so a scene works in any episode). */
export type CueRef = {segment: string | number; at: CueAt; dt?: number} | {t: number};
export type CueSpec = Record<string, CueRef>;
export type CueSegment = {id: string; start: number; end: number; words: {text: string; start: number; end: number}[]};

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
const r3 = (x: number) => Math.round(x * 1000) / 1000;

/** `segments` are the scene's own segments, in order. */
export function resolveCues(spec: CueSpec, segments: CueSegment[]): Record<string, number> {
  const byId = new Map(segments.map((s) => [s.id, s]));
  const out: Record<string, number> = {};
  for (const [name, ref] of Object.entries(spec)) {
    if ('t' in ref) { out[name] = r3(ref.t); continue; }
    const seg = typeof ref.segment === 'number' ? segments[ref.segment] : byId.get(ref.segment);
    if (!seg) throw new Error(`cue "${name}": no segment "${ref.segment}"`);
    let base: number;
    if (ref.at === 'start') base = seg.start;
    else if (ref.at === 'end') base = seg.end;
    else {
      const key = ref.at.word;
      const w = typeof key === 'number' ? seg.words[key] : seg.words.find((x) => norm(x.text) === norm(key));
      if (!w) throw new Error(`cue "${name}": segment "${ref.segment}" has no word ${JSON.stringify(key)}`);
      base = w.start;
    }
    out[name] = r3(base + (ref.dt ?? 0));
  }
  return out;
}
