// Geometry measured from the Pip target image (1536×1024). Hero view is the master; the small views reuse it under a placement.
export type P = [number, number];

const f = (n: number) => n.toFixed(1);

/** Closed Catmull-Rom spline through the points, as cubic Béziers. */
export const smoothClosed = (pts: P[]): string => {
  const n = pts.length;
  let d = `M ${f(pts[0][0])} ${f(pts[0][1])}`;
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n];
    const p1 = pts[i];
    const p2 = pts[(i + 1) % n];
    const p3 = pts[(i + 2) % n];
    d += ` C ${f(p1[0] + (p2[0] - p0[0]) / 6)} ${f(p1[1] + (p2[1] - p0[1]) / 6)} ${f(p2[0] - (p3[0] - p1[0]) / 6)} ${f(p2[1] - (p3[1] - p1[1]) / 6)} ${f(p2[0])} ${f(p2[1])}`;
  }
  return `${d} Z`;
};

/** Open Catmull-Rom spline (end points duplicated as phantom neighbours). */
export const smoothOpen = (pts: P[]): string => {
  const n = pts.length;
  let d = `M ${f(pts[0][0])} ${f(pts[0][1])}`;
  for (let i = 0; i < n - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(n - 1, i + 2)];
    d += ` C ${f(p1[0] + (p2[0] - p0[0]) / 6)} ${f(p1[1] + (p2[1] - p0[1]) / 6)} ${f(p2[0] - (p3[0] - p1[0]) / 6)} ${f(p2[1] - (p3[1] - p1[1]) / 6)} ${f(p2[0])} ${f(p2[1])}`;
  }
  return d;
};

/** Hero body outline, clockwise from the top of the seam. Measured row by row from the reference. */
export const BODY_PTS: P[] = [
  [448, 155], [508, 139], [568, 132], [628, 137], [688, 147], [748, 178], [809, 208], [836, 252], [850, 292], [859, 332],
  [864, 372], [867, 412], [868, 452], [866, 492], [862, 532], [855, 572], [845, 612], [833, 652], [817, 692], [795, 732],
  [765, 772], [714, 812], [668, 832], [628, 841], [568, 849], [508, 849], [448, 841], [388, 825], [328, 793], [286, 750],
  [255, 700], [236, 640], [227, 595], [223, 555], [220, 515], [221, 475], [224, 435], [232, 395], [244, 355], [261, 315],
  [285, 275], [318, 235], [366, 195],
];

/** Seam centre line, top to bottom, extended past the outline at both ends so a clip trims it cleanly. */
export const SEAM_PTS: P[] = [
  [436, 112], [453, 155], [472, 195], [478, 235], [482, 275], [485, 315], [485, 355], [485, 395], [484, 435], [482, 475],
  [479, 515], [476, 555], [471, 595], [466, 635], [460, 675], [452, 715], [443, 755], [432, 795], [421, 835], [414, 880],
];

export const HERO_CTR: P = [544, 491];

export const COLOR = {
  ivory0: '#FAF0E3',
  ivory1: '#F3E6D4',
  ivory2: '#EADAC4',
  ivory3: '#CCB49B',
  ivoryEdge: '#DCC6AA',
  shell0: '#EE8147',
  shell1: '#D55D26',
  shell2: '#AB3E14',
  seam: '#B04317',
  seamHi: '#F08C55',
  ink: '#2D2723',
  inkHi: '#FBF6F0',
  glove0: '#FFF6E8',
  glove1: '#F8E9D6',
  glove2: '#E6D0B6',
  cuff0: '#E6753A',
  cuff1: '#CF5A27',
  cuff2: '#A93D14',
  bg: '#DADCDF',
} as const;
