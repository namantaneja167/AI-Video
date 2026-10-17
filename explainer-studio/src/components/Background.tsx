import React from 'react';
import {AbsoluteFill, useCurrentFrame} from 'remotion';
import {C} from '../theme';

/** Dark gradient with a slow perspective grid floor for depth. */
export const Background: React.FC = () => {
  const f = useCurrentFrame();
  const drift = (f * 0.35) % 80;
  return (
    <AbsoluteFill style={{background: `radial-gradient(ellipse at 50% 0%, #14203a 0%, ${C.bg2} 38%, ${C.bg} 75%)`}}>
      <div
        style={{
          position: 'absolute',
          left: -400,
          right: -400,
          bottom: -260,
          height: 1100,
          transform: 'perspective(760px) rotateX(64deg)',
          transformOrigin: '50% 100%',
          backgroundImage: `linear-gradient(${C.line} 1.5px, transparent 1.5px), linear-gradient(90deg, ${C.line} 1.5px, transparent 1.5px)`,
          backgroundSize: '80px 80px',
          backgroundPosition: `0 ${drift}px`,
          opacity: 0.32,
          WebkitMaskImage: 'linear-gradient(to top, black 10%, transparent 85%)',
          maskImage: 'linear-gradient(to top, black 10%, transparent 85%)',
        }}
      />
    </AbsoluteFill>
  );
};
