import React from 'react';
import {AbsoluteFill} from 'remotion';
import type {z} from 'zod';
import {clamp01, easeBack, easeOut} from '../../anim';
import {P} from '../../art/palette';
import {Backdrop} from '../../art/parts';
import {LAYOUTS} from '../layouts';
import type {DenseFixtureParams} from '../params';
import {PipPerformer} from '../pip/PipPerformer';
import {IDLE_SCORE} from '../pip/scores/idle';
import type {SceneProps} from '../types';
import {denseCardRects} from './denseGeometry';

type Params = z.infer<typeof DenseFixtureParams>;
const pr = (t: number, start: number, dur: number, ease: (x: number) => number = easeOut) => ease(clamp01((t - start) / dur));

/** Many small cards (a dense dashboard-like layout) in Pip's warm paper style, to exercise the layout fit check. */
export const DenseFixtureScene: React.FC<SceneProps> = ({scene, timeline, fonts, t, fps}) => {
  const p = scene.params as unknown as Params;
  const wanted = scene.layout?.template;
  const layoutId = wanted && LAYOUTS[wanted] ? wanted : 'dense-pip';
  const L = LAYOUTS[layoutId];
  const rects = denseCardRects(p, layoutId);
  return (
    <AbsoluteFill style={{fontFamily: fonts.sans}}>
      <Backdrop drift={0} />
      <div style={{position: 'absolute', left: L.content.x, top: L.content.y + 8, width: L.content.w, fontSize: 52, fontWeight: 800, letterSpacing: '-0.01em', color: P.ink, opacity: pr(t, 0, 0.4)}}>{p.title}</div>
      {rects.map((r, i) => {
        const a = pr(t, 0.2 + i * 0.05, 0.3, easeBack);
        return (
          <div key={i} style={{position: 'absolute', left: r.x, top: r.y, width: r.w, height: r.h, borderRadius: 20, background: P.white, border: `2px solid ${P.line}`, boxShadow: '0 3px 0 rgba(74,58,30,0.10)', boxSizing: 'border-box', padding: '16px 20px', opacity: a, transform: `scale(${0.9 + 0.1 * a})`}}>
            <div style={{fontFamily: fonts.mono, fontSize: 28, fontWeight: 700, color: P.muted, whiteSpace: 'nowrap', overflow: 'hidden'}}>{p.cards[i].label}</div>
            <div style={{fontSize: 56, fontWeight: 800, letterSpacing: '-0.02em', color: P.ink, marginTop: 6, whiteSpace: 'nowrap'}}>{p.cards[i].value}</div>
          </div>
        );
      })}
      {L.mascot ? (
        <PipPerformer uid="df" t={t} fps={fps} durationSec={timeline.durationSec} score={IDLE_SCORE} cues={{}} segments={{}} mouth={timeline.mouth ?? []} anchor={L.mascot} target={() => [540, 600]} />
      ) : null}
    </AbsoluteFill>
  );
};
