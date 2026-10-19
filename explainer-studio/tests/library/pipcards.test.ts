// The reusable Pip scene: its parameters, cue rules, layout fit and the performance built from listed actions.
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {describe, test} from 'node:test';
import {PipCardsParams} from '../../src/library/params.ts';
import {dynamicCues, hasDynamicCues, sceneCueSpec} from '../../src/library/dynamicCues.ts';
import {SCENE_CUES} from '../../src/library/sceneSpecs.ts';
import {cardTarget, pipCardsFit, pipCardsRects} from '../../src/library/scenes/pipCardsGeometry.ts';
import {ROOT} from '../helpers.ts';
import {loadBundled} from './bundle.ts';

const params = (extra: object = {}) => PipCardsParams.parse({title: 'Tokens', cards: [{heading: 'Text', body: 'A model reads text.'}, {heading: 'Pieces', body: 'In small pieces.'}], actions: [], ...extra});

describe('pip-cards parameters', () => {
  test('defaults are filled in: empty body, no actions, Pip idles', () => {
    const p = PipCardsParams.parse({cards: [{heading: 'Only'}]});
    assert.deepEqual([p.cards[0].body, p.actions, p.idle], ['', [], true]);
  });
  test('an action that needs a card must name one that exists; an action that does not must not name one', () => {
    const bad = PipCardsParams.safeParse({cards: [{heading: 'A'}], actions: [{do: 'point', at: {segment: 0}}, {do: 'look', at: {segment: 0}, card: 3}, {do: 'nod', at: {segment: 0}, card: 0}]});
    assert.equal(bad.success, false);
    assert.deepEqual(bad.error!.issues.map((i) => i.path.join('.')), ['actions.0.card', 'actions.1.card', 'actions.2.card']);
    assert.match(bad.error!.issues[1].message, /there is no card 4; the scene has 1/);
  });
  test('unknown fields, free-form action names and more than four cards are refused', () => {
    assert.equal(PipCardsParams.safeParse({cards: [{heading: 'A', glow: true}]}).success, false);
    assert.equal(PipCardsParams.safeParse({cards: [{heading: 'A'}], actions: [{do: 'dance wildly', at: {segment: 0}}]}).success, false);
    assert.equal(PipCardsParams.safeParse({cards: Array.from({length: 5}, () => ({heading: 'x'}))}).success, false);
  });
});

describe('pip-cards cue rules come from the parameters', () => {
  const scene = (extra: object = {}, segments = ['s1', 's2', 's3']) => ({id: 'sb1', type: 'pip-cards', segments, params: params({cards: [{heading: 'A'}, {heading: 'B', at: {segment: 2, word: 'pieces'}}], actions: [{do: 'point', at: {segment: 0, word: 'reads'}, card: 0}, {do: 'nod', at: {segment: 1, edge: 'end'}}], ...extra})});
  test('card and action cues are named in order, with defaults for a card with no time of its own', () => {
    const spec = sceneCueSpec(scene())!;
    assert.deepEqual(Object.keys(spec), ['card1', 'card2', 'action1', 'action2', 'voice_end']);
    assert.deepEqual(spec.card1, {segment: 0, at: 'start', dt: -0.05});
    assert.deepEqual(spec.card2, {segment: 2, at: {word: 'pieces'}, dt: -0.05});
    assert.deepEqual(spec.action2, {segment: 1, at: 'end', dt: 0});
  });
  test('they resolve against the timeline like any other cue, and only for scenes whose cues depend on parameters', () => {
    const segs = [{id: 's1', start: 1, end: 3, words: [{text: 'A', start: 1, end: 1.2}, {text: 'model', start: 1.3, end: 1.6}, {text: 'reads', start: 1.7, end: 2}]}, {id: 's2', start: 3.2, end: 5, words: [{text: 'Two', start: 3.2, end: 3.5}]}, {id: 's3', start: 5.2, end: 7, words: [{text: 'In', start: 5.2, end: 5.4}, {text: 'pieces', start: 5.6, end: 6}]}];
    const cues = dynamicCues([scene(), {id: 'cw', type: 'context-window', segments: ['s1'], params: {}}], segs);
    assert.deepEqual(Object.keys(cues), ['sb1'], 'a fixed-cue scene is left to the existing annotation');
    assert.equal(cues.sb1.card2, 5.55);
    assert.equal(cues.sb1.action1, 1.7);
    assert.equal(cues.sb1.action2, 5);
    assert.equal(hasDynamicCues([scene()]), true);
    assert.equal(hasDynamicCues([{id: 'cw', type: 'context-window', segments: ['s1'], params: {}}]), false);
  });
  test('a fixed-cue scene type keeps exactly its own rules, so existing timings are unaffected', () => {
    assert.equal(sceneCueSpec({type: 'context-window', params: {}, segments: []}), SCENE_CUES['context-window']);
    assert.equal(sceneCueSpec({type: 'pip-scene-10x', params: {}, segments: []}), SCENE_CUES['pip-scene-10x']);
    assert.equal(sceneCueSpec({type: 'cards', params: {}, segments: []}), undefined);
    assert.equal(sceneCueSpec({type: 'pip-cards', params: {cards: []}, segments: ['s1']}), undefined, 'invalid parameters have no rules');
  });
});

