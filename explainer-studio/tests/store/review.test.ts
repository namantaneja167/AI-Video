// Review rounds, notes, playback coverage, sign-offs and approval, in isolated temporary projects. Every sign-off here is an explicitly
// SIMULATED action made by the test through the same call a person's click makes; nothing in the product ticks a box or approves by itself.
import assert from 'node:assert/strict';
import {afterEach, describe, test} from 'node:test';
import {approvalStatus, ApprovalError, finishJob, startJob, statusReport} from '../../core/artifacts.ts';
import {buildReport, CHECKS_VERSION, type CheckItem} from '../../core/checks.ts';
import {putBytes} from '../../core/blobs.ts';
import {adoptEpisode, getEpisode, getEpisodeInfo, saveEpisode} from '../../core/episodes.ts';
import {
  addReviewNote, approveReviewed, assessNote, changeNote, checkReportFor, closeRound, coverageOf, getSignoffs, listRounds, openRound, readiness, recordPlayback, ReviewError, roundForRender, setSignoff,
} from '../../core/review.ts';
import {currentRows} from '../../core/state.ts';
import {plain} from '../helpers.ts';
import {buildAll, newProject, setAllComponents, type TestProject} from './helpers.ts';

const EP = 'join-fanout';
const DURATION = 60;
let t: TestProject;
afterEach(() => t?.close());

function fresh() {
  t = newProject();
  adoptEpisode(t.p, 'episodes/join-fanout/episode.json');
  setAllComponents(t.p, t.root);
  const ids = buildAll(t.p, EP);
  // the fixture episode already carries four migrated notes; settle them so these tests start from no open notes
  const d = plain(getEpisode(t.p, EP));
  for (const n of d.reviewNotes) n.status = 'resolved';
  saveEpisode(t.p, EP, d);
  return ids;
}
const noteOf = (id: string) => getEpisode(t.p, EP).reviewNotes.find((n) => n.id === id)!;
const finalId = () => currentRows(t.p, EP).find((r) => r.kind === 'render' && r.subject === 'final')!.artifact_id;
const draftId = () => currentRows(t.p, EP).find((r) => r.kind === 'render' && r.subject === 'draft')!.artifact_id;
const edit = (fn: (d: any) => void) => { const d = plain(getEpisode(t.p, EP)); fn(d); saveEpisode(t.p, EP, d); };

/** SIMULATED: a check run stored the way the check job stores it (the report is made here, not by a run). */
function storeChecks(renderId: number, o: {fail?: boolean} = {}): number {
  const row = currentRows(t.p, EP).find((r) => r.artifact_id === renderId)!;
  const items: CheckItem[] = [{id: 'x', section: 'narration', title: 'x', kind: 'measured', status: o.fail ? 'fail' : 'pass', detail: 'simulated'}];
  const report = buildReport({renderArtifactId: renderId, renderKind: row.subject as 'draft' | 'final', fileSha256: row.blob_hash, items, captionDiffs: [], sampled: {frames: 0, scenes: []}});
  const job = startJob(t.p, {episodeId: EP, jobKind: 'check.suite', subject: String(renderId)});
  return finishJob(t.p, job.jobId, {blobHash: putBytes(t.p, JSON.stringify(report)).hash, meta: {simulated: true}}).artifactId;
}

/** SIMULATED: a person plays the whole file with the sound on, in 10-second reports, 10 seconds apart. */
function playAll(roundId: number, opts: {heard?: boolean; phone?: boolean; stopAt?: number} = {}) {
  for (let s = 0; s < (opts.stopAt ?? DURATION); s += 10) {
    t.clock.advance(10_000);
    recordPlayback(t.p, roundId, DURATION, {fromSec: s, toSec: Math.min(s + 10, opts.stopAt ?? DURATION), heard: opts.heard ?? true, phone: opts.phone ?? false});
  }
}
const tickAll = (roundId: number) => { for (const i of ['listened', 'watchedPhoneSize', 'customScenesReviewed', 'notesResolved']) setSignoff(t.p, roundId, i, true); };

