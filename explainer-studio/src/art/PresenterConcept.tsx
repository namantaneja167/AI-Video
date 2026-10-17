import React from 'react';
import {AbsoluteFill} from 'remotion';
import {P, SANS, MONO} from './palette';
import {Clay, ClayFilters, Lucide} from './Asset';
import {Arrowhead, Backdrop, Caption, FlatCoin, Section, Slab, W, H} from './parts';
import {AMOUNT, HIST, HISTORY, KEY_X, ORDER, RES, histY, resY} from './layout';
import {HistoryCardBody, OrderCardBody, ResultRowBody, COIN} from './JoinFrame';

/**
 * Layout study: where an eventual presenter and the explanation share a 1080×1920 frame.
 * No character artwork exists yet, so the presenter is a labelled empty slot, never a stand-in figure.
 */
export const SLOT = {x: 24, y: 800, w: 300, h: 640}; // feet at y = 1440, caption starts at 1500
const ROWS_X = 360;
const ROWS_W = 660;
const PILL_BOX = {x: 380, y: 780, w: 380, h: 58};
const HAND = {x: SLOT.x + SLOT.w - 6, y: SLOT.y + 150};
const EQ = {x: ROWS_X, y: 1350};
const BLUE = '#2F6FEB';

const Note: React.FC<{x: number; y: number; children: React.ReactNode; w?: number; align?: 'left' | 'right'}> = ({x, y, children, w = 330, align = 'left'}) => (
  <div style={{position: 'absolute', left: align === 'left' ? x : x - w, top: y, width: w, fontFamily: MONO, fontSize: 21, fontWeight: 700, color: BLUE, lineHeight: 1.25, textAlign: align}}>{children}</div>
);

const Step: React.FC<{n: string; title: string; text: string}> = ({n, title, text}) => (
  <div style={{display: 'flex', gap: 16, alignItems: 'flex-start'}}>
    <div style={{width: 38, height: 38, borderRadius: 19, background: BLUE, color: '#fff', fontFamily: MONO, fontWeight: 800, fontSize: 22, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0}}>{n}</div>
    <div style={{fontFamily: MONO, fontSize: 21, lineHeight: 1.3, color: '#25324a'}}>
      <b style={{color: BLUE}}>{title}</b> {text}
    </div>
  </div>
);