describe('pip-cards layout fit', () => {
  const long = 'x'.repeat(100);
  test('two short cards fit every layout; the check names what does not', () => {
    for (const t of ['content-led', 'card-over-pip', 'dense-pip']) assert.deepEqual(pipCardsFit(params(), t), [], t);
    const four = params({cards: Array.from({length: 4}, (_, i) => ({heading: `Card ${i + 1}`, body: long}))});
    const tight = pipCardsFit(four, 'card-over-pip');
    assert.ok(tight.some((x) => /card \d is \d+ px tall; its text needs about \d+ px/.test(x)), tight.join(' | '));
    assert.deepEqual(pipCardsFit(four, 'dense-pip'), [], 'the dense layout has the room');
  });
  test('content never reaches down into Pip, in any layout', () => {
    for (const t of ['content-led', 'card-over-pip', 'dense-pip']) {
      const {cards} = pipCardsRects(params({cards: Array.from({length: 4}, (_, i) => ({heading: `C${i}`}))}), t);
      assert.ok(cards.every((r) => r.y + r.h <= 1316), `${t}: lowest card ends at ${Math.max(...cards.map((r) => r.y + r.h))}`);
    }
  });
  test('a heading of the longest allowed length still fits on one line', () => {
    const p = PipCardsParams.parse({cards: [{heading: 'a heading of exactly thirty-six char'}]});
    assert.equal(pipCardsFit(p, 'content-led').length, 0);
  });
  test('the pointing target is the middle of the chosen card', () => {
    const p = params();
    const r = pipCardsRects(p, 'content-led').cards[1];
    assert.deepEqual(cardTarget(p, 'content-led', 1), [r.x + 80, r.y + r.h / 2]);
  });
});

describe('Pip does what the listed actions say, when they say it', () => {
  const load = () => loadBundled(join(ROOT, 'tests/library/entries/pipcards-entry.ts'));
  test('with no actions he does not point, hop or nod', async () => {
    const m = await load();
    for (const t of [0.5, 3, 7, 12]) { const p = m.pose([], t); assert.equal(p.pointW, 0); assert.equal(p.by, 0); }
  });
  test('a hop, a nod and a point each happen at their time and not before or long after', async () => {
    const m = await load();
    const acts = [{do: 'hop', t: 2, aim: undefined}, {do: 'nod', t: 5, aim: undefined}, {do: 'point', t: 8, aim: [540, 500] as [number, number]}];
    assert.equal(m.pose(acts, 1.9).by, 0);
    assert.ok(m.pose(acts, 2.14).by < -13, 'hop');
    assert.equal(m.pose(acts, 3.5).by, 0);
    assert.ok(m.pose(acts, 5.2).by > 6, 'nod');
    assert.equal(m.pose(acts, 7).pointW, 0);
    assert.equal(m.pose(acts, 9).pointW, 1, 'pointing while held');
    assert.equal(m.pose(acts, 12).pointW, 0, 'hand down again');
  });
  test('the order the actions are listed in does not matter', async () => {
    const m = await load();
    const a = [{do: 'hop', t: 2}, {do: 'nod', t: 5}, {do: 'point', t: 8, aim: [540, 500] as [number, number]}];
    const b = [...a].reverse();
    for (const t of [1, 2.1, 5.2, 8.5, 11]) assert.deepEqual(m.pose(a as never, t), m.pose(b as never, t));
  });
  test('looking turns his gaze toward the card, and it stays there', async () => {
    const m = await load();
    const idle = m.pose([], 6).eye;
    const look = m.pose([{do: 'look', t: 3, aim: [900, 300]}] as never, 6).eye;
    assert.notDeepEqual(look, idle);
    assert.deepEqual(m.pose([{do: 'look', t: 3, aim: [900, 300]}] as never, 6).eye, m.pose([{do: 'look', t: 3, aim: [900, 300]}] as never, 9).eye);
  });
});
