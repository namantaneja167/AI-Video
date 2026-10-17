import React from 'react';

/** Pip — refined single design. Geometry, shading and expressions are all parameters, so a later rig can drive them. */
export const K = {
  iv: '#F3EADA',
  ivHi: '#FFFBF2',
  ivSh: '#D9CCB0',
  ivDeep: '#B3A281',
  or: '#C75A2C',
  orHi: '#EA8C54',
  orSh: '#9A4120',
  orDeep: '#68290F',
  ch: '#2B2826',
  chHi: '#58524C',
  chDeep: '#141211',
  eye: '#FFFDF7',
} as const;

// Key light: top-left. Everything that is shaded uses this one offset.
const LIT = {x: -16, y: -22};

// Four anchors with unequal handles: fuller right shoulder, softer left belly, base a touch left of the top.
export const BODY = 'M 214 226 C 312 226 336 264 336 372 C 336 488 302 538 198 538 C 86 538 58 514 58 402 C 58 298 122 226 214 226 Z';
export const SEAM = 'M 142 206 C 156 300 158 470 134 566';
const SHELL = `${SEAM} L 10 566 L 10 206 Z`;

const EYE_L = {cx: 212, cy: 342, rx: 26, ry: 36};
const EYE_R = {cx: 282, cy: 336, rx: 22, ry: 33};

export type ExprName = 'neutral' | 'curious' | 'skeptical' | 'surprised';
type Br = {y: number; rot: number};
type HandPose = {x: number; y: number; rot: number; point?: boolean};
export type Expr = {
  openL: number;
  openR: number;
  lidL: number; // fraction of the eye covered from above
  lidR: number;
  lidTilt: number; // degrees, applied toward the nose on the left eye and mirrored on the right
  gx: number; // gaze -1…1
  gy: number;
  browL: Br;
  browR: Br;
  mouth: {w: number; open: number; curve: number; skew: number};
  tilt: number; // lean about the base, degrees
  sx: number; // squash/stretch
  sy: number;
  lift: number; // hover height in px
  handL: HandPose;
  handR: HandPose;
};

export const EXPR: Record<ExprName, Expr> = {
  neutral: {
    openL: 1, openR: 1, lidL: 0.1, lidR: 0.06, lidTilt: 0, gx: 0.5, gy: 0.05,
    browL: {y: 0, rot: -4}, browR: {y: -6, rot: 7},
    mouth: {w: 26, open: 0, curve: 0.3, skew: 0},
    tilt: 2, sx: 1, sy: 1, lift: 14,
    handL: {x: 34, y: 468, rot: 12}, handR: {x: 366, y: 456, rot: -12},
  },
  curious: {
    openL: 1.1, openR: 1.12, lidL: 0, lidR: 0, lidTilt: 0, gx: 0.85, gy: -0.45,
    browL: {y: -4, rot: -7}, browR: {y: -17, rot: 12},
    mouth: {w: 14, open: 0.8, curve: 0, skew: 0},
    tilt: 7, sx: 0.98, sy: 1.03, lift: 20,
    handL: {x: 34, y: 470, rot: 12}, handR: {x: 352, y: 424, rot: -26},
  },
  skeptical: {
    openL: 1, openR: 1, lidL: 0.52, lidR: 0.2, lidTilt: 10, gx: 0.75, gy: 0.2,
    browL: {y: 7, rot: 17}, browR: {y: -15, rot: 5},
    mouth: {w: 32, open: 0, curve: -0.2, skew: 1},
    tilt: -5, sx: 1.04, sy: 0.965, lift: 9,
    handL: {x: 36, y: 462, rot: 12}, handR: {x: 368, y: 340, rot: -40, point: true},
  },
  surprised: {
    openL: 1.28, openR: 1.3, lidL: 0, lidR: 0, lidTilt: 0, gx: 0, gy: 0,
    browL: {y: -22, rot: -8}, browR: {y: -22, rot: 8},
    mouth: {w: 20, open: 1, curve: 0, skew: 0},
    tilt: 0, sx: 0.95, sy: 1.08, lift: 34,
    handL: {x: 28, y: 330, rot: 28}, handR: {x: 372, y: 322, rot: -28},
  },
};

