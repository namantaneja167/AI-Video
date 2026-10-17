import React, {useMemo} from 'react';
import {useCurrentFrame} from 'remotion';
import {C, FONT, MONO, BAND} from '../theme';
import {cue, easeInOut, lerp, prog, pulse, type SceneProps} from '../anim';
import type {TablesLabParamsT} from '../schema';
import {computeLab, formatMoney} from '../labModel';
import {Console, type ConsolePage} from '../components/Console';

// Layout (absolute canvas px). Tables stay put through failure, diagnosis and repair for continuity.
const RH = 38;
const OX = 60, OW = 340; // orders
const HX = 430, HW = 590; // history
const HEAD_Y = 252, BODY_Y = HEAD_Y + RH, TITLE_Y = 204;
const JX = 60, JW = 440; // joined
const JTITLE_Y = 690, JHEAD_Y = 730, JBODY_Y = JHEAD_Y + RH;
const CX = 570, CW = 450; // right-hand cards
const STAG = 9, TRAVEL = 27; // join animation, frames
const SUM_STEP = 10;
const COUNT_STEP = 5;

const rows = (n: number) => `${n} ${n === 1 ? 'row' : 'rows'}`;

const abs = (x: number, y: number, w: number, h: number, extra: React.CSSProperties = {}): React.CSSProperties => ({
  position: 'absolute',
  left: x,
  top: y,
  width: w,
  height: h,
  ...extra,
});

const Cell: React.FC<{x: number; y: number; w: number; children: React.ReactNode; color?: string; weight?: number; opacity?: number; pill?: number; align?: 'left' | 'right'}> = ({
  x,
  y,
  w,
  children,
  color = C.text,
  weight = 500,
  opacity = 1,
  pill = 0,
  align = 'left',
}) => (
  <div
    style={{
      ...abs(x, y, w, RH),
      lineHeight: `${RH}px`,
      fontFamily: MONO,
      fontSize: 25,
      fontWeight: weight,
      color,
      opacity,
      textAlign: align,
      padding: '0 6px',
      boxSizing: 'border-box',
      borderRadius: 8,
      background: pill > 0 ? `rgba(30,48,80,${0.92 * pill})` : 'transparent',
      boxShadow: pill > 0 ? `0 ${8 * pill}px ${18 * pill}px rgba(0,0,0,${0.5 * pill})` : undefined,
      whiteSpace: 'nowrap',
    }}
  >
    {children}
  </div>
);

const TableFrame: React.FC<{
  x: number;
  w: number;
  headY: number;
  titleY: number;
  title: string;
  chip: string;
  chipColor?: string;
  rows: number;
  heads: [string, number][];
  opacity: number;
  border?: string;
}> = ({x, w, headY, titleY, title, chip, chipColor = C.muted, rows, heads, opacity, border = C.line}) => (
  <div style={{opacity}}>
    <div style={{...abs(x, titleY, w - 140, 36), fontFamily: MONO, fontSize: 25, fontWeight: 700, color: C.accent, lineHeight: '36px'}}>{title}</div>
    <div
      style={{
        ...abs(x + w - 150, titleY, 150, 36),
        fontFamily: MONO,
        fontSize: 21,
        fontWeight: 700,
        color: chipColor,
        textAlign: 'right',
        lineHeight: '36px',
      }}
    >
      {chip}
    </div>
    <div style={{...abs(x, headY, w, RH + rows * RH), background: C.panel, border: `1.5px solid ${border}`, borderRadius: 16, boxSizing: 'border-box'}} />
    {heads.map(([label, dx]) => (
      <div key={label} style={{...abs(x + dx, headY, 200, RH), fontFamily: MONO, fontSize: 18, letterSpacing: 1, color: C.dim, lineHeight: `${RH}px`, padding: '0 6px'}}>
        {label}
      </div>
    ))}
  </div>
);

const InfoCard: React.FC<{y: number; h: number; opacity: number; border?: string; children: React.ReactNode}> = ({y, h, opacity, border = C.line, children}) => (
  <div
    style={{
      ...abs(CX, y + (1 - opacity) * 16, CW, h),
      opacity,
      background: C.panel,
      border: `1.5px solid ${border}`,
      borderRadius: 20,
      boxShadow: '0 16px 40px rgba(0,0,0,0.45)',
      fontFamily: FONT,
      boxSizing: 'border-box',
      padding: '16px 24px',
    }}
  >
    {children}
  </div>
);

