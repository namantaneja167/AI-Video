// The five-second opening animatic: a silent planning preview drawn by the render engine on an estimated clock. On the job service
// with a fake render worker. Real: handler, runner, dependency hashes, freshness, approval. Stand-in: the Remotion render (a small
// fake file; the spec it was asked to draw is copied and checked).
import assert from 'node:assert/strict';
import {readFileSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import {after, before, describe, test} from 'node:test';
import {withHook} from '../../app/shared/opening.ts';
import {animaticFor} from '../../core/animatic.ts';
import {ANIMATIC_FRAMES} from '../../core/animaticSpec.ts';
import {approve, approvalStatus, statusReport} from '../../core/artifacts.ts';
import {getEpisode, getEpisodeInfo} from '../../core/episodes.ts';
import {currentRows} from '../../core/state.ts';
import {SIGNED} from '../store/helpers.ts';
import {EP, edit, fakeWorkspace, requestId, waitRebuild, type FakeWorkspace} from './jobs-fixture.ts';

let w: FakeWorkspace;
let specCopy: string;
before(() => {
  w = fakeWorkspace();
  specCopy = join(w.tmp, 'render-spec.json');
  process.env.FAKE_RENDER_SPEC_COPY = specCopy;
});
after(async () => { delete process.env.FAKE_RENDER_SPEC_COPY; try { await w.close(); } catch { rmSync(w.tmp, {recursive: true, force: true}); } });

const rows = () => Object.fromEntries(currentRows(w.p, EP).filter((r) => ['take', 'timing', 'mix', 'render'].includes(r.kind)).map((r) => [`${r.kind}:${r.subject}`, r.artifact_id]));
const draw = async () => { const id = w.svc.startAnimatic(EP); return w.svc.runner.waitFor(id); };

describe('the opening animatic', {timeout: 300_000}, () => {
  test('an episode without an opening hook has no animatic to draw, and says why', async () => {
    assert.equal(getEpisode(w.p, EP).scenes[0].openingHook, undefined);
    assert.equal(animaticFor(w.p, EP).state, 'none');
    const job = await draw();
    assert.equal(job.state, 'failed');
    assert.match(job.error ?? '', /no opening hook/);
    assert.equal(animaticFor(w.p, EP).state, 'none');
  });

  test('it is drawn silently from the document on an estimated clock, for the first 150 frames only', async () => {
    edit(w.p, (d) => withHook(d, 'A model forgets old words'));
    const job = await draw();
    assert.equal(job.state, 'succeeded', job.error ?? '');
    const spec = JSON.parse(readFileSync(specCopy, 'utf8'));
    assert.deepEqual(spec.frameRange, [0, ANIMATIC_FRAMES - 1]);
    assert.equal(spec.composition, 'studio-episode');
    assert.equal(spec.inputProps.data.previewOnly, true);
    assert.equal(spec.inputProps.data.timeline.audio, '', 'no narration audio is used');
    assert.equal(spec.inputProps.data.episode.scenes[0].openingHook, 'A model forgets old words');
    const an = animaticFor(w.p, EP);
    assert.equal(an.state, 'fresh');
    assert.equal(an.hook, 'A model forgets old words');
    const row = w.p.db.prepare('SELECT subject, kind, meta_json FROM artifacts WHERE id=?').get(an.artifactId!)!;
    assert.deepEqual([row.kind, row.subject], ['animatic', 'opening']);
    const meta = JSON.parse(row.meta_json as string);
    assert.equal(meta.silent, true);
    assert.equal(meta.estimatedClock, true);
    assert.equal(meta.frames, ANIMATIC_FRAMES);
  });

  test('it is not a build: no stage becomes stale or fresh because of it, and an approval is untouched', async () => {
    // build everything once so there is something to approve
    const rb = w.svc.startRebuild(EP, {seq: getEpisodeInfo(w.p, EP).seq, requestId: requestId(), mode: 'final'});
    await waitRebuild(w.svc, rb.rebuildId, ['complete']);
    const before = {st: JSON.stringify(statusReport(w.p, EP)), rows: rows()};
    approve(w.p, EP, SIGNED);
    const approvedBefore = approvalStatus(w.p, EP);
    assert.equal(approvedBefore.state, 'valid');
    const job = await draw();
    assert.equal(job.state, 'succeeded', job.error ?? '');
    assert.equal(JSON.stringify(statusReport(w.p, EP)), before.st);
    assert.deepEqual(rows(), before.rows);
    assert.deepEqual(approvalStatus(w.p, EP), approvedBefore);
  });

  test('a hook-only edit makes the animatic out of date; narration, timing and the mix stay fresh; drawing again makes it fresh', async () => {
    const was = animaticFor(w.p, EP).artifactId;
    edit(w.p, (d) => withHook(d, 'Long chats lose their start'));
    const an = animaticFor(w.p, EP);
    assert.equal(an.state, 'outdated');
    assert.match(an.why ?? '', /changed/);
    const st = statusReport(w.p, EP);
    for (const e of Object.values(st.takes)) assert.equal(e.status, 'fresh');
    assert.equal(st.timing.status, 'fresh');
    assert.equal(st.mix.final.status, 'fresh');
    const job = await draw();
    assert.equal(job.state, 'succeeded', job.error ?? '');
    const again = animaticFor(w.p, EP);
    assert.equal(again.state, 'fresh');
    assert.notEqual(again.artifactId, was);
    assert.equal(again.hook, 'Long chats lose their start');
  });

  test('a second request while one is queued or running joins it instead of drawing twice', async () => {
    edit(w.p, (d) => withHook(d, 'Hooks are separate from titles'));
    const a = w.svc.startAnimatic(EP);
    const b = w.svc.startAnimatic(EP);
    assert.equal(a, b);
    await w.svc.runner.waitFor(a);
  });
});
