import React from 'react';
import {Brow, C, EXPR, GroundShadow, Hand, LidClip, Matte, PipDefs, Pose, type PipProps} from './shared';

/** A · LEAN — tall asymmetric capsule with an off-axis charcoal cap that overhangs the body; painted-on tall-oval eyes. */
const BODY = 'M 215 128 C 262 128 291 170 289 235 L 287 430 C 287 505 255 548 205 548 C 150 548 114 508 112 440 L 118 250 C 120 175 160 128 215 128 Z';
// The cap sits proud of the body on the left and tips up on the right, so the silhouette itself is asymmetric.
const CAP = 'M 102 196 C 98 134 156 114 218 114 C 276 114 300 146 297 170 C 242 192 168 178 102 196 Z';
const SEAM = 'M 102 196 C 168 178 242 192 297 170';

const HANDS = {
  neutral: {L: {x: 92, y: 410, r: 12}, R: {x: 308, y: 406, r: -12}},
  curious: {L: {x: 90, y: 418, r: 12}, R: {x: 268, y: 336, r: -24}},
  skeptical: {L: {x: 96, y: 406, r: 12}, R: {x: 326, y: 300, r: -34}},
  surprised: {L: {x: 74, y: 270, r: 26}, R: {x: 326, y: 262, r: -26}},
} as const;

export const PipA: React.FC<PipProps & {hands?: boolean; shadow?: boolean}> = ({expr, uid, crop = [0, 0, 400, 600], width = 400, height = 600, hands = true, shadow = true}) => {
  const e = EXPR[expr];
  const h = HANDS[expr];
  const eyes = [
    {id: `${uid}-ela`, cx: 168 + e.gx * 4, cy: 254 + e.gy * 4, rx: 22, ry: 32, lid: e.lidL, tilt: e.lidTilt},
    {id: `${uid}-ela2`, cx: 238 + e.gx * 4, cy: 248 + e.gy * 4, rx: 20, ry: 29, lid: e.lidR, tilt: -e.lidTilt},
  ];
  const my = 318;
  return (
    <svg width={width} height={height} viewBox={crop.join(' ')} style={{overflow: 'visible'}}>
      <PipDefs />
      {shadow ? <GroundShadow cx={204} cy={557} rx={112} /> : null}
      <Pose e={e} ox={200} oy={550}>
        {/* stub feet */}
        <ellipse cx={162} cy={546} rx={27} ry={11} fill={C.or} />
        <ellipse cx={246} cy={548} rx={27} ry={11} fill={C.or} />
        <ellipse cx={162} cy={541} rx={18} ry={4} fill={C.orHi} opacity={0.5} />
        <ellipse cx={246} cy={543} rx={18} ry={4} fill={C.orHi} opacity={0.5} />
        <Matte id={`${uid}-body`} d={BODY} hi={C.ivHi} base={C.iv} sh={C.ivSh} edge="#8d7d62">
          {/* the cap throws a soft shadow onto the body below the seam */}
          <path d={SEAM} stroke="#000" strokeOpacity={0.3} strokeWidth={16} fill="none" filter="url(#pip-soft)" transform="translate(0 12)" />
        </Matte>

        {/* cap: charcoal, tilted a few degrees off the body's axis */}
        <g transform="rotate(-3 200 190)">
          <Matte id={`${uid}-cap`} d={CAP} hi={C.chHi} base={C.ch} sh={C.chSh} edge={C.chSh} />
          <path d={SEAM} stroke={C.orSh} strokeWidth={4} fill="none" strokeLinecap="round" opacity={0.9} transform="translate(0 2)" />
          <path d={SEAM} stroke={C.orHi} strokeWidth={2.2} fill="none" strokeLinecap="round" transform="translate(0 4.6)" opacity={0.85} />
          <circle cx={112} cy={194} r={5} fill={C.or} />
          <circle cx={110.5} cy={192.5} r={2} fill={C.orHi} />
        </g>

        {/* face: painted on, no screen */}
        {eyes.map((k) => (
          <g key={k.id}>
            <LidClip id={k.id} cx={k.cx} cy={k.cy} ry={k.ry * e.open} lid={k.lid} tilt={k.tilt} size={70} />
            <g clipPath={`url(#${k.id})`}>
              <ellipse cx={k.cx} cy={k.cy} rx={k.rx} ry={k.ry * e.open} fill={C.ch} />
              <ellipse cx={k.cx + 7 + e.gx * 4} cy={k.cy - 10 * e.open + e.gy * 4} rx={6.5} ry={8} fill={C.ivHi} opacity={0.95} />
              <circle cx={k.cx - 6 + e.gx * 2} cy={k.cy + 14 * e.open} r={2.6} fill={C.ivHi} opacity={0.6} />
            </g>
          </g>
        ))}
        <Brow cx={166} cy={206} len={54} w={10} color={C.ch} b={e.browL} arc={3} />
        <Brow cx={238} cy={196} len={50} w={10} color={C.ch} b={e.browR} arc={3} />
        {e.mouth === 'neutral' ? <rect x={192} y={my - 4} width={32} height={8} rx={4} fill={C.ch} /> : null}
        {e.mouth === 'o' ? <ellipse cx={208} cy={my} rx={9} ry={11} fill={C.ch} /> : null}
        {e.mouth === 'O' ? <ellipse cx={208} cy={my + 2} rx={14} ry={18} fill={C.ch} /> : null}
        {e.mouth === 'smirk' ? <path d={`M 190 ${my + 4} Q 208 ${my + 8} 226 ${my - 8}`} stroke={C.ch} strokeWidth={8} fill="none" strokeLinecap="round" /> : null}

        {hands ? (
          <>
            <Hand x={h.L.x} y={h.L.y} rot={h.L.r} fill={C.or} shade={C.orSh} hi={C.orHi} line={C.orSh} />
            <Hand x={h.R.x} y={h.R.y} rot={h.R.r} flip fill={C.or} shade={C.orSh} hi={C.orHi} line={C.orSh} />
          </>
        ) : null}
      </Pose>
    </svg>
  );
};
