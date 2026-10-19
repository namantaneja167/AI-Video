// Geometry of the pip-cards scene (1080 x 1920 canvas) and its fit items. Pure and loaded by Node (the checks), the browser
// bundle (the scene and the controls) and the tests, so the numbers the scene draws with are the ones the checks use.
import type {z} from 'zod';
import {fitCheck, type FitItem} from '../fit.ts';
import {LAYOUTS, mascotBox, type Rect} from '../layouts.ts';
import type {PipCardsParams} from '../params.ts';

export type PipCards = z.infer<typeof PipCardsParams>;
/** The layouts this scene is drawn in, with the words the controls use for them. */
export const PIP_CARDS_LAYOUTS = ['content-led', 'card-over-pip', 'dense-pip'] as const;
export const DEFAULT_PIP_LAYOUT = {template: 'content-led', captionZone: 'bottom', mascot: {mode: 'docked', position: 'bottom-left', scale: 0.5}} as const;
export const layoutIdFor = (template: string | undefined): string => (template && (PIP_CARDS_LAYOUTS as readonly string[]).includes(template) ? template : 'content-led');

export const TITLE_FONT = 52;
export const HEAD_FONT = 48;
export const BODY_FONT = 38;
const PAD = 26;
const GAP = 20;
const TITLE_H = 84;

/** Lines the body needs at this width (an estimate of the same kind the fit check uses). */
export const bodyLines = (body: string, w: number): number => (body ? Math.max(1, Math.ceil((body.length * BODY_FONT * 0.47) / (w - 2 * PAD))) : 0);
export const cardNeedH = (body: string, w: number): number => PAD + 60 + (body ? 8 + bodyLines(body, w) * Math.round(BODY_FONT * 1.3) : 0) + PAD;

/** The stage for content: the layout's content box, never reaching down into Pip's box. */
export function stage(layoutId: string): Rect {
  const L = LAYOUTS[layoutId];
  const m = L.mascot ? mascotBox(L.mascot) : null;
  const bottom = m ? Math.min(L.content.y + L.content.h, m.y - 12) : L.content.y + L.content.h;
  return {...L.content, h: bottom - L.content.y};
}

export function pipCardsRects(p: PipCards, layoutId: string): {title: Rect | null; cards: Rect[]} {
  const S = stage(layoutId);
  const top = S.y + (p.title ? TITLE_H : 0);
  const n = p.cards.length;
  const h = Math.min(260, (S.y + S.h - top - GAP * (n - 1)) / n);
  return {
    title: p.title ? {x: S.x, y: S.y + 8, w: S.w, h: 72} : null,
    cards: p.cards.map((_, i) => ({x: S.x, y: top + i * (h + GAP), w: S.w, h})),
  };
}

export function pipCardsFitItems(p: PipCards, layoutId: string): FitItem[] {
  const {title, cards} = pipCardsRects(p, layoutId);
  const items: FitItem[] = [];
  if (title) items.push({id: 'title', rect: title, fontPx: TITLE_FONT, text: p.title});
  p.cards.forEach((c, i) => {
    const r = cards[i];
    items.push({id: `card ${i + 1}`, rect: r, needH: cardNeedH(c.body, r.w)});
    items.push({id: `card ${i + 1} heading`, inside: `card ${i + 1}`, rect: {x: r.x, y: r.y + PAD, w: r.w, h: 60}, fontPx: HEAD_FONT, text: c.heading, padX: PAD});
    if (c.body) items.push({id: `card ${i + 1} text`, inside: `card ${i + 1}`, rect: {x: r.x + PAD, y: r.y + PAD + 68, w: r.w - 2 * PAD, h: bodyLines(c.body, r.w) * Math.round(BODY_FONT * 1.3)}, fontPx: BODY_FONT});
  });
  return items;
}

/** Why these cards do not fit this layout, in plain sentences; empty when they do. */
export function pipCardsFit(p: PipCards, template: string | undefined, o: {captions?: boolean} = {}): string[] {
  const id = layoutIdFor(template);
  return fitCheck(id, pipCardsFitItems(p, id), o);
}

/** Where Pip points or looks for a card: the middle of its left edge. */
export function cardTarget(p: PipCards, template: string | undefined, card: number): [number, number] {
  const r = pipCardsRects(p, layoutIdFor(template)).cards[Math.min(card, p.cards.length - 1)];
  return [r.x + 80, r.y + r.h / 2];
}
