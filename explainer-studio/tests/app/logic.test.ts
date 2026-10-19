import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import type {Status, StatusEntry} from '../../core/artifacts.ts';
import {validateEpisodeV2} from '../../src/migrate.ts';
import {compareToBuild, differenceLines, previewFor, spokenOf, type TimelineLike} from '../../app/shared/compare.ts';
import {estimateFor, fmtEstimate, fmtSec, staleItems, totalEstimate, type MeasuredRuns} from '../../app/shared/costs.ts';
import {remapEmphasis, setPauseAfter, setSegmentText, setSpeech, toggleEmphasis} from '../../app/shared/edit.ts';

const load = () => {
  const v = validateEpisodeV2(JSON.parse(readFileSync(new URL('../../samples/context-window/episode.json', import.meta.url), 'utf8')));
  assert.ok(v.ok);
  return v.episode;
};
const built = load();
// A small timeline in the shape of a built one: one caption phrase per segment.
const timeline: TimelineLike & {durationSec: number; audio: string} = {
  durationSec: 10, audio: 'audio.wav',
  captions: built.narration.segments.map((s) => ({segment: s.id, text: s.text, words: s.text.split(/\s+/).map((t, i) => ({text: t, start: i, end: i + 1}))})),
};
const valid = (doc: unknown) => assert.ok(validateEpisodeV2(doc).ok, 'the edited document must still validate');
const seg = (doc: typeof built, id: string) => doc.narration.segments.find((s) => s.id === id)!;

test('an unchanged document differs from the build in nothing', () => {
  const d = compareToBuild(built, built);
  assert.equal(d.any, false);
  assert.deepEqual(differenceLines(d, {live: [], blocked: []}), []);
});

test('changing the words changes narration and captions; changing only emphasis changes neither', () => {
  const words = setSegmentText(built, 's1', 'A model can only read a little at once.').doc;
  const d = compareToBuild(built, words);
  assert.equal(d.narrationDiffers, true);
  assert.equal(d.captionsDiffer, true);
  assert.equal(d.segments.s1.spoken, true);
  const emph = toggleEmphasis(built, 's1', 0);
  const e = compareToBuild(built, emph);
  assert.equal(e.narrationDiffers, false);
  assert.equal(e.captionsDiffer, false);
  assert.equal(e.segments.s1.emphasis, true);
  assert.equal(e.any, true);
});

test('spoken text and caption text are told apart', () => {
  const spoken = setSpeech(built, 's2', 'That limit is called its context window.');
  const a = compareToBuild(built, spoken);
  assert.equal(a.narrationDiffers, true);
  assert.equal(a.captionsDiffer, false);
  assert.equal(spokenOf(seg(spoken, 's2')), 'That limit is called its context window.');
  // Caption text changed but the spoken text is pinned to the old words: audio still matches.
  const old = seg(built, 's2').text;
  const cap = {...built, narration: {...built.narration, segments: built.narration.segments.map((s) => (s.id === 's2' ? {...s, speech: old, text: 'That limit is the context window.'} : s))}};
  const b = compareToBuild(built, cap);
  assert.equal(b.narrationDiffers, false);
  assert.equal(b.captionsDiffer, true);
  assert.match(differenceLines(b, {live: [], blocked: []}).join(' '), /Caption text changed in s2/);
});

test('the preview keeps the built captions and scene; emphasis is live only where the words are the built ones', () => {
  let edited = setSegmentText(built, 's1', 'A model can only read much more at once.').doc; // drops the "so much" emphasis
  edited = toggleEmphasis(edited, 's3', 0); // "Your" in s3, words unchanged
  const p = previewFor(built, timeline, edited);
  assert.deepEqual(p.live, ['s3']);
  assert.deepEqual(p.blocked.map((b) => b.id), ['s1']); // its emphasis edit (removal) cannot be shown on the built words
  assert.deepEqual(p.timeline.captions.map((c) => c.text), timeline.captions.map((c) => c.text));
  assert.equal(JSON.stringify(p.episode.scenes), JSON.stringify(built.scenes));
  assert.deepEqual(p.timeline.captions.find((c) => c.segment === 's1')!.emphasis, [[5, 7]]); // as built
  assert.deepEqual(p.timeline.captions.find((c) => c.segment === 's3')!.emphasis, [[0, 1], [8, 9]]);
  const lines = differenceLines(compareToBuild(built, edited), p).join(' ');
  assert.match(lines, /Spoken text changed in s1/);
  assert.match(lines, /Emphasis in s3 is shown live/);
  assert.match(lines, /Emphasis in s1: its words changed/);
});

