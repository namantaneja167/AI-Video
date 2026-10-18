import React from 'react';
import {AbsoluteFill} from 'remotion';
import type {z} from 'zod';
import {clamp01, easeBack, easeInOut, easeOut, lerp} from '../../anim';
import {P} from '../../art/palette';
import {Backdrop, Dots, Slab} from '../../art/parts';
import type {ContextWindowParams} from '../params';
import {PipPerformer} from '../pip/PipPerformer';
import {CONTEXT_WINDOW_SCORE} from '../pip/scores/contextWindow';
import type {SceneProps} from '../types';
import {ANCHOR, BAR, CARD, CELL, GRID, HEAD, LEGEND, OUTCOME, cellXY, gridH, gridW} from './contextWindowGeometry';

type Params = z.infer<typeof ContextWindowParams>;

const QUESTION = '#E8772E'; // the visible prompt (Pip's shell orange)
const HISTORY = '#F2B58C'; // earlier conversation, a lighter tone of the same input colour
const REPLY = '#2A2723';
const ORANGE_HI = '#F08B4C';
const pr = (t: number, start: number, dur: number, ease: (x: number) => number = easeOut) => ease(clamp01((t - start) / dur));
/** 1 between a and b, easing in and out over `fade` seconds. */
const win = (t: number, a: number, b: number, fade = 0.35) => pr(t, a, fade, easeInOut) * (1 - pr(t, b, fade, easeInOut));
const chipW = (s: string) => 32 + 24 * s.length;
const dim = (w: number) => 0.4 + 0.6 * w;

const need = (cues: Record<string, number>, name: string): number => {
  const v = cues[name];
  if (v === undefined) throw new Error(`context-window needs the cue "${name}"`);
  return v;
};

/**
 * The AI context-window explainer. One thing is in focus at a time: the window, the prompt cut into pieces, the +16 of earlier
 * chat that joins it, the reply, the shared budget bar, the full window, then the two outcomes with Pip out of frame.
 */
