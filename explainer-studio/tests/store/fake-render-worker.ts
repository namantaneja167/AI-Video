// Fake render worker: same job.json and JSON-lines events as workers/render-worker.ts, no browser.
// FAKE_RENDER_FRAMES (default 10), FAKE_RENDER_STEP_MS (default 30), FAKE_RENDER_CHILDREN (spawn N sleepers), FAKE_RENDER_FAIL.
import {spawn} from 'node:child_process';
import {readFileSync, writeFileSync} from 'node:fs';

const job = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const send = (o: unknown) => process.stdout.write(JSON.stringify(o) + '\n');
const frames = Number(process.env.FAKE_RENDER_FRAMES ?? 10);
const stepMs = Number(process.env.FAKE_RENDER_STEP_MS ?? 30);
for (let i = 0; i < Number(process.env.FAKE_RENDER_CHILDREN ?? 0); i++) spawn('sleep', ['300'], {stdio: 'ignore'});
send({event: 'progress', step: 'bundling'});
if (process.env.FAKE_RENDER_FAIL) { send({event: 'error', message: process.env.FAKE_RENDER_FAIL}); process.exit(1); }
for (let f = 1; f <= frames; f++) {
  await new Promise((r) => setTimeout(r, stepMs));
  send({event: 'progress', step: 'rendering', fraction: f / frames, renderedFrames: f, encodedFrames: f, totalFrames: frames});
}
writeFileSync(job.out, `fake mp4 for ${job.composition} ${JSON.stringify(job.inputProps.data.timeline.durationSec)}`);
send({event: 'result', data: {crf: job.crf, out: job.out, bytes: 10, frames, fps: 30, width: 1080, height: 1920, bundleMs: 1, totalMs: frames * stepMs}});
