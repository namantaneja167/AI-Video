import type {FitItem} from '../fit';

// Geometry of the context-window scene (1080 x 1920 canvas), shared by the scene, its Pip score's pointing and the fit check.
export const CARD = {x: 60, y: 160, w: 960, h: 900};
export const HEAD = 46;
export const COLS = 12;
export const CELL = 52;
export const GAP = 8;
/** Grid origin inside the card (card-relative); the grid is centred. */
export const GRID = {x: (960 - (COLS * (CELL + GAP) - GAP)) / 2, y: 320};
export const rows = (capacity: number) => Math.ceil(capacity / COLS);
export const gridW = COLS * (CELL + GAP) - GAP;
export const gridH = (capacity: number) => rows(capacity) * (CELL + GAP) - GAP;
export const cellXY = (i: number): [number, number] => [GRID.x + (i % COLS) * (CELL + GAP), GRID.y + Math.floor(i / COLS) * (CELL + GAP)];
/** The budget bar and its legend (card-relative), under the grid. */
export const BAR = {x: GRID.x, y: 706, w: gridW, h: 72};
export const LEGEND = {x: 44, y: 804, w: 872, rowH: 44};
/** The two outcomes fill most of the stage while Pip is out of frame. */
export const OUTCOME = [
  {x: 60, y: 190, w: 960, h: 600},
  {x: 60, y: 830, w: 960, h: 600},
] as const;
export const ANCHOR = {ax: 300, ay: 1460, k: 0.5};
/** Where Pip stands while he is out of frame (to the left). */
export const ANCHOR_OFF_X = -380;

/** The scene's items for the layout fit check (canvas coordinates; the same numbers the scene draws with). */
const CARD_BEATS = ['early', 'prompt', 'banner', 'later'];
export function contextWindowFitItems(capacity = 60): FitItem[] {
  const gx = CARD.x + GRID.x - 14;
  const gy = CARD.y + GRID.y - 14;
  const items: FitItem[] = [
    {id: 'illustrative pill', rect: {x: 160, y: 96, w: 760, h: 54}, fontPx: 36, text: 'ILLUSTRATIVE · 1 PIECE = 1 SLOT', mono: true, padX: 20, tracking: 0.02},
    {id: 'card', phase: CARD_BEATS, rect: {x: CARD.x, y: CARD.y, w: CARD.w, h: CARD.h}},
    {id: 'title', phase: CARD_BEATS, inside: 'card', rect: {x: CARD.x + 44, y: CARD.y + 62, w: 545, h: 60}, fontPx: 44, text: 'WHAT THE MODEL SEES', mono: true, padX: 0, tracking: 0.04},
    {id: 'counter', phase: CARD_BEATS, inside: 'card', rect: {x: CARD.x + CARD.w - 44 - 310, y: CARD.y + 52, w: 310, h: 84}, fontPx: 72, text: '60 / 60', mono: true, padX: 0},
    {id: 'prompt and pieces', phase: 'prompt', inside: 'card', rect: {x: CARD.x + 28, y: CARD.y + 164, w: CARD.w - 56, h: 80}, fontPx: 56, text: 'Why is the sky blue today?', padX: 0},
    {id: 'count banner', phase: 'banner', inside: 'card', rect: {x: CARD.x + 28, y: CARD.y + 152, w: CARD.w - 56, h: 80}, fontPx: 72, text: '8 + 16 = 24', mono: true, padX: 0},
    {id: 'banner caption', phase: 'banner', inside: 'card', rect: {x: CARD.x + 28, y: CARD.y + 234, w: CARD.w - 56, h: 56}, fontPx: 44, text: 'your question + earlier chat', padX: 0},
    {id: 'token slots', phase: CARD_BEATS, inside: 'card', rect: {x: gx, y: gy, w: gridW + 28, h: gridH(capacity) + 28}},
    {id: 'budget label', phase: CARD_BEATS, inside: 'card', rect: {x: CARD.x + BAR.x, y: CARD.y + BAR.y - 62, w: BAR.w, h: 56}, fontPx: 44, text: 'one budget: your text + reply', padX: 0},
    {id: 'budget bar', phase: CARD_BEATS, inside: 'card', rect: {x: CARD.x + BAR.x, y: CARD.y + BAR.y, w: BAR.w, h: BAR.h}},
    {id: 'legend', phase: CARD_BEATS, inside: 'card', rect: {x: CARD.x + LEGEND.x, y: CARD.y + LEGEND.y, w: LEGEND.w, h: LEGEND.rowH * 2}, fontPx: 38, text: '● earlier chat   16', mono: true, padX: 0},
    {id: 'illustrative note', rect: {x: 60, y: 1690, w: 960, h: 100}, fontPx: 36, needH: 94},
  ];
  for (const [i, o] of OUTCOME.entries()) {
    items.push({id: `outcome ${i + 1}`, phase: 'outcomes', rect: o, mayOverlapMascot: true});
    items.push({id: `outcome ${i + 1} title`, phase: 'outcomes', inside: `outcome ${i + 1}`, rect: {x: o.x + 40, y: o.y + 66, w: o.w - 80, h: 84}, fontPx: 72, text: i === 0 ? 'It stops' : 'It drops the oldest', padX: 0, mayOverlapMascot: true});
    items.push({id: `outcome ${i + 1} subtitle`, phase: 'outcomes', inside: `outcome ${i + 1}`, rect: {x: o.x + 40, y: o.y + 156, w: o.w - 80, h: 58}, fontPx: 44, text: i === 0 ? 'no room left to continue' : 'older text falls out of view', padX: 0, mayOverlapMascot: true});
  }
  return items;
}