export type PipProps = {
  expr: ExprName | Expr;
  uid: string;
  crop?: [number, number, number, number];
  width?: number;
  height?: number;
  hands?: boolean;
  shadow?: boolean;
};

const Defs: React.FC = () => (
  <defs>
    <filter id="pip2-t" x="-30%" y="-30%" width="160%" height="160%">
      <feGaussianBlur stdDeviation="6" />
    </filter>
    <filter id="pip2-s" x="-40%" y="-40%" width="180%" height="180%">
      <feGaussianBlur stdDeviation="3" />
    </filter>
    <filter id="pip2-g" x="-50%" y="-200%" width="200%" height="500%">
      <feGaussianBlur stdDeviation="9" />
    </filter>
  </defs>
);

/** A brow is a tapered stroke, thicker toward the nose, so it reads as a shape and not a bar. */
const Brow: React.FC<{cx: number; cy: number; len: number; w: number; b: Br; innerRight: boolean; arc?: number}> = ({cx, cy, len, w, b, innerRight, arc = 6}) => {
  const pts: [number, number][] = [];
  const N = 14;
  const top: string[] = [];
  const bot: string[] = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const x = -len / 2 + len * t;
    const y = -arc * 4 * t * (1 - t);
    const k = innerRight ? t : 1 - t;
    const th = w * (0.42 + 0.58 * k);
    top.push(`${x.toFixed(1)} ${(y - th / 2).toFixed(1)}`);
    bot.unshift(`${x.toFixed(1)} ${(y + th / 2).toFixed(1)}`);
    pts.push([x, y]);
  }
  return (
    <g transform={`translate(${cx} ${cy + b.y}) rotate(${b.rot})`}>
      <path d={`M ${top.join(' L ')} L ${bot.join(' L ')} Z`} fill={K.ch} stroke={K.ch} strokeWidth={3} strokeLinejoin="round" />
    </g>
  );
};