test('turning emphasis off live removes it from the preview', () => {
  const off = toggleEmphasis(built, 's1', 5);
  const p = previewFor(built, timeline, off);
  assert.deepEqual(p.live, ['s1']);
  assert.deepEqual(p.timeline.captions.find((c) => c.segment === 's1')!.emphasis, [[6, 7]]);
});

test('edits keep documents valid: emphasis follows its words or is dropped with a note', () => {
  const moved = setSegmentText(built, 's1', 'Honestly a model can only read so much at once.');
  valid(moved.doc);
  assert.deepEqual(seg(moved.doc, 's1').emphasis, [{from: 6, to: 8, text: 'so much'}]);
  // the old caption line breaks no longer spell the words, so they are reset instead of drawing the old words
  assert.equal(seg(moved.doc, 's1').captions, undefined);
  assert.deepEqual(moved.notes, ['The caption line breaks of s1 were reset because its words changed; the video chooses new breaks.']);
  const same = setSegmentText(built, 's1', 'A model can only read  so much at once.');
  assert.deepEqual(seg(same.doc, 's1').captions, seg(built, 's1').captions, 'phrases that still spell the words are kept');
  assert.deepEqual(same.notes, []);
  const gone = setSegmentText(built, 's1', 'A model reads little at once.');
  valid(gone.doc);
  assert.equal(seg(gone.doc, 's1').emphasis, undefined);
  assert.match(gone.notes[0], /"so much" was removed/);
  assert.deepEqual(remapEmphasis([{from: 1, to: 2, text: 'a'}, {from: 2, to: 3, text: 'a'}], 'x a a b').ranges, [{from: 1, to: 2, text: 'a'}, {from: 2, to: 3, text: 'a'}]);
});

test('toggling words builds ranges, merges neighbours, and stays valid; speech and pause edits are clean', () => {
  const t1 = toggleEmphasis(built, 's4', 0);
  valid(t1);
  assert.deepEqual(seg(t1, 's4').emphasis, [{from: 0, to: 1, text: 'Each'}, {from: 5, to: 6, text: 'room.'}]);
  const t2 = toggleEmphasis(t1, 's4', 4);
  assert.deepEqual(seg(t2, 's4').emphasis, [{from: 0, to: 1, text: 'Each'}, {from: 4, to: 6, text: 'some room.'}]);
  valid(t2);
  const back = toggleEmphasis(toggleEmphasis(built, 's4', 5), 's4', 5);
  assert.deepEqual(seg(back, 's4').emphasis, seg(built, 's4').emphasis);
  assert.equal('emphasis' in seg(toggleEmphasis(built, 's4', 5), 's4'), false);
  const sp = setSpeech(built, 's2', '');
  assert.equal('speech' in seg(sp, 's2'), false);
  assert.equal(seg(setPauseAfter(built, 's2', 0.4), 's2').pauseAfter, 0.4);
  assert.equal('pauseAfter' in seg(setPauseAfter(built, 's2', undefined), 's2'), false);
  assert.equal(built.narration.segments[3].emphasis?.length, 1, 'the input document is never changed');
});

// ---- costs ------------------------------------------------------------------------------------------------------------
const runs: MeasuredRuns = {version: 1, runs: [
  {kind: 'take', subject: 'b1', seconds: 30, source: 'run A', when: '2026-01-01'},
  {kind: 'take', subject: 'b1', seconds: 45, source: 'run B', when: '2026-01-02'},
  {kind: 'render', subject: 'final', seconds: 27.5, source: 'run A', when: '2026-01-01'},
]};
const entry = (status: StatusEntry['status'], reasons: string[] = []): StatusEntry => ({status, reasons});

test('costs come only from measured runs and are labelled as estimates', () => {
  const e = estimateFor('take', 'b1', runs);
  assert.deepEqual(e, {measured: true, minSec: 30, maxSec: 45, runs: 2, sources: ['run A', 'run B']});
  assert.equal(fmtEstimate(e), 'about 30 s to 45 s (estimate)');
  assert.equal(fmtEstimate(estimateFor('render', 'final', runs)), 'about 28 s (estimate)');
  assert.equal(fmtEstimate(estimateFor('mix', 'final', runs)), 'Not measured');
  assert.equal(fmtEstimate(estimateFor('take', 'b1', null)), 'Not measured');
  assert.equal(fmtSec(125), '2 min 5 s');
});