export const ContextWindowScene: React.FC<SceneProps> = ({scene, timeline, segments, cues, t, fps, fonts}) => {
  const p = scene.params as unknown as Params;
  const c = (n: string) => need(cues, n);
  const nIn = p.inputTokens;
  const nOut = p.outputTokens;
  const N = nIn + nOut;
  const pieces = p.pieces;
  const nQ = pieces.length;
  const replyFirst = Math.round(nOut * 0.4);

  // when each slot is taken
  const cellTime = (i: number): number => {
    if (i < nQ) return c('tokens_fly') + i * 0.08 + 0.45;
    if (i < nIn) return lerp(c('history'), c('history_end'), (i - nQ) / Math.max(1, nIn - nQ - 1));
    if (i < nIn + replyFirst) return lerp(c('reply_start'), c('reply_end'), (i - nIn) / Math.max(1, replyFirst - 1));
    if (i < N) return lerp(c('fill_more'), c('full'), (i - nIn - replyFirst) / Math.max(1, nOut - replyFirst - 1));
    return Infinity;
  };
  let usedQ = 0;
  let usedH = 0;
  let usedOut = 0;
  for (let i = 0; i < N; i++) if (t >= cellTime(i)) (i < nQ ? usedQ++ : i < nIn ? usedH++ : usedOut++);
  const used = usedQ + usedH + usedOut;
  const full = used >= p.capacity;

  // one focal point at a time: the rest is dimmed
  const settle = pr(t, c('back') - 0.1, 0.5, easeInOut); // at the end everything is in focus again
  const wHeader = Math.max(settle, win(t, c('window_in') - 0.3, c('label') + 1.9), win(t, c('full') - 0.15, c('full') + 1.4));
  const wGrid = Math.max(settle, win(t, c('window_in') - 0.3, c('window_in') + 1.4), win(t, c('tokens_fly') - 0.2, c('reply_end') + 0.7), win(t, c('fill_more') - 0.2, c('full') + 1.6));
  const wPrompt = win(t, c('prompt_in') - 0.1, c('history_end') + 0.5);
  const wBar = Math.max(settle, win(t, c('input_word') - 0.3, c('share_end') + 0.5));
  const hQ = win(t, c('input_word'), c('output_word') - 0.05, 0.15);
  const hR = win(t, c('output_word'), c('share') + 0.05, 0.15);
  const hAll = win(t, c('share') + 0.1, c('share_end') + 0.4, 0.25);
  const hAny = Math.max(hQ, hR);

  const cardIn = pr(t, c('window_in'), 0.5, easeBack);
  const cardO = pr(t, c('window_in'), 0.3);
  const outcomeO = pr(t, c('leave') + 0.35, 0.35) * (1 - pr(t, c('back') - 0.1, 0.3));
  const labelSwap = pr(t, c('label'), 0.3);
  const marker = pr(t, c('label') + 0.1, 0.4, easeInOut);
  const promptO = pr(t, c('prompt_in'), 0.35) * (1 - pr(t, c('split'), 0.25));
  const chipsO = pr(t, c('split'), 0.25);
  const spread = pr(t, c('split'), 0.45, easeBack);
  const bannerO = pr(t, c('history'), 0.3, easeBack) * (1 - pr(t, c('reply_start'), 0.3));
  const barO = pr(t, c('window_in') + 0.4, 0.4);
  const labelO = pr(t, c('share'), 0.35, easeBack) * (1 - pr(t, c('full'), 0.2));
  const fullO = pr(t, c('full'), 0.3, easeBack);
  const noteO = pr(t, c('window_in') + 0.2, 0.5);
  const pulse = t >= c('share') && t < c('share') + 0.7 ? 1 + 0.02 * Math.sin((Math.PI * (t - c('share'))) / 0.7) : 1;

  // the prompt row (card-relative)
  const rowY = 176;
  const widths = pieces.map((s) => chipW(s.trim()));
  const gap = 10 * spread;
  const total = widths.reduce((a, b) => a + b, 0) + gap * (pieces.length - 1);
  let cx = (CARD.w - total) / 2;
  const chips = pieces.map((s, i) => {
    const x0 = cx;
    cx += widths[i] + gap;
    return {text: s.trim(), x: x0, w: widths[i]};
  });

  const frameW = gridW + 28;
  const frameH = gridH(p.capacity) + 28;

  // pointing (canvas): the label, then the budget bar
  const labelPt: [number, number] = [CARD.x + 330, CARD.y + 92];
  const barPt: [number, number] = [CARD.x + BAR.x + BAR.w / 2, CARD.y + BAR.y + BAR.h / 2];
  const target = (tt: number): [number, number] => {
    const u = easeInOut(clamp01((tt - (c('input_word') - 0.7)) / 0.4));
    return [lerp(labelPt[0], barPt[0], u), lerp(labelPt[1], barPt[1], u)];
  };

  const segMap = Object.fromEntries(segments.map((s) => [s.id, s]));
  const mono = fonts.mono;
  const sansHead: React.CSSProperties = {fontFamily: fonts.sans, fontWeight: 800, letterSpacing: '-0.02em'};
  const monoBold: React.CSSProperties = {fontFamily: mono, fontWeight: 700, letterSpacing: '0.01em'};

  return (
    <AbsoluteFill style={{fontFamily: fonts.sans}}>
      <Backdrop drift={0} />
      <div style={{position: 'absolute', left: 0, right: 0, top: 96, textAlign: 'center', opacity: cardO}}>
        <span style={{display: 'inline-flex', alignItems: 'center', padding: '6px 22px', borderRadius: 999, background: P.amber.fill, border: `2px solid ${P.amber.edge}`, color: P.amber.text, ...monoBold, fontSize: 36, letterSpacing: '0.02em'}}>ILLUSTRATIVE · 1 PIECE = 1 SLOT</span>
      </div>

      <div style={{opacity: cardO * (1 - outcomeO), transform: `translateY(${(1 - cardIn) * -50}px)`}}>
        <Slab x={CARD.x} y={CARD.y} w={CARD.w} h={CARD.h}>
          <div style={{height: HEAD, background: P.strip, borderBottom: `2px solid ${P.line}`, display: 'flex', alignItems: 'center', padding: '0 20px', boxSizing: 'border-box'}}>
            <Dots />
          </div>

          {/* what we are looking at, and how much is used */}
          <div style={{position: 'absolute', left: 44, top: 62, height: 60, width: 600, opacity: dim(wHeader)}}>
            <div style={{position: 'absolute', left: 0, top: 0, ...monoBold, fontSize: 44, letterSpacing: '0.04em', color: P.muted, whiteSpace: 'nowrap', opacity: 1 - labelSwap}}>WHAT THE MODEL SEES</div>
            <div style={{position: 'absolute', left: 0, top: 0, ...monoBold, fontSize: 44, letterSpacing: '0.04em', color: P.ink, whiteSpace: 'nowrap', opacity: labelSwap}}>
              <span style={{position: 'absolute', left: -8, right: -8, top: 30, height: 22, borderRadius: 8, background: 'rgba(240,139,76,0.34)', transformOrigin: '0 50%', transform: `scaleX(${marker})`}} />
              <span style={{position: 'relative'}}>CONTEXT WINDOW</span>
            </div>
          </div>
          <div style={{position: 'absolute', right: 44, top: 52, textAlign: 'right', ...monoBold, fontSize: 72, letterSpacing: '-0.02em', color: full ? P.rose.text : P.ink, opacity: dim(wHeader), transform: `scale(${full ? 1 + 0.06 * Math.sin(Math.PI * clamp01((t - c('full')) / 0.5)) : 1})`, transformOrigin: '100% 50%', whiteSpace: 'nowrap'}}>
            {used} / {p.capacity}
          </div>

          {/* the prompt: whole, then cut into pieces that fly into the first slots */}
          <div style={{position: 'absolute', opacity: dim(wPrompt)}}>
            <div style={{position: 'absolute', left: 0, width: CARD.w, top: rowY - 6, textAlign: 'center', ...sansHead, fontSize: 56, color: P.ink, opacity: promptO, transform: `translateY(${(1 - pr(t, c('prompt_in'), 0.35)) * 14}px)`, whiteSpace: 'nowrap'}}>{p.prompt}</div>
            {chips.map((ch, i) => {
              const start = c('tokens_fly') + i * 0.08;
              const f = pr(t, start, 0.45, easeInOut);
              if (t >= start + 0.45) return null;
              const [tx, ty] = cellXY(i);
              return (
                <div key={i} style={{position: 'absolute', left: lerp(ch.x, tx, f), top: lerp(rowY, ty, f), width: lerp(ch.w, CELL, f), height: lerp(64, CELL, f), borderRadius: 12, background: QUESTION, color: '#FFFFFF', ...monoBold, fontSize: 40, display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: chipsO, boxShadow: '0 3px 0 rgba(60,40,20,0.16)', whiteSpace: 'nowrap'}}>
                  <span style={{opacity: 1 - f}}>{ch.text}</span>
                </div>
              );
            })}
          </div>

          {/* the count, made explicit: the question's pieces plus the earlier chat make the input */}
          <div style={{position: 'absolute', left: 28, width: CARD.w - 56, top: 150, textAlign: 'center', opacity: bannerO, transform: `translateY(${(1 - bannerO) * 10}px)`}}>
            <div style={{...monoBold, fontSize: 72, letterSpacing: '-0.02em', color: P.ink, whiteSpace: 'nowrap'}}>
              <span style={{color: QUESTION}}>{usedQ}</span> + <span style={{color: '#D8814C'}}>{usedH}</span> = {usedQ + usedH}
            </div>
            <div style={{fontFamily: fonts.sans, fontWeight: 800, fontSize: 44, color: P.ink2, whiteSpace: 'nowrap', marginTop: 2}}>
              <span style={{color: QUESTION}}>your question</span> + <span style={{color: '#D8814C'}}>earlier chat</span>
            </div>
          </div>

          {/* the window: a fixed number of slots */}
          <div style={{position: 'absolute', left: 0, top: 0, width: CARD.w, height: CARD.h, opacity: dim(Math.max(wGrid, 0.6 * wBar))}}>
            <div style={{position: 'absolute', left: GRID.x - 14, top: GRID.y - 14, width: frameW, height: frameH, borderRadius: 22, border: `3px dashed ${full ? P.rose.edge : hAll > 0.3 ? ORANGE_HI : P.line}`, boxSizing: 'border-box', transform: `scale(${pulse})`, transformOrigin: '50% 50%'}} />
            {Array.from({length: p.capacity}, (_, i) => {
              const [x, y] = cellXY(i);
              const a = i < N ? easeBack(clamp01((t - cellTime(i)) / 0.18)) : 0;
              const kind = i < nQ ? 'q' : i < nIn ? 'h' : 'r';
              const lit = kind === 'r' ? hR : hQ;
              const o = hAny < 0.01 ? 1 : 1 - 0.65 * hAny * (1 - lit);
              return (
                <div key={i} style={{position: 'absolute', left: x, top: y, width: CELL, height: CELL, borderRadius: 10, background: '#F2EEE4', border: `2px solid ${P.line}`, boxSizing: 'border-box'}}>
                  {a > 0 ? <div style={{position: 'absolute', inset: -2, borderRadius: 10, background: kind === 'q' ? QUESTION : kind === 'h' ? HISTORY : REPLY, transform: `scale(${a})`, opacity: Math.min(1, a * 1.5) * o, boxShadow: lit > 0.3 ? `0 0 0 4px ${ORANGE_HI}, 0 3px 0 rgba(60,40,20,0.16)` : '0 3px 0 rgba(60,40,20,0.16)'}} /> : null}
                </div>
              );
            })}
          </div>

          {/* the shared budget: label, bar, legend */}
          <div style={{position: 'absolute', left: 0, top: 0, width: CARD.w, height: CARD.h, opacity: barO * dim(wBar)}}>
            <div style={{position: 'absolute', left: BAR.x, top: BAR.y - 62, width: BAR.w, height: 56, ...sansHead, fontSize: 44, letterSpacing: '-0.01em', whiteSpace: 'nowrap'}}>
              <span style={{position: 'absolute', left: 0, top: 0, color: P.amber.text, opacity: labelO, transform: `translateY(${(1 - labelO) * 8}px)`}}>one budget: your text + reply</span>
              <span style={{position: 'absolute', left: 0, top: 0, color: P.rose.text, opacity: fullO, transform: `scale(${lerp(0.92, 1, fullO)})`, transformOrigin: '0 50%'}}>full: no slots left</span>
            </div>
            <div style={{position: 'absolute', left: BAR.x, top: BAR.y, width: BAR.w, height: BAR.h, borderRadius: 20, background: '#ECE6D8', overflow: 'hidden', display: 'flex', boxShadow: hAll > 0.3 ? `0 0 0 5px ${ORANGE_HI}` : undefined, transform: `scaleY(${1 + 0.12 * hAll})`}}>
              <div style={{width: `${((usedQ + usedH) / p.capacity) * 100}%`, display: 'flex', opacity: hAny < 0.01 ? 1 : 1 - 0.65 * hAny * (1 - hQ)}}>
                <div style={{width: `${(usedQ / Math.max(1, usedQ + usedH)) * 100}%`, background: QUESTION}} />
                <div style={{flex: 1, background: HISTORY}} />
              </div>
              <div style={{width: `${(usedOut / p.capacity) * 100}%`, background: REPLY, opacity: hAny < 0.01 ? 1 : 1 - 0.65 * hAny * (1 - hR)}} />
            </div>
            {([[QUESTION, 'question', usedQ], [HISTORY, 'earlier chat', usedH], [REPLY, 'reply', usedOut], ['#CFC8B8', 'free', p.capacity - used]] as [string, string, number][]).map(([col, label, n], i) => (
              <div key={i} style={{position: 'absolute', left: LEGEND.x + (i % 2) * 440, top: LEGEND.y + Math.floor(i / 2) * LEGEND.rowH, display: 'flex', alignItems: 'center', gap: 14, ...monoBold, fontSize: 38, color: P.ink2, whiteSpace: 'nowrap'}}>
                <span style={{width: 28, height: 28, borderRadius: 8, background: col, display: 'inline-block'}} />
                <span style={{width: 292}}>{label}</span>
                <span>{n}</span>
              </div>
            ))}
          </div>
        </Slab>
      </div>

      {/* two outcomes, large, while Pip is out of frame */}
      <div style={{opacity: outcomeO}}>
        {OUTCOME.map((o, k) => {
          const at = k === 0 ? c('stop') : c('drop');
          return (
            <Slab key={k} x={o.x} y={o.y} w={o.w} h={o.h - 10}>
              <div style={{height: HEAD, background: P.strip, borderBottom: `2px solid ${P.line}`, display: 'flex', alignItems: 'center', padding: '0 20px', boxSizing: 'border-box'}}>
                <Dots />
              </div>
              <div style={{position: 'absolute', left: 40, top: 66, ...sansHead, fontSize: 72, color: k === 0 ? P.rose.text : P.amber.text, opacity: pr(t, at, 0.3, easeBack), whiteSpace: 'nowrap'}}>{k === 0 ? 'It stops' : 'It drops the oldest'}</div>
              <div style={{position: 'absolute', left: 40, top: 156, fontFamily: fonts.sans, fontWeight: 700, fontSize: 44, color: P.ink2, opacity: pr(t, at, 0.3), whiteSpace: 'nowrap'}}>{k === 0 ? 'no room left to continue' : 'older text falls out of view'}</div>
              <MessageBars kind={k === 0 ? 'stop' : 'drop'} t={t} at={at} width={o.w - 80} />
            </Slab>
          );
        })}
      </div>

      <PipPerformer uid="cw" t={t} fps={fps} durationSec={timeline.durationSec} score={CONTEXT_WINDOW_SCORE} cues={cues} segments={segMap} mouth={timeline.mouth ?? []} anchor={ANCHOR} target={target}>
        {({tip, pointW}) =>
          pointW > 0.4 ? (
            <line x1={tip[0]} y1={tip[1] - 8} x2={target(t)[0]} y2={target(t)[1] + 40} stroke={ORANGE_HI} strokeWidth={6} strokeLinecap="round" strokeDasharray="2 14" opacity={0.6 * pointW} />
          ) : null
        }
      </PipPerformer>

      <div style={{position: 'absolute', left: 60, right: 60, top: 1690, textAlign: 'center', fontFamily: fonts.sans, fontSize: 36, fontWeight: 700, color: P.muted, opacity: noteO, lineHeight: 1.3}}>{p.note}</div>
    </AbsoluteFill>
  );
};

