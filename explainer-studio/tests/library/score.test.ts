import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {describe, test} from 'node:test';
import {ROOT} from '../helpers.ts';
import {loadBundled} from './bundle.ts';

const T = JSON.parse(readFileSync(join(ROOT, 'prototypes/pip-scene-10x-v1/audio/timing.json'), 'utf8'));

describe('the prototype performance as data', () => {
  test('the score gives the same pose as the original perform() for every frame of the prototype', async () => {
    const m = await loadBundled(join(ROOT, 'tests/library/entries/pose-entry.ts'));
    const frames = Array.from({length: T.frames}, (_, i) => i);
    const r = m.compareAll(T, frames);
    assert.equal(r.frames, 489);
    assert.equal(r.mismatchedShape, 0, 'same set of fields in every frame');
    // The two do the same floating-point operations; the tolerance only covers offsets summed in a different order (1e-9 of a pixel or degree).
    assert.ok(r.max < 1e-9, `largest difference ${r.max} at frame ${r.worstFrame}`);
    assert.ok(r.fxFrames > 5, 'the surprise burst is exercised');
  });

  test('a score that asks for a cue the scene did not provide fails loudly', async () => {
    const m = await loadBundled(join(ROOT, 'tests/library/entries/pose-entry.ts'));
    const T2 = {...T, cues: {...T.cues}};
    delete T2.cues.notice;
    assert.throws(() => m.compareAll(T2, [100]), /perform|notice|NaN|undefined/i);
  });
});
