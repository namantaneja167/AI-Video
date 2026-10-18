import React from 'react';
import {AbsoluteFill, Img, staticFile} from 'remotion';
import {PipRecon, REF_H, REF_W} from './PipRecon';
import {PipLayersScene} from './PipLayersScene';

export const SHEET_W = 3280;
export const SHEET_H = 2040;
const BG = '#F2F2F0';
const MONO = '"SF Mono",ui-monospace,Menlo,monospace';

const Lab: React.FC<{children: React.ReactNode; style?: React.CSSProperties}> = ({children, style}) => (
  <div style={{fontFamily: MONO, fontSize: 22, fontWeight: 800, letterSpacing: '0.1em', color: '#3a3733', ...style}}>{children}</div>
);

const Phone: React.FC<{view: 'hero' | 'skeptical'; caption?: [string, string]; w?: number}> = ({view, caption, w = 390}) => {
  const h = Math.round((w * 1920) / 1080);
  return (
    <div style={{width: w + 20, height: h + 20, borderRadius: 44, background: '#1c1a18', padding: 10, boxSizing: 'border-box', boxShadow: '0 24px 40px -16px rgba(0,0,0,0.45)'}}>
      <div style={{width: w, height: h, borderRadius: 34, overflow: 'hidden', position: 'relative'}}>
        <div style={{position: 'absolute', left: 0, top: 0, width: 1080, height: 1920, transform: `scale(${w / 1080})`, transformOrigin: '0 0'}}>
          <PipLayersScene view={view} caption={caption} />
        </div>
      </div>
    </div>
  );
};

export const PipLayersSheet: React.FC<{notes?: string[]}> = ({notes = []}) => (
  <AbsoluteFill style={{background: BG, fontFamily: MONO, color: '#25221f'}}>
    <div style={{position: 'absolute', left: 60, top: 26}}>
      <div style={{fontSize: 30, fontWeight: 800, letterSpacing: '0.1em'}}>PIP · TARGET vs. LAYERED RECONSTRUCTION</div>
      <div style={{fontSize: 19, marginTop: 6, color: '#5b5750'}}>Both panels are 1536×1024 and shown at 1:1. The reconstruction is code-drawn SVG layers; the target is a flattened image.</div>
    </div>

    <div style={{position: 'absolute', left: 60, top: 118}}>
      <Lab style={{marginBottom: 8}}>A · TARGET IMAGE (reference, not editable)</Lab>
      <Img src={staticFile('reference/pip-target.png')} style={{width: REF_W, height: REF_H, display: 'block', boxShadow: '0 0 0 2px rgba(0,0,0,0.12)'}} />
    </div>
    <div style={{position: 'absolute', left: 60 + REF_W + 48, top: 118}}>
      <Lab style={{marginBottom: 8}}>B · RECONSTRUCTION (editable layers)</Lab>
      <div style={{width: REF_W, height: REF_H, position: 'relative', boxShadow: '0 0 0 2px rgba(0,0,0,0.12)', overflow: 'hidden'}}>
        <PipRecon />
      </div>
    </div>

    <div style={{position: 'absolute', left: 60, top: 1230}}>
      <Lab style={{marginBottom: 8}}>PHONE · 390 px · NEUTRAL</Lab>
      <Phone view="hero" caption={['Let\u2019s read', 'the fine print.']} />
    </div>
    <div style={{position: 'absolute', left: 520, top: 1230}}>
      <Lab style={{marginBottom: 8}}>PHONE · 390 px · SKEPTICAL</Lab>
      <Phone view="skeptical" />
    </div>
    <div style={{position: 'absolute', left: 980, top: 1230}}>
      <Lab style={{marginBottom: 8}}>FEED THUMB · 200 px</Lab>
      <div style={{display: 'flex', gap: 18}}>
        {(['hero', 'skeptical'] as const).map((v) => (
          <div key={v} style={{width: 200, height: 356, borderRadius: 16, overflow: 'hidden', position: 'relative', boxShadow: '0 12px 22px -10px rgba(0,0,0,0.4)'}}>
            <div style={{position: 'absolute', left: 0, top: 0, width: 1080, height: 1920, transform: `scale(${200 / 1080})`, transformOrigin: '0 0'}}>
              <PipLayersScene view={v} />
            </div>
          </div>
        ))}
      </div>
    </div>

    <div style={{position: 'absolute', left: 1450, top: 1230}}>
      <Lab style={{marginBottom: 8}}>HERO OVERLAY (50%)</Lab>
      <div style={{width: 640, height: 686, overflow: 'hidden', position: 'relative', background: '#DADCDF', borderRadius: 8}}>
        <div style={{position: 'absolute', left: -50 * 0.7, top: 0, width: REF_W, height: REF_H, transform: 'scale(0.7)', transformOrigin: '0 0'}}>
          <Img src={staticFile('reference/pip-target.png')} style={{width: REF_W, height: REF_H}} />
          <div style={{position: 'absolute', inset: 0, opacity: 0.5}}>
            <PipRecon bg={false} />
          </div>
        </div>
      </div>
    </div>

    <div style={{position: 'absolute', left: 2160, top: 1230, width: 1060, fontSize: 21, lineHeight: 1.5, color: '#3a3733'}}>
      <Lab style={{marginBottom: 10}}>DIFFERENCES</Lab>
      {notes.map((n, i) => (
        <div key={i} style={{marginBottom: 10}}>
          {i + 1}. {n}
        </div>
      ))}
    </div>
  </AbsoluteFill>
);
