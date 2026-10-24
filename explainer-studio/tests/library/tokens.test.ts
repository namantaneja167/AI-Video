import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {test} from 'node:test';
import {EpisodeSchemaV2} from '../../src/schema2.ts';
import {SCENE_CUES} from '../../src/library/sceneSpecs.ts';
import {resolveCues} from '../../src/library/cues.ts';
import {parseInput} from '../../app/shared/packet.ts';
import {loadBundled} from './bundle.ts';

const dir = join(import.meta.dirname, '../../samples/ai-maxxing-01');
const read = (f: string) => JSON.parse(readFileSync(join(dir, f), 'utf8'));
const episode = read('episode.json');
const evidence = read('tokenizer-evidence.json');
const NUMBER_WORD: Record<number, string> = {6: 'six', 8: 'eight', 10: 'ten', 23: 'twenty-three'};

test('the tokens episode is valid, in the series format, with a hook that fits the cover', () => {
  const r = EpisodeSchemaV2.safeParse(episode);
  assert.ok(r.success, JSON.stringify(r.success ? [] : r.error.issues));
  assert.equal(r.data.voice.engine, 'qwen3-tts');
  assert.equal(r.data.scenes[0].type, 'token-journey');
  const hook = r.data.scenes[0].openingHook!;
  assert.ok(hook.length <= 48 && hook.split(/\s+/).length <= 8, hook);
  const spokenIntro = "AI Maxxing, part one of ten. AI doesn't read one word at a time. ";
  assert.ok(r.data.narration.segments[0].text.startsWith(spokenIntro));
  assert.equal(r.data.scenes[0].openingUntilCue, 'example_start');
  const words = r.data.narration.segments.reduce((n: number, s: {text: string}) => n + s.text.replace(spokenIntro, '').split(/\s+/).length, 0);
  assert.ok(words >= 95 && words <= 115, `${words} words in the explanation body exceeds its script budget`);
});

test('every split, id and count on screen is the recorded tokenizer output, and the script quotes the same counts', () => {
  const p = episode.scenes[0].params;
  assert.deepEqual(p.example.pieces, evidence.example.pieces);
  assert.deepEqual(p.example.ids, evidence.example.ids);
  assert.equal(p.example.pieces.join(''), p.example.text);
  assert.equal(p.comparison.english.tokens, evidence.languageComparison.english.tokens);
  assert.equal(p.comparison.hindi.tokens, evidence.languageComparison.hindi.tokens);
  assert.equal(p.tokenizer.name, evidence.tokenizer.name);
  assert.match(evidence.tokenizer.revision, /^[0-9a-f]{40}$/);
  const script = episode.narration.segments.map((s: {text: string}) => s.text).join(' ').toLowerCase();
  for (const n of [evidence.example.words, evidence.example.tokens, evidence.languageComparison.english.tokens, evidence.languageComparison.hindi.tokens]) {
    assert.ok(script.replace(/-/g, ' ').includes(NUMBER_WORD[n].replace(/-/g, ' ')), `the script should say ${NUMBER_WORD[n]}`);
  }
  assert.match(script, /another model could split it differently|other tokenizers can split the same text differently/);
});

test('inconsistent token data is refused: pieces that do not spell the text, or ids that do not match the pieces', () => {
  const bad = (mutate: (p: any) => void) => {
    const copy = structuredClone(episode);
    mutate(copy.scenes[0].params);
    return EpisodeSchemaV2.safeParse(copy).success;
  };
  assert.equal(bad(() => undefined), true);
  assert.equal(bad((p) => { p.example.pieces[0] = 'Rex'; }), false);
  assert.equal(bad((p) => { p.example.ids.pop(); }), false);
  assert.equal(bad((p) => { p.invented = true; }), false);
});

test('the scene cues resolve in narration order on the real script', () => {
  const spec = SCENE_CUES['token-journey'];
  assert.ok(spec);
  let t = 0.5;
  const segments = episode.narration.segments.map((s: {id: string; text: string}) => {
    const start = t;
    const words = s.text.split(/\s+/).map((text: string) => { const w = {text, start: t, end: t + 0.3}; t += 0.32; return w; });
    t += 0.2;
    return {id: s.id, start, end: t - 0.2, words};
  });
  const c = resolveCues(spec, segments);
  const order = ['intro', 'example_start', 'type', 'words', 'split', 'pieces', 'break', 'jio', 'numbers', 'model', 'count', 'ten', 'language', 'english', 'hindi', 'other', 'check', 'resolve'];
  order.forEach((n, i) => { assert.ok(Number.isFinite(c[n]), n); if (i) assert.ok(c[n] >= c[order[i - 1]], `${n} must not come before ${order[i - 1]}`); });
  assert.throws(() => resolveCues(spec, segments.slice(0, 7)), /no segment/);
});

