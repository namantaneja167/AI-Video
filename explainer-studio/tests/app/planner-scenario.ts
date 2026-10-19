// One new episode, made the way a person makes it: only clicks and typed or pasted text in a real browser. Shared by the
// browser test and by the recorded run on the demo workspace, so the demonstration is the tested path and not another one.
import assert from 'node:assert/strict';
import type {Tab} from './harness.ts';

export type Content = {
  title: string; audience: string; objective: string; durationMin: string;
  /** Pasted first with an error in it, to show the exact place; then the corrected text is pasted. */
  researchBroken: string; research: string;
  /** A plain script: the app splits it and the author adjusts the split. */
  script: string;
  /** The author's adjustment of the split: one row's words are changed, it is joined with the next, then split again at the end of its own words. */
  adjust: {row: number; text: string};
  storyboard: string;
  /** The storyboard is complete: every planned scene is ready as soon as it is accepted. */
  storyboardReady?: boolean;
};

export type Observed = {
  planId: string;
  /** What the page showed for the broken paste. */
  errorText: string;
  rowsBeforeAccept: string[];
  external: string[];
  briefText: string;
};

const sel = (id: string) => `[data-testid="${id}"]`;
const has = (t: Tab, q: string, ms = 15000) => t.waitFor(`document.querySelector(${JSON.stringify(q)})`, ms, q);
const gone = (t: Tab, q: string, ms = 15000) => t.waitFor(`!document.querySelector(${JSON.stringify(q)})`, ms, `${q} to go away`);
const text = (t: Tab, q: string) => t.eval<string>(`document.querySelector(${JSON.stringify(q)})?.innerText ?? ''`);
export async function paste(t: Tab, q: string, value: string) {
  await t.click(q);
  await t.eval(`document.querySelector(${JSON.stringify(q)}).select()`);
  await t.send('Input.insertText', {text: value});
}
const origin = (t: Tab) => t.eval<string>('location.origin');
async function external(t: Tab): Promise<string[]> {
  const o = await origin(t);
  return t.eval<string[]>(`performance.getEntriesByType('resource').map((r) => r.name).filter((n) => !n.startsWith(${JSON.stringify(o)}))`);
}
const rowsNow = (t: Tab) => t.eval<string[]>(`[...document.querySelectorAll('[data-testid=script-rows] textarea')].map((e) => e.value)`);

