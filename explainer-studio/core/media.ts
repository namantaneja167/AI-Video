// Reading and measuring media files for the production checks: a small WAV reader (the takes) and ffprobe/ffmpeg
// measurements (the video file). Every number here is computed from the file; nothing is inferred from how it was made.
import {spawn, type ChildProcess} from 'node:child_process';
import {readFileSync} from 'node:fs';

/** How a child process is started. The job handler passes one that records the process as owned by the job, so cancelling stops it. */
export type SpawnFn = (cmd: string, args: string[]) => ChildProcess;
const plainSpawn: SpawnFn = (cmd, args) => spawn(cmd, args, {stdio: ['ignore', 'pipe', 'pipe']});

export class MediaError extends Error {}

export function capture(cmd: string, args: string[], spawnFn: SpawnFn = plainSpawn): Promise<{stdout: string; stderr: string; code: number | null}> {
  return new Promise((resolve, reject) => {
    const child = spawnFn(cmd, args);
    let stdout = '', stderr = '';
    child.stdout?.setEncoding('utf8').on('data', (d: string) => { stdout += d; });
    child.stderr?.setEncoding('utf8').on('data', (d: string) => { stderr += d; });
    child.on('error', (e) => reject(new MediaError(`could not run ${cmd}: ${e.message}`)));
    child.on('close', (code) => resolve({stdout, stderr, code}));
  });
}

// ---- WAV ---------------------------------------------------------------------------------------------------------
export type Pcm = {sampleRate: number; channels: number; /** Mono mix, -1..1. */ samples: Float32Array; seconds: number};

/** PCM 16/24/32-bit integer and 32-bit float WAV files (also the extensible form), mixed to mono. */
export function readWav(path: string): Pcm {
  const b = readFileSync(path);
  if (b.length < 12 || b.toString('ascii', 0, 4) !== 'RIFF' || b.toString('ascii', 8, 12) !== 'WAVE') throw new MediaError(`${path} is not a WAV file`);
  let o = 12, tag = 0, channels = 0, rate = 0, bits = 0, dataAt = -1, dataLen = 0;
  while (o + 8 <= b.length) {
    const id = b.toString('ascii', o, o + 4);
    const size = b.readUInt32LE(o + 4);
    if (id === 'fmt ') {
      tag = b.readUInt16LE(o + 8); channels = b.readUInt16LE(o + 10); rate = b.readUInt32LE(o + 12); bits = b.readUInt16LE(o + 22);
      if (tag === 0xfffe && size >= 40) tag = b.readUInt16LE(o + 8 + 24);
    }
    if (id === 'data') { dataAt = o + 8; dataLen = Math.min(size, b.length - dataAt); break; }
    o += 8 + size + (size % 2);
  }
  if (dataAt < 0 || !rate || !channels) throw new MediaError(`${path} has no readable audio data`);
  const bytes = bits / 8;
  if (!((tag === 1 && [16, 24, 32].includes(bits)) || (tag === 3 && bits === 32))) throw new MediaError(`${path}: unsupported WAV format (tag ${tag}, ${bits} bits)`);
  const frames = Math.floor(dataLen / (bytes * channels));
  const out = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    let sum = 0;
    for (let c = 0; c < channels; c++) {
      const at = dataAt + (i * channels + c) * bytes;
      sum += tag === 3 ? b.readFloatLE(at) : bits === 16 ? b.readInt16LE(at) / 32768 : bits === 24 ? b.readIntLE(at, 3) / 8388608 : b.readInt32LE(at) / 2147483648;
    }
    out[i] = sum / channels;
  }
  return {sampleRate: rate, channels, samples: out, seconds: frames / rate};
}

