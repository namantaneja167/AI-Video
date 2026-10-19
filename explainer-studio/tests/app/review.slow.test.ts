// Browser acceptance for Phase 7 (the Review stage): a real browser drives the real app on a temporary workspace whose audio, render and probe
// workers are the test fakes (the render is a real small MP4 carrying the real mastered mix, so the page plays a real file). Run with
// STUDIO_SLOW=1 (npm run test:slow). STUDIO_SHOTS=<dir> keeps screenshots. Every sign-off, play and approval here is an explicitly SIMULATED
// person's action made by clicking, in a temporary workspace; the persistent demo workspace is never opened and nothing in the product
// does any of these by itself.
import assert from 'node:assert/strict';
import {existsSync, mkdirSync, readFileSync, readdirSync, rmSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
import {after, afterEach, before, beforeEach, describe, test} from 'node:test';
import {acquireHeavy} from '../heavy-lock.ts';
import {buildSharedDist, createTestEnv, type Child, type Chrome, type Tab, type TestEnv} from './harness.ts';
import {sel_ as sel, waitFor} from './planner-scenario.ts';

const skip = process.env.STUDIO_SLOW ? false : 'set STUDIO_SLOW=1 to run the browser tests';
const SHOTS = process.env.STUDIO_SHOTS;
const EP = 'context-window';

let env: TestEnv;
let srv: Child;
let chrome: Chrome;
let tabs: Tab[] = [];
const sawProblems: string[] = [];
const call = async (method: string, path: string, body?: unknown) => {
  const res = await fetch(srv.url(path), {method, headers: {cookie: `studio_token=${srv.token}`, 'x-studio': '1', 'content-type': 'application/json', connection: 'close'}, body: body === undefined ? undefined : JSON.stringify(body)});
  return {status: res.status, json: (await res.json().catch(() => null)) as any};
};
const shot = (name: string) => async () => { if (SHOTS) { mkdirSync(SHOTS, {recursive: true}); await tabs[0].screenshot(join(SHOTS, `phase7-${name}.png`)); } };
const open = async (path: string): Promise<Tab> => {
  const t = await chrome.tab();
  tabs.push(t);
  await t.viewport(1360, 1000, 1);
  await t.goto(srv.url(`/?token=${srv.token}`));
  await t.waitFor('document.querySelector(".ttl")', 30000, 'the app to appear');
  await t.goto(srv.url(path));
  await t.waitFor('document.querySelector(".ttl")', 30000, 'the page to appear');
  return t;
};
const text = (t: Tab, q: string) => t.eval<string>(`document.querySelector(${JSON.stringify(q)})?.innerText ?? ''`);
const attr = (t: Tab, q: string, a: string) => t.eval<string | null>(`document.querySelector(${JSON.stringify(q)})?.getAttribute(${JSON.stringify(a)}) ?? null`);
/** Click Start in the open plan dialog (once its plan has loaded) and wait until a new video is in the list and nothing is running. */
const startAndWait = async (t: Tab, what: string) => {
  await t.waitFor(`(() => { const b = document.querySelector('[data-testid=plan-start]'); return !!b && !b.disabled; })()`, 30000, 'the plan to load and Start to be offered');
  const n = await t.eval<number>(`document.querySelectorAll('[data-testid^=video-]').length`);
  await t.click(sel('plan-start'));
  await t.waitFor(`document.querySelectorAll('[data-testid^=video-]').length > ${n} && document.querySelector('[data-testid=review-screen]')?.dataset.busy === 'no'`, 180_000, `${what} to finish`);
};

let releaseHeavy = () => {};
let shared: {dir: string; dist: string} | undefined;
if (!skip) {
  before(async () => { releaseHeavy = await acquireHeavy('review.slow'); shared = await buildSharedDist(); }, {timeout: 40 * 60_000});
  after(() => { releaseHeavy(); if (shared) rmSync(shared.dir, {recursive: true, force: true}); });
}

describe('the review stage in a real browser', {skip, timeout: 25 * 60_000}, () => {
  beforeEach(async () => { env = await createTestEnv(shared!.dist, {STUDIO_TEST_FAKE: '1', FAKE_RENDER_REAL: '1', FAKE_SEC_PER_WORD: '0.02'}); ({srv, chrome, tabs} = env); });
  afterEach(async () => {
    for (const t of tabs) sawProblems.push(...t.consoleErrors.filter((e) => !/Failed to fetch|ERR_CONNECTION_REFUSED|EventSource|net::ERR|status of 4\d\d/.test(e)).map((e) => `console: ${e}`));
    await env.dispose();
  });

  test('draft, final, review of the exact file, playback, notes, checks, confirmations, approval and export', {timeout: 12 * 60_000}, async () => {
    const t = await open(`/?review=${EP}`);
    await waitFor(t, sel('review-screen'));
    assert.match(await text(t, sel('review-limits')), /record that you did it/);
    assert.match(await text(t, sel('review-limits')), /cannot find a word the voice dropped/);
    await shot('1-before')();

    // ---- a draft video, labelled as a draft
    await t.click(sel('make-draft'));
    await waitFor(t, sel('plan-dialog'));
    assert.equal(await attr(t, sel('plan-dialog'), 'aria-label'), 'Make a draft video');
    assert.match(await text(t, sel('plan-dialog')), /unmastered mix.*never be approved or exported/);
    await startAndWait(t, 'the draft build');
    await t.waitFor(`document.querySelector('[data-testid^=video-][data-kind=draft]')`, 30000, 'the draft in the list');
    await t.click('[data-testid^=video-][data-kind=draft] .rv-vbtn');
    await t.waitFor(`document.querySelector('[data-testid=review-player]')?.dataset.kind === 'draft'`, 15000, 'the draft selected');
    assert.match(await text(t, sel('video-banner')), /DRAFT · not mastered · can never be approved/);
    assert.match(await text(t, sel('draft-not-approvable')), /never be approved or exported/);
    assert.equal(await t.eval(`!!document.querySelector('[data-testid=approve-open]')`), false, 'a draft has no approve button');
    await shot('2-draft')();

    // ---- the final video, and a review round on that exact file
    await t.click(sel('make-final'));
    await waitFor(t, sel('plan-dialog'));
    await startAndWait(t, 'the final build');
    await t.click('[data-testid^=video-][data-kind=final] .rv-vbtn'); // the newest final is first in the list
    await t.waitFor(`document.querySelector('[data-testid=review-player]')?.dataset.kind === 'final'`, 30000, 'the final selected');
    assert.match(await text(t, sel('video-banner')), /FINAL · mastered/);
    await waitFor(t, sel('no-round'));
    await t.click(sel('open-round'));
    await t.waitFor(`document.querySelector('[data-testid=coverage]')`, 15000, 'the round to start');

    // the page plays the file the review is bound to: the same bytes, the same SHA-256
    const bound = await attr(t, `${sel('video-banner')} code`, 'title');
    const played = await t.eval<{src: string; sha: string; w: number; d: number}>(`(async () => { const v = document.querySelector('[data-testid=review-video]'); await new Promise((r) => v.readyState >= 1 ? r() : v.addEventListener('loadedmetadata', r, {once: true})); const b = await (await fetch(v.currentSrc)).arrayBuffer(); const h = [...new Uint8Array(await crypto.subtle.digest('SHA-256', b))].map((x) => x.toString(16).padStart(2, '0')).join(''); return {src: v.currentSrc, sha: h, w: v.videoWidth, d: v.duration}; })()`);
    assert.equal(played.sha, bound, 'the video element plays exactly the file whose hash the banner shows');
    assert.match(played.src, new RegExp(`/media/render/${EP}/\\d+\\.mp4$`));
    assert.equal(played.w, 1080);
    assert.ok(played.d > 5);

    // ---- SIMULATED: a person plays it all with the sound on, at phone size
    await t.click(sel('phone-toggle'));
    assert.equal(await attr(t, sel('phone-toggle'), 'aria-pressed'), 'true');
    await t.eval(`(() => { const v = document.querySelector('[data-testid=review-video]'); v.muted = false; v.volume = 1; void v.play(); })()`);
    assert.equal(await attr(t, sel('coverage'), 'data-complete'), 'no', 'nothing is recorded as complete before it has been played');
    await t.waitFor(`document.querySelector('[data-testid=review-video]').ended`, 120_000, 'the video to play to its end');
    await t.waitFor(`document.querySelector('[data-testid=coverage]')?.dataset.complete === 'yes'`, 30000, 'playback coverage to be complete');
    assert.ok(Number(await text(t, sel('heard-sec'))) >= played.d - 1);
    assert.match(await text(t, sel('coverage')), /at phone size with sound: [1-9]/);
    await shot('3-played')();

    // ---- notes: at the playhead, edited, resolved, reopened
    await t.eval(`document.querySelector('[data-testid=review-video]').currentTime = 3`);
    await t.click(sel('review-note-add'));
    await waitFor(t, sel('review-note-composer'));
    await t.click(sel('review-note-text'));
    await t.send('Input.insertText', {text: 'The pause here feels long'});
    await t.click(sel('review-note-save'));
    await t.waitFor(`document.querySelector('[data-testid^=note-n]')`, 15000, 'the note to appear');
    const noteId = (await t.eval<string>(`document.querySelector('[data-testid^=note-n][data-status=open]').dataset.testid`)).replace('note-', '');
    assert.match(await text(t, sel(`note-${noteId}`)), /round \d+, final \(mastered\) video/);
    assert.equal(await attr(t, sel(`note-${noteId}`), 'data-this-video'), 'yes');
    assert.match(await text(t, sel('approve-blockers')), /1 note is still open/);
    await t.click(sel(`note-${noteId}-edit`));
    await t.fill(sel(`note-${noteId}-edit-text`), 'The pause here is too long');
    await t.click(sel(`note-${noteId}-edit-save`));
    await t.waitFor(`document.querySelector('[data-testid=note-${noteId}]')?.innerText.includes('too long')`, 15000, 'the edited text');
    await t.click(sel(`note-${noteId}-resolve`));
    await t.waitFor(`!document.querySelector('[data-testid=approve-blockers]')?.innerText.includes('note is still open')`, 15000, 'the note to stop blocking');
    await t.eval(`document.querySelector('details.more summary')?.click()`);

    // ---- the production checks, with their kinds; the differences the author confirms
    await t.click(sel('run-checks'));
    await t.waitFor(`document.querySelector('[data-testid=checks-verdict]')`, 120_000, 'the checks to finish');
    assert.equal(await attr(t, sel('check-narration.words'), 'data-kind'), 'manual');
    assert.equal(await attr(t, sel('check-narration.words'), 'data-status'), 'unchecked');
    assert.equal(await attr(t, sel('check-file.hash'), 'data-status'), 'pass');
    assert.equal(await attr(t, sel('check-mastering.loudness'), 'data-status'), 'pass');
    assert.equal(await attr(t, sel('check-custom.scenes'), 'data-kind'), 'partial');
    assert.match(await text(t, sel('check-narration.words')), /cannot show that a word was left out/);
    const diffs = await t.eval<string[]>(`[...document.querySelectorAll('[data-testid^=diff-][data-confirmed=no]')].map((e) => e.dataset.testid)`);
    for (const d of diffs) { await t.click(sel(`${d}-confirm`)); await t.waitFor(`document.querySelector('[data-testid=${d}]').dataset.confirmed === 'yes'`, 15000, `${d} confirmed`); }
    if (diffs.length) {
      await t.click(sel('run-checks'));
      await t.waitFor(`document.querySelector('[data-testid=checks-verdict]')?.innerText === 'No failures'`, 120_000, 'the checks to pass once the differences are confirmed');
    }
    assert.equal(await text(t, sel('checks-verdict')), 'No failures');
    await shot('4-checks')();

    // ---- approval is not possible until the person ticks the four confirmations; the page ticks nothing
    assert.equal(await t.eval(`[...document.querySelectorAll('[data-testid^=signoff-]')].every((e) => !e.checked)`), true, 'nothing is pre-ticked');
    assert.match(await text(t, sel('approve-blockers')), /confirmations are not ticked/);
    assert.equal(await t.eval(`document.querySelector('[data-testid=approve-open]').disabled`), true);
    for (const item of ['listened', 'watchedPhoneSize', 'customScenesReviewed', 'notesResolved']) await t.click(sel(`signoff-${item}`)); // SIMULATED
    await t.waitFor(`document.querySelector('[data-testid=approve-ready]')`, 15000, 'approval to be possible');
    assert.equal(await t.eval(`document.querySelector('[data-testid=approve-open]').disabled`), false);
    await t.click(sel('approve-open'));
    await waitFor(t, sel('approve-confirm-box'));
    assert.match(await text(t, sel('approve-confirm-box')), /Changing a caption, a font, the sound mix.*voids the approval. Notes do not/);
    await shot('5-approve')();
    await t.click(sel('approve-confirm'));
    await t.waitFor(`document.querySelector('[data-testid=review-approval]')?.dataset.approval === 'valid'`, 15000, 'approval to be recorded');
    assert.match(await text(t, sel('approval-state')), new RegExp(`file SHA-256 ${bound!.slice(0, 12)}`));

    // ---- export: the exact bytes, verified before and after
    assert.equal(await t.eval(`document.querySelector('[data-testid=export-run]').disabled`), false);
    await t.click(sel('export-run'));
    await waitFor(t, sel('export-result'));
    const r = await text(t, sel('export-result'));
    assert.equal((r.match(new RegExp(bound!.slice(0, 12), 'g')) ?? []).length, 3, 'the hash before, of the copy and after are all the approved one');
    const root = join(env.w.projectRoot, 'exports', EP);
    const pkg = readdirSync(root)[0];
    assert.equal(createHash('sha256').update(readFileSync(join(root, pkg, `${EP}.mp4`))).digest('hex'), bound);
    await shot('6-exported')();

    // ---- a change to what the video depends on voids the approval, and the page says so
    const ep = (await call('GET', `/api/episodes/${EP}`)).json;
    ep.doc.narration.segments[0].text += ' Really.';
    assert.equal((await call('PUT', `/api/episodes/${EP}`, {doc: ep.doc, baseSeq: ep.seq, tab: 'other'})).status, 200);
    await t.waitFor(`document.querySelector('[data-testid=review-approval]')?.dataset.approval === 'void'`, 20000, 'approval to show as void');
    assert.match(await text(t, sel('approval-state')), /Approval is void\. What changed: .*content/);
    assert.equal(await t.eval(`document.querySelector('[data-testid=export-run]').disabled`), true);
    assert.equal(existsSync(join(root, pkg, `${EP}.mp4`)), true, 'the earlier package is left alone');
  });

  test('a note keeps its original context when the words change, is flagged for reassessment, and can be confirmed', {timeout: 6 * 60_000}, async () => {
    const t = await open(`/?review=${EP}`);
    await waitFor(t, sel('review-screen'));
    await t.click(sel('make-draft'));
    await waitFor(t, sel('plan-dialog'));
    await startAndWait(t, 'the draft build');
    await t.waitFor(`document.querySelector('[data-testid^=video-][data-kind=draft]')`, 30000, 'the draft');
    await t.click('[data-testid^=video-][data-kind=draft] .rv-vbtn');
    await t.waitFor(`document.querySelector('[data-testid=review-player]')?.dataset.kind === 'draft'`, 15000, 'the draft selected');
    await t.click(sel('open-round'));
    await waitFor(t, sel('review-note-add'));
    await t.click(sel('review-note-add'));
    await t.click(sel('review-note-text'));
    await t.send('Input.insertText', {text: 'Please say this more slowly'});
    await t.click(sel('review-note-save'));
    await t.waitFor(`document.querySelector('[data-testid^=note-n]')`, 15000, 'the note');
    const id = (await t.eval<string>(`document.querySelector('[data-testid^=note-n]').dataset.testid`)).replace('note-', '');
    const seg = (await call('GET', `/api/episodes/${EP}/review`)).json.notes.find((n: any) => n.note.id === id).note.anchor.segment as string;
    const original = (await call('GET', `/api/episodes/${EP}/review`)).json.notes.find((n: any) => n.note.id === id).note.context.segmentText as string;
    assert.equal(await attr(t, sel(`note-${id}`), 'data-state'), 'current');

    // another tab edits the words of that segment
    const ep = (await call('GET', `/api/episodes/${EP}`)).json;
    ep.doc.narration.segments.find((s: any) => s.id === seg).text = `${original.replace(/\.$/, '')} indeed.`;
    assert.equal((await call('PUT', `/api/episodes/${EP}`, {doc: ep.doc, baseSeq: ep.seq, tab: 'other'})).status, 200);
    await t.waitFor(`document.querySelector('[data-testid=note-${id}]')?.dataset.state === 'reassess'`, 20000, 'the note to be flagged');
    assert.match(await text(t, sel(`note-${id}-flag`)), /Needs reassessment/);
    await t.eval(`document.querySelector('[data-testid=note-${id}] details summary').click()`);
    assert.ok((await text(t, sel(`note-${id}`))).includes(original), 'the words it was written about are shown exactly as they were');
    await shot('7-reassess')();
    await t.click(sel(`note-${id}-reassess`));
    await t.waitFor(`document.querySelector('[data-testid=note-${id}]')?.dataset.state === 'current'`, 15000, 'the note to be current again');
    assert.ok((await text(t, sel(`note-${id}`))).includes(original), 'the original context is still there after confirming');
  });

  test('the page reported no console errors or failed requests', () => {
    assert.deepEqual(sawProblems, []);
  });
});
