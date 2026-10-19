// The production checks, one section at a time. Each check has a fixture that must fail it and one that must pass it. Measurements come
// from real files (speech-like WAV files and small MP4 files made here with ffmpeg) or from probe data of the shape the browser produces.
import assert from 'node:assert/strict';
import {mkdirSync, readFileSync, truncateSync, writeFileSync, copyFileSync, statSync} from 'node:fs';
import {join} from 'node:path';
import {before, describe, test} from 'node:test';
import {
  analyzeLayout, captionDiffHash, checkCaptions, checkFile, checkNarration, buildReport, CHECKS_VERSION, type CheckItem, type FileInput, type LayoutInput, type TakeInput,
} from '../../core/checks.ts';
import {sha256File} from '../../core/hash.ts';
import {analyzeWav, measureAudio, measureVideo, probeMedia, readWav} from '../../core/media.ts';
import {missingSpoken, captionNumbers, numberToWords, speaks, spokenForms, yearToWords} from '../../core/numberWords.ts';
import type {ProbeElement, ProbeSample} from '../../src/library/probeTypes.ts';
import {EpisodeSchemaV2, type EpisodeV2} from '../../src/schema2.ts';
import {mkTmp} from '../helpers.ts';
import {writeSpeechWav, writeVideo} from '../media-fixtures.ts';

const item = (items: CheckItem[], id: string): CheckItem => { const i = items.find((x) => x.id === id); assert.ok(i, `no check "${id}" in ${items.map((x) => x.id).join(', ')}`); return i; };
const words14 = (tag: string) => `${tag} one two three four five six seven eight nine ten eleven twelve thirteen`;

function makeDoc(segs: {id: string; text: string; speech?: string; captions?: string[]}[], blocks: string[][], extra: Record<string, unknown> = {}): EpisodeV2 {
  return EpisodeSchemaV2.parse({
    schemaVersion: 2, id: 'checks-fixture', title: 'Checks fixture', learningObjective: 'x', style: 'pip-paper', voice: {engine: 'qwen3-tts', profile: 'pip-voice-v1'},
    narration: {segments: segs, blocks: blocks.map((s, i) => ({id: `b${i + 1}`, segments: s}))},
    scenes: [{id: 'sc1', type: 'pip-cards', segments: segs.map((s) => s.id), params: {cards: [{heading: 'A'}]}}], ...extra,
  });
}

describe('numbers as spoken words', () => {
  test('standard and year readings, as the legacy verify accepts them', () => {
    assert.equal(numberToWords(600), 'six hundred');
    assert.equal(numberToWords(1234), 'one thousand two hundred thirty four');
    assert.equal(numberToWords(0), 'zero');
    assert.equal(yearToWords(1999), 'nineteen ninety nine');
    assert.equal(yearToWords(2005), 'two thousand five');
    assert.ok(spokenForms(1999).includes('nineteen ninety nine'));
    assert.ok(speaks('It cost six hundred rupees', 600));
    assert.ok(speaks('one thousand, two hundred and thirty-four', 1234));
    assert.equal(speaks('It cost six hundred and fifty rupees', 600), false);
  });
  test('currency, percent and decimals must be said too', () => {
    const [n] = captionNumbers('₹600');
    assert.equal(missingSpoken('six hundred rupees', n), null);
    assert.match(missingSpoken('six hundred', n)!, /currency/);
    assert.match(missingSpoken('five hundred rupees', n)!, /six hundred/);
    assert.equal(missingSpoken('twelve percent', captionNumbers('12%')[0]), null);
    assert.match(missingSpoken('twelve', captionNumbers('12%')[0])!, /percent/);
    assert.equal(missingSpoken('three point one four', captionNumbers('3.14')[0]), null);
  });
});