export type WavFacts = {
  durationSec: number; sampleRate: number; peakDb: number;
  /** Seconds of near-silence (under -45 dBFS in 20 ms frames) before the first and after the last sound. */
  leadingSilenceSec: number; trailingSilenceSec: number;
  /** The longest run of near-silence between the first and the last sound. */
  longestInnerSilenceSec: number;
  /** Share of 20 ms frames that carry speech-level energy (over -40 dBFS), overall and in each quarter of the file. */
  speechRatio: number; quarterSpeechRatio: number[];
  /** The last 10 ms: if it is still loud the audio was cut off, not finished. */
  endPeakDb: number; endRmsDb: number;
  clippedSamples: number;
};

const db = (x: number) => (x <= 1e-9 ? -180 : 20 * Math.log10(x));
export const SILENCE_DB = -45;
export const SPEECH_DB = -40;

export function analyzeWav(pcm: Pcm): WavFacts {
  const {samples, sampleRate} = pcm;
  const frame = Math.max(1, Math.round(sampleRate * 0.02));
  const n = Math.floor(samples.length / frame);
  const level: number[] = [];
  let peak = 0, clipped = 0;
  for (let f = 0; f < n; f++) {
    let sum = 0;
    for (let i = f * frame; i < (f + 1) * frame; i++) { const v = samples[i]; sum += v * v; const a = Math.abs(v); if (a > peak) peak = a; if (a >= 0.999) clipped++; }
    level.push(db(Math.sqrt(sum / frame)));
  }
  const loud = (l: number) => l > SILENCE_DB;
  const first = level.findIndex(loud);
  let last = -1;
  for (let i = level.length - 1; i >= 0; i--) if (loud(level[i])) { last = i; break; }
  let longest = 0, run = 0;
  if (first >= 0) for (let i = first; i <= last; i++) { if (!loud(level[i])) { run++; longest = Math.max(longest, run); } else run = 0; }
  const speech = (from: number, to: number) => { let c = 0; for (let i = from; i < to; i++) if (level[i] > SPEECH_DB) c++; return to > from ? c / (to - from) : 0; };
  const tail = Math.max(1, Math.round(sampleRate * 0.01));
  let tp = 0, ts = 0;
  for (let i = Math.max(0, samples.length - tail); i < samples.length; i++) { const v = samples[i]; tp = Math.max(tp, Math.abs(v)); ts += v * v; }
  const r = (x: number) => Math.round(x * 100) / 100;
  return {
    durationSec: r(samples.length / sampleRate), sampleRate, peakDb: r(db(peak)),
    leadingSilenceSec: first < 0 ? r(n * 0.02) : r(first * 0.02), trailingSilenceSec: first < 0 ? r(n * 0.02) : r((n - 1 - last) * 0.02), longestInnerSilenceSec: r(longest * 0.02),
    speechRatio: r(speech(0, n)), quarterSpeechRatio: [0, 1, 2, 3].map((q) => r(speech(Math.floor((n * q) / 4), Math.floor((n * (q + 1)) / 4)))),
    endPeakDb: r(db(tp)), endRmsDb: r(db(Math.sqrt(ts / tail))), clippedSamples: clipped,
  };
}

// ---- video files -------------------------------------------------------------------------------------------------
export type MediaProbe = {
  formatName: string; durationSec: number | null; sizeBytes: number | null;
  video: {codec: string; width: number; height: number; fps: number | null; durationSec: number | null; frames: number | null} | null;
  audio: {codec: string; sampleRate: number; channels: number; durationSec: number | null} | null;
};

const num = (v: unknown): number | null => { const n = Number(v); return v === undefined || v === null || v === 'N/A' || !Number.isFinite(n) ? null : n; };
const ratio = (v: unknown): number | null => { const m = /^(\d+)\/(\d+)$/.exec(String(v)); return m && Number(m[2]) ? Number(m[1]) / Number(m[2]) : num(v); };

