export const W = 1080;
export const H = 1920;
export const FPS = 30;

export const C = {
  bg: '#0a0e15',
  bg2: '#0e1522',
  panel: '#111a28',
  panelHi: '#16223a',
  line: '#243349',
  text: '#e8eef8',
  muted: '#8696b0',
  dim: '#55657e',
  accent: '#5ccfe6', // primary: data / focus
  amber: '#f5b942', // duplication / warning
  bad: '#f26d6d',
  good: '#55d68c',
} as const;

export const FONT = '"SF Pro Display","Inter",-apple-system,"Helvetica Neue",Arial,sans-serif';
export const MONO = '"SF Mono","JetBrains Mono",Menlo,Consolas,monospace';

// Safe layout: nothing essential outside these bounds.
export const SAFE = {left: 60, right: 1020, top: 96};
export const STAGE = {x: 60, y: 190, w: 960, h: 920};
export const BAND = {y: 1140};
export const CAPTION = {y: 1520, maxW: 900};
