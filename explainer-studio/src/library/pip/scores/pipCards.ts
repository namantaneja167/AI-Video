// Pip's performance in a pip-cards scene, built only from the actions the author listed, at the times their cues resolved to.
// Nothing here reads prose: an action is point, look, nod, hop or smile, with a card where one is needed.
import type {PipAction} from '../../params.ts';
import type {HandKey, NumKey, PipScore} from '../score.ts';
import {IDLE_SCORE} from './idle.ts';

export type TimedAction = {do: PipAction; t: number; /** Where Pip aims (canvas px), for point and look. */ aim?: [number, number]};
type Anchor = {ax: number; ay: number; k: number};

const HOLD_POINT = 2.2;

/** Gaze values for an aim point from where Pip stands. +x is right, -y is up (as in the other scores). */
export const gazeFor = (aim: [number, number], a: Anchor): [number, number] => {
  const eyeY = a.ay - 728 * a.k * 0.8;
  return [Math.max(-1, Math.min(1, (aim[0] - a.ax) / 800)), Math.max(-1, Math.min(1, (aim[1] - eyeY) / 900))];
};

/** Keys in time order (equal times are nudged apart), so that any order of listed actions gives a valid score. */
const ascending = <K extends NumKey | HandKey>(keys: K[]): K[] => {
  let last = -Infinity;
  return keys.map((k) => { const t = Math.max((k[0] as {t: number}).t, last + 0.001); last = t; return [{t}, ...k.slice(1)] as unknown as K; });
};

export function pipCardsScore(actions: TimedAction[], o: {idle: boolean; anchor: Anchor}): PipScore {
  const acts = [...actions].sort((a, b) => a.t - b.t);
  const base = IDLE_SCORE;
  const n = (v: number): NumKey[] => [[{t: 0}, v]];

  // gaze: the idle glance, then every look or point action turns it to its card
  const gazes = acts.filter((a) => (a.do === 'look' || a.do === 'point') && a.aim);
  const lx: NumKey[] = [[{t: 0}, 0.1], [{t: 0.6}, -0.3, 'out']];
  const ly: NumKey[] = [[{t: 0}, -0.1], [{t: 0.6}, -0.5, 'out']];
  for (const g of gazes) { const [x, y] = gazeFor(g.aim!, o.anchor); lx.push([{t: Math.max(0.7, g.t - 0.25)}, lx.length ? (lx[lx.length - 1][1] as number) : x], [{t: g.t + 0.1}, x, 'out']); ly.push([{t: Math.max(0.7, g.t - 0.25)}, ly[ly.length - 1][1] as number], [{t: g.t + 0.1}, y, 'out']); }

  const nods = acts.filter((a) => a.do === 'nod');
  const nodKeys: NumKey[] = [[{t: 0}, 0]];
  for (const a of nods) nodKeys.push([{t: a.t}, 0], [{t: a.t + 0.2}, 7, 'out'], [{t: a.t + 0.5}, 0]);
  const hops = acts.filter((a) => a.do === 'hop');
  const hopKeys: NumKey[] = [[{t: 0}, 0]];
  for (const a of hops) hopKeys.push([{t: a.t}, 0], [{t: a.t + 0.14}, -14, 'out'], [{t: a.t + 0.4}, 0, 'out']);
  const smiles = acts.filter((a) => a.do === 'smile');
  const smileKeys: NumKey[] = [[{t: 0}, 0.6]];
  for (const a of smiles) smileKeys.push([{t: a.t - 0.1}, 0.6], [{t: a.t + 0.15}, 0.95, 'out'], [{t: a.t + 1.6}, 0.6]);

  // pointing: the hand goes up before the cue and comes down after a hold; points that follow closely share one raise
  const points = acts.filter((a) => a.do === 'point');
  const pointW: NumKey[] = [[{t: 0}, 0]];
  const handR: HandKey[] = [[{t: 0}, 'restR']];
  for (let i = 0; i < points.length;) {
    let j = i;
    while (j + 1 < points.length && points[j + 1].t - points[j].t < HOLD_POINT + 0.8) j++;
    const from = points[i].t;
    const to = points[j].t + HOLD_POINT;
    pointW.push([{t: from - 0.3}, 0], [{t: from - 0.29}, 1], [{t: to}, 1], [{t: to + 0.3}, 0]);
    handR.push([{t: from - 0.5}, 'restR'], [{t: from - 0.25}, {x: 870, y: 664, rot: 52, shape: 'open'}], [{t: from - 0.05}, 'tip', 'out'], [{t: to}, 'tip'], [{t: to + 0.5}, {x: 852, y: 704, rot: 78}], [{t: to + 0.6}, 'restR']);
    i = j + 1;
  }

  const blinks = acts.filter((a) => a.do === 'look' || a.do === 'point').map((a) => ({t: a.t + 0.9}));
  return {
    ...base,
    look: {x: ascending(lx), y: ascending(ly)},
    wide: n(1), browL: n(0), browR: n(0), browLflat: n(0), lidL: n(0.03), lidR: n(0.03),
    smile: ascending(smileKeys), smirk: n(0),
    tilt: n(0), hop: ascending(hopKeys), nod: ascending(nodKeys), squash: n(1),
    blinks,
    pointW: ascending(pointW),
    handL: [[{t: 0}, 'restL']], handR: ascending(handR),
    idle: o.idle ? base.idle : undefined,
    autoBlink: base.autoBlink,
  };
}
