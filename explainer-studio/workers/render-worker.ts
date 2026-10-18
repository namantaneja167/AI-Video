// Render worker: bundles the project with an ISOLATED public directory and renders one composition to one file.
// Run by the job runner as an owned process; it prints JSON lines on stdout. Cancelling the job stops this process
// and its browser children, so the worker needs no cleanup of its own.
//
//   node workers/render-worker.ts <job.json>
//   job.json: {entry, publicDir, bundleDir, out, composition, inputProps, crf, concurrency, fps}
//   events:   {event:"progress", step, fraction?, ...}   {event:"result", data:{...}}   {event:"error", message}
import {readFileSync, statSync} from 'node:fs';
import {bundle} from '@remotion/bundler';
import {renderMedia, selectComposition} from '@remotion/renderer';

const send = (o: unknown) => process.stdout.write(JSON.stringify(o) + '\n');

type Job = {entry: string; publicDir: string; bundleDir: string; out: string; composition: string; inputProps: Record<string, unknown>; crf: number; concurrency: number; /** Smoke tests only: render just these frames. */ frameRange?: [number, number]};

async function main() {
  const job = JSON.parse(readFileSync(process.argv[2], 'utf8')) as Job;
  const t0 = Date.now();
  send({event: 'progress', step: 'bundling'});
  const serveUrl = await bundle({entryPoint: job.entry, publicDir: job.publicDir, outDir: job.bundleDir});
  const bundledMs = Date.now() - t0;
  send({event: 'progress', step: 'preparing the composition'});
  const composition = await selectComposition({serveUrl, id: job.composition, inputProps: job.inputProps});
  let last = -1;
  send({event: 'progress', step: 'rendering', fraction: 0, totalFrames: composition.durationInFrames});
  await renderMedia({
    composition, serveUrl, codec: 'h264', outputLocation: job.out, inputProps: job.inputProps, crf: job.crf, concurrency: job.concurrency, overwrite: true, imageFormat: 'jpeg', ...(job.frameRange ? {frameRange: job.frameRange} : {}),
    onProgress: ({renderedFrames, encodedFrames, progress}) => {
      const pct = Math.floor(progress * 100);
      if (pct === last) return;
      last = pct;
      // `progress` is Remotion's own measure: frames rendered and encoded over the known frame count.
      send({event: 'progress', step: encodedFrames < composition.durationInFrames ? 'rendering' : 'finishing', fraction: Math.min(1, Math.max(0, progress)), renderedFrames, encodedFrames, totalFrames: composition.durationInFrames});
    },
  });
  send({event: 'result', data: {out: job.out, bytes: statSync(job.out).size, frames: composition.durationInFrames, fps: composition.fps, width: composition.width, height: composition.height, bundleMs: bundledMs, totalMs: Date.now() - t0}});
}

main().then(() => process.exit(0), (e) => { send({event: 'error', message: (e as Error).message}); process.exit(1); });
