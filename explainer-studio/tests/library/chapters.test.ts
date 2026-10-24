import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {test} from 'node:test';
import {loadBundled} from './bundle.ts';

const fonts = {sans: 'Inter', mono: 'JetBrains Mono'};
const stages = ['ONE', 'TWO', 'THREE', 'FOUR'];
const load = () => loadBundled(join(import.meta.dirname, 'entries/chapters-entry.ts'));

test('the stage strip keeps every label visible and highlights only the active stage', async () => {
  const {html: draw} = await load();
  const inkBg = readFileSync(join(import.meta.dirname, '../../src/art/palette.ts'), 'utf8').match(/ink:\s*'(#[0-9A-Fa-f]{6})'/)![1];
  for (let active = 0; active < stages.length; active++) {
    const html = draw('StageStrip', {stages, active, fonts});
    const cells = [...html.matchAll(/<div style="([^"]*)">([^<]+)<\/div>/g)].filter((m) => stages.includes(m[2]));
    assert.deepEqual(cells.map((m) => m[2]), stages, 'all labels are drawn, in order');
    const highlighted = cells.filter((m) => m[1].toLowerCase().includes(`background:${inkBg.toLowerCase()}`)).map((m) => m[2]);
    assert.deepEqual(highlighted, [stages[active]]);
  }
});

test('the chapter header draws the title, the supporting sentence and the strip', async () => {
  const {html: draw} = await load();
  const html = draw('ChapterHeader', {title: 'A TITLE', supporting: 'One supporting sentence.', stages, active: 2, fonts});
  for (const text of ['A TITLE', 'One supporting sentence.', ...stages]) assert.ok(html.includes(text), text);
});

test('the full-page takeaway appears only from its start time and omits an unused counter', async () => {
  const {html: draw} = await load();
  const props = {start: 10, fonts, label: 'KEY TAKEAWAY', lead: 'Lead line.', emphasis: 'Emphasis line.', emphasisColor: '#277565', points: [{label: 'A', text: 'First point.', color: '#E8772E'}], note: 'Scope note.'};
  assert.equal(draw('FullPageTakeaway', {...props, t: 9.99}), '');
  const html = draw('FullPageTakeaway', {...props, t: 11});
  for (const text of ['KEY TAKEAWAY', 'Lead line.', 'Emphasis line.', 'First point.', 'Scope note.']) assert.ok(html.includes(text), text);
  assert.ok(!html.includes('5 / 5'));
  assert.ok(draw('FullPageTakeaway', {...props, t: 11, counter: '3 / 3'}).includes('3 / 3'));
});

test('the reusable chapter components hold no caching-specific wording', () => {
  const src = readFileSync(join(import.meta.dirname, '../../src/library/chapters.tsx'), 'utf8');
  assert.doesNotMatch(src, /cache|caching|\bmiss\b|stale|invalidat|database|headphone/i);
});
