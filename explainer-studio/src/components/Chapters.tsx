import React from 'react';
import {C, FONT, SAFE} from '../theme';
import {clamp01} from '../anim';

export const Chapters: React.FC<{chapters: {label: string; start: number}[]; t: number}> = ({chapters, t}) => {
  if (chapters.length === 0) return null;
  let active = 0;
  chapters.forEach((c, i) => {
    if (t >= c.start - 1e-6) active = i;
  });
  return (
    <div style={{position: 'absolute', left: SAFE.left, right: 1080 - SAFE.right, top: SAFE.top, display: 'flex', gap: 10, justifyContent: 'center', fontFamily: FONT}}>
      {chapters.map((c, i) => {
        const isActive = i === active;
        const done = i < active;
        const fill = clamp01(isActive ? 1 : done ? 1 : 0);
        return (
          <div
            key={c.label}
            style={{
              padding: '10px 20px',
              borderRadius: 999,
              fontSize: 23,
              fontWeight: 650,
              letterSpacing: 0.2,
              color: isActive ? '#06222b' : done ? C.muted : C.dim,
              background: isActive ? C.accent : C.panel,
              border: `1.5px solid ${isActive ? C.accent : C.line}`,
              opacity: 0.55 + 0.45 * fill,
            }}
          >
            {c.label}
          </div>
        );
      })}
    </div>
  );
};
