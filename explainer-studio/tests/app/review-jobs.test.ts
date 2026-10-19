// Draft and final builds and the production-check job, on the job service with fake audio, render and probe workers. Real: handlers, runner,
// mixer (mastering), ffprobe/ffmpeg measurements, check logic, dependency hashes. Stand-ins: the voice model, the Remotion render (a real
// small MP4 carrying the real mastered mix) and the browser probe (samples of the shape the composition produces).
import assert from 'node:assert/strict';
import {chmodSync, readFileSync, writeFileSync} from 'node:fs';
import {after, before, describe, test} from 'node:test';
import {listBuilds} from '../../app/builds.ts';
import {RebuildError} from '../../app/jobs.ts';
import {statusReport} from '../../core/artifacts.ts';
import {blobPath} from '../../core/blobs.ts';
import {type CheckItem} from '../../core/checks.ts';
import {getEpisodeInfo} from '../../core/episodes.ts';
import {checkReportFor, confirmCaptionDiff, openRound, readiness, recordPlayback, setSignoff, approveReviewed} from '../../core/review.ts';
import {currentRows} from '../../core/state.ts';
import {EP, edit, fakeWorkspace, requestId, until, waitRebuild, type FakeWorkspace} from './jobs-fixture.ts';
import {toggleEmphasis} from '../../app/shared/edit.ts';

let w: FakeWorkspace;
before(() => { process.env.FAKE_RENDER_REAL = '1'; w = fakeWorkspace(); });
after(async () => { delete process.env.FAKE_RENDER_REAL; delete process.env.FAKE_PROBE_MODE; await w.close(); });

const start = (mode: 'draft' | 'final', rid = requestId()) => w.svc.startRebuild(EP, {seq: getEpisodeInfo(w.p, EP).seq, requestId: rid, mode});
const jobsOf = (id: string) => w.svc.list(EP, 100).filter((j) => j.rebuildId === id).sort((a, b) => a.id - b.id);
const kinds = (id: string) => jobsOf(id).map((j) => (j.kind === 'tts.block' ? `${j.kind}:${j.subject}` : j.kind));
const cur = (kind: string, subject: string) => currentRows(w.p, EP).find((r) => r.kind === kind && r.subject === subject);
const item = (items: CheckItem[], id: string) => { const i = items.find((x) => x.id === id); assert.ok(i, `no check ${id}`); return i; };
const runChecks = async (renderId: number) => {
  const id = w.svc.startChecks(EP, renderId);
  const job = await w.svc.runner.waitFor(id);
  assert.equal(job.state, 'succeeded', job.error ?? '');
  return checkReportFor(w.p, EP, renderId)!;
};

