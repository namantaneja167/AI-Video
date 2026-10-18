import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {describe, test} from 'node:test';
import {accentTimes, accentProblems} from '../../src/library/accents.ts';
import {resolveCues} from '../../src/library/cues.ts';
import {PIP_10X_CUES} from '../../src/library/sceneSpecs.ts';
import {ROOT} from '../helpers.ts';
import {PIP_10X_EVENTS} from './prototype-events.ts';

const T = JSON.parse(readFileSync(join(ROOT, 'prototypes/pip-scene-10x-v1/audio/timing.json'), 'utf8'));
const segments = T.segments.map((s: any) => ({id: s.id, start: s.start, end: s.end, words: T.words.filter((w: any) => w.segment === s.id)}));

describe('cue rules reproduce the prototype', () => {
  test('rules applied to the prototype words give the prototype cue times (all 18)', () => {
    const got = resolveCues(PIP_10X_CUES, segments);
    assert.deepEqual(Object.keys(got).sort(), Object.keys(T.cues).sort());
    for (const [k, v] of Object.entries(T.cues as Record<string, number>)) assert.ok(Math.abs(got[k] - v) <= 0.0011, `${k}: ${got[k]} vs ${v}`);
  });
  test('a segment can be named by position within the scene', () => {
    const got = resolveCues({a: {segment: 1, at: 'start'}}, segments);
    assert.equal(got.a, segments[1].start);
  });
  test('a missing word or segment is an error, not a guess', () => {
    assert.throws(() => resolveCues({a: {segment: 's1', at: {word: 'nothere'}}}, segments), /no word/);
    assert.throws(() => resolveCues({a: {segment: 'zz', at: 'start'}}, segments), /no segment/);
  });
});

describe('accent events', () => {
  test('the prototype sound list placed on cues lands on the prototype sfx times', () => {
    const times = accentTimes(PIP_10X_EVENTS, {pip: T.cues});
    assert.equal(times.length, T.sfx.length);
    const want = T.sfx.map((s: any) => s.t).sort((a: number, b: number) => a - b);
    const got = [...times].sort((a, b) => a - b);
    got.forEach((t, i) => assert.ok(Math.abs(t - want[i]) <= 0.0011, `event ${i}: ${t} vs ${want[i]}`));
  });
  test('the prototype list is valid', () => assert.deepEqual(accentProblems(PIP_10X_EVENTS), []));
  test('unsupported sounds and bad parameters are rejected explicitly', () => {
    assert.match(accentProblems([{accent: 'laser', cue: 'x', gainDb: 0}]).join(' '), /not one of the supported accents/);
    assert.match(accentProblems([{accent: 'pop', cue: 'x', gainDb: 0, params: {f: 9}}]).join(' '), /f must be a number from/);
    assert.match(accentProblems([{accent: 'pop', cue: 'x', gainDb: 0, params: {color: 1}}]).join(' '), /no parameter "color"/);
    assert.match(accentProblems([{accent: 'pop', cue: 'x', t: 1, gainDb: 0}]).join(' '), /exactly one of/);
    assert.match(accentProblems([{accent: 'pop', gainDb: 0}]).join(' '), /exactly one of/);
    assert.match(accentProblems([{accent: 'pop', cue: 'x', gainDb: 20}]).join(' '), /gainDb/);
    assert.match(accentProblems([{accent: 'pop', cue: 'x', gainDb: 0, file: 'a.wav'}]).join(' '), /not supported/);
    assert.match(accentProblems('pop').join(' '), /must be a list/);
  });
  test('a cue no scene provides, or one two scenes provide, is an error', () => {
    assert.throws(() => accentTimes([{accent: 'pop', cue: 'nope', gainDb: 0}], {a: {x: 1}}), /not provided/);
    assert.throws(() => accentTimes([{accent: 'pop', cue: 'x', gainDb: 0}], {a: {x: 1}, b: {x: 2}}), /several scenes/);
    assert.deepEqual(accentTimes([{accent: 'pop', cue: 'x', scene: 'b', dt: 0.5, gainDb: 0}], {a: {x: 1}, b: {x: 2}}), [2.5]);
  });
});