describe('rounds', () => {
  test('a round belongs to one video: opening it again returns the same round, and each video gets the next number', () => {
    fresh();
    const a = openRound(t.p, EP, draftId());
    assert.deepEqual([a.number, a.kind, a.closedAt], [1, 'draft', null]);
    assert.equal(openRound(t.p, EP, draftId()).id, a.id);
    const b = openRound(t.p, EP, finalId());
    assert.deepEqual([b.number, b.kind], [2, 'final']);
    assert.equal(b.fileSha256, currentRows(t.p, EP).find((r) => r.artifact_id === finalId())!.blob_hash, 'the round records the exact file');
    assert.deepEqual(listRounds(t.p, EP).map((r) => r.number), [1, 2]);
    assert.equal(roundForRender(t.p, 999_999), null);
  });

  test('only a rendered video of this episode can be reviewed', () => {
    const ids = fresh();
    assert.throws(() => openRound(t.p, EP, ids['timing']), (e: ReviewError) => e.code === 'unknown');
    assert.throws(() => openRound(t.p, EP, 123456), (e: ReviewError) => e.code === 'unknown');
  });

  test('closing a round stops further sign-offs on it', () => {
    fresh();
    const r = openRound(t.p, EP, finalId());
    closeRound(t.p, r.id);
    assert.throws(() => setSignoff(t.p, r.id, 'listened', true), /closed/);
  });
});

describe('notes: written against a round, edited, resolved, reassessed', () => {
  test('a note records its round, its video (id, kind, SHA-256) and the text and scene it was written about', () => {
    fresh();
    const r = openRound(t.p, EP, finalId());
    const {note} = addReviewNote(t.p, EP, {roundId: r.id, text: '  The pause is too long. ', type: 'voice', timeSec: 12.345, segment: 's02', build: 'b1-2-3'});
    assert.equal(note.text, 'The pause is too long.');
    assert.equal(note.status, 'open');
    assert.equal(note.round, 1);
    assert.deepEqual(note.render, {id: String(finalId()), kind: 'final', build: 'b1-2-3', sha256: r.fileSha256});
    assert.equal(note.timeSec, 12.35);
    assert.equal(note.context!.segmentText, getEpisode(t.p, EP).narration.segments.find((s) => s.id === 's02')!.text);
    assert.ok(note.context!.sceneId && note.context!.sceneHash);
    assert.deepEqual(note.events!.map((e) => e.kind), ['created']);
    assert.equal(noteOf(note.id).text, 'The pause is too long.', 'it is in the episode document, saved through the normal save');
  });

  test('editing keeps the earlier text; resolve, won\'t fix and reopen are recorded; empty text is refused', () => {
    fresh();
    const r = openRound(t.p, EP, finalId());
    const {note} = addReviewNote(t.p, EP, {roundId: r.id, text: 'First wording', type: 'copy', segment: 's01'});
    const edited = changeNote(t.p, EP, note.id, {op: 'edit', text: 'Second wording', type: 'timing'}).note;
    assert.equal(edited.text, 'Second wording');
    assert.equal(edited.type, 'timing');
    assert.deepEqual(edited.events!.at(-1), {at: edited.events!.at(-1)!.at, kind: 'edited', text: 'First wording'});
    assert.equal(changeNote(t.p, EP, note.id, {op: 'resolve', text: 'fixed in r5'}).note.status, 'resolved');
    assert.equal(changeNote(t.p, EP, note.id, {op: 'wont-fix'}).note.status, 'wont-fix');
    const reopened = changeNote(t.p, EP, note.id, {op: 'reopen'}).note;
    assert.equal(reopened.status, 'open');
    assert.deepEqual(reopened.events!.map((e) => e.kind), ['created', 'edited', 'resolved', 'wont-fix', 'reopened']);
    assert.throws(() => changeNote(t.p, EP, note.id, {op: 'edit', text: '   '}), /needs some text/);
    assert.throws(() => changeNote(t.p, EP, 'nope', {op: 'resolve'}), (e: ReviewError) => e.code === 'unknown');
  });

  test('a note edit that raced a newer save is refused with a conflict and changes nothing', () => {
    fresh();
    const r = openRound(t.p, EP, finalId());
    const {note, seq} = addReviewNote(t.p, EP, {roundId: r.id, text: 'A', type: 'general', segment: 's01'});
    edit((d) => { d.title = 'Edited elsewhere'; });
    assert.throws(() => changeNote(t.p, EP, note.id, {op: 'edit', text: 'B'}, seq), (e: ReviewError) => e.code === 'conflict');
    assert.equal(noteOf(note.id).text, 'A');
  });

  test('notes and their changes affect no dependency hash and do not void an approval', () => {
    fresh();
    const before = statusReport(t.p, EP).notFresh;
    const r = openRound(t.p, EP, finalId());
    storeChecks(finalId());
    tickAll(r.id);
    playAll(r.id);
    approveReviewed(t.p, EP, r.id, DURATION);
    const {note} = addReviewNote(t.p, EP, {roundId: r.id, text: 'late thought', type: 'general', segment: 's01'}, undefined);
    changeNote(t.p, EP, note.id, {op: 'resolve'});
    assert.deepEqual(statusReport(t.p, EP).notFresh, before);
    assert.equal(approvalStatus(t.p, EP).state, 'valid');
  });

  test('when the wording changes, the note keeps its original context and is flagged for reassessment, with the reason', () => {
    fresh();
    const r = openRound(t.p, EP, finalId());
    const {note} = addReviewNote(t.p, EP, {roundId: r.id, text: 'Say this slower', type: 'voice', segment: 's01'});
    const original = note.context!.segmentText;
    assert.equal(assessNote(note, getEpisode(t.p, EP)).state, 'current');
    edit((d) => { d.narration.segments.find((s: any) => s.id === 's01').text += ' Honestly.'; });
    const stored = noteOf(note.id);
    const a = assessNote(stored, getEpisode(t.p, EP));
    assert.equal(a.state, 'reassess');
    assert.match(a.reasons[0], /wording of segment s01 changed since it was written/);
    assert.equal(stored.context!.segmentText, original, 'the original context is retained, not rewritten');
    // confirming that it still applies moves the baseline, not the original
    const confirmed = changeNote(t.p, EP, note.id, {op: 'reassess'}).note;
    assert.equal(assessNote(confirmed, getEpisode(t.p, EP)).state, 'current');
    assert.equal(confirmed.context!.segmentText, original);
    assert.equal(confirmed.events!.at(-1)!.kind, 'reassessed');
    // and a later change flags it again, saying it was after the confirmation
    edit((d) => { d.narration.segments.find((s: any) => s.id === 's01').text += ' Again.'; });
    assert.match(assessNote(noteOf(note.id), getEpisode(t.p, EP)).reasons[0], /after you last confirmed/);
  });

  test('a change to the scene that shows the segment, a removed segment, and a note without context are told apart', () => {
    fresh();
    const r = openRound(t.p, EP, finalId());
    const {note} = addReviewNote(t.p, EP, {roundId: r.id, text: 'The card is wrong', type: 'visual', segment: 's02'});
    edit((d) => { const sc = d.scenes.find((s: any) => s.segments.includes('s02')); sc.layout = {...sc.layout, captionZone: 'top'}; });
    const a = assessNote(noteOf(note.id), getEpisode(t.p, EP));
    assert.equal(a.state, 'reassess');
    assert.ok(a.reasons.some((x) => /scene that shows segment s02 changed/.test(x)));
    const legacy = {id: 'old', text: 'old', type: 'general', status: 'open', anchor: {segment: 's02'}} as never;
    assert.equal(assessNote(legacy, getEpisode(t.p, EP)).state, 'legacy');
    const orphan = {...note, anchor: {segment: 'gone'}};
    assert.equal(assessNote(orphan, getEpisode(t.p, EP)).state, 'orphaned');
  });
});