export const PresenterConcept: React.FC<{annotate: boolean}> = ({annotate}) => {
  const midOrder = ORDER.y + ORDER.h / 2;
  return (
    <AbsoluteFill style={{fontFamily: SANS, color: P.ink, overflow: 'hidden', background: P.cream}}>
      <ClayFilters />
      <Backdrop />

      {/* amber match: order → each history record */}
      <svg width={W} height={H} style={{position: 'absolute', left: 0, top: 0}}>
        <g stroke={P.amber.solid} strokeWidth={8} strokeLinecap="round" strokeLinejoin="round" fill="none">
          <path d={`M${ORDER.x + ORDER.w - 4} ${midOrder} H${KEY_X}`} />
          <path d={`M${KEY_X} ${histY(0) + 85} V${histY(2) + 85}`} />
          {[0, 1, 2].map((i) => (
            <path key={i} d={`M${KEY_X} ${histY(i) + 85} H${HIST.x - 14}`} />
          ))}
        </g>
        {[0, 1, 2].map((i) => (
          <Arrowhead key={i} x={HIST.x - 2} y={histY(i) + 85} dir="right" color={P.amber.solid} />
        ))}
      </svg>

      <Section n="01" label="ORDER" x={ORDER.x} y={118} />
      <Section n="02" label="HISTORY · 3 MATCHES" x={HIST.x} y={118} />
      <Section n="03" label="RESULT · 3 ROWS" x={ROWS_X} y={878} />

      <Slab x={ORDER.x} y={ORDER.y} w={ORDER.w} h={ORDER.h} thickness={12} radius={28}>
        <OrderCardBody />
      </Slab>
      {HISTORY.map((h, i) => (
        <Slab key={h.id} x={HIST.x} y={histY(i)} w={HIST.w} h={HIST.h} thickness={9} radius={24}>
          <HistoryCardBody {...h} />
        </Slab>
      ))}
      {HISTORY.map((h, i) => (
        <Slab key={h.id} x={ROWS_X} y={resY(i)} w={ROWS_W} h={RES.h} thickness={10} radius={22}>
          <ResultRowBody status={h.status} id={h.id} />
        </Slab>
      ))}

      <div style={{position: 'absolute', left: PILL_BOX.x, top: PILL_BOX.y, width: PILL_BOX.w, height: PILL_BOX.h, borderRadius: 29, background: '#211F1C', boxShadow: '0 12px 22px -10px rgba(40,30,10,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, color: '#fff', fontFamily: MONO, fontWeight: 700, fontSize: 26}}>
        <Lucide name="git-merge" color={P.amber.solid} size={30} />
        JOIN ON order_id
      </div>

      {/* the reveal */}
      <div style={{position: 'absolute', left: EQ.x, top: EQ.y, display: 'flex', alignItems: 'center', gap: 16, fontWeight: 800, letterSpacing: '-0.03em', fontSize: 56}}>
        <div style={{background: P.rose.fill, border: `2px solid ${P.rose.edge}`, color: P.rose.text, borderRadius: 18, padding: '2px 22px', lineHeight: '70px'}}>₹{AMOUNT}</div>
        <div style={{fontFamily: MONO}}>× 3</div>
        <div style={{color: P.ink2}}>=</div>
        <div style={{background: P.rose.solid, color: '#fff', borderRadius: 18, padding: '2px 24px', lineHeight: '70px', boxShadow: '0 14px 22px -10px rgba(190,70,60,0.5)'}}>₹{AMOUNT * 3}</div>
      </div>

      <div style={{position: 'absolute', left: COIN.left, top: COIN.top}}>
        <FlatCoin size={COIN.size} />
      </div>
      <div style={{position: 'absolute', left: 436, top: midOrder - 118}}>
        <Clay name="key" size={112} tint="amber" rotate={-24} />
      </div>

      {/* presenter slot: reserved floor space and contact shadow; no figure */}
      <div style={{position: 'absolute', left: SLOT.x + 20, top: SLOT.y + SLOT.h - 14, width: SLOT.w - 40, height: 30, borderRadius: '50%', background: 'radial-gradient(ellipse, rgba(60,45,20,0.2), transparent 70%)'}} />
      <div style={{position: 'absolute', left: SLOT.x, top: SLOT.y, width: SLOT.w, height: SLOT.h, borderRadius: 28, border: `3px dashed ${P.muted}`, background: 'rgba(255,255,255,0.35)', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, fontFamily: MONO, color: P.muted, textAlign: 'center'}}>
        <div style={{fontSize: 24, fontWeight: 800, letterSpacing: '0.12em'}}>PRESENTER</div>
        <div style={{fontSize: 24, fontWeight: 800, letterSpacing: '0.12em'}}>SLOT</div>
        <div style={{fontSize: 20, fontWeight: 600}}>artwork pending</div>
      </div>

      <Caption lit="Join every" dim="history row," />

      {annotate ? (
        <>
          <svg width={W} height={H} style={{position: 'absolute', left: 0, top: 0}}>
            <g stroke={BLUE} strokeWidth={4} fill="none" strokeLinecap="round" strokeDasharray="12 10">
              {/* A2: pointer from the hand anchor to the single element being explained */}
              <path d={`M${HAND.x} ${HAND.y} L${PILL_BOX.x - 8} ${PILL_BOX.y + PILL_BOX.h / 2 + 8}`} />
              {/* A3: where the reveal lands */}
              <rect x={EQ.x - 14} y={EQ.y - 8} width={ROWS_W - 6} height={96} rx={20} />
              {/* floor contact */}
              <path d={`M0 ${SLOT.y + SLOT.h} H${SLOT.x + SLOT.w + 40}`} />
            </g>
            <circle cx={HAND.x} cy={HAND.y} r={10} fill={BLUE} />
            <path d={`M${PILL_BOX.x - 8} ${PILL_BOX.y + PILL_BOX.h / 2 + 8}l-18 -4 8 -14z`} fill={BLUE} />
          </svg>
          <Note x={SLOT.x} y={SLOT.y - 62} w={420}>SLOT 300×640 · feet y=1440</Note>
          <Note x={SLOT.x + 12} y={HAND.y + 24} w={170}>hand anchor</Note>
          <Note x={PILL_BOX.x + 4} y={PILL_BOX.y - 46} w={440}>2 · pointer lands on ONE element</Note>
          <Note x={EQ.x} y={EQ.y + 96} w={640}>3 · reveal → presenter reacts</Note>
          <Note x={SLOT.x + SLOT.w + 46} y={SLOT.y + SLOT.h - 34} w={220}>floor contact</Note>

          <div style={{position: 'absolute', left: 60, top: 1660, width: 960, display: 'flex', flexDirection: 'column', gap: 12}}>
            <div style={{fontFamily: MONO, fontSize: 20, fontWeight: 800, letterSpacing: '0.14em', color: BLUE}}>PROPOSED, NOT RENDERED · ANNOTATION LAYER, NOT PART OF THE FRAME</div>
            <Step n="1" title="INTRODUCE" text="steps into the slot large, one question on the board" />
            <Step n="2" title="POINT" text="shrinks to the slot; pointer tip visits one element at a time" />
            <Step n="3" title="REACT" text="double-take when ₹300 pops; holds, then gives a verdict" />
          </div>
        </>
      ) : null}
    </AbsoluteFill>
  );
};
