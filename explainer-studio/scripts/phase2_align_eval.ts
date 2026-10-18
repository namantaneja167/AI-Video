// Phase 2 alignment evaluation, driver. Loads ONLY the forced aligner (through the same model host the product uses),
// aligns the two real Pip takes, measures memory at every stage, unloads with confirmation, and also records the
// labelled estimate for comparison. Analysis against the audio happens in scripts/phase2_align_report.py.
//   node scripts/phase2_align_eval.ts <outDir>
import {mkdirSync, writeFileSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {OwnerRegistry, systemMemory} from '../core/proc.ts';
import {ModelHost} from '../core/worker.ts';
import {DatabaseSync} from 'node:sqlite';
import {MIGRATIONS} from '../core/db.ts';

const root = resolve(import.meta.dirname, '..');
const out = resolve(process.argv[2] ?? join(root, 'out', 'phase2', 'align-eval'));
mkdirSync(out, {recursive: true});

const SEGS = [
  {id: 's1', text: 'Ten times faster.'}, {id: 's2', text: 'Sounds impressive.'}, {id: 's3', text: 'But faster at what?'}, {id: 's4', text: 'This test used tiny prompts.'},
  {id: 's5', text: 'A long document is a different workload.'}, {id: 's6a', text: 'Before trusting the headline,'}, {id: 's6b', text: 'check what was measured.'},
];
const TAKES = {seed11: join(root, 'audio/pip-scene-10x/takes/narration_seed11.wav'), seed7: join(root, 'audio/pip-scene-10x/takes/narration_seed7.wav')};

const db = new DatabaseSync(':memory:');
for (const m of MIGRATIONS) db.exec(m);
const reg = new OwnerRegistry(db, Date.now);
const host = new ModelHost(reg, {cmd: join(root, '.venv-qwen/bin/python'), args: [join(root, 'workers/audio_worker.py')], cwd: root});

const samples: {t: number; stage: string; rssMb: number | null; pressure: number; swapMb: number | null}[] = [];
let stage = 'start';
let critical = 0;
const t0 = Date.now();
const timer = setInterval(() => {
  const m = systemMemory();
  const rss = host.worker?.rssBytes() ?? null;
  samples.push({t: Date.now() - t0, stage, rssMb: rss === null ? null : Math.round(rss / 2 ** 20), pressure: m.pressure, swapMb: m.swapUsedMb});
  critical = m.pressure >= 4 ? critical + 1 : 0;
  if (critical >= 5) { console.error('memory guard: critical pressure for 5 samples, stopping the worker'); void host.worker?.terminate(); }
}, 1000);

const result: any = {startedAt: new Date().toISOString(), takes: {}};
try {
  stage = 'worker-started';
  host.ensureWorker();
  await new Promise((r) => setTimeout(r, 1500));
  result.rssWorkerIdleMb = Math.round((host.worker!.rssBytes() ?? 0) / 2 ** 20);
  stage = 'load-aligner';
  result.load = await host.worker!.request('load', {model: 'aligner'}, {timeoutMs: 300_000});
  host['loaded'] = 'aligner';
  result.rssAfterLoadMb = Math.round((host.worker!.rssBytes() ?? 0) / 2 ** 20);
  for (const [name, wav] of Object.entries(TAKES)) {
    stage = `align-${name}`;
    const aligned = await host.worker!.request('align', {wav, segments: SEGS}, {timeoutMs: 300_000});
    const estimated = await host.worker!.request('estimate', {wav, segments: SEGS}, {timeoutMs: 60_000});
    result.takes[name] = {wav, aligned, estimated};
    result[`rssAfterAlign_${name}_Mb`] = Math.round((host.worker!.rssBytes() ?? 0) / 2 ** 20);
  }
  stage = 'unload';
  result.handover = await host.unloadAndConfirm('alignment evaluation finished');
  stage = 'after-unload';
  await new Promise((r) => setTimeout(r, 1500));
  result.rssAfterHandoverMb = host.worker ? Math.round((host.worker.rssBytes() ?? 0) / 2 ** 20) : 0;
} finally {
  clearInterval(timer);
  await host.shutdown();
  result.samples = samples;
  result.peakRssMb = Math.max(0, ...samples.map((s) => s.rssMb ?? 0));
  result.maxPressure = Math.max(0, ...samples.map((s) => s.pressure));
  result.maxSwapMb = Math.max(0, ...samples.map((s) => s.swapMb ?? 0));
  writeFileSync(join(out, 'results.json'), JSON.stringify(result, null, 2));
}
console.log(JSON.stringify({peakRssMb: result.peakRssMb, maxPressure: result.maxPressure, load: result.load, handover: result.handover, rssAfterHandoverMb: result.rssAfterHandoverMb}, null, 1));
