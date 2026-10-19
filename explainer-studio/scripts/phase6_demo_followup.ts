// Follow-up to scripts/phase6_demo_ui.ts on the same draft: re-rolls two blocks through the page with the estimate shown BEFORE each run
// (the estimate now includes the measured fixed time per block and is shown for a re-roll), compares it with the real run, and measures
// every saved file with ffmpeg (integrated loudness, true peak, silences). Measured numbers only; nothing here judges how anything sounds.
//   node scripts/phase6_demo_followup.ts
import {spawnSync} from 'node:child_process';
import {mkdirSync, readFileSync, readdirSync, writeFileSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {ROOT, DEMO_PROJECT} from '../app/demo.ts';
import {Chrome} from '../tests/app/harness.ts';
import type {VoiceView} from '../app/shared/voice.ts';

const PORT = 4317;
const ID = 'voice-demo-prompts';
const token = readFileSync(join(DEMO_PROJECT, '.studio', 'app-token'), 'utf8').trim();
const base = `http://127.0.0.1:${PORT}`;
const OUT = resolve(ROOT, 'docs/studio/phase6-evidence');
const AUDIO = resolve(ROOT, 'out/phase6/voice-demo');
mkdirSync(AUDIO, {recursive: true});
const log = (...a: unknown[]) => console.log(new Date().toISOString().slice(11, 19), ...a);
const voice = async () => (await (await fetch(`${base}/api/episodes/${ID}/voice`, {headers: {cookie: `studio_token=${token}`}})).json()) as VoiceView;
const sel = (id: string) => `[data-testid="${id}"]`;

const chrome = await Chrome.launch();
const comparisons: any[] = [];
try {
  const t = await chrome.tab();
  await t.viewport(1280, 900, 1);
  await t.goto(`${base}/?token=${token}`);
  await t.waitFor('document.querySelector(".ttl")', 30000, 'the app');
  await t.goto(`${base}/?voice=${ID}`);
  await t.waitFor(`document.querySelector('[data-testid=voice-screen]')`, 30000, 'the voice screen');
  for (const [label, block] of [['b2 re-roll (23 words)', 'b2'], ['b1 re-roll (51 words)', 'b1']] as const) {
    await new Promise((r) => setTimeout(r, 11_000)); // let the idle engine release itself, so the second run also pays the model load as a real one does
    const before = await voice();
    const b = before.blocks.find((x) => x.id === block)!;
    const shown = await t.eval<string>(`document.querySelector('[data-testid=block-${block}-reroll-estimate]')?.innerText ?? ''`);
    const loadSec = before.loadEstimate?.sec ?? 0;
    const est = b.estimate;
    const lastId = Math.max(...before.jobs.map((j) => j.id));
    await t.click(sel(`block-${block}-reroll`));
    await t.waitFor(`document.querySelector('[data-testid=voice-screen]').dataset.busy === 'yes'`, 30000, 'work to start');
    await t.waitFor(`document.querySelector('[data-testid=voice-screen]').dataset.busy === 'no'`, 10 * 60_000, 'the re-roll');
    const after = await voice();
    const job = after.jobs.find((j) => j.subject === block && j.id > lastId)!;
    const actual = job.elapsedMs! / 1000;
    const pred = est.measured ? {min: est.minSec + loadSec, max: est.maxSec + loadSec} : null;
    const row = {label, words: b.words, estimateShownInPage: shown, estimate: est, modelLoadEstimateAddedSec: loadSec, engineLoadedBefore: before.engine.loaded, predictedSec: pred, actualSec: actual, withinThirtyPercent: pred ? actual >= pred.min * 0.7 && actual <= pred.max * 1.3 : null, ratioToMidpoint: pred ? Math.round((actual / ((pred.min + pred.max) / 2)) * 100) / 100 : null, seed: job.seed};
    comparisons.push(row);
    log(label, JSON.stringify(row));
  }
  await t.screenshot(join(OUT, 'demo-9-after-rerolls.png'));
} finally { await chrome.close(); }

// every saved take and the sample, as files, with what ffmpeg measures about them
const fin = await voice();
const files: {name: string; url: string}[] = [];
for (const b of fin.blocks) for (const k of b.takes) files.push({name: `${b.id}-take${k.number}-seed${k.seed}${k.selected ? '-SELECTED' : ''}${k.compatible ? '' : '-earlier-wording'}.wav`, url: k.url});
if (fin.sample.url) files.push({name: 'listening-sample-selected-takes.wav', url: fin.sample.url});
const measures: any[] = [];
for (const f of files) {
  const r = await fetch(`${base}${f.url}`, {headers: {cookie: `studio_token=${token}`}});
  writeFileSync(join(AUDIO, f.name), Buffer.from(await r.arrayBuffer()));
  const p = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', join(AUDIO, f.name), '-af', 'ebur128=peak=true,silencedetect=n=-45dB:d=0.25', '-f', 'null', '-'], {encoding: 'utf8'});
  const err = p.stderr;
  const summary = err.split('Summary:')[1] ?? '';
  const I = /I:\s+(-?[\d.]+) LUFS/.exec(summary)?.[1];
  const peak = /Peak:\s+(-?[\d.]+) dBFS/.exec(summary)?.[1];
  const dur = /Duration: (\d+):(\d+):([\d.]+)/.exec(err);
  const silences: {start: number; end: number; dur: number}[] = [];
  let cur: number | null = null;
  for (const m of err.matchAll(/silence_(start|end): (-?[\d.]+)(?: \| silence_duration: ([\d.]+))?/g)) {
    if (m[1] === 'start') cur = Number(m[2]); else if (cur !== null) { silences.push({start: cur, end: Number(m[2]), dur: Number(m[3])}); cur = null; }
  }
  measures.push({file: f.name, durationSec: dur ? Number(dur[1]) * 3600 + Number(dur[2]) * 60 + Number(dur[3]) : null, integratedLufs: I ? Number(I) : null, truePeakDbfs: peak ? Number(peak) : null, silencesOver250ms: silences.map((s) => ({start: Math.round(s.start * 100) / 100, end: Math.round(s.end * 100) / 100, dur: Math.round(s.dur * 100) / 100}))});
}
writeFileSync(join(OUT, 'demo-followup.json'), JSON.stringify({ranAt: new Date().toISOString(), draft: ID, estimateComparisons: comparisons, files: measures, audioDir: 'out/phase6/voice-demo', filesOnDisk: readdirSync(AUDIO)}, null, 2) + '\n');
log('done', JSON.stringify(comparisons.map((c) => [c.label, c.actualSec, c.predictedSec, c.withinThirtyPercent])));
