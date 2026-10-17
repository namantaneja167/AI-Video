import React from 'react';
import {AbsoluteFill, useCurrentFrame} from 'remotion';
import {P, SANS, MONO} from './palette';
import {Clay, ClayFilters, Lucide} from './Asset';
import {Presenter} from '../components/Presenter';
import {Arrowhead, Backdrop, Caption, FlatCoin, Section, Slab, W, H} from './parts';
import {AMOUNT, AMOUNT_CENTER, HIST, HISTORY, KEY_X, ORDER, RES, TRUNK_X, histY, pillCenter, resMidY, resY} from './layout';
import {AmountPill, COIN, HistoryCardBody, OrderCardBody, ResultRowBody} from './JoinFrame';
import {clamp01, easeBack, easeInOut, easeOut, lerp, prog} from '../anim';

/** Silent motion test: 8.0 s at 30 fps. Frame numbers below are the only timing source. */
export const MOTION_FRAMES = 240;

const BEATS = {
  orderIn: 0, // one large order pops in at centre
  orderMove: 34, // ...then settles into its place
  histFirst: 52, // three history records, one every `histStep` frames
  histStep: 10,
  idHighlight: 90, // shared ID: order tag first
  tagFirst: 100, // then each history tag, with its connector
  tagStep: 6,
  carry: 126, // the amount is carried down
  chipFirst: 128,
  chipStep: 10,
  chipTravel: 24,
  joinLabel: 170, // "1 order → 3 joined rows"
  formula: 176,
} as const;

const COPIES = HISTORY.length;
const TOTAL = AMOUNT * COPIES;
const landFrame = (i: number) => BEATS.chipFirst + i * BEATS.chipStep + BEATS.chipTravel;

const CAPTIONS = [
  {from: 4, to: 48, text: 'One order.'},
  {from: 54, to: 90, text: 'Three history records.'},
  {from: 92, to: 126, text: 'Same order ID.'},
  {from: 128, to: 168, text: 'Carry the ₹100 down.'},
  {from: 170, to: 240, text: '1 order → 3 joined rows'},
];

const EXPRESSIONS: [number, string][] = [
  [0, 'neutral'],
  [90, 'thinking'],
  [126, 'pointing'],
  [170, 'happy'],
];

// Polyline with a rounded corner: order amount → down the rose trunk → right into row i.
const chipPath = (i: number) => {
  const a = AMOUNT_CENTER;
  const b = {x: TRUNK_X, y: ORDER.y + ORDER.h + 30};
  const end = pillCenter(i);
  const corner = {x: TRUNK_X, y: end.y};
  const pts: {x: number; y: number}[] = [a, b];
  const r = 34;
  pts.push({x: corner.x, y: corner.y - r});
  for (let k = 1; k <= 8; k++) {
    const t = k / 8;
    const x = (1 - t) * (1 - t) * corner.x + 2 * (1 - t) * t * corner.x + t * t * (corner.x + r);
    const y = (1 - t) * (1 - t) * (corner.y - r) + 2 * (1 - t) * t * corner.y + t * t * corner.y;
    pts.push({x, y});
  }
  pts.push(end);
  return pts;
};

const pointAt = (pts: {x: number; y: number}[], u: number) => {
  const seg = pts.slice(1).map((p, k) => Math.hypot(p.x - pts[k].x, p.y - pts[k].y));
  const total = seg.reduce((s, v) => s + v, 0);
  let d = clamp01(u) * total;
  for (let k = 0; k < seg.length; k++) {
    if (d <= seg[k] || k === seg.length - 1) {
      const t = seg[k] === 0 ? 0 : Math.min(1, d / seg[k]);
      return {x: lerp(pts[k].x, pts[k + 1].x, t), y: lerp(pts[k].y, pts[k + 1].y, t)};
    }
    d -= seg[k];
  }
  return pts[pts.length - 1];
};

const Draw: React.FC<{d: string; p: number; color: string; width?: number}> = ({d, p, color, width = 8}) =>
  p <= 0 ? null : <path d={d} pathLength={1} stroke={color} strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" fill="none" strokeDasharray={1} strokeDashoffset={1 - p} />;

const pop = (f: number, start: number, dur = 14) => prog(f, start, dur, easeBack);

