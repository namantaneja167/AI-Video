import type {Timeline} from './schema';

export const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);
export const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
export const easeBack = (t: number) => {
  const c1 = 1.4;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};

/** Eased progress 0..1 of an animation starting at `start` lasting `dur` frames. Non-finite start => 0. */
export const prog = (f: number, start: number, dur: number, ease: (t: number) => number = easeOut) =>
  ease(clamp01((f - start) / dur));

/** 1 at `start`, decaying to 0 over `dur` frames; 0 before. */
export const pulse = (f: number, start: number, dur: number) => (f < start || f > start + dur ? 0 : 1 - (f - start) / dur);

export type Cues = Record<string, number>;
export const cue = (cues: Cues, name: string) => cues[name] ?? Infinity;

export type SceneProps<P> = {params: P; cues: Cues; startFrame: number; endFrame: number};

export type Resolved = {
  cues: Cues;
  expression: string;
  expressionSince: number;
  prevExpression: string;
};

/** Frame numbers for the first occurrence of each cue inside the given scene. */
export const sceneCues = (timeline: Timeline, sceneId: string, fps: number): Cues => {
  const segs = new Set(timeline.segments.map((s) => s.id));
  const scene = timeline.scenes.find((s) => s.id === sceneId);
  const out: Cues = {};
  if (!scene) return out;
  for (const e of timeline.events) {
    if (!e.cue || !segs.has(e.segment)) continue;
    const frame = Math.round(e.time * fps);
    if (frame / fps >= scene.start - 1e-6 && frame / fps < scene.end && !(e.cue in out)) out[e.cue] = frame;
  }
  return out;
};