describe('playback coverage', () => {
  test('ranges are merged, sound-off playback does not count as heard, and phone-size seconds are counted separately', () => {
    fresh();
    const r = openRound(t.p, EP, finalId());
    t.clock.advance(10_000); recordPlayback(t.p, r.id, DURATION, {fromSec: 0, toSec: 10, heard: true, phone: true});
    t.clock.advance(10_000); recordPlayback(t.p, r.id, DURATION, {fromSec: 5, toSec: 15, heard: true, phone: false});
    t.clock.advance(10_000); recordPlayback(t.p, r.id, DURATION, {fromSec: 20, toSec: 30, heard: false, phone: false});
    const c = coverageOf(t.p, r.id, DURATION);
    assert.deepEqual([c.playedSec, c.heardSec, c.phoneHeardSec], [25, 15, 10]);
    assert.equal(c.complete, false);
    assert.deepEqual(c.unheard[0], [15, 60]);
  });

  test('complete only when every second was played with the sound on (gaps under the seek tolerance are allowed)', () => {
    fresh();
    const r = openRound(t.p, EP, finalId());
    playAll(r.id, {stopAt: 50});
    assert.equal(coverageOf(t.p, r.id, DURATION).complete, false);
    t.clock.advance(10_000); recordPlayback(t.p, r.id, DURATION, {fromSec: 50.2, toSec: 60, heard: true, phone: false});
    assert.equal(coverageOf(t.p, r.id, DURATION).complete, true, 'a 0.2 s seek gap is not a skipped stretch');
    const r2 = openRound(t.p, EP, draftId());
    for (const [a, b] of [[0, 15], [15, 30], [31, 45], [45, 60]]) { t.clock.advance(15_000); recordPlayback(t.p, r2.id, DURATION, {fromSec: a, toSec: b, heard: true, phone: false}); }
    assert.equal(coverageOf(t.p, r2.id, DURATION).complete, false, 'a one-second skip is a skipped stretch');
  });

  test('reports that could not have happened are refused: past the end, backwards, too long, or faster than time passes', () => {
    fresh();
    const r = openRound(t.p, EP, finalId());
    assert.throws(() => recordPlayback(t.p, r.id, DURATION, {fromSec: 55, toSec: 70, heard: true, phone: false}), /past the end/);
    assert.throws(() => recordPlayback(t.p, r.id, DURATION, {fromSec: 10, toSec: 5, heard: true, phone: false}), /not a playback range/);
    assert.throws(() => recordPlayback(t.p, r.id, DURATION, {fromSec: 0, toSec: 30, heard: true, phone: false}), /at most/);
    t.clock.advance(5_000); recordPlayback(t.p, r.id, DURATION, {fromSec: 0, toSec: 5, heard: true, phone: false});
    t.clock.advance(1_000);
    assert.throws(() => recordPlayback(t.p, r.id, DURATION, {fromSec: 5, toSec: 15, heard: true, phone: false}), /cannot have played/);
    assert.equal(coverageOf(t.p, r.id, DURATION).playedSec, 5, 'a refused report leaves no trace');
  });
});

