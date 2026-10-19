// Phase 5B through the page: a ready storyboard is previewed and applied to its episode, the Scenes step is opened, one card
// is edited and saved, and the production preflight is read. Shared by the browser test and by the recorded run on the demo
// workspace, so the demonstration is the tested path. Only clicks and typed text; no narration or video is made.
import assert from 'node:assert/strict';
import type {Tab} from './harness.ts';
import {paste, sel_ as sel, waitFor} from './planner-scenario.ts';
import type {Content} from './planner-scenario.ts';

const text = (t: Tab, q: string) => t.eval<string>(`document.querySelector(${JSON.stringify(q)})?.innerText ?? ''`);

/** Content for a new Pip episode whose storyboard is complete and valid for its own script (five lines in three scenes). */
export const READY_CONTENT = (over: Partial<Content> = {}): Content => ({
  title: 'What is a token?',
  audience: 'Curious beginners',
  objective: 'Know that a model reads text in pieces called tokens',
  durationMin: '1',
  researchBroken: JSON.stringify({studioPacket: 1, sources: [{title: 'Author outline'}], claims: [{text: 'A token is a piece of text.', kind: 'rumor'}]}, null, 2),
  research: JSON.stringify({studioPacket: 1, sources: [{title: 'Author outline', note: 'My own notes; no external source'}], claims: [{text: 'A token is a piece of text a model reads.', kind: 'fact', sources: [0], evidence: 'Author outline', caveat: 'Pieces differ between models'}]}, null, 2),
  script: 'A model reads text in small pieces. Those pieces are called tokens.\n\nA token is not always a word. Sometimes it is only part of one.\n\nEvery model can only hold so many tokens at once.',
  adjust: {row: 2, text: 'A token is not always a whole word.'},
  storyboardReady: true,
  storyboard: JSON.stringify({studioPacket: 1, kind: 'storyboard', storyboard: {scenes: [
    {segments: [1, 2], sceneType: 'pip-cards', intention: 'Introduce tokens as pieces of text', mechanism: 'Two cards, one for the text and one for its pieces', pip: ['Pip points at the first card', 'Pip nods when the pieces appear'],
      params: {cards: [{heading: 'Text', body: 'A model reads text.'}, {heading: 'Tokens', body: 'It reads it in small pieces called tokens.', at: {segment: 1, word: 'tokens'}}], actions: [{do: 'point', card: 0, at: {segment: 0, word: 'text'}}, {do: 'point', card: 1, at: {segment: 1, word: 'tokens'}}, {do: 'nod', at: {segment: 1, edge: 'end'}}]}},
    {segments: [3, 4], sceneType: 'pip-cards', intention: 'A token can be part of a word', mechanism: 'Two cards', pip: ['Pip tilts his head'],
      params: {cards: [{heading: 'Not always a word', body: 'A token can be a whole word.'}, {heading: 'Sometimes a part', body: 'Or only a part of one.', at: {segment: 1, word: 'part'}}], actions: [{do: 'look', card: 0, at: {segment: 0, edge: 'start'}}, {do: 'hop', at: {segment: 1, word: 'part'}}]}},
    {segments: [5], sceneType: 'pip-cards', intention: 'The limit', mechanism: 'One card', pip: [],
      params: {cards: [{heading: 'A limit', body: 'Only so many tokens fit at once.', at: {segment: 0, word: 'many'}}], actions: [{do: 'look', card: 0, at: {segment: 0, word: 'tokens'}}, {do: 'smile', at: {segment: 0, edge: 'end'}}]}},
  ]}}, null, 2),
  ...over,
});

export type ScenesSeen = {changesText: string[]; appliedChip: string; previewLabel: string; composition: boolean; kinds: string[]; notesText: string; preflight: string; rebuildSteps: string[]; savedMessage: string};

export async function applyAndAdjustThroughUi(t: Tab, planId: string, shot: (name: string) => Promise<void> = async () => undefined): Promise<ScenesSeen> {
  await t.goto(`${await t.eval<string>('location.origin')}/?plan=${planId}&tab=storyboard`);
  await waitFor(t, sel('apply-panel'));
  // ---- the notes under each scene are labelled as notes
  assert.match(await text(t, sel('note-pip')), /Pip \(planning note\)/);
  // ---- preview, then apply
  await t.click(sel('apply-preview'));
  await waitFor(t, sel('apply-changes'));
  const changesText = await t.eval<string[]>(`[...document.querySelectorAll('[data-testid=apply-changes] li')].map((e) => e.innerText.replace(/\\s+/g, ' ').trim())`);
  await shot('10-apply-preview');
  await t.click(sel('apply-go'));
  await waitFor(t, sel('applied-chip'));
  const appliedChip = await text(t, sel('applied-chip'));
  await shot('11-applied');
  // ---- the Scenes step
  await t.click(sel('open-scenes'));
  await waitFor(t, sel('scenes-step'));
  await waitFor(t, sel('composition-player'));
  const previewLabel = await text(t, sel('preview-label'));
  const composition = await t.eval<boolean>('!!document.querySelector("[data-testid=composition-player] [data-remotion-canvas], [data-testid=composition-player] video, [data-testid=composition-player] div")');
  const kinds = await t.eval<string[]>(`[...document.querySelectorAll('[data-testid=escene-kind]')].map((e) => e.innerText)`);
  const notesText = await text(t, sel('planning-notes'));
  await shot('12-scenes');
  // ---- edit one card's heading through its field, then save only that scene
  await paste(t, sel('pc-card-0-heading'), 'The text');
  await waitFor(t, sel('escene-unsaved'));
  await shot('13-scene-unsaved');
  await t.click(sel('escene-save-sb1'));
  await t.waitFor('document.querySelector("[data-testid=scenes-msg]")?.dataset.tone === "ok"', 15000, 'the scene to be saved');
  const savedMessage = await text(t, sel('scenes-msg'));
  await waitFor(t, sel('preflight-ok'));
  const preflight = await text(t, sel('preflight-ok'));
  const rebuildSteps = await t.eval<string[]>(`[...document.querySelectorAll('[data-testid=rebuild-steps] li')].map((e) => e.innerText)`);
  await shot('14-preflight');
  return {changesText, appliedChip, previewLabel, composition, kinds, notesText, preflight, rebuildSteps, savedMessage};
}