describe('narration checks (7.1)', () => {
  let dir: string;
  const wav = (name: string, o: Parameters<typeof writeSpeechWav>[1]) => { const p = join(dir, name); writeSpeechWav(p, o); return p; };
  const take = (p: string): TakeInput => ({present: true, facts: analyzeWav(readWav(p))});
  const segs = [{id: 's1', text: words14('First')}, {id: 's2', text: words14('Second')}];
  const doc = makeDoc(segs, [['s1'], ['s2']]);
  const timing = {source: 'aligned', durationSec: 12, segments: [{id: 's1', start: 0.1, end: 5.6}, {id: 's2', start: 6.1, end: 11.6}]};
  before(() => { dir = mkTmp('studio-checks-wav-'); mkdirSync(dir, {recursive: true}); });

  test('PASS: two readable takes of a natural pace, speech throughout, ending quietly, with plausible timing', () => {
    const good = {b1: take(wav('g1.wav', {seconds: 5.5})), b2: take(wav('g2.wav', {seconds: 5.5}))};
    const items = checkNarration(doc, good, timing);
    for (const id of ['narration.takes', 'narration.duration', 'narration.pace', 'narration.energy', 'narration.gaps', 'narration.ending', 'narration.alignment']) assert.equal(item(items, id).status, 'pass', `${id}: ${item(items, id).detail}`);
  });

  test('FAIL: a block with no take, or a take file that cannot be read', () => {
    const t = {b1: take(wav('g3.wav', {seconds: 5.5})), b2: {present: false} as TakeInput};
    const takes = item(checkNarration(doc, t, timing), 'narration.takes');
    assert.equal(takes.status, 'fail');
    assert.match(takes.lines![0], /block b2.*no selected take/);
    const unreadable = item(checkNarration(doc, {b1: take(wav('g4.wav', {seconds: 5.5})), b2: {present: true, error: 'not a WAV file'}}, timing), 'narration.takes');
    assert.equal(unreadable.status, 'fail');
    assert.match(unreadable.lines![0], /cannot be read/);
  });

  test('FAIL: a take that is far too short for its words, and one far too long (duration plausibility)', () => {
    const short = {b1: take(wav('s1.wav', {seconds: 1.5})), b2: take(wav('s2.wav', {seconds: 5.5}))};
    const d = item(checkNarration(doc, short, timing), 'narration.duration');
    assert.equal(d.status, 'fail');
    assert.match(d.lines![0], /block b1.*words a second/);
    const long = {b1: take(wav('l1.wav', {seconds: 30})), b2: take(wav('l2.wav', {seconds: 5.5}))};
    assert.equal(item(checkNarration(doc, long, timing), 'narration.duration').status, 'fail');
  });

  test('WARN (heuristic, not a failure): an unusual but possible pace', () => {
    const slow = {b1: take(wav('p1.wav', {seconds: 9})), b2: take(wav('p2.wav', {seconds: 5.5}))}; // 13 words / 9 s is about 1.4 wps... inside the hard range, outside the usual one
    const pace = item(checkNarration(doc, slow, timing), 'narration.pace');
    assert.equal(pace.status, 'warn');
    assert.equal(pace.kind, 'heuristic');
    assert.equal(item(checkNarration(doc, slow, timing), 'narration.duration').status, 'pass');
  });

  test('FAIL: a long silent gap inside a take; PASS right below the limit', () => {
    const gap = {b1: take(wav('gap1.wav', {seconds: 6, gaps: [[2, 4.2]]})), b2: take(wav('g5.wav', {seconds: 5.5}))};
    const g = item(checkNarration(doc, gap, timing), 'narration.gaps');
    assert.equal(g.status, 'fail');
    assert.match(g.lines![0], /silent gap of 2\.\d+ s/);
    const ok = {b1: take(wav('gap2.wav', {seconds: 6, gaps: [[2, 3.2]]})), b2: take(wav('g6.wav', {seconds: 5.5}))};
    assert.equal(item(checkNarration(doc, ok, timing), 'narration.gaps').status, 'pass');
  });

  test('FAIL: a stretch of the take with no speech-level sound that is not true silence (a dropout)', () => {
    const faint = {b1: take(wav('f1.wav', {seconds: 8, faint: [[2.1, 3.9]]})), b2: take(wav('g7.wav', {seconds: 5.5}))};
    const e = item(checkNarration(doc, faint, {...timing, durationSec: 14, segments: timing.segments}), 'narration.energy');
    assert.equal(e.status, 'fail');
    assert.match(e.lines![0], /quarter 2/);
  });

  test('FAIL: a take that stops abruptly (the last samples are still loud); PASS when it finishes quietly', () => {
    const cut = {b1: take(wav('c1.wav', {seconds: 5.5, abruptEnd: true})), b2: take(wav('g8.wav', {seconds: 5.5}))};
    const end = item(checkNarration(doc, cut, timing), 'narration.ending');
    assert.equal(end.status, 'fail');
    assert.match(end.lines![0], /stops abruptly/);
    assert.equal(item(checkNarration(doc, {b1: take(wav('c2.wav', {seconds: 5.5})), b2: take(wav('g9.wav', {seconds: 5.5}))}, timing), 'narration.ending').status, 'pass');
  });

  test('FAIL: timing that is out of order, outside the audio or implausible; the timing source is shown, and an estimate is warned about', () => {
    const good = {b1: take(wav('t1.wav', {seconds: 5.5})), b2: take(wav('t2.wav', {seconds: 5.5}))};
    const bad = {source: 'estimated', durationSec: 12, segments: [{id: 's1', start: 0.1, end: 5.6}, {id: 's2', start: 5.0, end: 99}]};
    const a = item(checkNarration(doc, good, bad), 'narration.alignment');
    assert.equal(a.status, 'fail');
    assert.ok(a.lines!.some((l) => /before the previous segment ends|after the audio/.test(l)));
    assert.equal(item(checkNarration(doc, good, bad), 'narration.timing-source').status, 'warn');
    const tooFast = {source: 'aligned', durationSec: 12, segments: [{id: 's1', start: 0.1, end: 0.4}, {id: 's2', start: 6.1, end: 11.6}]};
    assert.match(item(checkNarration(doc, good, tooFast), 'narration.alignment').lines![0], /not a plausible duration/);
    assert.equal(item(checkNarration(doc, good, null), 'narration.alignment').status, 'unchecked');
  });

  test('a dropped word is NOT detected: the check says so and is manual', () => {
    const items = checkNarration(doc, {b1: take(wav('m1.wav', {seconds: 5.5})), b2: take(wav('m2.wav', {seconds: 5.5}))}, timing);
    const w = item(items, 'narration.words');
    assert.equal(w.kind, 'manual');
    assert.equal(w.status, 'unchecked');
    assert.match(w.detail, /cannot show that a word was left out/);
    assert.equal(item(items, 'narration.seams').kind, 'manual');
  });
});

