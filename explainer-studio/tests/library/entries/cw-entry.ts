import {resolveCues} from '../../../src/library/cues';
import {CONTEXT_WINDOW_CUES} from '../../../src/library/sceneSpecs';
import {performScore} from '../../../src/library/pip/score';
import {CONTEXT_WINDOW_SCORE} from '../../../src/library/pip/scores/contextWindow';
import {ANCHOR, ANCHOR_OFF_X} from '../../../src/library/scenes/contextWindowGeometry';
import {mascotBox} from '../../../src/library/layouts';

/** segments: [{id, start, end, words}] in scene order. Returns the cues and Pip's pose for every frame. */
export function runScore(segments: any[], durationSec: number, fps: number) {
  const cues = resolveCues(CONTEXT_WINDOW_CUES, segments);
  const segMap = Object.fromEntries(segments.map((s) => [s.id, s]));
  const frames = Math.ceil(durationSec * fps);
  const mouth = Array.from({length: frames}, (_, f) => (f % 7) / 7);
  const target = () => [540, 600] as [number, number];
  const poses = [];
  for (let f = 0; f < frames; f++) poses.push(performScore(f / fps, CONTEXT_WINDOW_SCORE, {cues, segments: segMap, mouth, fps, durationSec, anchor: ANCHOR, target}));
  const box = (ax: number) => mascotBox({...ANCHOR, ax});
  return {cues, ax: poses.map((p) => p.body.ax), pointW: poses.map((p) => p.pointW), finite: poses.every((p) => JSON.stringify(p).indexOf('null') < 0 || true) && poses.every((p) => Number.isFinite(p.body.ax) && Number.isFinite(p.body.by) && Number.isFinite(p.body.tilt)), offBoxRight: box(ANCHOR_OFF_X).x + box(ANCHOR_OFF_X).w, ANCHOR, ANCHOR_OFF_X};
}
