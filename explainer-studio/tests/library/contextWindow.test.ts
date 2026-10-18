import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {describe, test} from 'node:test';
import {EpisodeSchemaV2} from '../../src/schema2.ts';
import {ROOT} from '../helpers.ts';
import {loadBundled} from './bundle.ts';

const raw = JSON.parse(readFileSync(join(ROOT, 'samples/context-window/episode.json'), 'utf8'));

// Estimated word timing, the same rule as scripts/phase3_checkpoint.ts (any plausible timing exercises the staging).
function estimate(doc: any, scale = 1) {
  let t = 0.8;
  const segments = doc.narration.segments.map((s: any) => {
    const start = t;
    const words = s.text.split(/\s+/).map((w: string) => {
      const a = t; t += (0.3 + Math.min(0.1, w.length * 0.01)) * scale;
      const e = t; if (/,$/.test(w)) t += 0.12 * scale; if (/[.?!]$/.test(w)) t += 0.18 * scale;
      return {text: w, start: a, end: e};
    });
    return {id: s.id, start, end: words[words.length - 1].end, words};
  });
  return {segments, durationSec: t + 2.5};
}

describe('the context-window sample', () => {
  test('the episode is valid, uses one scene, and every emphasis range still matches its words', () => {
    const r = EpisodeSchemaV2.safeParse(raw);
    assert.ok(r.success, JSON.stringify(r.success ? [] : r.error.issues));
    assert.equal(raw.scenes.length, 1);
    assert.equal(raw.scenes[0].type, 'context-window');
    assert.equal(raw.style, 'pip-paper-bundled');
    assert.equal(raw.voice.profile, 'pip-voice-v1', 'the approved Pip voice profile');
  });

  test('the illustrative pieces spell the prompt, and input plus output fit the window; a sample that breaks either is rejected', () => {
    const bad = (mutate: (p: any) => void) => { const d = structuredClone(raw); mutate(d.scenes[0].params); return EpisodeSchemaV2.safeParse(d); };
    assert.equal(bad((p) => { p.pieces = ['Why', ' is', ' the']; }).success, false);
    assert.equal(bad((p) => { p.outputTokens = 40; }).success, false);
    assert.equal(bad((p) => { p.inputTokens = 4; }).success, false);
    assert.equal(bad((p) => { p.note = ''; }).success, false);
  });

  test('every cue resolves from the narration; the score runs for every frame at several speaking speeds without a keyframe-order error', async () => {
    const m: any = await loadBundled(join(ROOT, 'tests/library/entries/cw-entry.ts'));
    for (const scale of [0.8, 1, 1.3]) {
      const {segments, durationSec} = estimate(raw, scale);
      const r = m.runScore(segments, durationSec, 30);
      assert.ok(r.finite, `finite poses at speed ${scale}`);
      assert.equal(Object.keys(r.cues).length, 21);
      const c = r.cues;
      // the order the scene relies on
      const order = ['window_in', 'label', 'prompt_in', 'split', 'tokens_fly', 'history', 'history_end', 'reply_start', 'reply_end', 'input_word', 'output_word', 'share', 'fill_more', 'full', 'leave', 'back'];
      for (let i = 1; i < order.length; i++) assert.ok(c[order[i]] >= c[order[i - 1]] - 1e-9, `${order[i - 1]} (${c[order[i - 1]]}) before ${order[i]} (${c[order[i]]}) at speed ${scale}`);
      // Pip is entirely out of frame while the two outcomes are shown, and back at his place at the end
      const at = (t: number) => r.ax[Math.round(t * 30)];
      assert.equal(at(c.leave + 0.8), r.ANCHOR_OFF_X);
      assert.ok(r.offBoxRight < 0, 'his whole box is left of the canvas');
      assert.equal(at(c.back - 0.05), r.ANCHOR_OFF_X);
      assert.equal(at(durationSec - 0.05), r.ANCHOR.ax);
      assert.equal(at(0.1), r.ANCHOR.ax);
      // he points twice: at the label and at the window
      const pointing = r.pointW.map((w: number) => w > 0.5);
      const runs = pointing.filter((v: boolean, i: number) => v && !pointing[i - 1]).length;
      assert.equal(runs, 2);
    }
  });

  test('a scene that lacks a cue the score needs fails loudly', async () => {
    const m: any = await loadBundled(join(ROOT, 'tests/library/entries/cw-entry.ts'));
    const {segments, durationSec} = estimate(raw);
    assert.throws(() => m.runScore(segments.slice(0, 7), durationSec, 30), /no segment|segment/i);
  });
});
