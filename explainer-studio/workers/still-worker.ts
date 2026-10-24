// Still worker: bundles the project with an ISOLATED public directory and renders ONE frame of one composition to a PNG, in the same
// browser engine that renders the video. Used for the cover image of a rendered video. Run by the job runner as an owned process;
// cancelling the job stops this process and its browser children.
//
//   node workers/still-worker.ts <job.json>
//   job.json: {entry, publicDir, bundleDir, out, composition, inputProps, frame}
//   events:   {event:"progress", step}   {event:"result", data:{out, bytes, width, height, frame, bundleMs, totalMs}}   {event:"error", message}
import {readFileSync, statSync} from 'node:fs';
import {bundle} from '@remotion/bundler';
import {renderStill, selectComposition} from '@remotion/renderer';

const send = (o: unknown) => process.stdout.write(JSON.stringify(o) + '\n');

type Job = {entry: string; publicDir: string; bundleDir: string; out: string; composition: string; inputProps: Record<string, unknown>; frame: number};

async function main() {
  const job = JSON.parse(readFileSync(process.argv[2], 'utf8')) as Job;
  const t0 = Date.now();
  send({event: 'progress', step: 'bundling'});
  const serveUrl = await bundle({entryPoint: job.entry, publicDir: job.publicDir, outDir: job.bundleDir});
  const bundledMs = Date.now() - t0;
  send({event: 'progress', step: 'preparing the composition'});
  const composition = await selectComposition({serveUrl, id: job.composition, inputProps: job.inputProps});
  if (job.frame < 0 || job.frame >= composition.durationInFrames) throw new Error(`frame ${job.frame} is outside the video (${composition.durationInFrames} frames)`);
  send({event: 'progress', step: 'drawing the cover frame'});
  await renderStill({composition, serveUrl, frame: job.frame, output: job.out, inputProps: job.inputProps, imageFormat: 'png', overwrite: true});
  send({event: 'result', data: {out: job.out, bytes: statSync(job.out).size, width: composition.width, height: composition.height, frame: job.frame, frames: composition.durationInFrames, fps: composition.fps, bundleMs: bundledMs, totalMs: Date.now() - t0}});
}

main().then(() => process.exit(0), (e) => { send({event: 'error', message: (e as Error).message}); process.exit(1); });