const Eye: React.FC<{id: string; e: {cx: number; cy: number; rx: number; ry: number}; open: number; lid: number; tilt: number; gx: number; gy: number}> = ({id, e, open, lid, tilt, gx, gy}) => {
  const {cx, cy, rx} = e;
  const ry = e.ry * open;
  const lidY = cy - ry + 2 * ry * lid;
  const wide = rx * 2.8;
  const bulge = 5 + 9 * lid;
  const lidD = `M ${cx - wide} ${lidY} Q ${cx} ${lidY + bulge} ${cx + wide} ${lidY} L ${cx + wide} ${cy + ry * 2 + 10} L ${cx - wide} ${cy + ry * 2 + 10} Z`;
  const inside = Math.abs(lidY - cy) < ry ? Math.sqrt(1 - ((lidY - cy) / ry) ** 2) : 0;
  const hw = rx * inside;
  const ir = Math.min(rx, ry) * 0.84;
  const ox = gx * rx * 0.3;
  const oy = gy * ry * 0.3;
  return (
    <g>
      {/* carved socket: a soft shadow up-left, so the eye sits in the shell rather than on it */}
      <ellipse cx={cx - 1.5} cy={cy - 2.5} rx={rx + 8} ry={ry + 8} fill={K.ivDeep} opacity={0.38} filter="url(#pip2-s)" />
      <ellipse cx={cx + 2} cy={cy + 3.5} rx={rx + 5.5} ry={ry + 5.5} fill="none" stroke={K.ivHi} strokeOpacity={0.8} strokeWidth={2.5} filter="url(#pip2-s)" />
      <clipPath id={`${id}-lid`}>
        <path d={lidD} transform={`rotate(${tilt} ${cx} ${lidY})`} />
      </clipPath>
      <clipPath id={`${id}-eye`}>
        <ellipse cx={cx} cy={cy} rx={rx} ry={ry} />
      </clipPath>
      <g clipPath={`url(#${id}-lid)`}>
        <ellipse cx={cx} cy={cy} rx={rx} ry={ry} fill={K.eye} />
        <g clipPath={`url(#${id}-eye)`}>
          <ellipse cx={cx - 2} cy={cy - ry * 0.95} rx={rx * 1.15} ry={ry * 0.7} fill={K.ivSh} opacity={0.5} filter="url(#pip2-s)" />
          <circle cx={cx + ox} cy={cy + oy} r={ir} fill={K.or} />
          <circle cx={cx + ox} cy={cy + oy} r={ir * 0.58} fill={K.ch} />
          <circle cx={cx + ox - ir * 0.32} cy={cy + oy - ir * 0.36} r={ir * 0.27} fill={K.eye} />
          <circle cx={cx + ox + ir * 0.3} cy={cy + oy + ir * 0.36} r={ir * 0.11} fill={K.eye} opacity={0.7} />
        </g>
        <ellipse cx={cx} cy={cy} rx={rx} ry={ry} fill="none" stroke={K.ch} strokeWidth={4.5} />
      </g>
      {lid > 0.03 && hw > 2 ? (
        <path d={`M ${cx - hw} ${lidY} Q ${cx} ${lidY + bulge * 0.5} ${cx + hw} ${lidY}`} stroke={K.ch} strokeWidth={4.8} strokeLinecap="round" fill="none" transform={`rotate(${tilt} ${cx} ${lidY})`} />
      ) : null}
    </g>
  );
};

const Mouth: React.FC<{cx: number; cy: number; m: Expr['mouth']}> = ({cx, cy, m}) => {
  const {w, open, curve, skew} = m;
  if (open > 0.05) {
    const rx = w / 2;
    const ry = 4 + open * 10;
    return (
      <g transform={`translate(${cx} ${cy})`}>
        <ellipse cx={0} cy={0} rx={rx} ry={ry} fill={K.ch} />
        <ellipse cx={0} cy={ry * 0.42} rx={rx * 0.58} ry={ry * 0.5} fill={K.or} />
      </g>
    );
  }
  const l = {x: -w / 2, y: skew * 3};
  const r = {x: w / 2, y: -skew * 7};
  const ctrlY = (l.y + r.y) / 2 + curve * 9;
  return (
    <g transform={`translate(${cx} ${cy})`}>
      <path d={`M ${l.x} ${l.y} Q 0 ${ctrlY} ${r.x} ${r.y}`} fill="none" stroke={K.ch} strokeWidth={4.8} strokeLinecap="round" />
    </g>
  );
};

const Mitt: React.FC<{x: number; y: number; rot: number; flip: boolean; uid: string; point?: boolean}> = ({x, y, rot, flip, uid, point}) => (
  <g transform={`translate(${x} ${y}) rotate(${rot}) scale(${flip ? -1 : 1} 1)`}>
    <defs>
      <radialGradient id={`${uid}-mg`} cx="0.32" cy="0.26" r="0.9">
        <stop offset="0" stopColor={K.chHi} />
        <stop offset="0.5" stopColor={K.ch} />
        <stop offset="1" stopColor={K.chDeep} />
      </radialGradient>
    </defs>
    <ellipse cx={4} cy={22} rx={15} ry={4} fill="#3a2a14" opacity={0.16} filter="url(#pip2-s)" />
    {point ? <rect x={-9} y={-42} width={14} height={36} rx={7} fill={`url(#${uid}-mg)`} /> : null}
    <ellipse cx={-18} cy={-1} rx={8} ry={11.5} transform="rotate(-42 -18 -1)" fill={`url(#${uid}-mg)`} />
    <ellipse cx={0} cy={0} rx={21} ry={18} fill={`url(#${uid}-mg)`} />
  </g>
);

