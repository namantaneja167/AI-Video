import React from 'react';
import {AbsoluteFill} from 'remotion';
import type {z} from 'zod';
import {P} from '../../art/palette';
import {Backdrop} from '../../art/parts';
import {clamp01, easeInOut, easeOut, lerp} from '../../anim';
import {ChapterHeader, FullPageTakeaway} from '../chapters';
import type {TokenJourneyParams} from '../params';
import {PipPerformer} from '../pip/PipPerformer';
import type {NumKey, PipScore} from '../pip/score';
import type {SceneProps} from '../types';

type Params = z.infer<typeof TokenJourneyParams>;
const ORANGE = '#E8772E', GREEN = '#277565', RED = '#B94F43', BLUE = '#547A92';
const pr = (t: number, a: number, d = 0.35, ease: (x: number) => number = easeOut) => ease(clamp01((t - a) / d));
/** 1 from `a` until `b`, easing in and out. */
const win = (t: number, a: number, b: number, fade = 0.3) => pr(t, a, fade) * (1 - pr(t, b, fade));
const c = (cue: string, dt = 0) => ({cue, dt});
const k = (...pairs: NumKey[]) => pairs;
const hold = (v: number): NumKey[] => [[{t: 0}, v], [{dur: true}, v]];

export const TOKEN_SCORE: PipScore = {
  look: {
    x: k([{t: 0}, 0], [c('intro', 0.4), 0.3], [c('split'), 0.1], [c('numbers'), 0.5], [c('count'), 0.4], [c('language'), 0.1], [c('check'), 0.3], [c('resolve'), 0]),
    y: k([{t: 0}, 0], [c('intro', 0.4), -0.4], [c('split'), -0.5], [c('language'), -0.2], [c('resolve'), 0]),
  },
  wide: k([{t: 0}, 1], [c('hindi'), 1], [c('hindi', 0.2), 1.16], [c('other'), 1.02], [c('resolve'), 1]),
  browL: k([{t: 0}, -4], [c('split'), 5], [c('break'), -6], [c('language'), -8], [c('hindi'), 6], [c('other'), -4]),
  browR: k([{t: 0}, -6], [c('split'), -10], [c('break'), -8], [c('language'), -10], [c('hindi'), -22], [c('other'), -6]),
  browLflat: hold(0), lidL: hold(0.03), lidR: hold(0.02),
  smile: k([{t: 0}, 0.6], [c('split'), 0.3], [c('break'), 0.7], [c('numbers'), 1], [c('count'), 0.6], [c('hindi'), -0.1], [c('check'), 0.8], [c('resolve'), 1]),
  smirk: k([{t: 0}, 0], [c('numbers'), 0.3], [c('count'), 0], [c('resolve'), 0.2]),
  tilt: k([{t: 0}, 0], [c('split'), -3], [c('numbers'), 2], [c('hindi'), -4], [c('check'), 0]),
  hop: k([{t: 0}, 0], [c('break'), 0], [c('break', 0.14), -10], [c('break', 0.45), 0], [c('hindi'), 0], [c('hindi', 0.12), -9], [c('hindi', 0.4), 0]),
  nod: k([{t: 0}, 0], [c('check', 0.2), 0], [c('check', 0.35), 7], [c('check', 0.65), 0]),
  squash: hold(1),
  blinks: [c('intro', 0.9), c('split', 0.6), c('numbers', 0.6), c('count', 0.6), c('check', 0.8)],
  autoBlink: {everySec: 4.5, startSec: 2.2},
  pointW: k([{t: 0}, 0], [c('break', -0.18), 0], [c('break'), 1], [c('jio', 1.2), 1], [c('jio', 1.6), 0], [c('hindi', -0.15), 0], [c('hindi'), 1], [c('hindi', 1.3), 1], [c('hindi', 1.65), 0]),
  handL: [[{t: 0}, 'restL']],
  handR: [[{t: 0}, 'restR'], [c('break', -0.25), 'restR'], [c('break'), 'tip'], [c('jio', 1.2), 'tip'], [c('jio', 1.7), 'restR'], [c('hindi', -0.2), 'restR'], [c('hindi'), 'tip'], [c('hindi', 1.3), 'tip'], [c('hindi', 1.7), 'restR']],
  idle: {bobPx: 2, periodSec: 4.2, tiltDeg: 0.3},
};

