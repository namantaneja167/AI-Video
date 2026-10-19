// What the browser probe reports about one frame, as plain data (no React, no DOM types): the probe component produces it in the
// browser that renders the video, and the production checks (Node) analyse it. Rectangles are in composition pixels (1080 x 1920).
export type PRect = {x: number; y: number; w: number; h: number};

export type ProbeElement = {
  id: string;
  /** text: measured text; box: a container of text; zone: a region content must keep clear of (the caption pill). */
  kind: 'text' | 'box' | 'zone';
  zone?: 'caption';
  /** Carries meaning (held to the larger minimum text size and to the overlap rules). */
  essential: boolean;
  /** May sit under Pip's box (a background panel, or Pip leaves while it is shown). */
  mayOverlapMascot?: boolean;
  /** The id of the box that contains this element; the two are not reported as overlapping. */
  parent?: string;
  rect: PRect;
  /** Part-way through an entrance (its transform is not the identity): its box is not judged against the safe area or other boxes in this frame. */
  moving?: boolean;
  /** Own opacity times that of every ancestor: an element that is still fading in is not judged. */
  opacity: number;
  fontPx?: number;
  stack?: string;
  text?: string;
  /** The text runs past its own box (scroll size), or past the box that contains it. */
  clipped?: {x: boolean; y: boolean};
};

export type ProbeFont = {
  /** The font-family list as the element declares it, and its first family. */
  stack: string;
  first: string;
  /** The first family of the list the browser can actually use ('system-ui' for the system stack, which cannot be tested), or null when only generic fallbacks remain. */
  resolved: string | null;
};

export type ProbeSample = {
  frame: number;
  t: number;
  scene: string;
  elements: ProbeElement[];
  fonts: ProbeFont[];
  /** Every font face the page knows, and whether it loaded. */
  faces: {family: string; weight: string; status: string}[];
};

export const PROBE_LOG = 'STUDIO_PROBE';
