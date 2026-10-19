// Phase 6 demonstration on the persistent demo workspace, through the real app in a real (headless) browser, with the REAL voice model:
// a separate new draft with two narration blocks is generated, re-rolled, auditioned (the files load and have the length recorded),
// selected, split and joined again (the take that was kept is reused, nothing regenerated), and a listening sample is made. Estimates
// are recorded before each run and compared with what the run took. Nothing is judged here: the script measures, the author listens.
// The app must already be running (./studio-app). Heavy work runs one job at a time inside the app; this script only clicks.
//   node scripts/phase6_demo_ui.ts
import {execFileSync} from 'node:child_process';
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {ROOT, DEMO_PROJECT} from '../app/demo.ts';
import {Chrome, type Tab} from '../tests/app/harness.ts';
import type {VoiceView} from '../app/shared/voice.ts';

const PORT = 4317;
const token = readFileSync(join(DEMO_PROJECT, '.studio', 'app-token'), 'utf8').trim();
const base = `http://127.0.0.1:${PORT}`;
const OUT = resolve(ROOT, 'docs/studio/phase6-evidence');
const AUDIO = resolve(ROOT, 'out/phase6/voice-demo');
mkdirSync(OUT, {recursive: true});
mkdirSync(AUDIO, {recursive: true});
const log = (...a: unknown[]) => console.log(new Date().toISOString().slice(11, 19), ...a);

const api = async (method: string, path: string, body?: unknown) => {
  const res = await fetch(`${base}${path}`, {method, headers: {cookie: `studio_token=${token}`, 'x-studio': '1', 'content-type': 'application/json', connection: 'close'}, body: body === undefined ? undefined : JSON.stringify(body)});
  return {status: res.status, json: (await res.json().catch(() => null)) as any, res};
};
const voice = async (id: string) => (await api('GET', `/api/episodes/${id}/voice`)).json as VoiceView;
const sel = (id: string) => `[data-testid="${id}"]`;

const SENTENCES = [
  'A prompt is just the message you send to a model.',
  'It can be a question, an instruction, or a few examples.',
  'The model reads your prompt one small piece at a time.',
  'Then it writes its answer, one piece after another.',
  'A clear prompt gives the model less to guess.',
  'If you say who the answer is for, it can pick better words.',
  'If you show one example, it can copy the shape.',
];
const TITLE = 'Voice demo: prompts';

const library = (await api('GET', '/api/library')).json;
if (library.items.some((i: any) => i.title === TITLE)) throw new Error(`the demo workspace already has "${TITLE}"; nothing was changed`);
const baselineBefore = (await api('GET', '/api/episodes/context-window')).json;
const othersBefore = Object.fromEntries(await Promise.all(['what-is-a-token', 'tokens-in-pieces'].map(async (e) => [e, (await api('GET', `/api/episodes/${e}`)).json.docHash])));
const jobsBefore = (await api('GET', '/api/jobs')).json.jobs.filter((j: any) => ['queued', 'preparing', 'running', 'cancelling'].includes(j.state));
if (jobsBefore.length) throw new Error(`work is already in progress (${jobsBefore.length} jobs); not starting`);

// ---- the draft: made through the app's own routes (brief, script import, accept) ----------------------------------------------
const made = (await api('POST', '/api/plans', {title: TITLE, audience: 'People who have just started using a chat model', objective: 'Know what a prompt is and that small changes to it change the answer'})).json;
const id = made.plan.id as string;
const imp = (await api('POST', `/api/plans/${id}/imports`, {text: SENTENCES.join(' '), via: 'paste'})).json;
const acc = await api('POST', `/api/plans/${id}/imports/${imp.import.id}/accept`, {selection: {sources: [], claims: [], script: imp.import.proposal.script, storyboard: false, confirmReplace: false}, basePlanSeq: imp.planSeq, baseEpisodeSeq: null});
if (acc.status !== 200) throw new Error(`accepting the script failed: ${JSON.stringify(acc.json)}`);
log('draft', id);

