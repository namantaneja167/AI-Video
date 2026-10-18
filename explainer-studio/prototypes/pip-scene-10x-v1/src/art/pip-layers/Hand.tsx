import React from 'react';
import {COLOR} from './geometry';
import type {P} from './geometry';

export type Lobe = {a: number; L: number; w: number}; // angle from the hand axis (deg), reach from the palm centre, width
export type HandShape = {lobes: Lobe[]; palm?: {rx: number; ry: number}};
export type HandPose = {
  pos: P; // centre of the cuff, canvas space
  rot: number; // degrees; 0 = the fingers lobe points up, clockwise positive
  flip?: boolean; // mirror: puts the thumb clockwise of the fingers instead of counter-clockwise
  s?: number;
  shape: HandShape;
};

/**
 * The target's hands are fat mittens: palm + a big forward lobe + a thumb lobe held apart from it (a soft V) + a low knuckle bump,
 * fused into one soft shape, on a short orange cylinder cuff. Hero-pixel units at s = 1.
 */
export const SHAPES: Record<'open' | 'point' | 'fist' | 'spread', HandShape> = {
  open: {lobes: [{a: -64, L: 118, w: 46}, {a: 56, L: 80, w: 52}, {a: 8, L: 124, w: 62}]},
  point: {lobes: [{a: -60, L: 94, w: 46}, {a: 50, L: 72, w: 52}, {a: 4, L: 150, w: 38}]},
  fist: {lobes: [{a: -50, L: 76, w: 48}, {a: 46, L: 70, w: 54}, {a: 4, L: 86, w: 70}]},
  spread: {lobes: [{a: -84, L: 106, w: 48}, {a: 66, L: 96, w: 52}, {a: 4, L: 124, w: 58}]},
};

const PALM = {cy: -50, rx: 56, ry: 52};

/** Ivory mitten on an orange cylinder cuff. Layers: `<name>-cuff`, `<name>-glove`. */
export const Hand: React.FC<{uid: string; name: string; pose: HandPose}> = ({uid, name, pose}) => {
  const {pos, rot, flip, s = 1, shape} = pose;
  const id = `${uid}-${name}`;
  const sx = flip ? -s : s;
  // The key light is fixed in the canvas (up and to the left); express its direction in this rotated, mirrored, scaled frame.
  const loc = (gx: number, gy: number): P => {
    const r = (-rot * Math.PI) / 180;
    return [(gx * Math.cos(r) - gy * Math.sin(r)) / sx, (gx * Math.sin(r) + gy * Math.cos(r)) / s];
  };
  const a0 = loc(-110, -140);
  const a1 = loc(100, 130);
  const hi = loc(-20, -28);
  const shade = loc(7, 9);
  const palm = shape.palm ?? {rx: PALM.rx, ry: PALM.ry};
  return (
    <g data-layer={name} transform={`translate(${pos[0]} ${pos[1]}) rotate(${rot}) scale(${sx} ${s})`}>
      <defs>
        <linearGradient id={`${id}-gl`} gradientUnits="userSpaceOnUse" x1={a0[0]} y1={a0[1] - 44} x2={a1[0]} y2={a1[1] - 44}>
          <stop offset={0} stopColor={COLOR.glove0} />
          <stop offset={0.5} stopColor={COLOR.glove1} />
          <stop offset={1} stopColor={COLOR.glove2} />
        </linearGradient>
        <linearGradient id={`${id}-cf`} gradientUnits="userSpaceOnUse" x1={a0[0]} y1={a0[1]} x2={a1[0]} y2={a1[1]}>
          <stop offset={0} stopColor="#F08B4C" />
          <stop offset={0.5} stopColor={COLOR.cuff1} />
          <stop offset={1} stopColor={COLOR.cuff2} />
        </linearGradient>
        <filter id={`${id}-goo`} x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="7" />
          <feColorMatrix type="matrix" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 22 -9.5" />
        </filter>
        <filter id={`${id}-bl`} x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur stdDeviation="6" />
        </filter>
        <mask id={`${id}-m`} maskUnits="userSpaceOnUse" x={-220} y={-260} width={440} height={340}>
          <g filter={`url(#${id}-goo)`}>
            <ellipse cx={0} cy={PALM.cy} rx={palm.rx} ry={palm.ry} fill="#fff" />
            {shape.lobes.map((lb, i) => (
              <g key={i} transform={`translate(0 ${PALM.cy}) rotate(${lb.a})`}>
                <rect x={-lb.w / 2} y={-lb.L} width={lb.w} height={lb.L + 20} rx={lb.w / 2} fill="#fff" />
              </g>
            ))}
          </g>
        </mask>
        <clipPath id={`${id}-cyl`}>
          <path d="M -66 0 L -66 24 A 66 30 0 0 0 66 24 L 66 0 Z" />
        </clipPath>
      </defs>

      <g data-layer={`${name}-cuff`}>
        <path d="M -66 0 L -66 24 A 66 30 0 0 0 66 24 L 66 0 Z" fill={`url(#${id}-cf)`} />
        <ellipse cx={0} cy={0} rx={66} ry={30} fill={`url(#${id}-cf)`} />
        <g clipPath={`url(#${id}-cyl)`}>
          <rect x={-70} y={6} width={140} height={60} fill="#7a2c0e" opacity={0.28} filter={`url(#${id}-bl)`} />
        </g>
      </g>

      <g data-layer={`${name}-glove`}>
        {/* a darker copy of the shape offset away from the key light gives a crisp shadow-side edge */}
        <g transform={`translate(${shade[0]} ${shade[1]})`}>
          <g mask={`url(#${id}-m)`}>
            <rect x={-220} y={-260} width={440} height={340} fill="#CDAE8C" />
          </g>
        </g>
        <g mask={`url(#${id}-m)`}>
          <rect x={-220} y={-260} width={440} height={340} fill={`url(#${id}-gl)`} />
          <ellipse cx={hi[0] * 1.4} cy={-60 + hi[1] * 1.6} rx={64} ry={46} fill="#fff" opacity={0.4} filter={`url(#${id}-bl)`} />
        </g>
      </g>
    </g>
  );
};