export const JoinMotion: React.FC = () => {
  const f = useCurrentFrame();
  const midOrder = ORDER.y + ORDER.h / 2;

  // ---- order card: pops in large, then travels to its place ----
  const enter = prog(f, BEATS.orderIn, 20, easeBack);
  const move = prog(f, BEATS.orderMove, 22, easeInOut);
  const orderScale = lerp(1.28, 1, move) * lerp(0.9, 1, enter);
  const finalC = {x: ORDER.x + ORDER.w / 2, y: ORDER.y + ORDER.h / 2};
  const startC = {x: 540, y: 740};
  const oc = {x: lerp(startC.x, finalC.x, move), y: lerp(startC.y, finalC.y + 0, move)};
  const coinFlip = prog(f, 6, 22, easeOut);

  // ---- shared-ID highlight ----
  const bump = (start: number) => 1 + 0.16 * Math.sin(Math.PI * clamp01((f - start) / 12));
  const ring = (start: number) => {
    const t = clamp01((f - start) / 16);
    return f < start ? 'none' : `0 0 0 ${t * 18}px rgba(240,160,48,${0.5 * (1 - t)})`;
  };
  const orderAmber = prog(f, BEATS.idHighlight, 8);

  // ---- focus: history + amber links recede while the amount is carried ----
  const focus = prog(f, BEATS.carry, 10) * (1 - prog(f, BEATS.joinLabel + 6, 14) * 0.6);
  const linkOpacity = 1 - 0.55 * focus;

  const [curExpr, prevExpr, since] = (() => {
    let idx = 0;
    EXPRESSIONS.forEach(([fr], i) => {
      if (f >= fr) idx = i;
    });
    return [EXPRESSIONS[idx][1], EXPRESSIONS[Math.max(0, idx - 1)][1], (f - EXPRESSIONS[idx][0]) / 30];
  })();

  const caption = CAPTIONS.find((c) => f >= c.from && f < c.to);
  const capIn = caption ? prog(f, caption.from, 6, easeBack) : 0;
  const capOut = caption ? 1 - prog(f, caption.to - 4, 4) : 1;

  return (
    <AbsoluteFill style={{fontFamily: SANS, color: P.ink, overflow: 'hidden', background: P.cream}}>
      <ClayFilters />
      <Backdrop drift={f * 0.25} />
      <div style={{position: 'absolute', left: 80, top: 1420, width: 120, height: 26, borderRadius: '50%', background: 'radial-gradient(ellipse, rgba(60,45,20,0.22), transparent 70%)'}} />

      {/* ---- links (under the cards) ---- */}
      <svg width={W} height={H} style={{position: 'absolute', left: 0, top: 0}}>
        <g opacity={linkOpacity}>
          <Draw d={`M${ORDER.x + ORDER.w - 4} ${midOrder} H${KEY_X}`} p={prog(f, BEATS.idHighlight + 2, 10, easeInOut)} color={P.amber.solid} />
          <Draw d={`M${KEY_X} ${histY(0) + 85} V${histY(2) + 85}`} p={prog(f, BEATS.tagFirst, 18, easeInOut)} color={P.amber.solid} />
          {HISTORY.map((_, i) => (
            <React.Fragment key={i}>
              <Draw d={`M${KEY_X} ${histY(i) + 85} H${HIST.x - 14}`} p={prog(f, BEATS.tagFirst + i * BEATS.tagStep, 12, easeInOut)} color={P.amber.solid} />
              <g opacity={prog(f, BEATS.tagFirst + i * BEATS.tagStep + 10, 4)}>
                <Arrowhead x={HIST.x - 2} y={histY(i) + 85} dir="right" color={P.amber.solid} />
              </g>
            </React.Fragment>
          ))}
        </g>
        {/* rose trunk and branches grow as copies pass */}
        <Draw d={`M${TRUNK_X} ${ORDER.y + ORDER.h + 30} V${resMidY(2)}`} p={prog(f, BEATS.chipFirst, 34, easeInOut)} color={P.rose.solid} />
        {HISTORY.map((_, i) => (
          <React.Fragment key={i}>
            <Draw d={`M${TRUNK_X} ${resMidY(i)} H${RES.x - 14}`} p={prog(f, landFrame(i) - 12, 12, easeInOut)} color={P.rose.solid} />
            <g opacity={prog(f, landFrame(i) - 2, 4)}>
              <Arrowhead x={RES.x - 3} y={resMidY(i)} dir="right" color={P.rose.solid} />
            </g>
          </React.Fragment>
        ))}
        <circle cx={TRUNK_X} cy={ORDER.y + ORDER.h + 30} r={12 * pop(f, BEATS.carry)} fill={P.white} stroke={P.rose.solid} strokeWidth={6} />
      </svg>

      {/* ---- section labels ---- */}
      <Section n="01" label="ORDER" x={ORDER.x} y={118} opacity={prog(f, BEATS.orderMove + 18, 10)} />
      <Section n="02" label={f < BEATS.tagFirst ? 'HISTORY · 3 RECORDS' : 'HISTORY · 3 MATCHES'} x={HIST.x} y={118} opacity={prog(f, BEATS.histFirst, 10)} />
      <Section n="03" label="RESULT · 3 ROWS" x={RES.x} y={878} opacity={prog(f, BEATS.carry + 2, 10)} />

      {/* ---- order card (+ coin) ---- */}
      <div
        style={{
          position: 'absolute',
          left: ORDER.x,
          top: ORDER.y,
          width: ORDER.w,
          height: ORDER.h,
          opacity: Math.min(1, enter * 2),
          transform: `translate(${oc.x - finalC.x}px, ${oc.y - finalC.y + lerp(30, 0, enter)}px) scale(${orderScale})`,
          transformOrigin: '50% 50%',
        }}
      >
        <Slab x={0} y={0} w={ORDER.w} h={ORDER.h} thickness={12} radius={28}>
          <OrderCardBody tagAmber={orderAmber} />
        </Slab>
        {/* tag halo sits on top so it can pulse outside the card's clipped body */}
        <div style={{position: 'absolute', left: 30, top: 110, width: 136, height: 52, borderRadius: 999, boxShadow: ring(BEATS.idHighlight), transform: `scale(${bump(BEATS.idHighlight)})`, pointerEvents: 'none'}} />
        <div style={{position: 'absolute', left: COIN.left - ORDER.x, top: COIN.top - ORDER.y, perspective: 700, opacity: coinFlip, transform: `scale(${lerp(0.4, 1, coinFlip)})`}}>
          <FlatCoin size={COIN.size} rotateY={lerp(-100, 0, coinFlip)} />
        </div>
      </div>

      {/* ---- history records ---- */}
      {HISTORY.map((h, i) => {
        const start = BEATS.histFirst + i * BEATS.histStep;
        const p = prog(f, start, 18, easeOut);
        const amber = prog(f, BEATS.tagFirst + i * BEATS.tagStep, 8);
        return (
          <div key={h.id} style={{position: 'absolute', inset: 0, opacity: Math.min(1, p * 1.6) * (1 - 0.4 * focus), transform: `translateX(${lerp(90, 0, p)}px)`, pointerEvents: 'none'}}>
            <Slab x={HIST.x} y={histY(i)} w={HIST.w} h={HIST.h} thickness={9} radius={24}>
              <HistoryCardBody {...h} amber={amber} />
            </Slab>
            <div style={{position: 'absolute', left: HIST.x + HIST.w - 20 - 150, top: histY(i) + 8, width: 150, height: 34, borderRadius: 999, boxShadow: ring(BEATS.tagFirst + i * BEATS.tagStep), transform: `scale(${bump(BEATS.tagFirst + i * BEATS.tagStep)})`}} />
          </div>
        );
      })}

      {/* ---- result slots → rows ---- */}
      {HISTORY.map((h, i) => {
        const slot = prog(f, BEATS.carry + i * 3, 10);
        const row = pop(f, landFrame(i) - 8, 14);
        const landed = f >= landFrame(i);
        return (
          <React.Fragment key={h.id}>
            <div
              style={{
                position: 'absolute',
                left: RES.x,
                top: resY(i),
                width: RES.w,
                height: RES.h,
                borderRadius: 22,
                border: `3px dashed ${P.rose.edge}`,
                boxSizing: 'border-box',
                opacity: slot * 0.6 * (1 - clamp01(row * 1.4)),
              }}
            />
            {row > 0 ? (
              <div style={{position: 'absolute', inset: 0, opacity: Math.min(1, row * 1.8), transform: `translateY(${lerp(16, 0, row)}px)`}}>
                <Slab x={RES.x} y={resY(i)} w={RES.w} h={RES.h} thickness={10} radius={22}>
                  <ResultRowBody status={h.status} id={h.id} showPill={landed} />
                </Slab>
              </div>
            ) : null}
          </React.Fragment>
        );
      })}

      {/* ---- flying copies of the amount ---- */}
      {HISTORY.map((_, i) => {
        const start = BEATS.chipFirst + i * BEATS.chipStep;
        const u = prog(f, start, BEATS.chipTravel, easeInOut);
        if (f < start || f >= landFrame(i)) return null;
        const pos = pointAt(chipPath(i), u);
        const peel = prog(f, start, 8, easeOut);
        const scale = lerp(1.45, 1, prog(f, start, 10, easeOut));
        return (
          <div key={i} style={{position: 'absolute', left: pos.x - 88, top: pos.y - 36, opacity: 0.35 + 0.65 * peel, transform: `scale(${scale})`, filter: 'drop-shadow(0 12px 10px rgba(160,60,50,0.28))'}}>
            <AmountPill />
          </div>
        );
      })}

      {/* ---- the operation labels ---- */}
      <div style={{position: 'absolute', left: 675 - 230, top: 786, width: 460, height: 60, borderRadius: 30, background: '#211F1C', boxShadow: '0 12px 22px -10px rgba(40,30,10,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, color: '#fff', fontFamily: MONO, fontWeight: 700, fontSize: 25, opacity: prog(f, BEATS.joinLabel, 8), transform: `scale(${lerp(0.8, 1, pop(f, BEATS.joinLabel))})`}}>
        <Lucide name="git-merge" color={P.amber.solid} size={28} />
        1 order → 3 joined rows
      </div>

      {/* ---- ₹100 × 3 = ₹300 ---- */}
      <div style={{position: 'absolute', left: RES.x, top: 1348, display: 'flex', alignItems: 'center', gap: 20, fontWeight: 800, letterSpacing: '-0.03em'}}>
        <div style={{opacity: pop(f, BEATS.formula), transform: `scale(${lerp(0.7, 1, pop(f, BEATS.formula))})`}}>
          <div style={{background: P.rose.fill, border: `2px solid ${P.rose.edge}`, color: P.rose.text, borderRadius: 20, padding: '4px 26px', fontSize: 64, lineHeight: '78px'}}>₹{AMOUNT}</div>
        </div>
        <div style={{opacity: pop(f, BEATS.formula + 8), transform: `scale(${lerp(0.7, 1, pop(f, BEATS.formula + 8))})`, fontSize: 64, color: P.ink, fontFamily: MONO}}>× {COPIES}</div>
        <div style={{opacity: pop(f, BEATS.formula + 16), fontSize: 64, color: P.ink2}}>=</div>
        <div style={{opacity: pop(f, BEATS.formula + 22), transform: `scale(${lerp(0.7, 1, pop(f, BEATS.formula + 22))})`}}>
          <div style={{background: P.rose.solid, color: '#fff', borderRadius: 20, padding: '4px 28px', fontSize: 64, lineHeight: '78px', boxShadow: '0 14px 22px -10px rgba(190,70,60,0.5)'}}>₹{TOTAL}</div>
        </div>
      </div>
      <div style={{position: 'absolute', left: RES.x, top: 1444, fontFamily: MONO, fontSize: 22, fontWeight: 600, color: P.muted, opacity: prog(f, BEATS.formula + 26, 10)}}>order 101 now counts ₹{TOTAL}, not ₹{AMOUNT}</div>

      {/* ---- 3D objects, each introduced with its operation ---- */}
      <div style={{position: 'absolute', left: 908, top: 64, opacity: pop(f, BEATS.histFirst), transform: `scale(${lerp(0.3, 1, pop(f, BEATS.histFirst))})`}}>
        <Clay name="clock" size={104} />
      </div>
      <div style={{position: 'absolute', left: 436, top: midOrder - 118, opacity: pop(f, BEATS.idHighlight + 6), transform: `scale(${lerp(0.3, 1, pop(f, BEATS.idHighlight + 6))})`}}>
        <Clay name="key" size={112} tint="amber" rotate={-24} />
      </div>
      <div style={{position: 'absolute', left: TRUNK_X + 44, top: 756, opacity: pop(f, BEATS.carry + 4) * (1 - 0.0), transform: `scale(${lerp(0.3, 1, pop(f, BEATS.carry + 4))})`}}>
        <Clay name="copy" size={104} tint="rose" />
      </div>

      {/* ---- presenter (temporary placeholder) ---- */}
      <div style={{position: 'absolute', left: 36, top: 1100, filter: 'drop-shadow(0 8px 8px rgba(60,45,20,0.2))'}}>
        <Presenter t={f / 30} expression={curExpr} prevExpression={prevExpr} expressionSince={since} mouth={0} width={200} />
      </div>

      {caption ? <Caption lit={caption.text} opacity={capIn * capOut} scale={lerp(0.94, 1, capIn)} /> : null}
    </AbsoluteFill>
  );
};