type Sample = {t: number; activity: string; loaded: string | null; worker: string; rssMB: number | null; jobs: string[]};
const samples: Sample[] = [];
const violations: string[] = [];
let sampling = true;
const sampler = (async () => {
  while (sampling) {
    try {
      const v = await voice(id);
      const e = v.engine;
      samples.push({t: Date.now(), activity: e.activity, loaded: e.loaded, worker: e.worker, rssMB: e.rssBytes === null ? null : Math.round(e.rssBytes / 2 ** 20), jobs: v.jobs.filter((j) => ['preparing', 'running', 'cancelling'].includes(j.state)).map((j) => `${j.subject}:${j.state}:${j.displayStep}`)});
      for (const j of v.jobs) {
        if (j.state === 'running' && j.displayStep === 'generating speech' && !(e.loaded === 'tts' && e.worker === 'running')) violations.push(`job ${j.id} shows generating speech while the engine does not hold the voice model`);
      }
      if (e.activity === 'generating' && !v.jobs.some((j) => j.state === 'running' && j.displayStep === 'generating speech')) violations.push('the engine says generating but no job is');
      if (e.loaded && e.worker !== 'running') violations.push(`model ${e.loaded} loaded without a worker`);
      if (v.jobs.filter((j) => ['preparing', 'running'].includes(j.state)).length > 1) violations.push('more than one heavy job at once');
    } catch { /* the app is busy answering; the next reading follows */ }
    await new Promise((r) => setTimeout(r, 700));
  }
})();

