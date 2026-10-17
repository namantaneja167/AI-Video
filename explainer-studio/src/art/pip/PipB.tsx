import React from 'react';
import {Brow, C, EXPR, GroundShadow, Hand, LidClip, Matte, PipDefs, Pose, type PipProps} from './shared';

/** B · PEBBLE — low off-balance bean, charcoal face window, orange side shell, lanyard loop and top button. */
const BODY = 'M 206 236 C 296 228 338 296 333 404 C 329 500 277 550 196 550 C 108 550 58 492 62 392 C 66 296 116 242 206 236 Z';
const SEAM = 'M 150 238 C 126 330 144 450 132 552';
const SHELL = `${SEAM} L 20 620 L 20 180 Z`;
const WIN = {x: 154, y: 290, w: 158, h: 142};

const HANDS = {
  neutral: {L: {x: 44, y: 474, r: 8}, R: {x: 354, y: 470, r: -8}},
  curious: {L: {x: 44, y: 474, r: 8}, R: {x: 332, y: 392, r: -26}},
  skeptical: {L: {x: 48, y: 470, r: 8}, R: {x: 356, y: 352, r: -38}},
  surprised: {L: {x: 38, y: 360, r: 28}, R: {x: 362, y: 356, r: -28}},
} as const;

export const PipB: React.FC<PipProps & {hands?: boolean; shadow?: boolean}> = ({expr, uid, crop = [0, 0, 400, 600], width = 400, height = 600, hands = true, shadow = true}) => {
  const e = EXPR[expr];
  const h = HANDS[expr];
  const eyes = [
    {id: `${uid}-ela`, cx: 193 + e.gx * 4, cy: 362 + e.gy * 4, rx: 19, ry: 27, lid: e.lidL, tilt: e.lidTilt},
    {id: `${uid}-ela2`, cx: 271 + e.gx * 4, cy: 358 + e.gy * 4, rx: 19, ry: 27, lid: e.lidR, tilt: -e.lidTilt},
  ];
  const my = 410;
  return (
    <svg width={width} height={height} viewBox={crop.join(' ')} style={{overflow: 'visible'}}>
      <PipDefs />
      {shadow ? <GroundShadow cx={200} cy={557} rx={150} /> : null}
      <Pose e={e} ox={200} oy={550}>
        {/* lanyard loop sits behind the body on the right */}
        <path d="M 322 452 C 378 438 384 512 322 500" stroke={C.ch} strokeWidth={11} fill="none" strokeLinecap="round" />
        <path d="M 322 452 C 378 438 384 512 322 500" stroke={C.chHi} strokeWidth={3} fill="none" strokeLinecap="round" transform="translate(-2 -2)" opacity={0.7} />
        <ellipse cx={134} cy={548} rx={32} ry={12} fill={C.ch} />
        <ellipse cx={262} cy={548} rx={32} ry={12} fill={C.ch} />
        <Matte id={`${uid}-body`} d={BODY} hi={C.ivHi} base={C.iv} sh={C.ivSh} edge="#8d7d62">
          <defs>
            <linearGradient id={`${uid}-or`} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor={C.orHi} />
              <stop offset="0.5" stopColor={C.or} />
              <stop offset="1" stopColor={C.orSh} />
            </linearGradient>
          </defs>
          <path d={SHELL} fill={`url(#${uid}-or)`} />
          <path d={SEAM} stroke="#000" strokeOpacity={0.3} strokeWidth={10} fill="none" filter="url(#pip-soft)" transform="translate(7 0)" />
        </Matte>
        <path d={SEAM} stroke={C.orSh} strokeWidth={4} fill="none" strokeLinecap="round" opacity={0.85} />
        <path d={SEAM} stroke={C.ivHi} strokeWidth={2.4} fill="none" strokeLinecap="round" transform="translate(3.2 0)" opacity={0.9} />

        {/* top button, off-centre */}
        <ellipse cx={278} cy={243} rx={24} ry={9} fill={C.orSh} transform="rotate(-8 278 243)" />
        <ellipse cx={278} cy={239} rx={22} ry={8.5} fill={C.or} transform="rotate(-8 278 239)" />
        <ellipse cx={272} cy={236.5} rx={11} ry={3} fill={C.orHi} opacity={0.7} transform="rotate(-8 272 237)" />

        {/* face window */}
        <defs>
          <linearGradient id={`${uid}-win`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={C.chSh} />
            <stop offset="0.35" stopColor={C.ch} />
            <stop offset="1" stopColor={C.chHi} />
          </linearGradient>
        </defs>
        <rect x={WIN.x} y={WIN.y} width={WIN.w} height={WIN.h} rx={48} fill={`url(#${uid}-win)`} />
        <rect x={WIN.x + 1.5} y={WIN.y + 1.5} width={WIN.w - 3} height={WIN.h - 3} rx={46.5} fill="none" stroke={C.ivHi} strokeOpacity={0.14} strokeWidth={3} />
        {eyes.map((k) => (
          <g key={k.id}>
            <LidClip id={k.id} cx={k.cx} cy={k.cy} ry={k.ry * e.open} lid={k.lid} tilt={k.tilt} size={60} />
            <g clipPath={`url(#${k.id})`}>
              <ellipse cx={k.cx} cy={k.cy} rx={k.rx} ry={k.ry * e.open} fill={C.ivHi} />
              <circle cx={k.cx + e.gx * 7} cy={k.cy + e.gy * 8} r={10} fill={C.or} />
              <circle cx={k.cx + e.gx * 7 + 3} cy={k.cy + e.gy * 8 - 3} r={3} fill={C.ivHi} />
            </g>
          </g>
        ))}
        <Brow cx={193} cy={326} len={42} w={9} color={C.ivHi} b={e.browL} arc={2} />
        <Brow cx={271} cy={322} len={42} w={9} color={C.ivHi} b={e.browR} arc={2} />
        {e.mouth === 'neutral' ? <rect x={218} y={my - 4} width={30} height={8} rx={4} fill={C.ivHi} /> : null}
        {e.mouth === 'o' ? <ellipse cx={233} cy={my} rx={9} ry={10} fill={C.ivHi} /> : null}
        {e.mouth === 'O' ? <ellipse cx={233} cy={my + 1} rx={12} ry={15} fill={C.ivHi} /> : null}
        {e.mouth === 'smirk' ? <path d={`M 216 ${my + 3} Q 233 ${my + 7} 250 ${my - 8}`} stroke={C.ivHi} strokeWidth={7} fill="none" strokeLinecap="round" /> : null}

        {hands ? (
          <>
            <Hand x={h.L.x} y={h.L.y} rot={h.L.r} fill={C.ch} shade={C.chSh} hi={C.chHi} line={C.chSh} />
            <Hand x={h.R.x} y={h.R.y} rot={h.R.r} flip fill={C.ch} shade={C.chSh} hi={C.chHi} line={C.chSh} />
          </>
        ) : null}
      </Pose>
    </svg>
  );
};
