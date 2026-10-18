// Pip's performance as data. The interpreter reproduces src/art/pip-scene/rig.ts `perform` for a score that only uses
// what `perform` uses (checked numerically for every frame of the prototype), and adds what new scenes need:
// absolute body position tracks (step aside, leave the frame), a restrained idle, and the same audio-driven mouth.
// The art modules are imported unchanged; nothing here edits src/art.
import type {BrowShape, Eye, FigureSpec, MouthShape} from '../../art/pip-layers/PipFigure';
import {HERO} from '../../art/pip-layers/views';
import {SHAPES, type HandPose, type HandShape} from '../../art/pip-layers/Hand';
import type {P} from '../../art/pip-layers/geometry';
import {clamp01, easeInOut, easeOut, easeBack, lerp} from '../../anim';
import {REST_L, REST_R, toScreen, type Anchor, type Body, type HP, type Pose} from '../../art/pip-scene/rig';

/** A time: absolute seconds, a named cue, a segment edge, or the end of the scene, plus an offset. */
export type Ref = {t: number} | {cue: string; dt?: number} | {seg: string; edge: 'start' | 'end'; dt?: number} | {dur: true; dt?: number};
export type EaseName = 'inOut' | 'out' | 'back';
export type NumKey = [Ref, number, EaseName?];
export type HandValue = 'restL' | 'restR' | 'tip' | {x: number; y: number; rot: number; shape?: keyof typeof SHAPES; s?: number};
export type HandKey = [Ref, HandValue, EaseName?];

export type PipScore = {
  look: {x: NumKey[]; y: NumKey[]};
  wide: NumKey[]; browL: NumKey[]; browR: NumKey[]; browLflat: NumKey[]; lidL: NumKey[]; lidR: NumKey[]; smile: NumKey[]; smirk: NumKey[];
  tilt: NumKey[]; hop: NumKey[]; nod: NumKey[]; squash: NumKey[];
  blinks: Ref[];
  pointW: NumKey[];
  handL: HandKey[]; handR: HandKey[];
  burstAt?: Ref;
  /** New: absolute anchor tracks (px / scale). Absent = the scene's anchor, as in the prototype. */
  move?: {ax?: NumKey[]; ay?: NumKey[]; k?: NumKey[]};
  /** New: restrained idle, added on top. Absent = none (the prototype has none beyond blinks). */
  idle?: {bobPx: number; periodSec: number; tiltDeg: number};
  /** Extra blinks at a steady interval, skipping any within 0.8 s of a listed blink. */
  autoBlink?: {everySec: number; startSec: number};
};

export type ScoreCtx = {
  cues: Record<string, number>;
  segments: Record<string, {start: number; end: number}>;
  mouth: number[];
  fps: number;
  durationSec: number;
  anchor: Anchor;
  target: (t: number) => P;
};

const EASES = {inOut: easeInOut, out: easeOut, back: easeBack};
export const resolveRef = (r: Ref, c: ScoreCtx): number => {
  if ('t' in r) return r.t;
  if ('cue' in r) {
    const v = c.cues[r.cue];
    if (v === undefined) throw new Error(`score refers to cue "${r.cue}", which the scene did not provide`);
    return v + (r.dt ?? 0);
  }
  if ('seg' in r) {
    const s = c.segments[r.seg];
    if (!s) throw new Error(`score refers to segment "${r.seg}", which the scene did not provide`);
    return s[r.edge] + (r.dt ?? 0);
  }
  return c.durationSec + (r.dt ?? 0);
};

function sample<V>(t: number, keys: {t: number; v: V; e?: (x: number) => number}[], mix: (a: V, b: V, u: number) => V): V {
  if (t <= keys[0].t) return keys[0].v;
  for (let i = 1; i < keys.length; i++) {
    if (keys[i].t < keys[i - 1].t) throw new Error(`keyframes out of order at ${keys[i].t} < ${keys[i - 1].t}`);
    if (t <= keys[i].t) {
      const a = keys[i - 1];
      const b = keys[i];
      return mix(a.v, b.v, (b.e ?? easeInOut)(clamp01((t - a.t) / Math.max(1e-6, b.t - a.t))));
    }
  }
  return keys[keys.length - 1].v;
}

const num = (t: number, keys: NumKey[], c: ScoreCtx): number => sample(t, keys.map(([r, v, e]) => ({t: resolveRef(r, c), v, e: e ? EASES[e] : undefined})), lerp);

const mixShape = (a: HandShape, b: HandShape, u: number): HandShape => ({lobes: a.lobes.map((l, i) => ({a: lerp(l.a, b.lobes[i].a, u), L: lerp(l.L, b.lobes[i].L, u), w: lerp(l.w, b.lobes[i].w, u)}))});
const mixHP = (a: HP, b: HP, u: number): HP => ({x: lerp(a.x, b.x, u), y: lerp(a.y, b.y, u), rot: lerp(a.rot, b.rot, u), s: lerp(a.s, b.s, u), shape: mixShape(a.shape, b.shape, u)});
const hp = (x: number, y: number, rot: number, shape: HandShape = SHAPES.open, s = 1): HP => ({x, y, rot, s, shape});

const browFrom = (b: BrowShape, dx: number, dy: number, flat: number): BrowShape => {
  const mid = (b.p0[1] + b.p2[1]) / 2;
  const y1 = lerp(b.p1[1], mid, flat);
  return {p0: [b.p0[0] + dx, b.p0[1] + dy], p1: [b.p1[0] + dx, y1 + dy], p2: [b.p2[0] + dx, b.p2[1] + dy], w: b.w};
};

