// Phase 7 demonstration on the persistent demo workspace, through the real app in a real (headless) browser, with the REAL tools: the real
// aligner, the real Remotion renderer, the real mastering, and the real ffmpeg and browser probe for the checks. It uses the separate draft
// "Voice demo: prompts" (its narration was made with the approved Pip voice in Phase 6 and is REUSED here: no narration job runs).
//
//   1. Scenes are put into that draft (it only had a stand-in scene) through the planner's own routes: storyboard import, accept, apply.
//   2. Review > Make a draft video: timing, the draft mix, the draft video. Production checks on the draft.
//   3. Review > Make the final video: the mastered mix and the final video. Production checks on the final file.
//
// It plays nothing, opens no review round, ticks nothing, approves nothing and exports nothing: those are yours. The final video is left
// awaiting your review and approval. The approved baseline episode and the other drafts are only read.
//   node scripts/phase7_demo_ui.ts            (the app must already be running: ./studio-app)
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {ROOT, DEMO_PROJECT} from '../app/demo.ts';
import {Chrome, type Tab} from '../tests/app/harness.ts';

const PORT = 4317;
const ID = 'voice-demo-prompts';
const token = readFileSync(join(DEMO_PROJECT, '.studio', 'app-token'), 'utf8').trim();
const base = `http://127.0.0.1:${PORT}`;
const OUT = resolve(ROOT, 'docs/studio/phase7-evidence');
const FILES = resolve(ROOT, 'out/phase7/demo');
mkdirSync(OUT, {recursive: true});
mkdirSync(FILES, {recursive: true});
const log = (...a: unknown[]) => console.log(new Date().toISOString().slice(11, 19), ...a);
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
const jobsNow = async () => (await get(`/api/jobs?episode=${ID}`)).jobs as any[];
if ((await jobsNow()).some((j) => ['queued', 'preparing', 'running', 'cancelling'].includes(j.state))) throw new Error('work is already in progress for this draft; not starting');

const before = {
  baseline: await get('/api/episodes/context-window'),
  other: await get('/api/episodes/tokens-in-pieces'),
  draft: await get(`/api/episodes/${ID}`),
};
const startedAt = Date.now();
const run: Record<string, unknown> = {ranAt: new Date().toISOString(), draft: ID};

// ---- 1. scenes for the draft, through the planner's own routes (the draft only has a stand-in scene) ----------------------------------------
if (before.draft.doc.scenes.some((s: any) => s.type === 'pip-cards')) {
  log('the draft already has Pip card scenes; not changing them');
} else {
  const storyboard = {studioPacket: 1, kind: 'storyboard', storyboard: {scenes: [
    {segments: [1, 2, 3], sceneType: 'pip-cards', intention: 'What a prompt is', mechanism: 'Two cards: the prompt and the forms it takes', pip: ['Pip points at the prompt card'],
      params: {title: 'What a prompt is', cards: [{heading: 'A prompt', body: 'The message you send to a model.'}, {heading: 'Its forms', body: 'A question, an instruction, or a few examples.', at: {segment: 1, word: 'question'}}], actions: [{do: 'point', card: 0, at: {segment: 0, word: 'prompt'}}, {do: 'nod', at: {segment: 2, edge: 'start'}}], idle: true}},
    {segments: [4, 5], sceneType: 'pip-cards', intention: 'How the model answers and why clarity helps', mechanism: 'Two cards', pip: ['Pip looks at the first card'],
      params: {cards: [{heading: 'Piece by piece', body: 'It writes its answer one piece after another.', at: {segment: 0, word: 'answer'}}, {heading: 'Clear is better', body: 'A clear prompt leaves less to guess.', at: {segment: 1, word: 'clear'}}], actions: [{do: 'look', card: 0, at: {segment: 0, edge: 'start'}}, {do: 'smile', at: {segment: 1, edge: 'end'}}], idle: true}},
    {segments: [6, 7], sceneType: 'pip-cards', intention: 'Two ways to help the model', mechanism: 'Two cards', pip: ['Pip points at the second card'],
      params: {title: 'Help the model', cards: [{heading: 'Say who it is for', body: 'The model can pick better words.', at: {segment: 0, word: 'who'}}, {heading: 'Show an example', body: 'It can copy the shape.', at: {segment: 1, word: 'example'}}], actions: [{do: 'point', card: 1, at: {segment: 1, word: 'example'}}], idle: true}},
  ]}};
  const imp = await call('POST', `/api/plans/${ID}/imports`, {text: JSON.stringify(storyboard, null, 2), via: 'paste'});
  if (imp.status !== 201) throw new Error(`the storyboard was not accepted for import: ${imp.text}`);
  const acc = await call('POST', `/api/plans/${ID}/imports/${imp.json.import.id}/accept`, {selection: {sources: [], claims: [], script: null, storyboard: true, confirmReplace: false}, basePlanSeq: imp.json.planSeq, baseEpisodeSeq: imp.json.episode.seq});
  if (acc.status !== 200) throw new Error(`the storyboard was not accepted: ${acc.text}`);
  const prev = await get(`/api/plans/${ID}/apply`);
  if (prev.blockers?.length || prev.problems?.length) throw new Error(`the storyboard cannot be applied: ${JSON.stringify(prev)}`);
  const plan = await get(`/api/plans/${ID}`);
  const ep = await get(`/api/episodes/${ID}`);
  const applied = await call('POST', `/api/plans/${ID}/apply`, {basePlanSeq: plan.seq, baseEpisodeSeq: ep.seq, confirmReplace: true});
  if (applied.status !== 200) throw new Error(`the storyboard was not applied: ${applied.text}`);
  log('scenes applied to the draft');
}
const scened = await get(`/api/episodes/${ID}`);
run.scenes = scened.doc.scenes.map((s: any) => ({id: s.id, type: s.type, segments: s.segments}));
run.narrationUnchangedByScenes = JSON.stringify(before.draft.doc.narration) === JSON.stringify(scened.doc.narration);
run.takesStillFresh = Object.fromEntries(Object.entries(scened.status.takes).map(([k, v]: any) => [k, v.status]));

