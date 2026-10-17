import React from 'react';
import {C, CAPTION, FONT} from '../theme';
import {clamp01, easeBack, lerp} from '../anim';
import type {Timeline} from '../schema';

/** Short caption phrase below the main visual; the word being spoken is highlighted. */
export const Captions: React.FC<{timeline: Timeline; t: number}> = ({timeline, t}) => {
  const cap = timeline.captions.find((c) => t >= c.start - 0.02 && t < c.end);
  if (!cap) return null;
  const enter = clamp01((t - (cap.start - 0.02)) / 0.16);
  const s = lerp(0.94, 1, easeBack(enter));
  return (
    <div style={{position: 'absolute', left: 0, right: 0, top: CAPTION.y, display: 'flex', justifyContent: 'center', fontFamily: FONT}}>
      <div
        style={{
          maxWidth: CAPTION.maxW,
          padding: '22px 38px 26px',
          borderRadius: 30,
          background: 'rgba(8,12,20,0.88)',
          border: `1.5px solid ${C.line}`,
          boxShadow: '0 14px 40px rgba(0,0,0,0.45)',
          textAlign: 'center',
          fontSize: 58,
          lineHeight: 1.18,
          fontWeight: 720,
          opacity: enter,
          transform: `scale(${s})`,
        }}
      >
        {cap.words.map((w, i) => {
          const spoken = t >= w.start - 0.02;
          const current = spoken && t < w.end + 0.02;
          return (
            <span key={i} style={{color: current ? C.accent : spoken ? C.text : '#7f90ab'}}>
              {w.text}
              {i < cap.words.length - 1 ? ' ' : ''}
            </span>
          );
        })}
      </div>
    </div>
  );
};
