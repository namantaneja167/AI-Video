import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {describe, test} from 'node:test';
import {migrateV1ToV2} from '../../src/migrate.ts';
import {assembleSegTimings, buildTimelineViaPython, planLayout, timelineEpisode, wavDuration} from '../../core/timeline.ts';
import {EpisodeSchemaV2} from '../../src/schema2.ts';
import {TimelineSchema} from '../../src/schema.ts';
import {tempRoot} from './helpers.ts';

const fx = (n: string) => JSON.parse(readFileSync(join('tests/fixtures/join-fanout', n), 'utf8'));
const PY = '.venv/bin/python';
const run = async (cmd: string, args: string[], stdin: string) => {
  const r = spawnSync(cmd, args, {input: stdin, encoding: 'utf8'});
  if (r.status !== 0) throw new Error(r.stderr);
  return r.stdout;
};
const doc = () => EpisodeSchemaV2.parse(migrateV1ToV2(fx('episode.v1.json')));

describe('timeline wrapper', () => {
  test('through the wrapper, the v2 document and the Kokoro timings give exactly the Phase 0 golden timeline', async () => {
    const t = fx('seg-timings.full.json');
    const out = await buildTimelineViaPython(run, PY, 'pipeline/timeline_cli.py', {episode: timelineEpisode(doc()), segTimings: t.segments, source: 'kokoro', variant: 'full', audioDuration: t.audioDuration});
    assert.deepEqual(out, fx('timeline.full.json'));
  });

  test('the preview golden also matches through the wrapper (the preview is narrowed by the Python logic, not in TypeScript)', async () => {
    const t = fx('seg-timings.preview.json');
    const out = await buildTimelineViaPython(run, PY, 'pipeline/timeline_cli.py', {
      episode: timelineEpisode(doc()), preview: 'join-multiplication', segTimings: t.segments, source: 'kokoro', variant: 'preview-join-multiplication', audioDuration: t.audioDuration,
    });
    assert.deepEqual(out, fx('timeline.preview.json'));
  });

  test('the timeline logic is called, not copied: the wrapper has no timing arithmetic of its own', () => {
    const src = readFileSync('pipeline/timeline_cli.py', 'utf8');
    assert.match(src, /tl\.build_timeline\(/);
    assert.doesNotMatch(src, /CUE_LEAD|SCENE_LEAD|auto_caption|SequenceMatcher/);
  });

  test('source labels flow into the timeline and validate against the schema Remotion uses', async () => {
    const d = doc();
    const t = fx('seg-timings.full.json');
    const lay = planLayout({...d, narration: {...d.narration, blocks: [{id: 'b', segments: d.narration.segments.map((s) => s.id)}]}, pacing: {leadInSec: 0, tailSec: 0, segmentGapSec: 0}}, {b: 100});
    const fake = [{blockId: 'b', source: 'aligned' as const, segments: d.narration.segments.map((s) => ({id: s.id, start: t.segments[s.id].start, end: t.segments[s.id].end, words: t.segments[s.id].words}))}];
    const a = assembleSegTimings(lay, fake);
    assert.equal(a.source, 'qwen-aligned');
    const est = assembleSegTimings(lay, [{...fake[0], source: 'estimated'}]);
    assert.equal(est.source, 'qwen-estimated');
    const half = [{...fake[0], segments: fake[0].segments.slice(0, 3)}, {blockId: 'b', source: 'estimated' as const, segments: fake[0].segments.slice(3)}];
    assert.equal(assembleSegTimings(lay, half).source, 'qwen-mixed');
    const out = await buildTimelineViaPython(run, PY, 'pipeline/timeline_cli.py', {episode: timelineEpisode(d), segTimings: a.segTimings, source: a.source, variant: 'full', audioDuration: 100, timingSources: a.timingSources});
    const parsed = TimelineSchema.parse(out);
    assert.equal(parsed.source, 'qwen-aligned');
    assert.equal(Object.values(parsed.timingSources!).every((s) => s === 'aligned'), true);
  });
});

describe('layout', () => {
  const d = () => doc();
  test('lead-in, takes, block gaps (own or default) and the tail add up to the total', () => {
    const base = d();
    const blocks = [{id: 'a', segments: ['s01'], gapAfterSec: 1}, {id: 'b', segments: ['s02']}, {id: 'c', segments: ['s03']}];
    const doc3 = {...base, narration: {...base.narration, blocks}, pacing: {leadInSec: 0.5, tailSec: 1.2, segmentGapSec: 0.3}};
    const l = planLayout(doc3, {a: 2, b: 3, c: 4});
    assert.deepEqual(l.blocks.map((b) => b.offsetSec), [0.5, 3.5, 6.8]);
    assert.equal(l.totalSec, 12); // 0.5 + 2 + 1 + 3 + 0.3 + 4 + tail 1.2
  });
  test('the pause of the last segment of a block is added to the silence after the block, including after the last block', () => {
    const base = d();
    const segments = base.narration.segments.map((x) => (x.id === 's02' ? {...x, pauseAfter: 0.5} : x.id === 's03' ? {...x, pauseAfter: 0.25} : x));
    const doc3 = {...base, narration: {segments, blocks: [{id: 'a', segments: ['s01', 's02']}, {id: 'b', segments: ['s03']}]}, pacing: {leadInSec: 0.5, tailSec: 1.2, segmentGapSec: 0.3}};
    const l = planLayout(doc3, {a: 2, b: 3});
    assert.deepEqual(l.blocks.map((b) => [b.offsetSec, b.gapAfterSec]), [[0.5, 0.8], [3.3, 1.45]]);
    assert.equal(l.totalSec, 7.75);
  });
  test('a missing take duration is an error, not a guess', () => {
    assert.throws(() => planLayout(d(), {}), /no take duration/);
  });
  test('WAV duration is read from the header', () => {
    const root = tempRoot();
    const sr = 24000, n = 36000;
    const h = Buffer.alloc(44 + n * 2);
    h.write('RIFF', 0); h.writeUInt32LE(36 + n * 2, 4); h.write('WAVEfmt ', 8); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
    h.writeUInt32LE(sr, 24); h.writeUInt32LE(sr * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(n * 2, 40);
    writeFileSync(join(root, 'a.wav'), h);
    assert.deepEqual(wavDuration(join(root, 'a.wav')), {seconds: 1.5, sampleRate: 24000});
  });
});
