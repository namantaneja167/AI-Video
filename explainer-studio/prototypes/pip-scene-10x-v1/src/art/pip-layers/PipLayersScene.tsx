import React from 'react';
import {AbsoluteFill} from 'remotion';
import {P, SANS, MONO} from '../palette';
import {Backdrop, Caption, Header, Slab} from '../parts';
import {COLOR} from './geometry';
import {PipFigure} from './PipFigure';
import {HERO, SKEPTICAL} from './views';

const PANEL = {x: 80, y: 150, w: 920, h: 610};

const Bar: React.FC<{label: string; w: number; color: string; strong?: boolean}> = ({label, w, color, strong}) => (
  <div style={{display: 'flex', alignItems: 'center', gap: 20}}>
    <div style={{width: 170, fontFamily: MONO, fontSize: 28, fontWeight: 700, color: strong ? COLOR.shell1 : P.muted}}>{label}</div>
    <div style={{height: 28, width: w, borderRadius: 14, background: color}} />
  </div>
);

// Each view is mapped from reference pixels into the 1080×1920 frame so the whole figure (hands, shadow, fx) moves together.
const VIEWS = {
  hero: {spec: HERO, c: [544, 491] as const, at: [370, 1215] as const, k: 0.56},
  skeptical: {spec: SKEPTICAL, c: [1215, 480] as const, at: [370, 1210] as const, k: 1.45},
};

/** Phone-format example of the reconstruction beside a launch claim. Fictional product. */
export const PipLayersScene: React.FC<{view?: 'hero' | 'skeptical'; caption?: [string, string]}> = ({view = 'skeptical', caption = ['10× faster…', 'than what?']}) => {
  const v = VIEWS[view];
  return (
    <AbsoluteFill style={{fontFamily: SANS, color: P.ink, overflow: 'hidden', background: P.cream}}>
      <Backdrop />
      <Slab x={PANEL.x} y={PANEL.y} w={PANEL.w} h={PANEL.h} thickness={12} radius={30}>
        <Header title="nimbus-one · launch" />
        <div style={{padding: '18px 44px 0'}}>
          <div style={{fontFamily: MONO, fontSize: 24, fontWeight: 700, color: P.muted, letterSpacing: '0.12em'}}>AI ASSISTANT · V1</div>
          <div style={{display: 'flex', alignItems: 'flex-start', gap: 6, marginTop: 2}}>
            <div style={{fontSize: 200, fontWeight: 800, letterSpacing: '-0.05em', lineHeight: '190px'}}>10×</div>
            <div style={{fontSize: 110, fontWeight: 800, color: COLOR.shell1, lineHeight: '124px'}}>*</div>
          </div>
          <div style={{fontSize: 42, fontWeight: 700, color: P.ink2}}>faster responses</div>
          <div style={{marginTop: 22, display: 'flex', flexDirection: 'column', gap: 12}}>
            <Bar label="last gen" w={70} color="#C9C0AD" />
            <Bar label="nimbus" w={560} color={COLOR.shell1} strong />
          </div>
          <div style={{marginTop: 22, borderTop: `3px dashed ${P.line}`, paddingTop: 14, fontFamily: MONO, fontSize: 27, fontWeight: 600, color: P.muted}}>*vs. batch size 1, 8-token prompts</div>
        </div>
      </Slab>
      <svg width={1080} height={1920} viewBox="0 0 1080 1920" style={{position: 'absolute', left: 0, top: 0}}>
        <g transform={`translate(${v.at[0]} ${v.at[1]}) scale(${v.k}) translate(${-v.c[0]} ${-v.c[1]})`}>
          <PipFigure uid={`scene-${view}`} spec={v.spec} />
        </g>
      </svg>
      <Caption lit={caption[0]} dim={caption[1]} />
    </AbsoluteFill>
  );
};
