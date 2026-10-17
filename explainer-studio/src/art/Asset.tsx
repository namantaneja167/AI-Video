import React from 'react';
import {Img, staticFile} from 'remotion';

/** Lucide / Simple Icons SVG, recoloured through a CSS mask so the downloaded file stays untouched. */
export const GlyphMask: React.FC<{src: string; color: string; size: number; style?: React.CSSProperties}> = ({src, color, size, style}) => {
  const url = `url(${staticFile(src)})`;
  return (
    <div
      style={{
        width: size,
        height: size,
        background: color,
        WebkitMaskImage: url,
        maskImage: url,
        WebkitMaskRepeat: 'no-repeat',
        maskRepeat: 'no-repeat',
        WebkitMaskSize: 'contain',
        maskSize: 'contain',
        WebkitMaskPosition: 'center',
        maskPosition: 'center',
        flexShrink: 0,
        ...style,
      }}
    />
  );
};

export const Lucide: React.FC<{name: string; color: string; size?: number; style?: React.CSSProperties}> = ({name, color, size = 28, style}) => (
  <GlyphMask src={`assets/lucide/${name}.svg`} color={color} size={size} style={style} />
);

// Duotone maps for the matte grey clay renders: luminance picks a point between a shadow and a light colour,
// so the original modelling survives while the hue joins the palette.
const DUO = {
  none: {dark: [0.8, 0.75, 0.66], light: [1, 0.995, 0.97]},
  amber: {dark: [0.62, 0.34, 0.05], light: [1, 0.86, 0.58]},
  rose: {dark: [0.64, 0.2, 0.17], light: [1, 0.8, 0.75]},
} as const;

export const ClayFilters: React.FC = () => (
  <svg width={0} height={0} style={{position: 'absolute'}}>
    <defs>
      {(Object.keys(DUO) as (keyof typeof DUO)[]).map((k) => (
        <filter key={k} id={`clay-${k}`} colorInterpolationFilters="sRGB">
          <feColorMatrix type="matrix" values="0.75 1.475 0.275 0 -1.5  0.75 1.475 0.275 0 -1.5  0.75 1.475 0.275 0 -1.5  0 0 0 1 0" />
          <feComponentTransfer>
            <feFuncR type="table" tableValues={`${DUO[k].dark[0]} ${DUO[k].light[0]}`} />
            <feFuncG type="table" tableValues={`${DUO[k].dark[1]} ${DUO[k].light[1]}`} />
            <feFuncB type="table" tableValues={`${DUO[k].dark[2]} ${DUO[k].light[2]}`} />
          </feComponentTransfer>
        </filter>
      ))}
    </defs>
  </svg>
);

const TINT = {none: 'url(#clay-none)', amber: 'url(#clay-amber)', rose: 'url(#clay-rose)'} as const;

export type ClayName = 'rupee' | 'bag' | 'clock' | 'key' | 'copy' | 'tick';

/** 3dicons v1 "clay" render (CC0) with a soft contact shadow. */
export const Clay: React.FC<{name: ClayName; size: number; tint?: keyof typeof TINT; rotate?: number; style?: React.CSSProperties}> = ({
  name,
  size,
  tint = 'none',
  rotate = 0,
  style,
}) => (
  <div style={{width: size, height: size, transform: `rotate(${rotate}deg)`, filter: 'drop-shadow(0 12px 10px rgba(74,58,30,0.26))', ...style}}>
    <Img src={staticFile(`assets/3dicons/${name}.png`)} style={{width: size, height: size, filter: TINT[tint], display: 'block'}} />
  </div>
);

/** Flat hand-drawn stand-ins used by the pre-asset concept render. */
export const Placeholder: React.FC<{name: ClayName; size: number; tint?: keyof typeof TINT; rotate?: number}> = ({name, size, tint = 'none', rotate = 0}) => {
  const base = tint === 'rose' ? '#F27B6C' : tint === 'amber' ? '#F0A030' : '#CFC9BA';
  const dark = tint === 'rose' ? '#C9564A' : tint === 'amber' ? '#C7821B' : '#A8A190';
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" style={{transform: `rotate(${rotate}deg)`, filter: 'drop-shadow(0 10px 8px rgba(74,58,30,0.22))'}}>
      {name === 'rupee' && (
        <>
          <ellipse cx="50" cy="56" rx="38" ry="38" fill={dark} />
          <circle cx="50" cy="50" r="38" fill={base} />
          <text x="50" y="64" textAnchor="middle" fontSize="44" fontWeight="800" fill="#fff" fontFamily="SF Pro Display, Helvetica">₹</text>
        </>
      )}
      {name === 'clock' && (
        <>
          <circle cx="50" cy="54" r="38" fill={dark} />
          <circle cx="50" cy="50" r="38" fill="#F6F3EA" stroke={base} strokeWidth="6" />
          <path d="M50 28v24l14 8" stroke="#4B463E" strokeWidth="6" strokeLinecap="round" fill="none" />
        </>
      )}
      {name === 'key' && (
        <>
          <circle cx="32" cy="50" r="20" fill={base} />
          <circle cx="32" cy="50" r="8" fill="#F5F2EA" />
          <rect x="48" y="45" width="42" height="10" rx="5" fill={base} />
          <rect x="74" y="55" width="8" height="14" rx="3" fill={base} />
        </>
      )}
      {name === 'copy' && (
        <>
          <rect x="30" y="14" width="52" height="66" rx="9" fill={dark} />
          <rect x="16" y="26" width="52" height="66" rx="9" fill={base} />
        </>
      )}
      {(name === 'bag' || name === 'tick') && <circle cx="50" cy="50" r="34" fill={base} />}
    </svg>
  );
};
