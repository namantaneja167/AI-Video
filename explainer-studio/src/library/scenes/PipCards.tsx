import React from 'react';
import {AbsoluteFill} from 'remotion';
import {clamp01, easeBack, easeOut} from '../../anim';
import {P} from '../../art/palette';
import {Backdrop} from '../../art/parts';
import {LAYOUTS} from '../layouts';
import {PipCardsParams} from '../params';
import {PipPerformer} from '../pip/PipPerformer';
import {pipCardsScore, type TimedAction} from '../pip/scores/pipCards';
import type {SceneProps} from '../types';
import {BODY_FONT, HEAD_FONT, TITLE_FONT, cardTarget, layoutIdFor, pipCardsRects} from './pipCardsGeometry';

const pr = (t: number, start: number, dur: number, ease: (x: number) => number = easeOut) => ease(clamp01((t - start) / dur));
const POINT_HOLD = 2.2;

/**
 * The reusable Pip scene: cards of the author's own text on warm paper, with Pip beside them. Cards appear on their cues;
 * Pip does exactly the actions listed in the parameters, at their cues, and otherwise idles. No other text drives him.
 */
export const PipCardsScene: React.FC<SceneProps> = ({scene, timeline, cues, fonts, t, fps}) => {
  const p = PipCardsParams.parse(scene.params);
  const template = scene.layout?.template;
  const layoutId = layoutIdFor(template);
  const L = LAYOUTS[layoutId];
  const {title, cards} = pipCardsRects(p, layoutId);
  const timed: TimedAction[] = p.actions.flatMap((a, j) => (cues[`action${j + 1}`] === undefined ? [] : [{do: a.do, t: cues[`action${j + 1}`], aim: a.card !== undefined ? cardTarget(p, template, a.card) : undefined}]));
  const showPip = !!L.mascot && scene.layout?.mascot?.mode !== 'hidden';
  const score = pipCardsScore(timed, {idle: p.idle, anchor: L.mascot ?? {ax: 0, ay: 0, k: 1}});
  const aimed = (tt: number): TimedAction | undefined => [...timed].filter((a) => a.aim && a.t - 0.2 <= tt).sort((a, b) => b.t - a.t)[0];
  const target = (tt: number): [number, number] => aimed(tt)?.aim ?? cardTarget(p, template, 0);
  const pointing = timed.find((a) => a.do === 'point' && t >= a.t - 0.2 && t < a.t + POINT_HOLD);
  const pointedCard = pointing ? p.actions.findIndex((a, j) => a.do === 'point' && cues[`action${j + 1}`] === pointing.t) : -1;
  const a0 = p.actions[pointedCard]?.card;
  return (
    <AbsoluteFill style={{fontFamily: fonts.sans}}>
      <Backdrop drift={0} />
      {title ? <div data-probe="text" data-probe-id="title" style={{position: 'absolute', left: title.x, top: title.y, width: title.w, fontSize: TITLE_FONT, fontWeight: 800, letterSpacing: '-0.01em', color: P.ink, opacity: pr(t, 0, 0.4)}}>{p.title}</div> : null}
      {cards.map((r, i) => {
        const a = pr(t, cues[`card${i + 1}`] ?? 0, 0.35, easeBack);
        const lit = a0 === i;
        return (
          <div key={i} data-probe="box" data-probe-id={`card${i + 1}`} style={{position: 'absolute', left: r.x, top: r.y, width: r.w, height: r.h, borderRadius: 22, background: P.white, border: `3px solid ${lit ? P.amber.edge : P.line}`, boxShadow: '0 4px 0 rgba(74,58,30,0.10)', boxSizing: 'border-box', padding: '26px 26px', opacity: a, transform: `translateY(${(1 - a) * 28}px) scale(${0.97 + 0.03 * a})`, overflow: 'hidden'}}>
            <div data-probe="text" data-probe-id={`card${i + 1}-heading`} data-parent={`card${i + 1}`} style={{fontSize: HEAD_FONT, fontWeight: 800, letterSpacing: '-0.02em', color: P.ink, lineHeight: '60px', whiteSpace: 'nowrap'}}>{p.cards[i].heading}</div>
            {p.cards[i].body ? <div data-probe="text" data-probe-id={`card${i + 1}-text`} data-parent={`card${i + 1}`} style={{fontSize: BODY_FONT, fontWeight: 500, color: P.ink2, lineHeight: 1.3, marginTop: 8}}>{p.cards[i].body}</div> : null}
          </div>
        );
      })}
      {showPip && L.mascot ? (
        <PipPerformer uid="pc" t={t} fps={fps} durationSec={timeline.durationSec} score={score} cues={cues} segments={{}} mouth={timeline.mouth ?? []} anchor={L.mascot} target={target}>
          {({tip, pointW}) => (pointW > 0.4 ? <line x1={tip[0]} y1={tip[1] - 8} x2={target(t)[0]} y2={target(t)[1] + 40} stroke="#F08B4C" strokeWidth={6} strokeLinecap="round" strokeDasharray="2 14" opacity={0.6 * pointW} /> : null)}
        </PipPerformer>
      ) : null}
    </AbsoluteFill>
  );
};
