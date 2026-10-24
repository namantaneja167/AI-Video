// The richer rotating-ticket scene (ticket-motion): its document, its cue rules on the real script, and the motion helpers it uses.
// Pure: nothing is rendered here (the contact sheets and the phone-size review are separate, human steps).
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {describe, test} from 'node:test';
import {estimatedPreview} from '../../app/shared/estimate.ts';
import {DOCUMENT_SCENE_CUES, hasDynamicCues, sceneCueSpec} from '../../src/library/dynamicCues.ts';
import {anticipate, bezier, camMix, camPoint, damped, mix, pr, span, springOut} from '../../src/library/motion.ts';
import {TICKET_MOTION_CUES} from '../../src/library/ticketCues.ts';
import {EpisodeSchemaV2} from '../../src/schema2.ts';

const dir = join(import.meta.dirname, '../../samples/ticket');
const read = (f: string) => JSON.parse(readFileSync(join(dir, f), 'utf8'));

describe('the ticket-motion episode document', () => {
  const motion = read('episode.motion.json');
  const v1 = read('episode.json');

  test('is valid, keeps the earlier review video\'s script word for word, and is a separate revision', () => {
    const r = EpisodeSchemaV2.safeParse(motion);
    assert.ok(r.success, JSON.stringify(r.success ? [] : r.error.issues));
    assert.equal(r.data.id, v1.id, 'the same episode, a new revision');
    assert.equal(r.data.scenes[0].type, 'ticket-motion');
    assert.equal(v1.scenes[0].type, 'rotating-ticket', 'the earlier scene type is left intact');
    const text = (d: any) => d.narration.segments.map((s: any) => s.id + ':' + (s.speech ?? s.text));
    const a = text(motion), b = text(v1);
    assert.deepEqual(a.slice(1), b.slice(1), 'only the opening line may differ from the review draft');
  });

  test('opens hook-first: a short hook that fits the cover, the series label, and the series said aloud', () => {
    const d = EpisodeSchemaV2.parse(motion);
    const s0 = d.scenes[0];
    assert.ok(s0.openingHook && s0.openingHook.length <= 48);
    assert.equal(s0.seriesLabel, 'TECH UNDER THE HOOD · 01');
    assert.match(d.narration.segments[0].text, /^Your ticket screenshot can expire\./);
    assert.match(d.narration.segments[0].text, /Tech Under the Hood, episode one/);
    assert.equal(s0.openingUntilCue, 'series');
  });

  test('its cue rules resolve on the real script, in an order the scene relies on', () => {
    const d = EpisodeSchemaV2.parse(motion);
    assert.ok(hasDynamicCues(d.scenes));
    assert.equal(sceneCueSpec(d.scenes[0]), TICKET_MOTION_CUES);
    assert.equal(DOCUMENT_SCENE_CUES['ticket-motion'], TICKET_MOTION_CUES);
    const est = estimatedPreview(d);
    assert.deepEqual(est.problems, []);
    const cues = est.data.timeline.cues?.[d.scenes[0].id] ?? {};
    for (const k of Object.keys(TICKET_MOTION_CUES)) assert.ok(Number.isFinite(cues[k]), `cue ${k} resolves`);
    const order = ['hookshot', 'hookexpire', 'series', 'shot', 'time', 'gate', 'checks', 'window', 'fail', 'open', 'passes', 'static', 'resolve', 'voice_end'];
    for (let i = 1; i < order.length; i++) assert.ok(cues[order[i]] > cues[order[i - 1]], `${order[i - 1]} comes before ${order[i]}`);
    // the word-index cue lands inside its own line
    assert.ok(cues.passes > cues.open && cues.passes < cues.harder);
  });

  test('a word that is missing from the script is reported, not guessed', () => {
    const d = EpisodeSchemaV2.parse(motion);
    d.narration.segments[4].text = 'The reader looks at the pass.';
    const est = estimatedPreview(d);
    assert.ok(est.problems.length > 0, 'the cue that waits for "gate" cannot be placed');
  });

  test('the sound events it relies on are placed on cues the scene defines', () => {
    for (const cue of ['s2', 's4', 'resolve']) assert.ok(cue in TICKET_MOTION_CUES, cue);
  });
});

describe('the motion helpers', () => {
  test('easings start at 0 and end at 1', () => {
    for (const f of [springOut, anticipate]) { assert.ok(Math.abs(f(0)) < 1e-9); assert.ok(Math.abs(f(1) - 1) < 1e-9); }
    assert.ok(springOut(0.7) > 1, 'a spring overshoots');
    assert.ok(anticipate(0.2) < 0, 'an anticipation pulls back first');
  });
  test('progress and span are clamped and ordered', () => {
    assert.equal(pr(0, 1, 1), 0);
    assert.equal(pr(5, 1, 1), 1);
    assert.equal(span(0.5, 1, 3), 0);
    assert.ok(span(2, 1, 3) > 0.99);
    assert.equal(span(10, 1, 3), 0);
  });
  test('a damped wobble is still before it starts and decays after', () => {
    assert.equal(damped(0.5, 1), 0);
    assert.ok(Math.abs(damped(1.05, 1)) > Math.abs(damped(3, 1)));
  });
  test('a curved path starts and ends on its anchors', () => {
    const a: [number, number] = [10, 20], c: [number, number] = [100, -50], b: [number, number] = [200, 80];
    assert.deepEqual(bezier(a, c, b, 0), a);
    assert.deepEqual(bezier(a, c, b, 1), b);
    assert.notDeepEqual(bezier(a, c, b, 0.5), mix(a, b, 0.5), 'the control point bends the path');
  });
  test('the camera maps a world point to the screen consistently', () => {
    const cam = camMix({k: 1, x: 0, y: 0}, {k: 2, x: 100, y: 50}, 1);
    assert.deepEqual(cam, {k: 2, x: 100, y: 50});
    assert.deepEqual(camPoint(cam, [100, 50], [540, 900]), [540, 900], 'the camera centre stays at the screen centre');
  });
});
