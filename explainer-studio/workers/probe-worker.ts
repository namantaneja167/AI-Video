// Probe worker: bundles the project with an ISOLATED public directory and renders chosen frames of one composition in the same browser
// engine that renders the video. The composition, given probe input, prints one line per frame (STUDIO_PROBE ...) with what it measured;
// this worker collects those lines. Run by the job runner as an owned process; cancelling the job stops it and its browser children.
//
//   node workers/probe-worker.ts <job.json>
//   job.json: {entry, publicDir, bundleDir, out, composition, inputProps, frames: number[]}
//   events:   {event:"progress", step, fraction?}   {event:"result", data:{out, samples, frames, bundleMs, totalMs}}   {event:"error", message}
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {bundle} from '@remotion/bundler';
import {openBrowser, renderStill, selectComposition} from '@remotion/renderer';

const send = (o: unknown) => process.stdout.write(JSON.stringify(o) + '\n');
const PROBE_LOG = 'STUDIO_PROBE';

type Job = {entry: string; publicDir: string; bundleDir: string; out: string; composition: string; inputProps: Record<string, unknown>; frames: number[]};

async function main() {
  const job = JSON.parse(readFileSync(process.argv[2], 'utf8')) as Job;
  const t0 = Date.now();
  send({event: 'progress', step: 'bundling'});
  const serveUrl = await bundle({entryPoint: job.entry, publicDir: job.publicDir, outDir: job.bundleDir});
  const bundledMs = Date.now() - t0;
  send({event: 'progress', step: 'opening the browser'});
  const browser = await openBrowser('chrome', {});
  const samples: unknown[] = [];
  let current = -1;
  const problems: string[] = [];
  try {
    const composition = await selectComposition({serveUrl, id: job.composition, inputProps: job.inputProps, puppeteerInstance: browser});
    const tmp = join(dirname(job.out), 'probe-frames');
    mkdirSync(tmp, {recursive: true});
    for (const [i, frame] of job.frames.entries()) {
      current = frame;
      send({event: 'progress', step: 'measuring frames', fraction: i / job.frames.length, frame});
      let got = false;
      await renderStill({
        composition, serveUrl, frame, output: join(tmp, `f${frame}.jpg`), inputProps: job.inputProps, imageFormat: 'jpeg', overwrite: true, puppeteerInstance: browser,
        onBrowserLog: (l) => {
          if (!l.text.startsWith(`${PROBE_LOG} `)) return;
          try { samples.push(JSON.parse(l.text.slice(PROBE_LOG.length + 1))); got = true; } catch { problems.push(`frame ${frame}: unreadable probe line`); }
        },
      });
      if (!got) problems.push(`frame ${frame}: the composition printed no probe line`);
    }
  } finally {
    await browser.close({silent: true}).catch(() => undefined);
  }
  writeFileSync(job.out, JSON.stringify({samples, problems}));
  send({event: 'result', data: {out: job.out, samples: samples.length, frames: job.frames.length, problems: problems.length, bundleMs: bundledMs, totalMs: Date.now() - t0, lastFrame: current}});
}

main().then(() => process.exit(0), (e) => { send({event: 'error', message: (e as Error).message}); process.exit(1); });