test('stale items are named in plain words with their reasons, and never-built outputs are not called stale', () => {
  const status: Status = {
    takes: {b1: entry('stale', ['inputs changed since it was built']), b2: entry('fresh')},
    timing: entry('stale', ['upstream take b1 is not fresh']),
    mix: {draft: entry('none'), final: entry('stale', ['upstream timing is not fresh'])},
    render: {draft: entry('none'), final: entry('stale', ['upstream mix final is not fresh'])},
    notFresh: [], unsetComponents: [],
  };
  const {stale, notBuilt} = staleItems(status, built, runs);
  assert.deepEqual(stale.map((s) => s.label), ['Narration, block b1 (s1, s2, s3, s4)', 'Timing and captions', 'Final audio mix', 'Final video']);
  assert.deepEqual(stale[1].why, ['Waits for: narration b1']);
  assert.deepEqual(notBuilt.map((n) => n.label), ['Draft audio mix', 'Draft video']);
  const t = totalEstimate(stale);
  assert.deepEqual(t, {minSec: 57.5, maxSec: 72.5, known: 2, unknown: 2});
});

test('a range that only moved with its words is not an emphasis change', () => {
  const moved = setSegmentText(built, 's1', 'Honestly a model can only read so much at once.').doc;
  const d = compareToBuild(built, moved);
  assert.equal(d.segments.s1.emphasis, false);
  assert.equal(d.segments.s1.spoken, true);
  assert.deepEqual(previewFor(built, timeline, moved).blocked, []);
});

// ---- revision summaries ---------------------------------------------------------------------------------------------------
import {revisionKindLabel, shortSummary, summarizeChange} from '../../app/shared/revisions.ts';

test('revision summaries say what changed in plain words', () => {
  assert.match(summarizeChange(null, built)[0], /Starts with 8 segments in 1 scene/);
  assert.deepEqual(summarizeChange(built, built), []);
  const spoken = setSegmentText(built, 's4', 'Each token takes up room.').doc;
  assert.deepEqual(summarizeChange(built, spoken), ['Spoken text changed in s4']);
  const both = toggleEmphasis(setSpeech(built, 's2', 'That limit is called its context window.'), 's5', 0);
  assert.deepEqual(summarizeChange(built, both), ['Spoken text changed in s2', 'Emphasis changed in s5']);
  assert.deepEqual(summarizeChange(built, setPauseAfter(built, 's8', 0.5)), ['Pause changed after s8']);
  assert.equal(shortSummary(['a', 'b', 'c']), 'a; b; and 1 more');
  assert.equal(shortSummary([]), 'No change to the text');
  assert.equal(revisionKindLabel('restore', 'restored r3'), 'Restored r3');
  assert.equal(revisionKindLabel('adopt', null), 'Imported episode');
});

test('a failed job is shown only until a later job for the same work succeeds or runs', async () => {
  const {unresolvedFailures} = await import('../../app/shared/review.ts');
  const j = (id: number, kind: string, subject: string, state: string) => ({id, kind, subject, state});
  assert.deepEqual(unresolvedFailures([j(1, 'tts.block', 'b1', 'failed')]).map((x) => x.id), [1]);
  assert.deepEqual(unresolvedFailures([j(1, 'tts.block', 'b1', 'failed'), j(2, 'tts.block', 'b1', 'succeeded')]), []);
  assert.deepEqual(unresolvedFailures([j(1, 'tts.block', 'b1', 'failed'), j(2, 'tts.block', 'b1', 'running')]), []);
  assert.deepEqual(unresolvedFailures([j(1, 'tts.block', 'b1', 'failed'), j(2, 'tts.block', 'b2', 'succeeded')]).map((x) => x.id), [1], 'another block does not resolve it');
  assert.deepEqual(unresolvedFailures([j(1, 'tts.block', 'b1', 'succeeded'), j(2, 'tts.block', 'b1', 'failed')]).map((x) => x.id), [2], 'an older success does not hide a newer failure');
});
