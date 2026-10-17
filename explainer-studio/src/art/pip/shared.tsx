import React from 'react';

export type ExprName = 'neutral' | 'curious' | 'skeptical' | 'surprised';
type Brow = {y: number; rot: number};
export type Expr = {
  open: number; // eye height multiplier
  lidL: number; // 0 = fully open … 1 = shut (viewer's left eye)
  lidR: number;
  lidTilt: number; // degrees; lid slants down toward the nose on the lowered eye
  gx: number; // gaze, -1…1
  gy: number;
  browL: Brow;
  browR: Brow;
  mouth: 'neutral' | 'o' | 'O' | 'smirk';
  tilt: number; // whole-body lean, degrees (about the ground contact)
  sx: number; // squash / stretch
  sy: number;
};

// One expression table shared by all three concepts so the comparison is fair.
export const EXPR: Record<ExprName, Expr> = {
  neutral: {open: 1, lidL: 0.12, lidR: 0.05, lidTilt: 0, gx: 0.4, gy: 0, browL: {y: 0, rot: -3}, browR: {y: -5, rot: 6}, mouth: 'neutral', tilt: 2, sx: 1, sy: 1},
  curious: {open: 1.12, lidL: 0, lidR: 0, lidTilt: 0, gx: 0.8, gy: -0.35, browL: {y: -3, rot: -6}, browR: {y: -15, rot: 11}, mouth: 'o', tilt: 6, sx: 0.98, sy: 1.03},
  skeptical: {open: 1, lidL: 0.5, lidR: 0.22, lidTilt: 10, gx: 0.7, gy: 0.15, browL: {y: 5, rot: 16}, browR: {y: -14, rot: 5}, mouth: 'smirk', tilt: -4, sx: 1.04, sy: 0.965},
  surprised: {open: 1.3, lidL: 0, lidR: 0, lidTilt: 0, gx: 0, gy: 0, browL: {y: -20, rot: -8}, browR: {y: -20, rot: 8}, mouth: 'O', tilt: 0, sx: 0.95, sy: 1.075},
};

export const C = {
  iv: '#F4ECDD',
  ivHi: '#FFFBF1',
  ivSh: '#DDD0B7',
  ivDk: '#BCAC90',
  or: '#C2562B',
  orHi: '#E48049',
  orSh: '#8D3A1B',
  ch: '#2D2A28',
  chHi: '#4B4642',
  chSh: '#191716',
} as const;

export type PipProps = {expr: ExprName; uid: string; crop?: [number, number, number, number]; width?: number; height?: number};

/** Shared SVG defs: paper-grain for the matte finish and a soft contact-shadow blur. */
export const PipDefs: React.FC = () => (
  <defs>
    <filter id="pip-grain" x="0" y="0" width="100%" height="100%">
      <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="4" />
      <feColorMatrix type="matrix" values="0 0 0 0 0.25  0 0 0 0 0.18  0 0 0 0 0.1  0.34 0 0 0 -0.05" />
    </filter>
    <filter id="pip-blur" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur stdDeviation="9" />
    </filter>
    <filter id="pip-soft" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur stdDeviation="3.5" />
    </filter>
  </defs>
);

