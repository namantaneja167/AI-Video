import React from 'react';
import {AbsoluteFill} from 'remotion';
import {P, SANS, MONO} from './palette';
import {Clay, ClayFilters, Lucide, Placeholder, type ClayName} from './Asset';
import {Arrowhead, Backdrop, Barcode, Caption, FlatCoin, Header, Section, Slab, Tag, W, H} from './parts';
import {AMOUNT, AMOUNT_CENTER, HIST, HISTORY, KEY_X, ORDER, ORDER_ID, PILL, RES, TRUNK_X, histY, resMidY, resY} from './layout';

export {W, H};

export const OrderCardBody: React.FC<{tagAmber?: number}> = ({tagAmber = 1}) => (
  <>
    <Header title="orders" />
    <div style={{position: 'absolute', left: 30, top: 74, fontFamily: MONO, fontSize: 22, letterSpacing: '0.16em', color: P.muted, fontWeight: 700}}>ORDER</div>
    <div style={{position: 'absolute', left: 30, top: 110}}>
      <Tag size={36} amber={tagAmber}>
        #{ORDER_ID}
      </Tag>
    </div>
    <div style={{position: 'absolute', left: 30, top: AMOUNT_CENTER.y - ORDER.y - 75, fontSize: 142, fontWeight: 800, letterSpacing: '-0.045em', lineHeight: '150px', color: P.ink}}>₹{AMOUNT}</div>
    <div style={{position: 'absolute', left: 30, top: 350, fontFamily: MONO, fontSize: 24, color: P.muted, fontWeight: 600}}>amount · 1 row</div>
    <div style={{position: 'absolute', left: 0, right: 0, top: 400, borderTop: `3px dashed ${P.line}`}} />
    <div style={{position: 'absolute', left: 30, top: 424}}>
      <Barcode />
    </div>
    <div style={{position: 'absolute', left: 30, top: 486, fontFamily: MONO, fontSize: 22, color: P.muted, fontWeight: 600}}>order_id {ORDER_ID}</div>
  </>
);

export const HistoryCardBody: React.FC<{id: number; status: string; at: string; amber?: number}> = ({id, status, at, amber = 1}) => (
  <>
    <Header
      title={`id ${id}`}
      right={
        <Tag size={22} amber={amber}>
          order {ORDER_ID}
        </Tag>
      }
    />
    <div style={{display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: HIST.h - 48, padding: '0 32px 0 28px', borderLeft: `8px solid ${amber > 0.5 ? P.amber.solid : '#DDD6C7'}`, boxSizing: 'border-box'}}>
      <div style={{fontSize: 52, fontWeight: 800, letterSpacing: '-0.02em'}}>{status}</div>
      <div style={{fontFamily: MONO, fontSize: 34, fontWeight: 700, color: P.ink2}}>{at}</div>
    </div>
  </>
);

export const AmountPill: React.FC<{style?: React.CSSProperties}> = ({style}) => (
  <div
    style={{
      width: PILL.w,
      height: PILL.h,
      boxSizing: 'border-box',
      background: P.rose.fill,
      border: `2px solid ${P.rose.edge}`,
      borderRadius: 18,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontSize: 54,
      fontWeight: 800,
      letterSpacing: '-0.03em',
      color: P.rose.text,
      ...style,
    }}
  >
    ₹{AMOUNT}
  </div>
);

export const ResultRowBody: React.FC<{status: string; id: number; showPill?: boolean}> = ({status, id, showPill = true}) => (
  <div style={{position: 'relative', height: RES.h, borderLeft: `8px solid ${P.amber.solid}`, boxSizing: 'border-box'}}>
    <div style={{position: 'absolute', left: 24, top: 36}}>
      <Tag size={28}>#{ORDER_ID}</Tag>
    </div>
    <div style={{position: 'absolute', left: PILL.left - 8, top: (RES.h - PILL.h) / 2}}>{showPill ? <AmountPill /> : null}</div>
    <div style={{position: 'absolute', left: PILL.left - 8 + PILL.w + 24, top: 33, fontSize: 38, fontWeight: 700, letterSpacing: '-0.01em'}}>{status}</div>
    <div style={{position: 'absolute', right: 24, top: 36, fontFamily: MONO, fontSize: 24, fontWeight: 700, color: P.muted, border: `2px solid ${P.line}`, borderRadius: 12, padding: '4px 12px'}}>id {id}</div>
  </div>
);

