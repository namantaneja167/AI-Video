// Browser acceptance for Phase 5 (planning, research, script, storyboard, manual ChatGPT import): a real browser drives the real
// app on a temporary workspace. Run with STUDIO_SLOW=1 (npm run test:slow). STUDIO_SHOTS=<dir> keeps screenshots.
// Everything here lives in temp directories this file creates and removes; the persistent demo workspace is never opened.
import assert from 'node:assert/strict';
import {mkdirSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import {after, afterEach, before, beforeEach, describe, test} from 'node:test';
import {acquireHeavy} from '../heavy-lock.ts';
import {buildSharedDist, createTestEnv, type Child, type Chrome, type Tab, type TestEnv} from './harness.ts';
import {createEpisodeThroughUi, paste, sel_ as sel, waitFor, type Content} from './planner-scenario.ts';
import {READY_CONTENT, applyAndAdjustThroughUi} from './scenes-scenario.ts';

const skip = process.env.STUDIO_SLOW ? false : 'set STUDIO_SLOW=1 to run the browser tests';
const SHOTS = process.env.STUDIO_SHOTS;

let env: TestEnv;
let srv: Child;
let chrome: Chrome;
let tabs: Tab[] = [];
const sawProblems: string[] = [];
const call = async (method: string, path: string, body?: unknown) => {
  const res = await fetch(srv.url(path), {method, headers: {cookie: `studio_token=${srv.token}`, 'x-studio': '1', 'content-type': 'application/json', connection: 'close'}, body: body === undefined ? undefined : JSON.stringify(body)});
  return {status: res.status, json: (await res.json().catch(() => null)) as any};
};
const shot = (prefix: string) => async (name: string) => { if (SHOTS) { mkdirSync(SHOTS, {recursive: true}); await tabs[0].screenshot(join(SHOTS, `phase5-${prefix}-${name}.png`)); } };
const open = async (path = '/'): Promise<Tab> => {
  const t = await chrome.tab();
  tabs.push(t);
  await t.viewport(1280, 800, 1);
  await t.goto(srv.url(`/?token=${srv.token}`));
  await t.waitFor('document.querySelector(".ttl")', 30000, 'the app to appear');
  if (path !== '/') { await t.goto(srv.url(path)); await t.waitFor('document.querySelector(".ttl")', 30000, 'the page to appear'); }
  return t;
};

const CONTENT: Content = {
  title: 'What is a token?',
  audience: 'Curious beginners',
  objective: 'Know that a model reads text in pieces called tokens',
  durationMin: '1.5',
  researchBroken: JSON.stringify({studioPacket: 1, sources: [{title: 'Author outline'}], claims: [{text: 'A token is a piece of text.', kind: 'rumor'}]}, null, 2),
  research: JSON.stringify({studioPacket: 1, sources: [{title: 'Author outline', note: 'My own notes; no external source'}, {title: 'Placeholder guide', url: 'https://example.org/tokens', publisher: 'example.org', published: '2024-05-14', note: 'A placeholder address for this test'}], claims: [{text: 'A token is a piece of text a model reads.', kind: 'fact', sources: [1], evidence: 'Section 1', caveat: 'Pieces differ between models'}, {text: 'Viewers know what a model is.', kind: 'assumption'}, {text: 'Say "pieces of text" before "token".', kind: 'proposed-wording'}]}, null, 2),
  script: 'Models read text in small pieces. Those pieces are called tokens.\n\nA token is not always a word. Sometimes it is only part of one.\n\nEvery model can only hold so many tokens at once.',
  adjust: {row: 0, text: 'Models read text in small pieces, edited by the author.'},
  storyboard: JSON.stringify({studioPacket: 1, storyboard: {scenes: [{segments: [1, 2], sceneType: 'pip-cards', intention: 'Introduce tokens', mechanism: 'Two cards, one per idea', pip: ['Pip points at the first card']}, {segments: [3, 4], sceneType: 'custom', intention: 'Show a word breaking into pieces', mechanism: 'A word splits apart', pip: ['Pip tilts his head']}, {segments: [5], sceneType: 'timeline-animation', intention: 'The limit', mechanism: 'A bar fills', pip: []}]}}, null, 2),
};

let releaseHeavy = () => {};
let shared: {dir: string; dist: string} | undefined;
if (!skip) {
  before(async () => { releaseHeavy = await acquireHeavy('planner.slow'); shared = await buildSharedDist(); }, {timeout: 40 * 60_000});
  after(() => { releaseHeavy(); if (shared) rmSync(shared.dir, {recursive: true, force: true}); });
}

describe('planning in a real browser', {skip, timeout: 20 * 60_000}, () => {
  beforeEach(async () => { env = await createTestEnv(shared!.dist, {STUDIO_TEST_FAKE: '1'}); ({srv, chrome, tabs} = env); });
  afterEach(async () => {
    for (const t of tabs) sawProblems.push(...t.consoleErrors.filter((e) => !/Failed to fetch|ERR_CONNECTION_REFUSED|EventSource|net::ERR|status of 422/.test(e)).map((e) => `console: ${e}`));
    await env.dispose();
  });

  test('a new episode goes from a pasted brief and script to an accepted script and storyboard, through the UI only', {timeout: 8 * 60_000}, async () => {
    const baseline = (await call('GET', '/api/episodes/context-window')).json;
    const t = await open();
    const seen = await createEpisodeThroughUi(t, CONTENT, shot('flow'));

    // the broken paste named its exact place and reason
    assert.match(seen.errorText, /claims\[0\]\.kind/);
    assert.match(seen.errorText, /one of "fact", "assumption", "proposed-wording".*"rumor"/);
    assert.match(seen.errorText, /Nothing was imported/);
    // the brief was ready to copy
    assert.match(seen.briefText, /Target length: about 1.5 minutes/);

    // what was stored
    const plan = (await call('GET', `/api/plans/${seen.planId}`)).json;
    assert.equal(plan.plan.sources.length, 2);
    assert.deepEqual(plan.plan.claims.map((c: any) => c.kind), ['fact', 'assumption', 'proposed-wording']);
    assert.equal(plan.plan.sources[1].checked, null, 'a link is recorded, never marked as checked by the app');
    assert.equal(plan.plan.sources[1].provenance.source, 'pasted text');
    assert.match(plan.plan.sources[1].provenance.sha256, /^[a-f0-9]{64}$/);
    assert.deepEqual(plan.episode.segments.map((s: any) => s.text), seen.rowsBeforeAccept.map((r) => r.trim()));
    assert.deepEqual(plan.plan.storyboard.map((s: any) => s.sceneType), ['pip-cards', 'custom', 'timeline-animation']);
    assert.deepEqual(plan.check.scenes.map((s: any) => s.state), ['incomplete', 'custom', 'unsupported']);
    assert.equal(plan.check.producible, false);
    assert.deepEqual(plan.imports.map((i: any) => i.state), ['accepted', 'accepted', 'accepted']);
    assert.deepEqual(seen.external, [], 'the page requested nothing outside this app');

    // the baseline episode is exactly as it was
    const after = (await call('GET', '/api/episodes/context-window')).json;
    assert.equal(after.docHash, baseline.docHash);
    assert.equal(after.seq, baseline.seq);

    // it persists and the address says where you are
    await t.goto(srv.url(`/?plan=${seen.planId}&tab=storyboard`));
    await waitFor(t, sel('scene-sb1'));
    await t.goto(srv.url('/'));
    await waitFor(t, '[data-screen=episodes]');
    assert.equal(await t.eval('document.querySelectorAll("li[data-has-plan]").length'), 2, 'with two episodes the list is the landing page');

    // the script editor opens on the new episode, with the existing History showing where the text came from
    await t.click(sel(`open-editor-${seen.planId}`));
    await t.waitFor('document.querySelector("[data-segment=s1]")', 20000, 'the editor outline');
    assert.equal(await t.eval('document.querySelector(".ttl").innerText'), CONTENT.title);
    assert.equal(await t.eval('document.querySelectorAll("[data-testid^=stage-]").length'), 8, 'Idea, Research, Voice, Storyboard, Scenes, Review, Render and Export link (the last two lead into Review); Script is where you are');
    await t.click(sel('history-button'));
    await t.waitFor('document.querySelector("[data-testid=revision-row]")', 10000, 'history rows');
    const row = await t.eval<string>('document.querySelector("[data-testid=revision-row]").innerText');
    assert.match(row, /Episode created/);
    await t.eval('document.querySelector("[data-testid=revision-row] .linkish").click()');
    await t.waitFor('document.querySelector(".rvd")?.innerText.includes("Imported from pasted text")', 10000, 'the provenance label in the revision detail');
    await shot('flow')('10-history');
    assert.deepEqual(tabs[0].failedRequests.filter((f) => !/\/imports$/.test(f)), [], 'no failed requests except the one deliberate invalid paste');
    assert.equal(tabs[0].failedRequests.filter((f) => /\/imports$/.test(f)).length, 1);
  });

  test('replacing an accepted script needs a confirmation in the page, and the earlier text stays in History', {timeout: 5 * 60_000}, async () => {
    const made = (await call('POST', '/api/plans', {title: 'Replace check', audience: 'a', objective: 'o'})).json;
    const id = made.plan.id;
    const first = (await call('POST', `/api/plans/${id}/imports`, {text: 'The first line is here. The second line is here. The third line is here.', via: 'paste'})).json;
    const ok = await call('POST', `/api/plans/${id}/imports/${first.import.id}/accept`, {selection: {sources: [], claims: [], script: first.import.proposal.script, storyboard: false, confirmReplace: false}, basePlanSeq: first.planSeq, baseEpisodeSeq: null});
    assert.equal(ok.status, 200);
    const t = await open(`/?plan=${id}&tab=script`);
    await waitFor(t, sel('script-accepted'));
    await t.click(sel('open-import'));
    await paste(t, sel('import-text'), 'The first line is here. The second line, reworded. A brand new third line.');
    await t.click(sel('import-check'));
    await waitFor(t, sel('confirm-box'));
    assert.equal(await t.eval('document.querySelector("[data-testid=import-accept]").disabled'), true, 'cannot accept before confirming');
    assert.match(await t.eval<string>('document.querySelector("[data-testid=confirm-box]").innerText'), /Replace the script: 2 of 3 lines change/);
    assert.deepEqual(await t.eval<string[]>('[...document.querySelectorAll("[data-testid^=seg-row-] .chip")].map((c) => c.innerText).filter((x) => /now|new/.test(x))'), ['same as now', 'differs from now', 'differs from now']);
    await shot('replace')('1-confirm');
    await t.click(sel('confirm-replace'));
    await t.click(sel('import-accept'));
    await t.waitFor('!document.querySelector("[data-testid=import-dialog]")', 15000, 'dialog to close');
    const after = (await call('GET', `/api/episodes/${id}`)).json;
    assert.deepEqual(after.doc.narration.segments.map((s: any) => s.text), ['The first line is here.', 'The second line, reworded.', 'A brand new third line.']);
    const revs = (await call('GET', `/api/episodes/${id}/revisions`)).json.revisions;
    assert.deepEqual(revs.map((r: any) => r.kind).reverse(), ['create', 'script-import']);
  });

  test('"Decide later" and "Reject this import" in the page leave the episode, its history and the plan untouched', {timeout: 5 * 60_000}, async () => {
    const made = (await call('POST', '/api/plans', {title: 'Cancel check', audience: 'a', objective: 'o'})).json;
    const id = made.plan.id;
    const first = (await call('POST', `/api/plans/${id}/imports`, {text: 'The first line is here. The second line is here.', via: 'paste'})).json;
    await call('POST', `/api/plans/${id}/imports/${first.import.id}/accept`, {selection: {sources: [], claims: [], script: first.import.proposal.script, storyboard: false, confirmReplace: false}, basePlanSeq: first.planSeq, baseEpisodeSeq: null});
    const state = async () => {
      const ep = (await call('GET', `/api/episodes/${id}`)).json;
      const plan = (await call('GET', `/api/plans/${id}`)).json;
      const revs = (await call('GET', `/api/episodes/${id}/revisions`)).json.revisions.length;
      return JSON.stringify({epSeq: ep.seq, epHash: ep.docHash, revs, planSeq: plan.seq, plan: plan.plan});
    };
    const before = await state();
    const t = await open(`/?plan=${id}&tab=script`);
    await waitFor(t, sel('script-accepted'));
    await t.click(sel('open-import'));
    await paste(t, sel('import-text'), 'The first line is here. A different second line.');
    await t.click(sel('import-check'));
    await waitFor(t, sel('confirm-box'));
    await t.click(sel('confirm-replace'));
    await t.click(sel('import-later'));
    await t.waitFor('!document.querySelector("[data-testid=import-dialog]")', 15000, 'dialog to close');
    assert.equal(await state(), before, 'closing the review changed nothing');
    await t.goto(srv.url(`/?plan=${id}&tab=script`));
    await waitFor(t, sel('pending-imports'));
    await t.click('[data-testid^=review-import-]');
    await waitFor(t, sel('import-state'));
    assert.equal(await t.eval('document.querySelector("[data-testid=import-state]").innerText'), 'Proposed', 'still waiting after a reload');
    await t.click(sel('import-reject'));
    await t.waitFor('!document.querySelector("[data-testid=import-dialog]")', 15000, 'dialog to close');
    assert.equal(await state(), before, 'rejecting changed nothing');
    await t.click(sel('stage-1'));
    await waitFor(t, sel('imports-list'));
    assert.match(await t.eval<string>('document.querySelector("[data-testid=imports-list]").innerText'), /Not accepted/);
  });

  test('a planned scene moves from incomplete to ready when parameters that fit its type are added', {timeout: 5 * 60_000}, async () => {
    const made = (await call('POST', '/api/plans', {title: 'Ready check', audience: 'a', objective: 'o'})).json;
    const id = made.plan.id;
    const text = JSON.stringify({studioPacket: 1, script: {segments: [{text: 'A model reads text.'}, {text: 'In small pieces.'}]}, storyboard: {scenes: [{segments: [1, 2], sceneType: 'pip-cards', intention: 'Introduce', mechanism: 'Two cards', pip: []}]}});
    const p = (await call('POST', `/api/plans/${id}/imports`, {text, via: 'paste'})).json;
    const ok = await call('POST', `/api/plans/${id}/imports/${p.import.id}/accept`, {selection: {sources: [], claims: [], script: p.import.proposal.script, storyboard: true, confirmReplace: false}, basePlanSeq: p.planSeq, baseEpisodeSeq: null});
    assert.equal(ok.status, 200, JSON.stringify(ok.json));
    const t = await open(`/?plan=${id}&tab=storyboard`);
    await waitFor(t, sel('scene-sb1'));
    assert.equal(await t.eval('document.querySelector("[data-testid=scene-sb1]").dataset.state'), 'incomplete');
    assert.match(await t.eval<string>('document.querySelector("[data-testid=storyboard-summary]").innerText'), /Not every planned scene is ready yet\. 0 of 1 planned scene is ready, 1 incomplete/);
    await t.eval('document.querySelector("[data-testid=scene-sb1] .linkish").click()');
    await waitFor(t, sel('scene-params'));
    await paste(t, sel('scene-params'), '{"title": "Tokens", "cards": [{"heading": "Text", "lines": []}]}');
    await t.click(sel('scene-save'));
    await waitFor(t, sel('form-error'));
    assert.match(await t.eval<string>('document.querySelector("[data-testid=form-error]").innerText'), /do not fit this scene type: params\.cards\.0/);
    assert.equal((await call('GET', `/api/plans/${id}`)).json.plan.storyboard[0].params ?? null, null, 'an invalid parameter set is not saved');
    await paste(t, sel('scene-params'), '{"title": "Tokens", "cards": [{"heading": "Text", "body": "A model reads text."}]}');
    await t.click(sel('scene-save'));
    await t.waitFor('document.querySelector("[data-testid=scene-sb1]")?.dataset.state === "ready"', 10000, 'the scene to become ready');
    assert.match(await t.eval<string>('document.querySelector("[data-testid=storyboard-summary]").innerText'), /Every planned scene is ready\. 1 of 1 planned scene is ready\./);
    await shot('ready')('1-ready');
    const after = (await call('GET', `/api/plans/${id}`)).json;
    assert.equal(after.check.producible, true);
    const blockers = (await call('GET', `/api/episodes/${id}/plan`)).json.blockers.map((b: any) => b.message) as string[];
    assert.deepEqual(blockers.filter((b) => /Storyboard|stand-in/.test(b)), ['The planned scenes are ready but have not been applied to this episode: it still has only its stand-in scene.']);
  });

  test('a plan edited in another tab shows up here, so a later save here does not overwrite it', {timeout: 5 * 60_000}, async () => {
    const made = (await call('POST', '/api/plans', {title: 'Conflict check', audience: 'a', objective: 'o'})).json;
    const id = made.plan.id;
    const t = await open(`/?plan=${id}&tab=research`);
    await waitFor(t, sel('add-source'));
    const cur = (await call('GET', `/api/plans/${id}`)).json;
    const other = await call('PUT', `/api/plans/${id}`, {plan: {...cur.plan, notes: 'Written in another tab'}, baseSeq: cur.seq, tab: 'other-tab'});
    assert.equal(other.status, 200);
    // this tab learns of it through the live event and shows the newer version before the author acts
    await t.waitFor(`document.querySelector('main.page').dataset.seq === '${other.json.seq}'`, 10000, 'the page to pick up the other tab’s save');
    await t.click(sel('add-source'));
    await t.fill(sel('source-title'), 'A source added here');
    await t.click(sel('source-save'));
    await waitFor(t, sel('source-src1'));
    const final = (await call('GET', `/api/plans/${id}`)).json;
    assert.equal(final.plan.notes, 'Written in another tab', 'the other tab’s change is kept');
    assert.equal(final.plan.sources.length, 1);
  });

  test('a link is shown as recorded, not fetched or verified; a bad link is refused with the field named', {timeout: 5 * 60_000}, async () => {
    const made = (await call('POST', '/api/plans', {title: 'Link check', audience: 'a', objective: 'o'})).json;
    const t = await open(`/?plan=${made.plan.id}&tab=research`);
    await waitFor(t, sel('add-source'));
    await t.click(sel('add-source'));
    await t.fill(sel('source-title'), 'A page');
    await t.fill(sel('source-url'), 'javascript:alert(1)');
    await t.click(sel('source-save'));
    await waitFor(t, sel('form-error'));
    assert.match(await t.eval<string>('document.querySelector("[data-testid=form-error]").innerText'), /url: must be an http or https link/);
    await t.fill(sel('source-url'), 'https://example.org/page');
    await t.fill(sel('source-date'), '2024-05-14');
    await t.click(sel('source-save'));
    await waitFor(t, sel('link-state'));
    assert.equal(await t.eval('document.querySelector("[data-testid=link-state]").innerText'), 'Link recorded · not fetched · not verified');
    assert.equal(await t.eval('!!document.querySelector("main a[href]")'), false, 'a saved link is text, not something the page can follow by accident');
    await t.click(sel('add-claim'));
    await t.fill(sel('claim-text'), 'A fact with no source');
    await t.click(sel('claim-save'));
    await waitFor(t, sel('research-warnings'));
    assert.match(await t.eval<string>('document.querySelector("[data-testid=research-warnings]").innerText'), /fact with no source/);
    await t.click(sel('check-src1'));
    await waitFor(t, sel('checked-chip'));
    assert.deepEqual((await call('GET', `/api/plans/${made.plan.id}`)).json.plan.sources[0].checked !== null, true, 'only the author’s own click marks a source as checked');
  });


  // ---- Phase 5B: applying the storyboard, and the Scenes step ----------------------------------------------------------------
  const draftWith = async (title: string, scenes: unknown[], scriptLines = ['A model reads text.', 'In small pieces.', 'Called tokens.', 'Only so many fit.']) => {
    const made = (await call('POST', '/api/plans', {title, audience: 'a', objective: 'o'})).json;
    const id = made.plan.id;
    const text = JSON.stringify({studioPacket: 1, script: {segments: scriptLines.map((t) => ({text: t}))}, storyboard: {scenes}});
    const p = (await call('POST', `/api/plans/${id}/imports`, {text, via: 'paste'})).json;
    const ok = await call('POST', `/api/plans/${id}/imports/${p.import.id}/accept`, {selection: {sources: [], claims: [], script: p.import.proposal.script, storyboard: true, confirmReplace: false}, basePlanSeq: p.planSeq, baseEpisodeSeq: null});
    assert.equal(ok.status, 200, JSON.stringify(ok.json));
    return id as string;
  };
  const TWO = [
    {segments: [1, 2], sceneType: 'pip-cards', intention: 'a', mechanism: 'two cards', pip: ['Pip points at the first card'], params: {cards: [{heading: 'Text', body: 'A model reads text.'}, {heading: 'Pieces', body: 'In small pieces.', at: {segment: 1, word: 'small'}}], actions: [{do: 'point', card: 0, at: {segment: 0, word: 'text'}}]}},
    {segments: [3, 4], sceneType: 'pip-cards', intention: 'b', mechanism: 'one card', pip: [], params: {cards: [{heading: 'Limit', body: 'Only so many fit.'}], actions: []}},
  ];

  test('a ready storyboard is previewed and applied through the page; the Scenes step shows a labelled estimate; narration, jobs and the baseline are untouched', {timeout: 10 * 60_000}, async () => {
    const baseline = (await call('GET', '/api/episodes/context-window')).json;
    const t = await open();
    const seen = await createEpisodeThroughUi(t, READY_CONTENT(), shot('flow5b'));
    assert.deepEqual((await call('GET', `/api/plans/${seen.planId}`)).json.check.producible, true);
    const before = (await call('GET', `/api/episodes/${seen.planId}`)).json;
    assert.equal(before.doc.scenes[0].id, 'storyboard-pending');
    const s = await applyAndAdjustThroughUi(t, seen.planId, shot('flow5b'));

    assert.equal(s.changesText.length, 3);
    assert.ok(s.changesText.every((x) => /^New sb\d Pip cards/.test(x)), s.changesText.join(' | '));
    assert.match(s.appliedChip, /^Applied /);
    assert.equal(s.previewLabel, 'Estimated timing · no audio · not a build');
    assert.equal(s.composition, true);
    assert.deepEqual(s.kinds, ['Reusable', 'Reusable', 'Reusable']);
    assert.match(s.notesText, /not connected to the animation/);
    assert.match(s.preflight, /nothing stands in the way/);
    assert.ok(s.rebuildSteps.every((x) => /would be rebuilt/.test(x)), s.rebuildSteps.join(' | '));

    const after = (await call('GET', `/api/episodes/${seen.planId}`)).json;
    assert.deepEqual(after.doc.scenes.map((x: any) => [x.id, x.type]), [['sb1', 'pip-cards'], ['sb2', 'pip-cards'], ['sb3', 'pip-cards']]);
    assert.equal(after.doc.scenes[0].params.cards[0].heading, 'The text', 'the card edit was saved');
    assert.deepEqual(after.doc.narration, before.doc.narration, 'the narration is exactly as accepted');
    const revs = (await call('GET', `/api/episodes/${seen.planId}/revisions`)).json.revisions.map((r: any) => r.kind);
    assert.ok(revs.includes('scenes-apply') && revs.indexOf('scenes-apply') >= 0, revs.join(','));
    assert.deepEqual((await call('GET', `/api/episodes/${seen.planId}/plan`)).json.blockers, []);
    assert.deepEqual((await call('GET', `/api/jobs?episode=${seen.planId}`)).json.jobs, [], 'nothing was started');
    assert.deepEqual(seen.external, []);
    const base2 = (await call('GET', '/api/episodes/context-window')).json;
    assert.equal(base2.docHash, baseline.docHash);
    assert.equal(base2.seq, baseline.seq);
  });

  test('an incomplete storyboard lists every problem and offers no apply; a change made elsewhere after the preview refuses the apply and keeps it', {timeout: 5 * 60_000}, async () => {
    const id = await draftWith('Apply refusal', [
      {segments: [1, 2], sceneType: 'pip-cards', intention: 'a', mechanism: 'm', pip: ['Pip waves'], params: {cards: [{heading: 'Text', at: {segment: 0, word: 'unicorn'}}]}},
      {segments: [3], sceneType: 'hologram-3d', intention: 'b', mechanism: 'm', pip: []},
      {segments: [4], sceneType: 'custom', intention: 'c', mechanism: 'm', pip: []},
    ]);
    const t = await open(`/?plan=${id}&tab=storyboard`);
    await waitFor(t, sel('apply-panel'));
    await t.click(sel('apply-preview'));
    await waitFor(t, sel('apply-problems'));
    const problems = await t.eval<string>('document.querySelector("[data-testid=apply-problems]").innerText');
    assert.match(problems, /moment is timed on the word "unicorn"/);
    assert.match(problems, /"hologram-3d" is not a scene type this app has/);
    assert.match(problems, /A custom scene has to be designed and built by a developer/);
    assert.equal(await t.eval('!!document.querySelector("[data-testid=apply-go]")'), false);
    await shot('apply')('1-problems');
    const ep = (await call('GET', `/api/episodes/${id}`)).json;
    assert.equal(ep.doc.scenes[0].id, 'storyboard-pending', 'nothing was applied');
    const refused = await call('POST', `/api/plans/${id}/apply`, {basePlanSeq: 1, baseEpisodeSeq: ep.seq, confirmReplace: true});
    assert.equal(refused.status, 409, 'a stale plan sequence is a conflict');

    // a complete storyboard on another draft; the episode is changed elsewhere after the preview
    const id2 = await draftWith('Apply conflict', TWO);
    const t2 = await open(`/?plan=${id2}&tab=storyboard`);
    await waitFor(t2, sel('apply-panel'));
    await t2.click(sel('apply-preview'));
    await waitFor(t2, sel('apply-go'));
    const cur = (await call('GET', `/api/episodes/${id2}`)).json;
    const narr = {...cur.doc, narration: {...cur.doc.narration, segments: cur.doc.narration.segments.map((g: any, i: number) => (i === 0 ? {...g, text: 'A model reads any text.'} : g))}};
    assert.equal((await call('PUT', `/api/episodes/${id2}`, {doc: narr, baseSeq: cur.seq, tab: 'other'})).status, 200);
    await t2.click(sel('apply-go'));
    await waitFor(t2, sel('apply-error'));
    assert.match(await t2.eval<string>('document.querySelector("[data-testid=apply-error]").innerText'), /changed somewhere else after this preview, so nothing was applied/);
    const kept = (await call('GET', `/api/episodes/${id2}`)).json;
    assert.equal(kept.doc.narration.segments[0].text, 'A model reads any text.', 'the other save is kept');
    assert.equal(kept.doc.scenes[0].id, 'storyboard-pending', 'nothing was applied');
    // previewing again works from the newer versions
    await t2.click(sel('apply-preview'));
    await waitFor(t2, sel('apply-go'));
    await t2.click(sel('apply-go'));
    await waitFor(t2, sel('applied-chip'));
    await shot('apply')('2-applied-after-conflict');
    assert.deepEqual((await call('GET', `/api/episodes/${id2}`)).json.doc.scenes.map((x: any) => x.id), ['sb1', 'sb2']);
  });

  test('replacing scene work the author has edited needs an explicit yes, and the author\'s version stays in History', {timeout: 5 * 60_000}, async () => {
    const id = await draftWith('Replace scenes', TWO);
    const first = await call('POST', `/api/plans/${id}/apply`, {basePlanSeq: (await call('GET', `/api/plans/${id}`)).json.seq, baseEpisodeSeq: (await call('GET', `/api/episodes/${id}`)).json.seq, confirmReplace: false});
    assert.equal(first.status, 200, JSON.stringify(first.json));
    // the author edits a scene in the Scenes step (through the page), then the storyboard changes
    const t = await open(`/?plan=${id}&tab=scenes`);
    await waitFor(t, sel('pc-card-0-heading'));
    await paste(t, sel('pc-card-0-heading'), 'My own heading');
    await t.click(sel('escene-save-sb1'));
    await t.waitFor('document.querySelector("[data-testid=scenes-msg]")?.dataset.tone === "ok"', 15000, 'the save');
    const plan = (await call('GET', `/api/plans/${id}`)).json;
    const sb = plan.plan.storyboard.map((x: any) => (x.id === 'sb1' ? {...x, params: {...x.params, cards: [{heading: 'Planned heading', body: 'A model reads text.'}, x.params.cards[1]]}} : x));
    assert.equal((await call('PUT', `/api/plans/${id}`, {plan: {...plan.plan, storyboard: sb}, baseSeq: plan.seq, tab: 'other'})).status, 200);
    await t.goto(srv.url(`/?plan=${id}&tab=storyboard`));
    await waitFor(t, sel('apply-panel'));
    await t.click(sel('apply-preview'));
    await waitFor(t, sel('apply-confirm'));
    assert.match(await t.eval<string>('document.querySelector("[data-testid=apply-confirm-row]").innerText'), /already has 2 scenes of its own\. Applying changes 1 of them/);
    assert.deepEqual(await t.eval<string[]>('[...document.querySelectorAll("[data-testid=apply-changes] li")].map((e) => e.dataset.change)'), ['changed', 'same']);
    assert.equal(await t.eval('document.querySelector("[data-testid=apply-go]").disabled'), true, 'cannot apply before saying yes');
    await shot('replace5b')('1-confirm');
    await t.click(sel('apply-confirm'));
    await t.click(sel('apply-go'));
    await waitFor(t, sel('applied-chip'));
    const doc = (await call('GET', `/api/episodes/${id}`)).json.doc;
    assert.equal(doc.scenes[0].params.cards[0].heading, 'Planned heading');
    const revs = (await call('GET', `/api/episodes/${id}/revisions`)).json.revisions;
    const kinds = revs.map((r: any) => r.kind).reverse();
    assert.deepEqual(kinds.filter((k: string) => k !== 'edit' && k !== 'auto'), ['create', 'scenes-apply', 'scenes-before', 'scenes-apply']);
    const before = revs.find((r: any) => r.kind === 'scenes-before');
    const detail = (await call('GET', `/api/episodes/${id}/revisions/${before.number}`)).json;
    assert.ok(detail.ifRestored.length >= 0);
    const back = await call('POST', `/api/episodes/${id}/restore`, {number: before.number, baseSeq: (await call('GET', `/api/episodes/${id}`)).json.seq, tab: 'x'});
    assert.equal(back.status, 200, JSON.stringify(back.json));
    assert.equal((await call('GET', `/api/episodes/${id}`)).json.doc.scenes[0].params.cards[0].heading, 'My own heading', 'the author\'s own version can be restored');
  });

  test('a scene edited in another tab is not overwritten by a stale Scenes tab, and the unsaved edit is kept', {timeout: 5 * 60_000}, async () => {
    const id = await draftWith('Scenes conflict', TWO);
    const s = (await call('GET', `/api/plans/${id}`)).json;
    await call('POST', `/api/plans/${id}/apply`, {basePlanSeq: s.seq, baseEpisodeSeq: s.episode.seq, confirmReplace: false});
    const t = await open(`/?plan=${id}&tab=scenes`);
    await waitFor(t, sel('pc-card-0-heading'));
    await paste(t, sel('pc-card-0-heading'), 'Typed here');
    await waitFor(t, sel('escene-unsaved'));
    const cur = (await call('GET', `/api/episodes/${id}`)).json;
    const other = {...cur.doc, scenes: cur.doc.scenes.map((x: any, i: number) => (i === 0 ? {...x, params: {...x.params, title: 'From another tab'}} : x))};
    assert.equal((await call('PUT', `/api/episodes/${id}`, {doc: other, baseSeq: cur.seq, tab: 'other'})).status, 200);
    await t.click(sel('escene-save-sb1'));
    await t.waitFor('document.querySelector("[data-testid=scenes-msg]")?.dataset.tone === "bad"', 15000, 'the refusal');
    assert.match(await t.eval<string>('document.querySelector("[data-testid=scenes-msg]").innerText'), /changed somewhere else after you started editing it, so nothing was saved/);
    const kept = (await call('GET', `/api/episodes/${id}`)).json.doc;
    assert.equal(kept.scenes[0].params.title, 'From another tab');
    assert.equal(kept.scenes[0].params.cards[0].heading, 'Text', 'the stale edit was not written');
    assert.equal(await t.eval('document.querySelector("[data-testid=escene-sb1]").dataset.dirty'), 'yes', 'the unsaved edit is still here');
  });

  test('the controls refuse what a scene cannot show: a cue word that is not spoken, a card that does not fit, an unsupported type; and raw JSON is checked too', {timeout: 5 * 60_000}, async () => {
    const id = await draftWith('Controls', TWO);
    const s = (await call('GET', `/api/plans/${id}`)).json;
    await call('POST', `/api/plans/${id}/apply`, {basePlanSeq: s.seq, baseEpisodeSeq: s.episode.seq, confirmReplace: false});
    const t = await open(`/?plan=${id}&tab=scenes`);
    await waitFor(t, sel('pc-card-1-heading'));
    // a card with text that does not fit
    await paste(t, sel('pc-card-1-body'), 'x'.repeat(110));
    await t.click(sel('pc-add-card'));
    await t.click(sel('pc-add-card'));
    await t.waitFor('document.querySelector("[data-testid=escene-sb1]")?.dataset.state === "incomplete"', 10000, 'the scene to be reported incomplete');
    assert.match(await t.eval<string>('document.querySelector("[data-testid=escene-sb1] [data-testid=escene-problems]").innerText'), /heading|text needs about|is not complete/);
    // raw JSON that is not a valid scene is refused before it is taken
    await t.click(sel('adv-toggle'));
    await paste(t, sel('adv-json'), '{"cards": [{"heading": "x", "color": "red"}]}');
    await t.click(sel('adv-use'));
    await waitFor(t, sel('adv-error'));
    assert.match(await t.eval<string>('document.querySelector("[data-testid=adv-error]").innerText'), /Unrecognized key|params/);
    assert.equal(await t.eval('!!document.querySelector("[data-testid=preview-paused]")'), true, 'an invalid draft is not drawn');
    await shot('controls')('1-refused');
    // the second scene's own card is untouched on disk until saved
    assert.equal((await call('GET', `/api/episodes/${id}`)).json.doc.scenes[0].params.cards.length, 2);
  });

  test('without narration or timing the Scenes step still shows its composition, labelled as an estimate; on a draft with no applied scenes it says so', {timeout: 5 * 60_000}, async () => {
    const id = await draftWith('Standin', TWO);
    const t = await open(`/?plan=${id}&tab=scenes`);
    await waitFor(t, sel('scenes-standin'));
    assert.match(await t.eval<string>('document.querySelector("[data-testid=production-check]").innerText'), /only its stand-in scene/);
    const s = (await call('GET', `/api/plans/${id}`)).json;
    await call('POST', `/api/plans/${id}/apply`, {basePlanSeq: s.seq, baseEpisodeSeq: s.episode.seq, confirmReplace: false});
    await t.goto(srv.url(`/?plan=${id}&tab=scenes`));
    await waitFor(t, sel('composition-player'));
    const label = await t.eval<string>('document.querySelector("[data-testid=composition-preview]").innerText');
    assert.match(label, /Estimated timing · no audio · not a build/);
    assert.match(label, /never uses narration or a build, so it is not the finished video/);
    // the Remotion Player keeps a few silent data: tags of its own; nothing may point at a generated or recorded file
    assert.deepEqual(await t.eval<string[]>('[...document.querySelectorAll("audio, video")].map((e) => e.getAttribute("src") ?? "").filter((x) => !x.startsWith("data:audio/mp3;base64,/+MY"))'), [], 'no narration or recording is loaded into the page here');
    assert.deepEqual((await call('GET', `/api/jobs?episode=${id}`)).json.jobs, []);
    await shot('standin')('1-estimate');
  });

  test('the page makes no problems of its own', () => {
    assert.deepEqual(sawProblems, []);
  });
});
