import React from 'react';
import {AbsoluteFill} from 'remotion';
import {P, SANS, MONO} from '../palette';
import {Pip, K, type ExprName} from './Pip';
import {PipScene} from './PipScene';

export const SHEET_W = 2400;
export const SHEET_H = 1560;
const STUDIO = '#D9D0BC';
const CROP: [number, number, number, number] = [0, 172, 400, 400];

const Label: React.FC<{children: React.ReactNode; style?: React.CSSProperties}> = ({children, style}) => (
  <div style={{fontFamily: MONO, fontSize: 20, fontWeight: 800, letterSpacing: '0.12em', color: P.ink2, ...style}}>{children}</div>
);

const EXPRS: ExprName[] = ['curious', 'skeptical', 'surprised'];
const WHAT: Record<string, string> = {
  curious: 'leans in, brow up, mouth a small o',
  skeptical: 'leans back, one lid down, hand up',
  surprised: 'stretches and lifts, eyes wide, hands up',
};

export const PipSheet: React.FC = () => (
  <AbsoluteFill style={{background: '#E9E2D2', fontFamily: SANS, color: P.ink}}>
    <div style={{position: 'absolute', left: 60, top: 40}}>
      <div style={{fontFamily: MONO, fontSize: 30, fontWeight: 800, letterSpacing: '0.12em'}}>PIP · REFINED DESIGN (B DIRECTION)</div>
      <div style={{fontFamily: MONO, fontSize: 20, color: P.ink2, marginTop: 8}}>Static vector authored in code · not animated · one key light from the top-left on every surface</div>
    </div>

    {/* hero */}
    <div style={{position: 'absolute', left: 60, top: 130, width: 1000, height: 1360, borderRadius: 30, background: STUDIO, overflow: 'hidden'}}>
      <div style={{position: 'absolute', left: 30, top: 230}}>
        <Pip expr="neutral" uid="hero" crop={CROP} width={940} height={940} />
      </div>
      <Label style={{position: 'absolute', left: 30, top: 28}}>HERO · NEUTRAL</Label>
      <svg width={120} height={120} style={{position: 'absolute', right: 28, top: 24}}>
        <circle cx={60} cy={60} r={46} fill="none" stroke={P.ink2} strokeWidth={2.5} strokeDasharray="6 6" />
        <path d="M 96 24 L 54 66" stroke={P.ink2} strokeWidth={3.5} strokeLinecap="round" />
        <path d="M 54 66 l 6 -16 l 10 10 z" fill={P.ink2} />
      </svg>
      <Label style={{position: 'absolute', right: 24, top: 150, width: 130, textAlign: 'center', fontSize: 15}}>KEY LIGHT</Label>
      <div style={{position: 'absolute', left: 30, bottom: 30, right: 30, display: 'flex', gap: 28, alignItems: 'center', fontFamily: MONO, fontSize: 19, color: P.ink2}}>
        {[
          ['ivory', K.iv],
          ['burnt orange', K.or],
          ['charcoal', K.ch],
        ].map(([n, c]) => (
          <div key={n} style={{display: 'flex', alignItems: 'center', gap: 10}}>
            <div style={{width: 32, height: 32, borderRadius: 9, background: c, border: '2px solid rgba(0,0,0,0.15)'}} />
            {n}
          </div>
        ))}
        <div style={{marginLeft: 'auto'}}>hovers · no feet · no screen</div>
      </div>
    </div>

    {/* expressions */}
    {EXPRS.map((ex, i) => (
      <div key={ex} style={{position: 'absolute', left: 1100, top: 130 + i * 456, width: 460}}>
        <div style={{width: 460, height: 420, borderRadius: 26, background: STUDIO, overflow: 'hidden', position: 'relative'}}>
          <div style={{position: 'absolute', left: 10, top: 6}}>
            <Pip expr={ex} uid={`ex-${ex}`} crop={CROP} width={440} height={440} />
          </div>
        </div>
        <Label style={{marginTop: 8}}>{ex.toUpperCase()}</Label>
        <div style={{fontFamily: MONO, fontSize: 16, color: P.muted, marginTop: 2}}>{WHAT[ex]}</div>
      </div>
    ))}

    {/* phone scene at real phone width, plus a feed-thumbnail size */}
    <div style={{position: 'absolute', left: 1650, top: 130}}>
      <Label style={{marginBottom: 12}}>PHONE · 390 px WIDE</Label>
      <div style={{width: 390 + 20, height: 693 + 20, borderRadius: 44, background: '#1c1a18', padding: 10, boxSizing: 'border-box', boxShadow: '0 24px 40px -16px rgba(0,0,0,0.45)'}}>
        <div style={{width: 390, height: 693, borderRadius: 34, overflow: 'hidden', position: 'relative'}}>
          <div style={{position: 'absolute', left: 0, top: 0, width: 1080, height: 1920, transform: `scale(${390 / 1080})`, transformOrigin: '0 0'}}>
            <PipScene />
          </div>
        </div>
      </div>
    </div>
    <div style={{position: 'absolute', left: 2090, top: 130}}>
      <Label style={{marginBottom: 12}}>FEED THUMB</Label>
      <div style={{width: 200, height: 356, borderRadius: 18, overflow: 'hidden', position: 'relative', boxShadow: '0 14px 24px -12px rgba(0,0,0,0.4)'}}>
        <div style={{position: 'absolute', left: 0, top: 0, width: 1080, height: 1920, transform: `scale(${200 / 1080})`, transformOrigin: '0 0'}}>
          <PipScene />
        </div>
      </div>
    </div>
    <div style={{position: 'absolute', left: 1650, top: 900, width: 700, fontFamily: MONO, fontSize: 18, lineHeight: 1.45, color: P.ink2}}>
      Scene: fictional launch claim with fine print; Pip leans back with one lid down and a hand raised toward the asterisk. The same 1080×1920 composition is also rendered at full size.
    </div>
  </AbsoluteFill>
);
