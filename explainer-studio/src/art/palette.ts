// Warm-paper art direction. Colour carries meaning: amber = the join key, rose = a copied amount.
export const P = {
  cream: '#F5F2EA',
  floor: '#EDE8DC',
  skyTop: '#DDE5EC',
  dot: '#E2DCCF',
  ink: '#1F1D1A',
  ink2: '#4B463E',
  muted: '#8B8578',
  line: '#E2DBCC',
  strip: '#F2EEE4',
  white: '#FFFFFF',
  slab: '#D6CFBF',
  amber: {fill: '#FDF0D9', edge: '#EDB25A', text: '#A64F0B', solid: '#F0A030'},
  rose: {fill: '#FDE6E2', edge: '#E8877D', text: '#B0302A', solid: '#F27B6C'},
} as const;

export const SANS = '"SF Pro Display","SF Pro Text",-apple-system,"Helvetica Neue",Arial,sans-serif';
export const MONO = '"SF Mono",ui-monospace,Menlo,Consolas,monospace';

export const SHADOW = {
  card: '0 1px 0 rgba(255,255,255,0.95) inset, 0 1px 2px rgba(74,58,30,0.06), 0 18px 34px -14px rgba(74,58,30,0.14)',
  low: '0 1px 0 rgba(255,255,255,0.95) inset, 0 1px 2px rgba(74,58,30,0.06), 0 12px 22px -10px rgba(74,58,30,0.13)',
} as const;
