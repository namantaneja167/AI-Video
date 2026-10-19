// Backup and restore of everything a reviewed project holds, in isolated temp projects: documents, revisions, selected takes, builds, notes,
// review rounds, playback, sign-offs (all SIMULATED here), check reports and the approval and what it rested on. Restores go to a different path
// than the original; nothing refers to where the project used to live.
import assert from 'node:assert/strict';
import {chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {afterEach, describe, test} from 'node:test';
import {approvalStatus, finishJob, startJob} from '../../core/artifacts.ts';
import {createBackup, restoreBackup, verifyBackup} from '../../core/backup.ts';
import {putBytes, verifyAll} from '../../core/blobs.ts';
import {buildReport, type CheckItem} from '../../core/checks.ts';
import {adoptEpisode, getEpisode, listRevisions, saveEpisode} from '../../core/episodes.ts';
import {addReviewNote, approveReviewed, checkReportFor, coverageOf, getSignoffs, listRounds, openRound, recordPlayback, setSignoff} from '../../core/review.ts';
import {Project} from '../../core/project.ts';
import {currentRows} from '../../core/state.ts';
import {plain} from '../helpers.ts';
import {buildAll, newProject, setAllComponents, tempRoot, type TestProject} from './helpers.ts';

const EP = 'join-fanout';
const DURATION = 60;
let t: TestProject;
afterEach(() => t?.close());

const finalId = (p: Project) => currentRows(p, EP).find((r) => r.kind === 'render' && r.subject === 'final')!.artifact_id;
const draftId = (p: Project) => currentRows(p, EP).find((r) => r.kind === 'render' && r.subject === 'draft')!.artifact_id;
const checks = (p: Project, renderId: number) => {
  const row = currentRows(p, EP).find((r) => r.artifact_id === renderId)!;
  const items: CheckItem[] = [{id: 'x', section: 'narration', title: 'x', kind: 'measured', status: 'pass', detail: 'simulated'}];
  const report = buildReport({renderArtifactId: renderId, renderKind: row.subject as 'draft' | 'final', fileSha256: row.blob_hash, items, captionDiffs: [], sampled: {frames: 0, scenes: []}});
  const job = startJob(p, {episodeId: EP, jobKind: 'check.suite', subject: String(renderId)});
  return finishJob(p, job.jobId, {blobHash: putBytes(p, JSON.stringify(report)).hash, meta: {simulated: true}}).artifactId;
};

/** A reviewed project: a round on the draft (with a note) and on the final (SIMULATED playback and sign-offs), approved. */
function reviewed() {
  t = newProject();
  adoptEpisode(t.p, 'episodes/join-fanout/episode.json');
  setAllComponents(t.p, t.root);
  buildAll(t.p, EP);
  const d = plain(getEpisode(t.p, EP));
  for (const n of d.reviewNotes) n.status = 'resolved';
  saveEpisode(t.p, EP, d);
  const dr = openRound(t.p, EP, draftId(t.p));
  addReviewNote(t.p, EP, {roundId: dr.id, text: 'a draft-era note', type: 'general', segment: 's01'});
  const fr = openRound(t.p, EP, finalId(t.p));
  checks(t.p, draftId(t.p));
  checks(t.p, finalId(t.p));
  for (let s = 0; s < DURATION; s += 10) { t.clock.advance(10_000); recordPlayback(t.p, fr.id, DURATION, {fromSec: s, toSec: s + 10, heard: true, phone: s === 0}); }
  for (const i of ['listened', 'watchedPhoneSize', 'customScenesReviewed']) setSignoff(t.p, fr.id, i, true);
  const open = getEpisode(t.p, EP).reviewNotes.filter((n) => n.status === 'open');
  const d2 = plain(getEpisode(t.p, EP));
  for (const n of d2.reviewNotes) if (n.status === 'open') n.status = 'resolved';
  saveEpisode(t.p, EP, d2);
  setSignoff(t.p, fr.id, 'notesResolved', true);
  approveReviewed(t.p, EP, fr.id, DURATION);
  return {draftRound: dr, finalRound: fr, openedNotes: open.length};
}

const rows = (p: Project, sql: string) => p.db.prepare(sql).all() as Record<string, unknown>[];
/** What the review and approval provenance says, without the ids that may differ. */
function provenance(p: Project) {
  const a = approvalStatus(p, EP);
  return {
    approval: {state: a.state, fileSha256: (a as {fileSha256?: string}).fileSha256 ?? null},
    rounds: listRounds(p, EP).map((r) => ({number: r.number, kind: r.kind, file: r.fileSha256})),
    signoffs: Object.fromEntries(listRounds(p, EP).map((r) => [r.number, getSignoffs(p, r.id).map((s) => [s.item, s.ticked])])),
    playbackRanges: rows(p, 'SELECT from_ms, to_ms, heard, phone FROM review_playback ORDER BY id'),
    approvalReview: rows(p, 'SELECT round_id, coverage_json, detail_json FROM approval_review'),
    notes: getEpisode(p, EP).reviewNotes.map((n) => [n.id, n.status, n.text]),
  };
}
const builds = (p: Project) => currentRows(p, EP).map((r) => `${r.kind}:${r.subject}:${r.blob_hash}`).sort();

describe('a complete backup carries the whole reviewed project to a different path', () => {
  test('documents, revisions, builds, selected takes, notes, rounds, playback, sign-offs, check reports and the approval all come back', () => {
    reviewed();
    const before = {prov: provenance(t.p), builds: builds(t.p), revisions: listRevisions(t.p, EP).map((r) => [r.number, r.kind, r.docHash]), doc: getEpisode(t.p, EP), takes: currentRows(t.p, EP).filter((r) => r.kind === 'take').length};
    const dest = join(tempRoot('studio-bk-'), 'backup');
    const sum = createBackup(t.p, dest, {includeDrafts: true});
    assert.equal(sum.droppedReviewRounds, 0);
    assert.deepEqual(verifyBackup(dest).problems, []);
    const target = join(tempRoot('studio-restored-'), 'a different place', 'project');
    const report = restoreBackup(dest, target);
    assert.deepEqual(report.missingBlobs, []);
    const r = Project.open(target);
    try {
      assert.deepEqual(provenance(r), before.prov);
      assert.deepEqual(builds(r), before.builds);
      assert.deepEqual(listRevisions(r, EP).map((x) => [x.number, x.kind, x.docHash]), before.revisions);
      assert.deepEqual(getEpisode(r, EP), before.doc);
      assert.equal(currentRows(r, EP).filter((x) => x.kind === 'take').length, before.takes);
      assert.equal(approvalStatus(r, EP).state, 'valid', 'the approval is still valid on the restored project');
      for (const id of [draftId(r), finalId(r)]) assert.ok(checkReportFor(r, EP, id), 'the check report of each video came back');
      const final = listRounds(r, EP).find((x) => x.kind === 'final')!;
      assert.ok(coverageOf(r, final.id, DURATION).complete, 'the playback coverage came back');
      const v = verifyAll(r);
      assert.deepEqual([v.missing, v.corrupt, v.orphanFiles], [[], [], []]);
      assert.ok(v.checked > 0);
      assert.deepEqual(rows(r, 'PRAGMA foreign_key_check'), []);
    } finally { r.close(); }
  });

  test('every saved narration take comes back, the unselected re-rolls included, and the selected one is still the selected one', () => {
    reviewed();
    const blk = getEpisode(t.p, EP).narration.blocks[0].id;
    for (let i = 0; i < 2; i++) { // two re-rolls the author did not choose
      const j = startJob(t.p, {episodeId: EP, jobKind: 'tts.block', subject: blk});
      finishJob(t.p, j.jobId, {blobHash: putBytes(t.p, `an unselected re-roll ${i}`).hash, seed: 100 + i});
    }
    const takes = (p: Project) => rows(p, "SELECT subject, blob_hash FROM artifacts WHERE kind='take' ORDER BY id").map((r) => `${r.subject}:${r.blob_hash}`);
    const selected = (p: Project) => currentRows(p, EP).filter((r) => r.kind === 'take').map((r) => `${r.subject}:${r.blob_hash}`).sort();
    const dest = join(tempRoot('studio-bk-'), 'backup');
    createBackup(t.p, dest, {includeDrafts: false});
    const target = join(tempRoot('studio-restored-'), 'p');
    restoreBackup(dest, target);
    const r = Project.open(target);
    try {
      assert.deepEqual(takes(r), takes(t.p), 'all takes, in order');
      assert.deepEqual(selected(r), selected(t.p), 'the same take is selected');
      assert.ok(takes(r).length >= 3);
    } finally { r.close(); }
  });

  test('nothing in the restored project names the place it came from', () => {
    reviewed();
    const dest = join(tempRoot('studio-bk-'), 'backup');
    createBackup(t.p, dest, {includeDrafts: true});
    const target = join(tempRoot('studio-restored-'), 'elsewhere');
    restoreBackup(dest, target);
    const r = Project.open(target);
    try {
      const tables = rows(r, "SELECT name FROM sqlite_master WHERE type='table'").map((x) => x.name as string);
      for (const name of tables) {
        for (const row of rows(r, `SELECT * FROM ${name}`)) {
          for (const v of Object.values(row)) if (typeof v === 'string') assert.ok(!v.includes(t.root), `${name} refers to the original path`);
        }
      }
    } finally { r.close(); }
  });

  test('a compact backup (without draft videos) also works: the draft round goes with its file, the approved final and everything it rested on stay', () => {
    reviewed();
    const dest = join(tempRoot('studio-bk-'), 'compact');
    const sum = createBackup(t.p, dest, {includeDrafts: false});
    assert.equal(sum.droppedReviewRounds, 1);
    assert.deepEqual(verifyBackup(dest).problems, []);
    const target = join(tempRoot('studio-restored-'), 'project');
    restoreBackup(dest, target);
    const r = Project.open(target);
    try {
      assert.deepEqual(listRounds(r, EP).map((x) => x.kind), ['final']);
      assert.equal(approvalStatus(r, EP).state, 'valid');
      assert.ok(checkReportFor(r, EP, finalId(r)), 'the report the approval rested on is carried');
      assert.deepEqual(rows(r, 'PRAGMA foreign_key_check'), []);
      assert.equal(rows(r, 'SELECT checks_artifact_id FROM approval_review')[0].checks_artifact_id !== null, true);
    } finally { r.close(); }
  });
});

describe('damaged, missing and interrupted backups are refused and leave nothing behind', () => {
  const make = () => {
    reviewed();
    const dest = join(tempRoot('studio-bk-'), 'backup');
    createBackup(t.p, dest, {includeDrafts: true});
    return dest;
  };
  const blobFiles = (dest: string) => readdirSync(join(dest, 'blobs')).flatMap((d) => readdirSync(join(dest, 'blobs', d)).map((f) => join(dest, 'blobs', d, f)));

  test('one changed byte in a blob, a missing blob, a missing manifest and a changed database are each refused', () => {
    const dest = make();
    const target = join(tempRoot('studio-restored-'), 'p');
    const [first, second] = blobFiles(dest);
    const keep = readFileSync(first);
    chmodSync(first, 0o644);
    writeFileSync(first, Buffer.concat([keep, Buffer.from('x')]));
    assert.throws(() => restoreBackup(dest, target), /damaged or incomplete/);
    assert.equal(existsSync(target), false, 'nothing was left behind');
    writeFileSync(first, keep);
    const keep2 = readFileSync(second);
    chmodSync(second, 0o644);
    rmSync(second);
    assert.match(verifyBackup(dest).problems.join(' '), /missing|not found|No such/i);
    assert.throws(() => restoreBackup(dest, target), /damaged or incomplete/);
    writeFileSync(second, keep2);
    const db = readFileSync(join(dest, 'project.sqlite'));
    writeFileSync(join(dest, 'project.sqlite'), Buffer.concat([db, Buffer.from('x')]));
    assert.throws(() => restoreBackup(dest, target), /damaged or incomplete/);
    writeFileSync(join(dest, 'project.sqlite'), db);
    rmSync(join(dest, 'manifest.json'));
    assert.equal(verifyBackup(dest).ok, false);
    assert.throws(() => restoreBackup(dest, target));
    assert.equal(existsSync(target), false);
    assert.deepEqual(readdirSync(join(target, '..')), [], 'no half-restored folder either');
  });

  test('restoring into a folder that has anything in it is refused and the folder is untouched', () => {
    const dest = make();
    const target = tempRoot('studio-restored-');
    writeFileSync(join(target, 'mine.txt'), 'keep me');
    assert.throws(() => restoreBackup(dest, target), /not empty/);
    assert.equal(readFileSync(join(target, 'mine.txt'), 'utf8'), 'keep me');
  });

  test('a restore that is interrupted partway leaves no project at the target, and a second restore succeeds', () => {
    const dest = make();
    const parent = tempRoot('studio-restored-');
    const target = join(parent, 'p');
    mkdirSync(`${target}.restoring-1`, {recursive: true}); // what an interrupted run could leave beside the target
    writeFileSync(join(`${target}.restoring-1`, 'partial'), 'x');
    assert.equal(existsSync(join(target, '.studio')), false);
    restoreBackup(dest, target);
    assert.ok(existsSync(join(target, '.studio', 'project.sqlite')));
    const r = Project.open(target);
    try { assert.equal(approvalStatus(r, EP).state, 'valid'); } finally { r.close(); }
  });
});

describe('the project itself survives damage and interruption', () => {
  test('a missing build file is reported on open, and a backup refuses until verify is clean', () => {
    reviewed();
    const row = currentRows(t.p, EP).find((r) => r.kind === 'render' && r.subject === 'final')!;
    const file = join(t.root, '.studio', 'blobs', row.blob_hash.slice(0, 2), row.blob_hash);
    t.p.close();
    rmSync(file, {force: true});
    const p2 = Project.open(t.root);
    t.p = p2;
    assert.ok(p2.recovery.missingBlobs.includes(row.blob_hash), 'the missing video is named on open');
    assert.throws(() => createBackup(p2, join(tempRoot('studio-bk-'), 'b')), /missing/);
  });
});
