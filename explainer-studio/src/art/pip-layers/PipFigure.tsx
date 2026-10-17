import React from 'react';
import {BODY_PTS, COLOR, HERO_CTR, SEAM_PTS, smoothClosed, smoothOpen} from './geometry';
import type {P} from './geometry';
import {Hand, type HandPose} from './Hand';

export type Eye = {c: P; rx: number; ry: number; rot: number; lid: number; hi: [number, number, number]};
export type BrowShape = {p0: P; p1: P; p2: P; w: number};
export type MouthShape = {p0: P; p1: P; p2: P; w: number; open?: {c: P; rx: number; ry: number}};
export type FaceShape = {eyeL: Eye; eyeR: Eye; browL: BrowShape; browR: BrowShape; mouth: MouthShape};
export type Place = {c: P; sx: number; sy: number};
export type FigureSpec = {
  place: Place;
  face: FaceShape;
  hands: {name: string; pose: HandPose}[];
  shadow: {c: P; rx: number; ry: number; o: number};
  fx?: {x: number; y: number; a: number; l: number}[];
};

const BODY_D = smoothClosed(BODY_PTS);
const SEAM_D = smoothOpen(SEAM_PTS);
const SHELL_D = `${SEAM_D} L 0 ${SEAM_PTS[SEAM_PTS.length - 1][1]} L 0 ${SEAM_PTS[0][1]} Z`;

const quad = (a: P, b: P, c: P, t: number): P => [(1 - t) * (1 - t) * a[0] + 2 * (1 - t) * t * b[0] + t * t * c[0], (1 - t) * (1 - t) * a[1] + 2 * (1 - t) * t * b[1] + t * t * c[1]];

/** A brow is a stroke that is thickest in the middle and fades at both ends. */
const BrowLayer: React.FC<{name: string; b: BrowShape}> = ({name, b}) => {
  const N = 18;
  const L: string[] = [];
  const Rr: string[] = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const p = quad(b.p0, b.p1, b.p2, t);
    const q = quad(b.p0, b.p1, b.p2, Math.min(1, t + 0.01));
    const q0 = quad(b.p0, b.p1, b.p2, Math.max(0, t - 0.01));
    const dx = q[0] - q0[0];
    const dy = q[1] - q0[1];
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    const half = (b.w / 2) * (0.22 + 0.78 * Math.pow(Math.sin(Math.PI * t), 0.7));
    L.push(`${(p[0] + nx * half).toFixed(1)} ${(p[1] + ny * half).toFixed(1)}`);
    Rr.unshift(`${(p[0] - nx * half).toFixed(1)} ${(p[1] - ny * half).toFixed(1)}`);
  }
  return <path data-layer={name} d={`M ${L.join(' L ')} L ${Rr.join(' L ')} Z`} fill={COLOR.ink} stroke={COLOR.ink} strokeWidth={2} strokeLinejoin="round" />;
};

const EyeLayer: React.FC<{uid: string; name: string; e: Eye}> = ({uid, name, e}) => {
  const id = `${uid}-${name}`;
  const cut = e.c[1] - e.ry + 2 * e.ry * e.lid;
  return (
    <g data-layer={name} transform={`rotate(${e.rot} ${e.c[0]} ${e.c[1]})`}>
      <clipPath id={`${id}-lid`}>
        <rect x={e.c[0] - e.rx - 4} y={cut} width={e.rx * 2 + 8} height={e.ry * 2 + 8} />
      </clipPath>
      <g clipPath={`url(#${id}-lid)`}>
        <ellipse cx={e.c[0]} cy={e.c[1]} rx={e.rx} ry={e.ry} fill={COLOR.ink} />
      </g>
      <ellipse data-layer={`${name}-highlight`} cx={e.c[0] + e.hi[0]} cy={Math.max(e.c[1] + e.hi[1], cut + e.hi[2] * 1.3)} rx={e.hi[2]} ry={e.hi[2] * 1.12} fill={COLOR.inkHi} />
    </g>
  );
};

const MouthLayer: React.FC<{m: MouthShape}> = ({m}) => (
  <g data-layer="mouth">
    {m.open ? (
      <ellipse cx={m.open.c[0]} cy={m.open.c[1]} rx={m.open.rx} ry={m.open.ry} fill={COLOR.ink} />
    ) : (
      <path d={`M ${m.p0[0]} ${m.p0[1]} Q ${m.p1[0]} ${m.p1[1]} ${m.p2[0]} ${m.p2[1]}`} stroke={COLOR.ink} strokeWidth={m.w} strokeLinecap="round" fill="none" />
    )}
  </g>
);

