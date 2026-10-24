// Fake still worker: same job.json and JSON-lines events as workers/still-worker.ts, no browser. It writes a real 1080 x 1920 PNG (made by
// ffmpeg) whose colour depends on the hook it was asked to draw, so a different hook gives different bytes. FAKE_STILL_SPEC_COPY copies the job spec
// for a test to read; FAKE_STILL_MODE=crash exits without a result.
import {copyFileSync, mkdirSync, readFileSync, statSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {dirname} from 'node:path';

const job = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const send = (o: unknown) => process.stdout.write(JSON.stringify(o) + '\n');
if (process.env.FAKE_STILL_SPEC_COPY) copyFileSync(process.argv[2], process.env.FAKE_STILL_SPEC_COPY);
send({event: 'progress', step: 'bundling'});
if (process.env.FAKE_STILL_MODE === 'crash') { process.stderr.write('still worker crashed\n'); process.exit(3); }
const hook: string = job.inputProps.data.episode.scenes[0].openingHook ?? '';
const colour = createHash('sha1').update(hook).digest('hex').slice(0, 6);
mkdirSync(dirname(job.out), {recursive: true});
execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', `color=c=0x${colour}:s=1080x1920`, '-frames:v', '1', job.out]);
send({event: 'result', data: {out: job.out, bytes: statSync(job.out).size, width: 1080, height: 1920, frame: job.frame, frames: 600, fps: 30, bundleMs: 1, totalMs: 1}});