/** What the container says about itself. Throws MediaError when the file cannot be read as media at all. */
export async function probeMedia(path: string, spawnFn?: SpawnFn): Promise<MediaProbe> {
  const r = await capture('ffprobe', ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', path], spawnFn);
  if (r.code !== 0) throw new MediaError(`ffprobe cannot read the file: ${r.stderr.trim().split('\n').slice(-2).join(' | ') || `exit ${r.code}`}`);
  let j: {format?: Record<string, unknown>; streams?: Record<string, unknown>[]};
  try { j = JSON.parse(r.stdout); } catch { throw new MediaError('ffprobe returned nothing readable'); }
  const streams = (j.streams ?? []).filter((s) => s.codec_name);
  if (!streams.length) throw new MediaError('ffprobe finds no readable video or audio stream: the file is damaged or is not a video');
  const v = streams.find((s) => s.codec_type === 'video');
  const a = streams.find((s) => s.codec_type === 'audio');
  return {
    formatName: String(j.format?.format_name ?? ''), durationSec: num(j.format?.duration), sizeBytes: num(j.format?.size),
    video: v ? {codec: String(v.codec_name), width: Number(v.width), height: Number(v.height), fps: ratio(v.avg_frame_rate), durationSec: num(v.duration), frames: num(v.nb_frames)} : null,
    audio: a ? {codec: String(a.codec_name), sampleRate: Number(a.sample_rate), channels: Number(a.channels), durationSec: num(a.duration)} : null,
  };
}

export type AudioMeasure = {integratedLufs: number | null; loudnessRangeLu: number | null; truePeakDbtp: number | null; decodedSec: number; errors: string[]};

/** Decode the audio track of the file and measure it (EBU R128 integrated loudness and true peak, on what is actually in the file). */
export async function measureAudio(path: string, spawnFn?: SpawnFn): Promise<AudioMeasure> {
  const r = await capture('ffmpeg', ['-hide_banner', '-nostdin', '-nostats', '-v', 'info', '-i', path, '-map', '0:a:0', '-vn', '-af', 'ebur128=peak=true', '-progress', 'pipe:1', '-f', 'null', '-'], spawnFn);
  const summary = r.stderr.split('Summary:')[1] ?? '';
  const pick = (re: RegExp) => { const m = re.exec(summary); return m ? Number(m[1]) : null; };
  const times = [...r.stdout.matchAll(/out_time_us=(\d+)/g)].map((m) => Number(m[1]));
  const errors = r.stderr.split('\n').filter((l) => /error|invalid data|corrupt|truncat|missing|non-monoton/i.test(l) && !/^\s*(I:|LRA|Peak)/.test(l)).slice(0, 5).map((l) => l.trim());
  if (r.code !== 0) errors.unshift(`ffmpeg exited with code ${r.code}`);
  return {integratedLufs: pick(/I:\s+(-?[\d.]+) LUFS/), loudnessRangeLu: pick(/LRA:\s+(-?[\d.]+) LU/), truePeakDbtp: pick(/Peak:\s+(-?[\d.]+) dBFS/), decodedSec: times.length ? Math.round((times[times.length - 1] / 1e6) * 100) / 100 : 0, errors};
}

export type VideoMeasure = {decodedFrames: number; decodedSec: number; errors: string[]};

/** Decode every video frame (no output is written): finds a file that is cut short or damaged part-way. */
export async function measureVideo(path: string, spawnFn?: SpawnFn): Promise<VideoMeasure> {
  const r = await capture('ffmpeg', ['-hide_banner', '-nostdin', '-nostats', '-v', 'error', '-i', path, '-map', '0:v:0', '-an', '-progress', 'pipe:1', '-f', 'null', '-'], spawnFn);
  const frames = [...r.stdout.matchAll(/frame=(\d+)/g)].map((m) => Number(m[1]));
  const times = [...r.stdout.matchAll(/out_time_us=(\d+)/g)].map((m) => Number(m[1]));
  const errors = r.stderr.split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 5);
  if (r.code !== 0) errors.unshift(`ffmpeg exited with code ${r.code}`);
  return {decodedFrames: frames.length ? frames[frames.length - 1] : 0, decodedSec: times.length ? Math.round((times[times.length - 1] / 1e6) * 100) / 100 : 0, errors};
}
