// Phase 4 slice 2 in a real browser: edit -> save -> rebuild -> jobs -> preview, revisions, cancellation, crash recovery.
// The server runs as its own process on fake audio and render workers (the real runner, handlers, hashes, timeline logic and mixer).
// Run with STUDIO_SLOW=1 (npm run test:slow). Set STUDIO_SHOTS=<dir> to keep screenshots.
import assert from 'node:assert/strict';
import {mkdirSync, rmSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {after, afterEach, before, beforeEach, describe, test} from 'node:test';
import {JobService} from '../../app/jobs.ts';
import {getEpisodeInfo} from '../../core/episodes.ts';
import {Project} from '../../core/project.ts';
import {setSegmentText} from '../../app/shared/edit.ts';
import {acquireHeavy} from '../heavy-lock.ts';
import {buildSharedDist, createTestEnv, seedWorkspace, spawnServer, type Child, type Chrome, type Tab, type TestEnv} from './harness.ts';
import {jobOptions, recordFakeTools, setCaptionOnly, setSpoken, until} from './jobs-fixture.ts';

const skip = process.env.STUDIO_SLOW ? false : 'set STUDIO_SLOW=1 to run the browser tests';
const SHOTS = process.env.STUDIO_SHOTS;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const EP = '/api/episodes/context-window';

// Every test gets its own workspace, server, port, Chrome and tabs (beforeEach/afterEach), so a test that fails half way
// cannot leave an edit, a running job or a stored preference behind for the next one. Tests that need earlier work (a finished
// build, some revisions) make it themselves through the API.
let env: TestEnv;
let w: TestEnv['w'];
let srv: Child;
let chrome: Chrome;
let tabs: Tab[] = [];
let control = '';
const problems: string[] = [];

const call = async (method: string, path: string, body?: unknown) => {
  const res = await fetch(srv.url(path), {method, headers: {cookie: `studio_token=${srv.token}`, 'x-studio': '1', 'content-type': 'application/json', connection: 'close'}, body: body === undefined ? undefined : JSON.stringify(body)});
  return {status: res.status, json: (await res.json().catch(() => null)) as any};
};
const setControl = (c: object | null) => { if (c) writeFileSync(control, JSON.stringify(c)); else rmSync(control, {force: true}); };
const open = async (): Promise<Tab> => {
  const t = await chrome.tab();
  tabs.push(t);
  await t.viewport(1280, 800);
  await t.goto(srv.url(`/?token=${srv.token}`));
  await t.waitFor('document.querySelector(".ttl") && document.querySelector("[data-testid=player] div")', 30000, 'the editor to appear');
  await t.traceSelection();
  return t;
};
const q = (t: Tab, expr: string) => t.eval<any>(expr);
const waitSave = (t: Tab, state = 'saved', ms = 8000) => t.waitFor(`document.querySelector("[data-save]")?.dataset.save === ${JSON.stringify(state)}`, ms, `save state ${state}`);
const shot = async (t: Tab, name: string) => { if (SHOTS) { mkdirSync(SHOTS, {recursive: true}); await t.screenshot(join(SHOTS, name)); } };
const segText = async (id: string) => (await call('GET', EP)).json.doc.narration.segments.find((s: any) => s.id === id).text as string;
const selectedSegment = (t: Tab) => t.eval<string>('document.querySelector("[data-segment][aria-selected=true]")?.dataset.segment ?? ""');
/** Click a segment and wait until it is the selected one; a failure says what changed the selection. */
const select = async (t: Tab, id: string) => {
  await t.click(`[data-segment="${id}"]`);
  await t.waitFor(`document.querySelector("[data-segment][aria-selected=true]")?.dataset.segment === ${JSON.stringify(id)}`, 5000, `segment ${id} to be selected`)
    .catch(async (e: Error) => { throw new Error(`${e.message}\nselection trace:\n${await t.selectionTrace()}`); });
};
const expectSelected = async (t: Tab, id: string, what: string) => {
  const got = await selectedSegment(t);
  assert.equal(got, id, `${what}: segment ${got} is selected, not ${id}\nselection trace:\n${await t.selectionTrace()}`);
};
const toggleWord = (t: Tab, n: number) => t.click(`.words .w:nth-of-type(${n})`);
const trayOpen = async (t: Tab) => { if (!(await q(t, '!!document.querySelector("[data-testid=jobs-tray]")'))) await t.click('[data-testid=jobs-button]'); await t.waitFor('document.querySelector("[data-testid=jobs-tray]")'); };
const rebuildState = (t: Tab) => q(t, 'document.querySelector("[data-testid=rebuild-state]")?.innerText ?? ""');
const waitRebuild = (t: Tab, label: string, ms = 90000) => t.waitFor(`document.querySelector("[data-testid=rebuild-state]")?.innerText === ${JSON.stringify(label)}`, ms, `rebuild to be ${label}`)
  .catch(async (e: Error) => { throw new Error(`${e.message}\nthe tray said: ${await t.eval<string>('document.querySelector("[data-testid=jobs-tray]")?.innerText ?? "(tray closed)"').catch(() => '(page unreachable)')}`); });
const jobStates = (t: Tab) => q(t, '[...document.querySelectorAll("[data-testid=job-row]")].map(r => r.querySelector("b").innerText + ":" + r.dataset.state)') as Promise<string[]>;
const clickPlanStart = async (t: Tab) => { await t.waitFor('document.querySelector("[data-testid=plan-start]") && !document.querySelector("[data-testid=plan-start]").disabled', 15000, 'the Start button'); await t.click('[data-testid=plan-start]'); };
const rebuildNow = async (t: Tab) => { await t.click('[data-testid=rebuild-button]'); await t.waitFor('document.querySelector("[data-testid=plan-table]")', 15000, 'the plan'); };
const apiJobs = async () => (await call('GET', '/api/jobs?episode=context-window')).json;
let setupTabs = 0;
/** An edit made through the API, as another tab would make it. */
const putEdit = async (fn: (doc: any) => any) => {
  const cur = (await call('GET', EP)).json;
  const r = await call('PUT', EP, {doc: fn(structuredClone(cur.doc)), baseSeq: cur.seq, tab: `test-setup-${++setupTabs}`}); // a different tab each time, so consecutive edits stay separate revisions
  assert.equal(r.status, 200, `setup edit refused: ${JSON.stringify(r.json)}`);
};
/** New caption words while the spoken words stay as they were: narration is reused. */
const captionOnly = (id: string, text: string) => (doc: any) => {
  const spoken = doc.narration.segments.find((s: any) => s.id === id);
  const keep = spoken.speech ?? spoken.text;
  const next = setSegmentText(doc, id, text).doc;
  return {...next, narration: {...next.narration, segments: next.narration.segments.map((s: any) => (s.id === id ? {...s, speech: keep} : s))}};
};
/** Rebuild through the API and wait for it, to have a finished build to work from. */
const rebuildAndWait = async () => {
  const ep = (await call('GET', EP)).json;
  const r = await call('POST', `${EP}/rebuild`, {seq: ep.seq, requestId: `setup-${Date.now()}`});
  assert.equal(r.status, 202, `setup rebuild refused: ${JSON.stringify(r.json)}`);
  await poll('the setup rebuild to finish', async () => ((await apiJobs()).rebuilds[0]?.state === 'complete' ? true : undefined));
};
async function poll<T>(what: string, fn: () => Promise<T | undefined | false>, ms = 90_000): Promise<T> {
  const t0 = Date.now();
  for (;;) { const v = await fn(); if (v) return v as T; if (Date.now() - t0 > ms) throw new Error(`timed out after ${ms} ms waiting for: ${what}`); await sleep(120); }
}

let releaseHeavy = () => {};
let shared: {dir: string; dist: string} | undefined;
if (!skip) {
  before(async () => { releaseHeavy = await acquireHeavy('rebuild.slow'); shared = await buildSharedDist(); }, {timeout: 40 * 60_000});
  after(() => { releaseHeavy(); if (shared) rmSync(shared.dir, {recursive: true, force: true}); });
}

describe('rebuild, jobs and revisions in a real browser', {skip, timeout: 30 * 60_000}, () => {
  beforeEach(async () => {
    env = await createTestEnv(shared!.dist, (ws) => ({STUDIO_TEST_FAKE: '1', FAKE_RENDER_CONTROL: join(ws.tmp, 'render-control.json')}));
    ({w, srv, chrome, tabs} = env);
    control = join(w.tmp, 'render-control.json');
  });
  afterEach(async () => {
    for (const t of tabs) problems.push(...t.consoleErrors.filter((e) => !/Failed to fetch|ERR_CONNECTION_REFUSED|EventSource|net::ERR/.test(e)).map((e) => `console: ${e}`));
    env.srv = srv; // a test may have restarted the server
    await env.dispose();
  });

  test('Rebuild saves pending edits first, explains what will run and what it costs, then runs, and the new build is previewed with its video', async () => {
    const t = await open();
    await select(t, 's2');
    await t.fill('#f-text', 'That limit is its whole context window.');
    await rebuildNow(t); // clicked without waiting for the autosave
    assert.equal(await segText('s2'), 'That limit is its whole context window.', 'the edit was committed before the plan was made');
    const seq = (await call('GET', EP)).json.seq;
    assert.match(await q(t, 'document.querySelector("[data-testid=plan-dialog]").innerText'), new RegExp(`saved version ${seq}`));
    const rows = await q(t, '[...document.querySelectorAll("[data-step]")].map(r => [r.dataset.step, r.dataset.action, r.querySelector(".time").innerText])') as string[][];
    assert.deepEqual(rows.map((r) => r[0]), ['take:b1', 'take:b2', 'timing', 'mix:final', 'render:final']);
    assert.ok(rows.every((r) => r[1] === 'run'));
    for (const r of rows) assert.match(r[2], /\(estimate\)$|^Not measured$/);
    assert.match(await q(t, 'document.querySelector("[data-testid=plan-total]").innerText'), /5 steps will run[\s\S]*\(estimate\)/);
    await shot(t, '08-rebuild-plan.png');
    const before = await q(t, 'document.querySelector("[data-testid=build-label]").innerText');
    assert.match(before, /imported/);
    await clickPlanStart(t);
    await trayOpen(t);
    await t.waitFor('document.querySelector("[data-testid=jobs-count]")', 8000, 'the running-jobs badge');
    assert.equal(await q(t, 'document.querySelector("[data-testid=rebuild-button]").disabled'), true, 'no second rebuild while one runs');
    assert.match(await q(t, 'document.querySelector("[data-testid=active-note]")?.innerText ?? ""'), /rebuild is in progress/i);
    await shot(t, '09-jobs-running.png');
    await waitRebuild(t, 'Finished');
    const states = await jobStates(t);
    assert.deepEqual(states.map((s) => s.split(':')[1]), ['succeeded', 'succeeded', 'succeeded', 'succeeded', 'succeeded']);
    await t.waitFor('!document.querySelector("[data-testid=build-label]").innerText.includes("imported")', 15000, 'the preview to show the new build');
    assert.equal(await q(t, 'document.querySelector("[data-testid=build-freshness]").innerText'), 'Matches your saved text');
    assert.equal(await q(t, 'document.querySelector("[data-testid=stale-chip]").dataset.stale'), 'false');
    assert.equal(await q(t, '!!document.querySelector("[data-testid=preview-banner]")'), false, 'nothing differs, so no banner');
    await t.click('[data-testid=play-video]');
    await t.waitFor('document.querySelector("[data-testid=rendered-video]")');
    assert.match(await q(t, 'document.querySelector("[data-testid=rendered-video]").getAttribute("src")'), /^\/media\/render\/context-window\/\d+\.mp4$/);
    await shot(t, '10-rebuilt-preview.png');
  });

  test('a double click starts one rebuild, and an emphasis-only edit rebuilds only the video', async () => {
    await putEdit(captionOnly('s2', 'That limit is called its context window.'));
    await rebuildAndWait(); // so that only the emphasis differs from the current build
    const t = await open();
    await select(t, 's3');
    await toggleWord(t, 1);
    await waitSave(t);
    await rebuildNow(t);
    const rows = await q(t, '[...document.querySelectorAll("[data-step]")].map(r => r.dataset.step + ":" + r.dataset.action)') as string[];
    assert.deepEqual(rows, ['take:b1:current', 'take:b2:current', 'timing:current', 'mix:final:current', 'render:final:run']);
    await t.waitFor('document.querySelector("[data-testid=plan-start]") && !document.querySelector("[data-testid=plan-start]").disabled');
    await t.dblclick('[data-testid=plan-start]');
    await trayOpen(t);
    await waitRebuild(t, 'Finished');
    assert.equal((await jobStates(t)).filter((s) => s.startsWith('Final video')).length >= 1, true);
    const all = await apiJobs();
    assert.equal(all.jobs.filter((j: any) => j.rebuildId === all.rebuilds[0].id).length, 1, 'one job, not two');
  });

  test('inputs this build cannot apply are refused before anything starts, with a way to the segment', async () => {
    const t = await open();
    await select(t, 's1');
    await t.fill('#f-pause', '0.5');
    await waitSave(t);
    const before = (await apiJobs()).jobs.length;
    await rebuildNow(t);
    assert.match(await q(t, 'document.querySelector("[data-testid=plan-blockers]").innerText'), /Nothing was started[\s\S]*Start a new block after that segment, or remove the pause/);
    assert.equal(await q(t, 'document.querySelector("[data-testid=plan-start]").disabled'), true);
    await shot(t, '11-rebuild-blocked.png');
    await t.click('[data-testid=plan-blockers] .linkish');
    await t.waitFor('!document.querySelector("[data-testid=plan-dialog]")');
    await expectSelected(t, 's1', 'following the link from the rebuild dialog');
    assert.equal((await apiJobs()).jobs.length, before, 'no job was queued');
  });

  test('editing while a step runs: it finishes on its own inputs, is kept as an earlier build, and is not presented as matching the new text', async () => {
    // This test once failed in a full run and was not explained. Its checks are only valid while the video step is still running, so the step
    // is long enough (about 15 s) to outlast the page catching up; and when it fails again it writes what it saw (docs/studio/phase8-evidence/flake).
    setControl({frames: 300, stepMs: 50});
    const t = await open();
    const events: {at: number; what: string; data?: unknown}[] = [];
    const t0 = Date.now();
    const ev = (what: string, data?: unknown) => events.push({at: Date.now() - t0, what, data});
    const diag = async (error: unknown) => {
      const out = join(process.cwd(), 'docs', 'studio', 'phase8-evidence', 'flake');
      mkdirSync(out, {recursive: true});
      const snap = async () => ({
        label: await q(t, 'document.querySelector("[data-testid=build-label]")?.innerText').catch(() => null),
        jobs: await jobStates(t).catch(() => null),
        server: await call('GET', EP).then((r) => ({builds: r.json.builds, timing: r.json.status?.timing, render: r.json.status?.render})).catch(() => null),
        serverJobs: await apiJobs().then((j: any) => j.jobs.map((x: any) => ({id: x.id, kind: x.kind, state: x.state, startedAt: x.startedAt, finishedAt: x.finishedAt}))).catch(() => null),
        selectionTrace: await t.selectionTrace().catch(() => null),
      });
      writeFileSync(join(out, `rebuild-editing-while-step-runs-${new Date().toISOString().replace(/[:.]/g, '-')}.json`), JSON.stringify({error: String((error as Error)?.stack ?? error), events, at: Date.now() - t0, now: await snap()}, null, 2));
    };
    try {
    await select(t, 's4');
    await t.fill('#f-speech', 'Each token uses up some room.');
    await t.fill('#f-text', 'Each token takes up some room.');
    await waitSave(t);
    await rebuildNow(t);
    ev('plan start'); await clickPlanStart(t);
    await trayOpen(t);
    await t.waitFor('[...document.querySelectorAll("[data-testid=job-row]")].some(r => r.dataset.state === "running" && r.innerText.includes("Final video"))', 60000, 'the video step to run');
    ev('video step seen running');
    // The page learns of a finished step a moment after the server records it: wait until it shows the build the server is showing, so the
    // label compared below is not a stale read taken before that refresh.
    const shownByServer = `Build r${(await call('GET', EP)).json.builds.find((b: any) => b.shown).revision}`;
    await t.waitFor(`document.querySelector("[data-testid=build-label]").innerText.startsWith(${JSON.stringify(shownByServer)})`, 10000, 'the page to show the build the server shows');
    const label = await q(t, 'document.querySelector("[data-testid=build-label]").innerText');
    ev('label read', {label, shownByServer});
    await select(t, 's5');
    await t.fill('#f-text', 'The reply uses room too, honestly.');
    await waitSave(t);
    ev('second edit saved', {label: await q(t, 'document.querySelector("[data-testid=build-label]").innerText'), jobs: await jobStates(t)});
    assert.equal(await q(t, 'document.querySelector("[data-testid=build-label]").innerText'), label, 'the preview stays on the last finished build while the job runs');
    assert.equal([...(await jobStates(t))].some((s) => s.startsWith('Final video:running')), true, 'the job keeps running');
    await waitRebuild(t, 'Stopped');
    const row = await q(t, '[...document.querySelectorAll("[data-testid=job-row]")].find(r => r.innerText.includes("Final video")).innerText') as string;
    assert.match(row, /Done, out of date/);
    assert.match(row, /kept as an earlier build/);
    assert.equal(await q(t, 'document.querySelector("[data-testid=build-freshness]").innerText'), 'Older than your edits');
    assert.equal(await q(t, 'document.querySelector("[data-testid=rebuild-button]").disabled'), false, 'a new rebuild can include the edit');
    await shot(t, '12-edited-while-running.png');
    } catch (e) { await diag(e); throw e; }
  });

  test('cancelling stops only that job and keeps the earlier build; Retry finishes the rebuild', async () => {
    setControl({frames: 400, stepMs: 50, children: 1});
    await putEdit(captionOnly('s5', 'The reply uses room too, as well.'));
    const t = await open();
    await rebuildNow(t);
    await clickPlanStart(t);
    await trayOpen(t);
    await t.waitFor('[...document.querySelectorAll("[data-testid=job-row]")].some(r => r.dataset.state === "running" && r.innerText.includes("Final video"))', 90000, 'the video step to run');
    await t.eval('[...document.querySelectorAll("[data-testid=job-row]")].find(r => r.innerText.includes("Final video")).querySelector("button").click()');
    await waitRebuild(t, 'Cancelled', 30000);
    const states = await jobStates(t);
    assert.ok(states.some((s) => s === 'Final video:cancelled'));
    assert.ok(states.filter((s) => !s.startsWith('Final video')).every((s) => s.endsWith(':succeeded')), 'finished steps are kept');
    await shot(t, '13-cancelled.png');
    await t.click('[data-testid=history-button]');
    await t.eval('[...document.querySelectorAll("[role=tab]")].find(b => b.innerText === "Builds").click()');
    await t.waitFor('document.querySelectorAll("[data-testid=build-row]").length >= 2');
    assert.ok(await q(t, '[...document.querySelectorAll("[data-testid=build-row]")].some(r => r.innerText.includes("Final video"))'), 'an earlier build with a video is still listed');
    await t.click('[data-testid=jobs-button]');
    setControl(null);
    await t.eval('[...document.querySelectorAll("[data-testid=job-row]")].find(r => r.dataset.state === "cancelled").querySelector("button").click()');
    await waitRebuild(t, 'Finished');
  });

  test('closing the browser does not stop the work, and a new window shows the result', async () => {
    setControl({frames: 80, stepMs: 50});
    const t = await open();
    await select(t, 's6');
    await toggleWord(t, 1);
    await waitSave(t);
    await rebuildNow(t);
    await clickPlanStart(t);
    await trayOpen(t);
    await t.waitFor('document.querySelector("[data-testid=job-row][data-state=running]")', 60000);
    await t.close();
    const done = await poll('rebuild complete with no browser open', async () => { const r = await apiJobs(); return r.rebuilds[0]?.state === 'complete' ? r : undefined; });
    assert.ok(done);
    const t2 = await open();
    await trayOpen(t2);
    assert.equal(await rebuildState(t2), 'Finished');
    assert.equal(await q(t2, 'document.querySelector("[data-testid=build-freshness]").innerText'), 'Matches your saved text');
  });

  test('a server killed during a render: the page recovers, the step is shown as interrupted with Retry, nothing restarts by itself, and Retry finishes it', {timeout: 180000}, async () => {
    await rebuildAndWait(); // a finished build first, so the emphasis edit below needs only the (slow) video step
    setControl({frames: 600, stepMs: 50});
    const t = await open();
    await select(t, 's7');
    await toggleWord(t, 2);
    await waitSave(t);
    await rebuildNow(t);
    await clickPlanStart(t);
    await trayOpen(t);
    await t.waitFor('document.querySelector("[data-testid=job-row][data-state=running]")', 60000);
    const port = srv.port;
    await srv.kill('SIGKILL');
    await t.waitFor('document.body.innerText.includes("Lost connection")', 20000, 'the lost-connection notice');
    setControl(null);
    srv = await spawnServer(w, port, {STUDIO_TEST_FAKE: '1', FAKE_RENDER_CONTROL: control});
    await t.waitFor('document.querySelector("[data-testid=job-row][data-state=failed]")', 30000, 'the interrupted job');
    const row = await q(t, 'document.querySelector("[data-testid=job-row][data-state=failed]").innerText') as string;
    assert.match(row, /The app stopped while this was running\. Nothing was lost/);
    assert.match(row, /Retry/);
    assert.match(await q(t, 'document.body.innerText'), /The app was restarted/);
    await shot(t, '14-interrupted.png');
    await sleep(2500);
    assert.equal(await q(t, 'document.querySelectorAll("[data-testid=job-row][data-state=running]").length'), 0, 'nothing started again by itself');
    await t.eval('document.querySelector("[data-testid=job-row][data-state=failed] button").click()');
    await waitRebuild(t, 'Finished');
  });

  test('history: inspect and restore an earlier revision without losing builds; a pending conflict blocks both restore and rebuild', async () => {
    await putEdit(captionOnly('s2', 'That limit is called its context window.'));
    await rebuildAndWait(); // a revision is recorded when a rebuild snapshots the text, so two rebuilds give three revisions in all
    await putEdit(captionOnly('s5', 'The reply uses room too, as well.'));
    await rebuildAndWait();
    const t = await open();
    await select(t, 's2');
    await t.click('[data-testid=history-button]');
    await t.waitFor('document.querySelectorAll("[data-testid=revision-row]").length >= 3');
    const before = await q(t, 'document.querySelectorAll("[data-testid=revision-row]").length') as number;
    const rows = await q(t, '[...document.querySelectorAll("[data-testid=revision-row]")].map(r => r.innerText)') as string[];
    assert.ok(rows.some((r) => /Imported episode/.test(r)), 'the original revision is listed');
    assert.ok(rows.some((r) => /Spoken text changed in s2|Caption text changed in s2/.test(r)), 'summaries name what changed');
    await shot(t, '15-history.png');
    await t.eval('document.querySelector("[data-revision=\\"1\\"] .linkish").click()');
    await t.waitFor('document.querySelector("[data-revision=\\"1\\"] .segtext")');
    assert.match(await q(t, 'document.querySelector("[data-revision=\\"1\\"] .rvd").innerText'), /s2 That limit is its context window\./);
    const buildsBefore = (await call('GET', EP)).json.builds.length;
    await t.eval('[...document.querySelectorAll("[data-revision=\\"1\\"] .linkish")].find(b => b.innerText.startsWith("Restore")).click()');
    await t.click('[data-testid=restore-confirm]');
    await t.waitFor(`document.querySelectorAll("[data-testid=revision-row]").length === ${before + 1}`, 10000, 'a new revision');
    assert.match(await q(t, 'document.querySelector("[data-testid=revision-row]").innerText'), /Restored r1/);
    assert.equal(await q(t, 'document.querySelector("#f-text").value'), 'That limit is its context window.');
    assert.equal((await call('GET', EP)).json.builds.length, buildsBefore, 'no build was removed');
    await waitSave(t);

    // a conflicting save: A has unsaved edits while someone else commits first
    await t.click('[data-testid=history-button]');
    await select(t, 's8');
    await t.fill('#f-text', 'Some stop. Others drop the older words.');
    const cur = (await call('GET', EP)).json;
    const doc = structuredClone(cur.doc);
    const s8 = doc.narration.segments.find((s: any) => s.id === 's8');
    s8.text = 'Some stop. Others drop older text, mostly.'; delete s8.emphasis;
    assert.equal((await call('PUT', EP, {doc, baseSeq: cur.seq, tab: 'other'})).status, 200);
    await waitSave(t, 'conflict', 10000);
    const jobsBefore = (await apiJobs()).jobs.length;
    await t.click('[data-testid=rebuild-button]');
    await t.waitFor('document.querySelector("[data-testid=rebuild-note]")', 8000);
    assert.match(await q(t, 'document.querySelector("[data-testid=rebuild-note]").innerText'), /Rebuild was not started[\s\S]*newer saved version/);
    assert.equal(await q(t, '!!document.querySelector("[data-testid=plan-dialog]")'), false);
    assert.equal((await apiJobs()).jobs.length, jobsBefore, 'nothing was queued');
    await t.click('[data-testid=history-button]');
    assert.match(await q(t, 'document.querySelector("[data-testid=history-panel]").innerText'), /newer saved version exists/i);
    assert.equal(await q(t, '[...document.querySelectorAll("[data-testid=revision-row] .linkish")].filter(b => b.innerText.startsWith("Restore")).every(b => b.disabled)'), true);
    await shot(t, '16-conflict-blocks-rebuild.png');
    await t.eval('[...document.querySelectorAll(".notice .btn")].find(b => b.innerText.startsWith("Use the saved")).click()');
    await waitSave(t);
  });

  test('an earlier build can be previewed with its own audio and timeline, and the newest is one click away', async () => {
    await putEdit(captionOnly('s2', 'That limit is called its context window.'));
    await rebuildAndWait();
    const t = await open();
    await t.click('[data-testid=history-button]');
    await t.eval('[...document.querySelectorAll("[role=tab]")].find(b => b.innerText === "Builds").click()');
    await t.waitFor('document.querySelectorAll("[data-testid=build-row]").length >= 2');
    const newest = await q(t, 'document.querySelector("[data-testid=build-label]").innerText');
    await t.eval('[...document.querySelectorAll("[data-testid=build-row]")].find(r => r.innerText.includes("Imported sample")).querySelector(".linkish").click()');
    await t.waitFor('document.querySelector("[data-testid=show-latest]")', 10000, 'the earlier-build marker');
    assert.notEqual(await q(t, 'document.querySelector("[data-testid=build-label]").innerText'), newest);
    assert.match(await q(t, 'document.querySelector("[data-testid=build-label]").innerText'), /imported/);
    assert.equal(await q(t, 'document.querySelector("[data-testid=build-freshness]").innerText'), 'Older than your edits');
    await shot(t, '17-earlier-build.png');
    await t.click('[data-testid=show-latest]');
    await t.waitFor('!document.querySelector("[data-testid=show-latest]")', 10000);
    assert.equal(await q(t, 'document.querySelector("[data-testid=build-label]").innerText'), newest);
  });

  test('choosing a segment and typing at once edits that segment, even when another one was stored by an earlier visit', async () => {
    await call('PUT', '/api/ui', {key: 'app.selected.context-window', value: 's3'});
    for (let visit = 1; visit <= 5; visit++) {
      await call('PUT', '/api/ui', {key: 'app.selected.context-window', value: 's3'});
      const t = await open();
      assert.equal(await selectedSegment(t), 's3', `visit ${visit}: the stored selection is restored`);
      await select(t, 's1');
      await t.fill('#f-pause', '0.5');
      const paused = async () => ((await call('GET', EP)).json.doc.narration.segments as any[]).filter((s) => s.pauseAfter).map((s) => s.id).join(',');
      await poll(`visit ${visit}: the pause to be saved`, async () => (await paused() ? true : undefined), 10_000);
      assert.equal(await paused(), 's1', `visit ${visit}: the pause went to the segment that was chosen\nselection trace:\n${await t.selectionTrace()}`);
      await expectSelected(t, 's1', `visit ${visit}, after typing`);
      await t.fill('#f-pause', '');
      await poll(`visit ${visit}: the pause to be removed`, async () => (!(await paused()) ? true : undefined), 10_000);
      await waitSave(t);
      await t.close();
      tabs = tabs.filter((x) => x !== t);
    }
  });

  test('a rebuild paused because the text was edited between steps says why, keeps what finished, and offers to rebuild with the edits', async () => {
    // The pause is made on a second workspace, in this process, before any server or browser sees it: an edit lands between two steps.
    const w2 = await seedWorkspace({dist: shared!.dist});
    let srv2: Child | undefined;
    try {
      const p = Project.open(w2.projectRoot);
      recordFakeTools(p);
      const svc = new JobService(jobOptions(p, w2.projectRoot));
      setSpoken(p, 's2', 'That limit is its whole context window.');
      const r = svc.startRebuild('context-window', {seq: getEpisodeInfo(p, 'context-window').seq, requestId: 'req-pause-1'});
      void svc.runner.waitFor(r.jobIds[0]).then(() => setCaptionOnly(p, 's5', 'The reply uses room too, as well.'));
      await until('the rebuild to pause', () => svc.rebuilds('context-window', 5).find((x) => x.id === r.rebuildId && x.state === 'paused'), 60_000);
      await svc.shutdown();
      p.close();
      srv2 = await spawnServer(w2, 0, {STUDIO_TEST_FAKE: '1'});
      const t = await chrome.tab();
      tabs.push(t);
      await t.viewport(1280, 800);
      await t.goto(srv2.url(`/?token=${srv2.token}`));
      await t.waitFor('document.querySelector(".ttl") && document.querySelector("[data-testid=player] div")', 30000, 'the editor to appear');
      await trayOpen(t);
      await t.waitFor('document.querySelector("[data-testid=rebuild-state]")?.innerText === "Paused"', 15000, 'the paused rebuild');
      const msg = await q(t, 'document.querySelector(".rmsg").innerText');
      assert.match(msg, /you edited the episode after this rebuild started/);
      assert.match(msg, /never swaps its inputs/);
      assert.match(msg, /Finished and kept: Narration, block b1/);
      assert.equal(await q(t, '!![...document.querySelectorAll(".rh button")].find(b => b.innerText === "Continue")'), false, 'there is no Continue: it would run on text the rebuild did not begin with');
      assert.deepEqual((await jobStates(t)).sort(), ['Narration, block b1:succeeded', 'Narration, block b2:succeeded'], 'no step after narration exists');
      await shot(t, '18-paused-by-edit.png');
      await t.click('[data-testid=rebuild-with-edits]');
      await t.waitFor('document.querySelector("[data-testid=plan-table]")', 15000, 'the plan with the edits');
      assert.equal(await q(t, '!!document.querySelector("[data-testid=jobs-tray]")'), false, 'the tray closed to show the plan');
      await shot(t, '19-rebuild-with-edits-plan.png');
    } finally {
      if (srv2?.proc.exitCode === null) await srv2.kill('SIGTERM');
      rmSync(w2.tmp, {recursive: true, force: true});
    }
  });

  test('no console errors', () => { assert.deepEqual(problems, []); });
});
