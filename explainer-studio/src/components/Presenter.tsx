import React from 'react';
import {C} from '../theme';
import {clamp01, easeInOut, lerp} from '../anim';

type Pose = {
  eyeOpen: number; // 1 = normal
  eyeX: number; // gaze shift
  browY: number; // negative = raised
  browL: number; // degrees; positive tilts the inner end down (angry), negative up (worried)
  browR: number;
  smile: number; // -1 frown .. 1 smile
  mouthW: number;
  mouthRest: number; // resting mouth opening
  arm: number; // right arm angle, degrees (0 hangs, -140 points up-right)
  tilt: number; // head tilt, degrees
};

const POSES: Record<string, Pose> = {
  neutral: {eyeOpen: 1, eyeX: 0, browY: 0, browL: 0, browR: 0, smile: 0.25, mouthW: 1, mouthRest: 0, arm: 8, tilt: 0},
  thinking: {eyeOpen: 0.9, eyeX: 5, browY: -2, browL: 0, browR: -14, smile: -0.05, mouthW: 0.8, mouthRest: 0, arm: 8, tilt: 6},
  surprised: {eyeOpen: 1.3, eyeX: 0, browY: -9, browL: -6, browR: 6, smile: 0, mouthW: 0.55, mouthRest: 0.55, arm: 24, tilt: -3},
  happy: {eyeOpen: 0.72, eyeX: 0, browY: -4, browL: -4, browR: 4, smile: 1, mouthW: 1.05, mouthRest: 0, arm: 8, tilt: -2},
  concerned: {eyeOpen: 1, eyeX: -2, browY: 0, browL: -16, browR: 16, smile: -0.8, mouthW: 0.85, mouthRest: 0, arm: 6, tilt: 3},
  pointing: {eyeOpen: 1, eyeX: 3, browY: -2, browL: 0, browR: 0, smile: 0.5, mouthW: 1, mouthRest: 0, arm: -138, tilt: -3},
};

const mix = (a: Pose, b: Pose, t: number): Pose =>
  Object.fromEntries((Object.keys(a) as (keyof Pose)[]).map((k) => [k, lerp(a[k], b[k], t)])) as Pose;

export type PresenterProps = {
  t: number; // seconds
  expression: string;
  prevExpression: string;
  expressionSince: number; // seconds since the current expression started
  mouth: number; // 0..1 openness driven by narration words
  width?: number;
};

