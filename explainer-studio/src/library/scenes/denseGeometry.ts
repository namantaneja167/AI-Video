// Geometry of the dense fixture scene and the fit items for it. Pure: used by the scene, the check and the tests.
import {LAYOUTS, type Rect} from '../layouts';
import type {FitItem} from '../fit';

export type DenseParams = {title: string; columns: number; cards: {label: string; value: string}[]};

export const CARD_NEED_H = 140; // padding 16 + label line (28 px) + gap + value line (56 px) + padding 16, with line heights
export function denseCardRects(p: DenseParams, layoutId = 'dense-pip'): Rect[] {
  const L = LAYOUTS[layoutId].content;
  const gap = 16;
  const top = L.y + 96;
  const cw = (L.w - gap * (p.columns - 1)) / p.columns;
  const rowsN = Math.ceil(p.cards.length / p.columns);
  const ch = Math.min(150, (L.h - 96 - gap * (rowsN - 1)) / rowsN);
  return p.cards.map((_, i) => ({x: L.x + (i % p.columns) * (cw + gap), y: top + Math.floor(i / p.columns) * (ch + gap), w: cw, h: ch}));
}

export function denseFitItems(p: DenseParams, layoutId = 'dense-pip'): FitItem[] {
  const L = LAYOUTS[layoutId].content;
  const rects = denseCardRects(p, layoutId);
  return [
    {id: 'title', rect: {x: L.x, y: L.y + 8, w: L.w, h: 72}, fontPx: 52, text: p.title},
    ...p.cards.flatMap((c, i): FitItem[] => {
      const r = rects[i];
      return [
        {id: `card ${i + 1}`, rect: r, needH: CARD_NEED_H},
        {id: `card ${i + 1} label`, inside: `card ${i + 1}`, rect: {x: r.x, y: r.y + 16, w: r.w, h: 34}, fontPx: 28, essential: false, text: c.label, mono: true},
        {id: `card ${i + 1} value`, inside: `card ${i + 1}`, rect: {x: r.x, y: r.y + 56, w: r.w, h: 64}, fontPx: 56, text: c.value},
      ];
    }),
  ];
}
