// Bundled by esbuild in the test: the score and the performer cannot be loaded by Node directly.
import {performScore} from '../../../src/library/pip/score';
import {pipCardsScore, type TimedAction} from '../../../src/library/pip/scores/pipCards';

const ANCHOR = {ax: 300, ay: 1460, k: 0.5};
export function pose(actions: TimedAction[], t: number, idle = false) {
  const score = pipCardsScore(actions, {idle, anchor: ANCHOR});
  const p = performScore(t, score, {cues: {}, segments: {}, mouth: [], fps: 30, durationSec: 20, anchor: ANCHOR, target: () => [540, 600]});
  return {by: p.body.by, pointW: p.pointW, tilt: p.body.tilt, eye: p.spec.face.eyeL.c, mouth: p.spec.face.mouth.p0};
}