// ---- layout: the same pieces drawn first as plain text, then as separate chips -------------------------------------
/** Advance of one character of the mono face at the size used here. */
const CW = 24, PAD = 18, GAP = 10, ROW = 132, TEXT_ROW = 56, CHIP_H = 72, MAX_CHIP_W = 840;
const lead = (s: string) => s.startsWith(' ');
type XY = {x: number; y: number};

/** Which line each piece sits on: lines are filled with fully separated chips, and the plain text keeps the same lines. */
export function rowsOf(pieces: readonly string[]): number[] {
  const rows: number[] = [];
  let x = 0, row = 0;
  for (const s of pieces) {
    const w = s.length * CW + 2 * PAD;
    if (x > 0 && x + w > MAX_CHIP_W) { x = 0; row++; }
    rows.push(row);
    x += w + GAP;
  }
  return rows;
}

/**
 * Where each piece's own text starts. `e[i]` is how far piece i has separated (0 = still plain text, 1 = a chip), so a
 * piece that separates pushes the ones after it along their line instead of overlapping them.
 * A leading space is a column of its own, shown as a dot once the piece is a chip; at the start of a line it is not drawn.
 */
export function flowLayout(pieces: readonly string[], e: readonly number[]): XY[] {
  const rows = rowsOf(pieces);
  const out: XY[] = [];
  let x = 0;
  pieces.forEach((s, i) => {
    if (i > 0 && rows[i] !== rows[i - 1]) x = 0;
    const first = i === 0 || rows[i] !== rows[i - 1];
    const start = x + PAD * e[i] - (first && lead(s) ? CW * (1 - e[i]) : 0);
    out.push({x: start, y: rows[i] * lerp(TEXT_ROW, ROW, e[i])});
    x += s.length * CW - (first && lead(s) ? CW * (1 - e[i]) : 0) + (2 * PAD + GAP) * e[i];
  });
  return out;
}

/** Words of the typed message, for the word counter. */
export const lookupWordsOf = (text: string): number => text.split(/\s+/).filter(Boolean).length;

const STAGES = ['TEXT', 'SPLIT', 'NUMBERS', 'COUNT', 'CHECK'] as const;
const PHASES = ['intro', 'split', 'break', 'numbers', 'count', 'language', 'other', 'check', 'resolve'] as const;
export type TokenPhase = (typeof PHASES)[number];

/** Pure, so the stage that is highlighted can be tested against the narration cues. */
export function tokenState(t: number, q: Record<string, number>): {phase: TokenPhase; step: number} {
  const has = (n: string) => t >= q[n];
  const phase: TokenPhase = has('resolve') ? 'resolve' : has('check') ? 'check' : has('other') ? 'other' : has('language') ? 'language' : has('count') ? 'count' : has('numbers') ? 'numbers' : has('break') ? 'break' : has('split') ? 'split' : 'intro';
  const step = has('check') ? 4 : has('count') ? 3 : has('numbers') ? 2 : has('split') ? 1 : 0;
  return {phase, step};
}

