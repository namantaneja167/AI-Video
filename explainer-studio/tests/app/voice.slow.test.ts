// Browser acceptance for Phase 6 (the Voice stage): a real browser drives the real app on a temporary workspace whose audio and render
// workers are the test fakes. Run with STUDIO_SLOW=1 (npm run test:slow). STUDIO_SHOTS=<dir> keeps screenshots. Everything here lives in
// temp directories this file creates and removes; the persistent demo workspace is never opened. Nothing here judges how anything sounds.
import assert from 'node:assert/strict';
import {mkdirSync, rmSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {after, afterEach, before, beforeEach, describe, test} from 'node:test';
import {acquireHeavy} from '../heavy-lock.ts';
import {buildSharedDist, createTestEnv, type Child, type Chrome, type Tab, type TestEnv} from './harness.ts';
import {sel_ as sel, waitFor} from './planner-scenario.ts';

const skip = process.env.STUDIO_SLOW ? false : 'set STUDIO_SLOW=1 to run the browser tests';
const SHOTS = process.env.STUDIO_SHOTS;
const sentence = (n: number) => `Sentence ${n} says exactly ${Array.from({length: 16}, (_, i) => `word${n}x${i}`).join(' ')}.`;
const SCRIPT = (count: number) => Array.from({length: count}, (_, i) => sentence(i + 1)).join(' ');

let env: TestEnv;
let srv: Child;
let chrome: Chrome;
let tabs: Tab[] = [];
const sawProblems: string[] = [];
const call = async (method: string, path: string, body?: unknown) => {
  const res = await fetch(srv.url(path), {method, headers: {cookie: `studio_token=${srv.token}`, 'x-studio': '1', 'content-type': 'application/json', connection: 'close'}, body: body === undefined ? undefined : JSON.stringify(body)});
  return {status: res.status, json: (await res.json().catch(() => null)) as any};
};
const shot = (name: string) => async () => { if (SHOTS) { mkdirSync(SHOTS, {recursive: true}); await tabs[0].screenshot(join(SHOTS, `phase6-${name}.png`)); } };
const open = async (path: string): Promise<Tab> => {
  const t = await chrome.tab();
  tabs.push(t);
  await t.viewport(1280, 900, 1);
  await t.goto(srv.url(`/?token=${srv.token}`));
  await t.waitFor('document.querySelector(".ttl")', 30000, 'the app to appear');
  await t.goto(srv.url(path));
  await t.waitFor('document.querySelector(".ttl")', 30000, 'the page to appear');
  return t;
};
async function draft(title: string, sentences: number): Promise<string> {
  const made = (await call('POST', '/api/plans', {title, audience: 'a', objective: 'o'})).json;
  const id = made.plan.id as string;
  const imp = (await call('POST', `/api/plans/${id}/imports`, {text: SCRIPT(sentences), via: 'paste'})).json;
  const ok = await call('POST', `/api/plans/${id}/imports/${imp.import.id}/accept`, {selection: {sources: [], claims: [], script: imp.import.proposal.script, storyboard: false, confirmReplace: false}, basePlanSeq: imp.planSeq, baseEpisodeSeq: null});
  assert.equal(ok.status, 200);
  return id;
}
const text = (t: Tab, q: string) => t.eval<string>(`document.querySelector(${JSON.stringify(q)})?.innerText ?? ''`);
const attr = (t: Tab, q: string, a: string) => t.eval<string | null>(`document.querySelector(${JSON.stringify(q)})?.getAttribute(${JSON.stringify(a)}) ?? null`);
const statuses = (t: Tab) => t.eval<string[]>(`[...document.querySelectorAll('[data-testid^=block-][data-status]')].map((e) => e.dataset.testid.replace('block-', '') + ':' + e.dataset.status)`);

let releaseHeavy = () => {};
let shared: {dir: string; dist: string} | undefined;
if (!skip) {
  before(async () => { releaseHeavy = await acquireHeavy('voice.slow'); shared = await buildSharedDist(); }, {timeout: 40 * 60_000});
  after(() => { releaseHeavy(); if (shared) rmSync(shared.dir, {recursive: true, force: true}); });
}

describe('the voice stage in a real browser', {skip, timeout: 20 * 60_000}, () => {
  beforeEach(async () => { env = await createTestEnv(shared!.dist, {STUDIO_TEST_FAKE: '1', FAKE_SEC_PER_WORD: '0.05', FAKE_LOAD_DELAY: '0.6'}); ({srv, chrome, tabs} = env); });
  afterEach(async () => {
    for (const t of tabs) sawProblems.push(...t.consoleErrors.filter((e) => !/Failed to fetch|ERR_CONNECTION_REFUSED|EventSource|net::ERR|status of 4\d\d/.test(e)).map((e) => `console: ${e}`));
    await env.dispose();
  });

  test('generate, watch the engine and the job agree, audition, re-roll, select, split, join, reuse a kept take, make the listening sample', {timeout: 8 * 60_000}, async () => {
    const id = await draft('Voice browser', 9);
    const t = await open(`/?voice=${id}`);
    await waitFor(t, sel('voice-screen'));
    assert.deepEqual(await statuses(t), ['b1:none', 'b2:none', 'b3:none']);
    assert.equal(await attr(t, sel('engine-state'), 'data-activity'), 'stopped');
    assert.match(await text(t, sel('estimate-total')), /Time: not measured yet/);
    await shot('1-before')();

    // generate everything; while a block is being generated the engine says so too
    await t.click(sel('generate-all'));
    await t.waitFor(`document.querySelector('[data-testid=block-b1-job]')?.dataset.state === 'running' && document.querySelector('[data-testid=block-b1-job-step]')?.innerText === 'generating speech'`, 30000, 'block b1 generating');
    const during = await t.eval<{act: string; summary: string; chip: string; elapsed: string}>(`({act: document.querySelector('[data-testid=engine-state]').dataset.activity, summary: document.querySelector('[data-testid=engine-summary]').innerText, chip: document.querySelector('[data-testid=engine-chip]').innerText, elapsed: document.querySelector('[data-testid=block-b1-job-elapsed]')?.innerText ?? ''})`);
    assert.equal(during.act, 'generating');
    assert.match(during.summary, /voice model is loaded and generating block b1/);
    assert.match(during.chip, /Generating/);
    assert.match(during.elapsed, /so far/);
    assert.equal(await attr(t, sel('voice-screen'), 'data-busy'), 'yes');
    assert.equal(await t.eval('document.querySelector("[data-testid=generate-all]").disabled'), true, 'a second start waits for the first');
    await shot('2-generating')();
    await t.waitFor(`[...document.querySelectorAll('[data-testid^=block-][data-status]')].every((e) => e.dataset.status === 'fresh')`, 60000, 'every block narrated');
    assert.equal(await attr(t, sel('voice-screen'), 'data-busy'), 'no');
    for (const b of ['b1', 'b2', 'b3']) assert.equal(await attr(t, sel(`take-${b}-1`), 'data-selected'), 'yes');
    // each take is playable: its address serves audio
    const src = await attr(t, sel('take-b1-1-audio'), 'src');
    assert.equal(await t.eval<number>(`fetch(${JSON.stringify(src)}).then((r) => r.status)`), 200);
    assert.equal(await t.eval<string>(`fetch(${JSON.stringify(src)}).then((r) => r.headers.get('content-type'))`), 'audio/wav');
    await shot('3-narrated')();

    // a measured basis now exists: an estimate for the next block of a different size is a range with its basis said
    const v = (await call('GET', `/api/episodes/${id}/voice`)).json;
    assert.equal(v.jobs.length, 3);

    // re-roll one block: a new take, the selected one is untouched, then choose it
    await t.click(sel('block-b1-reroll'));
    await waitFor(t, sel('take-b1-2'));
    await t.waitFor(`document.querySelector('[data-testid=voice-screen]').dataset.busy === 'no'`, 30000, 'the re-roll to finish');
    assert.equal(await attr(t, sel('take-b1-1'), 'data-selected'), 'yes');
    assert.equal(await attr(t, sel('take-b1-2'), 'data-selected'), 'no');
    assert.equal(await attr(t, sel('block-b1'), 'data-status'), 'fresh');
    await t.click(sel('take-b1-2-use'));
    await t.waitFor(`document.querySelector('[data-testid=take-b1-2]')?.dataset.selected === 'yes'`, 15000, 'take 2 selected');
    assert.equal(await attr(t, sel('take-b1-1'), 'data-selected'), 'no');
    assert.match(await text(t, sel('voice-note')), /Take 2 of b1 is selected\. Nothing was regenerated\./);
    assert.deepEqual(await statuses(t), ['b1:fresh', 'b2:fresh', 'b3:fresh']);

    // split a block: the explanation first, then the change
    await t.click(sel('split-b2-s4'));
    await waitFor(t, sel('edit-preview'));
    const lines = await text(t, sel('edit-lines'));
    assert.match(lines, /Before: b2 \(s4 to s6\)\. After: b2 \(s4\) and b4 \(s5 and s6\)\./);
    assert.match(lines, /Earlier takes of b2 \(1\) are kept/);
    assert.match(lines, /b1, b3 are not affected/);
    assert.deepEqual(await statuses(t), ['b1:fresh', 'b2:fresh', 'b3:fresh'], 'previewing changes nothing');
    await shot('4-split-preview')();
    await t.click(sel('edit-apply'));
    await t.waitFor(`document.querySelectorAll('[data-testid^=block-][data-status]').length === 4`, 15000, 'four blocks');
    assert.deepEqual(await statuses(t), ['b1:fresh', 'b2:stale', 'b4:none', 'b3:fresh']);
    assert.match(await text(t, sel('take-b2-1-why')), /Made when this block held s4, s5, s6; it holds s4 now\./);
    assert.equal(await attr(t, sel('take-b2-1'), 'data-compatible'), 'no');
    assert.equal(await t.eval('!!document.querySelector("[data-testid=take-b2-1-use]")'), false, 'a take for other lines cannot be chosen');
    const revs = (await call('GET', `/api/episodes/${id}/revisions`)).json.revisions;
    assert.equal(revs[0].kind, 'blocks-edit');

    // join them again: the take that was kept is offered, and using it generates nothing
    const jobsBefore = (await call('GET', `/api/jobs?episode=${id}`)).json.jobs.length;
    await t.click(sel('merge-b2'));
    await waitFor(t, sel('edit-preview'));
    assert.match(await text(t, sel('edit-lines')), /b2: a saved take \(take 1\) was made for exactly these lines/);
    await t.click(sel('edit-apply'));
    await t.waitFor(`document.querySelectorAll('[data-testid^=block-][data-status]').length === 3`, 15000, 'three blocks again');
    assert.equal(await attr(t, sel('block-b2'), 'data-status'), 'fresh', 'the kept take is the selected one again, so the earlier version is recovered');
    assert.equal((await call('GET', `/api/jobs?episode=${id}`)).json.jobs.length, jobsBefore, 'nothing was generated');

    // the listening sample
    assert.equal(await t.eval('document.querySelector("[data-testid=sample-make]").disabled'), false);
    await t.click(sel('sample-make'));
    await t.waitFor(`document.querySelector('[data-testid=sample-audio]') && document.querySelector('[data-testid=sample-panel]').dataset.fresh === 'yes'`, 60000, 'the sample');
    const sampleSrc = await attr(t, sel('sample-audio'), 'src');
    assert.equal(await t.eval<number>(`fetch(${JSON.stringify(sampleSrc)}).then((r) => r.status)`), 200);
    await shot('5-sample')();
    assert.deepEqual(tabs[0].failedRequests, []);
  });

  test('cancelling stops the work, releases the engine and keeps nothing half-made; a failed save elsewhere stops the Voice stage from opening', {timeout: 5 * 60_000}, async () => {
    const id = await draft('Voice cancel', 6);
    const t = await open(`/?voice=${id}`);
    await waitFor(t, sel('voice-screen'));
    await t.click(sel('generate-all'));
    await t.waitFor(`document.querySelector('[data-testid=block-b1-job-step]')?.innerText === 'generating speech'`, 30000, 'generating');
    await t.click(sel('cancel-all'));
    await t.waitFor(`document.querySelector('[data-testid=voice-screen]').dataset.busy === 'no'`, 30000, 'idle after the cancel');
    await t.waitFor(`document.querySelector('[data-testid=engine-state]').dataset.worker === 'none'`, 15000, 'the page to show the worker stopped (it learns of it without a reload)');
    assert.equal(await attr(t, sel('engine-state'), 'data-activity'), 'stopped');
    assert.deepEqual(await statuses(t), ['b1:none', 'b2:none']);
    assert.equal(await t.eval('document.querySelectorAll("[data-testid^=take-]").length'), 0, 'no half-made take');
    await waitFor(t, sel('block-b1-job-retry'));
    assert.match(await text(t, sel('block-b1-job')), /Cancelled/);
    await shot('6-cancelled')();
    // retry the cancelled step, then let it finish
    await t.click(sel('block-b1-job-retry'));
    await t.waitFor(`document.querySelector('[data-testid=block-b1]')?.dataset.status === 'fresh'`, 60000, 'b1 narrated after the retry');

    // from the editor: an edit that cannot be saved keeps the editor open and starts nothing
    const t2 = await open(`/?episode=${id}`);
    await t2.waitFor('document.querySelector("#f-text")', 20000, 'the editor');
    const jobsBefore = (await call('GET', `/api/jobs?episode=${id}`)).json.jobs.length;
    writeFileSync(env.w.faultFile, '1');
    try {
      await t2.fill('#f-text', 'A different first sentence that will not save.');
      await t2.click(sel('stage-5'));
      await t2.waitFor('document.querySelector("[data-testid=rebuild-note]")', 20000, 'the notice');
      assert.match(await text(t2, sel('rebuild-note')), /The Voice stage was not opened\. Your latest edits could not be saved/);
      assert.equal(await t2.eval('location.search.includes("voice=")'), false, 'the editor is still open');
    } finally { rmSync(env.w.faultFile, {force: true}); }
    assert.equal((await call('GET', `/api/jobs?episode=${id}`)).json.jobs.length, jobsBefore, 'nothing was queued');
    // once saving works again, opening the Voice stage saves what was kept and uses the saved text
    await t2.click(sel('stage-5'));
    await waitFor(t2, sel('voice-screen'));
    assert.match(await text(t2, sel('seg-s1')), /A different first sentence that will not save\./);
    assert.equal(await attr(t2, sel('block-b1'), 'data-status'), 'stale', 'the take was made for the earlier wording');
  });

  test('the page makes no problems of its own', () => {
    assert.deepEqual(sawProblems, []);
  });
});
