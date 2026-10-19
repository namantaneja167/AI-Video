// Phase 8 core-workflow journey on a NEW project (not the seeded demo), through the real page with the real tools:
// create, research, script import and review, storyboard, apply scenes, voice (real narration: this episode has no saved takes), draft video,
// a review round with one clearly labelled test note, final video, production checks on both.
// It opens no round on the final, plays nothing, ticks nothing, approves nothing and exports nothing: the final is left awaiting you.
//   node scripts/phase8_journey_ui.ts <projectDir> <port>      (the app must be running on that project: ./studio-app open <projectDir>)
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {Chrome, type Tab} from '../tests/app/harness.ts';
import {createEpisodeThroughUi, paste} from '../tests/app/planner-scenario.ts';
import type {Content} from '../tests/app/planner-scenario.ts';
import {ROOT} from '../app/workspace.ts';

const dir = resolve(process.argv[2] ?? '');
const port = Number(process.argv[3] ?? 4318);
if (!process.argv[2]) throw new Error('usage: node scripts/phase8_journey_ui.ts <projectDir> <port>');
const token = readFileSync(join(dir, '.studio', 'app-token'), 'utf8').trim();
const base = `http://127.0.0.1:${port}`;
const OUT = resolve(ROOT, 'docs/studio/phase8-evidence/journey');
const FILES = resolve(ROOT, 'out/phase8/journey');
mkdirSync(OUT, {recursive: true});
mkdirSync(FILES, {recursive: true});
const log = (...a: unknown[]) => console.log(new Date().toISOString().slice(11, 19), ...a);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const call = async (method: string, path: string, body?: unknown) => {
  const res = await fetch(`${base}${path}`, {method, headers: {cookie: `studio_token=${token}`, 'x-studio': '1', 'content-type': 'application/json', connection: 'close'}, body: body === undefined ? undefined : JSON.stringify(body)});
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return {status: res.status, json, text};
};
const get = async (path: string) => (await call('GET', path)).json;
const sel = (id: string) => `[data-testid="${id}"]`;
const text = (t: Tab, q: string) => t.eval<string>(`document.querySelector(${JSON.stringify(q)})?.innerText ?? ''`);

const CONTENT: Content = {
  title: 'Why a model forgets the start of a long chat',
  audience: 'People who use chat assistants but have not looked inside one',
  objective: 'Know that a model only sees a limited window of text, so long chats lose their start',
  durationMin: '1',
  researchBroken: JSON.stringify({studioPacket: 1, sources: [{title: 'Author outline'}], claims: [{text: 'A model has a limit.', kind: 'rumor'}]}, null, 2),
  research: JSON.stringify({studioPacket: 1, sources: [{title: 'Author outline', note: 'My own notes; no external source'}], claims: [{text: 'A model can only use a limited amount of text at once, called its context window.', kind: 'fact', sources: [0], evidence: 'Author outline', caveat: 'The limit differs between models'}]}, null, 2),
  script: 'A model can only hold so much text at once. That limit is called its context window.\n\nWhen a chat grows past the limit, the oldest words fall out of view. The model cannot use what it can no longer see.\n\nSo in a long chat, repeat what matters.',
  adjust: {row: 2, text: 'When a chat grows past the limit, the oldest words fall out of view.'},
  storyboardReady: true,
  storyboard: JSON.stringify({studioPacket: 1, kind: 'storyboard', storyboard: {scenes: [
    {segments: [1, 2], sceneType: 'pip-cards', intention: 'A model holds a limited amount of text', mechanism: 'Two cards: the limit, and its name', pip: ['Pip points at each card as it appears'],
      params: {cards: [{heading: 'Only so much', body: 'A model keeps a limited amount of text in view.', at: {segment: 0, word: 'much'}}, {heading: 'The context window', body: 'That limit has a name.', at: {segment: 1, word: 'window'}}], actions: [{do: 'point', card: 0, at: {segment: 0, word: 'text'}}, {do: 'point', card: 1, at: {segment: 1, word: 'window'}}, {do: 'nod', at: {segment: 1, edge: 'end'}}]}},
    {segments: [3, 4], sceneType: 'pip-cards', intention: 'Old words fall out of view', mechanism: 'Three cards', pip: ['Pip looks at the first card, then hops'],
      params: {cards: [{heading: 'A long chat', body: 'The chat grows past the limit.', at: {segment: 0, word: 'grows'}}, {heading: 'Old words drop out', body: 'The oldest words are no longer in view.', at: {segment: 0, word: 'oldest'}}, {heading: 'Not seen, not used', body: 'The model cannot use what it cannot see.', at: {segment: 1, word: 'cannot'}}], actions: [{do: 'look', card: 0, at: {segment: 0, edge: 'start'}}, {do: 'hop', at: {segment: 1, word: 'longer'}}]}},
    {segments: [5], sceneType: 'pip-cards', intention: 'What to do about it', mechanism: 'One card', pip: [],
      params: {cards: [{heading: 'Repeat what matters', body: 'Say the important part again.', at: {segment: 0, word: 'repeat'}}], actions: [{do: 'look', card: 0, at: {segment: 0, word: 'matters'}}, {do: 'smile', at: {segment: 0, edge: 'end'}}]}},
  ]}}, null, 2),
};

