// The creative checkpoint: what its checks say and, as importantly, what they do not claim. Pure.
import assert from 'node:assert/strict';
import {describe, test} from 'node:test';
import {GUIDANCE, creativeReport, takeawaySpoken} from '../../app/shared/creative.ts';
import {newPlan, withClaim, withSource, type PlanDoc} from '../../app/shared/plan.ts';
import {EpisodeSchemaV2, type EpisodeV2} from '../../src/schema2.ts';
import {readFileSync} from 'node:fs';

const doc = (): EpisodeV2 => EpisodeSchemaV2.parse(JSON.parse(readFileSync(new URL('../../samples/ticket/episode.motion.json', import.meta.url), 'utf8')));
const claim = (id: string, text: string, o: Partial<PlanDoc['claims'][number]> = {}) => ({id, text, kind: 'proposed-wording' as const, sourceIds: [], evidence: '', caveat: '', provenance: null, ...o});
const src = (id: string, checked = false) => ({id, title: `Source ${id}`, url: 'https://example.com/a', publisher: 'Example', published: '', note: '', checked: checked ? {at: 1, note: 'read it'} : null, provenance: null});
const base = () => newPlan({id: 'p', title: 'T', brand: 'pip-explains'});
const status = (r: ReturnType<typeof creativeReport>, id: string) => r.items.find((i) => i.id === id)?.status;

