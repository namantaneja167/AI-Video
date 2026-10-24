import React from 'react';
import {P} from '../../../art/palette';
import type {FontSet} from '../../fonts';

import type {Rect} from '../../motion';

export const O = '#E8772E', B = '#547A92', G = '#277565', R = '#B94F43', PAPER = '#FFFDF8';
/** A rectangle as absolute-position CSS. */
export const box = (r: Rect): React.CSSProperties => ({position: 'absolute', left: r.x, top: r.y, width: r.w, height: r.h});
export const panel: React.CSSProperties = {background: PAPER, border: `2px solid ${P.line}`, borderRadius: 30, boxShadow: '0 16px 28px rgba(50,40,20,.055)'};

export const Label: React.FC<{fonts: FontSet; children: React.ReactNode; color?: string; size?: number; style?: React.CSSProperties}> = ({fonts, children, color = P.ink2, size = 24, style}) => (
  <div style={{fontFamily: fonts.mono, fontWeight: 750, letterSpacing: 1, fontSize: size, color, ...style}}>{children}</div>
);

export const Headphones: React.FC<{color: string}> = ({color}) => (
  <svg viewBox="0 0 200 150" width="100%" height="100%"><ellipse cx="100" cy="130" rx="70" ry="10" fill={color} opacity=".08" /><path d="M43 95V78a57 57 0 0 1 114 0v17" fill="none" stroke={color} strokeWidth="18" strokeLinecap="round" /><rect x="25" y="73" width="38" height="62" rx="17" fill={color} /><rect x="137" y="73" width="38" height="62" rx="17" fill={color} /><rect x="34" y="84" width="13" height="36" rx="6" fill="white" opacity=".25" /><rect x="146" y="84" width="13" height="36" rx="6" fill="white" opacity=".25" /></svg>
);

/** The fictional-example note the baseline scene carries, kept in screen coordinates below the captions. */
export const FictionNote: React.FC<{fonts: FontSet}> = ({fonts}) => (
  <div style={{position: 'absolute', left: 80, right: 80, top: 1750, textAlign: 'center', fontFamily: fonts.sans, fontSize: 24, lineHeight: 1.35, color: P.muted}}>Conceptual animation. Fictional products and prices.<br />An attack attempt can fail; defences remain imperfect.</div>
);
export const STAGES = ['TASK', 'PAGE', 'INJECT', 'DRIFT', 'CHECK'] as const;
/** The stage the baseline scene shows for each line of the passage (s2 PAGE, s3 INJECT, s4 DRIFT). */
export const stageAt = (t: number, q: Record<string, number>): number => (t < q.ignore ? 1 : t < q.if ? 2 : 3);