export async function createEpisodeThroughUi(t: Tab, c: Content, shot: (name: string) => Promise<void> = async () => undefined): Promise<Observed> {
  const ext: string[] = [];
  // ---- the list, then a new draft with a brief
  await t.click(sel('rail-episodes'));
  await has(t, '[data-screen=episodes]');
  if (await t.eval('!!document.querySelector("[data-testid=episode-context-window]")')) { // the demo workspace has the baseline; a new project does not
    assert.equal(await t.eval('document.querySelector("[data-testid=episode-context-window]").dataset.hasPlan'), 'false', 'the baseline episode has no planning document');
  }
  await shot('1-episodes');
  await t.click(sel('new-episode'));
  await has(t, sel('new-episode-dialog'));
  await t.fill(sel('new-title'), c.title);
  await t.fill(sel('new-audience'), c.audience);
  await t.fill(sel('new-objective'), c.objective);
  await t.fill(sel('new-duration'), c.durationMin);
  await t.click(sel('new-create'));
  await has(t, '[data-screen=plan]');
  assert.equal(await text(t, sel('plan-title')), c.title);
  assert.match(await text(t, sel('plan-state')), /Draft: no script yet/);
  const planId = new URL(await t.eval<string>('location.href')).searchParams.get('plan')!;
  await shot('2-brief');

  // ---- research: the brief to copy, a broken paste, then the corrected one
  await t.click(sel('stage-2'));
  await has(t, sel('handoff-research'));
  const briefText = await t.eval<string>(`document.querySelector('[data-testid=brief-text]').value`);
  assert.match(briefText, new RegExp(c.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(briefText, /"studioPacket": 1/);
  await t.click(sel('copy-brief')); // the browser may refuse clipboard access in a headless page; the text stays selected for a manual copy
  await t.click(sel('open-import'));
  await has(t, sel('import-dialog'));
  await paste(t, sel('import-text'), c.researchBroken);
  await t.click(sel('import-check'));
  await has(t, sel('import-errors'));
  const errorText = await text(t, sel('import-errors'));
  await shot('3-invalid-paste');
  assert.equal((await t.eval<number>(`fetch('/api/plans/${planId}/imports').then((r) => r.json()).then((j) => j.imports.length)`)), 0, 'nothing was imported');
  await paste(t, sel('import-text'), c.research);
  await t.click(sel('import-check'));
  await has(t, sel('import-state'));
  assert.equal(await text(t, sel('import-state')), 'Proposed');
  await shot('4-research-review');
  assert.equal((await t.eval<number>(`fetch('/api/plans/${planId}').then((r) => r.json()).then((j) => j.plan.sources.length)`)), 0, 'a proposal is not part of the plan yet');
  await t.click(sel('import-accept'));
  await gone(t, sel('import-dialog'));
  await has(t, sel('source-src1'));
  ext.push(...await external(t));
  await shot('5-research-accepted');

  // ---- script: a plain script, split by the app and adjusted by the author before it is accepted
  await t.click(sel('stage-3'));
  await has(t, sel('handoff-script'));
  await t.click(sel('open-import'));
  await paste(t, sel('import-text'), c.script);
  await t.click(sel('import-check'));
  await has(t, sel('script-rows'));
  const first = await rowsNow(t);
  assert.ok(first.length >= 4, `the script split into ${first.length} rows`);
  const {row, text: adjusted} = c.adjust;
  await t.fill(`${sel(`seg-row-${row}`)} textarea`, adjusted);
  await t.click(sel(`merge-${row + 1}`));
  assert.equal((await rowsNow(t)).length, first.length - 1, 'joining two rows leaves one fewer');
  await t.eval(`document.querySelector('[data-testid=seg-row-${row}] textarea').setSelectionRange(${adjusted.length}, ${adjusted.length})`);
  await t.click(sel(`split-${row}`));
  const rowsBeforeAccept = await rowsNow(t);
  assert.equal(rowsBeforeAccept.length, first.length, 'one row joined, then split again');
  assert.equal(rowsBeforeAccept[row], adjusted);
  assert.equal(rowsBeforeAccept[row + 1], first[row + 1], 'the other half is as it was');
  await shot('6-script-review');
  await t.click(sel('import-accept'));
  await gone(t, sel('import-dialog'));
  await has(t, sel('script-accepted'));
  assert.match(await text(t, sel('plan-state')), /Has a script/);
  const accepted = await t.eval<string[]>(`[...document.querySelectorAll('[data-testid^=accepted-]')].map((e) => e.innerText.replace(/^s\\d+\\s*/, '').trim())`);
  assert.deepEqual(accepted, rowsBeforeAccept.map((r) => r.trim()), 'the accepted script is exactly what the author saw');
  await shot('7-script-accepted');

  // ---- storyboard
  await t.click(sel('stage-4'));
  await has(t, sel('handoff-storyboard'));
  await t.click(sel('open-import'));
  await paste(t, sel('import-text'), c.storyboard);
  await t.click(sel('import-check'));
  await has(t, sel('sec-storyboard'));
  await shot('8-storyboard-review');
  await t.click(sel('import-accept'));
  await gone(t, sel('import-dialog'));
  await has(t, sel('scene-sb1'));
  assert.match(await text(t, sel('storyboard-summary')), c.storyboardReady ? /Every planned scene is ready/ : /Not every planned scene is ready yet/);
  await shot('9-storyboard-accepted');
  ext.push(...await external(t));
  return {planId, errorText, rowsBeforeAccept, external: ext, briefText};
}

export const sel_ = sel;
export const waitFor = has;
