import React from 'react';
import {AbsoluteFill} from 'remotion';
import {Backdrop} from '../../art/parts';
import {P} from '../../art/palette';
import {clamp01, easeInOut, lerp} from '../../anim';
import {ChapterHeader, FullPageTakeaway} from '../chapters';
import {bezier, camMix, camPoint, camTransform, damped, mix, pr, span, springOut, type Cam, type XY} from '../motion';
import {PipPerformer} from '../pip/PipPerformer';
import {IDLE_SCORE} from '../pip/scores/idle';
import type {NumKey, PipScore} from '../pip/score';
import type {SceneProps} from '../types';
import qrData from './ticketQr.json';

const O = '#E8772E', B = '#547A92', G = '#277565', R = '#B94F43';
const c = (cue: string, dt = 0) => ({cue, dt});
const k = (...pairs: NumKey[]) => pairs;

// ---- Pip: notices the screenshot, follows the code to the reader, doubts the rejection, nods at the pass ------------
const SCORE: PipScore = {
  ...IDLE_SCORE,
  look: {
    x: k([{t: 0}, 0.2], [c('hookshot'), 0.5], [c('series'), 0.3], [c('shot'), 0.7], [c('time'), 0.5], [c('gate'), 0.9], [c('window'), 0.95], [c('fail', 0.6), 0.5], [c('current'), 0.85], [c('passes'), 0.9], [c('harder'), 0.4], [c('resolve'), 0]),
    y: k([{t: 0}, -0.3], [c('shot'), -0.5], [c('gate'), -0.15], [c('fail'), -0.05], [c('passes'), -0.25], [c('resolve'), 0]),
  },
  smile: k([{t: 0}, 0.55], [c('hookshot'), 0.2], [c('shot'), 0.45], [c('frozen'), 0.05], [c('checks'), 0.1], [c('fail'), -0.15], [c('open'), 0.4], [c('passes'), 1], [c('resolve'), 0.85]),
  browL: k([{t: 0}, -7], [c('shot'), -16], [c('checks'), 8], [c('fail'), -12], [c('open'), -4], [c('passes'), -9]),
  browR: k([{t: 0}, -8], [c('shot'), -10], [c('checks'), -16], [c('fail'), -20], [c('open'), -6], [c('passes'), -8]),
  tilt: k([{t: 0}, -2], [c('shot'), -5], [c('checks'), 5], [c('fail'), 7], [c('open'), -2], [c('passes'), 0]),
  hop: k([{t: 0}, 0], [c('shot'), 0], [c('shot', 0.14), -8], [c('shot', 0.42), 0], [c('fail'), 0], [c('fail', 0.12), -9], [c('fail', 0.42), 0], [c('passes'), 0], [c('passes', 0.14), -12], [c('passes', 0.5), 0]),
  nod: k([{t: 0}, 0], [c('passes', 0.5), 0], [c('passes', 0.7), 7], [c('passes', 1.05), 0]),
  pointW: k([{t: 0}, 0], [c('checks', -0.2), 0], [c('checks'), 1], [c('fail', 0.8), 1], [c('fail', 1.2), 0], [c('current', -0.2), 0], [c('current'), 1], [c('passes', 0.9), 1], [c('passes', 1.3), 0]),
  handR: [[{t: 0}, 'restR'], [c('checks', -0.25), 'restR'], [c('checks'), 'tip'], [c('fail', 0.8), 'tip'], [c('fail', 1.3), 'restR'], [c('current', -0.25), 'restR'], [c('current'), 'tip'], [c('passes', 0.9), 'tip'], [c('passes', 1.4), 'restR']],
  blinks: [c('shot', 0.5), c('gate', 0.6), c('fail', 0.5), c('passes', 0.6)],
};