export const TablesLab: React.FC<SceneProps<TablesLabParamsT>> = ({params, cues, startFrame}) => {
  const f = useCurrentFrame();
  const {orders, history, currency, inspectOrderId, wrongSql, fixedSql} = params;
  const m = useMemo(() => computeLab(orders, history), [orders, history]);
  const fmt = (n: number) => formatMoney(n, currency);

  const A = cue(cues, 'show-orders');
  const Hh = cue(cues, 'show-history');
  const G = cue(cues, 'grain-note');
  const J = cue(cues, 'join-start');
  const S = cue(cues, 'sum-start');
  const Cn = cue(cues, 'counts');
  const I = cue(cues, 'inspect-order');
  const R = cue(cues, 'repair-start');
  const L = cue(cues, 'pick-latest');
  const J2 = cue(cues, 'rejoin');
  const F = cue(cues, 'fixed-sum');

  const n = m.joined.length;
  const latestIds = new Set([...m.latest.values()].map((h) => h.id));
  const perOrder = Math.max(...orders.map((o) => history.filter((h) => h.orderId === o.id).length));
  const retractStart = (k: number) => R + (n - 1 - k) * 3;
  const retractDone = R + (n - 1) * 3 + 18;

  // ---- dimming / highlighting rules shared by both input tables
  const inspectOn = prog(f, I, 12) * (1 - prog(f, R, 10));
  const orderOpacity = (orderId: number) => 1 - (orderId === inspectOrderId ? 0 : 0.7 * inspectOn);
  const orderGlow = (orderId: number) => (orderId === inspectOrderId ? 0.14 * inspectOn : 0);

  // ---- joined-row sprites
  type Row = {key: string; orderId: number; amount: number; historyId: number; status: string};
  const sprites = (rows: Row[], start: number, stag: number, travel: number, retract: (k: number) => number, fixed: boolean) =>
    rows.map((r, k) => {
      const oi = orders.findIndex((o) => o.id === r.orderId);
      const hi = history.findIndex((h) => h.id === r.historyId);
      const copy = rows.slice(0, k).filter((x) => x.orderId === r.orderId).length;
      const tf = prog(f, start + k * stag, travel, easeInOut);
      const tr = fixed ? 0 : prog(f, retract(k), 18, easeInOut);
      const t = tf * (1 - tr);
      if (t <= 0.001) return null;
      const dy = JBODY_Y + k * RH;
      const fan = Math.sin(Math.PI * tf) * (copy - 1) * 34 * (1 - tr);
      const pill = Math.sin(Math.PI * Math.min(1, t)) * 0.9;
      const op = Math.min(1, t * 5);
      const oy = BODY_Y + oi * RH;
      const hy = BODY_Y + hi * RH;
      const cellId = {x: lerp(OX + 16, JX + 16, t) + fan, y: lerp(oy, dy, t)};
      const cellAmt = {x: lerp(OX + 170, JX + 136, t) + fan, y: lerp(oy, dy, t)};
      const cellSt = {x: lerp(HX + 200, JX + 262, t), y: lerp(hy, dy, t)};
      const landed = t > 0.98;
      const sumFlash = fixed ? 0 : pulse(f, S + k * SUM_STEP, 14) * 0.3;
      const countFlash = fixed ? pulse(f, F + 8 + k * 6, 14) * 0.3 : pulse(f, Cn + k * COUNT_STEP, 12) * 0.3;
      const dim = fixed ? 1 : 1 - 0.7 * (r.orderId === inspectOrderId ? 0 : inspectOn);
      const dupColor = !fixed && copy > 0 ? C.amber : C.text;
      const rowBg = (landed ? 1 : Math.max(0, (t - 0.8) / 0.2)) * (0.9 - 0.9 * (1 - tr));
      return (
        <React.Fragment key={r.key}>
          <svg width={1080} height={1920} style={{position: 'absolute', left: 0, top: 0, pointerEvents: 'none', opacity: op * 0.55 * (1 - prog(f, start + k * stag + travel, 18, easeInOut)) * (1 - tr)}}>
            <line x1={OX + OW - 14} y1={oy + RH / 2} x2={cellAmt.x + 60} y2={cellAmt.y + RH / 2} stroke={copy > 0 && !fixed ? C.amber : C.accent} strokeWidth={2.5} strokeLinecap="round" />
          </svg>
          <div style={{opacity: dim * op}}>
            <div style={abs(JX + 6, dy + 2, JW - 12, RH - 4, {borderRadius: 8, background: C.panelHi, opacity: rowBg})} />
            {sumFlash + countFlash > 0 ? <div style={abs(JX + 6, dy + 2, JW - 12, RH - 4, {borderRadius: 8, background: C.accent, opacity: sumFlash + countFlash})} /> : null}
            <Cell x={cellId.x} y={cellId.y} w={120} color={C.muted} pill={pill}>
              {r.orderId}
            </Cell>
            <Cell x={cellAmt.x} y={cellAmt.y} w={120} color={dupColor} weight={700} pill={pill}>
              {fmt(r.amount)}
            </Cell>
            <Cell x={cellSt.x} y={cellSt.y} w={170} color={r.status === 'paid' ? C.text : C.muted} pill={pill}>
              {r.status}
            </Cell>
          </div>
        </React.Fragment>
      );
    });

  const naiveRows = sprites(m.joined, J, STAG, TRAVEL, retractStart, false);
  const fixedRows = sprites(m.fixed, J2, 14, 26, () => Infinity, true);

  // ---- joined-frame bookkeeping
  const landedNaive = m.joined.filter((_, k) => prog(f, J + k * STAG, TRAVEL) > 0.5 && prog(f, retractStart(k), 18) < 0.5).length;
  const landedFixed = m.fixed.filter((_, k) => prog(f, J2 + k * 14, 26) > 0.5).length;
  const joinedCount = landedNaive + landedFixed;
  const joinedRowsShown = lerp(n, m.fixed.length, prog(f, retractDone, 14));
  const joinedIn = prog(f, J, 12);
  const inFixedPhase = f >= J2;

  // ---- ×N brackets on duplicated groups
  const brackets = orders.map((o) => {
    const idx = m.joined.map((r, k) => (r.orderId === o.id ? k : -1)).filter((k) => k >= 0);
    if (idx.length < 2) return null;
    const last = idx[idx.length - 1];
    const p = prog(f, J + last * STAG + TRAVEL, 10) * (1 - prog(f, retractStart(idx[0]), 10));
    if (p <= 0) return null;
    const y0 = JBODY_Y + idx[0] * RH + 5;
    const y1 = JBODY_Y + (last + 1) * RH - 5;
    return (
      <div key={o.id} style={{opacity: p * (1 - 0.7 * (o.id === inspectOrderId ? 0 : inspectOn))}}>
        <div style={abs(JX + JW + 4, y0, 12, y1 - y0, {borderRight: `3px solid ${C.amber}`, borderTop: `3px solid ${C.amber}`, borderBottom: `3px solid ${C.amber}`, borderRadius: '0 8px 8px 0'})} />
        <div style={abs(JX + JW + 22, (y0 + y1) / 2 - 18, 60, 36, {fontFamily: MONO, fontSize: 25, fontWeight: 800, color: C.amber, lineHeight: '36px'})}>×{idx.length}</div>
      </div>
    );
  });

  // inspected order outline
  const inspectIdx = m.joined.map((r, k) => (r.orderId === inspectOrderId ? k : -1)).filter((k) => k >= 0);
  const inspectBox =
    inspectIdx.length > 0 && inspectOn > 0 ? (
      <div style={abs(JX + 2, JBODY_Y + inspectIdx[0] * RH, JW - 4, inspectIdx.length * RH, {border: `2.5px solid ${C.accent}`, borderRadius: 10, opacity: inspectOn, boxSizing: 'border-box'})} />
    ) : null;

  // ---- running SUM
  let tally = 0;
  let cum = 0;
  m.joined.forEach((r, k) => {
    const before = cum;
    cum += r.amount;
    const p = prog(f, S + k * SUM_STEP, 8);
    if (f >= S + k * SUM_STEP) tally = lerp(before, cum, p);
  });
  const sumDone = S + n * SUM_STEP;
  const sumIn = prog(f, S, 10);
  const sumOut = prog(f, R, 10);
  const naiveFinal = prog(f, sumDone, 10);
  const fixedIn = prog(f, F, 12);
  const fixedVal = lerp(0, m.fixedSum, prog(f, F + 4, 22));

  // ---- COUNT rows
  const countRows1 = Math.min(n, Math.max(0, Math.floor((f - Cn) / COUNT_STEP) + 1));
  const distinctStart = Cn + n * COUNT_STEP + 6;
  const countRows2 = Math.min(m.joinedDistinctOrders, Math.max(0, Math.floor((f - distinctStart) / 12) + 1));
  const countsIn = prog(f, Cn, 10) * (1 - prog(f, R, 10));
  const verdictIn = prog(f, distinctStart + m.joinedDistinctOrders * 12, 10);
  const fc1 = Math.min(m.fixedCount, Math.max(0, Math.floor((f - (F + 8)) / 6) + 1));
  const fc2 = Math.min(m.fixedDistinctOrders, Math.max(0, Math.floor((f - (F + 8 + m.fixedCount * 6)) / 6) + 1));
  const fixedCountsIn = prog(f, F + 6, 10);
  const fixedVerdictIn = prog(f, F + 8 + m.fixedCount * 6 + m.fixedDistinctOrders * 6, 10);

  // ---- notes card (left, under orders)
  const noteGrain = prog(f, G, 10) * (1 - prog(f, R, 8));
  const noteGoal = prog(f, R + 14, 10) * (1 - prog(f, L, 8));
  const noteOrder = prog(f, L, 10);

  // ---- console pages
  const pages: ConsolePage[] = [
    {from: startFrame, text: `-- illustrative data: ${orders.length} orders, ${history.length} status rows`, cps: 1.6},
    {from: J, text: wrongSql, cps: 1.4, result: {at: sumDone + 6, text: `revenue -> ${m.naiveSum}   (expected ${m.trueTotal})`, tone: 'bad'}},
    {from: R + 6, text: '-- fix: keep one latest status row per order, then join', cps: 1.8},
    {from: L, text: fixedSql, cps: 3.4, result: {at: F + 26, text: `revenue -> ${m.fixedSum}`, tone: 'good'}},
  ];

  const ratio = m.trueTotal > 0 ? m.naiveSum / m.trueTotal : 0;

  return (
    <div style={{position: 'absolute', left: 0, top: 0, width: 1080, height: 1920, fontFamily: FONT, color: C.text}}>
      {/* ---------- orders ---------- */}
      <TableFrame
        x={OX}
        w={OW}
        headY={HEAD_Y}
        titleY={TITLE_Y}
        title="orders"
        chip={rows(orders.filter((_, i) => prog(f, A + i * 10, 14) > 0.3).length)}
        rows={orders.length}
        heads={[
          ['order_id', 16],
          ['amount', 170],
        ]}
        opacity={prog(f, A - 2, 10)}
      />
      {orders.map((o, i) => {
        const p = prog(f, A + i * 10, 14);
        const y = BODY_Y + i * RH;
        const flash = Math.max(...m.joined.map((r, k) => (r.orderId === o.id ? pulse(f, J + k * STAG, 16) : 0)), pulse(f, J2 + i * 14, 16));
        const op = p * orderOpacity(o.id);
        return (
          <div key={o.id} style={{opacity: op, transform: `translateX(${lerp(-30, 0, p)}px)`}}>
            <div style={abs(OX + 6, y + 2, OW - 12, RH - 4, {borderRadius: 8, background: C.accent, opacity: Math.min(0.5, flash * 0.35 + orderGlow(o.id))})} />
            <Cell x={OX + 16} y={y} w={140} color={C.muted}>
              {o.id}
            </Cell>
            <Cell x={OX + 170} y={y} w={150} weight={700}>
              {fmt(o.amount)}
            </Cell>
          </div>
        );
      })}

      {/* ---------- history ---------- */}
      <TableFrame
        x={HX}
        w={HW}
        headY={HEAD_Y}
        titleY={TITLE_Y}
        title="order_status_history"
        chip={rows(history.filter((_, k) => prog(f, Hh + k * 5, 12) > 0.3).length)}
        rows={history.length}
        heads={[
          ['id', 16],
          ['order_id', 84],
          ['status', 200],
          ['changed_at', 410],
        ]}
        opacity={prog(f, Hh - 2, 10)}
      />
      {history.map((h, k) => {
        const p = prog(f, Hh + k * 5, 12);
        const y = BODY_Y + k * RH;
        const isLatest = latestIds.has(h.id);
        const latestOn = prog(f, L, 14);
        const flash = Math.max(pulse(f, J + k * STAG, 16), (isLatest ? pulse(f, J2 + orders.findIndex((o) => o.id === h.orderId) * 14, 16) : 0));
        const inspected = h.orderId === inspectOrderId;
        const opacity = p * orderOpacity(h.orderId) * (isLatest ? 1 : 1 - 0.72 * latestOn);
        return (
          <div key={h.id} style={{opacity, transform: `translateX(${lerp(30, 0, p)}px)`}}>
            <div style={abs(HX + 6, y + 2, HW - 12, RH - 4, {borderRadius: 8, background: C.accent, opacity: Math.min(0.5, flash * 0.35 + (inspected ? 0.14 * inspectOn : 0))})} />
            {isLatest && latestOn > 0 ? (
              <div style={abs(HX + 6, y + 2, HW - 12, RH - 4, {borderRadius: 8, background: 'rgba(85,214,140,0.16)', border: `1.5px solid ${C.good}`, boxSizing: 'border-box', opacity: latestOn})} />
            ) : null}
            <Cell x={HX + 16} y={y} w={60} color={C.dim}>
              {h.id}
            </Cell>
            <Cell x={HX + 84} y={y} w={110} color={C.muted}>
              {h.orderId}
            </Cell>
            <Cell x={HX + 200} y={y} w={200} color={h.status === 'paid' ? C.text : C.muted} weight={h.status === 'paid' ? 700 : 500}>
              {h.status}
            </Cell>
            <Cell x={HX + 410} y={y} w={90} color={C.muted}>
              {h.at}
            </Cell>
            {isLatest && latestOn > 0 ? (
              <Cell x={HX + 500} y={y} w={84} color={C.good} weight={700} opacity={latestOn}>
                rn=1
              </Cell>
            ) : null}
          </div>
        );
      })}

      {/* ---------- notes under orders ---------- */}
      <div style={abs(OX, 430, OW, 190, {position: 'absolute'})}>
        <div style={{opacity: noteGrain, position: 'absolute', inset: 0, fontFamily: MONO}}>
          <div style={{fontSize: 21, color: C.muted, marginBottom: 6}}>grain = what one row means</div>
          <div style={{fontSize: 25, color: C.text, margin: '10px 0'}}>
            orders <span style={{color: C.accent}}>1 row</span> / order
          </div>
          <div style={{fontSize: 25, color: C.text, marginBottom: 10}}>
            history <span style={{color: C.amber}}>{perOrder} rows</span> / order
          </div>
          <div style={{fontSize: 25, fontWeight: 800, color: C.amber}}>1 → many = fan-out</div>
        </div>
        <div style={{opacity: noteGoal, position: 'absolute', inset: 0, fontFamily: MONO}}>
          <div style={{fontSize: 21, color: C.muted, marginBottom: 10}}>goal: current status</div>
          <div style={{fontSize: 27, color: C.text, lineHeight: 1.35}}>
            one <span style={{color: C.good}}>latest</span> row
            <br />
            per order
          </div>
        </div>
        <div style={{opacity: noteOrder, position: 'absolute', inset: 0, fontFamily: MONO}}>
          <div style={{fontSize: 21, color: C.muted, marginBottom: 8}}>pick deterministically</div>
          <div style={{fontSize: 23, color: C.text, lineHeight: 1.45}}>
            ORDER BY
            <br />
            &nbsp;&nbsp;<span style={{color: C.accent}}>changed_at</span> DESC,
            <br />
            &nbsp;&nbsp;<span style={{color: C.accent}}>id</span> DESC <span style={{color: C.dim}}>(tie-break)</span>
          </div>
          <div style={{fontSize: 23, color: C.good, fontWeight: 700, marginTop: 6}}>keep rn = 1</div>
        </div>
      </div>

      {/* ---------- join chip ---------- */}
      <div style={{...abs(CX, 640, CW, 40, {fontFamily: MONO, fontSize: 20, color: C.muted, lineHeight: '40px', whiteSpace: 'nowrap'}), opacity: prog(f, J, 10) * (1 - prog(f, R, 8)) + prog(f, J2, 10)}}>
        <span style={{color: C.accent}}>JOIN ON order_id</span> ·{' '}
        {inFixedPhase ? <span style={{color: C.good}}>1 latest row</span> : <span style={{color: C.amber}}>every history row</span>}
      </div>

      {/* ---------- joined result ---------- */}
      <TableFrame
        x={JX}
        w={JW}
        headY={JHEAD_Y}
        titleY={JTITLE_Y}
        title="joined result"
        chip={rows(joinedCount)}
        chipColor={inFixedPhase ? C.good : joinedCount > orders.length ? C.amber : C.muted}
        rows={joinedRowsShown}
        heads={[
          ['order_id', 16],
          ['amount', 136],
          ['status', 262],
        ]}
        opacity={joinedIn}
        border={inFixedPhase && landedFixed >= m.fixedCount ? C.good : C.line}
      />
      {naiveRows}
      {fixedRows}
      {brackets}
      {inspectBox}

      {/* ---------- SUM card (failure) ---------- */}
      <InfoCard y={700} h={196} opacity={sumIn * (1 - sumOut)} border={naiveFinal > 0.5 ? C.bad : C.line}>
        <div style={{fontFamily: MONO, fontSize: 21, color: C.muted}}>SUM(amount)</div>
        <div style={{fontSize: 88, fontWeight: 800, letterSpacing: -2, lineHeight: 1.1, color: naiveFinal > 0.5 ? C.bad : C.text}}>{fmt(Math.round(tally))}</div>
        <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', opacity: naiveFinal, fontSize: 24}}>
          <span style={{color: C.good, fontWeight: 650}}>should be {fmt(m.trueTotal)}</span>
          <span style={{fontFamily: MONO, color: C.bad, fontWeight: 800}}>{Number.isInteger(ratio) ? ratio : ratio.toFixed(1)}× too high</span>
        </div>
      </InfoCard>

      {/* ---------- SUM card (repaired) ---------- */}
      <InfoCard y={700} h={196} opacity={fixedIn} border={C.good}>
        <div style={{fontFamily: MONO, fontSize: 21, color: C.muted}}>SUM(amount)</div>
        <div style={{fontSize: 88, fontWeight: 800, letterSpacing: -2, lineHeight: 1.1, color: C.good}}>{fmt(Math.round(fixedVal))}</div>
        <div style={{fontSize: 24, color: C.good, fontWeight: 650, opacity: prog(f, F + 24, 10)}}>✓ matches finance</div>
      </InfoCard>

      {/* ---------- COUNT card (diagnosis) ---------- */}
      <InfoCard y={916} h={178} opacity={countsIn} border={verdictIn > 0.5 ? C.amber : C.line}>
        <CountLine label="COUNT(*)" value={countRows1} color={C.text} />
        <CountLine label="COUNT(DISTINCT order_id)" value={countRows2} color={C.accent} />
        <div style={{opacity: verdictIn, fontFamily: MONO, fontSize: 24, fontWeight: 800, color: C.amber, marginTop: 4}}>
          {m.joinedCount} ≠ {m.joinedDistinctOrders} → {Math.round(m.joinedCount / Math.max(1, m.joinedDistinctOrders))} rows per order
        </div>
      </InfoCard>

      {/* ---------- COUNT card (repaired) ---------- */}
      <InfoCard y={916} h={178} opacity={fixedCountsIn} border={fixedVerdictIn > 0.5 ? C.good : C.line}>
        <CountLine label="COUNT(*)" value={fc1} color={C.text} />
        <CountLine label="COUNT(DISTINCT order_id)" value={fc2} color={C.accent} />
        <div style={{opacity: fixedVerdictIn, fontFamily: MONO, fontSize: 24, fontWeight: 800, color: C.good, marginTop: 4}}>
          {m.fixedCount} = {m.fixedDistinctOrders} ✓ one row per order
        </div>
      </InfoCard>

      <Console frame={f} pages={pages} x={290} y={BAND.y} w={730} h={330} title="sql · illustrative data" />
    </div>
  );
};

const CountLine: React.FC<{label: string; value: number; color: string}> = ({label, value, color}) => (
  <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', height: 50}}>
    <span style={{fontFamily: MONO, fontSize: 21, color: C.muted}}>{label}</span>
    <span style={{fontSize: 46, fontWeight: 800, color}}>{value}</span>
  </div>
);