const before = {baseline: null as any};
const run: Record<string, any> = {ranAt: new Date().toISOString(), project: '(a new project created with ./studio-app new)', steps: []};
const step = (name: string, secs: number, extra: Record<string, unknown> = {}) => { run.steps.push({name, wallSec: Math.round(secs * 10) / 10, ...extra}); log(`${name}: ${secs.toFixed(1)} s`, JSON.stringify(extra).slice(0, 200)); };
const timed = async <T>(name: string, fn: () => Promise<T>, extra?: (r: T) => Record<string, unknown>): Promise<T> => { const t0 = Date.now(); const r = await fn(); step(name, (Date.now() - t0) / 1000, extra?.(r)); return r; };

const chrome = await Chrome.launch();
const measures: Record<string, unknown> = {};
try {
  const t = await chrome.tab();
  await t.viewport(1280, 800, 1);
  const shot = (name: string) => t.screenshot(join(OUT, `${name}.png`));
  const nav = async (q: string) => { await t.goto(`${base}/?${q}`); await sleep(300); };
  await t.goto(`${base}/?token=${token}`);
  await t.waitFor('document.querySelector(".ttl")', 30000, 'the app');
  await shot('01-empty-project');
  run.emptyProject = await text(t, sel('episode-list'));

  // ---- create, research, script, storyboard, scenes (skipped when an earlier run of this script already made the episode)
  const existing = ((await get('/api/library')).items as any[]).find((i) => i.title === CONTENT.title);
  const ID: string = existing ? existing.id : (await (async () => {
    const seen = await timed('create + research + script + storyboard (UI only)', () => createEpisodeThroughUi(t, CONTENT, async (n) => { await shot(`02-${n}`); }));
    run.requestsOutsideThisApp = seen.external;
    run.invalidResearchError = seen.errorText.slice(0, 300);
    return seen.planId;
  })());
  run.episodeId = ID;
  if (existing) { run.resumed = 'the episode already existed; creation and scenes were not repeated'; log(run.resumed); }
  const planned = (await get(`/api/episodes/${ID}`)).doc.scenes.some((s: any) => s.type === 'pip-cards');
  if (!planned) {
    await timed('apply scenes', async () => {
      await nav(`plan=${ID}&tab=storyboard`);
      await t.waitFor(`document.querySelector('[data-testid=apply-preview]')`, 20000, 'apply');
      await t.click(sel('apply-preview'));
      await t.waitFor(`document.querySelector('[data-testid=apply-changes]')`, 20000, 'the preview');
      run.applyPreview = await t.eval<string[]>(`[...document.querySelectorAll('[data-testid=apply-changes] li')].map((e) => e.innerText.replace(/\\s+/g, ' ').trim())`);
      await shot('03-apply-preview');
      await t.click(sel('apply-go'));
      await t.waitFor(`document.querySelector('[data-testid=applied-chip]')`, 30000, 'applied');
    });
  }
  await nav(`plan=${ID}&tab=scenes`);
  await t.waitFor(`document.querySelector('[data-testid=typeface-card]')`, 20000, 'the scenes step');
  run.typeface = await text(t, sel('typeface-chip'));
  await shot('04-scenes');
  const ep0 = await get(`/api/episodes/${ID}`);
  run.styleOfNewEpisode = ep0.doc.style;
  run.scenes = ep0.doc.scenes.map((s: any) => ({id: s.id, type: s.type, segments: s.segments}));

  // ---- voice: real narration (nothing saved for this episode), sampled every 2 s for the engine
  await nav(`voice=${ID}`);
  await t.waitFor(`document.querySelector('[data-testid=voice-screen]')`, 30000, 'the voice screen');
  const v0 = await get(`/api/episodes/${ID}/voice`);
  run.voiceBefore = {blocks: v0.blocks.map((b: any) => ({id: b.id, words: b.words, status: b.status, estimate: b.estimate})), engine: v0.engine.activity, blockers: v0.blockers};
  await shot('05-voice-before');
  const samples: {at: number; activity: string; rssMB: number | null}[] = [];
  let sampling = true;
  const sampler = (async () => { while (sampling) { const v = await get(`/api/episodes/${ID}/voice`).catch(() => null); if (v) samples.push({at: Date.now(), activity: v.engine.activity, rssMB: v.engine.rssBytes ? Math.round(v.engine.rssBytes / 1e6) : null}); await sleep(2000); } })();
  if (v0.blocks.every((b: any) => b.status === 'fresh')) log('narration is already made; not generated again');
  else await timed('voice: generate all blocks (real Qwen3-TTS, includes model load)', async () => {
    await t.click(sel('generate-all'));
    await t.waitFor(`document.querySelector('[data-testid=voice-screen]').dataset.busy === 'yes'`, 30000, 'narration to start');
    await t.waitFor(`document.querySelector('[data-testid=voice-screen]').dataset.busy === 'no'`, 25 * 60_000, 'narration to finish');
  });
  sampling = false; await sampler;
  const v1 = await get(`/api/episodes/${ID}/voice`);
  run.voiceAfter = {blocks: v1.blocks.map((b: any) => ({id: b.id, status: b.status, takes: b.takes.length, selected: b.takes.filter((x: any) => x.selected).map((x: any) => x.number)})), jobs: v1.jobs.map((j: any) => ({kind: j.kind, subject: j.subject, state: j.state, elapsedSec: j.elapsedMs === null ? null : Math.round(j.elapsedMs / 100) / 10}))};
  run.engineSamples = {count: samples.length, activities: [...new Set(samples.map((s) => s.activity))], peakWorkerRssMB: Math.max(...samples.map((s) => s.rssMB ?? 0))};
  await shot('06-voice-after');
  if (!v1.blocks.every((b: any) => b.status === 'fresh')) throw new Error(`narration did not finish cleanly: ${JSON.stringify(run.voiceAfter)}`);

  // ---- review: draft, a round with a labelled test note, final, checks
  await nav(`review=${ID}`);
  await t.waitFor(`document.querySelector('[data-testid=review-screen]')`, 30000, 'the review screen');
  const view = () => get(`/api/episodes/${ID}/review`);
  const count = () => t.eval<number>(`document.querySelectorAll('li[data-testid^=video-]').length`);
  async function build(mode: 'draft' | 'final') {
    const plan = await get(`/api/episodes/${ID}/plan${mode === 'draft' ? '?mode=draft' : ''}`);
    if (plan.nothingToDo) { log(`the ${mode} video is already up to date; not rebuilt`); return; }
    const n = await count();
    await t.click(sel(mode === 'draft' ? 'make-draft' : 'make-final'));
    await t.waitFor(`document.querySelector('[data-testid=plan-dialog]')`, 15000, 'the plan');
    await t.waitFor(`(() => { const b = document.querySelector('[data-testid=plan-start]'); return !!b && !b.disabled; })()`, 60000, 'the plan to load');
    const rows = await t.eval<string[]>(`[...document.querySelectorAll('[data-testid=plan-table] tr[data-step]')].map((r) => r.dataset.step + ':' + r.dataset.action)`);
    await shot(`07-${mode}-plan`);
    const t0 = Date.now();
    await t.click(sel('plan-start'));
    await t.waitFor(`document.querySelectorAll('li[data-testid^=video-]').length > ${n} && document.querySelector('[data-testid=review-screen]')?.dataset.busy === 'no'`, 40 * 60_000, `the ${mode} build`);
    step(`${mode} video`, (Date.now() - t0) / 1000, {plan: rows});
  }
  async function checks(mode: 'draft' | 'final') {
    const row = (await view()).videos.find((x: any) => x.kind === mode && x.isCurrent);
    const id = row.renderArtifactId;
    await t.click(`li[data-testid=video-${id}] .rv-vbtn`);
    await t.waitFor(`document.querySelector('li[data-testid=video-${id}]')?.dataset.selected === 'yes'`, 15000);
    const t0 = Date.now();
    await t.click(sel('run-checks'));
    let v: any;
    for (const end = Date.now() + 15 * 60_000; Date.now() < end; await sleep(1000)) { v = await get(`/api/episodes/${ID}/review?render=${id}`); if (v.selected?.renderArtifactId === id && v.selected.checks.state === 'done' && v.report?.renderArtifactId === id) break; }
    await t.waitFor(`document.querySelector('[data-testid=checks-verdict]')`, 30000, 'the verdict');
    step(`${mode} checks`, (Date.now() - t0) / 1000, {summary: v.report.summary, passed: v.report.passed});
    measures[`${mode}Checks`] = {renderArtifactId: id, fileSha256: v.report.fileSha256, passed: v.report.passed, summary: v.report.summary, sampledFrames: v.report.sampled.frames, items: v.report.items.map((i: any) => ({id: i.id, kind: i.kind, status: i.status, detail: i.detail.slice(0, 400), lines: (i.lines ?? []).slice(0, 4)})), selected: {bytes: v.selected.bytes, durationSec: v.selected.durationSec, label: v.selected.label, url: v.selected.url}};
    await shot(`08-${mode}-checks`);
    return v;
  }
  await build('draft');
  const dv = await checks('draft');
  // a review round on the DRAFT and one note, clearly labelled as a test note and left open (made once: a rerun of this script keeps the first note)
  if ((await view()).notes.length > 0) log('the test note already exists; not added again');
  else {
    await t.click(sel('open-round'));
    await t.waitFor(`document.querySelector('[data-testid=review-note-add]')`, 15000, 'the note button');
    await t.click(sel('review-note-add'));
    await t.waitFor(`document.querySelector('[data-testid=review-note-composer]')`, 10000);
    await paste(t, sel('review-note-text'), '[Phase 8 journey test note] Written by the automated journey run to exercise review notes. It records no listening and no judgement of the video. Resolve it, or ignore it.');
    await t.click(sel('review-note-save'));
    await t.waitFor(`document.querySelector('[data-testid=review-notes] li')`, 15000, 'the note to be listed');
    run.noteAfterAdd = await t.eval<string[]>(`[...document.querySelectorAll('[data-testid=review-notes] li')].map((e) => e.innerText.replace(/\\s+/g, ' ').slice(0, 300))`);
    await shot('09-note');
  }
  await build('final');
  const fv = await checks('final');

  // ---- files for review
  for (const [name, v] of [['draft', dv], ['final', fv]] as const) {
    const res = await fetch(`${base}${v.selected.url}`, {headers: {cookie: `studio_token=${token}`}});
    const bytes = Buffer.from(await res.arrayBuffer());
    const file = join(FILES, `${ID}-${name}.mp4`);
    writeFileSync(file, bytes);
    measures[`${name}File`] = {file: file.replace(ROOT + '/', ''), sha256: v.selected.fileSha256, bytes: bytes.length, durationSec: v.selected.durationSec, label: v.selected.label};
  }
  const final = await view();
  const jobs = (await get(`/api/jobs?episode=${ID}`)).jobs as any[];
  Object.assign(run, {
    measures,
    jobs: jobs.sort((a, b) => a.id - b.id).map((j: any) => ({id: j.id, kind: j.kind, subject: j.subject, state: j.state, elapsedSec: j.elapsedMs === null ? null : Math.round(j.elapsedMs / 100) / 10, cacheHit: j.cacheHit})),
    awaitingYou: {approval: final.approval.state, signoffsTicked: final.signoffs.filter((s: any) => s.ticked).length, exportPossible: final.exports.canExport, roundOnFinal: final.videos.find((x: any) => x.kind === 'final' && x.isCurrent)?.round ?? null, openNotes: final.notes.filter((n: any) => n.note.status === 'open').length, blockers: final.readiness.blockers},
    consoleErrors: t.consoleErrors, failedRequests: t.failedRequests,
  });
  writeFileSync(join(OUT, 'journey-run.json'), JSON.stringify(run, null, 2) + '\n');
  log('done', JSON.stringify({awaiting: run.awaitingYou, engine: run.engineSamples}));
} finally { await chrome.close(); }
void before;
