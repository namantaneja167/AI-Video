import React from 'react';
import {AbsoluteFill} from 'remotion';
import {P, SANS, MONO} from '../palette';
import {Backdrop, Caption, Header, Slab} from '../parts';
import {Pip, K, type ExprName} from './Pip';

const PANEL = {x: 80, y: 150, w: 920, h: 610};
// Pip is drawn in a 400-unit space; 1.6× makes the body ~23% of the frame width so the face survives a feed thumbnail.
const PIP = {scale: 1.6, left: 30, top: 780};
const CROP: [number, number, number, number] = [0, 170, 400, 410];

const Bar: React.FC<{label: string; w: number; color: string; strong?: boolean}> = ({label, w, color, strong}) => (
  <div style={{display: 'flex', alignItems: 'center', gap: 20}}>
    <div style={{width: 170, fontFamily: MONO, fontSize: 28, fontWeight: 700, color: strong ? K.or : P.muted}}>{label}</div>
    <div style={{height: 28, width: w, borderRadius: 14, background: color}} />
  </div>
);

/** Phone-format example: a launch claim with its fine print, and Pip reacting to it. Fictional product. */
export const PipScene: React.FC<{expr?: ExprName; caption?: [string, string]}> = ({expr = 'skeptical', caption = ['10× faster…', 'than what?']}) => (
  <AbsoluteFill style={{fontFamily: SANS, color: P.ink, overflow: 'hidden', background: P.cream}}>
    <Backdrop />
    <Slab x={PANEL.x} y={PANEL.y} w={PANEL.w} h={PANEL.h} thickness={12} radius={30}>
      <Header title="nimbus-one · launch" />
      <div style={{padding: '18px 44px 0'}}>
        <div style={{fontFamily: MONO, fontSize: 24, fontWeight: 700, color: P.muted, letterSpacing: '0.12em'}}>AI ASSISTANT · V1</div>
        <div style={{display: 'flex', alignItems: 'flex-start', gap: 6, marginTop: 2}}>
          <div style={{fontSize: 200, fontWeight: 800, letterSpacing: '-0.05em', lineHeight: '190px'}}>10×</div>
          <div style={{fontSize: 110, fontWeight: 800, color: K.or, lineHeight: '124px'}}>*</div>
        </div>
        <div style={{fontSize: 42, fontWeight: 700, color: P.ink2, marginTop: 0}}>faster responses</div>
        <div style={{marginTop: 22, display: 'flex', flexDirection: 'column', gap: 12}}>
          <Bar label="last gen" w={70} color="#C9C0AD" />
          <Bar label="nimbus" w={560} color={K.or} strong />
        </div>
        <div style={{marginTop: 22, borderTop: `3px dashed ${P.line}`, paddingTop: 14, fontFamily: MONO, fontSize: 27, fontWeight: 600, color: P.muted}}>*vs. batch size 1, 8-token prompts</div>
      </div>
    </Slab>

    <div style={{position: 'absolute', left: PIP.left, top: PIP.top}}>
      <Pip expr={expr} uid="scene" crop={CROP} width={400 * PIP.scale} height={410 * PIP.scale} />
    </div>
    <Caption lit={caption[0]} dim={caption[1]} />
  </AbsoluteFill>
);
