// The prototype's synthesized sound accents (scripts/pip_scene_timing.py) as `soundEvents` data anchored to scene cues.
// Gains are the prototype's linear gains in dB. The same list drives the parity tests and the reproduction run.
import type {AccentEvent} from '../../src/library/accents.ts';

const db = (g: number) => Math.round(20 * Math.log10(g) * 1000) / 1000;
export const PIP_10X_EVENTS: AccentEvent[] = [
  {accent: 'pop', cue: 'card_in', gainDb: db(0.5), params: {f: 430, dur: 0.14}},
  {accent: 'pop', cue: 'claim', gainDb: db(0.55), params: {f: 640, dur: 0.12}},
  {accent: 'swish', cue: 'bars', gainDb: db(0.38), params: {dur: 0.55}},
  {accent: 'ding', cue: 'asterisk_pulse', gainDb: db(0.4), params: {f: 988, dur: 0.7}},
  {accent: 'tick', cue: 'point', dt: 0.3, gainDb: db(0.55)},
  {accent: 'whoosh', cue: 'callout', gainDb: db(0.42), params: {dur: 0.34, up: true}},
  {accent: 'pop', cue: 'callout', dt: 0.3, gainDb: db(0.45), params: {f: 520, dur: 0.12}},
  {accent: 'whoosh', cue: 'contrast', gainDb: db(0.34), params: {dur: 0.3, up: true, seed: 9}},
  {accent: 'pop', cue: 'lane_long', gainDb: db(0.38), params: {f: 470, dur: 0.1}},
  {accent: 'thump', cue: 'resolve1', gainDb: db(0.6), params: {dur: 0.3}},
  {accent: 'chime', cue: 'resolve2', gainDb: db(0.45), params: {freqs: [587, 740], dur: 1.0}},
  ...Array.from({length: 7}, (_, i): AccentEvent => ({accent: 'tick', cue: 'contrast', dt: 0.35 + i * 0.22, gainDb: db(0.3), params: {f: 1700 + 120 * (i % 3)}})),
];