/** Soft matte volume: base ramp + a vignette that darkens the far edge, clipped children (seams, faces) on top. */
export const Matte: React.FC<{id: string; d: string; hi: string; base: string; sh: string; children?: React.ReactNode; edge?: string}> = ({id, d, hi, base, sh, children, edge}) => (
  <g>
    <defs>
      <linearGradient id={`${id}-g`} x1="0.1" y1="0" x2="0.9" y2="1">
        <stop offset="0" stopColor={hi} />
        <stop offset="0.45" stopColor={base} />
        <stop offset="1" stopColor={sh} />
      </linearGradient>
      <radialGradient id={`${id}-v`} cx="0.34" cy="0.26" r="0.95">
        <stop offset="0" stopColor="#fff" stopOpacity="0.26" />
        <stop offset="0.45" stopColor="#fff" stopOpacity="0" />
        <stop offset="0.78" stopColor="#000" stopOpacity="0" />
        <stop offset="1" stopColor="#000" stopOpacity="0.28" />
      </radialGradient>
      <clipPath id={`${id}-c`}>
        <path d={d} />
      </clipPath>
    </defs>
    <path d={d} fill={`url(#${id}-g)`} />
    <path d={d} fill={`url(#${id}-v)`} />
    <g clipPath={`url(#${id}-c)`}>
      {children}
      <rect x={0} y={0} width={400} height={600} filter="url(#pip-grain)" opacity={0.55} />
    </g>
    <path d={d} fill="none" stroke={edge ?? sh} strokeOpacity={0.35} strokeWidth={2} />
  </g>
);

/** A mitten hand that floats free of the body. `flip` mirrors the thumb for the right-hand side. */
export const Hand: React.FC<{x: number; y: number; rot?: number; flip?: boolean; fill: string; shade: string; hi: string; s?: number; line?: string}> = ({x, y, rot = 0, flip = false, fill, shade, hi, s = 1, line}) => (
  <g transform={`translate(${x} ${y}) rotate(${rot}) scale(${flip ? -s : s} ${s})`}>
    <ellipse cx={4} cy={26} rx={20} ry={5} fill="#3a2a14" opacity={0.12} />
    <ellipse cx={-18} cy={-8} rx={8.5} ry={13} transform="rotate(-38 -18 -8)" fill={fill} stroke={line} strokeWidth={2} />
    <ellipse rx={26} ry={22} fill={fill} stroke={line} strokeWidth={2} />
    <path d="M -22 8 Q 0 30 24 8 Q 27 19 0 25 Q -23 23 -22 8 Z" fill={shade} opacity={0.55} />
    <ellipse cx={-8} cy={-9} rx={11} ry={6} fill={hi} opacity={0.32} />
  </g>
);

export const GroundShadow: React.FC<{cx: number; cy: number; rx: number; o?: number}> = ({cx, cy, rx, o = 0.3}) => (
  <ellipse cx={cx} cy={cy} rx={rx} ry={rx * 0.14} fill="#3a2a14" opacity={o} filter="url(#pip-blur)" />
);

/** Wraps a pip in the lean/squash/stretch for its expression, pivoting about the ground contact. */
export const Pose: React.FC<{e: Expr; ox: number; oy: number; children: React.ReactNode}> = ({e, ox, oy, children}) => (
  <g transform={`translate(${ox} ${oy}) rotate(${e.tilt}) scale(${e.sx} ${e.sy}) translate(${-ox} ${-oy})`}>{children}</g>
);

/** A brow is a short rounded bar; `rot` > 0 on the left brow (or < 0 on the right) lowers the inner end. */
export const Brow: React.FC<{cx: number; cy: number; len: number; w: number; color: string; b: {y: number; rot: number}; arc?: number}> = ({cx, cy, len, w, color, b, arc = 0}) => (
  <g transform={`translate(${cx} ${cy + b.y}) rotate(${b.rot})`}>
    <path d={`M ${-len / 2} 0 Q 0 ${-arc} ${len / 2} 0`} stroke={color} strokeWidth={w} strokeLinecap="round" fill="none" />
  </g>
);

/** An eye shape clipped by a (possibly slanted) lid line; `lid` is the fraction of the eye covered from the top. */
export const LidClip: React.FC<{id: string; cx: number; cy: number; ry: number; lid: number; tilt: number; size: number}> = ({id, cx, cy, ry, lid, tilt, size}) => {
  const lidY = cy - ry + 2 * ry * lid;
  return (
    <clipPath id={id}>
      <rect x={cx - size} y={lidY} width={size * 2} height={size * 2} transform={`rotate(${tilt} ${cx} ${lidY})`} />
    </clipPath>
  );
};