/** Original placeholder robot. Swap this component to change the presenter; the props are the contract. */
export const Presenter: React.FC<PresenterProps> = ({t, expression, prevExpression, expressionSince, mouth, width = 200}) => {
  const blend = easeInOut(clamp01(expressionSince / 0.28));
  const pose = mix(POSES[prevExpression] ?? POSES.neutral, POSES[expression] ?? POSES.neutral, blend);

  const bob = Math.sin(t * 2.1) * 2.5;
  const blinkPhase = (t % 3.4) / 0.14;
  const eyeH = 26 * pose.eyeOpen * (blinkPhase < 1 ? Math.max(0.08, 1 - Math.sin(blinkPhase * Math.PI)) : 1);
  const open = Math.max(pose.mouthRest, mouth);
  const mw = 16 * pose.mouthW;
  const my = 136;
  const curve = pose.smile * 9;
  const mouthPath = `M ${100 - mw} ${my} Q 100 ${my + curve - open * 2} ${100 + mw} ${my} Q 100 ${my + curve + 2 + open * 15} ${100 - mw} ${my} Z`;
  const antennaGlow = 0.55 + 0.45 * Math.sin(t * 3.2);

  return (
    <svg width={width} height={(width * 340) / 200} viewBox="0 0 200 340" style={{overflow: 'visible'}}>
      <defs>
        <linearGradient id="rbHead" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#e6edf8" />
          <stop offset="1" stopColor="#b3c2d9" />
        </linearGradient>
        <linearGradient id="rbBody" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#6c84a6" />
          <stop offset="1" stopColor="#465b7a" />
        </linearGradient>
        <radialGradient id="rbGlow">
          <stop offset="0" stopColor={C.accent} stopOpacity="0.9" />
          <stop offset="1" stopColor={C.accent} stopOpacity="0" />
        </radialGradient>
      </defs>
      <ellipse cx="100" cy="328" rx="62" ry="8" fill="#000" opacity="0.35" />
      <g transform={`translate(0 ${bob * 0.4})`}>
        {/* legs */}
        <rect x="72" y="262" width="20" height="46" rx="8" fill="#3b4d68" />
        <rect x="108" y="262" width="20" height="46" rx="8" fill="#3b4d68" />
        <ellipse cx="80" cy="310" rx="19" ry="9" fill="#d3deed" />
        <ellipse cx="120" cy="310" rx="19" ry="9" fill="#d3deed" />
        {/* left arm (hangs) */}
        <g transform={`rotate(-6 52 192)`}>
          <rect x="42" y="186" width="18" height="64" rx="9" fill="#aebdd4" />
          <circle cx="51" cy="254" r="11" fill="#d3deed" />
        </g>
        {/* torso */}
        <rect x="52" y="172" width="96" height="98" rx="26" fill="url(#rbBody)" />
        <rect x="72" y="196" width="56" height="40" rx="12" fill="#0f1a2b" opacity="0.85" />
        <circle cx="86" cy="216" r="5" fill={C.accent} opacity={0.6 + 0.4 * Math.sin(t * 3.2)} />
        <rect x="98" y="211" width="22" height="4" rx="2" fill={C.accent} opacity="0.55" />
        <rect x="98" y="219" width="14" height="4" rx="2" fill={C.muted} opacity="0.6" />
        {/* right arm (gesture) */}
        <g transform={`rotate(${pose.arm} 146 194)`}>
          <rect x="137" y="188" width="18" height="64" rx="9" fill="#aebdd4" />
          <circle cx="146" cy="256" r="11" fill="#d3deed" />
        </g>
      </g>
      {/* head */}
      <g transform={`translate(0 ${bob}) rotate(${pose.tilt} 100 140)`}>
        <rect x="93" y="30" width="14" height="30" rx="5" fill="#8fa2bf" />
        <circle cx="100" cy="26" r="20" fill="url(#rbGlow)" opacity={antennaGlow} />
        <circle cx="100" cy="26" r="9" fill={C.accent} />
        <circle cx="22" cy="118" r="11" fill="#8fa2bf" />
        <circle cx="178" cy="118" r="11" fill="#8fa2bf" />
        <rect x="30" y="58" width="140" height="116" rx="34" fill="url(#rbHead)" />
        <rect x="44" y="74" width="112" height="82" rx="24" fill="#0b1220" stroke="#22344d" strokeWidth="2" />
        {/* brows */}
        <g stroke={C.accent} strokeWidth="5" strokeLinecap="round" opacity="0.9">
          <line x1="63" y1={91 + pose.browY} x2="91" y2={91 + pose.browY} transform={`rotate(${pose.browL} 77 ${91 + pose.browY})`} />
          <line x1="109" y1={91 + pose.browY} x2="137" y2={91 + pose.browY} transform={`rotate(${-pose.browR} 123 ${91 + pose.browY})`} />
        </g>
        {/* eyes */}
        <rect x={68 + pose.eyeX} y={118 - eyeH / 2 + 2} width="20" height={eyeH} rx="9" fill={C.accent} />
        <rect x={112 + pose.eyeX} y={118 - eyeH / 2 + 2} width="20" height={eyeH} rx="9" fill={C.accent} />
        {/* mouth */}
        <path d={mouthPath} fill={open > 0.08 ? C.accent : 'none'} fillOpacity="0.9" stroke={C.accent} strokeWidth="4" strokeLinejoin="round" strokeLinecap="round" />
      </g>
    </svg>
  );
};
