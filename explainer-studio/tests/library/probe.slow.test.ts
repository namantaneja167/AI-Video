// The browser probe in the real browser engine (about a minute). Run with STUDIO_SLOW=1 (npm run test:slow). The real probe worker bundles the
// project, renders chosen frames of the real library composition in headless Chrome, and the production check analyses what the
// composition measured. One episode with three scenes: cards that fit, cards whose heading runs past its card, and a scene with nothing
// marked for measurement.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {cpSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {after, before, describe, test} from 'node:test';
import {analyzeLayout, type CheckItem} from '../../core/checks.ts';
import {probeFrames} from '../../core/probeFrames.ts';
import type {ProbeSample} from '../../src/library/probeTypes.ts';
import {ROOT, mkTmp} from '../helpers.ts';
import {acquireHeavy} from '../heavy-lock.ts';

const skip = process.env.STUDIO_SLOW ? false : 'set STUDIO_SLOW=1 to run the browser probe';
const item = (items: CheckItem[], id: string) => items.find((i) => i.id === id)!;

describe('the browser probe, in the real browser engine', {skip, timeout: 20 * 60_000}, () => {
  let release = () => {};
  let samples: ProbeSample[] = [];
  let frames: number[] = [];
  before(async () => {
    release = await acquireHeavy('probe');
    const dir = mkTmp('studio-probe-');
    const pub = join(dir, 'public');
    mkdirSync(pub, {recursive: true});
    cpSync(join(ROOT, 'public', 'library'), join(pub, 'library'), {recursive: true});
    const words = (t: string, start: number, end: number) => { const w = t.split(' '); const d = (end - start) / w.length; return w.map((x, i) => ({text: x, start: start + i * d, end: start + (i + 1) * d})); };
    const timeline = {
      version: 1, durationSec: 12, audio: 'none.wav', mouth: [],
      segments: [{id: 's1', start: 0.2, end: 3.8, words: words('Cards that fit the box', 0.2, 3.8)}, {id: 's2', start: 4.2, end: 7.8, words: words('A heading that is too long', 4.2, 7.8)}, {id: 's3', start: 8.2, end: 11.8, words: words('Nothing marked here', 8.2, 11.8)}],
      captions: [{segment: 's1', text: 'Cards that fit the box', words: words('Cards that fit the box', 0.2, 3.8)}, {segment: 's2', text: 'A heading that is too long', words: words('A heading that is too long', 4.2, 7.8)}, {segment: 's3', text: 'Nothing marked here', words: words('Nothing marked here', 8.2, 11.8)}],
      scenes: [{id: 'sc1', type: 'pip-cards', start: 0, end: 4}, {id: 'sc2', type: 'pip-cards', start: 4, end: 8}, {id: 'sc3', type: 'pip-dense-fixture', start: 8, end: 12}],
      cues: {sc1: {card1: 0.3, card2: 0.8}, sc2: {card1: 4.3}},
    };
    const scenes = [
      {id: 'sc1', type: 'pip-cards', segments: ['s1'], layout: {template: 'content-led', captionZone: 'bottom', mascot: {mode: 'docked', position: 'bottom-left', scale: 0.5}}, params: {title: 'Fits', cards: [{heading: 'First card', body: 'A short body.'}, {heading: 'Second card', body: 'Another short body.'}], actions: [], idle: true}},
      {id: 'sc2', type: 'pip-cards', segments: ['s2'], layout: {template: 'content-led', captionZone: 'bottom', mascot: {mode: 'docked', position: 'bottom-left', scale: 0.5}}, params: {cards: [{heading: 'W'.repeat(36), body: ''}], actions: [], idle: true}},
      {id: 'sc3', type: 'pip-dense-fixture', segments: ['s3'], layout: {template: 'dense-pip', captionZone: 'bottom', mascot: {mode: 'docked', position: 'bottom-left', scale: 0.3}}, params: {title: 'Dense', columns: 2, cards: [{label: 'a', value: '1'}, {label: 'b', value: '2'}, {label: 'c', value: '3'}, {label: 'd', value: '4'}]}},
    ];
    frames = probeFrames(timeline, 30);
    const spec = join(dir, 'job.json');
    writeFileSync(spec, JSON.stringify({entry: join(ROOT, 'src', 'index.ts'), publicDir: pub, bundleDir: join(dir, 'bundle'), out: join(dir, 'probe.json'), composition: 'studio-episode',
      inputProps: {episode: 'probe-fixture', variant: 'full', data: {episode: {id: 'probe-fixture', style: 'pip-paper-bundled', scenes}, timeline, previewOnly: true, probe: true}}, frames}));
    const r = spawnSync('node', [join(ROOT, 'workers', 'probe-worker.ts'), spec], {encoding: 'utf8', cwd: ROOT, maxBuffer: 50 * 2 ** 20});
    assert.equal(r.status, 0, `probe worker failed: ${r.stdout.split('\n').filter((l) => /"error"/.test(l)).join(' ')} ${r.stderr.slice(-500)}`);
    const out = JSON.parse(readFileSync(join(dir, 'probe.json'), 'utf8')) as {samples: ProbeSample[]; problems: string[]};
    assert.deepEqual(out.problems, [], 'every sampled frame printed a probe line');
    samples = out.samples;
  });
  after(() => release());

  const input = () => ({style: 'pip-paper-bundled', probed: true, samples, scenes: [
    {id: 'sc1', type: 'pip-cards', layoutId: 'content-led', captionsOn: true, mascotShown: true},
    {id: 'sc2', type: 'pip-cards', layoutId: 'content-led', captionsOn: true, mascotShown: true},
    {id: 'sc3', type: 'pip-dense-fixture', layoutId: 'dense-pip', captionsOn: true, mascotShown: true},
  ]});

  test('one sample per requested frame, with real measurements of the marked elements in the real browser', () => {
    assert.equal(samples.length, frames.length);
    const s1 = samples.find((s) => s.scene === 'sc1' && s.t > 2)!;
    const heading = s1.elements.find((e) => e.id === 'card1-heading')!;
    assert.ok(heading, 'the heading of the first card is marked and measured');
    assert.equal(heading.kind, 'text');
    assert.ok(heading.fontPx! >= 36 && heading.rect.w > 100 && heading.opacity >= 0.98);
    assert.equal(s1.fonts.length >= 1, true);
    assert.ok(s1.faces.some((f) => f.family === 'Inter' && f.status === 'loaded'), 'the bundled font face is loaded');
    assert.ok(s1.elements.some((e) => e.zone === 'caption'), 'the caption pill is measured');
  });

  test('the fixture whose cards fit passes overflow, overlap and size, and the bundled font is the one in use', () => {
    const only = analyzeLayout({...input(), samples: samples.filter((s) => s.scene === 'sc1')});
    for (const id of ['layout.overflow', 'layout.overlap', 'layout.size', 'layout.fonts']) assert.equal(item(only, id).status, 'pass', `${id}: ${item(only, id).detail} ${(item(only, id).lines ?? []).join('; ')}`);
    assert.match(item(only, 'layout.fonts').detail, /Inter/);
  });

  test('the fixture whose heading is wider than its card fails the overflow check, in sc2 only', () => {
    const items = analyzeLayout(input());
    const o = item(items, 'layout.overflow');
    assert.equal(o.status, 'fail', o.detail);
    assert.ok(o.lines!.every((l) => /^sc2: card1-heading/.test(l)), o.lines!.join(' | '));
    assert.match(o.lines![0], /runs past its width|runs past its box/);
  });

  test('the scene with nothing marked is reported as only partly checked, and as a custom-code scene', () => {
    const items = analyzeLayout(input());
    const cov = item(items, 'layout.coverage');
    assert.equal(cov.kind, 'partial');
    assert.ok(cov.lines!.some((l) => l.startsWith('sc3 (pip-dense-fixture)')));
    assert.ok(item(items, 'custom.scenes').lines!.some((l) => /^sc3/.test(l)));
  });
});
