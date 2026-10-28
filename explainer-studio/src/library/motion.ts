// Small motion helpers shared by the richer scenes: progress with easing, windows, overshoot, decaying shakes, curved paths and a camera.
// Pure functions of time, so a frame is always the same however it is reached.
import {clamp01, easeInOut, easeOut} from '../anim.ts';

export type XY = [number, number];
export type Ease = (x: number) => number;

/** 0 to 1 over `dur` seconds from `at`, eased. */
export const pr = (t: number, at: number, dur = 0.4, ease: Ease = easeOut): number => ease(clamp01((t - at) / dur));
/** 1 from `a` until `b`, fading in and out over `fade` seconds. */
export const span = (t: number, a: number, b: number, fade = 0.3): number => pr(t, a, fade) * (1 - pr(t, b, fade));
/** Eases past 1 and settles back: follow-through for something that lands. */
export const springOut: Ease = (x) => { const u = clamp01(x) - 1; return 1 + u * u * (2.70158 * u + 1.70158); };
/** Eases back before it goes: anticipation (dips below 0 first). */
export const anticipate: Ease = (x) => { const u = clamp01(x); return u * u * (2.70158 * u - 1.70158); };
/** A decaying oscillation starting at `at`: a shake or wobble that settles. */
export const damped = (t: number, at: number, freq = 16, decay = 6): number => (t < at ? 0 : Math.sin((t - at) * freq) * Math.exp(-(t - at) * decay));
/** A point on the quadratic curve a -> b bent towards c. */
export const bezier = (a: XY, c: XY, b: XY, u: number): XY => [(1 - u) ** 2 * a[0] + 2 * (1 - u) * u * c[0] + u * u * b[0], (1 - u) ** 2 * a[1] + 2 * (1 - u) * u * c[1] + u * u * b[1]];
export const mix = (a: XY, b: XY, u: number): XY => [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u];

/** A camera over a layer: `k` is the zoom and (x, y) the world point held at the centre of the frame. */
export type Cam = {k: number; x: number; y: number};
export const camMix = (a: Cam, b: Cam, u: number): Cam => ({k: a.k + (b.k - a.k) * u, x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u});
export const camTransform = (c: Cam, centre: XY): string => `translate(${centre[0]} ${centre[1]}) scale(${c.k}) translate(${-c.x} ${-c.y})`;
export const camPoint = (c: Cam, p: XY, centre: XY): XY => [centre[0] + (p[0] - c.x) * c.k, centre[1] + (p[1] - c.y) * c.k];

export type Rect = {x: number; y: number; w: number; h: number};
/** The camera that fits `rect` (world) inside `frame` (screen), centred in it; pair it with the frame's centre. */
export const camOn = (rect: Rect, frame: Rect, pad = 0): Cam => ({k: Math.min((frame.w - 2 * pad) / rect.w, (frame.h - 2 * pad) / rect.h), x: rect.x + rect.w / 2, y: rect.y + rect.h / 2});
export const rectCentre = (r: Rect): XY => [r.x + r.w / 2, r.y + r.h / 2];
/** A world rectangle as it appears on the screen through `cam`. */
export const camRect = (cam: Cam, r: Rect, centre: XY): Rect => {
  const [x, y] = camPoint(cam, [r.x, r.y], centre);
  return {x, y, w: r.w * cam.k, h: r.h * cam.k};
};

/** A shot: the camera is `cam` from `at` on; the move that arrives at it takes `dur` seconds before `at` ends, shaped by `ease`. */
export type CamKey = {at: number; cam: Cam; dur?: number; ease?: Ease};
/** A keyed camera over time: hold the first shot, then ease from each shot to the next. Pure in `t`, so seeking is exact. */
export const camTrack = (t: number, keys: CamKey[]): Cam => {
  let cam = keys[0].cam;
  for (let i = 1; i < keys.length; i++) {
    const k = keys[i];
    if (k.at < keys[i - 1].at) throw new Error(`camera keys out of order at ${k.at}`);
    cam = camMix(cam, k.cam, k.dur ? pr(t, k.at - k.dur, k.dur, k.ease ?? easeInOut) : t >= k.at ? 1 : 0);
  }
  return cam;
};

/** Look at a target and come back: overview, push in to read, optionally drift while reading, then return to the overview. */
export type FocusPlan = {overview: Cam; focus: Cam; arriveAt: number; arriveDur: number; leaveAt: number; leaveDur: number; drift?: Cam};
/** The camera keys for a focus plan, from `start`; append more keys after them for what follows the return. */
export const focusKeys = (start: number, p: FocusPlan): CamKey[] => [
  {at: start, cam: p.overview},
  {at: p.arriveAt, dur: p.arriveDur, cam: p.focus},
  ...(p.drift ? [{at: p.leaveAt, dur: p.leaveAt - p.arriveAt, ease: (x: number) => x, cam: p.drift}] : []),
  {at: p.leaveAt + p.leaveDur, dur: p.leaveDur, cam: p.overview},
];
/** 0 to 1: how much the focus target is being read (eased in as the camera arrives, out as it leaves). Drives spotlights and overview hints. */
export const focusRead = (t: number, p: FocusPlan): number => pr(t, p.arriveAt - p.arriveDur * 0.4, p.arriveDur * 0.6) * (1 - pr(t, p.leaveAt, p.leaveDur * 0.6));