/** Shell material = three stacked shapes: shadow base, a lit shape offset toward the key light with a soft edge, and a broad matte sheen. */
export const Pip: React.FC<PipProps> = ({expr, uid, crop = [0, 0, 400, 600], width = 400, height = 600, hands = true, shadow = true}) => {
  const e = typeof expr === 'string' ? EXPR[expr] : expr;
  const lit = `translate(${LIT.x} ${LIT.y})`;
  const litShell = `translate(${LIT.x * 0.75} ${LIT.y * 0.8})`;
  return (
    <svg width={width} height={height} viewBox={crop.join(' ')} style={{overflow: 'visible'}}>
      <Defs />
      {shadow ? <ellipse cx={212} cy={556} rx={118 - e.lift * 0.9} ry={13} fill="#3a2a14" opacity={0.26 - e.lift * 0.002} filter="url(#pip2-g)" /> : null}
      <g transform={`translate(0 ${-e.lift})`}>
        <g transform={`translate(197 552) rotate(${e.tilt}) scale(${e.sx} ${e.sy}) translate(-197 -552)`}>
          <clipPath id={`${uid}-b`}>
            <path d={BODY} />
          </clipPath>
          <g clipPath={`url(#${uid}-b)`}>
            {/* ivory: shadow base → warm bounce at the lower rim → lit shape → broad sheen */}
            <path d={BODY} fill={K.ivSh} />
            <path d={BODY} fill="none" stroke="#FFE9CC" strokeWidth={26} opacity={0.5} filter="url(#pip2-t)" />
            <path d={BODY} fill={K.iv} transform={lit} filter="url(#pip2-t)" />
            <ellipse cx={226} cy={278} rx={70} ry={36} transform="rotate(-22 226 278)" fill={K.ivHi} opacity={0.8} filter="url(#pip2-t)" />
            {/* the shell is proud of the body: it throws a short shadow onto the ivory */}
            <path d={SEAM} stroke="#4a3418" strokeOpacity={0.26} strokeWidth={8} fill="none" filter="url(#pip2-s)" transform="translate(6 4)" />
            {/* orange shell: same recipe, same light */}
            <path d={SHELL} fill={K.orSh} />
            <path d={SHELL} fill={K.or} transform={litShell} filter="url(#pip2-t)" />
            <ellipse cx={92} cy={290} rx={40} ry={70} transform="rotate(-14 92 290)" fill={K.orHi} opacity={0.55} filter="url(#pip2-t)" />
            <path d={SEAM} stroke={K.orDeep} strokeWidth={3.4} fill="none" opacity={0.85} />
          </g>
          <path d={BODY} fill="none" stroke="#7a6a50" strokeOpacity={0.45} strokeWidth={2.4} />

          {/* face, set directly into the shell */}
          <Eye id={`${uid}-el`} e={EYE_L} open={e.openL} lid={e.lidL} tilt={e.lidTilt} gx={e.gx} gy={e.gy} />
          <Eye id={`${uid}-er`} e={EYE_R} open={e.openR} lid={e.lidR} tilt={-e.lidTilt} gx={e.gx} gy={e.gy} />
          <Brow cx={212} cy={292} len={62} w={12} b={e.browL} innerRight arc={6} />
          <Brow cx={284} cy={286} len={54} w={12} b={e.browR} innerRight={false} arc={6} />
          <Mouth cx={247} cy={398} m={e.mouth} />

          {hands ? (
            <>
              <Mitt x={e.handL.x} y={e.handL.y} rot={e.handL.rot} flip={false} uid={`${uid}-hl`} />
              <Mitt x={e.handR.x} y={e.handR.y} rot={e.handR.rot} flip uid={`${uid}-hr`} point={e.handR.point} />
            </>
          ) : null}
        </g>
      </g>
    </svg>
  );
};