describe('draft and final builds', {timeout: 900_000}, () => {
  test('a draft plan builds narration, timing, the DRAFT mix and the DRAFT video, and says it can never be approved', async () => {
    const plan = w.svc.plan(EP, 'draft');
    assert.equal(plan.mode, 'draft');
    assert.deepEqual(plan.steps.map((s) => `${s.key}:${s.action}`), ['take:b1:run', 'take:b2:run', 'timing:run', 'mix:draft:run', 'render:draft:run']);
    assert.match(plan.notes.join(' '), /draft video for review.*never be approved or exported/);
    const finalPlan = w.svc.plan(EP, 'final');
    assert.deepEqual(finalPlan.steps.map((s) => s.key), ['take:b1', 'take:b2', 'timing', 'mix:final', 'render:final']);
    assert.match(finalPlan.notes.join(' '), /mastered/);
    const r = start('draft');
    await waitRebuild(w.svc, r.rebuildId, ['complete', 'failed']);
    assert.deepEqual(kinds(r.rebuildId), ['tts.block:b1', 'tts.block:b2', 'timing.build', 'mix.draft', 'render.draft']);
    assert.deepEqual(jobsOf(r.rebuildId).map((j) => j.label), ['Narration, block b1', 'Narration, block b2', 'Timing and captions', 'Draft audio mix', 'Draft video']);
    assert.ok(jobsOf(r.rebuildId).every((j) => j.state === 'succeeded'));
    const st = statusReport(w.p, EP);
    assert.equal(st.render.draft.status, 'fresh');
    assert.notEqual(st.render.final.status, 'fresh', 'a draft build does not make the final video current');
    const meta = JSON.parse(currentRowsMeta('render', 'draft'));
    assert.equal(meta.mastered, false);
    assert.equal(meta.kind, 'draft');
  });

  test('the final build after a draft reuses the narration and the timing, and its video is marked mastered', async () => {
    const draft = cur('render', 'draft')!.artifact_id;
    const r = start('final');
    await waitRebuild(w.svc, r.rebuildId, ['complete', 'failed']);
    assert.deepEqual(kinds(r.rebuildId), ['mix.final', 'render.final']);
    assert.equal(cur('render', 'draft')!.artifact_id, draft, 'the draft is kept');
    const meta = JSON.parse(currentRowsMeta('render', 'final'));
    assert.deepEqual([meta.mastered, meta.kind], [true, 'final']);
    assert.equal(statusReport(w.p, EP).render.final.status, 'fresh');
    assert.ok(listBuilds(w.p, EP).filter((b) => b.render).length >= 2);
  });

  test('a failed draft render keeps the earlier successful builds and the plan can be retried; a started second build is refused while one runs', async () => {
    // change what the draft depends on without touching narration: a render setting is shared, so use the content (a caption edit)
    const { setCaptionOnly } = await import('./jobs-fixture.ts');
    setCaptionOnly(w.p, 's2', 'That limit is called its context window.');
    const earlierDraft = cur('render', 'draft')!.artifact_id, earlierFinal = cur('render', 'final')!.artifact_id;
    process.env.FAKE_RENDER_FAIL = 'the renderer fell over';
    try {
      const r = start('draft');
      assert.throws(() => start('final'), (e: unknown) => e instanceof RebuildError && e.code === 'busy');
      await waitRebuild(w.svc, r.rebuildId, ['failed']);
      const failed = jobsOf(r.rebuildId).find((j) => j.kind === 'render.draft')!;
      assert.equal(failed.state, 'failed');
      assert.match(failed.friendlyError ?? '', /renderer fell over/);
    } finally { delete process.env.FAKE_RENDER_FAIL; }
    assert.equal(cur('render', 'draft')!.artifact_id, earlierDraft, 'the earlier draft is still the current one after the failure');
    assert.equal(cur('render', 'final')!.artifact_id, earlierFinal, 'and so is the earlier final');
    const failed = w.svc.list(EP, 100).find((j) => j.kind === 'render.draft' && j.state === 'failed')!;
    w.svc.retry(failed.id);
    await until('the retried draft render to finish', () => w.svc.list(EP, 100).find((j) => j.id === failed.id && j.state === 'succeeded'));
    assert.notEqual(cur('render', 'draft')!.artifact_id, earlierDraft, 'the retry made the new draft');
    assert.equal(statusReport(w.p, EP).render.draft.status, 'fresh');
  });

  test('cancelling a final render keeps what was already built and the earlier videos', async () => {
    edit(w.p, (d) => toggleEmphasis(d, 's3', 0)); // only the video depends on emphasis
    const earlierFinal = cur('render', 'final')!.artifact_id;
    const slow = w.tmp + '/render-control.json';
    writeFileSync(slow, JSON.stringify({frames: 200, stepMs: 60}));
    process.env.FAKE_RENDER_CONTROL = slow;
    try {
      const r = start('final');
      await until('the final render to be running', () => w.svc.list(EP, 100).find((j) => j.kind === 'render.final' && j.state === 'running' && j.rebuildId === r.rebuildId), 30_000).catch((e) => { throw new Error(`${e.message}; jobs: ${jobsOf(r.rebuildId).map((j) => `${j.kind}:${j.state}:${j.error ?? ''}`).join(' | ')}`); });
      const draft = cur('render', 'draft')!.artifact_id;
      await w.svc.cancelRebuild(r.rebuildId);
      await waitRebuild(w.svc, r.rebuildId, ['cancelled']);
      assert.equal(cur('render', 'final')!.artifact_id, earlierFinal, 'the earlier final video is still the current one');
      assert.equal(cur('render', 'draft')!.artifact_id, draft, 'and so is the draft');
      assert.ok(readFileSync(blobPath(w.p, cur('render', 'final')!.blob_hash)).length > 100, 'its file is intact');
      assert.equal(jobsOf(r.rebuildId).find((j) => j.kind === 'render.final')!.state, 'cancelled');
    } finally { delete process.env.FAKE_RENDER_CONTROL; }
    const r2 = start('final');
    await waitRebuild(w.svc, r2.rebuildId, ['complete', 'failed']);
    assert.equal(statusReport(w.p, EP).render.final.status, 'fresh');
  });
});