const HEADINGS: Record<TokenPhase, string> = {
  intro: 'ONE MESSAGE.', split: 'CUT INTO TOKENS', break: 'WORDS CAN BREAK', numbers: 'PIECES TO IDS', count: 'COUNT TOKENS',
  language: 'LANGUAGE MATTERS', other: 'MODELS DIFFER', check: 'CHECK FIRST', resolve: 'Count tokens.\nNot words.',
};
const SUPPORTING: Record<TokenPhase, string> = {
  intro: 'Eight words. What does the AI see?', split: 'A tokenizer cuts text into pieces.', break: 'This tokenizer cuts Remind and Jio apart.',
  numbers: 'Each piece becomes an ID number.', count: 'Eight words became ten tokens.', language: 'Same request, different counts.',
  other: 'Another tokenizer cuts it differently.', check: 'Check the token count before sending.', resolve: 'THE TAKEAWAY',
};
const STATUS: Record<TokenPhase, string> = {
  intro: 'Words are what\nyou see.', split: 'Pieces are what\nthe AI gets.', break: 'Common words stay whole.\nOthers break up.', numbers: 'Only numbers\ngo in.',
  count: 'Tokens, not words,\nare counted.', language: 'The count depends\non the language.', other: 'And on the\nmodel.', check: 'Count first.\nThen send.', resolve: 'Count tokens.\nNot words.',
};

const stat = (x: number, y: number, w: number, label: string, value: string, color: string, fonts: {mono: string}, opacity = 1) => (
  <g transform={`translate(${x} ${y})`} opacity={opacity}>
    <rect width={w} height={118} rx={26} fill="#FFFDF8" stroke={color} strokeWidth={3} />
    <text x={28} y={44} fontSize={26} fontWeight={750} fontFamily={fonts.mono} fill={P.muted}>{label}</text>
    <text x={28} y={98} fontSize={62} fontWeight={850} fontFamily={fonts.mono} letterSpacing="-0.04em" fill={color}>{value}</text>
  </g>
);