// ---- geometry (1080 x 1920). The mechanism lives between the stage strip and the captions, clipped to that band. ----
const BAND = {top: 520, bottom: 1336};
const CENTRE: XY = [540, 928];
const CARD = {w: 280, h: 420};
const LIVE0: XY = [80, 650], COPY1: XY = [390, 650], READER: XY = [700, 650];
const OPEN_LIVE: XY = [310, 784], OPEN_S = 0.66;
const QR_AT: XY = [35, 112], QR_SIZE = 210;
const LENS: XY = [READER[0] + 150, READER[1] + 70];
const SLOT: XY = [READER[0] + 28, READER[1] + 292];
const QR_COPY: XY = [COPY1[0] + QR_AT[0] + QR_SIZE / 2, COPY1[1] + QR_AT[1] + QR_SIZE / 2];
const QR_LIVE: XY = [LIVE0[0] + QR_AT[0] + QR_SIZE / 2, LIVE0[1] + QR_AT[1] + QR_SIZE / 2];
const SLOT_C: XY = [SLOT[0] + 122, SLOT[1] + 31];
const WAVES = 14;
type Qr = {size: number; rows: string[]};
const QRS = (qrData as Qr[]).map((d) => {
  const paths = Array.from({length: WAVES}, () => '');
  d.rows.forEach((row, y) => [...row].forEach((v, x) => { if (v === '1') paths[Math.min(WAVES - 1, Math.floor(((x + y) / (2 * (d.size - 1))) * WAVES))] += `M${x} ${y}h1v1h-1z`; }));
  return {size: d.size, paths};
});

/** The code, built wave by wave on the diagonal; `sweep` swaps it for the next code behind a scan line. */
const Code: React.FC<{a: number; b?: number; sweep?: number; reveal?: number; size: number; uid: string; x?: number; y?: number}> = ({a, b = a, sweep = 0, reveal = 1, size, uid, x = 0, y = 0}) => {
  const n = QRS[a].size, edge = sweep * n;
  const layer = (i: number, clip: string) => <g clipPath={`url(#${clip})`}>{QRS[i].paths.map((d, w) => <path key={w} d={d} fill={P.ink} opacity={clamp01(reveal * (WAVES + 3) - w)} />)}</g>;
  return <svg x={x} y={y} width={size} height={size} viewBox={`0 0 ${n} ${n}`} shapeRendering="crispEdges">
    <defs><clipPath id={uid + 'a'}><rect x={0} y={edge} width={n} height={n} /></clipPath><clipPath id={uid + 'b'}><rect x={0} y={0} width={n} height={edge} /></clipPath></defs>
    <rect width={n} height={n} fill="#fff" />
    {layer(a, uid + 'a')}{sweep > 0 ? layer(b, uid + 'b') : null}
    {sweep > 0 && sweep < 1 ? <rect y={edge - 0.7} width={n} height={1.4} fill={G} opacity={0.9} /> : null}
  </svg>;
};

type CardProps = {kind: 'live' | 'copy'; fonts: {mono: string; sans: string}; code: React.ReactNode; window: string; status: string; tone: string; bar: number; frozen: number; shadow: number; lock?: boolean};
/** The live pass and its screenshot share one design: the copy is the same object, lifted off. */
const PassCard: React.FC<CardProps> = ({kind, fonts, code, window: win, status, tone, bar, frozen, shadow, lock}) => <g>
  <rect x={5 + shadow} y={9 + shadow} width={CARD.w} height={CARD.h} rx={28} fill="#CFC5B2" opacity={0.22 + 0.18 * (shadow / 24)} />
  <rect width={CARD.w} height={CARD.h} rx={28} fill="#FFFDF8" stroke={tone} strokeWidth={3} strokeDasharray={kind === 'copy' && frozen > 0.5 ? '14 8' : undefined} />
  <path d={`M0 44V28a28 28 0 0 1 28-28H${CARD.w - 28}a28 28 0 0 1 28 28V44Z`} fill={kind === 'live' ? '#E4EEE8' : '#E3E8EC'} />
  <text x={22} y={30} fontFamily={fonts.mono} fontWeight={800} fontSize={18} letterSpacing={1} fill={tone}>{kind === 'live' ? 'LIVE PASS' : 'SAVED SCREENSHOT'}</text>
  <text x={24} y={86} fontFamily={fonts.sans} fontWeight={850} fontSize={30} fill={P.ink}>PIP LIVE</text>
  <g transform={`translate(${QR_AT[0]} ${QR_AT[1]})`}><rect width={QR_SIZE} height={QR_SIZE} fill="#fff" stroke={P.line} strokeWidth={2} />{code}</g>
  <text x={CARD.w / 2} y={354} textAnchor="middle" fontFamily={fonts.mono} fontWeight={800} fontSize={20} fill={tone}>CODE WINDOW {win}</text>
  <rect x={30} y={366} width={CARD.w - 60} height={8} rx={4} fill="#E4EAE6" />
  <rect x={30} y={366} width={(CARD.w - 60) * bar} height={8} rx={4} fill={kind === 'live' ? G : '#A9B4BD'} />
  <text x={CARD.w / 2} y={404} textAnchor="middle" fontFamily={fonts.sans} fontWeight={800} fontSize={24} fill={tone}>{status}</text>
  {frozen > 0 ? <g opacity={frozen}>
    <rect width={CARD.w} height={CARD.h} rx={28} fill="#DCE6EE" opacity={0.42} />
    {[60, 150, 240, 330].map((y) => <path key={y} d={`M-10 ${y}L${CARD.w + 10} ${y - 90}`} stroke="#fff" strokeWidth={5} opacity={0.5} />)}
    {lock ? <g transform={`translate(${CARD.w - 56} 6)`}><rect x={6} y={14} width={32} height={24} rx={6} fill={B} /><path d="M12 14v-6a10 10 0 0 1 20 0v6" fill="none" stroke={B} strokeWidth={5} /></g> : null}
  </g> : null}