describe('creative checkpoint', () => {
  test('an empty plan asks for hook options and a takeaway without failing anything', () => {
    const r = creativeReport(base(), null, null);
    assert.equal(status(r, 'hook-options'), 'todo');
    assert.equal(status(r, 'takeaway'), 'todo');
    assert.equal(r.counts.fail, 0);
    assert.equal(r.items.find((i) => i.id === 'animatic'), undefined, 'no animatic row without an episode');
  });

  test('three different hook options pass; duplicates and fewer than three do not', () => {
    let p = withClaim(withClaim(base(), claim('hook1', 'Your ticket screenshot can expire')), claim('hook2', 'your ticket screenshot can expire'));
    assert.equal(status(creativeReport(p, null, null), 'hook-options'), 'warn', 'a repeat is not a second option');
    p = withClaim(withClaim(p, claim('hook3', 'This QR code keeps changing')), claim('hook4', 'A screenshot may not open that gate'));
    assert.equal(status(creativeReport(p, null, null), 'hook-options'), 'pass');
  });

  test('claims that are not hook-shaped or not proposed wording are not options', () => {
    const p = withClaim(withClaim(base(), claim('hooked', 'x', {kind: 'fact'})), claim('other', 'A different thing'));
    assert.equal(creativeReport(p, null, null).hookOptions.length, 0);
  });

  test('a hook longer than 48 characters is a failure; a short or long one only a note', () => {
    const long = 'This hook is far too long to fit on the opening card at all';
    const p = withClaim(withClaim(base(), claim('hook1', long)), claim('hook2', 'Too short'));
    const r = creativeReport(p, null, null);
    assert.equal(status(r, 'hook-fit'), 'fail');
    const q = withClaim(base(), claim('hook1', 'Too short'));
    assert.equal(status(creativeReport(q, null, null), 'hook-fit'), 'warn');
  });

  test('the chosen hook is the one in the episode, and one that is not an option is flagged', () => {
    const d = doc();
    let p = withClaim(base(), claim('hook1', d.scenes[0].openingHook!));
    const r = creativeReport(p, d, null);
    assert.equal(status(r, 'hook-chosen'), 'pass');
    assert.equal(r.hookOptions[0].chosen, true);
    p = withClaim(base(), claim('hook1', 'A different option altogether'));
    assert.equal(status(creativeReport(p, d, null), 'hook-chosen'), 'warn');
  });

  test('the takeaway needs a source from this plan, a statement of what it rests on, and a limit', () => {
    let p = withClaim(base(), claim('takeaway', 'Open the live pass before you queue.'));
    assert.equal(status(creativeReport(p, null, null), 'takeaway-evidence'), 'fail');
    p = withSource(withClaim(base(), claim('takeaway', 'Open the live pass before you queue.', {sourceIds: ['src1']})), src('src1'));
    assert.equal(status(creativeReport(p, null, null), 'takeaway-evidence'), 'warn', 'cited but no statement of what it supports');
    assert.equal(status(creativeReport(p, null, null), 'takeaway-limit'), 'warn');
    p = withSource(withClaim(base(), claim('takeaway', 'Open the live pass before you queue.', {sourceIds: ['src1'], evidence: 'Readers accept only the most recent code.', caveat: 'Static codes follow the issuer.'})), src('src1'));
    const r = creativeReport(p, null, null);
    assert.equal(status(r, 'takeaway-evidence'), 'pass');
    assert.equal(status(r, 'takeaway-limit'), 'pass');
  });

  test('a source id that is not in the plan does not count as evidence', () => {
    const p = withClaim(base(), claim('takeaway', 'Open the live pass before you queue.', {sourceIds: ['nope'], evidence: 'x', caveat: 'y'}));
    assert.equal(status(creativeReport(p, null, null), 'takeaway-evidence'), 'fail');
  });

  test('the narration is compared with the takeaway by key words, and the check says it is a word match', () => {
    const d = doc();
    const p = withClaim(base(), claim('takeaway', 'Open the live pass before you queue.', {sourceIds: [], evidence: '', caveat: ''}));
    assert.equal(status(creativeReport(p, d, null), 'takeaway-spoken'), 'pass', 'the ticket episode ends on it');
    const q = withClaim(base(), claim('takeaway', 'Compressing images always makes them blurrier.'));
    const r = creativeReport(q, d, null);
    assert.equal(status(r, 'takeaway-spoken'), 'warn');
    assert.match(r.items.find((i) => i.id === 'takeaway-spoken')!.detail, /heuristic/);
    assert.equal(takeawaySpoken('', 'anything'), 1);
  });

  test('every factual claim needs a source in the plan and a note of what it says; sources are never marked checked for the author', () => {
    let p = withSource(base(), src('s1'));
    p = withClaim(p, claim('c1', 'A fact', {kind: 'fact'}));
    assert.equal(status(creativeReport(p, null, null), 'claims'), 'fail');
    p = withClaim(p, claim('c1', 'A fact', {kind: 'fact', sourceIds: ['s1']}));
    assert.equal(status(creativeReport(p, null, null), 'claims'), 'warn');
    p = withClaim(p, claim('c1', 'A fact', {kind: 'fact', sourceIds: ['s1'], evidence: 'Page says so'}));
    const r = creativeReport(p, null, null);
    assert.equal(status(r, 'claims'), 'pass');
    assert.equal(status(r, 'sources-checked'), 'warn', 'a source is checked only when the author marks it');
    const checked = creativeReport(withSource(p, src('s1', true)), null, null);
    assert.equal(status(checked, 'sources-checked'), 'pass');
  });

  test('the series label has to be said in the opening narration', () => {
    const d = doc();
    assert.equal(status(creativeReport(base(), d, null), 'series-intro'), 'pass');
    const silent = structuredClone(d);
    silent.narration.segments[0].text = 'Your ticket screenshot can expire.';
    silent.narration.segments[1].text = 'It is still valid.';
    assert.equal(status(creativeReport(base(), silent, null), 'series-intro'), 'warn');
  });

  test('the first spoken sentence has to carry the hook', () => {
    const d = doc();
    assert.equal(status(creativeReport(base(), d, null), 'hook-spoken'), 'pass');
    const off = structuredClone(d);
    off.narration.segments[0].text = 'Tech Under the Hood, episode one.';
    const r = creativeReport(base(), off, null);
    assert.equal(status(r, 'hook-spoken'), 'warn');
    assert.match(r.items.find((i) => i.id === 'hook-spoken')!.detail, /heuristic/);
  });

  test('the brief, the visible demonstration and demand are asked for, and demand may be recorded as unverified', () => {
    const empty = creativeReport(base(), null, null);
    assert.equal(status(empty, 'brief'), 'todo');
    assert.equal(status(empty, 'demonstration'), 'todo');
    assert.equal(status(empty, 'demand'), 'todo');
    const p = withClaim({...base(), audience: 'Commuters', objective: 'Explain why', storyboard: [{id: 'sb1', segmentIds: [], sceneType: 'ticket-motion', intention: '', mechanism: 'A screenshot separates from the pass', pip: [], provenance: null}]},
      claim('demand', 'Demand is unverified: no dated audience-interest evidence recorded.', {kind: 'assumption'}));
    const r = creativeReport(p, null, null);
    assert.equal(status(r, 'brief'), 'pass');
    assert.equal(status(r, 'demonstration'), 'pass');
    assert.equal(status(r, 'demand'), 'pass');
  });

  test('the animatic row follows the animatic state', () => {
    const d = doc();
    for (const [state, want] of [['none', 'todo'], ['running', 'todo'], ['outdated', 'warn'], ['fresh', 'pass']] as const) {
      assert.equal(status(creativeReport(base(), d, {state}), 'animatic'), want, state);
    }
  });

  test('what only a person can judge is listed apart and never appears as a check', () => {
    const r = creativeReport(base(), doc(), null);
    assert.ok(GUIDANCE.length >= 5);
    assert.ok(r.guidance.some((g) => /Listen/.test(g)) && r.guidance.some((g) => /phone size/.test(g)) && r.guidance.some((g) => /approve/i.test(g)));
    for (const g of r.guidance) assert.ok(!r.items.some((i) => i.title === g));
  });
});
