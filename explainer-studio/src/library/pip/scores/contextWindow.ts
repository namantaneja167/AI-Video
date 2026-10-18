// Pip's performance in the context-window explainer, as data: gaze, expression, pointing, holds, a restrained idle,
// stepping out of frame while two outcomes are shown, and coming back. Mouth movement comes from the narration audio.
import type {NumKey, PipScore} from '../score';
import {ANCHOR, ANCHOR_OFF_X} from '../../scenes/contextWindowGeometry';

const k = (...pairs: [any, number, any?][]): NumKey[] => pairs as NumKey[];
const c = (cue: string, dt = 0) => ({cue, dt});

export const CONTEXT_WINDOW_SCORE: PipScore = {
  // gaze: up at the window, to the pieces, to the readout, then to the viewer when he comes back
  look: {
    x: k([{t: 0}, 0.05], [{t: 0.4}, 0.3, 'out'], [c('label'), 0.25], [c('tokens_fly', -0.2), 0.3], [c('reply_start'), 0.45], [c('share'), 0.2], [c('full', -0.3), 0.3], [c('full', 0.3), 0.0], [c('back', 0.3), -0.2], [c('back', 1.1), 0.0], [{dur: true}, 0.0]),
    y: k([{t: 0}, -0.1], [{t: 0.4}, -0.55, 'out'], [c('label'), -0.6], [c('tokens_fly', -0.2), -0.35], [c('reply_start'), -0.35], [c('share'), -0.55], [c('full', -0.3), -0.4], [c('full', 0.3), -0.1], [c('back', 0.3), 0.0], [{dur: true}, 0.0]),
  },
  wide: k([{t: 0}, 1], [{t: 0.4}, 1.06], [c('full', -0.05), 1.06], [c('full', 0.08), 1.16, 'out'], [c('full', 0.6), 1.02], [{dur: true}, 1.0]),
  browL: k([{t: 0}, 0], [{t: 0.4}, -10], [c('share'), -12], [c('full', -0.05), -12], [c('full', 0.08), 5], [c('leave'), 2], [c('back', 1.0), -2], [{dur: true}, 0]),
  browR: k([{t: 0}, 0], [{t: 0.4}, -10], [c('share'), -14], [c('full', -0.05), -14], [c('full', 0.08), -28], [c('leave'), -12], [c('back', 1.0), -4], [{dur: true}, -2]),
  browLflat: k([{t: 0}, 0], [c('full', 0.1), 0], [c('full', 0.3), 0.5], [c('leave'), 0.2], [c('back', 0.6), 0], [{dur: true}, 0]),
  lidL: k([{t: 0}, 0], [c('full', 0.1), 0.18], [c('leave'), 0.1], [c('back', 0.6), 0.04], [{dur: true}, 0.04]),
  lidR: k([{t: 0}, 0], [c('full', 0.1), 0.05], [c('back', 0.6), 0.02], [{dur: true}, 0.04]),
  smile: k([{t: 0}, 0.5], [c('label'), 0.8], [c('history'), 0.6], [c('share'), 0.5], [c('full', -0.1), 0.35], [c('full', 0.2), -0.05], [c('leave'), 0.1], [c('back', 0.4), 0.7], [c('settled'), 1.0], [{dur: true}, 0.9]),
  smirk: k([{t: 0}, 0], [c('full', 0.1), 0], [c('full', 0.35), 0.7], [c('leave'), 0.3], [c('back'), 0], [{dur: true}, 0]),
  tilt: k([{t: 0}, 0], [c('window_in', 0.4), 2.5], [c('prompt_in'), 2.5], [c('prompt_in', 0.5), -1], [c('share'), 3.5], [c('full', 0.1), -2, 'out'], [c('full', 0.9), 2], [c('leave'), 0], [c('back', 0.8), 0], [{dur: true}, 0]),
  hop: k([{t: 0}, 0], [c('window_in'), 0], [c('window_in', 0.14), -10, 'out'], [c('window_in', 0.4), 0, 'out'], [c('full', -0.1), 0], [c('full', 0.04), -17, 'out'], [c('full', 0.32), 0, 'out'], [{dur: true}, 0]),
  nod: k([{t: 0}, 0], [c('label', 0.8), 0], [c('label', 1.0), 7], [c('label', 1.3), 0], [c('history', 0.4), 0], [c('history', 0.6), 6], [c('history', 0.9), 0], [c('back', 0.9), 0], [c('back', 1.05), 8], [c('back', 1.4), 0], [{dur: true}, 0]),
  squash: k([{t: 0}, 1], [c('full', -0.14), 1], [c('full', -0.04), 0.955], [c('full', 0.08), 1.045, 'out'], [c('full', 0.34), 1, 'out'], [{dur: true}, 1]),
  blinks: [c('label', 1.4), c('history_end'), c('share_end', 0.1), c('settled', 0.4), {dur: true, dt: -0.9}],
  pointW: k([c('label', -0.25), 0], [c('label', -0.24), 1], [c('label', 1.3), 1], [c('label', 1.6), 0], [c('input_word', -0.3), 0], [c('input_word', -0.29), 1], [c('share_end', 0.1), 1], [c('share_end', 0.5), 0], [{dur: true}, 0]),
  handL: [
    [{t: 0}, 'restL'],
    [c('prompt_in'), 'restL'],
    [c('prompt_in', 0.25), {x: 232, y: 668, rot: -92}],
    [c('tokens_fly', 0.2), {x: 232, y: 668, rot: -92}],
    [c('tokens_fly', 0.6), 'restL'],
    [c('full', -0.04), 'restL'],
    [c('full', 0.1), {x: 222, y: 640, rot: -80, shape: 'spread'}, 'out'],
    [c('full', 0.7), {x: 240, y: 704, rot: -99}],
    [c('leave'), {x: 240, y: 704, rot: -99}],
    [{dur: true}, 'restL'],
  ],
  handR: [
    [{t: 0}, 'restR'],
    [c('label', -0.5), 'restR'],
    [c('label', -0.25), {x: 870, y: 664, rot: 52, shape: 'open'}],
    [c('label', -0.05), 'tip', 'out'],
    [c('label', 1.3), 'tip'],
    [c('label', 1.8), {x: 852, y: 704, rot: 78}],
    [c('reply_start', 0.1), 'restR'],
    [c('input_word', -0.5), 'restR'],
    [c('input_word', -0.3), {x: 870, y: 664, rot: 52, shape: 'open'}],
    [c('input_word', -0.1), 'tip', 'out'],
    [c('share_end', 0.1), 'tip'],
    [c('share_end', 0.6), {x: 852, y: 704, rot: 78}],
    [c('full', -0.04), {x: 852, y: 704, rot: 78}],
    [c('full', 0.1), {x: 868, y: 668, rot: 70, shape: 'spread'}, 'out'],
    [c('full', 0.7), {x: 852, y: 704, rot: 78}],
    [c('leave'), 'restR'],
    [{dur: true}, 'restR'],
  ],
  burstAt: c('full'),
  // Out of frame to the left for the two outcomes, then back in; otherwise standing where the layout puts him.
  move: {
    ax: k([{t: 0}, ANCHOR.ax], [c('leave'), ANCHOR.ax], [c('leave', 0.7), ANCHOR_OFF_X, 'inOut'], [c('back'), ANCHOR_OFF_X], [c('back', 0.9), ANCHOR.ax, 'out'], [{dur: true}, ANCHOR.ax]),
  },
  idle: {bobPx: 3, periodSec: 3.4, tiltDeg: 0.6},
};
