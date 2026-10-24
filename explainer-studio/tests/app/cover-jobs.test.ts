// The matching cover image of a rendered video, and the opening hook that decides it: on the job service with fake audio, render and still
// workers. Real: handlers, runner, dependency hashes, freshness, approval, export, ffmpeg (the fake still worker's PNG). Stand-ins: the voice
// model, the Remotion render (a small real MP4) and the Remotion still (a flat PNG whose colour depends on the hook).
// What the hook edit does to the rest of the build is checked here too: narration, timing and the mix are reused.
import assert from 'node:assert/strict';
import {existsSync, readFileSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import {after, before, describe, test} from 'node:test';
import {ReviewService} from '../../app/review.ts';
import {withHook} from '../../app/shared/opening.ts';
import {approve, approvalStatus, statusReport} from '../../core/artifacts.ts';
import {blobPath} from '../../core/blobs.ts';
import {coverFor} from '../../core/cover.ts';
import {COVER_FRAME} from '../../core/coverSpec.ts';
import {getEpisode, getEpisodeInfo} from '../../core/episodes.ts';
import {exportApproved, ExportError, verifyPackage} from '../../core/export.ts';
import {Project} from '../../core/project.ts';
import {currentRows} from '../../core/state.ts';
import {SIGNED} from '../store/helpers.ts';
import {EP, edit, fakeWorkspace, requestId, until, waitRebuild, type FakeWorkspace} from './jobs-fixture.ts';

let w: FakeWorkspace;
let specCopy: string;
before(() => {
  process.env.FAKE_RENDER_REAL = '1';
  w = fakeWorkspace();
  specCopy = join(w.tmp, 'still-spec.json');
  process.env.FAKE_STILL_SPEC_COPY = specCopy;
});
after(async () => { delete process.env.FAKE_RENDER_REAL; delete process.env.FAKE_STILL_SPEC_COPY; delete process.env.FAKE_STILL_MODE; try { await w.close(); } catch { rmSync(w.tmp, {recursive: true, force: true}); } });

const rebuildFinal = async () => {
  const rb = w.svc.startRebuild(EP, {seq: getEpisodeInfo(w.p, EP).seq, requestId: requestId(), mode: 'final'});
  await waitRebuild(w.svc, rb.rebuildId, ['complete']);
  return w.svc.list(EP, 100).filter((j) => j.rebuildId === rb.rebuildId).sort((a, b) => a.id - b.id).map((j) => j.kind);
};
const cur = (kind: string, subject: string) => currentRows(w.p, EP).find((r) => r.kind === kind && r.subject === subject);
const finalId = () => cur('render', 'final')!.artifact_id;
const makeCover = async (renderId: number) => {
  const id = w.svc.startCover(EP, renderId);
  const job = await w.svc.runner.waitFor(id);
  return job;
};
const review = () => new ReviewService(w.svc, {exportsRoot: join(w.tmp, 'exports')});

describe('a cover belongs to one video and follows it', {timeout: 900_000}, () => {
  let oldFinal = 0;

  test('an older episode without a hook is built, approved and exported exactly as before: no cover is asked for or exported', async () => {
    assert.equal(getEpisode(w.p, EP).scenes[0].openingHook, undefined);
    await rebuildFinal();
    oldFinal = finalId();
    const cv = coverFor(w.p, EP, oldFinal);
    assert.equal(cv.state, 'none');
    assert.equal(cv.hook, null);
    assert.equal(review().view(EP).videos.find((v) => v.renderArtifactId === oldFinal)!.cover, null, 'no cover is offered for a video without the opening');
    approve(w.p, EP, SIGNED);
    const r = exportApproved(w.p, EP, {exportsRoot: join(w.tmp, 'exports')});
    assert.deepEqual(r.files.map((f) => f.role).sort(), ['captions', 'captions', 'checksums', 'credits', 'metadata', 'video']);
    assert.ok(!r.files.some((f) => f.name.endsWith('.png')));
    assert.ok(verifyPackage(r.dir).ok);
    assert.equal(JSON.parse(readFileSync(join(r.dir, 'metadata.json'), 'utf8')).cover, undefined);
  });

  test('a cover cannot be made for a video that has no branded opening', async () => {
    assert.throws(() => review().makeCover(EP, oldFinal), /no branded opening/);
    const job = await makeCover(oldFinal);
    assert.equal(job.state, 'failed');
    assert.match(job.error ?? '', /no branded opening/);
    assert.equal(coverFor(w.p, EP, oldFinal).state, 'none');
  });

  let narrationBefore: Record<string, number>;
  let hookFinal = 0;

  test('a hook-only edit makes the video out of date and nothing else: narration, timing and the mix are reused', async () => {
    narrationBefore = Object.fromEntries(currentRows(w.p, EP).filter((r) => ['take', 'timing', 'mix'].includes(r.kind)).map((r) => [`${r.kind}:${r.subject}`, r.artifact_id]));
    const before = statusReport(w.p, EP);
    assert.equal(before.render.final.status, 'fresh');
    edit(w.p, (d) => withHook(d, 'A model forgets old words'));
    const st = statusReport(w.p, EP);
    assert.equal(st.render.final.status, 'stale');
    assert.equal(st.render.draft.status === 'fresh' || st.render.draft.status === 'stale' || st.render.draft.status === 'none', true);
    for (const [id, e] of Object.entries(st.takes)) assert.equal(e.status, 'fresh', `take ${id} stays fresh`);
    assert.equal(st.timing.status, 'fresh');
    assert.equal(st.mix.final.status, 'fresh');
    assert.equal(approvalStatus(w.p, EP).state, 'void', 'the approval of the earlier video no longer holds');
    const plan = w.svc.plan(EP, 'final');
    assert.deepEqual(plan.steps.filter((s) => s.action === 'run').map((s) => s.key), ['render:final'], 'only the video is rebuilt');
    const kinds = await rebuildFinal();
    assert.deepEqual(kinds, ['render.final']);
    const after = Object.fromEntries(currentRows(w.p, EP).filter((r) => ['take', 'timing', 'mix'].includes(r.kind)).map((r) => [`${r.kind}:${r.subject}`, r.artifact_id]));
    assert.deepEqual(after, narrationBefore, 'the same takes, timing and mix artifacts are still the current ones');
    hookFinal = finalId();
    assert.notEqual(hookFinal, oldFinal);
  });

  test('the cover is drawn from that video\'s own recorded inputs, without captions, and is tied to it', async () => {
    assert.equal(coverFor(w.p, EP, hookFinal).state, 'none');
    const job = await makeCover(hookFinal);
    assert.equal(job.state, 'succeeded', job.error ?? '');
    const spec = JSON.parse(readFileSync(specCopy, 'utf8'));
    assert.equal(spec.frame, COVER_FRAME);
    assert.equal(spec.composition, 'studio-episode');
    assert.equal(spec.inputProps.data.previewOnly, true);
    assert.deepEqual(spec.inputProps.data.timeline.captions, [], 'no captions are drawn');
    assert.equal(spec.inputProps.data.episode.scenes[0].openingHook, 'A model forgets old words');
    const recordedTimeline = JSON.parse(readFileSync(blobPath(w.p, cur('timing', 'timeline')!.blob_hash), 'utf8'));
    assert.equal(spec.inputProps.data.timeline.durationSec, recordedTimeline.durationSec, 'the same timeline the video used');
    assert.equal(spec.inputProps.data.timeline.segments.length, recordedTimeline.segments.length);
    const cv = coverFor(w.p, EP, hookFinal);
    assert.equal(cv.state, 'fresh');
    assert.equal(cv.hook, 'A model forgets old words');
    assert.equal(cv.renderSha256, cur('render', 'final')!.blob_hash);
    assert.deepEqual([cv.width, cv.height, cv.frame], [1080, 1920, COVER_FRAME]);
    const row = w.p.db.prepare("SELECT subject, meta_json FROM artifacts WHERE id=?").get(cv.coverArtifactId!)!;
    assert.equal(row.subject, String(hookFinal));
    assert.equal(JSON.parse(row.meta_json as string).captions, 'none');
    const view = review().view(EP).videos.find((v) => v.renderArtifactId === hookFinal)!;
    assert.equal(view.cover?.state, 'fresh');
    assert.equal(view.cover?.url, `/media/cover/${EP}/${hookFinal}.png`);
    assert.equal(view.cover?.downloadUrl, `/media/cover/${EP}/${hookFinal}.png?download=1`);
    assert.equal(view.cover?.filename, `${EP}-cover.png`);
    assert.equal(w.svc.startCover(EP, hookFinal) > 0, true);
    await w.svc.runner.idle();
  });

  test('exporting the approved video includes its matching cover, byte for byte', () => {
    approve(w.p, EP, SIGNED);
    const cv = coverFor(w.p, EP, hookFinal);
    const r = exportApproved(w.p, EP, {exportsRoot: join(w.tmp, 'exports')});
    const coverFile = r.files.find((f) => f.role === 'cover')!;
    assert.equal(coverFile.name, `${EP}-cover.png`);
    assert.equal(coverFile.sha256, cv.fileSha256);
    assert.equal(readFileSync(join(r.dir, coverFile.name)).equals(readFileSync(blobPath(w.p, cv.fileSha256!))), true);
    const meta = JSON.parse(readFileSync(join(r.dir, 'metadata.json'), 'utf8'));
    assert.equal(meta.cover.belongsToVideoSha256, r.files.find((f) => f.role === 'video')!.sha256);
    assert.equal(meta.cover.hook, 'A model forgets old words');
    assert.ok(verifyPackage(r.dir).ok);
    assert.match(readFileSync(join(r.dir, 'checksums.sha256'), 'utf8'), /-cover\.png/);
  });

  let coverSha = '';
  test('another hook-only edit makes the cover out of date with its video, and the rest is again reused', async () => {
    coverSha = coverFor(w.p, EP, hookFinal).fileSha256!;
    edit(w.p, (d) => withHook(d, 'Long chats lose their start'));
    const cv = coverFor(w.p, EP, hookFinal);
    assert.equal(cv.state, 'outdated');
    assert.match(cv.why ?? '', /out of date/);
    assert.equal(review().view(EP).videos.find((v) => v.renderArtifactId === hookFinal)!.cover?.state, 'outdated');
    const st = statusReport(w.p, EP);
    assert.equal(st.timing.status, 'fresh');
    assert.equal(st.mix.final.status, 'fresh');
    assert.equal(st.render.final.status, 'stale');
    assert.throws(() => exportApproved(w.p, EP, {exportsRoot: join(w.tmp, 'exports')}), (e: unknown) => e instanceof ExportError && e.code === 'void');
    const kinds = await rebuildFinal();
    assert.deepEqual(kinds, ['render.final']);
    const newFinal = finalId();
    assert.notEqual(newFinal, hookFinal);
    assert.equal(coverFor(w.p, EP, hookFinal).state, 'outdated', 'the old cover stays with the old video');
    assert.match(coverFor(w.p, EP, hookFinal).why ?? '', /newer final video/);
    assert.equal(coverFor(w.p, EP, newFinal).state, 'none', 'the new video has no cover until one is made');
    approve(w.p, EP, SIGNED);
    assert.throws(() => exportApproved(w.p, EP, {exportsRoot: join(w.tmp, 'exports')}), (e: unknown) => e instanceof ExportError && e.code === 'no-cover', 'a video with the opening is not exported without its cover');
    const job = await makeCover(newFinal);
    assert.equal(job.state, 'succeeded', job.error ?? '');
    const fresh = coverFor(w.p, EP, newFinal);
    assert.equal(fresh.state, 'fresh');
    assert.notEqual(fresh.fileSha256, coverSha, 'the new hook gives a different cover');
    const r = exportApproved(w.p, EP, {exportsRoot: join(w.tmp, 'exports')});
    assert.equal(r.files.find((f) => f.role === 'cover')!.sha256, fresh.fileSha256);
    assert.ok(verifyPackage(r.dir).ok);
  });

  test('a still worker that fails leaves no cover and says why', async () => {
    edit(w.p, (d) => withHook(d, 'Hooks are separate from titles'));
    await rebuildFinal();
    process.env.FAKE_STILL_MODE = 'crash';
    try {
      const job = await makeCover(finalId());
      assert.equal(job.state, 'failed');
      assert.match(job.error ?? '', /still worker/);
      assert.equal(coverFor(w.p, EP, finalId()).state, 'none');
    } finally { delete process.env.FAKE_STILL_MODE; }
    const ok = await makeCover(finalId());
    assert.equal(ok.state, 'succeeded', ok.error ?? '');
  });

  test('after the app is closed and the project reopened, the cover, its video and their match are still recorded', async () => {
    const id = finalId();
    const before = coverFor(w.p, EP, id);
    assert.equal(before.state, 'fresh');
    const root = w.projectRoot;
    await w.svc.shutdown();
    w.p.close();
    const p2 = Project.open(root);
    try {
      const again = coverFor(p2, EP, id);
      assert.equal(again.state, 'fresh');
      assert.equal(again.fileSha256, before.fileSha256);
      assert.equal(again.renderSha256, before.renderSha256);
      assert.ok(existsSync(blobPath(p2, again.fileSha256!)));
    } finally { p2.close(); }
  });
});
