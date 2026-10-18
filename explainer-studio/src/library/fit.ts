// A geometry fit check for Pip layouts. It checks rectangles and declared text sizes, nothing about how the scene looks:
// whether every item is inside the safe area, readable at phone size, clear of the caption band, and clear of Pip.
import {CAPTION_BAND, LAYOUTS, SAFE, mascotBox, type Rect} from './layouts';

export type FitItem = {
  id: string;
  rect: Rect;
  /** Smallest font size used for the item's text, in canvas px. Omit for items without text. */
  fontPx?: number;
  /** Text that carries meaning (not a decorative label): held to the higher minimum. */
  essential?: boolean;
  /** The text itself (to estimate whether it fits the width) and whether it is set in the monospace face. */
  text?: string;
  mono?: boolean;
  /** Letter spacing in em (adds to the estimated width). */
  tracking?: number;
  /** Horizontal padding inside the item, px each side (default 20). */
  padX?: number;
  /** Least height the item needs to hold its text (lines and padding), px. */
  needH?: number;
  /** Id of the item that contains this one; the two are not reported as overlapping. */
  inside?: string;
  /** The beat(s) an item is on screen in. Items with no beat in common are never on screen together, so they may share space. */
  phase?: string | string[];
  /** The item may sit under Pip's box (it is a background panel, or Pip leaves while it is shown). */
  mayOverlapMascot?: boolean;
};

/** 36 px on a 1080 canvas is 12 px on a 360 px wide phone preview; secondary labels may go down to 28 px (9 px). */
export const MIN_FONT = {essential: 36, secondary: 28} as const;

const inside = (r: Rect, box: Rect) => r.x >= box.x && r.y >= box.y && r.x + r.w <= box.x + box.w && r.y + r.h <= box.y + box.h;
const overlap = (a: Rect, b: Rect) => Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > 1 && Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > 1;

export function fitCheck(layoutId: string, items: FitItem[], o: {captions?: boolean} = {}): string[] {
  const layout = LAYOUTS[layoutId];
  if (!layout) return [`unknown layout "${layoutId}"`];
  const problems: string[] = [];
  const mbox = layout.mascot ? mascotBox(layout.mascot) : null;
  for (const it of items) {
    if (!inside(it.rect, SAFE)) problems.push(`${it.id} is outside the safe area`);
    if ((o.captions ?? true) && overlap(it.rect, CAPTION_BAND)) problems.push(`${it.id} overlaps the caption band`);
    if (it.fontPx !== undefined) {
      const min = it.essential === false ? MIN_FONT.secondary : MIN_FONT.essential;
      if (it.fontPx < min) problems.push(`${it.id} text is ${it.fontPx} px; the minimum is ${min} px at phone size`);
    }
    if (it.text !== undefined && it.fontPx !== undefined) {
      const w = it.text.length * it.fontPx * ((it.mono ? 0.6 : 0.47) + (it.tracking ?? 0)) + 2 * (it.padX ?? 20);
      if (w > it.rect.w) problems.push(`${it.id} text "${it.text}" needs about ${Math.round(w)} px but the item is ${Math.round(it.rect.w)} px wide`);
    }
    if (it.needH !== undefined && it.rect.h < it.needH) problems.push(`${it.id} is ${Math.round(it.rect.h)} px tall; its text needs about ${it.needH} px`);
    if (mbox && overlap(it.rect, mbox) && !it.mayOverlapMascot) {
      problems.push(layout.mascotMovable ? `${it.id} overlaps Pip's box; he must step aside while it is shown (mark it mayOverlapMascot)` : `${it.id} overlaps Pip's box and this layout's Pip is fixed`);
    }
  }
  for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
    const a = items[i], b = items[j];
    if (a.inside === b.id || b.inside === a.id || (a.phase && b.phase && ![a.phase].flat().some((x) => [b.phase].flat().includes(x)))) continue;
    if (overlap(a.rect, b.rect)) problems.push(`${a.id} overlaps ${b.id}`);
  }
  return problems;
}
