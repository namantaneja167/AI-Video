import React from 'react';
import {easeBack, clamp01, easeOut} from '../anim';
import type {FontSet} from './fonts';
import type {TlCaption} from './types';

const ORANGE_HI = '#F08B4C';
const pr = (t: number, start: number, dur: number, ease: (x: number) => number = easeOut) => ease(clamp01((t - start) / dur));

/** The active caption at time t with its fade values, using the prototype's timing rules (the last caption lingers). */
export function activeCaption(captions: TlCaption[], t: number): {cap: TlCaption; opacity: number; lift: number} | null {
  for (let i = 0; i < captions.length; i++) {
    const cap = captions[i];
    const start = cap.words[0].start;
    const end = cap.words[cap.words.length - 1].end;
    const last = i === captions.length - 1;
    if (t >= start - 0.04 && t < end + (last ? 0.5 : 0.08)) {
      const capIn = pr(t, start - 0.04, 0.14, easeBack);
      const capOut = 1 - pr(t, end + (last ? 0.2 : -0.05), 0.2);
      return {cap, opacity: capIn * capOut, lift: (1 - capIn) * 14};
    }
  }
  return null;
}

/** Dark caption pill, white text, orange emphasis. Plain text plus word ranges; no markup inside the text. */
export const PipCaption: React.FC<{cap: TlCaption; opacity: number; lift: number; fonts: FontSet; top?: number}> = ({cap, opacity, lift, fonts, top = 1548}) => {
  const words = cap.text.split(' ');
  const fs = Math.min(60, Math.floor(880 / (cap.text.length * 0.54)));
  const emph = (i: number) => (cap.emphasis ?? []).some(([a, b]) => i >= a && i < b);
  return (
    <div style={{position: 'absolute', left: 0, right: 0, top, display: 'flex', justifyContent: 'center', opacity, transform: `translateY(${lift}px)`}}>
      <div data-probe="zone" data-zone="caption" data-probe-id="caption" style={{background: '#211F1C', borderRadius: 26, padding: '22px 42px 26px', boxShadow: '0 16px 30px -12px rgba(40,30,10,0.35), 0 2px 0 rgba(255,255,255,0.08) inset', fontFamily: fonts.sans, fontWeight: 800, fontSize: fs, letterSpacing: '-0.01em', whiteSpace: 'nowrap'}}>
        {words.map((w, i) => (
          <span key={i} style={{color: emph(i) ? ORANGE_HI : '#FFFFFF'}}>{w}{i < words.length - 1 ? ' ' : ''}</span>
        ))}
      </div>
    </div>
  );
};