describe('caption versus spoken text (7.2)', () => {
  const none = () => false;
  test('PASS: identical caption and speech', () => {
    const {items, diffs} = checkCaptions(makeDoc([{id: 's1', text: 'Tokens are pieces of text.', captions: ['Tokens are', 'pieces of text.']}], [['s1']]), none);
    for (const id of ['captions.phrases', 'captions.overrides', 'captions.numbers', 'captions.diff']) assert.equal(item(items, id).status, 'pass', id);
    assert.deepEqual(diffs, []);
  });

  test('PASS: an intentional difference (₹600 spoken as six hundred rupees) once the author has confirmed exactly this wording', () => {
    const d = makeDoc([{id: 's1', text: 'It costs ₹600.', speech: 'It costs six hundred rupees.'}], [['s1']]);
    const first = checkCaptions(d, none);
    assert.equal(item(first.items, 'captions.numbers').status, 'pass');
    assert.equal(item(first.items, 'captions.diff').status, 'fail', 'unconfirmed differences are failures until the author confirms them');
    assert.equal(first.diffs.length, 1);
    const hash = first.diffs[0].hash;
    assert.equal(hash, captionDiffHash('It costs ₹600.', 'It costs six hundred rupees.'));
    const second = checkCaptions(d, (seg, h) => seg === 's1' && h === hash);
    assert.equal(item(second.items, 'captions.diff').status, 'pass');
    // a confirmation belongs to the exact pair: change the speech and it no longer applies
    const edited = makeDoc([{id: 's1', text: 'It costs ₹600.', speech: 'It costs six hundred and one rupees.'}], [['s1']]);
    assert.equal(item(checkCaptions(edited, (seg, h) => seg === 's1' && h === hash).items, 'captions.diff').status, 'fail');
  });

  test('FAIL: digits or a symbol in the caption with no spoken reading', () => {
    const o = item(checkCaptions(makeDoc([{id: 's1', text: 'It costs ₹600.'}], [['s1']]), none).items, 'captions.overrides');
    assert.equal(o.status, 'fail');
    assert.match(o.lines![0], /segment s1/);
    const still = item(checkCaptions(makeDoc([{id: 's1', text: 'It costs ₹600.', speech: 'It costs 600 rupees.'}], [['s1']]), none).items, 'captions.overrides');
    assert.equal(still.status, 'fail');
  });

  test('FAIL: a number spoken differently from the caption', () => {
    const n = item(checkCaptions(makeDoc([{id: 's1', text: 'It costs ₹600.', speech: 'It costs five hundred rupees.'}], [['s1']]), none).items, 'captions.numbers');
    assert.equal(n.status, 'fail');
    assert.match(n.lines![0], /six hundred/);
  });

  test('FAIL: caption phrases that do not spell the segment text; an unlisted word difference is shown as a diff', () => {
    const p = item(checkCaptions(makeDoc([{id: 's1', text: 'Tokens are pieces of text.', captions: ['Tokens are', 'bits of text.']}], [['s1']]), none).items, 'captions.phrases');
    assert.equal(p.status, 'fail');
    const diff = checkCaptions(makeDoc([{id: 's1', text: 'Tokens are pieces of text.', speech: 'Tokens are small pieces of text.'}], [['s1']]), none);
    assert.deepEqual(diff.diffs[0].spokenOnly, ['small']);
    assert.deepEqual(diff.diffs[0].captionOnly, []);
    assert.equal(item(diff.items, 'captions.diff').status, 'fail');
  });
});

