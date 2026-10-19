// Fake render worker: same job.json and JSON-lines events as workers/render-worker.ts, no browser.
// FAKE_RENDER_SPEC_COPY (copy the job spec there), FAKE_RENDER_FRAMES (default 10), FAKE_RENDER_STEP_MS (default 30), FAKE_RENDER_CHILDREN (spawn N sleepers), FAKE_RENDER_FAIL.
import {execFileSync, spawn} from 'node:child_process';
import {copyFileSync, existsSync, readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';

const job = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const send = (o: unknown) => process.stdout.write(JSON.stringify(o) + '\n');
// FAKE_RENDER_CONTROL: a JSON file ({frames, stepMs, fail, children}) read at start, so a test can change behaviour of a server that is already running.
const ctl: {frames?: number; stepMs?: number; fail?: string; children?: number} = process.env.FAKE_RENDER_CONTROL && existsSync(process.env.FAKE_RENDER_CONTROL) ? JSON.parse(readFileSync(process.env.FAKE_RENDER_CONTROL, 'utf8')) : {};
const frames = ctl.frames ?? Number(process.env.FAKE_RENDER_FRAMES ?? 10);
const stepMs = ctl.stepMs ?? Number(process.env.FAKE_RENDER_STEP_MS ?? 30);
const failMessage = ctl.fail ?? process.env.FAKE_RENDER_FAIL;
for (let i = 0; i < (ctl.children ?? Number(process.env.FAKE_RENDER_CHILDREN ?? 0)); i++) spawn('sleep', ['300'], {stdio: 'ignore'});
if (process.env.FAKE_RENDER_SPEC_COPY) copyFileSync(process.argv[2], process.env.FAKE_RENDER_SPEC_COPY); // tests: what the render was asked to draw
send({event: 'progress', step: 'bundling'});
if (failMessage) { send({event: 'error', message: failMessage}); process.exit(1); }
for (let f = 1; f <= frames; f++) {
  await new Promise((r) => setTimeout(r, stepMs));
  send({event: 'progress', step: 'rendering', fraction: f / frames, renderedFrames: f, encodedFrames: f, totalFrames: frames});
}
// FAKE_RENDER_REAL=1: a real small MP4 (flat picture) carrying the audio the job was given, so file checks have a real file to read.
if (process.env.FAKE_RENDER_REAL === '1' && !ctl.fail) {
  const tl = job.inputProps.data.timeline;
  const audio = join(job.publicDir, 'generated', job.inputProps.episode, job.inputProps.variant, tl.audio);
  execFileSync('ffmpeg', ['-hide_banner', '-nostdin', '-y', '-v', 'error', '-f', 'lavfi', '-i', `color=c=0xF5F2EA:s=1080x1920:r=30:d=${tl.durationSec}`, '-i', audio, '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '40', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart', job.out]);
} else writeFileSync(job.out, `fake mp4 for ${job.composition} ${JSON.stringify(job.inputProps.data.timeline.durationSec)}`);
const realFrames = process.env.FAKE_RENDER_REAL === '1' && !ctl.fail ? Math.round(job.inputProps.data.timeline.durationSec * 30) : frames;
send({event: 'result', data: {crf: job.crf, out: job.out, bytes: 10, frames: realFrames, fps: 30, width: 1080, height: 1920, bundleMs: 1, totalMs: frames * stepMs}});
