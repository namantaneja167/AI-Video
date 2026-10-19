// Fake probe worker: same job.json and JSON-lines events as workers/probe-worker.ts, no browser. It writes probe samples of the shape the
// composition produces. FAKE_PROBE_MODE: good (default), overflow (a card's text runs past its box), overlap (two cards overlap),
// fallback-font (text fell back to another font), crash (exits without a result). FAKE_PROBE_SPEC_COPY copies the job spec for a test to read.
import {copyFileSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {dirname} from 'node:path';

const job = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const send = (o: unknown) => process.stdout.write(JSON.stringify(o) + '\n');
const mode = process.env.FAKE_PROBE_MODE ?? 'good';
if (process.env.FAKE_PROBE_SPEC_COPY) copyFileSync(process.argv[2], process.env.FAKE_PROBE_SPEC_COPY);
send({event: 'progress', step: 'bundling'});
if (mode === 'crash') { process.stderr.write('probe worker crashed\n'); process.exit(3); }
const scenes: {id: string; start: number; end: number}[] = job.inputProps.data.timeline.scenes;
const samples = job.frames.map((frame: number, i: number) => {
  send({event: 'progress', step: 'measuring frames', fraction: i / job.frames.length, frame});
  const t = frame / 30;
  const scene = (scenes.find((s) => t >= s.start && t < s.end) ?? scenes[scenes.length - 1]).id;
  const card = (n: number, y: number, clipped = false) => [
    {id: `card${n}`, kind: 'box', essential: true, rect: {x: 60, y, w: 960, h: 240}, opacity: 1},
    {id: `card${n}-heading`, kind: 'text', essential: true, parent: `card${n}`, rect: {x: 86, y: y + 26, w: 600, h: 60}, opacity: 1, fontPx: 48, stack: '"Inter", sans-serif', text: 'Heading', clipped: {x: false, y: clipped}},
  ];
  const elements = mode === 'overflow' ? card(1, 200, true) : mode === 'overlap' ? [...card(1, 200), ...card(2, 300)] : [...card(1, 200), ...card(2, 460)];
  return {frame, t, scene, elements, fonts: [{stack: '"Inter", sans-serif', first: 'Inter', resolved: mode === 'fallback-font' ? 'Helvetica' : 'Inter'}], faces: [{family: 'Inter', weight: '400', status: 'loaded'}]};
});
mkdirSync(dirname(job.out), {recursive: true});
writeFileSync(job.out, JSON.stringify({samples, problems: []}));
send({event: 'result', data: {out: job.out, samples: samples.length, frames: job.frames.length, problems: 0, bundleMs: 1, totalMs: 1, lastFrame: job.frames.at(-1) ?? -1}});
