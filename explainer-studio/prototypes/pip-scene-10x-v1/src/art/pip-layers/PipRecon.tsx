import React from 'react';
import {AbsoluteFill} from 'remotion';
import {COLOR} from './geometry';
import {PipFigure} from './PipFigure';
import {CURIOUS, HERO, SKEPTICAL, SURPRISED} from './views';

export const REF_W = 1536;
export const REF_H = 1024;

/** The reconstruction laid out exactly like the target image (same canvas size, same positions). `bg=false` gives a transparent background for measuring. */
export const PipRecon: React.FC<{bg?: boolean}> = ({bg = true}) => (
  <AbsoluteFill style={{background: bg ? `radial-gradient(ellipse at 50% 40%, #DEE0E3 0%, ${COLOR.bg} 60%, #D5D8DC 100%)` : 'transparent'}}>
    <svg width={REF_W} height={REF_H} viewBox={`0 0 ${REF_W} ${REF_H}`} style={{position: 'absolute', left: 0, top: 0}}>
      <PipFigure uid="hero" spec={HERO} />
      <PipFigure uid="cur" spec={CURIOUS} />
      <PipFigure uid="ske" spec={SKEPTICAL} />
      <PipFigure uid="sur" spec={SURPRISED} />
    </svg>
  </AbsoluteFill>
);
