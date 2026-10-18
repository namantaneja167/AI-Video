import assert from 'node:assert/strict';
import {chmodSync, rmSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {afterEach, describe, test} from 'node:test';
import {
  approvalStatus, approve, ApprovalError, ApprovalVoidError, failJob, findTake, finishJob, getApprovedFile, getJob, getSnapshot, JobError, listArtifacts, selectTake, startJob, statusReport,
} from '../../core/artifacts.ts';
import {blobPath, MissingBlobError, readBlob} from '../../core/blobs.ts';
import {adoptEpisode, getEpisode, saveEpisode} from '../../core/episodes.ts';
import {captureFileSet, currentRows, setComponent} from '../../core/state.ts';
import {plain} from '../helpers.ts';
import {buildAll, fakeBlob, newProject, setAllComponents, SIGNED, type TestProject} from './helpers.ts';

let t: TestProject;
afterEach(() => t?.close());

function fresh(): {ids: Record<string, number>} {
  t = newProject();
  adoptEpisode(t.p, 'episodes/join-fanout/episode.json');
  setAllComponents(t.p, t.root);
  return {ids: buildAll(t.p, 'join-fanout')};
}
const doc = () => plain(getEpisode(t.p, 'join-fanout'));
const edit = (fn: (d: any) => void) => {
  const d = doc();
  fn(d);
  saveEpisode(t.p, 'join-fanout', d);
};
const notFresh = () => statusReport(t.p, 'join-fanout').notFresh.sort();
const blockOf = (segment: string) => doc().narration.blocks.find((b: any) => b.segments.includes(segment))!.id as string;
const recapture = (name: 'assets' | 'fonts' | 'code' | 'theme', rel: string) => {
  writeFileSync(join(t.root, 'work', rel), `${name}:${rel}:CHANGED`);
  const files = {assets: ['art/a.png'], fonts: ['fonts/f.woff2'], code: ['src/a.tsx', 'src/b.ts'], theme: ['src/theme.ts']}[name];
  captureFileSet(t.p, name, join(t.root, 'work'), files);
};
const RENDERS = ['render:draft', 'render:final'];
const MIXES = ['mix:draft', 'mix:final'];
const all = (...extra: string[]) => extra.sort();

describe('dependency tracking and invalidation matrix', () => {
  test('a freshly built project has nothing stale, and every component is recorded', () => {
    fresh();
    const s = statusReport(t.p, 'join-fanout');
    assert.deepEqual(s.notFresh, []);
    assert.deepEqual(s.unsetComponents, []);
  });

  test('before anything is built everything reports "none", not fresh', () => {
    t = newProject();
    adoptEpisode(t.p, 'episodes/join-fanout/episode.json');
    const s = statusReport(t.p, 'join-fanout');
    assert.equal(s.timing.status, 'none');
    assert.equal(s.render.final.status, 'none');
    assert.ok(s.notFresh.includes('timing') && s.unsetComponents.includes('fonts'));
  });

  // [name, change, expected stale set]. Each change is made alone on a freshly built project.
  const rows: [string, () => void, () => string[]][] = [
    ['spoken text of a segment (no override)', () => edit((d) => (d.narration.segments[0].text += ' Really.')), () => all(`take:${blockOf('s01')}`, 'timing', ...MIXES, ...RENDERS)],
    ['spoken override of a segment', () => edit((d) => (d.narration.segments.find((s: any) => s.id === 's07').speech += ' today')), () => all(`take:${blockOf('s07')}`, 'timing', ...MIXES, ...RENDERS)],
    ['caption text only (spoken override unchanged)', () => edit((d) => (d.narration.segments.find((s: any) => s.id === 's07').text += '!')), () => all('timing', ...RENDERS)],
    ['scene parameters', () => edit((d) => (d.scenes[0].params.dashboard.value = '₹1,801')), () => all(...RENDERS)],
    ['scene layout', () => edit((d) => (d.scenes[1].layout.template = 'split-dense')), () => all(...RENDERS)],
    ['a beat', () => edit((d) => (d.beats[0].cue = d.beats[0].cue === 'checks' ? 'dashboard' : 'checks')), () => all(...RENDERS)],
    ['a chapter label', () => edit((d) => (d.chapters[0].label = 'Changed')), () => all(...RENDERS)],
    ['pacing', () => edit((d) => (d.pacing.leadInSec = 0.9)), () => all('timing', ...MIXES, ...RENDERS)],
    ['a block gap', () => edit((d) => (d.narration.blocks[0].gapAfterSec = 0.7)), () => all('timing', ...MIXES, ...RENDERS)],
    ['voice settings', () => edit((d) => (d.voice.speed = 1.1)), () => all(...doc().narration.blocks.map((b: any) => `take:${b.id}`), 'timing', ...MIXES, ...RENDERS)],
    ['voice runtime (model or reference)', () => setComponent(t.p, 'voiceRuntime', {engine: 'kokoro', model: 'kokoro-0.9', ref: 'new-reference'}), () => all(...doc().narration.blocks.map((b: any) => `take:${b.id}`), 'timing', ...MIXES, ...RENDERS)],
    ['aligner', () => setComponent(t.p, 'aligner', {id: 'qwen3-forced-aligner'}), () => all('timing', ...RENDERS)],
    ['manual timing correction', () => setComponent(t.p, 'manualTiming', {s01: {w0: 0.1}}), () => all('timing', ...RENDERS)],
    ['timeline logic', () => setComponent(t.p, 'timelineLogic', {hash: 'logic-v2'}), () => all('timing', ...RENDERS)],
    ['sound events', () => setComponent(t.p, 'soundEvents', [{cue: 'sum-start', sfx: 'tick'}]), () => all(...MIXES, ...RENDERS)],
    ['sound asset files', () => setComponent(t.p, 'soundAssets', {tick: 'abc'}), () => all(...MIXES, ...RENDERS)],
    ['mix parameters', () => setComponent(t.p, 'mixParams', {voiceGain: 3}), () => all(...MIXES, ...RENDERS)],
    ['mastering targets (configurable)', () => setComponent(t.p, 'masteringParams', {integratedLufs: -14, truePeakDb: -1}), () => all('mix:final', 'render:final')],
    ['theme', () => recapture('theme', 'src/theme.ts'), () => all(...RENDERS)],
    ['a font file', () => recapture('fonts', 'fonts/f.woff2'), () => all(...RENDERS)],
    ['an asset file', () => recapture('assets', 'art/a.png'), () => all(...RENDERS)],
    ['scene code', () => recapture('code', 'src/a.tsx'), () => all(...RENDERS)],
    ['Remotion or browser version', () => setComponent(t.p, 'versions', {remotion: '4.0.999', chrome: 'test'}), () => all(...RENDERS)],
    ['render settings', () => setComponent(t.p, 'renderSettings', {width: 1080, height: 1920, fps: 60, codec: 'h264', crf: 18, audio: 'aac'}), () => all(...RENDERS)],
    ['title, objective, sources, notes, status', () => edit((d) => { d.title = 'T'; d.learningObjective = 'O'; d.sources = [{title: 'S'}]; d.reviewNotes.push({id: 'notex', text: 'n'}); d.status = 'approved'; }), () => []],
  ];
  for (const [name, change, expected] of rows) {
    test(`changing only: ${name}`, () => {
      fresh();
      change();
      assert.deepEqual(notFresh(), expected());
    });
  }

  test('selecting a different take stales timing, mixes and renders (the audio changed), not the takes', () => {
    fresh();
    const block = blockOf('s01');
    const {jobId} = startJob(t.p, {episodeId: 'join-fanout', jobKind: 'tts.block', subject: block});
    const reroll = finishJob(t.p, jobId, {blobHash: fakeBlob(t.p, 'reroll'), seed: 2});
    assert.equal(reroll.selected, false, 're-roll of a fresh take stays unselected');
    assert.deepEqual(notFresh(), []);
    selectTake(t.p, 'join-fanout', block, reroll.artifactId);
    assert.deepEqual(notFresh(), all('timing', ...MIXES, ...RENDERS));
  });

  test('regenerating timing stales renders only', () => {
    fresh();
    const {jobId} = startJob(t.p, {episodeId: 'join-fanout', jobKind: 'timing.build'});
    finishJob(t.p, jobId, {blobHash: fakeBlob(t.p, 'timing-2')});
    assert.deepEqual(notFresh(), all(...RENDERS));
  });

  test('merging two blocks leaves the merged block without a take; unaffected takes stay fresh', () => {
    fresh();
    edit((d) => {
      const [a, b] = d.narration.blocks;
      d.narration.blocks = [{id: 'merged', segments: [...a.segments, ...b.segments]}, ...d.narration.blocks.slice(2)];
    });
    const s = statusReport(t.p, 'join-fanout');
    assert.equal(s.takes.merged.status, 'none');
    assert.ok(Object.entries(s.takes).filter(([id]) => id !== 'merged').every(([, e]) => e.status === 'fresh'));
  });

  test('a missing output file is reported as missing and stales everything built on it', () => {
    const {ids} = fresh();
    const row = currentRows(t.p, 'join-fanout').find((r) => r.artifact_id === ids['timing'])!;
    chmodSync(blobPath(t.p, row.blob_hash), 0o644);
    rmSync(blobPath(t.p, row.blob_hash));
    const s = statusReport(t.p, 'join-fanout');
    assert.equal(s.timing.status, 'missing');
    assert.equal(s.render.final.status, 'stale');
    assert.ok(!s.notFresh.includes('mix:draft'));
  });
});

describe('jobs run on immutable snapshots', () => {
  test('a job finished after an edit is kept as OUTDATED and never replaces the current output', () => {
    const {ids} = fresh();
    const before = currentRows(t.p, 'join-fanout').find((r) => r.kind === 'render' && r.subject === 'final')!;
    const job = startJob(t.p, {episodeId: 'join-fanout', jobKind: 'render.final'});
    edit((d) => (d.chapters[0].label = 'Edited'));
    const done = finishJob(t.p, job.jobId, {blobHash: fakeBlob(t.p, 'late render'), meta: {mastered: true}});
    assert.equal(done.outcome, 'outdated');
    assert.equal(getJob(t.p, job.jobId)!.state, 'outdated');
    const after = currentRows(t.p, 'join-fanout').find((r) => r.kind === 'render' && r.subject === 'final')!;
    assert.equal(after.artifact_id, before.artifact_id, 'current pointer unchanged');
    assert.equal(after.artifact_id, ids['render:final']);
    const kept = listArtifacts(t.p, 'join-fanout').find((a) => a.id === done.artifactId)!;
    assert.equal(kept.outdated, 1);
    assert.equal(kept.revision_number, job.revision, 'labelled with the revision it was made for');
    assert.ok(readBlob(t.p, kept.blob_hash).toString().includes('late render'), 'output preserved');
  });

  test('an outdated job cannot move the approved file; a current one still cannot either', () => {
    fresh();
    const a = approve(t.p, 'join-fanout', SIGNED);
    const job = startJob(t.p, {episodeId: 'join-fanout', jobKind: 'render.final'});
    edit((d) => (d.scenes[0].params.dashboard.value = '₹9'));
    finishJob(t.p, job.jobId, {blobHash: fakeBlob(t.p, 'x'), meta: {mastered: true}});
    assert.equal(t.p.db.prepare('SELECT approval_id FROM approved').get()!.approval_id, a);
    const j2 = startJob(t.p, {episodeId: 'join-fanout', jobKind: 'render.final'});
    assert.equal(finishJob(t.p, j2.jobId, {blobHash: fakeBlob(t.p, 'y'), meta: {mastered: true}}).outcome, 'current');
    assert.equal(t.p.db.prepare('SELECT approval_id FROM approved').get()!.approval_id, a, 'only approve() moves the pointer');
    assert.equal(approvalStatus(t.p, 'join-fanout').state, 'void');
  });

  test('the snapshot is frozen: later edits do not change what the job was given', () => {
    fresh();
    const before = doc();
    const job = startJob(t.p, {episodeId: 'join-fanout', jobKind: 'render.draft'});
    edit((d) => (d.title = 'changed afterwards'));
    edit((d) => (d.narration.segments[0].text += ' Totally different words appended.'));
    const snap = getSnapshot(t.p, job.snapshotId);
    const frozen = JSON.parse(readBlob(t.p, snap.docBlob).toString());
    assert.deepEqual(frozen, before);
    assert.equal(snap.revision, job.revision);
  });

  test('identical inputs share one snapshot', () => {
    fresh();
    const a = startJob(t.p, {episodeId: 'join-fanout', jobKind: 'render.draft'});
    const b = startJob(t.p, {episodeId: 'join-fanout', jobKind: 'render.final'});
    assert.equal(a.snapshotId, b.snapshotId);
  });

  test('a job cannot finish twice, with a missing blob, or on a missing block; failure is recorded', () => {
    fresh();
    const j = startJob(t.p, {episodeId: 'join-fanout', jobKind: 'timing.build'});
    assert.throws(() => finishJob(t.p, j.jobId, {blobHash: 'f'.repeat(64)}), MissingBlobError);
    assert.equal(getJob(t.p, j.jobId)!.state, 'running');
    failJob(t.p, j.jobId, 'worker crashed');
    assert.deepEqual([getJob(t.p, j.jobId)!.state, getJob(t.p, j.jobId)!.error], ['failed', 'worker crashed']);
    assert.throws(() => finishJob(t.p, j.jobId, {blobHash: fakeBlob(t.p, 'z')}), JobError);
    assert.throws(() => startJob(t.p, {episodeId: 'join-fanout', jobKind: 'tts.block', subject: 'nope'}), JobError);
  });

  test('take cache: same text, runtime and seed is found; a new seed or edited text is not', () => {
    fresh();
    const block = blockOf('s01');
    const hit = findTake(t.p, 'join-fanout', block, 1);
    assert.ok(hit);
    assert.equal(findTake(t.p, 'join-fanout', block, 99), undefined);
    edit((d) => (d.narration.segments[0].text += ' Edited.'));
    assert.equal(findTake(t.p, 'join-fanout', block, 1), undefined, 'edited text is a cache miss');
    assert.ok(findTake(t.p, 'join-fanout', blockOf('s07'), 1), 'other blocks still hit');
  });

  test('after a text edit the new take is selected automatically because the old selection is stale', () => {
    fresh();
    const block = blockOf('s01');
    edit((d) => (d.narration.segments[0].text += ' Edited.'));
    const j = startJob(t.p, {episodeId: 'join-fanout', jobKind: 'tts.block', subject: block});
    const r = finishJob(t.p, j.jobId, {blobHash: fakeBlob(t.p, 'new take'), seed: 1});
    assert.equal(r.selected, true);
    assert.equal(statusReport(t.p, 'join-fanout').takes[block].status, 'fresh');
  });
});

describe('approval', () => {
  test('approving records the file hash and the inputs; export would get exactly those bytes', () => {
    fresh();
    const id = approve(t.p, 'join-fanout', SIGNED);
    const s = approvalStatus(t.p, 'join-fanout');
    assert.deepEqual([s.state, s.approvalId, s.changed], ['valid', id, []]);
    const f = getApprovedFile(t.p, 'join-fanout');
    assert.equal(f.sha256, currentRows(t.p, 'join-fanout').find((r) => r.kind === 'render' && r.subject === 'final')!.blob_hash);
    assert.equal(t.p.db.prepare("SELECT kind FROM revisions WHERE kind='approval'").all().length, 1, 'approval takes a permanent revision');
  });

  test('every missing precondition is refused, and all problems are listed together', () => {
    t = newProject();
    adoptEpisode(t.p, 'episodes/join-fanout/episode.json');
    assert.throws(() => approve(t.p, 'join-fanout', {} as any), (e: ApprovalError) => e.problems.some((p) => /no final render/.test(p)) && e.problems.some((p) => /not recorded: .*fonts/.test(p)) && e.problems.some((p) => /sign-offs missing/.test(p)));
  });

  test('a draft-only project, an unmastered final, a stale final and missing sign-offs cannot be approved', () => {
    fresh();
    // unmastered
    const j = startJob(t.p, {episodeId: 'join-fanout', jobKind: 'render.final'});
    finishJob(t.p, j.jobId, {blobHash: fakeBlob(t.p, 'unmastered'), meta: {mastered: false}});
    assert.throws(() => approve(t.p, 'join-fanout', SIGNED), /not marked as mastered/);
    // missing sign-off
    const j2 = startJob(t.p, {episodeId: 'join-fanout', jobKind: 'render.final'});
    finishJob(t.p, j2.jobId, {blobHash: fakeBlob(t.p, 'mastered'), meta: {mastered: true}});
    assert.throws(() => approve(t.p, 'join-fanout', {...SIGNED, listened: false}), /sign-offs missing: listened/);
    // stale
    edit((d) => (d.chapters[0].label = 'Edited'));
    assert.throws(() => approve(t.p, 'join-fanout', SIGNED), /final render is stale/);
  });

  // part names that must be reported when ONE input changes after approval
  const voiding: [string, () => void, string[]][] = [
    ['a caption', () => edit((d) => (d.narration.segments.find((s: any) => s.id === 's07').text += '!')), ['content', 'timing']],
    ['a scene parameter', () => edit((d) => (d.scenes[0].params.dashboard.value = '₹7')), ['content']],
    ['the theme', () => recapture('theme', 'src/theme.ts'), ['theme']],
    ['a font', () => recapture('fonts', 'fonts/f.woff2'), ['fonts']],
    ['an asset', () => recapture('assets', 'art/a.png'), ['assets']],
    ['scene code', () => recapture('code', 'src/b.ts'), ['code']],
    ['render settings', () => setComponent(t.p, 'renderSettings', {width: 720}), ['settings']],
    ['the sound mix', () => setComponent(t.p, 'soundEvents', [{cue: 'x'}]), ['mix']],
    ['mastering targets', () => setComponent(t.p, 'masteringParams', {integratedLufs: -18, truePeakDb: -2}), ['mix']],
    ['the Remotion version', () => setComponent(t.p, 'versions', {remotion: '5.0.0', chrome: 'test'}), ['versions']],
  ];
  for (const [name, change, parts] of voiding) {
    test(`approval is voided by ${name}, and says what changed`, () => {
      fresh();
      approve(t.p, 'join-fanout', SIGNED);
      change();
      const s = approvalStatus(t.p, 'join-fanout');
      assert.equal(s.state, 'void');
      assert.deepEqual(s.changed, parts);
      assert.throws(() => getApprovedFile(t.p, 'join-fanout'), ApprovalVoidError);
    });
  }

  test('changing a title, a note or a source does NOT void approval', () => {
    fresh();
    approve(t.p, 'join-fanout', SIGNED);
    edit((d) => { d.title = 'Another title'; d.reviewNotes.push({id: 'n99', text: 'looks fine'}); d.sources.push({title: 'x'}); });
    assert.equal(approvalStatus(t.p, 'join-fanout').state, 'valid');
  });

  test('changing the spoken text voids approval (audio, timing and content)', () => {
    fresh();
    approve(t.p, 'join-fanout', SIGNED);
    edit((d) => (d.narration.segments[0].text += ' Hmm.'));
    const s = approvalStatus(t.p, 'join-fanout');
    assert.equal(s.state, 'void');
    assert.deepEqual(s.changed, ['content', 'timing', 'mix']);
  });

  test('a damaged or missing approved file is caught when it is fetched', () => {
    fresh();
    approve(t.p, 'join-fanout', SIGNED);
    const f = getApprovedFile(t.p, 'join-fanout');
    chmodSync(f.path, 0o644);
    writeFileSync(f.path, 'tampered!');
    assert.throws(() => getApprovedFile(t.p, 'join-fanout'), (e: ApprovalVoidError) => e instanceof ApprovalVoidError && e.changed.includes('file'));
  });

  test('re-approval after a rebuild adds a new approval; the old record is kept', () => {
    fresh();
    const first = approve(t.p, 'join-fanout', SIGNED);
    edit((d) => (d.chapters[0].label = 'New'));
    buildAll(t.p, 'join-fanout', 'b');
    const second = approve(t.p, 'join-fanout', SIGNED);
    assert.notEqual(first, second);
    assert.equal(t.p.db.prepare('SELECT COUNT(*) c FROM approvals').get()!.c, 2);
    assert.equal(approvalStatus(t.p, 'join-fanout').approvalId, second);
  });
});