describe('sign-offs', () => {
  test('nothing is ticked until a person ticks it, and only the four known items exist', () => {
    fresh();
    const r = openRound(t.p, EP, finalId());
    storeChecks(finalId());
    playAll(r.id);
    assert.deepEqual(getSignoffs(t.p, r.id).map((s) => s.ticked), [false, false, false, false], 'opening a round, running checks and playing do not tick anything');
    assert.throws(() => setSignoff(t.p, r.id, 'looksFine', true), /not one of the sign-offs/);
    const s = setSignoff(t.p, r.id, 'listened', true);
    assert.deepEqual(s.map((x) => x.ticked), [true, false, false, false]);
    assert.ok(s[0].at !== null);
    assert.equal(setSignoff(t.p, r.id, 'listened', false)[0].ticked, false, 'a tick can be taken back');
  });
});

describe('approval: bound to the file and its inputs, refused until everything is recorded', () => {
  test('every missing precondition is named, together, and approval is refused', () => {
    fresh();
    const r = openRound(t.p, EP, finalId());
    const rd = readiness(t.p, EP, DURATION);
    assert.ok(rd.blockers.some((b) => /production checks have not been run/.test(b)));
    assert.ok(rd.blockers.some((b) => /confirmations are not ticked: listened, watchedPhoneSize, customScenesReviewed, notesResolved/.test(b)));
    assert.ok(rd.blockers.some((b) => /played with the sound on/.test(b)));
    assert.throws(() => approveReviewed(t.p, EP, r.id, DURATION), (e: ApprovalError) => e.problems.length >= 3);
    assert.equal(approvalStatus(t.p, EP).state, 'none');
  });

  test('a failing check, an unticked box, an incomplete listen, or an open note each refuses approval on its own', () => {
    fresh();
    const r = openRound(t.p, EP, finalId());
    const checks = storeChecks(finalId(), {fail: true});
    tickAll(r.id); playAll(r.id);
    assert.throws(() => approveReviewed(t.p, EP, r.id, DURATION), /production checks have 1 failing item/);
    assert.equal(checkReportFor(t.p, EP, finalId())!.artifactId, checks);
    storeChecks(finalId());
    setSignoff(t.p, r.id, 'watchedPhoneSize', false);
    assert.throws(() => approveReviewed(t.p, EP, r.id, DURATION), /not ticked: watchedPhoneSize/);
    setSignoff(t.p, r.id, 'watchedPhoneSize', true);
    const open = addReviewNote(t.p, EP, {roundId: r.id, text: 'still open', type: 'general', segment: 's01'}).note;
    assert.throws(() => approveReviewed(t.p, EP, r.id, DURATION), /1 note is still open/);
    changeNote(t.p, EP, open.id, {op: 'wont-fix'});
    assert.equal(approveReviewed(t.p, EP, r.id, DURATION) > 0, true);
  });

  test('a draft can never be approved, whatever has been ticked', () => {
    fresh();
    const r = openRound(t.p, EP, draftId());
    storeChecks(draftId());
    tickAll(r.id); playAll(r.id);
    assert.throws(() => approveReviewed(t.p, EP, r.id, DURATION), /not for the current final video/);
  });

  test('a round for an older file cannot approve a newer final video', () => {
    fresh();
    const r = openRound(t.p, EP, finalId());
    storeChecks(finalId()); tickAll(r.id); playAll(r.id);
    const old = finalId();
    const job = startJob(t.p, {episodeId: EP, jobKind: 'render.final'});
    finishJob(t.p, job.jobId, {blobHash: putBytes(t.p, 'a newer final').hash, meta: {mastered: true}});
    assert.notEqual(finalId(), old);
    assert.throws(() => approveReviewed(t.p, EP, r.id, DURATION), /not for the current final video/);
  });

  test('approval with everything recorded: bound to the file hash and the input hash, and records what it rested on', () => {
    fresh();
    const r = openRound(t.p, EP, finalId());
    const checks = storeChecks(finalId());
    tickAll(r.id); playAll(r.id, {phone: true});
    assert.deepEqual(readiness(t.p, EP, DURATION).blockers, []);
    const id = approveReviewed(t.p, EP, r.id, DURATION);
    const ap = t.p.db.prepare('SELECT * FROM approvals WHERE id=?').get(id) as any;
    assert.equal(ap.file_sha256, currentRows(t.p, EP).find((x) => x.artifact_id === finalId())!.blob_hash);
    assert.match(ap.inputs_hash, /^[0-9a-f]{64}$/);
    const rev = t.p.db.prepare('SELECT * FROM approval_review WHERE approval_id=?').get(id) as any;
    assert.deepEqual([rev.round_id, rev.checks_artifact_id], [r.id, checks]);
    assert.equal(JSON.parse(rev.coverage_json).complete, true);
    assert.match(JSON.parse(rev.detail_json).note, /record actions, not attention or correctness/);
    assert.ok(roundForRender(t.p, finalId())!.closedAt !== null, 'approving closes the round');
    assert.equal(approvalStatus(t.p, EP).state, 'valid');
  });

  test('a change to an input the final video depends on voids approval and names the changed parts', () => {
    fresh();
    const r = openRound(t.p, EP, finalId());
    storeChecks(finalId()); tickAll(r.id); playAll(r.id);
    approveReviewed(t.p, EP, r.id, DURATION);
    edit((d) => { d.narration.segments.find((s: any) => s.id === 's07').text += '!'; });
    const s = approvalStatus(t.p, EP);
    assert.equal(s.state, 'void');
    assert.ok(s.changed.includes('content'));
    assert.ok(readiness(t.p, EP, DURATION).blockers.length > 0);
  });

  test('check results made for a different file, or an older version of the suite, do not count', () => {
    fresh();
    const r = openRound(t.p, EP, finalId());
    tickAll(r.id); playAll(r.id);
    assert.equal(checkReportFor(t.p, EP, finalId()), null);
    storeChecks(finalId());
    assert.equal(checkReportFor(t.p, EP, finalId())!.report.version, CHECKS_VERSION);
    assert.equal(checkReportFor(t.p, EP, draftId()), null, 'checks of the final file say nothing about the draft');
    assert.deepEqual(readiness(t.p, EP, DURATION).blockers, []);
  });

  test('the notes\' own revision count and approval do not interfere: a note edit after approval leaves it valid, and the episode seq moves', () => {
    fresh();
    const r = openRound(t.p, EP, finalId());
    storeChecks(finalId()); tickAll(r.id); playAll(r.id);
    approveReviewed(t.p, EP, r.id, DURATION);
    const seq = getEpisodeInfo(t.p, EP).seq;
    addReviewNote(t.p, EP, {roundId: r.id, text: 'after', type: 'general'});
    assert.ok(getEpisodeInfo(t.p, EP).seq > seq);
    assert.equal(approvalStatus(t.p, EP).state, 'valid');
  });
});
