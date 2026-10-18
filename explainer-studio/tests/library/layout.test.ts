import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {describe, test} from 'node:test';
import {ROOT} from '../helpers.ts';
import {loadBundled} from './bundle.ts';

const load = () => loadBundled(join(ROOT, 'tests/library/entries/fit-entry.ts'));
const fixture = () => JSON.parse(readFileSync(join(ROOT, 'samples/dense-pip-fixture/episode.json'), 'utf8')).scenes[0].params;
const ctx = () => JSON.parse(readFileSync(join(ROOT, 'samples/context-window/episode.json'), 'utf8')).scenes[0].params;

describe('layout fit check', () => {
  test('the dense fixture fits the dense layout: inside the safe area, readable, clear of the caption and of Pip', async () => {
    const m = await load();
    const p = fixture();
    assert.deepEqual(m.fitCheck('dense-pip', m.denseFitItems(p, 'dense-pip')), []);
  });

  test('the same dense fixture in the prototype layout (a large fixed Pip, a 620 px card) is flagged: the cards are too short for their text', async () => {
    const m = await load();
    const p = fixture();
    const problems: string[] = m.fitCheck('card-over-pip', m.denseFitItems(p, 'card-over-pip'));
    assert.ok(problems.some((x) => /card \d+ is \d+ px tall; its text needs about 140 px/.test(x)), problems.slice(0, 3).join(' | '));
  });

  test('the context-window scene fits its content-led layout, and its two outcomes are allowed to cover Pip only because the layout lets him leave', async () => {
    const m = await load();
    const items = m.contextWindowFitItems(ctx().capacity);
    assert.deepEqual(m.fitCheck('content-led', items), []);
    // the same items in a layout whose Pip cannot move are flagged for the outcomes
    const fixedItems = items.map((i: any) => ({...i}));
    const problems: string[] = m.fitCheck('card-over-pip', fixedItems);
    assert.ok(problems.length > 0);
    // an outcome panel not marked as covering Pip is flagged in the movable layout, with the way out
    const unmarked = items.map((i: any) => (i.id === 'outcome 2' ? {...i, mayOverlapMascot: false} : i));
    assert.match(m.fitCheck('content-led', unmarked).join(' | '), /outcome 2 overlaps Pip's box; he must step aside/);
  });

  test('each rule fires on its own: text size, width, safe area, caption band, Pip, overlap', async () => {
    const m = await load();
    const rect = (x: number, y: number, w: number, h: number) => ({x, y, w, h});
    const only = (items: any[], layout = 'content-led') => m.fitCheck(layout, items).join(' | ');
    assert.match(only([{id: 'a', rect: rect(100, 200, 300, 60), fontPx: 20}]), /a text is 20 px; the minimum is 36 px/);
    assert.equal(only([{id: 'a', rect: rect(100, 200, 300, 60), fontPx: 28, essential: false}]), '');
    assert.match(only([{id: 'a', rect: rect(100, 200, 100, 60), fontPx: 30, text: 'a long label', mono: true}]), /needs about \d+ px but the item is 100 px wide/);
    assert.match(only([{id: 'a', rect: rect(20, 200, 300, 60)}]), /a is outside the safe area/);
    assert.match(only([{id: 'a', rect: rect(100, 1560, 300, 60)}]), /a overlaps the caption band/);
    assert.match(only([{id: 'a', rect: rect(100, 1200, 300, 100)}]), /a overlaps Pip's box/);
    assert.match(only([{id: 'a', rect: rect(100, 200, 300, 100)}, {id: 'b', rect: rect(200, 250, 300, 100)}]), /a overlaps b/);
    assert.equal(only([{id: 'a', rect: rect(100, 200, 300, 100), phase: 'x'}, {id: 'b', rect: rect(200, 250, 300, 100), phase: 'y'}]), '', 'items shown at different times may share space');
    assert.match(m.fitCheck('nope', []).join(' '), /unknown layout/);
  });
});
