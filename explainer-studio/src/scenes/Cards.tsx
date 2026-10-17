import React from 'react';
import {useCurrentFrame} from 'remotion';
import {C, FONT, MONO, STAGE} from '../theme';
import {cue, easeBack, lerp, prog, type SceneProps} from '../anim';
import type {CardsParamsT} from '../schema';

const TONE: Record<string, string> = {neutral: C.text, good: C.good, bad: C.bad, code: C.accent};

/** Titled cards that tilt in one at a time (cue card-1..card-4); lines inside reveal in sequence. */
export const Cards: React.FC<SceneProps<CardsParamsT>> = ({params, cues, startFrame}) => {
  const f = useCurrentFrame();
  const {title, cards} = params;
  const titleIn = prog(f, startFrame + 4, 14);
  // Fewer cards get larger type so the stage is always filled.
  const sz = cards.length === 1 ? {h: 56, l: 46, c: 40, pad: 46, lp: 14} : cards.length === 2 ? {h: 48, l: 40, c: 35, pad: 36, lp: 11} : {h: 42, l: 35, c: 31, pad: 28, lp: 7};
  return (
    <div style={{position: 'absolute', left: 0, top: 0, width: 1080, height: 1920, fontFamily: FONT, color: C.text}}>
      <div
        style={{
          position: 'absolute',
          left: STAGE.x + 20,
          width: STAGE.w - 40,
          top: 230,
          fontSize: 58,
          fontWeight: 800,
          lineHeight: 1.1,
          letterSpacing: -1,
          opacity: titleIn,
          transform: `translateY(${lerp(20, 0, titleIn)}px)`,
        }}
      >
        {title}
      </div>
      <div style={{position: 'absolute', left: STAGE.x, top: 400, width: STAGE.w, display: 'flex', flexDirection: 'column', gap: 30, perspective: 1400}}>
        {cards.map((card, i) => {
          const t = cue(cues, `card-${i + 1}`);
          const p = prog(f, t, 18, easeBack);
          const bad = card.lines.some((l) => l.tone === 'bad');
          const accent = bad ? C.bad : C.accent;
          return (
            <div
              key={card.heading}
              style={{
                opacity: Math.min(1, p * 2.2),
                transform: `rotateX(${lerp(24, 0, p)}deg) translateY(${lerp(50, 0, p)}px)`,
                transformOrigin: '50% 0%',
                background: C.panel,
                border: `1.5px solid ${C.line}`,
                borderLeft: `6px solid ${accent}`,
                borderRadius: 26,
                padding: `${sz.pad}px 40px ${sz.pad + 2}px`,
                boxShadow: '0 20px 50px rgba(0,0,0,0.45)',
              }}
            >
              <div style={{display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14}}>
                <div style={{fontSize: sz.h, fontWeight: 750}}>{card.heading}</div>
                {card.tag ? (
                  <div style={{fontFamily: MONO, fontSize: 24, color: accent, border: `1.5px solid ${accent}`, borderRadius: 999, padding: '6px 18px'}}>{card.tag}</div>
                ) : null}
              </div>
              {card.lines.map((l, j) => {
                const lp = prog(f, t + 12 + j * 9, 10);
                const code = l.tone === 'code';
                return (
                  <div
                    key={j}
                    style={{
                      fontSize: code ? sz.c : sz.l,
                      fontFamily: code ? MONO : FONT,
                      color: TONE[l.tone],
                      fontWeight: l.tone === 'neutral' ? 500 : 650,
                      padding: code ? '10px 18px' : `${sz.lp}px 0`,
                      margin: code ? '6px 0' : 0,
                      background: code ? '#0b1220' : 'transparent',
                      borderRadius: 12,
                      opacity: lp,
                      transform: `translateX(${lerp(-18, 0, lp)}px)`,
                    }}
                  >
                    {l.text}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
};
