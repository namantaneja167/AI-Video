import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {join} from 'node:path';
import {describe, test} from 'node:test';
import {ROOT} from '../helpers.ts';

const py = join(ROOT, '.venv-qwen/bin/python');

describe('audio workers reproduce the prototype', () => {
  test('synthesized accents match the prototype sound-effects track to within 2 16-bit steps', () => {
    const r = JSON.parse(execFileSync(py, [join(ROOT, 'tests/library/accent_parity.py')], {encoding: 'utf8'}));
    assert.equal(r.n_events, 18);
    assert.equal(r.len_match, true);
    assert.ok(r.max_abs_lsb <= 2, `max difference ${r.max_abs_lsb} steps`);
  });
  test('the mouth track from the raw prototype narration take equals the prototype mouth track', () => {
    const out = execFileSync(py, [join(ROOT, 'tests/library/mouth_parity.py')], {encoding: 'utf8'});
    const r = JSON.parse(out);
    assert.equal(r.n, 489);
    assert.ok(r.max_abs < 1e-9, `largest difference ${r.max_abs}`);
  });

  test('the complete voice-plus-accent mix is mastered to the target (-16 LUFS, -1.5 dBTP) without relaxing either, and the voice stays aligned', () => {
    const r = JSON.parse(execFileSync(py, [join(ROOT, 'tests/library/mastering_check.py')], {encoding: 'utf8'}));
    for (const k of ['plain', 'full']) {
      assert.ok(Math.abs(r[k].integrated_lufs + 16) <= 0.2, `${k}: ${r[k].integrated_lufs} LUFS`);
      assert.ok(r[k].true_peak_dbfs <= -1.5, `${k}: true peak ${r[k].true_peak_dbfs}`);
    }
    assert.equal(r.full_mastering.order, 'voice and accents mixed, then mastered');
    assert.equal(r.full_mastering.accent_scale_db, -r.full_mastering.gain_db, 'accents are scaled down by exactly the gain, so they end at their authored level');
    assert.equal(r.plain_mastering.order, 'voice mastered');
    assert.equal(r.full_mastering.compressor, null, 'peak limiting only, no compression of the narration');
    assert.ok(Math.abs(r.accent_level_vs_authored_db) <= 2.5, `an accent ends at its authored level in the finished mix (${r.accent_level_vs_authored_db} dB)`);
    assert.equal(r.lag_samples, 0, 'the limiter delay is compensated');
    assert.ok(r.length_equal);
  });
});