export function performScore(t: number, score: PipScore, c: ScoreCtx): Pose {
  const F = Math.min(c.mouth.length - 1, Math.max(0, Math.round(t * c.fps)));
  const open = c.mouth[F] ?? 0;
  const N = (keys: NumKey[]) => num(t, keys, c);

  const lookX = N(score.look.x);
  const lookY = N(score.look.y);
  const wide = N(score.wide);
  const browL = N(score.browL);
  const browR = N(score.browR);
  const browLflat = N(score.browLflat);
  const lidL = N(score.lidL);
  const lidR = N(score.lidR);
  const smile = N(score.smile);
  const smirk = N(score.smirk);

  const blinkTimes = score.blinks.map((r) => resolveRef(r, c));
  if (score.autoBlink) for (let b = score.autoBlink.startSec; b < c.durationSec; b += score.autoBlink.everySec) if (!blinkTimes.some((x) => Math.abs(x - b) < 0.8)) blinkTimes.push(b);
  const blink = Math.max(0, ...blinkTimes.map((b) => 1 - Math.min(1, Math.abs(t - b - 0.07) / 0.07)));

  let tilt = N(score.tilt);
  const hop = N(score.hop);
  const nod = N(score.nod);
  const squash = N(score.squash);
  let by = hop + nod;
  if (score.idle) {
    const w = (2 * Math.PI * t) / score.idle.periodSec;
    by += score.idle.bobPx * Math.sin(w);
    tilt += score.idle.tiltDeg * Math.sin(w * 0.5 + 1.1);
  }
  const mv = score.move;
  const anchor = {ax: mv?.ax ? N(mv.ax) : c.anchor.ax, ay: mv?.ay ? N(mv.ay) : c.anchor.ay, k: mv?.k ? N(mv.k) : c.anchor.k};
  const body: Body = {...anchor, bx: 0, by, tilt, sx: 2 - squash, sy: squash};

  const pointW = N(score.pointW);
  const tip: P = [892, 578];
  const cuff = toScreen(body, tip);
  const tg = c.target(t);
  const dir = (Math.atan2(tg[0] - cuff[0], -(tg[1] - cuff[1])) * 180) / Math.PI;
  const pointRot = Math.max(-38, Math.min(38, dir - body.tilt - 4));

  const hv = (v: HandValue): HP => {
    if (v === 'restL') return REST_L;
    if (v === 'restR') return REST_R;
    if (v === 'tip') return hp(tip[0], tip[1], pointRot, SHAPES.point);
    return hp(v.x, v.y, v.rot, v.shape ? SHAPES[v.shape] : SHAPES.open, v.s ?? 1);
  };
  const hand = (keys: HandKey[]): HP => sample(t, keys.map(([r, v, e]) => ({t: resolveRef(r, c), v: hv(v), e: e ? EASES[e] : undefined})), mixHP);
  const handL = hand(score.handL);
  const handR0 = hand(score.handR);
  const handR: HP = pointW > 0.001 ? {...handR0, rot: lerp(handR0.rot, pointRot, pointW)} : handR0;

  const kx = 26;
  const ky = 22;
  const sh = (p: P, f: number): P => [p[0] + lookX * kx * f, p[1] + lookY * ky * f];
  const eye = (e: Eye, lid: number): Eye => ({c: sh(e.c, 1), rx: e.rx * wide, ry: e.ry * wide, rot: e.rot, lid: Math.max(lid, blink), hi: e.hi});
  const brow = (b: BrowShape, dy: number, flat: number): BrowShape => browFrom(b, lookX * kx * 0.7, dy + lookY * ky * 0.5, flat);
  const m0 = HERO.face.mouth;
  const sm = smile - 0.4;
  const mx = lookX * kx * 0.45;
  const my = lookY * ky * 0.3;
  const mouth: MouthShape = {
    p0: [m0.p0[0] + mx, m0.p0[1] - 8 * sm + my],
    p1: [m0.p1[0] + mx, m0.p1[1] + 10 * sm + my],
    p2: [m0.p2[0] + mx, m0.p2[1] - 8 * sm - 7 * smirk + my],
    w: m0.w,
    open: open > 0.1 ? {c: [704 + mx, 542 + my + open * 4], rx: 16 + 12 * open + 3 * Math.max(0, sm), ry: 4 + 15 * open} : undefined,
  };
  const face = {eyeL: eye(HERO.face.eyeL, lidL), eyeR: eye(HERO.face.eyeR, lidR), browL: brow(HERO.face.browL, browL, browLflat), browR: brow(HERO.face.browR, browR, 0), mouth};

  let fx: FigureSpec['fx'];
  if (score.burstAt) {
    const at = resolveRef(score.burstAt, c);
    const burst = clamp01((t - at) / 0.5);
    const lineLen = 46 * easeOut(burst) * (1 - burst * 0.6);
    fx = t >= at - 0.02 && burst < 1 ? [{x: 842, y: 222, a: -62, l: lineLen}, {x: 874, y: 250, a: -22, l: lineLen}, {x: 884, y: 292, a: 14, l: lineLen}] : undefined;
  }
  const spec: FigureSpec = {
    place: HERO.place,
    face,
    hands: [
      {name: 'hand-l', pose: {pos: [handL.x, handL.y], rot: handL.rot, flip: true, s: handL.s, shape: handL.shape} as HandPose},
      {name: 'hand-r', pose: {pos: [handR.x, handR.y], rot: handR.rot, flip: false, s: handR.s, shape: handR.shape} as HandPose},
    ],
    shadow: {...HERO.shadow, o: 0}, // the scene draws its own floor shadow so it stays on the floor during hops
    fx,
  };
  return {body, spec, pointW};
}
