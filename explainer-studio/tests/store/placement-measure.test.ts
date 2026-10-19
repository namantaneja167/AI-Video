// The final-output checks (loudness, peak, lag, duration) and the voice-only placement check are separate results, and the placement
// check never produces a number from audio that contains sound accents: that case is reported as unavailable, with the reason.
// (A placement figure of 2110 ms measured on an accent-bearing mix was once saved as if it were a result.)
import assert from 'node:assert/strict';
import {execFileSync, spawnSync} from 'node:child_process';
import {existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {after, before, describe, test} from 'node:test';
import {ROOT} from '../helpers.ts';

const py = join(ROOT, '.venv-qwen', 'bin', 'python');
const tools = existsSync(py) && spawnSync('ffmpeg', ['-version']).status === 0;
const SR = 24000;

function wav(path: string, seconds: number, tones: {from: number; to: number; hz: number; amp: number}[]): void {
  const n = Math.round(seconds * SR);
  const data = Buffer.alloc(44 + n * 2);
  data.write('RIFF', 0); data.writeUInt32LE(36 + n * 2, 4); data.write('WAVEfmt ', 8); data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20);
  data.writeUInt16LE(1, 22); data.writeUInt32LE(SR, 24); data.writeUInt32LE(SR * 2, 28); data.writeUInt16LE(2, 32); data.writeUInt16LE(16, 34);
  data.write('data', 36); data.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    let v = 0;
    for (const k of tones) if (t >= k.from && t < k.to) v += k.amp * Math.sin(2 * Math.PI * k.hz * t);
    data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, v)) * 32767), 44 + i * 2);
  }
  writeFileSync(path, data);
}

describe('measurement: final output and voice-only placement are separate', {skip: !tools && 'needs .venv-qwen and ffmpeg'}, () => {
  let dir = '';
  const speech = [{from: 1.0, to: 2.0, hz: 220, amp: 0.3}, {from: 2.6, to: 3.6, hz: 220, amp: 0.3}, {from: 4.2, to: 5.2, hz: 220, amp: 0.3}];
  const accent = {from: 5.25, to: 5.85, hz: 880, amp: 0.5}; // starts 50 ms after the last word: an energy detector reads it as part of the speech
  const timeline = {durationSec: 8, segments: [{id: 's1', start: 1.0, end: 2.0}, {id: 's2', start: 2.6, end: 3.6}, {id: 's3', start: 4.2, end: 5.2}]};

  function measure(env: Record<string, string>): any {
    const out = join(dir, `m-${Math.random().toString(36).slice(2)}.json`);
    execFileSync(py, [join(ROOT, 'scripts', 'phase2_measure.py'), join(dir, 'final.mp4'), join(dir, 'final.wav'), join(dir, 'timeline.json'), out, '-16', '-1.5'], {env: {...process.env, ...env}, stdio: 'pipe'});
    return JSON.parse(readFileSync(out, 'utf8'));
  }

  before(() => {
    dir = mkdtempSync(join(tmpdir(), 'studio-measure-'));
    mkdirSync(dir, {recursive: true});
    wav(join(dir, 'voice.wav'), 8, speech);
    wav(join(dir, 'final.wav'), 8, [...speech, accent]);
    writeFileSync(join(dir, 'timeline.json'), JSON.stringify(timeline));
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=black:s=64x64:r=30:d=8', '-i', join(dir, 'final.wav'), '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', join(dir, 'final.mp4')]);
  });
  after(() => rmSync(dir, {recursive: true, force: true}));

  test('with accents in the final mix and no voice-only audio, placement is unavailable with a reason and has no number', () => {
    const r = measure({});
    assert.equal(r.schema, 2);
    assert.equal(r.voice_only_placement.available, false);
    assert.match(r.voice_only_placement.reason, /sound accents/);
    for (const k of ['worst_ms', 'pass', 'segments', 'worst_ms_by_threshold_db']) assert.equal(k in r.voice_only_placement, false, `${k} must not exist when the check is unavailable`);
    assert.equal('placement_worst_ms' in r, false, 'no stray top-level placement figure');
    assert.equal('placement_pass' in r, false);
  });

  test('final-output checks are measured and kept apart from placement, whether or not placement is available', () => {
    for (const env of [{} as Record<string, string>, {PLACEMENT_WAV: join(dir, 'voice.wav')}]) {
      const r = measure(env);
      assert.equal(typeof r.final_output.mastered_wav.integrated_lufs, 'number');
      assert.equal(typeof r.final_output.decoded_mp4_audio.true_peak_dbtp, 'number');
      assert.equal(typeof r.final_output.global_lag_ms, 'number');
      assert.equal(typeof r.final_output.lag_pass, 'boolean');
      assert.equal(typeof r.final_output.duration_difference_ms, 'number');
      assert.equal('placement' in r.final_output, false, 'placement is not mixed into the final-output group');
    }
  });

  test('with the voice-only audio, placement is measured on it and passes, although the final audio would give a large wrong figure', () => {
    const valid = measure({PLACEMENT_WAV: join(dir, 'voice.wav')}).voice_only_placement;
    assert.equal(valid.available, true);
    assert.match(valid.measured_on, /voice-only/);
    assert.ok(valid.worst_ms <= 80, `voice-only worst ${valid.worst_ms} ms`);
    assert.equal(valid.pass, true);
    assert.equal(valid.segments.length, 3);
    // The same boundaries read off the accent-bearing audio (only possible by wrongly declaring it accent-free): this is the misleading number.
    const misleading = measure({MIX_HAS_ACCENTS: '0'}).voice_only_placement;
    assert.ok(misleading.worst_ms > 500, `accent-bearing audio gave ${misleading.worst_ms} ms, which is not a placement error`);
  });

  test('declaring the mix accent-free measures the decoded MP4 audio and says so', () => {
    const r = measure({MIX_HAS_ACCENTS: '0'}).voice_only_placement;
    assert.equal(r.available, true);
    assert.match(r.measured_on, /decoded mp4 audio.*no sound accents/);
  });
});