/** Layered Pip figure. Group names (`data-layer`): ground-shadow, body-ivory, shell-orange, seam, face (eye-l, eye-r, brow-l, brow-r, mouth), hand-l, hand-r. */
export const PipFigure: React.FC<{spec: FigureSpec; uid: string}> = ({spec, uid}) => {
  const {place, face, hands, shadow, fx} = spec;
  const tf = `translate(${place.c[0]} ${place.c[1]}) scale(${place.sx} ${place.sy}) translate(${-HERO_CTR[0]} ${-HERO_CTR[1]})`;
  return (
    <g>
      <defs>
        <filter id={`${uid}-bl`} x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="22" />
        </filter>
        <filter id={`${uid}-bm`} x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="10" />
        </filter>
        <filter id={`${uid}-bs`} x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="2.2" />
        </filter>
        <filter id={`${uid}-sh`} x="-30%" y="-100%" width="160%" height="300%">
          <feGaussianBlur stdDeviation="14" />
        </filter>
        <linearGradient id={`${uid}-iv`} gradientUnits="userSpaceOnUse" x1={420} y1={140} x2={820} y2={850}>
          <stop offset={0} stopColor={COLOR.ivory0} />
          <stop offset={0.55} stopColor={COLOR.ivory1} />
          <stop offset={1} stopColor={COLOR.ivory2} />
        </linearGradient>
        <linearGradient id={`${uid}-ivb`} gradientUnits="userSpaceOnUse" x1={0} y1={640} x2={0} y2={852}>
          <stop offset={0} stopColor={COLOR.ivory3} stopOpacity={0} />
          <stop offset={1} stopColor={COLOR.ivory3} stopOpacity={0.9} />
        </linearGradient>
        <linearGradient id={`${uid}-sh1`} gradientUnits="userSpaceOnUse" x1={300} y1={160} x2={420} y2={850}>
          <stop offset={0} stopColor={COLOR.shell0} />
          <stop offset={0.5} stopColor={COLOR.shell1} />
          <stop offset={1} stopColor={COLOR.shell2} />
        </linearGradient>
        <clipPath id={`${uid}-body`}>
          <path d={BODY_D} />
        </clipPath>
      </defs>

      <ellipse data-layer="ground-shadow" cx={shadow.c[0]} cy={shadow.c[1]} rx={shadow.rx} ry={shadow.ry} fill="#5b5e66" opacity={shadow.o} filter={`url(#${uid}-sh)`} />

      <g transform={tf}>
        <g clipPath={`url(#${uid}-body)`}>
          <g data-layer="body-ivory">
            <path d={BODY_D} fill={`url(#${uid}-iv)`} />
            <path d={BODY_D} fill={`url(#${uid}-ivb)`} />
            <ellipse cx={640} cy={250} rx={230} ry={90} fill="#FFFFFF" opacity={0.4} filter={`url(#${uid}-bl)`} />
            <path d={BODY_D} fill="none" stroke={COLOR.ivoryEdge} strokeWidth={26} opacity={0.5} filter={`url(#${uid}-bm)`} />
          </g>
          <g data-layer="shell-orange">
            <path d={SHELL_D} fill={`url(#${uid}-sh1)`} />
            <ellipse cx={330} cy={290} rx={90} ry={150} fill="#F9AA72" opacity={0.34} filter={`url(#${uid}-bl)`} />
          </g>
          <g data-layer="seam">
            <path d={SEAM_D} stroke="#7a5a3c" strokeWidth={34} fill="none" opacity={0.2} filter={`url(#${uid}-bm)`} transform="translate(16 0)" />
            <path d={SEAM_D} stroke={COLOR.seam} strokeWidth={8} fill="none" />
            <path d={SEAM_D} stroke={COLOR.seamHi} strokeWidth={2.6} fill="none" opacity={0.7} transform="translate(-6 0)" filter={`url(#${uid}-bs)`} />
          </g>
        </g>

        <g data-layer="face">
          <BrowLayer name="brow-l" b={face.browL} />
          <BrowLayer name="brow-r" b={face.browR} />
          <EyeLayer uid={uid} name="eye-l" e={face.eyeL} />
          <EyeLayer uid={uid} name="eye-r" e={face.eyeR} />
          <MouthLayer m={face.mouth} />
        </g>
      </g>

      {fx ? (
        <g data-layer="fx">
          {fx.map((s, i) => (
            <line key={i} x1={s.x} y1={s.y} x2={s.x + Math.cos((s.a * Math.PI) / 180) * s.l} y2={s.y + Math.sin((s.a * Math.PI) / 180) * s.l} stroke={COLOR.cuff1} strokeWidth={9} strokeLinecap="round" />
          ))}
        </g>
      ) : null}

      {hands.map((h) => (
        <Hand key={h.name} uid={uid} name={h.name} pose={h.pose} />
      ))}
    </g>
  );
};