const Art: React.FC<{name: ClayName; size: number; tint?: 'amber' | 'rose' | 'none'; rotate?: number; real: boolean; style?: React.CSSProperties}> = ({name, size, tint = 'none', rotate = 0, real, style}) => (
  <div style={{position: 'absolute', ...style}}>{real ? <Clay name={name} size={size} tint={tint} rotate={rotate} /> : <Placeholder name={name} size={size} tint={tint} rotate={rotate} />}</div>
);

export const COIN = {left: ORDER.x + 292, top: ORDER.y - 92, size: 190};

export const JoinFrame: React.FC<{assets: boolean}> = ({assets}) => {
  const midOrder = ORDER.y + ORDER.h / 2;
  return (
    <AbsoluteFill style={{fontFamily: SANS, color: P.ink, overflow: 'hidden', background: P.cream}}>
      <ClayFilters />
      <Backdrop />

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
        <g stroke={P.rose.solid} strokeWidth={8} strokeLinecap="round" fill="none">
          <path d={`M${TRUNK_X} ${ORDER.y + ORDER.h + 30} V${resMidY(2)}`} />
          {[0, 1, 2].map((i) => (
            <path key={i} d={`M${TRUNK_X} ${resMidY(i)} H${RES.x - 14}`} />
          ))}
        </g>
        {[0, 1, 2].map((i) => (
          <Arrowhead key={i} x={RES.x - 3} y={resMidY(i)} dir="right" color={P.rose.solid} />
        ))}
        <circle cx={TRUNK_X} cy={ORDER.y + ORDER.h + 30} r={12} fill={P.white} stroke={P.rose.solid} strokeWidth={6} />
      </svg>

      <Section n="01" label="ORDER" x={ORDER.x} y={118} />
      <Section n="02" label="HISTORY · 3 MATCHES" x={HIST.x} y={118} />
      <Section n="03" label="RESULT · 3 ROWS" x={RES.x} y={878} />

      <Slab x={ORDER.x} y={ORDER.y} w={ORDER.w} h={ORDER.h} thickness={12} radius={28}>
        <OrderCardBody />
      </Slab>
      {HISTORY.map((h, i) => (
        <Slab key={h.id} x={HIST.x} y={histY(i)} w={HIST.w} h={HIST.h} thickness={9} radius={24}>
          <HistoryCardBody {...h} />
        </Slab>
      ))}
      {HISTORY.map((h, i) => (
        <Slab key={h.id} x={RES.x} y={resY(i)} w={RES.w} h={RES.h} thickness={10} radius={22}>
          <ResultRowBody status={h.status} id={h.id} />
        </Slab>
      ))}

      <div style={{position: 'absolute', left: 675 - 200, top: 790, width: 400, height: 58, borderRadius: 29, background: '#211F1C', boxShadow: '0 12px 22px -10px rgba(40,30,10,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, color: '#fff', fontFamily: MONO, fontWeight: 700, fontSize: 24}}>
        <Lucide name="git-merge" color={P.amber.solid} size={28} />
        JOIN ON order_id
      </div>
      <div style={{position: 'absolute', left: TRUNK_X - 48, top: 800, width: 96, height: 50, borderRadius: 25, background: P.rose.solid, color: '#fff', fontFamily: MONO, fontWeight: 800, fontSize: 28, display: 'flex', alignItems: 'center', justifyContent: 'center'}}>×3</div>

      <div style={{position: 'absolute', left: COIN.left, top: COIN.top}}>
        <FlatCoin size={COIN.size} />
      </div>
      <Art real={assets} name="key" size={112} tint="amber" rotate={-24} style={{left: 436, top: midOrder - 118}} />
      <Art real={assets} name="clock" size={104} style={{left: 908, top: 64}} />
      <Art real={assets} name="copy" size={104} tint="rose" style={{left: TRUNK_X + 44, top: 756}} />

      <Caption lit="Join every" dim="history row," />
    </AbsoluteFill>
  );
};
