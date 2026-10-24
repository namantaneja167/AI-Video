// Proof clips: a window of the episode drawn from its recorded timing and final mix. On the job service with a fake render worker.
// Real: handler, runner, dependency hashes, freshness, approval. Stand-in: the Remotion render (a fake file; the spec it was asked to draw is copied and checked).
import assert from 'node:assert/strict';
import {readFileSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import {after, before, describe, test} from 'node:test';
import {withHook} from '../../app/shared/opening.ts';
import {approve, approvalStatus, statusReport} from '../../core/artifacts.ts';
import {blobPath} from '../../core/blobs.ts';
import {proofsFor, proofSubject} from '../../core/proof.ts';
import {currentRows} from '../../core/state.ts';
import {SIGNED} from '../store/helpers.ts';
import {getEpisodeInfo} from '../../core/episodes.ts';
import {EP, edit, fakeWorkspace, requestId, waitRebuild, type FakeWorkspace} from './jobs-fixture.ts';

let w: FakeWorkspace;
let specCopy: string;
before(() => {
  w = fakeWorkspace();
  specCopy = join(w.tmp, 'render-spec.json');
  process.env.FAKE_RENDER_SPEC_COPY = specCopy;
});
after(async () => { delete process.env.FAKE_RENDER_SPEC_COPY; try { await w.close(); } catch { rmSync(w.tmp, {recursive: true, force: true}); } });

const kinds = () => Object.fromEntries(w.p.db.prepare('SELECT kind, count(*) AS n FROM jobs GROUP BY kind').all().map((r: any) => [r.kind, r.n]));
const rows = () => Object.fromEntries(currentRows(w.p, EP).filter((r) => ['take', 'timing', 'mix'].includes(r.kind)).map((r) => [`${r.kind}:${r.subject}`, r.artifact_id]));
const prove = async (label: string, from: number, to: number) => { const id = w.svc.startProof(EP, label, from, to); return w.svc.runner.waitFor(id); };
let duration = 0;

describe('proof clips', {timeout: 300_000}, () => {
  test('a proof draws only the asked frames from the recorded timing and mix, and starts no narration, timing or mix job', async () => {
    const timing = currentRows(w.p, EP).find((r) => r.kind === 'timing')!;
    duration = JSON.parse(readFileSync(blobPath(w.p, timing.blob_hash), 'utf8')).durationSec;
    const before = {kinds: kinds(), rows: rows()};
    const from = 0.5, to = Math.min(2.5, duration - 0.3);
    const job = await prove('first', from, to);
    assert.equal(job.state, 'succeeded', job.error ?? '');
    const spec = JSON.parse(readFileSync(specCopy, 'utf8'));
    assert.deepEqual(spec.frameRange, [Math.round(from * 30), Math.round(to * 30) - 1]);
    assert.equal(spec.composition, 'studio-episode');
    assert.equal(spec.inputProps.data.timeline.durationSec, duration, 'the whole recorded timeline, not a re-timed passage');
    const after = kinds();
    for (const k of ['tts.block', 'timing.build', 'mix.final', 'mix.draft']) assert.equal(after[k] ?? 0, before.kinds[k] ?? 0, `${k} was not run again`);
    assert.equal(after['proof.build'], 1);
    assert.deepEqual(rows(), before.rows, 'the same takes, timing and mix are still current');
    const p = proofsFor(w.p, EP).find((x) => x.label === 'first')!;
    assert.equal(p.state, 'fresh');
    assert.equal(p.subject, proofSubject('first', from, to));
    const meta = JSON.parse((w.p.db.prepare('SELECT meta_json FROM artifacts WHERE id=?').get(p.artifactId) as any).meta_json);
    assert.equal(meta.used.mixBlob, currentRows(w.p, EP).find((r) => r.kind === 'mix' && r.subject === 'final')!.blob_hash, 'drawn with the recorded final mix');
    assert.equal(meta.used.timelineBlob, timing.blob_hash);
    assert.deepEqual(meta.proof.frameRange, spec.frameRange);
  });

  test('a proof is not a build: stages, the rebuild plan and an approval are unchanged', async () => {
    // the first proof recorded the render sources, so the video needs its normal rebuild before it can be approved
    const rb = w.svc.startRebuild(EP, {seq: getEpisodeInfo(w.p, EP).seq, requestId: requestId(), mode: 'final'});
    await waitRebuild(w.svc, rb.rebuildId, ['complete']);
    approve(w.p, EP, SIGNED);
    const approved = approvalStatus(w.p, EP);
    const st = JSON.stringify(statusReport(w.p, EP));
    const job = await prove('second', 0.2, Math.min(1.2, duration - 0.3));
    assert.equal(job.state, 'succeeded', job.error ?? '');
    assert.equal(JSON.stringify(statusReport(w.p, EP)), st);
    assert.deepEqual(approvalStatus(w.p, EP), approved);
    assert.equal(w.svc.plan(EP, 'final').nothingToDo, true);
  });

  test('a change to what the video shows makes the proof out of date; narration, timing and the mix stay fresh', async () => {
    const before = rows();
    edit(w.p, (d) => withHook(d, 'A different hook'));
    const states = Object.fromEntries(proofsFor(w.p, EP).map((p) => [p.label, p.state]));
    assert.deepEqual(states, {first: 'outdated', second: 'outdated'});
    const st = statusReport(w.p, EP);
    for (const e of Object.values(st.takes)) assert.equal(e.status, 'fresh');
    assert.equal(st.timing.status, 'fresh'); assert.equal(st.mix.final.status, 'fresh');
    assert.deepEqual(rows(), before);
    const job = await prove('first', 0.5, Math.min(2.5, duration - 0.3));
    assert.equal(job.state, 'succeeded', job.error ?? '');
    assert.equal(proofsFor(w.p, EP).find((p) => p.label === 'first')!.state, 'fresh');
  });

  test('windows and labels are validated before any work is queued; a window past the end of the episode fails with a reason', async () => {
    assert.throws(() => w.svc.startProof(EP, 'Bad Label', 0, 1), /label/);
    assert.throws(() => w.svc.startProof(EP, 'ok', 5, 5), /window/);
    assert.throws(() => w.svc.startProof(EP, 'ok', 0, 61), /window/);
    const job = await prove('late', duration - 0.5, duration + 1);
    assert.equal(job.state, 'failed');
    assert.match(job.error ?? '', /ends after the episode/);
  });

  test('a second request for the same window while one is waiting joins it', async () => {
    edit(w.p, (d) => withHook(d, 'Another hook'));
    const a = w.svc.startProof(EP, 'joined', 0.3, 1.1), b = w.svc.startProof(EP, 'joined', 0.3, 1.1);
    assert.equal(a, b);
    await w.svc.runner.waitFor(a);
  });
});