export const TokenJourneyScene: React.FC<SceneProps> = ({scene, timeline, segments, cues: q, t, fps, fonts}) => {
  for (const n of ['intro', 'type', 'words', 'split', 'pieces', 'break', 'jio', 'numbers', 'model', 'count', 'ten', 'language', 'english', 'hindi', 'other', 'check', 'resolve']) {
    if (!Number.isFinite(q[n])) throw new Error(`token-journey needs cue ${n}`);
  }
  const p = scene.params as unknown as Params;
  const {pieces, ids, text} = p.example;
  const words = lookupWordsOf(text);
  const {phase, step} = tokenState(t, q);
  const cl = React.useMemo(() => flowLayout(pieces, pieces.map(() => 1)), [pieces]);
  const small: React.CSSProperties = {fontFamily: fonts.mono, fontSize: 36, fontWeight: 700, letterSpacing: '0.03em'};
  const segMap = Object.fromEntries(segments.map((g) => [g.id, g]));
  const enter = pr(t, q.intro - 0.2, 0.6);

  // each piece separates from the text on its own beat, left to right
  const e = pieces.map((_, i) => pr(t, q.split + i * 0.12, 0.7, easeInOut));
  const formed = e.filter((v) => v >= 0.5).length;
  const idIn = pieces.map((_, i) => pr(t, q.numbers + i * 0.1, 0.4));
  const chipText = 1 - 0.72 * pr(t, q.model, 0.5);
  const typed = Math.floor(text.length * pr(t, q.type - 0.15, Math.max(0.6, q.words - q.type + 0.2), (x) => x));

  const origin = {x: 112, y: 676};
  /** Where the piece's own text starts (its leading space, if any, is the column before it). */
  const flow = flowLayout(pieces, e);
  const posOf = (i: number): XY => ({x: origin.x + flow[i].x, y: origin.y + flow[i].y});
  const widthOf = (i: number) => pieces[i].length * CW + 2 * PAD;
  const groupBox = (a: number, b: number, on: number) => {
    const x0 = origin.x + cl[a].x - PAD, x1 = origin.x + cl[b].x - PAD + widthOf(b), y = origin.y + cl[a].y - 46;
    return <rect x={x0 - 8} y={y - 8} width={x1 - x0 + 16} height={CHIP_H + 16} rx={22} fill="none" stroke={ORANGE} strokeWidth={5} opacity={on} />;
  };
  const showIds = ids.map(String);
  const modelOn = win(t, q.model, q.count, 0.35);
  const boxesOn = Math.max(pr(t, q.words, 0.4) * (1 - pr(t, q.model, 0.3)), pr(t, q.count, 0.4));
  const maxBar = Math.max(p.comparison.english.tokens, p.comparison.hindi.tokens);
  const barW = (n: number, at: number) => 330 * (n / maxBar) * pr(t, at, 0.7, easeInOut);
  const langOn = win(t, q.language, q.check, 0.3);
  const otherOn = 0;
  const checkOn = win(t, q.check, q.resolve, 0.3);

  return <AbsoluteFill style={{fontFamily: fonts.sans}}>
    <Backdrop drift={0} />
    {!scene.openingHook ? <div style={{position: 'absolute', top: 108, left: 80, right: 80, display: 'flex', alignItems: 'center', justifyContent: 'space-between'}}>
      <span style={{...small, color: ORANGE}}>PIP EXPLAINS</span><span style={{...small, color: P.muted}}>TOKENS</span>
    </div> : null}
    <ChapterHeader title={HEADINGS[phase]} supporting={SUPPORTING[phase]} stages={STAGES} active={step} fonts={fonts} />
    <svg width={1080} height={1920} viewBox="0 0 1080 1920" style={{position: 'absolute', left: 0, top: 0, opacity: enter, transform: `translateY(${(1 - enter) * 24}px)`}}>
      {/* the message and its pieces share one card: the text is cut where the tokenizer cuts it */}
      <rect x={85} y={526} width={920} height={420} rx={34} fill="#D9D0BF" opacity={0.35} />
      <rect x={80} y={520} width={920} height={420} rx={34} fill="#FFFDF8" stroke={BLUE} strokeWidth={4} />
      <text x={112} y={574} fontSize={28} fontWeight={800} fontFamily={fonts.mono} fill={BLUE}>{t >= q.split ? 'TOKENS' : 'YOU TYPE'}</text>
      {t >= q.words ? <g opacity={pr(t, q.words, 0.4)}><rect x={300} y={544} width={150} height={44} rx={22} fill="#E8EFF1" /><text x={375} y={575} textAnchor="middle" fontSize={26} fontWeight={800} fontFamily={fonts.mono} fill={BLUE}>{words} words</text></g> : null}
      <text x={968} y={576} textAnchor="end" fontSize={28} fontWeight={800} fontFamily={fonts.mono} fill={ORANGE} opacity={win(t, q.break, q.jio, 0.25)}>Remind = Rem + ind</text>
      <text x={968} y={576} textAnchor="end" fontSize={28} fontWeight={800} fontFamily={fonts.mono} fill={ORANGE} opacity={win(t, q.jio, q.numbers, 0.25)}>Jio = J + io</text>
      {pieces.map((s, i) => {
        const pos = posOf(i);
        const visible = lead(s) ? s.slice(1) : s;
        // the typed-in text reveals by character before the cut
        const startChar = pieces.slice(0, i).join('').length;
        const shown = Math.max(0, Math.min(visible.length, typed - startChar - (lead(s) ? 1 : 0)));
        return <g key={i}>
          <rect x={pos.x - PAD * e[i]} y={pos.y - 46} width={(s.length * CW + 2 * PAD) * e[i]} height={CHIP_H} rx={20} fill={BLUE} fillOpacity={0.14 * e[i]} stroke={BLUE} strokeWidth={2.5} strokeOpacity={e[i]} />
          {lead(s) ? <text x={pos.x} y={pos.y} fontSize={40} fontFamily={fonts.mono} fill={BLUE} opacity={e[i]} fontWeight={700}>·</text> : null}
          <text x={pos.x + (lead(s) ? CW : 0)} y={pos.y} fontSize={40} fontFamily={fonts.mono} fontWeight={600} fill={P.ink} opacity={chipText}>{visible.slice(0, shown)}</text>
          {idIn[i] > 0 ? <text x={origin.x + cl[i].x - PAD + widthOf(i) / 2} y={origin.y + cl[i].y + 62} textAnchor="middle" fontSize={30} fontWeight={800} fontFamily={fonts.mono} fill={ORANGE} opacity={idIn[i]}>{showIds[i]}</text> : null}
        </g>;
      })}
      {groupBox(0, 1, win(t, q.break, q.jio, 0.25))}
      {groupBox(6, 7, win(t, q.jio, q.numbers, 0.25))}
      <text x={112} y={914} fontSize={24} fontWeight={650} fill={P.muted} opacity={pr(t, q.split, 0.5)}>{p.tokenizer.name} · {p.tokenizer.note}</text>

      {/* words and tokens, side by side, and what the model is given */}
      {boxesOn > 0.01 ? <g opacity={boxesOn}>
        {stat(80, 966, 420, 'WORDS', String(words), BLUE, fonts)}
        {t >= q.split ? stat(580, 966, 420, 'TOKENS', String(t >= q.count ? pieces.length : formed), ORANGE, fonts, pr(t, q.split, 0.4)) : null}
        {t >= q.ten ? <text x={540} y={1038} textAnchor="middle" fontSize={54} fontWeight={850} fill={RED} opacity={pr(t, q.ten, 0.3)}>≠</text> : null}
      </g> : null}
      {modelOn > 0.01 ? <g opacity={modelOn} transform="translate(80 966)"><rect width={920} height={118} rx={26} fill="#FFFDF8" stroke={ORANGE} strokeWidth={3} />
        <text x={28} y={40} fontSize={26} fontWeight={750} fontFamily={fonts.mono} fill={P.muted}>THE MODEL GETS</text>
        <text x={28} y={78} fontSize={28} fontWeight={800} fontFamily={fonts.mono} fill={ORANGE}>[{showIds.slice(0, 5).join(', ')},</text>
        <text x={28} y={108} fontSize={28} fontWeight={800} fontFamily={fonts.mono} fill={ORANGE}> {showIds.slice(5).join(', ')}]</text></g> : null}

      {/* language, other models, check */}
      {langOn > 0.01 ? <g opacity={langOn} transform="translate(410 1104)"><rect width={590} height={176} rx={28} fill="#FFFDF8" stroke={P.line} strokeWidth={2} />
        <text x={28} y={50} fontSize={30} fontWeight={750} fill={P.ink}>{p.comparison.english.text}</text>
        <rect x={28} y={64} width={barW(p.comparison.english.tokens, q.english)} height={24} rx={12} fill={GREEN} />
        <text x={44 + barW(p.comparison.english.tokens, q.english)} y={85} fontSize={26} fontWeight={800} fontFamily={fonts.mono} fill={GREEN} opacity={pr(t, q.english + 0.6, 0.3)}>{p.comparison.english.tokens} tokens</text>
        <text x={28} y={132} fontSize={30} fontWeight={750} fill={P.ink} opacity={pr(t, q.hindi - 0.3, 0.3)}>{p.comparison.hindi.text}</text>
        <rect x={28} y={146} width={barW(p.comparison.hindi.tokens, q.hindi)} height={24} rx={12} fill={RED} />
        <text x={44 + barW(p.comparison.hindi.tokens, q.hindi)} y={167} fontSize={26} fontWeight={800} fontFamily={fonts.mono} fill={RED} opacity={pr(t, q.hindi + 0.6, 0.3)}>{p.comparison.hindi.tokens} tokens</text></g> : null}
      {otherOn > 0.01 ? <g opacity={otherOn} transform="translate(410 1104)"><rect width={590} height={176} rx={28} fill="#FFFDF8" stroke={P.line} strokeWidth={2} />
        <text x={28} y={46} fontSize={28} fontWeight={750} fontFamily={fonts.mono} fill={P.muted}>ANOTHER TOKENIZER</text>
        {[0, 1, 2, 3].map((i) => <g key={i} transform={`translate(${28 + i * 138} 62)`}><rect width={120} height={52} rx={16} fill="none" stroke={P.muted} strokeWidth={3} strokeDasharray="9 9" /><text x={60} y={38} textAnchor="middle" fontSize={30} fontWeight={800} fill={P.muted}>?</text></g>)}
        <text x={28} y={144} fontSize={25} fontWeight={650} fill={P.ink2}>Different pieces, ids and counts.</text><text x={28} y={170} fontSize={25} fontWeight={650} fill={P.ink2}>Not shown here.</text></g> : null}
      {checkOn > 0.01 ? <g opacity={checkOn} transform="translate(410 1104)"><rect width={590} height={176} rx={28} fill="#FFFDF8" stroke={GREEN} strokeWidth={3} />
        {['TEXT', 'COUNT', 'SEND'].map((label, i) => {
          const on = pr(t, q.check + 0.25 + i * 0.45, 0.35);
          return <g key={label} transform={`translate(${28 + i * 182} 52)`} opacity={on}>
            <rect width={166} height={72} rx={20} fill={i === 1 ? '#E6F0E9' : '#F0ECE3'} stroke={i === 1 ? GREEN : P.line} strokeWidth={2.5} />
            <text x={83} y={45} textAnchor="middle" fontSize={28} fontWeight={800} fontFamily={fonts.mono} fill={i === 1 ? GREEN : P.ink2}>{label}</text>
            {i < 2 ? <path d="M170 36 H178" stroke={P.muted} strokeWidth={5} strokeLinecap="round" /> : null}
          </g>;
        })}
        <text x={28} y={158} fontSize={24} fontWeight={650} fill={P.ink2} opacity={pr(t, q.check + 1.9, 0.4)}>Example: this message, same tokenizer.</text></g> : null}
    </svg>
    <PipPerformer uid="token-pip" t={t} fps={fps} durationSec={timeline.durationSec} score={TOKEN_SCORE} cues={q} segments={segMap} mouth={timeline.mouth ?? []} anchor={{ax: 270, ay: 1490, k: 0.44}} target={() => [540, 800]} />
    <div style={{position: 'absolute', left: 510, right: 80, top: 1360, fontSize: 43, lineHeight: 1.15, whiteSpace: 'pre-line', letterSpacing: '-0.035em', fontWeight: 850, color: phase === 'language' ? RED : phase === 'check' || phase === 'numbers' ? GREEN : ORANGE}}>{STATUS[phase]}</div>
    <div style={{position: 'absolute', left: 80, right: 80, top: 1750, color: P.muted, fontSize: 25, lineHeight: 1.4, textAlign: 'center'}}>Splits and counts: {p.tokenizer.name}. Other models differ.<br />Illustrative example message.</div>
    <FullPageTakeaway t={t} start={q.resolve} fonts={fonts} label="KEY TAKEAWAY" counter="STEP 5 / 5" lead="Count tokens," emphasis="not words." emphasisColor={GREEN}
      points={[{label: 'CHECK', text: "Use your model's tokenizer.", color: ORANGE}, {label: 'EXPECT', text: 'Counts vary by model and language.', color: GREEN}]}
      note={'Splits shown come from one tokenizer: ' + p.tokenizer.name + '.\nOther models give different pieces and counts.'}
      mascot={<PipPerformer uid="token-takeaway-pip" t={t} fps={fps} durationSec={timeline.durationSec} score={TOKEN_SCORE} cues={q} segments={segMap} mouth={timeline.mouth ?? []} anchor={{ax: 540, ay: 1465, k: 0.38}} target={() => [540, 600]} />} />
  </AbsoluteFill>;
};
