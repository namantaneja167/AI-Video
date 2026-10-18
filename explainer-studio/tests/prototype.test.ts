import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {existsSync, mkdtempSync, readFileSync, statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {describe, test} from 'node:test';
import {ROOT, readJson, mkTmp} from './helpers.ts';

const PROTO = join(ROOT, 'prototypes', 'pip-scene-10x-v1');
const manifest = existsSync(join(PROTO, 'MANIFEST.json')) ? readJson('prototypes', 'pip-scene-10x-v1', 'MANIFEST.json') : null;
const skip = manifest ? false : 'prototype not present in this checkout; restore it from a project backup';

describe('preserved prototype pip-scene-10x-v1 (frozen)', {skip}, () => {
  test('every file listed in MANIFEST.json exists with the recorded size and SHA-256', () => {
    const entries = Object.entries<{sha256: string; bytes: number}>(manifest.files);
    assert.ok(entries.length >= 30, `manifest lists ${entries.length} files`);
    for (const [rel, meta] of entries) {
      const file = join(PROTO, rel);
      assert.ok(existsSync(file), `${rel} is missing`);
      assert.equal(statSync(file).size, meta.bytes, `${rel}: size`);
      assert.equal(createHash('sha256').update(readFileSync(file)).digest('hex'), meta.sha256, `${rel}: sha256`);
    }
  });

  test('the preserved video is the 16.3 s, 489-frame, 1080x1920 file the manifest describes', () => {
    const r = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,nb_frames,r_frame_rate', '-of', 'json', join(PROTO, 'video/pip_scene_10x_v1.mp4')], {encoding: 'utf8'});
    assert.equal(r.status, 0, r.stderr);
    const s = JSON.parse(r.stdout).streams[0];
    assert.deepEqual([s.width, s.height, Number(s.nb_frames), s.r_frame_rate], [1080, 1920, 489, '30/1']);
  });

  test('live timing data used by the composition is consistent', () => {
    const t = readJson('public', 'scenes', 'pip-10x', 'timing.json');
    assert.equal(t.fps, 30);
    assert.equal(t.frames, 489);
    assert.equal(t.mouth.length, t.frames);
    for (const w of [t.segments, t.words, t.phrases]) {
      assert.ok(w.every((x: any, i: number) => x.start <= x.end && (i === 0 || w[i - 1].start <= x.start + 1e-6)), 'times ascend');
    }
    assert.ok(Object.values<number>(t.cues).every((c) => c >= 0 && c <= t.durationSec));
  });
});

// Slower (a few seconds): re-renders frame 170 from the live code and compares it with the same frame of the
// preserved MP4. Opt in with STUDIO_SLOW=1. Threshold chosen below the 39.18 dB measured when the prototype was frozen.
const PSNR_MIN_DB = 35;
describe('prototype render parity (slow, opt-in)', {skip: !manifest ? skip : process.env.STUDIO_SLOW ? false : 'set STUDIO_SLOW=1 to run'}, () => {
  test(`frame 170 re-rendered from live code is at least ${PSNR_MIN_DB} dB PSNR against the preserved MP4`, (t) => {
    const dir = mkTmp('studio-parity-');
    const still = join(dir, 'live.png');
    const ref = join(dir, 'ref.png');
    let r = spawnSync('npx', ['remotion', 'still', 'src/index.ts', 'pip-scene-10x', still, '--frame=170'], {cwd: ROOT, encoding: 'utf8'});
    assert.equal(r.status, 0, r.stderr.slice(-500));
    r = spawnSync('ffmpeg', ['-v', 'error', '-y', '-i', join(PROTO, 'video/pip_scene_10x_v1.mp4'), '-vf', 'select=eq(n\\,170)', '-vframes', '1', ref], {encoding: 'utf8'});
    assert.equal(r.status, 0, r.stderr);
    r = spawnSync('ffmpeg', ['-i', still, '-i', ref, '-lavfi', 'psnr', '-f', 'null', '-'], {encoding: 'utf8'});
    const m = /average:([\d.]+|inf)/.exec(r.stderr);
    assert.ok(m, r.stderr.slice(-300));
    t.diagnostic(`PSNR ${m[1]} dB`);
    assert.ok(m[1] === 'inf' || Number(m[1]) >= PSNR_MIN_DB, `PSNR ${m[1]} dB`);
  });
});