// ---- 2 and 3. the Review screen, with real tools ------------------------------------------------------------------------------------------
const chrome = await Chrome.launch();
const measures: Record<string, unknown> = {};
try {
  const t = await chrome.tab();
  await t.viewport(1360, 1000, 1);
  await t.goto(`${base}/?token=${token}`);
  await t.waitFor('document.querySelector(".ttl")', 30000, 'the app');
  await t.goto(`${base}/?review=${ID}`);
  await t.waitFor(`document.querySelector('[data-testid=review-screen]')`, 30000, 'the review screen');
  const shot = (name: string) => t.screenshot(join(OUT, `demo-${name}.png`));
  await shot('1-before');
  const view = () => get(`/api/episodes/${ID}/review`);
  const count = () => t.eval<number>(`document.querySelectorAll('li[data-testid^=video-]').length`);

  const earlier = (() => { try { return JSON.parse(readFileSync(join(OUT, 'demo-run.json'), 'utf8')); } catch { return null; } })();
  async function build(mode: 'draft' | 'final') {
    const current = (await view()).videos.find((x: any) => x.kind === mode && x.isCurrent);
    if (current?.fresh && earlier?.measures?.[`${mode}Build`]) {
      measures[`${mode}Build`] = {...earlier.measures[`${mode}Build`], carriedOverFrom: earlier.ranAt, note: 'the video was already built and up to date when this run started; these are the figures from the run that built it'};
      log(`${mode} video is already up to date (built by the run of ${earlier.ranAt}); not rebuilt`);
      return;
    }
    const n = await count();
    await t.click(sel(mode === 'draft' ? 'make-draft' : 'make-final'));
    await t.waitFor(`document.querySelector('[data-testid=plan-dialog]')`, 15000, 'the plan');
    await t.waitFor(`(() => { const b = document.querySelector('[data-testid=plan-start]'); return !!b && !b.disabled; })()`, 60000, 'the plan to load');
    const rows = await t.eval<string[]>(`[...document.querySelectorAll('[data-testid=plan-table] tr[data-step]')].map((r) => r.dataset.step + ':' + r.dataset.action)`);
    const dialog = await text(t, sel('plan-dialog'));
    await shot(`${mode}-plan`);
    log(`${mode} plan:`, rows.join(', '));
    const t0 = Date.now();
    await t.click(sel('plan-start'));
    await t.waitFor(`document.querySelectorAll('li[data-testid^=video-]').length > ${n} && document.querySelector('[data-testid=review-screen]')?.dataset.busy === 'no'`, 40 * 60_000, `the ${mode} build to finish`);
    measures[`${mode}Build`] = {plan: rows, wallSec: Math.round((Date.now() - t0) / 100) / 10, dialogNotes: dialog.split('\n').filter((l) => /draft|mastered|reuse|saved/i.test(l)).slice(0, 6)};
    log(`${mode} built in ${(Date.now() - t0) / 1000} s`);
  }
  async function checks(mode: 'draft' | 'final') {
    // the newest video of this kind, picked by its id so that nothing else is read by mistake
    const row = (await view()).videos.find((x: any) => x.kind === mode && x.isCurrent);
    if (!row) throw new Error(`there is no current ${mode} video to check`);
    const id = row.renderArtifactId;
    await t.click(`li[data-testid=video-${id}] .rv-vbtn`);
    await t.waitFor(`document.querySelector('li[data-testid=video-${id}]')?.dataset.selected === 'yes' && document.querySelector('[data-testid=review-player]')?.dataset.kind === '${mode}'`, 15000, `the ${mode} video to be selected`);
    const t0 = Date.now();
    await t.click(sel('run-checks'));
    const deadline = Date.now() + 15 * 60_000;
    let v: any = await get(`/api/episodes/${ID}/review?render=${id}`);
    while (!(v.selected?.renderArtifactId === id && v.selected.checks.state === 'done' && v.report && v.report.renderArtifactId === id)) {
      if (Date.now() > deadline) throw new Error(`the ${mode} checks did not finish`);
      await new Promise((r) => setTimeout(r, 1000));
      v = await get(`/api/episodes/${ID}/review?render=${id}`);
    }
    await t.waitFor(`document.querySelector('[data-testid=checks-verdict]')`, 30000, `the ${mode} verdict on the page`);
    measures[`${mode}Checks`] = {renderArtifactId: id, fileSha256: v.report.fileSha256, wallSec: Math.round((Date.now() - t0) / 100) / 10, passed: v.report.passed, summary: v.report.summary, sampledFrames: v.report.sampled.frames, items: v.report.items.map((i: any) => ({id: i.id, kind: i.kind, status: i.status, detail: i.detail.slice(0, 400), lines: (i.lines ?? []).slice(0, 4)})), captionDiffs: v.report.captionDiffs};
    await shot(`${mode}-checks`);
    log(`${mode} checks on #${id} (${v.report.fileSha256.slice(0, 8)}): ${JSON.stringify(v.report.summary)} passed=${v.report.passed}`);
    return v;
  }

  await build('draft');
  const dv = await checks('draft');
  await build('final');
  const fv = await checks('final');

  // ---- the files, for you to open yourself ------------------------------------------------------------------------------------------------------
  for (const [name, v] of [['draft', dv], ['final', fv]] as const) {
    const sel2 = v.selected;
    const res = await fetch(`${base}${sel2.url}`, {headers: {cookie: `studio_token=${token}`}});
    const bytes = Buffer.from(await res.arrayBuffer());
    const file = join(FILES, `${ID}-${name}.mp4`);
    writeFileSync(file, bytes);
    measures[`${name}File`] = {file: file.replace(ROOT + '/', ''), sha256: sel2.fileSha256, bytes: sel2.bytes, durationSec: sel2.durationSec, label: sel2.label};
  }

  const after = {baseline: await get('/api/episodes/context-window'), other: await get('/api/episodes/tokens-in-pieces')};
  const final = await view();
  // The demonstration was run in two passes (the second one rebuilt the videos after a source file of the render changed and read each
  // video's own report); job 27 is the first job of the first pass, so every job of the demonstration is listed.
  const newJobs = (await jobsNow()).filter((j: any) => j.id >= 27).sort((a: any, b: any) => a.id - b.id);
  Object.assign(run, {
    measures,
    jobsForThisDemo: newJobs.map((j: any) => ({id: j.id, kind: j.kind, subject: j.subject, state: j.state, elapsedSec: j.elapsedMs === null ? null : Math.round(j.elapsedMs / 100) / 10, cacheHit: j.cacheHit})),
    narrationJobsRun: newJobs.filter((j: any) => j.kind === 'tts.block').length,
    awaitingYou: {approval: final.approval.state, signoffsTicked: final.signoffs.filter((s: any) => s.ticked).length, exportPossible: final.exports.canExport, roundOpenedOnFinal: !!dv.selected.round || !!fv.selected.round, readinessBlockers: final.readiness.blockers},
    baseline: {seqBefore: before.baseline.seq, hashBefore: before.baseline.docHash, seqAfter: after.baseline.seq, hashAfter: after.baseline.docHash, unchanged: before.baseline.docHash === after.baseline.docHash && before.baseline.seq === after.baseline.seq},
    otherDraftUnchanged: before.other.docHash === after.other.docHash && before.other.seq === after.other.seq,
    consoleErrors: t.consoleErrors, failedRequests: t.failedRequests,
  });
  writeFileSync(join(OUT, 'demo-run.json'), JSON.stringify(run, null, 2) + '\n');
  log('done', JSON.stringify({narrationJobsRun: run.narrationJobsRun, awaiting: run.awaitingYou, baselineUnchanged: (run.baseline as any).unchanged}));
} finally { await chrome.close(); }
