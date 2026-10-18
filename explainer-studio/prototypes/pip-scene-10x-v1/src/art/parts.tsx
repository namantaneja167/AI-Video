import React from 'react';
import {P, SANS, MONO, SHADOW} from './palette';

export const W = 1080;
export const H = 1920;

const hex = (c: string) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
export const mixColor = (a: string, b: string, t: number) => {
  const [r1, g1, b1] = hex(a);
  const [r2, g2, b2] = hex(b);
  const k = Math.min(1, Math.max(0, t));
  return `rgb(${Math.round(r1 + (r2 - r1) * k)},${Math.round(g1 + (g2 - g1) * k)},${Math.round(b1 + (b2 - b1) * k)})`;
};

/** ID tag: grey until `amber` reaches 1, so a highlight can be animated rather than swapped. */
export const Tag: React.FC<{children: React.ReactNode; size?: number; amber?: number; style?: React.CSSProperties}> = ({children, size = 26, amber = 1, style}) => (
  <div
    style={{
      display: 'inline-flex',
      alignItems: 'center',
      padding: `${size * 0.2}px ${size * 0.62}px`,
      borderRadius: 999,
      background: mixColor('#F3EFE6', P.amber.fill, amber),
      border: `2px solid ${mixColor('#D8D1C1', P.amber.edge, amber)}`,
      color: mixColor(P.muted, P.amber.text, amber),
      fontFamily: MONO,
      fontWeight: 700,
      fontSize: size,
      letterSpacing: '-0.01em',
      lineHeight: 1.1,
      whiteSpace: 'nowrap',
      ...style,
    }}
  >
    {children}
  </div>
);

export const Dots: React.FC = () => (
  <div style={{display: 'flex', gap: 8}}>
    {[0, 1, 2].map((i) => (
      <div key={i} style={{width: 12, height: 12, borderRadius: 6, background: '#D6CFC0'}} />
    ))}
  </div>
);

export const Header: React.FC<{title: string; right?: React.ReactNode}> = ({title, right}) => (
  <div style={{height: 46, background: P.strip, borderBottom: `2px solid ${P.line}`, display: 'flex', alignItems: 'center', padding: '0 20px', gap: 16, boxSizing: 'border-box'}}>
    <Dots />
    <div style={{fontFamily: MONO, fontSize: 20, color: P.muted, fontWeight: 600}}>{title}</div>
    <div style={{marginLeft: 'auto'}}>{right}</div>
  </div>
);

/** A chunky tile: white face with a darker lower edge so it reads as an object, not a panel. */
export const Slab: React.FC<{x: number; y: number; w: number; h: number; thickness?: number; radius?: number; children?: React.ReactNode; style?: React.CSSProperties}> = ({
  x,
  y,
  w,
  h,
  thickness = 9,
  radius = 24,
  children,
  style,
}) => (
  <div style={{position: 'absolute', left: x, top: y, width: w, height: h + thickness, ...style}}>
    <div style={{position: 'absolute', left: 0, top: thickness, width: w, height: h, borderRadius: radius, background: P.slab, boxShadow: '0 18px 30px -14px rgba(74,58,30,0.16)'}} />
    <div style={{position: 'absolute', left: 0, top: 0, width: w, height: h, borderRadius: radius, background: P.white, border: `2px solid ${P.line}`, boxSizing: 'border-box', boxShadow: SHADOW.low, overflow: 'hidden'}}>
      {children}
    </div>
  </div>
);

export const Section: React.FC<{n: string; label: string; x: number; y: number; opacity?: number}> = ({n, label, x, y, opacity = 1}) => (
  <div style={{position: 'absolute', left: x, top: y, opacity, fontFamily: MONO, fontSize: 21, letterSpacing: '0.1em', display: 'flex', gap: 12, whiteSpace: 'nowrap'}}>
    <span style={{color: P.muted, fontWeight: 600}}>{n}</span>
    <span style={{color: P.ink, fontWeight: 800}}>{label}</span>
  </div>
);

export const Arrowhead: React.FC<{x: number; y: number; dir: 'right' | 'down'; color: string; size?: number; opacity?: number}> = ({x, y, dir, color, size = 13, opacity = 1}) => (
  <path
    d={dir === 'right' ? `M${x - size} ${y - size * 0.8}L${x} ${y}L${x - size} ${y + size * 0.8}Z` : `M${x - size * 0.8} ${y - size}L${x} ${y}L${x + size * 0.8} ${y - size}Z`}
    fill={color}
    stroke={color}
    strokeWidth={3}
    strokeLinejoin="round"
    opacity={opacity}
  />
);

