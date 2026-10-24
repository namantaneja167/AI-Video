// Shot controls for scenes that move a camera: a clipped viewport over a transformed world, a spotlight and masks.
// The scene layer sits under the episode's shared captions and brand header, which are drawn in screen coordinates
// by LibraryEpisode, so nothing here can move them. All of it is a pure function of its props (seeking is exact).
import React from 'react';
import type {Cam, Rect, XY} from './motion';

/** Draws `children` in world coordinates through `cam`, clipped to `clip` (screen coordinates; the default is the whole canvas). */
export const ShotLayer: React.FC<{cam: Cam; clip?: Rect; radius?: number; children?: React.ReactNode}> = ({cam, clip = {x: 0, y: 0, w: 1080, h: 1920}, radius = 0, children}) => {
  const centre: XY = [clip.x + clip.w / 2, clip.y + clip.h / 2];
  return (
    <div style={{position: 'absolute', left: clip.x, top: clip.y, width: clip.w, height: clip.h, overflow: 'hidden', borderRadius: radius}}>
      <div style={{position: 'absolute', left: -clip.x, top: -clip.y, width: 1080, height: 1920, transformOrigin: '0 0', transform: `translate(${centre[0]}px, ${centre[1]}px) scale(${cam.k}) translate(${-cam.x}px, ${-cam.y}px)`}}>{children}</div>
    </div>
  );
};

/** Dims everything around `rect` (in the same coordinates as the element's parent) by `amount` 0 to 1: an evidence highlight. */
export const Spotlight: React.FC<{rect: Rect; amount: number; radius?: number; color?: string; ring?: string}> = ({rect, amount, radius = 24, color = '31,29,26', ring}) => (
  amount <= 0.001 ? null : <div style={{position: 'absolute', left: rect.x, top: rect.y, width: rect.w, height: rect.h, borderRadius: radius, boxShadow: `0 0 0 4000px rgba(${color},${0.52 * amount})`, outline: ring ? `${5 * amount}px solid ${ring}` : undefined, pointerEvents: 'none'}} />
);

/** A circular iris centred on `at` growing to `maxR`; `u` 0 shows nothing, 1 everything. */
export const irisClip = (at: XY, maxR: number, u: number): string => `circle(${Math.max(0, maxR * u)}px at ${at[0]}px ${at[1]}px)`;
/** A left-to-right wipe revealing `u` of the box. */
export const wipeClip = (u: number): string => `inset(0 ${(1 - Math.min(1, Math.max(0, u))) * 100}% 0 0)`;

export const Masked: React.FC<{clip: string; children?: React.ReactNode; style?: React.CSSProperties}> = ({clip, children, style}) => <div style={{position: 'absolute', inset: 0, clipPath: clip, ...style}}>{children}</div>;
