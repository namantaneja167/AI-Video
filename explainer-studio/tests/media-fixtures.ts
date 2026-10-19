// Fixtures for the production checks: speech-like WAV files and small MP4 files made with ffmpeg. Everything is written where the test says.
import {execFileSync, spawnSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';

export type WavOptions = {
  seconds: number; rate?: number;
  /** Stretches of true silence, in seconds. */
  gaps?: [number, number][];
  /** Stretches of faint sound (about -42 dBFS): not silence, but below speech level. */
  faint?: [number, number][];
  /** Keep the signal at full level until the very last sample (a cut-off take). */
  abruptEnd?: boolean;
  /** Seconds of silence at the end (ignored when abruptEnd). */
  trailSec?: number;
  /** Seconds of silence at the start. */
  leadSec?: number;
};

/** A syllable-like signal: a 140 Hz tone with harmonics under a 4 Hz amplitude modulation, peak about 0.3. */
export function writeSpeechWav(path: string, o: WavOptions): void {
  const rate = o.rate ?? 24000;
  const n = Math.round(o.seconds * rate);
  const pcm = Buffer.alloc(n * 2);
  const inAny = (t: number, list?: [number, number][]) => !!list?.some(([a, b]) => t >= a && t < b);
  const trail = o.abruptEnd ? 0 : (o.trailSec ?? 0.3);
  const speechEnd = o.seconds - trail;
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    let v = 0;
    if (t >= (o.leadSec ?? 0.1) && t < speechEnd && !inAny(t, o.gaps)) {
      const env = 0.6 + 0.4 * Math.sin(2 * Math.PI * 4 * t);
      const taper = o.abruptEnd ? 1 : Math.min(1, (speechEnd - t) / 0.15);
      const tone = Math.sin(2 * Math.PI * 140 * t) + 0.5 * Math.sin(2 * Math.PI * 280 * t) + 0.25 * Math.sin(2 * Math.PI * 560 * t);
      v = 0.2 * env * taper * tone;
    }
    if (inAny(t, o.faint)) v = 0.0079 * Math.sin(2 * Math.PI * 300 * t) * Math.SQRT2; // about -42 dBFS RMS
    pcm.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(v * 32767))), i * 2);
  }
  const head = Buffer.alloc(44);
  head.write('RIFF', 0); head.writeUInt32LE(36 + pcm.length, 4); head.write('WAVEfmt ', 8); head.writeUInt32LE(16, 16); head.writeUInt16LE(1, 20); head.writeUInt16LE(1, 22);
  head.writeUInt32LE(rate, 24); head.writeUInt32LE(rate * 2, 28); head.writeUInt16LE(2, 32); head.writeUInt16LE(16, 34); head.write('data', 36); head.writeUInt32LE(pcm.length, 40);
  writeFileSync(path, Buffer.concat([head, pcm]));
}

const ff = (args: string[]) => execFileSync('ffmpeg', ['-hide_banner', '-nostdin', '-y', '-v', 'error', ...args], {encoding: 'utf8'});
const noiseSource = (seconds: number) => ['-f', 'lavfi', '-i', `anoisesrc=color=pink:amplitude=0.3:seed=7:duration=${seconds}:sample_rate=48000`];

/** The integrated loudness of the fixture noise at its natural level. */
function naturalLufs(seconds: number): number {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-nostdin', '-nostats', ...noiseSource(seconds), '-af', 'ebur128=peak=true', '-f', 'null', '-'], {encoding: 'utf8'});
  const m = /I:\s+(-?[\d.]+) LUFS/.exec(r.stderr.split('Summary:')[1] ?? '');
  if (!m) throw new Error(`could not measure the fixture noise: ${r.stderr.slice(-300)}`);
  return Number(m[1]);
}

export type VideoOptions = {
  seconds: number; width?: number; height?: number; fps?: number;
  /** Aim the audio at this integrated loudness (LUFS) with steady pink noise; omit for no audio track. */
  lufs?: number | null;
  /** Write a fragmented MP4, so that cutting the file short leaves something readable. */
  fragmented?: boolean;
};

/** A small H.264/AAC MP4 (flat cream picture). */
export function writeVideo(path: string, o: VideoOptions): void {
  const w = o.width ?? 1080, h = o.height ?? 1920, fps = o.fps ?? 30;
  const video = ['-f', 'lavfi', '-i', `color=c=0xF5F2EA:s=${w}x${h}:r=${fps}:d=${o.seconds}`];
  const mov = o.fragmented ? ['-movflags', 'frag_keyframe+empty_moov+default_base_moof'] : ['-movflags', '+faststart'];
  const enc = ['-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p'];
  if (o.lufs === null || o.lufs === undefined) { ff([...video, ...enc, ...mov, path]); return; }
  const gain = Math.round((o.lufs - naturalLufs(o.seconds)) * 100) / 100;
  ff([...video, ...noiseSource(o.seconds), '-af', `volume=${gain}dB`, ...enc, '-c:a', 'aac', '-b:a', '192k', '-shortest', ...mov, path]);
}