export const Barcode: React.FC = () => {
  const bars = [4, 2, 6, 2, 3, 5, 2, 4, 6, 3, 2, 5, 3, 2, 6, 4, 2, 3, 5, 2, 4, 3, 6, 2, 3, 4];
  let x = 0;
  return (
    <svg width={300} height={46}>
      {bars.map((b, i) => {
        const rect = i % 2 === 0 ? <rect key={i} x={x} y={0} width={b} height={46} rx={1} fill={P.ink} opacity={0.85} /> : null;
        x += b + 2;
        return rect;
      })}
    </svg>
  );
};

export const Caption: React.FC<{lit: string; dim?: string; opacity?: number; scale?: number}> = ({lit, dim, opacity = 1, scale = 1}) => (
  <div style={{position: 'absolute', left: 0, right: 0, top: 1500, display: 'flex', justifyContent: 'center', opacity, transform: `scale(${scale})`}}>
    <div style={{background: '#211F1C', borderRadius: 26, padding: '24px 44px 28px', boxShadow: '0 16px 30px -12px rgba(40,30,10,0.35), 0 2px 0 rgba(255,255,255,0.08) inset', fontFamily: SANS, fontWeight: 800, fontSize: 60, letterSpacing: '-0.01em', whiteSpace: 'nowrap'}}>
      <span style={{color: '#FFFFFF'}}>{lit}</span>
      {dim ? <span style={{color: '#8F8A7E'}}> {dim}</span> : null}
    </div>
  </div>
);

/** Sky-to-paper gradient, faint dot grid and a low-contrast perspective floor. */
export const Backdrop: React.FC<{drift?: number}> = ({drift = 0}) => (
  <>
    <div style={{position: 'absolute', inset: 0, background: `linear-gradient(180deg, ${P.skyTop} 0%, #EBEDEC 16%, ${P.cream} 32%)`}} />
    <div style={{position: 'absolute', inset: 0, backgroundImage: `radial-gradient(circle, ${P.dot} 2.4px, transparent 2.8px)`, backgroundSize: '44px 44px', opacity: 0.55, WebkitMaskImage: 'linear-gradient(to bottom, black 0%, black 50%, transparent 62%)'}} />
    <div style={{position: 'absolute', left: 0, top: 880, width: W, height: H - 880, perspective: 760, perspectiveOrigin: '50% 0%', overflow: 'hidden', WebkitMaskImage: 'linear-gradient(to bottom, transparent 0%, black 18%)'}}>
      <div
        style={{
          position: 'absolute',
          left: -1400,
          top: 0,
          width: 3880,
          height: 3000,
          transformOrigin: '50% 0%',
          transform: 'rotateX(64deg)',
          background: `linear-gradient(${P.dot} 2px, transparent 2px) 0 ${drift}px / 90px 90px, linear-gradient(90deg, ${P.dot} 2px, transparent 2px) 0 0 / 90px 90px, ${P.floor}`,
          opacity: 0.9,
        }}
      />
    </div>
  </>
);

/** Original flat-vector coin (not from any library): the single, ink-coloured source amount. */
export const FlatCoin: React.FC<{size: number; rotateY?: number}> = ({size, rotateY = 0}) => (
  <svg width={size} height={size} viewBox="0 0 100 100" style={{overflow: 'visible', transform: `rotateY(${rotateY}deg)`, filter: 'drop-shadow(0 10px 8px rgba(74,58,30,0.18))'}}>
    <ellipse cx="50" cy="58" rx="40" ry="40" fill="#14120F" />
    <circle cx="50" cy="50" r="40" fill="#2B2824" />
    <circle cx="50" cy="50" r="32" fill="none" stroke="#4D473E" strokeWidth="2.5" />
    <path d="M22 38 A32 32 0 0 1 48 19" fill="none" stroke="#FFFFFF" strokeOpacity="0.22" strokeWidth="4" strokeLinecap="round" />
    <text x="50" y="64" textAnchor="middle" fontSize="42" fontWeight="800" fill="#F5F2EA" fontFamily='"SF Pro Display","Helvetica Neue",Arial,sans-serif'>
      ₹
    </text>
  </svg>
);