/** Message-like bars (made of small pieces): the stop outcome fills the box; the drop outcome pushes the oldest bar out. */
const MessageBars: React.FC<{kind: 'stop' | 'drop'; t: number; at: number; width: number}> = ({kind, t, at, width}) => {
  const pitch = 64;
  const top = 250;
  const barH = 52;
  const pattern = [[58, 40, 72, 48, 64, 52], [44, 70, 38, 60, 46, 66], [62, 50, 44, 76, 40, 58], [50, 64, 56, 42, 70, 48], [56, 44, 64, 52, 60, 46]];
  const colors = [QUESTION, HISTORY, HISTORY, REPLY, REPLY];
  const k = width / 400;
  const bar = (idx: number, y: number, o: number, key: string, dashed = false) => (
    <div key={key} style={{position: 'absolute', left: 40, top: y, width, height: barH, display: 'flex', gap: 8, opacity: o, outline: dashed ? `4px dashed ${P.rose.edge}` : undefined, outlineOffset: dashed ? 4 : undefined, borderRadius: 12}}>
      {pattern[idx % pattern.length].map((w, i) => (
        <div key={i} style={{width: w * k, height: barH, borderRadius: 12, background: colors[idx % colors.length], opacity: dashed ? 0 : 1}} />
      ))}
      {dashed ? <div style={{position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: P.rose.text, fontWeight: 800, fontSize: 44}}>✕</div> : null}
    </div>
  );
  if (kind === 'stop') {
    const o = pr(t, at, 0.4);
    return (
      <>
        {[0, 1, 2, 3].map((i) => bar(i, top + i * pitch, o, `s${i}`))}
        {bar(4, top + 4 * pitch, pr(t, at + 0.3, 0.3, easeBack), 'over', true)}
      </>
    );
  }
  const u = pr(t, at + 0.2, 0.6, easeInOut);
  return (
    <div style={{position: 'absolute', left: 0, top: top - 8, width: width + 80, height: pitch * 4 + 4, overflow: 'hidden'}}>
      <div style={{position: 'absolute', left: 0, top: -(top - 8)}}>
        {[0, 1, 2, 3].map((i) => bar(i, top + (i - u) * pitch, i === 0 ? 1 - u : 1, `d${i}`))}
        {bar(4, top + (4 - u) * pitch, u, 'new')}
      </div>
    </div>
  );
};