</g>;

/** A packet of code data: the code shrunk to a chip, with a short trail. */
const Chip: React.FC<{p: XY; trail: XY[]; letter: string; color: string; fonts: {mono: string}; s?: number; o?: number}> = ({p, trail, letter, color, fonts, s = 1, o = 1}) => <g opacity={o}>
  {trail.map((q, i) => <circle key={i} cx={q[0]} cy={q[1]} r={9 - i * 1.3} fill={color} opacity={0.32 - i * 0.05} />)}
  <g transform={`translate(${p[0]} ${p[1]}) scale(${s})`}><rect x={-44} y={-27} width={88} height={54} rx={16} fill={color} stroke="#FFFDF8" strokeWidth={5} /><text y={11} textAnchor="middle" fontFamily={fonts.mono} fontWeight={800} fontSize={32} fill="#fff">{letter}</text></g>
</g>;

const STAGES = ['LIVE', 'COPY', 'ROTATE', 'SCAN', 'USE'];
const TITLES = ['SAME TICKET.', 'FREEZE A COPY.', 'TIME MOVES ON.', 'THE OLD CODE.', 'THE LIVE CODE.', 'CHECK THE VALUE.', 'KNOW YOUR TICKET.'];
const SUPPORT = ['The ticket remains valid. Its code can change.', 'A screenshot captures this moment.', 'The pass updates. The picture stays frozen.', 'The reader checks an allowed time window.', 'Current code passes the time check.', 'It reads code data, not screenshot identity.', 'Some tickets use a static barcode instead.'];
const STATUS = ['One valid pass.', 'Two images.\nSame code.', 'The live code\nmoves on.', 'Old code.\nOutside the window.', 'Current code.\nTime check passed.', 'The reader sees\ndata, not the image.', 'Static codes work\ndifferently.'];

/**
 * Rotating ticket, in motion. One pass assembles; a screenshot lifts off the same object; time advances and the live
 * code changes behind a scan line while the copy stays frozen; the code data travels to a reader that compares it with
 * its allowed window (rejecting the old value, accepting the current one). The camera follows the event.
 */
