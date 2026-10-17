// Shared geometry for the order → history → result composition (canvas px, 1080×1920).
export const ORDER = {x: 60, y: 170, w: 410, h: 566};
export const HIST = {x: 560, w: 460, h: 170, gap: 28, y0: 170};
export const histY = (i: number) => HIST.y0 + i * (HIST.h + HIST.gap);
export const RES = {x: 330, w: 690, h: 112, gap: 25, y0: 925};
export const resY = (i: number) => RES.y0 + i * (RES.h + RES.gap);
export const resMidY = (i: number) => resY(i) + RES.h / 2;
export const TRUNK_X = 265;
export const KEY_X = 515;
// Result-row internals (relative to the row): the amount pill's position is shared with the flying chip.
export const PILL = {left: 160, w: 176, h: 72};
export const pillCenter = (i: number) => ({x: RES.x + PILL.left + PILL.w / 2, y: resMidY(i)});
// Where the large ₹ figure sits on the order card (canvas coords, final card position).
export const AMOUNT_CENTER = {x: ORDER.x + 30 + 160, y: ORDER.y + 262};

export const HISTORY = [
  {id: 1, status: 'created', at: '09:00'},
  {id: 2, status: 'authorized', at: '09:01'},
  {id: 3, status: 'paid', at: '09:02'},
];
export const ORDER_ID = 101;
export const AMOUNT = 100;
