import React from 'react';
import {C, FONT, MONO} from '../theme';
import {clamp01} from '../anim';

export type ConsolePage = {
  from: number; // frame the page starts typing
  text: string;
  cps: number; // characters per frame
  result?: {at: number; text: string; tone?: 'bad' | 'good'};
};

const KEYWORDS = /\b(?:SELECT|FROM|JOIN|ON|WITH|AS|OVER|PARTITION|BY|ORDER|DESC|WHERE|USING|SUM|ROW_NUMBER|COUNT|DISTINCT)\b/;
const TOKEN = new RegExp(`(--.*$|'[^']*'|${KEYWORDS.source}|\\b\\d+\\b)`, 'g');

const Highlighted: React.FC<{line: string}> = ({line}) => {
  const parts = line.split(TOKEN).filter((p) => p !== undefined && p !== '');
  return (
    <>
      {parts.map((p, i) => {
        let color: string = C.text;
        if (p.startsWith('--')) color = C.dim;
        else if (p.startsWith("'")) color = C.amber;
        else if (/^\d+$/.test(p)) color = C.amber;
        else if (KEYWORDS.test(p) && p === p.toUpperCase()) color = C.accent;
        return (
          <span key={i} style={{color}}>
            {p}
          </span>
        );
      })}
    </>
  );
};

/** Terminal strip beside the presenter; pages type out SQL (or comments) as the explanation proceeds. */
export const Console: React.FC<{frame: number; pages: ConsolePage[]; x: number; y: number; w: number; h: number; title?: string}> = ({
  frame,
  pages,
  x,
  y,
  w,
  h,
  title = 'sql',
}) => {
  const page = [...pages].reverse().find((p) => frame >= p.from);
  const typed = page ? Math.min(page.text.length, Math.floor((frame - page.from) * page.cps)) : 0;
  const lines = page ? page.text.slice(0, typed).split('\n') : [];
  const done = page ? typed >= page.text.length : false;
  const cursorOn = Math.floor(frame / 15) % 2 === 0;
  const result = page?.result && frame >= page.result.at ? page.result : undefined;
  const resultIn = result ? clamp01((frame - result.at) / 8) : 0;
  return (
    <div
      style={{
        position: 'absolute',
        left: x,
        top: y,
        width: w,
        height: h,
        borderRadius: 22,
        background: '#080c14',
        border: `1.5px solid ${C.line}`,
        boxShadow: '0 18px 44px rgba(0,0,0,0.5)',
        overflow: 'hidden',
        fontFamily: MONO,
      }}
    >
      <div style={{height: 38, display: 'flex', alignItems: 'center', gap: 8, padding: '0 16px', background: C.panel, borderBottom: `1.5px solid ${C.line}`}}>
        {['#f26d6d', '#f5b942', '#55d68c'].map((c) => (
          <div key={c} style={{width: 12, height: 12, borderRadius: 6, background: c, opacity: 0.8}} />
        ))}
        <div style={{marginLeft: 10, fontFamily: FONT, fontSize: 17, color: C.muted, letterSpacing: 0.5}}>{title}</div>
      </div>
      <div style={{padding: '10px 22px', fontSize: 19, lineHeight: '24px', whiteSpace: 'pre'}}>
        {lines.map((l, i) => (
          <div key={i}>
            <Highlighted line={l} />
            {i === lines.length - 1 && (!done || cursorOn) && !result ? <span style={{color: C.accent}}>▌</span> : null}
          </div>
        ))}
        {result ? (
          <div style={{marginTop: 4, opacity: resultIn, color: result.tone === 'bad' ? C.bad : C.good, fontWeight: 700}}>
            {result.text}
          </div>
        ) : null}
      </div>
    </div>
  );
};
