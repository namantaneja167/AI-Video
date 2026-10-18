// Bundled by esbuild in the test: the art modules cannot be loaded by Node directly (JSX, extensionless imports).
import {perform} from '../../../src/art/pip-scene/rig';
import {performScore} from '../../../src/library/pip/score';
import {PROTOTYPE_SCORE} from '../../../src/library/pip/scores/prototype';
import {clamp01, easeInOut, lerp} from '../../../src/anim';

const CARD = {x: 70, y: 250, w: 940, h: 620};
const ASTS: [number, number] = [CARD.x + 386, CARD.y + 146];
const CALLS: [number, number] = [CARD.x + CARD.w / 2, CARD.y + 46 + 232];
const ANCHOR = {ax: 440, ay: 1440, k: 0.68};

const flat = (v: unknown, out: number[] = []): number[] => {
  if (typeof v === 'number') out.push(v);
  else if (Array.isArray(v)) v.forEach((x) => flat(x, out));
  else if (v && typeof v === 'object') for (const k of Object.keys(v).sort()) flat((v as any)[k], out);
  else if (v === undefined) out.push(-12345);
  return out;
};

/** Largest absolute difference between the original performance and the score, over every frame; plus the shape check. */
export function compareAll(T: any, frames: number[]) {
  const target = (tt: number): [number, number] => {
    const u = easeInOut(clamp01((tt - T.cues.callout) / 0.5));
    return [lerp(ASTS[0], CALLS[0], u), lerp(ASTS[1], CALLS[1], u)];
  };
  const ctx = {cues: T.cues, segments: Object.fromEntries(T.segments.map((s: any) => [s.id, s])), mouth: T.mouth, fps: T.fps, durationSec: T.durationSec, anchor: ANCHOR, target};
  let max = 0, worstFrame = -1, mismatchedShape = 0, fxFrames = 0;
  for (const f of frames) {
    const t = f / T.fps;
    const a = flat(perform(t, T, ANCHOR, target));
    const b = flat(performScore(t, PROTOTYPE_SCORE, ctx));
    if (a.length !== b.length) { mismatchedShape++; continue; }
    for (let i = 0; i < a.length; i++) { const d = Math.abs(a[i] - b[i]); if (d > max) { max = d; worstFrame = f; } }
    if (perform(t, T, ANCHOR, target).spec.fx) fxFrames++;
  }
  return {max, worstFrame, mismatchedShape, fxFrames, frames: frames.length};
}