// ---- layout ------------------------------------------------------------------------------------------------------------------
const rect = (x: number, y: number, w: number, h: number) => ({x, y, w, h});
const card = (n: number, y: number, extra: Partial<ProbeElement> = {}): ProbeElement[] => [
  {id: `card${n}`, kind: 'box', essential: true, rect: rect(60, y, 960, 240), opacity: 1},
  {id: `card${n}-heading`, kind: 'text', essential: true, parent: `card${n}`, rect: rect(86, y + 26, 600, 60), opacity: 1, fontPx: 48, stack: '"Inter", sans-serif', text: 'Heading', clipped: {x: false, y: false}, ...extra},
];
const sampleOf = (elements: ProbeElement[], o: Partial<ProbeSample> = {}): ProbeSample => ({frame: 90, t: 3, scene: 'sc1', elements, fonts: [{stack: '"Inter", sans-serif', first: 'Inter', resolved: 'Inter'}], faces: [{family: 'Inter', weight: '400', status: 'loaded'}], ...o});
const layoutInput = (samples: ProbeSample[], o: Partial<LayoutInput> = {}): LayoutInput => ({
  style: 'pip-paper-bundled', probed: true, samples, scenes: [{id: 'sc1', type: 'pip-cards', layoutId: 'content-led', captionsOn: true, mascotShown: true}], ...o,
});