const chrome = await Chrome.launch();
const run: Record<string, unknown> = {startedAt: new Date().toISOString(), draft: id, title: TITLE, script: SENTENCES};
const comparisons: any[] = [];
try {
  const t: Tab = await chrome.tab();
  await t.viewport(1280, 900, 1);
  await t.goto(`${base}/?token=${token}`);
  await t.waitFor('document.querySelector(".ttl")', 30000, 'the app');
  await t.goto(`${base}/?voice=${id}`);
  await t.waitFor(`document.querySelector('[data-testid=voice-screen]')`, 30000, 'the voice screen');
  const shot = async (name: string) => t.screenshot(join(OUT, `demo-${name}.png`));
  await shot('1-before');
  const v0 = await voice(id);
  run.blocksBefore = v0.blocks.map((b) => ({id: b.id, segments: b.segments.map((s) => s.id), words: b.words, status: b.status, estimate: b.estimate}));
  run.engineBefore = v0.engine;
  log('blocks', JSON.stringify(run.blocksBefore));

  const done = (what: string, ms = 20 * 60_000) => t.waitFor(`document.querySelector('[data-testid=voice-screen]').dataset.busy === 'no'`, ms, what);
  /** Predict from the page's own view, run it by clicking, and compare the job's real elapsed time. */
  async function measured(label: string, click: string, blockId: string) {
    const before = await voice(id);
    const b = before.blocks.find((x) => x.id === blockId)!;
    const loadSec = before.loadEstimate?.sec ?? null;
    const est = b.estimate;
    const jobsN = before.jobs.length;
    log(label, 'estimate', JSON.stringify(est), 'load', JSON.stringify(before.loadEstimate), 'engine', before.engine.activity);
    await t.click(click);
    await t.waitFor(`document.querySelector('[data-testid=voice-screen]').dataset.busy === 'yes'`, 30000, 'work to start');
    await done(label);
    const after = await voice(id);
    const job = after.jobs.find((j) => j.subject === blockId && j.id > Math.max(0, ...before.jobs.map((x) => x.id)))!;
    const actual = job.elapsedMs! / 1000;
    const predicted = est.measured ? {min: est.minSec + (loadSec ?? 0), max: est.maxSec + (loadSec ?? 0)} : null;
    const row = {label, block: blockId, words: b.words, estimate: est, loadEstimate: before.loadEstimate, predictedSec: predicted, actualSec: actual, jobsBefore: jobsN, state: job.state, withinThirtyPercent: predicted ? actual >= predicted.min * 0.7 && actual <= predicted.max * 1.3 : null, ratioToMidpoint: predicted ? Math.round((actual / ((predicted.min + predicted.max) / 2)) * 100) / 100 : null};
    comparisons.push(row);
    log(label, 'actual', actual, 'predicted', JSON.stringify(predicted), 'ok', row.withinThirtyPercent);
    return row;
  }

  // ---- 1. the first block: nothing measured, so no estimate is claimed
  await measured('b1 first take', sel('block-b1-generate'), 'b1');
  await shot('2-b1-narrated');
  // ---- 2. the second block, 23 words: estimated from the one take that exists
  await measured('b2 first take', sel('block-b2-generate'), 'b2');
  await shot('3-b2-narrated');
  // ---- 3. re-roll b1 (the engine may have been released meanwhile)
  await measured('b1 re-roll', sel('block-b1-reroll'), 'b1');
  await t.waitFor(`document.querySelector('[data-testid=take-b1-2]')`, 10000, 'the second take');
  const v1 = await voice(id);
  run.afterReroll = v1.blocks[0].takes.map((x) => ({number: x.number, seed: x.seed, selected: x.selected, durationSec: x.durationSec, genSec: x.genSec}));
  // ---- 4. audition: the audio of every take loads in the page and has the length recorded
  const audition: any[] = [];
  for (const b of v1.blocks) for (const k of b.takes) {
    const r = await t.eval<{ok: boolean; duration: number}>(`new Promise((res) => { const a = new Audio(${JSON.stringify(k.url)}); a.preload = 'metadata'; a.onloadedmetadata = () => res({ok: true, duration: a.duration}); a.onerror = () => res({ok: false, duration: 0}); setTimeout(() => res({ok: false, duration: -1}), 15000); })`);
    audition.push({block: b.id, take: k.number, seed: k.seed, recordedSec: k.durationSec, pageSec: Math.round(r.duration * 1000) / 1000, loads: r.ok});
  }
  run.audition = audition;
  // ---- 5. choose the new take of b1
  await t.click(sel('take-b1-2-use'));
  await t.waitFor(`document.querySelector('[data-testid=take-b1-2]')?.dataset.selected === 'yes'`, 20000, 'take 2 selected');
  await shot('4-reroll-selected');
  // ---- 6. split b1 after s3: new wording for two blocks
  await t.click(sel('split-b1-s3'));
  await t.waitFor(`document.querySelector('[data-testid=edit-preview]')`, 15000, 'the preview');
  run.splitPreview = await t.eval<string>(`document.querySelector('[data-testid=edit-lines]').innerText`);
  await shot('5-split-preview');
  await t.click(sel('edit-apply'));
  await t.waitFor(`document.querySelectorAll('[data-testid^=block-][data-status]').length === 3`, 20000, 'three blocks');
  run.afterSplit = (await voice(id)).blocks.map((b) => ({id: b.id, segments: b.segments.map((s) => s.id), status: b.status, takes: b.takes.length}));
  await measured('b1 (s1 to s3) after the split', sel('block-b1-generate'), 'b1');
  await measured('b3 (s4 and s5) after the split', sel('block-b3-generate'), 'b3');
  await shot('6-split-narrated');
  // ---- 7. join them again: the takes that were kept are offered, and using one generates nothing
  const jobsBeforeJoin = (await api('GET', `/api/jobs?episode=${id}`)).json.jobs.length;
  await t.click(sel('merge-b1'));
  await t.waitFor(`document.querySelector('[data-testid=edit-preview]')`, 15000, 'the join preview');
  run.joinPreview = await t.eval<string>(`document.querySelector('[data-testid=edit-lines]').innerText`);
  await t.click(sel('edit-apply'));
  await t.waitFor(`document.querySelectorAll('[data-testid^=block-][data-status]').length === 2`, 20000, 'two blocks again');
  await shot('7-joined');
  await t.click(sel('block-b1-generate'));
  await t.waitFor(`document.querySelector('[data-testid=block-b1]')?.dataset.status === 'fresh'`, 30000, 'b1 up to date by reuse');
  const jobsAfterJoin = (await api('GET', `/api/jobs?episode=${id}`)).json.jobs.length;
  run.reuse = {jobsBefore: jobsBeforeJoin, jobsAfter: jobsAfterJoin, nothingGenerated: jobsBeforeJoin === jobsAfterJoin, note: await t.eval<string>(`document.querySelector('[data-testid=voice-note]')?.innerText ?? ''`)};
  // ---- 8. the listening sample
  await t.waitFor(`!document.querySelector('[data-testid=sample-make]').disabled`, 30000, 'the sample to be offered');
  const sampleStart = Date.now();
  await t.click(sel('sample-make'));
  await t.waitFor(`document.querySelector('[data-testid=sample-panel]').dataset.fresh === 'yes' && document.querySelector('[data-testid=sample-audio]')`, 10 * 60_000, 'the sample');
  run.sampleSeconds = (Date.now() - sampleStart) / 1000;
  await shot('8-sample');
  const final = await voice(id);
  run.final = {blocks: final.blocks.map((b) => ({id: b.id, segments: b.segments.map((s) => s.id), status: b.status, durationSec: b.durationSec, takes: b.takes.map((k) => ({number: k.number, seed: k.seed, selected: k.selected, compatible: k.compatible, durationSec: k.durationSec}))})), sample: {fresh: final.sample.fresh, durationSec: final.sample.durationSec, url: final.sample.url}, downstream: final.downstream};

  // ---- 9. the files, to listen to; with what tools measure about them (loudness, peaks, silences), not a judgement
  const measures: any[] = [];
  const save = async (url: string, name: string) => {
    const r = await fetch(`${base}${url}`, {headers: {cookie: `studio_token=${token}`}});
    const file = join(AUDIO, name);
    writeFileSync(file, Buffer.from(await r.arrayBuffer()));
    let loud: any = null;
    try {
      const out = execFileSync('ffmpeg', ['-hide_banner', '-nostats', '-i', file, '-af', 'ebur128=peak=true,silencedetect=n=-45dB:d=0.25', '-f', 'null', '-'], {encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']}).toString();
      loud = out;
    } catch (e) { loud = String((e as {stderr?: string}).stderr ?? e); }
    const txt = String(loud);
    const I = /I:\s+(-?[\d.]+) LUFS/.exec(txt.split('Summary:')[1] ?? '')?.[1];
    const peak = /Peak:\s+(-?[\d.]+) dBFS/.exec(txt.split('Summary:')[1] ?? '')?.[1];
    const silences = [...txt.matchAll(/silence_start: ([\d.]+)[\s\S]*?silence_end: ([\d.]+) \| silence_duration: ([\d.]+)/g)].map((m) => ({start: Number(m[1]), end: Number(m[2]), dur: Number(m[3])}));
    measures.push({file: name, integratedLufs: I ? Number(I) : null, truePeakDbfs: peak ? Number(peak) : null, silencesOver250ms: silences});
  };
  for (const b of final.blocks) for (const k of b.takes) await save(k.url, `${b.id}-take${k.number}-seed${k.seed}${k.selected ? '-SELECTED' : ''}${k.compatible ? '' : '-earlier-wording'}.wav`);
  if (final.sample.url) await save(final.sample.url, 'listening-sample-selected-takes.wav');
  run.files = measures;

  // ---- 10. the engine releases itself when idle
  await new Promise((r) => setTimeout(r, 12_000));
  const idle = await voice(id);
  run.engineAfterIdle = {worker: idle.engine.worker, loaded: idle.engine.loaded, activity: idle.engine.activity, summary: idle.engine.summary};
  run.consoleErrors = t.consoleErrors;
  run.failedRequests = t.failedRequests;
} finally {
  sampling = false;
  await sampler;
  await chrome.close();
}

const baselineAfter = (await api('GET', '/api/episodes/context-window')).json;
const othersAfter = Object.fromEntries(await Promise.all(['what-is-a-token', 'tokens-in-pieces'].map(async (e) => [e, (await api('GET', `/api/episodes/${e}`)).json.docHash])));
const jobsAll = (await api('GET', `/api/jobs?episode=${id}`)).json.jobs as any[];
const peakRss = Math.max(0, ...samples.map((s) => s.rssMB ?? 0));
const result = {
  ...run, finishedAt: new Date().toISOString(),
  jobs: jobsAll.map((j) => ({id: j.id, block: j.subject, kind: j.kind, state: j.state, seed: j.seed, revision: j.revision, elapsedSec: j.elapsedMs === null ? null : j.elapsedMs / 1000, cacheHit: j.cacheHit, attempts: j.attempts})),
  estimateComparisons: comparisons,
  engineReadings: {count: samples.length, activities: [...new Set(samples.map((s) => s.activity))], peakWorkerRssMB: peakRss, contradictions: violations},
  baseline: {seqBefore: baselineBefore.seq, seqAfter: baselineAfter.seq, hashBefore: baselineBefore.docHash, hashAfter: baselineAfter.docHash, unchanged: baselineBefore.docHash === baselineAfter.docHash && baselineBefore.seq === baselineAfter.seq},
  otherDemoEpisodesUnchanged: JSON.stringify(othersBefore) === JSON.stringify(othersAfter),
};
writeFileSync(join(OUT, 'demo-run.json'), JSON.stringify(result, null, 2) + '\n');
log('done', JSON.stringify({jobs: result.jobs.length, comparisons: comparisons.map((c) => [c.label, c.actualSec, c.withinThirtyPercent]), contradictions: violations.length, baselineUnchanged: result.baseline.unchanged}));
