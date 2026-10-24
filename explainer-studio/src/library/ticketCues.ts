// Cue rules for the ticket-motion scene: the start of each of its nine lines, plus the words each event is timed on.
// Kept out of sceneSpecs.ts (which is fingerprinted with the timeline logic); the timing inputs hash these rules instead.
import type {CueSpec} from './cues.ts';

const lines = Object.fromEntries(Array.from({length: 9}, (_, i) => ['s' + i, {segment: i, at: 'start' as const}]));

export const TICKET_MOTION_CUES: CueSpec = {
  ...lines,
  explain: {segment: 1, at: 'start'},
  hookshot: {segment: 0, at: {word: 'screenshot'}},
  hookexpire: {segment: 0, at: {word: 'expire'}},
  series: {segment: 0, at: {word: 'Tech'}},
  valid: {segment: 1, at: {word: 'valid'}},
  rotating: {segment: 1, at: {word: 'rotating'}},
  shot: {segment: 2, at: {word: 'screenshot'}},
  both: {segment: 2, at: {word: 'Both'}},
  time: {segment: 3, at: {word: 'Time'}},
  newcode: {segment: 3, at: {word: 'new'}},
  frozen: {segment: 3, at: {word: 'frozen'}},
  gate: {segment: 4, at: {word: 'gate'}},
  checks: {segment: 4, at: {word: 'checks'}},
  window: {segment: 4, at: {word: 'window'}},
  fail: {segment: 4, at: {word: 'fail'}},
  open: {segment: 5, at: {word: 'Open'}},
  current: {segment: 5, at: {word: 'current'}},
  passes: {segment: 5, at: {word: 8}},
  harder: {segment: 6, at: {word: 'harder'}},
  reads: {segment: 6, at: {word: 'checks'}},
  notshot: {segment: 6, at: {word: 'not'}},
  static: {segment: 7, at: {word: 'static'}},
  queue: {segment: 8, at: {word: 'queue'}},
  resolve: {segment: 8, at: 'start'},
  voice_end: {segment: 8, at: 'end'},
};