describe('fonts, overflow and obscured content (7.3)', () => {
  test('PASS: marked text inside its boxes, clear of the caption zone, Pip and the unsafe areas, in a loaded font, large enough', () => {
    const items = analyzeLayout(layoutInput([sampleOf([...card(1, 200), ...card(2, 460)])]));
    for (const id of ['layout.fonts', 'layout.overflow', 'layout.overlap', 'layout.size', 'layout.coverage']) assert.equal(item(items, id).status, 'pass', `${id}: ${item(items, id).detail}`);
    assert.equal(item(items, 'layout.overlap').kind, 'measured');
  });

  test('FAIL: text that overflows its box', () => {
    const over = card(1, 200, {clipped: {x: false, y: true}, text: 'A long card body'});
    const o = item(analyzeLayout(layoutInput([sampleOf(card(1, 200).slice(0, 1).concat(over.slice(1)))])), 'layout.overflow');
    assert.equal(o.status, 'fail');
    assert.match(o.lines![0], /card1-heading.*runs past its height/);
  });

  test('FAIL: two essential boxes that overlap; an element under the caption zone; one under Pip; one in the unsafe area', () => {
    const two = analyzeLayout(layoutInput([sampleOf([...card(1, 200), ...card(2, 300)])]));
    assert.equal(item(two, 'layout.overlap').status, 'fail');
    assert.ok(item(two, 'layout.overlap').lines!.some((l) => /card1 overlaps card2/.test(l)));
    const caption = analyzeLayout(layoutInput([sampleOf(card(1, 1500))]));
    assert.ok(item(caption, 'layout.overlap').lines!.some((l) => /caption zone/.test(l)));
    const pip = analyzeLayout(layoutInput([sampleOf(card(1, 1150))]));
    assert.ok(item(pip, 'layout.overlap').lines!.some((l) => /Pip's box/.test(l)));
    const unsafe = analyzeLayout(layoutInput([sampleOf([{id: 'card1', kind: 'box', essential: true, rect: rect(0, 200, 1080, 240), opacity: 1}])]));
    assert.ok(item(unsafe, 'layout.overlap').lines!.some((l) => /safe area/.test(l)));
  });

  test('an element that may sit under Pip, and one that is still fading in, are not reported', () => {
    const under = analyzeLayout(layoutInput([sampleOf(card(1, 1150).map((e) => ({...e, mayOverlapMascot: true})))]));
    assert.equal(item(under, 'layout.overlap').status, 'pass');
    const fading = analyzeLayout(layoutInput([sampleOf([...card(1, 200), ...card(2, 300).map((e) => ({...e, opacity: 0.4}))])]));
    assert.equal(item(fading, 'layout.overlap').status, 'pass');
  });

  test('a card that overshoots the safe area while it enters is judged where it rests; one only seen entering is listed as not examined', () => {
    const overshoot = (y: number) => card(3, y).map((e) => (e.id === 'card3' ? {...e, rect: rect(58, y, 964, 240), moving: true} : {...e, moving: true}));
    const enters = analyzeLayout(layoutInput([sampleOf(overshoot(720), {frame: 322}), sampleOf(card(3, 720), {frame: 400})]));
    assert.equal(item(enters, 'layout.overlap').status, 'pass', 'the card is inside the safe area at rest');
    assert.equal(enters.some((x) => x.id === 'layout.entrance'), false, 'nothing is listed when every element was seen at rest');
    const never = analyzeLayout(layoutInput([sampleOf(overshoot(720), {frame: 322}), sampleOf(overshoot(720), {frame: 400})]));
    assert.equal(item(never, 'layout.overlap').status, 'pass', 'a mid-entrance rectangle is not judged');
    assert.equal(item(never, 'layout.entrance').status, 'unchecked', 'but the check says it could not see it at rest');
    assert.equal(item(never, 'layout.entrance').kind, 'partial');
    assert.match(item(never, 'layout.entrance').lines![0], /sc1: card3/);
    const restsOutside = analyzeLayout(layoutInput([sampleOf(overshoot(720), {frame: 322}), sampleOf(card(3, 720).map((e) => (e.id === 'card3' ? {...e, rect: rect(40, 720, 1000, 240)} : e)), {frame: 400})]));
    assert.equal(item(restsOutside, 'layout.overlap').status, 'fail', 'a card that rests outside the safe area is still reported');
  });

  test('FAIL: text drawn below the layout minimum (essential 36 px, secondary 28 px)', () => {
    const small = analyzeLayout(layoutInput([sampleOf(card(1, 200, {fontPx: 30}))]));
    assert.equal(item(small, 'layout.size').status, 'fail');
    assert.match(item(small, 'layout.size').lines![0], /30 px; the minimum is 36 px/);
    const secondary = analyzeLayout(layoutInput([sampleOf(card(1, 200, {fontPx: 30, essential: false}))]));
    assert.equal(item(secondary, 'layout.size').status, 'pass');
  });

  test('FAIL: a font that failed to load, a bundled font that was not used, and text that fell back to a generic font', () => {
    const failed = analyzeLayout(layoutInput([sampleOf(card(1, 200), {faces: [{family: 'Inter', weight: '700', status: 'error'}]})]));
    assert.equal(item(failed, 'layout.fonts').status, 'fail');
    const fallback = analyzeLayout(layoutInput([sampleOf(card(1, 200), {fonts: [{stack: '"Inter", sans-serif', first: 'Inter', resolved: 'Helvetica'}]})]));
    assert.match(item(fallback, 'layout.fonts').lines![0], /fell back to "Helvetica"/);
    const generic = analyzeLayout(layoutInput([sampleOf(card(1, 200), {fonts: [{stack: '"NoSuchFont", sans-serif', first: 'NoSuchFont', resolved: null}]})]));
    assert.match(item(generic, 'layout.fonts').lines![0], /generic font/);
  });

  test('system font stack: a later family in use is a heuristic warning, not a failure', () => {
    const items = analyzeLayout(layoutInput([sampleOf(card(1, 200), {fonts: [{stack: '"SF Pro Display", Arial, sans-serif', first: 'SF Pro Display', resolved: 'Arial'}]})], {style: 'pip-paper'}));
    assert.equal(item(items, 'layout.fonts').status, 'pass');
    assert.equal(item(items, 'layout.fonts-stack').status, 'warn');
    assert.equal(item(items, 'layout.fonts-stack').kind, 'heuristic');
  });

  test('PARTIAL: the frozen prototype scene in a bundled-font episode is reported as not using the bundled fonts; the system style does not report it', () => {
    const scenes = [{id: 'sc1', type: 'pip-scene-10x', layoutId: 'content-led', captionsOn: false, mascotShown: false}];
    const bundled = analyzeLayout(layoutInput([sampleOf(card(1, 200))], {style: 'pip-paper-bundled', scenes}));
    assert.equal(item(bundled, 'layout.fonts-fixed').status, 'unchecked');
    assert.equal(item(bundled, 'layout.fonts-fixed').kind, 'partial');
    assert.match(item(bundled, 'layout.fonts-fixed').lines![0], /sc1 \(pip-scene-10x\)/);
    assert.equal(analyzeLayout(layoutInput([sampleOf(card(1, 200))], {style: 'pip-paper', scenes})).some((x) => x.id === 'layout.fonts-fixed'), false);
  });

  test('PARTIAL: a scene with no marked elements is reported as only partly checked, and a custom (tier 3) scene as generic-checks-only', () => {
    const items = analyzeLayout(layoutInput([sampleOf(card(1, 200))], {scenes: [
      {id: 'sc1', type: 'pip-cards', layoutId: 'content-led', captionsOn: true, mascotShown: true},
      {id: 'sc2', type: 'context-window', layoutId: 'content-led', captionsOn: true, mascotShown: true},
    ]}));
    const cov = item(items, 'layout.coverage');
    assert.equal(cov.status, 'unchecked');
    assert.equal(cov.kind, 'partial');
    assert.match(cov.detail, /only partly checked/);
    assert.deepEqual(cov.lines, ['sc2 (context-window): no marked elements']);
    const custom = item(items, 'custom.scenes');
    assert.equal(custom.kind, 'partial');
    assert.match(custom.detail, /does not claim to verify their content or look/);
  });

  test('PARTIAL: an episode drawn by the legacy renderer has no probe and says so', () => {
    const items = analyzeLayout(layoutInput([], {probed: false, style: 'legacy-dark'}));
    assert.equal(items.length, 1);
    assert.equal(items[0].status, 'unchecked');
    assert.match(items[0].detail, /legacy path/);
  });
});

// ---- the video file and its mastering ----------------------------------------------------------------------------------------
describe('the video file and its mastering (7.4)', () => {
  let dir: string;
  const files: Record<string, string> = {};
  const TARGET = {lufs: -16, truePeakDb: -1.5};
  const EXPECTED = {durationSec: 4, width: 1080, height: 1920, fps: 30};
  before(() => {
    dir = mkTmp('studio-checks-mp4-');
    mkdirSync(dir, {recursive: true});
    const make = (name: string, o: Parameters<typeof writeVideo>[1]) => { files[name] = join(dir, `${name}.mp4`); writeVideo(files[name], o); };
    make('final', {seconds: 4, lufs: -16});
    make('quiet', {seconds: 4, lufs: -30});
    make('loud', {seconds: 4, lufs: -6});
    make('silentvideo', {seconds: 4});
    make('small', {seconds: 4, lufs: -16, width: 720, height: 1280});
    make('frag', {seconds: 4, lufs: -16, fragmented: true});
    // a fragmented file cut short is still readable, but it ends early
    files.cut = join(dir, 'cut.mp4');
    copyFileSync(files.frag, files.cut);
    truncateSync(files.cut, Math.floor(statSync(files.frag).size * 0.45));
    // a file cut so that its structure is gone
    files.broken = join(dir, 'broken.mp4');
    copyFileSync(files.final, files.broken);
    truncateSync(files.broken, 400);
  });

  async function input(name: string, o: Partial<FileInput> = {}): Promise<FileInput> {
    const path = files[name];
    const sha = sha256File(path).hash;
    let probe = null, probeError: string | undefined;
    try { probe = await probeMedia(path); } catch (e) { probeError = (e as Error).message; }
    const audio = probe ? await measureAudio(path) : null;
    const video = probe ? await measureVideo(path) : null;
    return {kind: 'final', recordedSha256: sha, actualSha256: sha, probe, probeError, audio, video, expected: EXPECTED, target: TARGET, markedMastered: true, ...o};
  }

  test('PASS: a mastered final file at the target loudness, with the expected streams, decoding completely, matching its recorded hash', async () => {
    const items = checkFile(await input('final'));
    for (const id of ['file.hash', 'file.container', 'file.decode', 'mastering.loudness', 'mastering.flag']) assert.equal(item(items, id).status, 'pass', `${id}: ${item(items, id).detail}${(item(items, id).lines ?? []).join('; ')}`);
    assert.match(item(items, 'mastering.loudness').detail, /measured on the audio inside the file/);
  });

  test('FAIL: audio too quiet, and audio too loud with its true peak over the limit', async () => {
    const quiet = item(checkFile(await input('quiet')), 'mastering.loudness');
    assert.equal(quiet.status, 'fail');
    assert.match(quiet.lines![0], /integrated loudness is -3\d(\.\d+)? LUFS; the target is -16/);
    const loud = item(checkFile(await input('loud')), 'mastering.loudness');
    assert.equal(loud.status, 'fail');
    assert.ok(loud.lines!.length >= 1);
  });

  test('a DRAFT always reports "not mastered", with the measured loudness as a fact and not as a pass', async () => {
    const items = checkFile(await input('loud', {kind: 'draft', markedMastered: false}));
    const l = item(items, 'mastering.loudness');
    assert.equal(l.status, 'info');
    assert.match(l.detail, /Not mastered.*cannot be approved or exported/);
    assert.equal(items.some((i) => i.id === 'mastering.flag'), false);
  });

  test('FAIL: a final render that is not recorded as mastered', async () => {
    assert.equal(item(checkFile(await input('final', {markedMastered: false})), 'mastering.flag').status, 'fail');
  });

  test('FAIL: no audio stream; the wrong picture size; a file that is not video at all', async () => {
    const noAudio = item(checkFile(await input('silentvideo')), 'file.container');
    assert.equal(noAudio.status, 'fail');
    assert.ok(noAudio.lines!.includes('no audio stream'));
    const small = item(checkFile(await input('small')), 'file.container');
    assert.match(small.lines![0], /video size 720 x 1280, expected 1080 x 1920/);
    const broken = checkFile(await input('broken'));
    assert.equal(item(broken, 'file.container').status, 'fail');
    assert.match(item(broken, 'file.container').lines![0], /readable|cannot read/);
  });

  test('FAIL: a file cut short is found when it is read through, even though its structure is readable', async () => {
    const items = checkFile(await input('cut'));
    const dec = item(items, 'file.decode');
    assert.equal(dec.status, 'fail');
    assert.ok(dec.lines!.some((l) => /cut short or damaged|cannot be decoded|could be decoded|is \d/.test(l)), dec.lines!.join(' | '));
  });

  test('FAIL: a file altered after it was rendered fails the hash check', async () => {
    const path = join(dir, 'altered.mp4');
    copyFileSync(files.final, path);
    const recorded = sha256File(path).hash;
    const bytes = readFileSync(path);
    bytes[bytes.length - 100] ^= 0xff;
    writeFileSync(path, bytes);
    files.altered = path;
    const items = checkFile(await input('altered', {recordedSha256: recorded, actualSha256: sha256File(path).hash}));
    const h = item(items, 'file.hash');
    assert.equal(h.status, 'fail');
    assert.match(h.detail, /changed after it was rendered/);
  });

  test('a missing file fails the hash check with the reason', async () => {
    const h = item(checkFile({...(await input('final')), actualSha256: null, fileError: 'ENOENT'}), 'file.hash');
    assert.equal(h.status, 'fail');
    assert.match(h.detail, /cannot be read: ENOENT/);
  });
});

describe('the report', () => {
  test('passed means nothing failed; warnings, partial and manual items are counted and are not passes', () => {
    const items: CheckItem[] = [
      {id: 'a', section: 'narration', title: 'a', kind: 'measured', status: 'pass', detail: ''},
      {id: 'b', section: 'narration', title: 'b', kind: 'heuristic', status: 'warn', detail: ''},
      {id: 'c', section: 'layout', title: 'c', kind: 'partial', status: 'unchecked', detail: ''},
      {id: 'd', section: 'narration', title: 'd', kind: 'manual', status: 'unchecked', detail: ''},
    ];
    const r = buildReport({renderArtifactId: 7, renderKind: 'final', fileSha256: 'x', items, captionDiffs: [], sampled: {frames: 0, scenes: []}});
    assert.equal(r.version, CHECKS_VERSION);
    assert.deepEqual(r.summary, {pass: 1, warn: 1, fail: 0, unchecked: 2, info: 0});
    assert.equal(r.passed, true);
    assert.equal(buildReport({renderArtifactId: 7, renderKind: 'final', fileSha256: 'x', items: [...items, {...items[0], id: 'e', status: 'fail'}], captionDiffs: [], sampled: {frames: 0, scenes: []}}).passed, false);
    assert.ok(r.limits.some((l) => /dropped/.test(l)) && r.limits.some((l) => /attention/.test(l)));
  });
});