export const TicketMotion: React.FC<SceneProps> = (p) => {
  const {t, cues: q, fonts} = p;
  for (const n of ['hookshot', 'hookexpire', 'series', 'valid', 'rotating', 'shot', 'both', 'time', 'newcode', 'frozen', 'gate', 'checks', 'window', 'fail', 'open', 'current', 'passes', 'harder', 'reads', 'notshot', 'static', 'resolve']) {
    if (!Number.isFinite(q[n])) throw new Error(`ticket-motion needs cue ${n}`);
  }
  const mono = fonts.mono;
  const settle = q.series;
  // ---- the opening teaser and its rewind -------------------------------------------------------------------------
  const rise = pr(t, settle - 0.5, 0.95, easeInOut);
  const rewind = pr(t, settle - 0.35, 0.7, easeInOut);
  const peelOpen = pr(t, q.hookshot, 0.6, springOut) * (1 - rewind);
  const stamp = pr(t, q.hookexpire, 0.35, springOut) * (1 - pr(t, settle - 0.3, 0.3));
  const liveS = lerp(OPEN_S, 1, rise);
  // while the first stage waits for the screenshot the pass breathes a little, so the page is never frozen
  const bob = Math.sin(t * 2.4) * 6 * pr(t, settle + 0.5, 0.5) * (1 - pr(t, q.shot - 0.4, 0.3));
  const livePos0 = mix(OPEN_LIVE, LIVE0, rise);
  const livePos: XY = [livePos0[0], livePos0[1] + bob];
  // ---- the copy: lifted off the same pass ------------------------------------------------------------------------
  const flash = Math.max(0, 1 - (t - (q.shot + 0.12)) / 0.35) * (t >= q.shot + 0.12 ? 1 : 0);
  const squeeze = Math.max(0, Math.sin(clamp01((t - q.shot) / 0.14) * Math.PI)) * (t < q.shot + 0.14 ? 1 : 0);
  const peelShot = pr(t, q.shot + 0.25, 0.95, springOut);
  const peel = Math.max(peelOpen, peelShot);
  const peelVec: XY = mix([OPEN_S * 400, 14], [COPY1[0] - LIVE0[0], 0], rise);
  const copyS = liveS, copyAngle = lerp(0, 3, peel) + damped(t, q.fail, 18, 7) * 2.2;
  const copyPos: XY = [livePos[0] + peelVec[0] * peel, livePos[1] + peelVec[1] * peel - Math.sin(Math.min(1, peel) * Math.PI) * 26];
  const frozen = pr(t, q.frozen, 1.1);
  // ---- time: the playhead crosses window A into B and the live code is swapped behind a scan line ------------------
  const travel = Math.max(1.2, q.newcode - q.time);
  const nowU = pr(t, q.time, travel, easeInOut);
  const nowX = lerp(240, 540, nowU);
  const sweep = pr(t, q.newcode - 0.2, 0.9, easeInOut);
  const liveWin = sweep > 0.5 ? 'B' : 'A';
  const bar = t < q.rotating ? 1 : sweep > 0 ? lerp(0.12, 1, pr(t, q.newcode + 0.5, 0.8)) : lerp(1, 0.12, pr(t, q.rotating, Math.max(1, q.newcode - q.rotating), easeInOut));
  const clock = span(t, q.time - 0.1, q.gate, 0.35);
  const clockPop = springOut(pr(t, q.time - 0.1, 0.5, (x) => x));
  const hand = (nowU * 1.6 + (t - q.time) * 0.08) * 360;
  // ---- the reader and the two trips of code data ------------------------------------------------------------------
  const readerIn = pr(t, q.gate, 0.9, springOut);
  const tripOut = Math.min(1.9, Math.max(0.95, q.window - q.checks - 0.1));
  const out = pr(t, q.checks, tripOut, easeInOut);
  const arrive = pr(t, q.checks + tripOut, 0.4, easeInOut);
  const back = pr(t, q.fail + 0.9, 1.0, easeInOut);
  const reject = pr(t, q.fail, 0.3, springOut) * (1 - pr(t, q.open + 0.2, 0.4));
  const inTrip = 0.95;
  const live = pr(t, q.passes - inTrip - 0.05, inTrip, easeInOut);
  const liveArrive = pr(t, q.passes - 0.12, 0.2, easeInOut);
  const accept = pr(t, q.passes, 0.3, springOut);
  const gateOpen = pr(t, q.passes + 0.1, 0.6, springOut);
  const shake = damped(t, q.fail, 20, 6);
  const compare = span(t, q.window, q.fail + 0.4, 0.2);
  // ---- camera ---------------------------------------------------------------------------------------------------
  const wide: Cam = {k: 1, x: 540, y: 928}, onReader: Cam = {k: 1.26, x: 800, y: 900}, followLive: Cam = {k: 1.08, x: 640, y: 910}, onPass: Cam = {k: 1.14, x: 610, y: 900};
  let cam = wide;
  cam = camMix(cam, onReader, pr(t, q.gate, 1.1, easeInOut));
  cam = camMix(cam, followLive, pr(t, q.open - 0.1, 1.0, easeInOut));
  cam = camMix(cam, onPass, pr(t, q.passes - 0.9, 0.9, easeInOut));
  cam = camMix(cam, wide, pr(t, q.harder - 0.1, 1.1, easeInOut));
  // ---- chip positions (world) -------------------------------------------------------------------------------------
  const copyTrip = (u: number): XY => bezier(QR_COPY, [690, 640], LENS, u);
  const liveTrip = (u: number): XY => bezier(QR_LIVE, [520, 596], LENS, u);
  const chipA: XY | null = out > 0 && back < 1 ? (arrive > 0 ? mix(LENS, SLOT_C, arrive) : copyTrip(out)) : null;
  const chipAReturn: XY | null = back > 0 && back < 1 ? bezier(LENS, [680, 640], QR_COPY, back) : null;
  const chipB: XY | null = live > 0 && liveArrive < 1 ? liveTrip(live) : liveArrive >= 1 ? mix(LENS, SLOT_C, 1) : null;
  const chipBSlot = liveArrive >= 1;
  const trailOf = (f: (u: number) => XY, u: number): XY[] => [1, 2, 3, 4, 5].filter((i) => u - 0.05 * i > 0).map((i) => f(clamp01(u - 0.05 * i)));
  // ---- chapter and words ------------------------------------------------------------------------------------------
  const stage = t < q.shot ? 0 : t < q.time ? 1 : t < q.gate ? 2 : t < q.open ? 3 : 4;
  const sub = t < q.shot ? 0 : t < q.time ? 1 : t < q.gate ? 2 : t < q.open ? 3 : t < q.harder ? 4 : t < q.static ? 5 : 6;
  const header = pr(t, settle - 0.05, 0.45);
  const pipIn = pr(t, settle - 0.42, 0.3);
  const strip = span(t, settle, q.resolve, 0.5);
  const staticOn = pr(t, q.static, 0.7, springOut);
  const readsOn = pr(t, q.reads, 0.5);
  const notOn = pr(t, q.notshot, 0.4);
  const camScreen = (w: XY) => camPoint(cam, w, CENTRE);
  const target = (): XY => camScreen(chipA ?? chipB ?? (t < q.gate ? LIVE0 : LENS));
  const mascot = (end?: boolean) => <PipPerformer uid={'ticket-motion-' + (end ? 'end' : 'body')} t={t} fps={p.fps} durationSec={p.timeline.durationSec} score={SCORE} cues={q} segments={Object.fromEntries(p.segments.map((s) => [s.id, s]))} mouth={p.timeline.mouth ?? []} anchor={end ? {ax: 540, ay: 1465, k: 0.38} : {ax: 210, ay: 1480, k: 0.34}} target={target} />;
  const liveStatus = t < q.valid ? '' : 'Ticket still valid ✓';
  const stripY = 556;
  const win = (i: number) => ({x: 90 + i * 300, w: 300});

  return <AbsoluteFill style={{fontFamily: fonts.sans, color: P.ink}}>
    <Backdrop drift={0} />
    <div style={{opacity: header}}><ChapterHeader title={TITLES[sub]} supporting={SUPPORT[sub]} stages={STAGES} active={stage} fonts={fonts} /></div>
    <svg width={1080} height={1920} viewBox="0 0 1080 1920" style={{position: 'absolute', left: 0, top: 0}}>
      <defs><clipPath id="tm-band"><rect x={0} y={BAND.top} width={1080} height={BAND.bottom - BAND.top} /></clipPath></defs>
      {/* the opening teaser sits above the band, so it is drawn unclipped until the camera takes over */}
      {/* time: the window strip with the moving now-marker; fixed on screen so the camera never cuts it */}
        <g opacity={strip}>
          {[0, 1, 2].map((i) => { const w = win(i), allowed = i === 1 && t >= q.window; return <g key={i}>
            <rect x={w.x + 3} y={stripY} width={w.w - 6} height={46} rx={14} fill={allowed ? '#E4EEE8' : '#EFEADF'} stroke={allowed ? G : P.line} strokeWidth={allowed ? 4 : 2} />
            <text x={w.x + w.w / 2} y={stripY + 31} textAnchor="middle" fontFamily={mono} fontWeight={800} fontSize={22} fill={allowed ? G : P.muted}>WINDOW {'ABC'[i]}</text></g>; })}
          {t >= q.window ? <text x={540} y={stripY + 78} textAnchor="middle" fontFamily={mono} fontWeight={800} fontSize={20} fill={G} opacity={pr(t, q.window, 0.4)}>ALLOWED NOW</text> : null}
          <g transform={`translate(${nowX} ${stripY - 10})`} opacity={pr(t, q.rotating, 0.4)}><path d="M0 0V64" stroke={O} strokeWidth={4} /><circle cy={-6} r={15} fill={O} /></g>
        </g>
      <g clipPath="url(#tm-band)"><g transform={camTransform(cam, CENTRE)}>
        <g opacity={1 - 0.78 * staticOn}>
        {/* the live pass */}
        <g transform={`translate(${livePos[0]} ${livePos[1]}) scale(${liveS * (1 - 0.025 * squeeze)})`}>
          <PassCard kind="live" fonts={fonts} window={liveWin} status={liveStatus} tone={G} bar={bar} frozen={0} shadow={10 + 14 * pr(t, q.open - 0.2, 0.5) * (1 - pr(t, q.passes + 0.4, 0.5))}
            code={<Code a={0} b={1} sweep={sweep} reveal={pr(t, 0.9, 1.5, easeInOut)} size={QR_SIZE} uid="live" />} />
          {t >= q.valid ? <g transform={`translate(${CARD.w - 54} 52)`} opacity={pr(t, q.valid, 0.3)}><circle r={22} fill={G} transform={`scale(${springOut(pr(t, q.valid, 0.45, (x) => x))})`} /><path d="M-10 0l7 8 14-16" fill="none" stroke="#fff" strokeWidth={5} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={40} strokeDashoffset={40 * (1 - pr(t, q.valid + 0.15, 0.35))} /></g> : null}
          {t >= q.rotating && t < q.gate ? <g transform={`translate(${QR_AT[0] + QR_SIZE / 2} ${QR_AT[1] + QR_SIZE / 2})`} opacity={pr(t, q.rotating, 0.4)}><circle r={QR_SIZE / 2 + 16} fill="none" stroke={O} strokeWidth={4} strokeDasharray="22 14" transform={`rotate(${(t - q.rotating) * 70})`} /></g> : null}
          {flash > 0 ? <rect width={CARD.w} height={CARD.h} rx={28} fill="#fff" opacity={flash * 0.85} /> : null}
          {accept > 0.05 ? <rect width={CARD.w} height={CARD.h} rx={28} fill="none" stroke={G} strokeWidth={8} opacity={(1 - pr(t, q.passes + 0.5, 0.5)) * accept} /> : null}
        </g>
        {/* the screenshot */}
        {peel > 0.001 ? <g transform={`translate(${copyPos[0]} ${copyPos[1]}) rotate(${copyAngle}) scale(${copyS})`}>
          <PassCard kind="copy" fonts={fonts} window="A" status={t >= q.frozen ? 'Still the old code' : 'The same code'} tone={t >= q.frozen ? R : B} bar={1} frozen={frozen} lock shadow={22 * Math.min(1, peel)}
            code={<Code a={0} size={QR_SIZE} uid="copy" />} />
          {stamp > 0.01 ? <g transform={`translate(${CARD.w / 2} 220) rotate(-14) scale(${0.6 + 0.4 * stamp})`} opacity={stamp}><rect x={-84} y={-30} width={168} height={60} rx={10} fill="#FFFDF8" stroke={R} strokeWidth={5} /><text y={11} textAnchor="middle" fontFamily={mono} fontWeight={800} fontSize={28} fill={R}>OLD CODE</text></g> : null}
        </g> : null}
        {peelShot > 0.4 ? <path d={`M${LIVE0[0] + CARD.w} 860 H${COPY1[0]}`} stroke={B} strokeWidth={5} strokeDasharray="8 10" opacity={pr(t, q.shot + 0.3, 0.4) * (1 - pr(t, q.time, 0.4))} /> : null}
        {t >= q.both && t < q.time + 0.2 ? <g opacity={span(t, q.both, q.time, 0.3)} transform={`translate(${(LIVE0[0] + CARD.w + COPY1[0]) / 2} 880)`}><circle r={22} fill={O} /><path d="M-11 -6H11M-11 6H11" stroke="#fff" strokeWidth={5} strokeLinecap="round" /></g> : null}
        {/* time advances: the clock, which hands over to the reader */}
        {clock > 0.01 ? <g transform={`translate(890 800) scale(${(0.4 + 0.6 * clockPop) * (1 - 0.3 * pr(t, q.gate - 0.1, 0.4))})`} opacity={clock}><circle r={92} fill="#FFFDF8" stroke={O} strokeWidth={6} />{[0, 90, 180, 270].map((a) => <path key={a} d="M0 -80V-68" stroke={O} strokeWidth={5} strokeLinecap="round" transform={`rotate(${a})`} />)}<path d="M0 0V-62" stroke={P.ink} strokeWidth={7} strokeLinecap="round" transform={`rotate(${hand})`} /><path d="M0 0V-38" stroke={O} strokeWidth={8} strokeLinecap="round" transform={`rotate(${hand / 12})`} /><circle r={9} fill={P.ink} /></g> : null}
        {/* the reader */}
        {readerIn > 0.01 ? <g transform={`translate(${READER[0] + (1 - readerIn) * 330 + shake * 9} ${READER[1]})`} opacity={Math.min(1, readerIn * 1.6)}>
          <rect x={6} y={10} width={300} height={440} rx={34} fill="#CFC5B2" opacity={0.25} />
          <rect width={300} height={440} rx={34} fill="#2A2723" />
          <circle cx={150} cy={70} r={44} fill="#3C3731" /><circle cx={150} cy={70} r={30} fill={reject > 0.4 ? R : accept > 0.3 ? G : '#1E1B18'} stroke={compare > 0.2 ? O : '#59524A'} strokeWidth={compare > 0.2 ? 7 : 4} />
          <circle cx={140} cy={60} r={7} fill="#fff" opacity={0.7} />
          {out > 0 && out < 1 ? <circle cx={150} cy={70} r={30 + 50 * out} fill="none" stroke={O} strokeWidth={4} opacity={1 - out} /> : null}
          <text x={150} y={146} textAnchor="middle" fontFamily={mono} fontWeight={800} fontSize={20} letterSpacing={2} fill="#CFC8BB">GATE READER</text>
          <rect x={16} y={158} width={268} height={266} rx={18} fill="#FFFDF8" />
          <text x={30} y={190} fontFamily={mono} fontWeight={800} fontSize={18} fill={P.muted}>ALLOWED WINDOW</text>
          {[0, 1, 2].map((i) => <g key={i}><rect x={28 + i * 86} y={202} width={78} height={46} rx={12} fill={i === 1 && t >= q.window ? '#E4EEE8' : '#F0ECE3'} stroke={i === 1 && t >= q.window ? G : P.line} strokeWidth={i === 1 && t >= q.window ? 4 : 2} /><text x={67 + i * 86} y={234} textAnchor="middle" fontFamily={mono} fontWeight={800} fontSize={24} fill={i === 1 && t >= q.window ? G : P.muted}>{'ABC'[i]}</text></g>)}
          <text x={30} y={284} fontFamily={mono} fontWeight={800} fontSize={18} fill={P.muted}>RECEIVED</text>
          <rect x={28} y={292} width={244} height={62} rx={14} fill={reject > 0.4 ? '#FBE8E2' : accept > 0.3 ? '#E4EEE8' : '#F6F2E9'} stroke={reject > 0.4 ? R : accept > 0.3 ? G : P.line} strokeWidth={3} strokeDasharray={chipA || chipBSlot ? undefined : '10 8'} />
          {chipBSlot || (arrive >= 1 && back < 0.15) ? <text x={150} y={338} textAnchor="middle" fontFamily={mono} fontWeight={800} fontSize={40} fill={chipBSlot ? G : R} opacity={chipBSlot ? 1 : 1 - pr(t, q.fail + 0.8, 0.2)}>{chipBSlot ? 'B' : 'A'}</text> : null}
          <text x={150} y={398} textAnchor="middle" fontFamily={fonts.sans} fontWeight={850} fontSize={accept > 0.3 ? 19 : 23} fill={accept > 0.3 ? G : reject > 0.4 ? R : P.ink2}>{accept > 0.3 ? 'B: TIME CHECK PASSED' : reject > 0.4 ? 'A: OUTSIDE WINDOW' : compare > 0.2 ? 'COMPARING…' : t >= q.gate ? 'WAITING…' : ''}</text>
          {reject > 0.3 ? <g transform={`translate(${-10} 28) scale(${reject})`} opacity={Math.min(1, reject)}><circle r={30} fill={R} /><path d="M-11 -11L11 11M11 -11L-11 11" stroke="#fff" strokeWidth={7} strokeLinecap="round" /></g> : null}
          {accept > 0.3 ? <g transform={`translate(${-10} 28) scale(${accept})`}><circle r={30} fill={G} /><path d="M-13 1l9 10 17-22" fill="none" stroke="#fff" strokeWidth={7} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={50} strokeDashoffset={50 * (1 - pr(t, q.passes + 0.05, 0.35))} /></g> : null}
          <g transform={`translate(0 ${430})`}><rect x={-170 * (1 - 0.72 * gateOpen)} y={-8} width={170 * (1 - 0.72 * gateOpen)} height={16} rx={8} fill={gateOpen > 0 ? G : R} opacity={readerIn} /><circle r={14} fill="#CFC8BB" /></g>
        </g> : null}
        {/* the data that travels */}
        {chipA ? <Chip p={chipA} trail={arrive > 0 ? [] : trailOf(copyTrip, out)} letter="A" color={reject > 0.3 ? R : B} fonts={fonts} s={0.9 + 0.1 * Math.sin(out * Math.PI)} /> : null}
        {chipAReturn ? <Chip p={chipAReturn} trail={trailOf((u) => bezier(LENS, [680, 640], QR_COPY, u), back)} letter="A" color={R} fonts={fonts} o={1 - pr(t, q.fail + 1.7, 0.3)} /> : null}
        {chipB && !chipBSlot ? <Chip p={chipB} trail={trailOf(liveTrip, live)} letter="B" color={G} fonts={fonts} s={0.9 + 0.1 * Math.sin(live * Math.PI)} /> : null}
        {/* reads code data, not the image */}
        {readsOn > 0 && t < q.static + 0.2 ? <g opacity={readsOn * (1 - pr(t, q.static, 0.4))} transform="translate(80 1118)">
          <rect width={430} height={86} rx={22} fill="#E4EEE8" stroke={G} strokeWidth={3} /><text x={24} y={38} fontFamily={mono} fontWeight={800} fontSize={20} fill={G}>READS</text><text x={24} y={68} fontFamily={fonts.sans} fontWeight={850} fontSize={28} fill={P.ink}>the code data</text>
          <g transform="translate(480 0)"><rect width={440} height={86} rx={22} fill="#F3EFE6" stroke={P.line} strokeWidth={3} /><text x={24} y={38} fontFamily={mono} fontWeight={800} fontSize={20} fill={P.muted}>NOT NEEDED</text><text x={24} y={68} fontFamily={fonts.sans} fontWeight={850} fontSize={28} fill={P.muted}>is it a screenshot?</text><path d="M20 58H400" stroke={R} strokeWidth={5} strokeLinecap="round" strokeDasharray={380} strokeDashoffset={380 * (1 - notOn)} /></g>
        </g> : null}
        </g>
        {/* static codes: a different kind of ticket, same rule: follow the issuer */}
        {staticOn > 0.01 ? <g transform={`translate(${160} ${760 + (1 - staticOn) * 140}) scale(1.4)`} opacity={staticOn}>
          <rect width={520} height={150} rx={26} fill="#FFFDF8" stroke={P.line} strokeWidth={3} />
          <text x={24} y={38} fontFamily={mono} fontWeight={800} fontSize={20} fill={P.muted}>STATIC CODE</text>
          {Array.from({length: 26}, (_, i) => <rect key={i} x={26 + i * 10.6} y={54} width={i % 3 === 0 ? 7 : 4} height={66} fill={P.ink} />)}
          <text x={300} y={104} fontFamily={fonts.sans} fontWeight={800} fontSize={22} fill={P.ink2}>same every time</text>
        </g> : null}
      </g></g>
    </svg>
    <div style={{opacity: pipIn}}>{mascot()}</div>
    <div style={{position: 'absolute', left: 470, right: 70, top: 1372, fontSize: 40, lineHeight: 1.14, whiteSpace: 'pre-line', letterSpacing: '-0.03em', fontWeight: 850, color: sub === 3 ? R : sub >= 4 ? G : O, opacity: header}}>{STATUS[sub]}</div>
    <div style={{position: 'absolute', left: 80, right: 80, top: 1750, textAlign: 'center', fontSize: 23, lineHeight: 1.35, color: P.muted, opacity: header}}>Fictional pass. Time compressed; acceptance windows vary.<br />Only applies to supported rotating-code tickets.</div>
    <FullPageTakeaway t={t} start={q.resolve} fonts={fonts} label="KEY TAKEAWAY" counter="STEP 5 / 5" lead="Open the live pass" emphasis="before you queue." emphasisColor={G}
      points={[{label: 'A SAVED PICTURE', text: 'It cannot refresh its own code.', color: R}, {label: 'THE LIMIT', text: 'Static codes and other checks follow the issuer.', color: G}]}
      note="Fictional pass, compressed time. A passing time check does not guarantee entry." mascot={mascot(true)} />
  </AbsoluteFill>;
};
