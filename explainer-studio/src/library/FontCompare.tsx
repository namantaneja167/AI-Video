import React from 'react';
import {AbsoluteFill} from 'remotion';
import {P} from '../art/palette';
import {FONT_SETS, useBundledFonts, type FontSet} from './fonts';

/** The prototype's typography hierarchy set in the system stack (what the prototype was made with) beside the bundled fonts. */
const Column: React.FC<{title: string; fonts: FontSet}> = ({title, fonts}) => (
  <div style={{flex: 1, padding: '34px 40px', background: '#FFFFFF', borderRadius: 24, boxShadow: '0 6px 0 rgba(60,40,20,0.12)'}}>
    <div style={{fontFamily: FONT_SETS.system.mono, fontSize: 24, fontWeight: 700, color: P.muted, letterSpacing: '0.08em', marginBottom: 18}}>{title}</div>
    <div style={{fontFamily: fonts.sans, fontSize: 168, fontWeight: 900, color: P.ink, letterSpacing: '-0.03em', lineHeight: 1}}>10×</div>
    <div style={{fontFamily: fonts.sans, fontSize: 56, fontWeight: 800, color: P.ink, marginTop: 18, letterSpacing: '-0.01em'}}>Check the workload</div>
    <div style={{fontFamily: fonts.sans, fontSize: 40, fontWeight: 700, color: P.muted, marginTop: 6}}>not just the headline.</div>
    <div style={{fontFamily: fonts.mono, fontSize: 26, fontWeight: 700, color: P.muted, letterSpacing: '0.1em', marginTop: 30}}>BENCHMARK CONDITION</div>
    <div style={{display: 'flex', gap: 10, marginTop: 14}}>
      {['What', ' is', ' a', ' join', ' ?'].map((s, i) => (
        <div key={i} style={{fontFamily: fonts.mono, fontSize: 26, fontWeight: 700, background: '#E5D2BD', color: P.ink, padding: '8px 14px', borderRadius: 12, whiteSpace: 'pre'}}>{s}</div>
      ))}
    </div>
    <div style={{marginTop: 30, display: 'inline-block', background: '#211F1C', borderRadius: 26, padding: '18px 36px 22px', fontFamily: fonts.sans, fontWeight: 800, fontSize: 50, letterSpacing: '-0.01em', color: '#FFFFFF', whiteSpace: 'nowrap'}}>
      This test used <span style={{color: '#F08B4C'}}>tiny prompts.</span>
    </div>
    <div style={{fontFamily: fonts.mono, fontSize: 24, fontWeight: 600, color: P.muted, marginTop: 24}}>Simplified · tokens are illustrative</div>
  </div>
);

export const FontCompare: React.FC = () => {
  useBundledFonts(true);
  return (
    <AbsoluteFill style={{background: P.cream, padding: 40, flexDirection: 'row', gap: 40}}>
      <Column title="SYSTEM STACK (prototype: SF Pro, SF Mono on this Mac)" fonts={FONT_SETS.system} />
      <Column title="BUNDLED (Inter, JetBrains Mono; OFL 1.1)" fonts={FONT_SETS.bundled} />
    </AbsoluteFill>
  );
};
