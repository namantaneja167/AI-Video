import type {FigureSpec, Eye, BrowShape, MouthShape, Place} from './PipFigure';
import type {P} from './geometry';
import {HERO_CTR} from './geometry';
import {SHAPES, type HandShape} from './Hand';

/**
 * The four views of the target image as parameter sets over one set of layers.
 * Every number below is measured from the 1536×1024 reference (bounding boxes of the dark features, orange cuffs and warm gloves).
 * The hero is authored in its own space; the small views are authored in canvas space and converted to the figure's local space,
 * so the face layers still live inside the figure transform (and will follow it when it is animated).
 */

const toLocal = (pl: Place) => (p: P): P => [(p[0] - pl.c[0]) / pl.sx + HERO_CTR[0], (p[1] - pl.c[1]) / pl.sy + HERO_CTR[1]];

type CanvasFace = {
  eyeL: {c: P; w: number; h: number; lid?: number};
  eyeR: {c: P; w: number; h: number; lid?: number};
  browL: [P, P, P, number];
  browR: [P, P, P, number];
  mouth: {pts: [P, P, P]; w: number; open?: {c: P; w: number; h: number}};
};

const faceFromCanvas = (pl: Place, f: CanvasFace): FigureSpec['face'] => {
  const L = toLocal(pl);
  const k = (pl.sx + pl.sy) / 2;
  const eye = (e: CanvasFace['eyeL']): Eye => ({
    c: L(e.c),
    rx: e.w / 2 / pl.sx,
    ry: e.h / 2 / pl.sy,
    rot: 0,
    lid: e.lid ?? 0,
    hi: [-(e.w * 0.26) / pl.sx, -(e.h * 0.26) / pl.sy, (e.w * 0.14) / pl.sx],
  });
  const brow = (b: CanvasFace['browL']): BrowShape => ({p0: L(b[0]), p1: L(b[1]), p2: L(b[2]), w: b[3] / k});
  const m = f.mouth;
  const mouth: MouthShape = {
    p0: L(m.pts[0]),
    p1: L(m.pts[1]),
    p2: L(m.pts[2]),
    w: m.w / k,
    open: m.open ? {c: L(m.open.c), rx: m.open.w / 2 / pl.sx, ry: m.open.h / 2 / pl.sy} : undefined,
  };
  return {eyeL: eye(f.eyeL), eyeR: eye(f.eyeR), browL: brow(f.browL), browR: brow(f.browR), mouth};
};

/** Places a hand at the measured cuff centre, with its axis pointing from the cuff toward the measured glove centre. */
const handAt = (cuff: P, glove: P, s: number, shape: HandShape, flip = true, rotOverride?: number) => {
  const dx = glove[0] - cuff[0];
  const dy = glove[1] - cuff[1];
  return {pos: cuff, rot: rotOverride ?? (Math.atan2(dx, -dy) * 180) / Math.PI, flip, s, shape};
};

// ---------------------------------------------------------------- hero (neutral)
export const HERO: FigureSpec = {
  place: {c: HERO_CTR, sx: 1, sy: 1},
  face: {
    eyeL: {c: [618, 441], rx: 41, ry: 66, rot: 0, lid: 0, hi: [-16, -28, 11]},
    eyeR: {c: [783, 403], rx: 35, ry: 69, rot: 0, lid: 0, hi: [-9, -33, 10]},
    browL: {p0: [541, 362], p1: [572, 318], p2: [623, 326], w: 15},
    browR: {p0: [730, 290], p1: [766, 260], p2: [803, 285], w: 14},
    mouth: {p0: [675, 534], p1: [703, 548], p2: [733, 528], w: 10},
  },
  hands: [
    {name: 'hand-l', pose: handAt([243, 697], [160, 662], 1, SHAPES.open, true, -98)},
    {name: 'hand-r', pose: handAt([846, 723], [900, 717], 1, SHAPES.open, false, 82)},
  ],
  shadow: {c: [552, 898], rx: 345, ry: 34, o: 0.5},
};

// ---------------------------------------------------------------- small views (front-on, ~0.38 scale)
const SMALL = (c: P, sx: number, sy: number): Place => ({c, sx, sy});

const CUR_PLACE = SMALL([1213, 168], 0.384, 0.366);
export const CURIOUS: FigureSpec = {
  place: CUR_PLACE,
  face: faceFromCanvas(CUR_PLACE, {
    eyeL: {c: [1232, 143], w: 37, h: 54},
    eyeR: {c: [1298, 120], w: 34, h: 55},
    browL: [[1200, 112], [1209, 94], [1229, 95], 7],
    browR: [[1265, 72], [1282, 60], [1299, 68], 8],
    mouth: {pts: [[1265, 176], [1276, 185], [1288, 178]], w: 6},
  }),
  hands: [
    {name: 'hand-l', pose: handAt([1097, 232], [1060, 236], 0.4, SHAPES.open, true, -98)},
    {name: 'hand-r', pose: handAt([1341, 246], [1320, 222], 0.4, SHAPES.fist, false)},
  ],
  shadow: {c: [1213, 306], rx: 150, ry: 11, o: 0.45},
};

const SKE_PLACE = SMALL([1215, 480], 0.384, 0.366);
export const SKEPTICAL: FigureSpec = {
  place: SKE_PLACE,
  face: faceFromCanvas(SKE_PLACE, {
    eyeL: {c: [1244, 459], w: 36, h: 60, lid: 0.233},
    eyeR: {c: [1312, 441], w: 33, h: 60},
    browL: [[1209, 440], [1228, 436], [1251, 426], 11],
    browR: [[1280, 398], [1292, 383], [1307, 388], 7],
    mouth: {pts: [[1273, 497], [1286, 497], [1299, 497]], w: 5},
  }),
  hands: [
    {name: 'hand-l', pose: handAt([1097, 540], [1060, 545], 0.4, SHAPES.open, true, -98)},
    {name: 'hand-r', pose: handAt([1367, 540], [1397, 522], 0.4, SHAPES.point, false)},
  ],
  shadow: {c: [1215, 618], rx: 150, ry: 11, o: 0.45},
};

const SUR_PLACE = SMALL([1228, 800], 0.393, 0.386);
export const SURPRISED: FigureSpec = {
  place: SUR_PLACE,
  face: faceFromCanvas(SUR_PLACE, {
    eyeL: {c: [1248, 771], w: 38, h: 59},
    eyeR: {c: [1317, 752], w: 33, h: 58},
    browL: [[1216, 738], [1224, 722], [1246, 718], 7],
    browR: [[1290, 706], [1304, 699], [1321, 703], 7],
    mouth: {pts: [[1286, 812], [1293, 818], [1300, 812]], w: 5, open: {c: [1293, 812], w: 15, h: 25}},
  }),
  hands: [
    {name: 'hand-l', pose: handAt([1093, 862], [1062, 826], 0.4, SHAPES.spread, true)},
    {name: 'hand-r', pose: handAt([1377, 853], [1403, 829], 0.4, SHAPES.spread, false)},
  ],
  shadow: {c: [1228, 940], rx: 150, ry: 11, o: 0.45},
  fx: [
    {x: 1352, y: 672, a: 66, l: 26},
    {x: 1374, y: 686, a: 18, l: 24},
    {x: 1370, y: 716, a: -8, l: 22},
  ],
};
