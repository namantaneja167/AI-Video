import React from 'react';
import {Brow, C, EXPR, GroundShadow, Hand, Matte, PipDefs, Pose, type PipProps} from './shared';

/** C · GOURD — two-lobed capsule: big ivory head, charcoal body, orange waist seam, cartoon eyes with a monocle ring. Hovers. */
const BODY = 'M 190 124 C 268 120 304 178 298 238 C 294 286 276 312 276 342 C 276 366 292 396 290 452 C 288 510 252 536 198 536 C 144 536 112 508 112 452 C 111 396 124 366 124 340 C 124 310 100 288 96 238 C 92 174 128 128 190 124 Z';
const SEAM = 'M 60 338 C 130 356 224 356 340 334';
const LOWER = `${SEAM} L 330 620 L 70 620 Z`;

const HANDS = {
  neutral: {L: {x: 92, y: 426, r: 10}, R: {x: 308, y: 424, r: -10}},
  curious: {L: {x: 92, y: 432, r: 10}, R: {x: 282, y: 350, r: -24}},
  skeptical: {L: {x: 94, y: 432, r: 10}, R: {x: 326, y: 300, r: -36}},
  surprised: {L: {x: 66, y: 262, r: 28}, R: {x: 334, y: 256, r: -28}},
} as const;

const Eye: React.FC<{id: string; cx: number; cy: number; r: number; open: number; lid: number; tilt: number; gx: number; gy: number}> = ({id, cx, cy, r, open, lid, tilt, gx, gy}) => {
  const ry = r * open;
  const lidY = cy - ry + 2 * ry * lid;
  return (
    <g>
      <clipPath id={id}>
        <rect x={cx - r - 4} y={lidY} width={2 * r + 8} height={2 * r + 8} transform={`rotate(${tilt} ${cx} ${lidY})`} />
      </clipPath>
      <ellipse cx={cx} cy={cy} rx={r} ry={ry} fill={C.iv} stroke={C.ch} strokeWidth={5} />
      <g clipPath={`url(#${id})`}>
        <ellipse cx={cx} cy={cy} rx={r - 2} ry={ry - 2} fill={C.ivHi} />
        <circle cx={cx + gx * 9} cy={cy + gy * 9} r={r * 0.46} fill={C.ch} />
        <circle cx={cx + gx * 9 + 5} cy={cy + gy * 9 - 6} r={r * 0.15} fill={C.ivHi} />
      </g>
      {/* lid edge across the eye */}
      <line x1={cx - r} y1={lidY} x2={cx + r} y2={lidY} stroke={C.ch} strokeWidth={5} strokeLinecap="round" transform={`rotate(${tilt} ${cx} ${lidY})`} opacity={lid > 0.04 ? 1 : 0} />
    </g>
  );
};

export const PipC: React.FC<PipProps & {hands?: boolean; shadow?: boolean}> = ({expr, uid, crop = [0, 0, 400, 600], width = 400, height = 600, hands = true, shadow = true}) => {
  const e = EXPR[expr];
  const h = HANDS[expr];
  const my = 296;
  return (
    <svg width={width} height={height} viewBox={crop.join(' ')} style={{overflow: 'visible'}}>
      <PipDefs />
      {shadow ? <GroundShadow cx={200} cy={560} rx={92} o={0.22} /> : null}
      <Pose e={e} ox={200} oy={550}>
        <Matte id={`${uid}-body`} d={BODY} hi={C.ivHi} base={C.iv} sh={C.ivSh} edge="#8d7d62">
          <defs>
            <linearGradient id={`${uid}-ch`} x1="0.1" y1="0" x2="0.9" y2="1">
              <stop offset="0" stopColor={C.chHi} />
              <stop offset="0.5" stopColor={C.ch} />
              <stop offset="1" stopColor={C.chSh} />
            </linearGradient>
          </defs>
          <path d={LOWER} fill={`url(#${uid}-ch)`} />
          <path d={SEAM} stroke="#000" strokeOpacity={0.3} strokeWidth={10} fill="none" filter="url(#pip-soft)" transform="translate(0 -5)" />
        </Matte>
        {/* orange inlay seam around the waist, drawn inside the body so it cannot overhang */}
        <clipPath id={`${uid}-bclip`}>
          <path d={BODY} />
        </clipPath>
        <g clipPath={`url(#${uid}-bclip)`}>
          <path d={SEAM} stroke={C.orSh} strokeWidth={15} fill="none" />
          <path d={SEAM} stroke={C.or} strokeWidth={11} fill="none" />
          <path d={SEAM} stroke={C.orHi} strokeWidth={3} fill="none" transform="translate(0 -3)" opacity={0.8} />
        </g>

        {/* monocle chain from the ring to the waist */}
        {[0, 1, 2, 3, 4, 5].map((i) => {
          const t = (i + 1) / 7;
          const x = (1 - t) * (1 - t) * 262 + 2 * (1 - t) * t * 312 + t * t * 288;
          const y = (1 - t) * (1 - t) * 248 + 2 * (1 - t) * t * 306 + t * t * 340;
          return <circle key={i} cx={x} cy={y} r={3.4} fill="none" stroke={C.ch} strokeWidth={2.4} />;
        })}

        <Eye id={`${uid}-ela`} cx={156} cy={226} r={34} open={e.open} lid={e.lidL} tilt={e.lidTilt} gx={e.gx} gy={e.gy} />
        <Eye id={`${uid}-ela2`} cx={240} cy={220} r={29} open={e.open} lid={e.lidR} tilt={-e.lidTilt} gx={e.gx} gy={e.gy} />
        <circle cx={240} cy={220} r={33 * Math.max(1, e.open * 0.96)} fill="none" stroke={C.orSh} strokeWidth={10} />
        <circle cx={240} cy={220} r={33 * Math.max(1, e.open * 0.96)} fill="none" stroke={C.or} strokeWidth={7} />
        <Brow cx={156} cy={170} len={56} w={12} color={C.or} b={e.browL} arc={3} />
        <Brow cx={242} cy={160} len={52} w={12} color={C.or} b={e.browR} arc={3} />
        {e.mouth === 'neutral' ? <rect x={196} y={my - 4} width={28} height={8} rx={4} fill={C.ch} /> : null}
        {e.mouth === 'o' ? <circle cx={210} cy={my} r={9} fill={C.ch} /> : null}
        {e.mouth === 'O' ? <ellipse cx={210} cy={my + 2} rx={12} ry={16} fill={C.ch} /> : null}
        {e.mouth === 'smirk' ? <path d={`M 192 ${my + 4} Q 210 ${my + 8} 228 ${my - 8}`} stroke={C.ch} strokeWidth={8} fill="none" strokeLinecap="round" /> : null}

        {hands ? (
          <>
            <Hand x={h.L.x} y={h.L.y} rot={h.L.r} fill={C.iv} shade={C.ivSh} hi={C.ivHi} line="#8d7d62" />
            <Hand x={h.R.x} y={h.R.y} rot={h.R.r} flip fill={C.iv} shade={C.ivSh} hi={C.ivHi} line="#8d7d62" />
          </>
        ) : null}
      </Pose>
    </svg>
  );
};