test('the highlighted stage follows the narration: text, split, numbers, count, check', async () => {
  const {tokenState} = await loadBundled(join(import.meta.dirname, 'entries/token-entry.ts'));
  const names = ['intro', 'type', 'words', 'split', 'pieces', 'break', 'jio', 'numbers', 'model', 'count', 'ten', 'language', 'english', 'hindi', 'other', 'check', 'resolve'];
  const q = Object.fromEntries(names.map((n, i) => [n, 1 + i * 3]));
  const at = (n: string, dt = 0.1) => tokenState(q[n] + dt, q);
  assert.deepEqual([at('type').step, at('words').step], [0, 0]);
  assert.deepEqual([at('split').step, at('break').step, at('jio').step], [1, 1, 1]);
  assert.deepEqual([at('numbers').step, at('model').step], [2, 2]);
  assert.deepEqual([at('count').step, at('language').step, at('hindi').step, at('other').step], [3, 3, 3, 3]);
  assert.equal(at('check').step, 4);
  assert.equal(at('resolve').phase, 'resolve');
  assert.equal(tokenState(0.2, q).phase, 'intro');
});

test('separating pieces never overlap their neighbours, and the end state is the chip layout', async () => {
  const {flowLayout, rowsOf} = await loadBundled(join(import.meta.dirname, 'entries/token-entry.ts'));
  const pieces: string[] = evidence.example.pieces;
  const CW = 24;
  const rows: number[] = rowsOf(pieces);
  assert.ok(rows.every((r, i) => i === 0 || r >= rows[i - 1]), 'lines only go down');
  for (let cascade = 0; cascade <= pieces.length + 1; cascade++) {
    for (const frac of [0, 0.25, 0.5, 1]) {
      const e = pieces.map((_, i) => (i < cascade - 1 ? 1 : i === cascade - 1 ? frac : 0));
      const pos = flowLayout(pieces, e);
      for (let i = 1; i < pieces.length; i++) {
        if (rows[i] !== rows[i - 1]) continue;
        const prevEnd = pos[i - 1].x + pieces[i - 1].length * CW;
        assert.ok(pos[i].x >= prevEnd - 1e-6, `piece ${i} overlaps piece ${i - 1} at step ${cascade}/${frac}`);
      }
    }
  }
  const settled = flowLayout(pieces, pieces.map(() => 1));
  assert.equal(settled[0].x, 18, 'a chip keeps 18 px of padding before its text');
  assert.ok(Math.max(...settled.map((p: {x: number}, i: number) => p.x + pieces[i].length * CW + 18)) <= 840 + 1e-6, 'every line fits the card');
});

test('the planning packets for the tokens episode are accepted by the importer, with the real counts in the claims', () => {
  const ctx = {existingSourceIds: [] as string[], existingScriptSegments: null};
  const research = parseInput(readFileSync(join(dir, 'research-packet.json'), 'utf8'), ctx);
  assert.ok(research.ok, JSON.stringify(research.ok ? [] : research.errors));
  assert.ok(research.proposal.sources.length >= 4 && research.proposal.claims.length >= 6);
  assert.ok(research.proposal.sources.some((s) => s.url?.includes('help.openai.com')));
  assert.ok(research.proposal.claims.some((c) => c.text.includes(`${evidence.example.tokens} tokens`)));
  assert.ok(research.proposal.claims.every((c) => c.kind !== 'fact' || c.evidence.length > 0), 'every fact says where it comes from');
  const script = parseInput(readFileSync(join(dir, 'script-packet.json'), 'utf8'), ctx);
  assert.ok(script.ok && script.proposal.script?.length === 9);
  const board = parseInput(readFileSync(join(dir, 'storyboard-packet.json'), 'utf8'), {existingSourceIds: [], existingScriptSegments: 9});
  assert.ok(board.ok, JSON.stringify(board.ok ? [] : board.errors));
  assert.equal(board.proposal.storyboard?.[0].sceneType, 'token-journey');
});
