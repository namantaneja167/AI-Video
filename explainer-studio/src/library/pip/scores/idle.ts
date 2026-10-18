// A minimal performance: Pip stands, glances at the content, blinks now and then, mouth from the audio. For scenes
// that need Pip present but have nothing for him to do.
import type {PipScore} from '../score';

const hold = (v: number) => [[{t: 0}, v]] as PipScore['wide'];
export const IDLE_SCORE: PipScore = {
  look: {x: [[{t: 0}, 0.1], [{t: 0.6}, -0.3, 'out'], [{dur: true}, -0.3]], y: [[{t: 0}, -0.1], [{t: 0.6}, -0.5, 'out'], [{dur: true}, -0.5]]},
  wide: hold(1), browL: hold(0), browR: hold(0), browLflat: hold(0), lidL: hold(0.03), lidR: hold(0.03), smile: hold(0.6), smirk: hold(0),
  tilt: hold(0), hop: hold(0), nod: hold(0), squash: hold(1),
  blinks: [], pointW: hold(0),
  handL: [[{t: 0}, 'restL']], handR: [[{t: 0}, 'restR']],
  idle: {bobPx: 2, periodSec: 3.6, tiltDeg: 0.5},
  autoBlink: {everySec: 3.1, startSec: 1.2},
};
