import React from 'react';
import {PipFigure} from '../../art/pip-layers/PipFigure';
import {bodyTransform, tipOf, toScreen, type Anchor} from '../../art/pip-scene/rig';
import type {P} from '../../art/pip-layers/geometry';
import {performScore, type PipScore} from './score';

/**
 * Pip, performed from a score: floor shadow, the layered figure under the body transform. The figure and the shadow's
 * look are the prototype's; where he stands, and what he does, come from the score and the anchor.
 * Returns the full-canvas SVG layer plus the screen position of his pointing fingertip through `onTip` (for pointer lines).
 */
export const PipPerformer: React.FC<{
  uid: string;
  t: number;
  fps: number;
  durationSec: number;
  score: PipScore;
  cues: Record<string, number>;
  segments: Record<string, {start: number; end: number}>;
  mouth: number[];
  anchor: Anchor;
  target: (t: number) => P;
  children?: (info: {tip: P; pointW: number; anchor: Anchor; body: {ax: number; ay: number; by: number}}) => React.ReactNode;
}> = ({uid, t, fps, durationSec, score, cues, segments, mouth, anchor, target, children}) => {
  const pose = performScore(t, score, {cues, segments, mouth, fps, durationSec, anchor, target});
  const b = pose.body;
  const tip = toScreen(b, tipOf(pose.spec.hands[1].pose));
  const shK = 1 + b.by * 0.004;
  const fid = `floorsh-${uid}`;
  return (
    <svg width={1080} height={1920} viewBox="0 0 1080 1920" style={{position: 'absolute', left: 0, top: 0}}>
      <defs>
        <filter id={fid} x="-30%" y="-200%" width="160%" height="500%">
          <feGaussianBlur stdDeviation="9" />
        </filter>
      </defs>
      <ellipse cx={b.ax + 6} cy={b.ay + 48 * b.k} rx={345 * b.k * 0.92 * shK} ry={34 * b.k} fill="#5b5e66" opacity={0.42} filter={`url(#${fid})`} />
      {children ? children({tip, pointW: pose.pointW, anchor: b, body: b}) : null}
      <g transform={bodyTransform(b)}>
        <PipFigure uid={uid} spec={pose.spec} />
      </g>
    </svg>
  );
};
