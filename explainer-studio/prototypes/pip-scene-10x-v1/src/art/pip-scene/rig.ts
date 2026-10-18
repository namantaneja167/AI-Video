import type {BrowShape, Eye, FigureSpec, MouthShape} from '../pip-layers/PipFigure';
import {HERO} from '../pip-layers/views';
import {SHAPES, type HandPose, type HandShape} from '../pip-layers/Hand';
import type {P} from '../pip-layers/geometry';
import {clamp01, easeInOut, easeOut, lerp} from '../../anim';

export type Timing = {
  fps: number;
  durationSec: number;
  frames: number;
  leadSec: number;
  narrationSeed: number;
  segments: {id: string; text: string; start: number; end: number}[];
  phrases: {id: string; text: string; start: number; end: number; exact: boolean}[];
  words: {text: string; segment: string; start: number; end: number}[];
  cues: Record<string, number>;
  mouth: number[];
  sfx: {t: number; name: string}[];
  audio: string;
};

// ------------------------------------------------------------------ keyframe tracks (times in scene seconds; must ascend)
export type Ease = (t: number) => number;
export type Key<V> = {t: number; v: V; e?: Ease};
export const key = <V>(t: number, v: V, e?: Ease): Key<V> => ({t, v, e});

function sample<V>(t: number, keys: Key<V>[], mix: (a: V, b: V, u: number) => V): V {
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
export const num = (t: number, keys: Key<number>[]) => sample(t, keys, lerp);

// ------------------------------------------------------------------ hands
export type HP = {x: number; y: number; rot: number; s: number; shape: HandShape};
const mixShape = (a: HandShape, b: HandShape, u: number): HandShape => ({lobes: a.lobes.map((l, i) => ({a: lerp(l.a, b.lobes[i].a, u), L: lerp(l.L, b.lobes[i].L, u), w: lerp(l.w, b.lobes[i].w, u)}))});
const mixHP = (a: HP, b: HP, u: number): HP => ({x: lerp(a.x, b.x, u), y: lerp(a.y, b.y, u), rot: lerp(a.rot, b.rot, u), s: lerp(a.s, b.s, u), shape: mixShape(a.shape, b.shape, u)});
const hp = (x: number, y: number, rot: number, shape: HandShape = SHAPES.open, s = 1): HP => ({x, y, rot, s, shape});

export const REST_L = hp(243, 697, -98);
export const REST_R = hp(846, 723, 82);

// ------------------------------------------------------------------ hero space -> screen
export const BASE: P = [552, 850]; // the figure stands on this hero point
export type Body = {ax: number; ay: number; k: number; bx: number; by: number; tilt: number; sx: number; sy: number};
export const toScreen = (b: Body, p: P): P => {
  const x = (p[0] - BASE[0]) * b.k * b.sx;
  const y = (p[1] - BASE[1]) * b.k * b.sy;
  const r = (b.tilt * Math.PI) / 180;
  return [b.ax + b.bx + x * Math.cos(r) - y * Math.sin(r), b.ay + b.by + x * Math.sin(r) + y * Math.cos(r)];
};
export const bodyTransform = (b: Body) => `translate(${b.ax + b.bx} ${b.ay + b.by}) rotate(${b.tilt}) scale(${b.k * b.sx} ${b.k * b.sy}) translate(${-BASE[0]} ${-BASE[1]})`;

/** Hero-space fingertip of a hand (end of its third lobe), from the same transform chain the Hand layer draws with. */
export const tipOf = (p: HandPose): P => {
  const lb = p.shape.lobes[2];
  const a = (lb.a * Math.PI) / 180;
  const s = p.s ?? 1;
  const x = Math.sin(a) * lb.L * (p.flip ? -s : s);
  const y = (-50 - Math.cos(a) * lb.L) * s;
  const r = (p.rot * Math.PI) / 180;
  return [p.pos[0] + x * Math.cos(r) - y * Math.sin(r), p.pos[1] + x * Math.sin(r) + y * Math.cos(r)];
};

export type Pose = {body: Body; spec: FigureSpec; pointW: number};
export type Anchor = {ax: number; ay: number; k: number};

const browFrom = (b: BrowShape, dx: number, dy: number, flat: number): BrowShape => {
  const mid = (b.p0[1] + b.p2[1]) / 2;
  const y1 = lerp(b.p1[1], mid, flat);
  return {p0: [b.p0[0] + dx, b.p0[1] + dy], p1: [b.p1[0] + dx, y1 + dy], p2: [b.p2[0] + dx, b.p2[1] + dy], w: b.w};
};

/** `target(t)` returns the screen point Pip points at (the asterisk, then the enlarged callout). */
export function perform(t: number, T: Timing, anchor: Anchor, target: (t: number) => P): Pose {
  const c = T.cues;
  const S = Object.fromEntries(T.segments.map((s) => [s.id, s])) as Record<string, {start: number; end: number}>;
  const F = Math.min(T.mouth.length - 1, Math.max(0, Math.round(t * T.fps)));
  const open = T.mouth[F] ?? 0;
  const D = T.durationSec;
  const notice = c.notice;
  const point = c.point;
  const rel = c.point_release;
  const palms = c.palms;
  const back = c.face_camera + 0.4; // hands come down after the contrast

  // ---- gaze: the face turns toward whatever Pip attends to
  const lookX = num(t, [key(0, 0.05), key(0.35, 0.18, easeOut), key(c.claim + 0.1, 0.22), key(notice - 0.02, 0.15), key(notice + 0.16, -0.08, easeOut), key(c.callout - 0.1, -0.05), key(c.callout + 0.25, 0.2), key(c.contrast + 0.1, 0.2), key(c.lane_long + 0.15, 0.5, easeOut), key(c.face_camera, 0.5), key(c.face_camera + 0.35, 0.0), key(D, 0.0)]);
  const lookY = num(t, [key(0, -0.1), key(0.35, -0.5, easeOut), key(c.claim + 0.1, -0.55), key(notice - 0.02, -0.45), key(notice + 0.16, -0.9, easeOut), key(c.callout - 0.1, -0.8), key(c.callout + 0.25, -0.55), key(c.contrast + 0.1, -0.5), key(c.lane_long + 0.15, -0.35), key(c.face_camera, -0.3), key(c.face_camera + 0.35, 0.02), key(D, 0.02)]);
  const wide = num(t, [key(0, 1), key(0.35, 1.07), key(notice - 0.03, 1.07), key(notice + 0.1, 1.15, easeOut), key(notice + 0.5, 1.02), key(c.face_camera, 1.0), key(c.face_camera + 0.4, 1.03), key(D, 1.0)]);

  // ---- brows / lids / mouth shape
  const browL = num(t, [key(0, 0), key(0.4, -14), key(notice - 0.03, -14), key(notice + 0.1, 5), key(rel + 0.2, 7), key(c.contrast, -5), key(c.face_camera + 0.2, -4), key(c.resolve1, 2), key(D, 0)]);
  const browR = num(t, [key(0, 0), key(0.4, -14), key(notice - 0.03, -14), key(notice + 0.1, -30), key(rel + 0.2, -16), key(c.contrast, -8), key(c.face_camera + 0.2, -6), key(c.resolve1, -2), key(D, -2)]);
  const browLflat = num(t, [key(0, 0), key(notice, 0), key(notice + 0.14, 0.7), key(rel + 0.2, 0.35), key(c.contrast, 0), key(D, 0)]);
  const lidL = num(t, [key(0, 0), key(notice, 0), key(notice + 0.14, 0.22), key(rel + 0.2, 0.15), key(c.contrast, 0.04), key(c.resolve1, 0.1), key(D, 0.08)]);
  const lidR = num(t, [key(0, 0), key(notice, 0), key(notice + 0.14, 0.06), key(c.contrast, 0), key(c.resolve1, 0.08), key(D, 0.06)]);
  const smile = num(t, [key(0, 0.5), key(c.claim, 0.7), key(S.s2.start, 0.95), key(S.s2.end, 0.95), key(notice, 0.4), key(notice + 0.14, -0.1), key(c.contrast, 0.15), key(c.face_camera + 0.3, 0.8), key(c.resolve2, 1.0), key(D, 0.9)]);
  const smirk = num(t, [key(0, 0), key(notice, 0), key(notice + 0.2, 0.8), key(rel + 0.3, 0.35), key(c.contrast, 0), key(D, 0)]);

  // blinks sit in the natural pauses between phrases
  const blinkAt = [S.s2.end + 0.28, S.s4.end + 0.1, S.s5.end + 0.2, D - 3.2, D - 1.4];
  const blink = Math.max(0, ...blinkAt.map((b) => 1 - Math.min(1, Math.abs(t - b - 0.07) / 0.07)));

  // ---- body: lean toward what matters, one quick recoil when the asterisk is noticed, nods on "impressive" and the resolve
  const tilt = num(t, [key(0, 0), key(c.claim - 0.2, 0), key(c.claim + 0.4, 3.0), key(notice - 0.04, 3.0), key(notice + 0.1, -2.0, easeOut), key(point + 0.3, 4.0), key(rel + 0.4, 2.0), key(c.contrast + 0.3, -2.0), key(c.face_camera + 0.4, 0), key(D, 0)]);
  const hop = num(t, [key(notice - 0.1, 0), key(notice + 0.04, -17, easeOut), key(notice + 0.32, 0, easeOut), key(D, 0)]);
  const nod = num(t, [key(S.s2.start + 0.1, 0), key(S.s2.start + 0.3, 9), key(S.s2.start + 0.62, 0), key(c.resolve1 - 0.05, 0), key(c.resolve1 + 0.1, 8), key(c.resolve1 + 0.4, 0), key(c.resolve2, 0), key(c.resolve2 + 0.12, 7), key(c.resolve2 + 0.45, 0), key(D, 0)]);
  const squash = num(t, [key(notice - 0.14, 1), key(notice - 0.04, 0.955), key(notice + 0.08, 1.045, easeOut), key(notice + 0.34, 1, easeOut), key(D, 1)]);
  const body: Body = {ax: anchor.ax, ay: anchor.ay, k: anchor.k, bx: 0, by: hop + nod, tilt, sx: 2 - squash, sy: squash};

  // ---- right hand: while pointing it re-aims at the (possibly moving) target
  const pointW = num(t, [key(point + 0.2 - 0.001, 0), key(point + 0.2, 1), key(rel, 1), key(rel + 0.5, 0), key(D, 0)]);
  const tip: P = [892, 578];
  const cuff = toScreen(body, tip);
  const tg = target(t);
  const dir = (Math.atan2(tg[0] - cuff[0], -(tg[1] - cuff[1])) * 180) / Math.PI;
  const pointRot = Math.max(-38, Math.min(38, dir - body.tilt - 4));
  const mk = (keys: Key<HP>[]) => sample(t, keys, mixHP);
  const handL = mk([
    key(0, REST_L), key(c.claim + 0.3, hp(232, 668, -92)), key(notice - 0.04, hp(232, 668, -92)), key(notice + 0.1, hp(222, 640, -80, SHAPES.spread), easeOut), key(notice + 0.5, hp(240, 704, -99)),
    key(palms - 0.1, hp(240, 704, -99)), key(palms + 0.3, hp(196, 640, -66, SHAPES.open), easeOut), key(back, hp(196, 640, -66, SHAPES.open)), key(back + 0.5, REST_L), key(D, REST_L),
  ]);
  const handR0 = mk([
    key(0, REST_R), key(c.claim + 0.3, hp(858, 694, 76)), key(notice - 0.04, hp(858, 694, 76)), key(notice + 0.1, hp(868, 668, 70, SHAPES.spread), easeOut), key(point - 0.2, hp(870, 664, 52, SHAPES.open)),
    key(point + 0.2, hp(tip[0], tip[1], pointRot, SHAPES.point), easeOut), key(rel, hp(tip[0], tip[1], pointRot, SHAPES.point)), key(rel + 0.5, hp(852, 704, 78)),
    key(palms - 0.1, hp(852, 704, 78)), key(palms + 0.3, hp(906, 640, 62, SHAPES.open), easeOut), key(back, hp(906, 640, 62, SHAPES.open)), key(back + 0.5, REST_R),
    key(c.resolve1 - 0.06, REST_R), key(c.resolve1 + 0.1, hp(852, 696, 80), easeOut), key(c.resolve1 + 0.38, REST_R), key(c.resolve2 - 0.04, REST_R), key(c.resolve2 + 0.1, hp(852, 704, 80), easeOut), key(c.resolve2 + 0.4, REST_R), key(D, REST_R),
  ]);
  const handR: HP = pointW > 0.001 ? {...handR0, rot: lerp(handR0.rot, pointRot, pointW)} : handR0;

  // ---- face
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

  const burst = clamp01((t - notice) / 0.5);
  const lineLen = 46 * easeOut(burst) * (1 - burst * 0.6);
  const fx = t >= notice - 0.02 && burst < 1 ? [{x: 842, y: 222, a: -62, l: lineLen}, {x: 874, y: 250, a: -22, l: lineLen}, {x: 884, y: 292, a: 14, l: lineLen}] : undefined;

  const shadow = {...HERO.shadow, o: 0}; // the scene draws its own floor shadow so it stays on the floor during hops
  const spec: FigureSpec = {
    place: HERO.place,
    face,
    hands: [
      {name: 'hand-l', pose: {pos: [handL.x, handL.y], rot: handL.rot, flip: true, s: handL.s, shape: handL.shape} as HandPose},
      {name: 'hand-r', pose: {pos: [handR.x, handR.y], rot: handR.rot, flip: false, s: handR.s, shape: handR.shape} as HandPose},
    ],
    shadow,
    fx,
  };
  return {body, spec, pointW};
}
