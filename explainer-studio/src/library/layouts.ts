// Layout templates for Pip-style scenes as plain geometry (1080 x 1920), shared by the scenes and the fit check.
// No React and no relative imports: Node tests and the browser bundle load the same numbers.
export type Rect = {x: number; y: number; w: number; h: number};
export type MascotAnchor = {ax: number; ay: number; k: number};

export const CANVAS = {w: 1080, h: 1920};
/** Content must stay inside this box (phone UI and platform overlays crop the rest). */
export const SAFE: Rect = {x: 60, y: 96, w: 960, h: 1728};
/** The caption pill's band. Content must not enter it unless the layout has no caption. */
export const CAPTION_BAND: Rect = {x: 60, y: 1540, w: 960, h: 120};

export type LayoutGeometry = {
  id: string;
  describe: string;
  content: Rect;
  /** Pip's anchor (the point his body stands on) and scale; null = no mascot. */
  mascot: MascotAnchor | null;
  /** The scene may move Pip aside or out of frame, so content may use his space while he is away. */
  mascotMovable: boolean;
  /** A free panel next to the mascot (readouts, legends). */
  panel?: Rect;
};

/** The extent of Pip's drawing from his anchor (measured from the prototype's frames; the hands add the width). */
export const mascotBox = (a: MascotAnchor): Rect => ({x: a.ax - 490 * a.k, y: a.ay - 728 * a.k, w: 980 * a.k, h: 810 * a.k});

export const LAYOUTS: Record<string, LayoutGeometry> = {
  // The prototype's arrangement: a card above a large fixed Pip. Content gets 620 px of height.
  'card-over-pip': {id: 'card-over-pip', describe: 'card above a large Pip (the prototype layout)', content: {x: 70, y: 250, w: 940, h: 620}, mascot: {ax: 440, ay: 1440, k: 0.68}, mascotMovable: false},
  // Content leads: a tall window, Pip small beside a readout, free to step aside or leave the frame.
  'content-led': {id: 'content-led', describe: 'tall content window; small Pip that can step aside, point or leave the frame', content: {x: 60, y: 160, w: 960, h: 900}, mascot: {ax: 300, ay: 1460, k: 0.5}, mascotMovable: true, panel: {x: 600, y: 1090, w: 420, h: 400}},
  // Many small items: nearly the whole stage, Pip tiny in a corner (and fixed).
  'dense-pip': {id: 'dense-pip', describe: 'dense content over most of the stage; Pip tiny in the lower corner', content: {x: 60, y: 130, w: 960, h: 1250}, mascot: {ax: 840, ay: 1520, k: 0.28}, mascotMovable: false},
};