function currentRowsMeta(kind: string, subject: string): string {
  return cur(kind, subject)!.meta_json;
}

describe('production checks as a job', {timeout: 900_000}, () => {
  test('the check job runs in the heavy lane on the exact video, measures the real file, and the report is stored with it', async () => {
    const finalId = cur('render', 'final')!.artifact_id;
    const id = w.svc.startChecks(EP, finalId);
    assert.equal(w.svc.startChecks(EP, finalId), id, 'asking again while it runs is the same job');
    const row = w.svc.runner.row(id);
    assert.equal(row.lane, 'heavy');
    const done = await w.svc.runner.waitFor(id);
    assert.equal(done.state, 'succeeded', done.error ?? '');
    assert.equal(w.svc.list(EP, 100).find((j) => j.id === id)!.label, 'Production checks');
    const {report} = checkReportFor(w.p, EP, finalId)!;
    assert.equal(report.renderKind, 'final');
    assert.equal(report.fileSha256, cur('render', 'final')!.blob_hash);
    for (const idd of ['file.hash', 'file.container', 'file.decode', 'mastering.loudness', 'mastering.flag']) assert.equal(item(report.items, idd).status, 'pass', `${idd}: ${item(report.items, idd).detail} ${(item(report.items, idd).lines ?? []).join('; ')}`);
    assert.match(item(report.items, 'mastering.loudness').detail, /LUFS integrated \(target -16\)/);
    assert.equal(item(report.items, 'narration.words').status, 'unchecked');
    assert.equal(item(report.items, 'layout.overflow').status, 'pass');
    assert.equal(item(report.items, 'custom.scenes').kind, 'partial', 'the context-window scene is tier 3');
    assert.ok(report.limits.some((l) => /dropped/.test(l)));
  });

  test('a draft reports "not mastered" and its checks never make it approvable', async () => {
    const draftId = cur('render', 'draft')!.artifact_id;
    const {report} = await runChecks(draftId);
    assert.equal(report.renderKind, 'draft');
    assert.equal(item(report.items, 'mastering.loudness').status, 'info');
    assert.match(item(report.items, 'mastering.loudness').detail, /Not mastered/);
    const round = openRound(w.p, EP, draftId);
    assert.throws(() => approveReviewed(w.p, EP, round.id, report.sampled.frames + 1000), /not for the current final video|draft/);
  });

  test('a file altered after it was rendered fails the hash check, and then the video cannot be approved', async () => {
    const finalId = cur('render', 'final')!.artifact_id;
    openRound(w.p, EP, finalId);
    const file = blobPath(w.p, cur('render', 'final')!.blob_hash);
    const original = readFileSync(file);
    chmodSync(file, 0o644);
    const bytes = Buffer.from(original);
    bytes[Math.floor(bytes.length / 2)] ^= 0xff;
    writeFileSync(file, bytes);
    try {
      const {report} = await runChecks(finalId);
      assert.equal(item(report.items, 'file.hash').status, 'fail');
      assert.match(item(report.items, 'file.hash').detail, /changed after it was rendered/);
      assert.equal(report.passed, false);
      assert.ok(readiness(w.p, EP, 10).blockers.some((b) => /production checks have \d+ failing/.test(b)));
    } finally { writeFileSync(file, original); chmodSync(file, 0o444); }
  });

  test('layout problems found by the probe are reported (overflow), and a probe that crashes fails the job instead of passing it', async () => {
    const finalId = cur('render', 'final')!.artifact_id;
    process.env.FAKE_PROBE_MODE = 'overflow';
    try {
      // the same file checked again with a different result: results are stored per run, the newest for this exact file and suite counts
      await new Promise((r) => setTimeout(r, 5));
      const {report} = await runChecks(finalId);
      assert.equal(item(report.items, 'layout.overflow').status, 'fail');
      assert.match(item(report.items, 'layout.overflow').lines![0], /runs past its height/);
    } finally { delete process.env.FAKE_PROBE_MODE; }
    process.env.FAKE_PROBE_MODE = 'crash';
    try {
      const id = w.svc.startChecks(EP, finalId);
      const job = await w.svc.runner.waitFor(id);
      assert.equal(job.state, 'failed');
      assert.match(job.error ?? '', /probe worker exited with code 3/);
    } finally { delete process.env.FAKE_PROBE_MODE; }
  });

  test('a check job for a video that is not this episode\'s refuses to run', () => {
    assert.throws(() => w.svc.startChecks(EP, 999_999), (e: unknown) => e instanceof RebuildError && e.code === 'unknown');
  });

  test('approving the final video needs the checks to pass, the confirmations ticked by a person (SIMULATED here) and the whole file played; nothing is ticked by the app', async () => {
    assert.equal(statusReport(w.p, EP).render.final.status, 'fresh', 'the final video under review is current');
    const finalId = cur('render', 'final')!.artifact_id;
    let {report} = await runChecks(finalId);
    const round = openRound(w.p, EP, finalId);
    const untouched = readiness(w.p, EP, report.sampled.frames ? 60 : 60);
    assert.deepEqual(untouched.signoffs.map((s) => s.ticked), [false, false, false, false], 'running checks and opening a round tick nothing');
    // the caption/speech differences are the author's to confirm: SIMULATED confirmation of exactly the listed wording
    for (const d of report.captionDiffs) confirmCaptionDiff(w.p, EP, d.segment, d.hash);
    ({report} = await (async () => { const jid = w.svc.startChecks(EP, finalId); await w.svc.runner.waitFor(jid); return checkReportFor(w.p, EP, finalId)!; })());
    assert.equal(report.passed, true, report.items.filter((i) => i.status === 'fail').map((i) => `${i.id}: ${i.detail} ${(i.lines ?? []).join('; ')}`).join(' | '));
    const duration = JSON.parse(readFileSync(blobPath(w.p, JSON.parse(JSON.stringify(currentRows(w.p, EP).find((r) => r.kind === 'timing')!)).blob_hash), 'utf8')).durationSec as number;
    assert.throws(() => approveReviewed(w.p, EP, round.id, duration), /confirmations are not ticked/);
    for (const s of ['listened', 'watchedPhoneSize', 'customScenesReviewed', 'notesResolved']) setSignoff(w.p, round.id, s, true); // SIMULATED ticks
    assert.throws(() => approveReviewed(w.p, EP, round.id, duration), /played with the sound on/);
    let at = 0;
    for (let s = 0; s < duration; s += 10) { at += 10_000; w.p.now = (() => { const base = Date.now(); return () => base + at; })(); recordPlayback(w.p, round.id, duration, {fromSec: s, toSec: Math.min(duration, s + 10), heard: true, phone: s === 0}); } // SIMULATED playback
    const blockers = readiness(w.p, EP, duration).blockers;
    assert.deepEqual(blockers, [], blockers.join(' | '));
    assert.ok(approveReviewed(w.p, EP, round.id, duration) > 0);
  });
});
