// The Voice stage, second part, on fake workers: cancelling, failing and retrying, the revision a job runs on, that the engine and the
// job table never contradict each other, estimates against measured runs, splitting and merging blocks, the listening sample.
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {describe, test} from 'node:test';
import {statusReport} from '../../core/artifacts.ts';
import {getEpisode, getEpisodeInfo, getRevision, listRevisions, saveEpisode} from '../../core/episodes.ts';
import {all} from '../../core/db.ts';
import {acceptImport, createPlan, submitImport} from '../../app/planning.ts';
import {defaultSelection} from '../../app/shared/importing.ts';
import {VoiceError, VoiceService, } from '../../app/voice.ts';
import type {VoiceView} from '../../app/shared/voice.ts';
import {EP, fakeWorkspace, requestId, until, waitRebuild, type FakeWorkspace} from './jobs-fixture.ts';

const sentence = (n: number) => `Sentence ${n} says exactly ${Array.from({length: 16}, (_, i) => `word${n}x${i}`).join(' ')}.`;
const SCRIPT = (count: number) => Array.from({length: count}, (_, i) => sentence(i + 1)).join(' ');

/** A workspace with the fake workers, with the given switches in the environment for as long as `fn` runs (the audio worker reads them when it starts). */
async function withEnv<T>(env: Record<string, string>, fn: (x: FakeWorkspace, vs: VoiceService) => Promise<T>): Promise<T> {
  const old = Object.fromEntries(Object.keys(env).map((k) => [k, process.env[k]]));
  Object.assign(process.env, env);
  const x = fakeWorkspace();
  try { return await fn(x, new VoiceService(x.svc)); } finally {
    await x.close();
    for (const [k, v] of Object.entries(old)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
}
const draftIn = (x: FakeWorkspace, title: string, sentences = 6): string => {
  const made = createPlan(x.p, {title, audience: 'a', objective: 'o'});
  const r = submitImport(x.p, made.plan.id, {text: SCRIPT(sentences), via: 'paste'});
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  acceptImport(x.p, made.plan.id, r.import.id, {selection: defaultSelection(r.import.proposal), basePlanSeq: made.seq, baseEpisodeSeq: null});
  return made.plan.id;
};
const seqOf = (x: FakeWorkspace, id: string) => getEpisodeInfo(x.p, id).seq;
const job = (x: FakeWorkspace, id: string, jobId: number) => x.svc.list(id, 50).find((j) => j.id === jobId)!;
const ACTIVE = ['queued', 'preparing', 'running', 'cancelling'];

describe('cancelling, failing and retrying', () => {
  test('cancelling a running generation stops it and the ones queued behind it, frees the slot, leaves no engine running, and generation works again', {timeout: 60_000}, () => withEnv({FAKE_GENERATE_DELAY: '4'}, async (x, vs) => {
    const id = draftIn(x, 'Cancel');
    const r = vs.generate(id, {seq: seqOf(x, id), requestId: requestId()});
    assert.equal(r.queued.length, 2);
    await until('the first block to be generating', () => { const j = job(x, id, r.queued[0].jobId); return j.state === 'running' && j.displayStep === 'generating speech'; });
    assert.equal(vs.view(id).engine.activity, 'generating');
    const n = await vs.cancelAll(id);
    assert.equal(n, 2);
    assert.deepEqual(r.queued.map((q) => job(x, id, q.jobId).state), ['cancelled', 'cancelled']);
    const v = vs.view(id);
    assert.equal(v.busy, false);
    assert.equal(v.engine.worker, 'none', 'the worker the cancelled job was using is stopped');
    assert.equal(v.engine.activity, 'stopped');
    assert.deepEqual(v.blocks.map((b) => b.takes.length), [0, 0], 'a cancelled generation leaves no take');
    assert.ok(r.queued.every((q) => job(x, id, q.jobId).canRetry));
    // the slot is free: a new request starts straight away, and the cancelled one can be retried
    const again = vs.generate(id, {seq: seqOf(x, id), requestId: requestId(), blocks: ['b1']});
    await until('the new job to run', () => job(x, id, again.queued[0].jobId).state === 'running');
    await vs.cancelAll(id);
    x.svc.retry(r.queued[0].jobId);
    await until('the retried job to run', () => job(x, id, r.queued[0].jobId).state === 'running');
    await vs.cancelAll(id);
    assert.equal(all(x.p.db.prepare("SELECT 1 FROM jobs WHERE state IN ('queued','preparing','running','cancelling')")).length, 0);
  }));

  test('a failed generation shows the engine\'s real reason, keeps what exists, and Retry makes the take', {timeout: 60_000}, () => {
    const marker = join(mkdtempSync(join(tmpdir(), 'studio-fail-')), 'once');
    return withEnv({FAKE_FAIL_ONCE: marker}, async (x, vs) => {
      try {
        const id = draftIn(x, 'Fail', 3);
        const r = vs.generate(id, {seq: seqOf(x, id), requestId: requestId()});
        await x.svc.runner.waitFor(r.queued[0].jobId);
        const j = job(x, id, r.queued[0].jobId);
        assert.equal(j.state, 'failed');
        assert.match(j.friendlyError ?? '', /generation failed \(test: fails once\)/);
        assert.equal(j.canRetry, true);
        const v = vs.view(id);
        assert.equal(v.blocks[0].status, 'none');
        assert.equal(v.blocks[0].job?.state, 'failed');
        assert.equal(v.busy, false);
        x.svc.retry(j.id);
        await x.svc.runner.waitFor(j.id);
        assert.equal(job(x, id, j.id).state, 'succeeded');
        assert.equal(job(x, id, j.id).attempts, 2);
        assert.equal(vs.view(id).blocks[0].status, 'fresh');
      } finally { rmSync(marker.replace(/\/once$/, ''), {recursive: true, force: true}); }
    });
  });

  test('a job runs on the revision and inputs recorded when it was queued: a later edit makes its take an earlier one, never the current one', {timeout: 60_000}, () => withEnv({FAKE_GENERATE_DELAY: '1.5'}, async (x, vs) => {
    const id = draftIn(x, 'Recorded', 3);
    const r = vs.generate(id, {seq: seqOf(x, id), requestId: requestId()});
    await until('running', () => job(x, id, r.queued[0].jobId).state === 'running');
    const queuedRevision = job(x, id, r.queued[0].jobId).revision!;
    const doc = getEpisode(x.p, id);
    const oldText = doc.narration.segments[0].text;
    saveEpisode(x.p, id, {...doc, narration: {...doc.narration, segments: doc.narration.segments.map((s, i) => (i === 0 ? {...s, text: `${s.text} And more.`} : s))}}, {baseSeq: seqOf(x, id)});
    await x.svc.runner.waitFor(r.queued[0].jobId);
    const j = job(x, id, r.queued[0].jobId);
    assert.equal(j.state, 'outdated');
    assert.equal(j.revision, queuedRevision, 'it kept the revision it was queued on');
    assert.equal(getRevision(x.p, id, queuedRevision).narration.segments[0].text, oldText, 'that revision holds the text it narrated');
    assert.match(j.note ?? '', /kept as an earlier build and is not used for the current text/);
    const b = vs.view(id).blocks[0];
    assert.equal(b.status, 'none', 'nothing is selected for the new wording');
    assert.equal(b.takes.length, 1);
    assert.equal(b.takes[0].compatible, false);
    assert.match(b.takes[0].why ?? '', /Made from earlier wording of s1\./);
  }));
});

describe('the engine and the jobs never contradict each other', () => {
  type Sample = {view: VoiceView; table: {id: number; kind: string; state: string}[]};
  const sample = (x: FakeWorkspace, vs: VoiceService, id: string): Sample => ({view: vs.view(id), table: all<{id: number; kind: string; state: string}>(x.p.db.prepare("SELECT id, kind, state FROM jobs WHERE state IN ('preparing','running','cancelling')"))});
  const check = (s: Sample): string[] => {
    const {view: v, table} = s;
    const bad: string[] = [];
    const heavy = table;
    if (heavy.length > 1) bad.push(`more than one heavy job at once: ${heavy.map((j) => `${j.id}:${j.state}`).join(', ')}`);
    if (v.engine.job && !heavy.some((j) => j.id === v.engine.job!.id)) bad.push(`the engine describes job ${v.engine.job.id}, which the job table does not show as running`);
    if (!v.engine.job && heavy.length && v.engine.activity === 'stopped' && false) bad.push('unreachable');
    if (v.engine.loaded && v.engine.worker !== 'running') bad.push(`a model "${v.engine.loaded}" is loaded but there is no worker`);
    if (v.engine.activity === 'generating' && !(v.engine.loaded === 'tts' && v.engine.worker === 'running')) bad.push('the engine says generating while the voice model is not loaded');
    for (const j of v.jobs) {
      if (j.state === 'running' && j.displayStep === 'generating speech' && !(v.engine.loaded === 'tts' && v.engine.worker === 'running')) bad.push(`job ${j.id} shows "generating speech" while the engine does not hold the voice model`);
      if (j.state === 'running' && j.displayStep === 'generating speech' && v.engine.activity !== 'generating') bad.push(`job ${j.id} shows "generating speech" while the engine says ${v.engine.activity}`);
    }
    if (v.engine.activity === 'generating' && !v.jobs.some((j) => j.state === 'running' && j.displayStep === 'generating speech')) bad.push('the engine says generating but no job is');
    if (v.engine.activity === 'loading' && !(v.engine.job && ['preparing', 'running'].includes(v.engine.job.state))) bad.push('the engine says loading but no job is starting');
    return bad;
  };
  const watch = async (x: FakeWorkspace, vs: VoiceService, id: string, until_: () => boolean, during?: () => Promise<void>) => {
    const seen = new Set<string>();
    const violations: string[] = [];
    let n = 0;
    const done = (async () => { if (during) await during(); })();
    while (!until_()) {
      const s = sample(x, vs, id);
      n++;
      seen.add(s.view.engine.activity);
      for (const m of check(s)) violations.push(m);
      await new Promise((r) => setTimeout(r, 12));
    }
    await done;
    return {violations, seen, n};
  };

  test('over a whole generation (loading, generating each block, idle) the engine view and the job table agree at every reading', {timeout: 60_000}, () => withEnv({FAKE_LOAD_DELAY: '0.4', FAKE_SEC_PER_WORD: '0.01'}, async (x, vs) => {
    const id = draftIn(x, 'Consistency', 9);
    const r = vs.generate(id, {seq: seqOf(x, id), requestId: requestId()});
    const finished = () => r.queued.every((q) => !ACTIVE.includes(job(x, id, q.jobId).state));
    const w = await watch(x, vs, id, finished);
    assert.deepEqual(w.violations, []);
    // Only a sanity check that the watcher ran; how many readings fit in the run depends on how busy the machine is (one full-suite run read 20 times with no
    // violation). What matters is that it saw the loading and generating states below.
    assert.ok(w.n >= 5, `read ${w.n} times`);
    assert.ok(w.seen.has('loading') && w.seen.has('generating'), `saw: ${[...w.seen].join(', ')}`);
    assert.equal(vs.view(id).engine.activity, 'idle', 'after the work the model is loaded and the engine is idle');
    assert.equal(vs.view(id).engine.loaded, 'tts');
  }));

  test('through a cancel, the engine passes through stopping to stopped, and no reading disagrees with the table', {timeout: 60_000}, () => withEnv({FAKE_GENERATE_DELAY: '3'}, async (x, vs) => {
    const id = draftIn(x, 'Consistency cancel', 6);
    const r = vs.generate(id, {seq: seqOf(x, id), requestId: requestId()});
    let cancelled = false;
    const w = await watch(x, vs, id, () => cancelled, async () => {
      await until('generating', () => job(x, id, r.queued[0].jobId).displayStep === 'generating speech');
      await vs.cancelAll(id);
      cancelled = true;
    });
    assert.deepEqual(w.violations, []);
    assert.equal(vs.view(id).engine.activity, 'stopped');
  }));

  test('when the audio worker dies mid-generation, the job never claims to be generating without an engine, the step is retried once by itself, and it finishes', {timeout: 90_000}, () => withEnv({FAKE_GENERATE_DELAY: '1.5'}, async (x, vs) => {
    const id = draftIn(x, 'Consistency crash', 3);
    const r = vs.generate(id, {seq: seqOf(x, id), requestId: requestId()});
    const jobId = r.queued[0].jobId;
    const w = await watch(x, vs, id, () => job(x, id, jobId).state === 'succeeded' || job(x, id, jobId).state === 'failed', async () => {
      await until('generating', () => job(x, id, jobId).displayStep === 'generating speech');
      process.kill(x.svc.host.worker!.pid!, 'SIGKILL');
    });
    assert.deepEqual(w.violations, []);
    assert.equal(job(x, id, jobId).state, 'succeeded');
    assert.equal(job(x, id, jobId).attempts, 2, 'one automatic retry after the worker died');
    assert.equal(vs.view(id).blocks[0].status, 'fresh');
  }));

  test('while a video renders the audio model is not loaded, at every reading of a whole rebuild', {timeout: 120_000}, async () => {
    const x = fakeWorkspace();
    try {
      const vs = new VoiceService(x.svc);
      const r = x.svc.startRebuild(EP, {seq: getEpisodeInfo(x.p, EP).seq, requestId: requestId()});
      const violations: string[] = [];
      let sawRender = false;
      for (;;) {
        const v = vs.view(EP);
        const s = sample(x, vs, EP);
        violations.push(...check(s));
        if (s.table.some((j) => j.kind === 'render.final' && j.state === 'running')) { sawRender = true; if (v.engine.loaded !== null) violations.push(`a render is running while the "${v.engine.loaded}" model is loaded`); }
        const st = x.svc.rebuilds(EP, 5).find((b) => b.id === r.rebuildId)?.state;
        if (st === 'complete' || st === 'failed') break;
        await new Promise((res) => setTimeout(res, 15));
      }
      assert.deepEqual(violations, []);
      assert.ok(sawRender);
    } finally { await x.close(); }
  });
});

describe('estimates from measured runs', () => {
  test('none until a take has been measured, then a per-word estimate that says how thin its basis is, and then one within 30% of the next real run', {timeout: 120_000}, () => withEnv({FAKE_SEC_PER_WORD: '0.1', FAKE_LOAD_DELAY: '0.5'}, async (x, vs) => {
    const id = draftIn(x, 'Estimates', 7); // blocks of 60, 60 and 20 words
    const seq = () => seqOf(x, id);
    assert.deepEqual(vs.view(id).blocks.map((b) => b.words), [60, 60, 20]);
    assert.ok(vs.view(id).blocks.every((b) => !b.estimate.measured), 'nothing measured yet');
    assert.equal(vs.view(id).totalEstimate!.unmeasured, 3);
    // the first take (60 words), with the model load
    const a = vs.generate(id, {seq: seq(), requestId: requestId(), blocks: ['b1']});
    await x.svc.runner.waitFor(a.queued[0].jobId);
    const v1 = vs.view(id);
    const e3 = v1.blocks[2].estimate;
    assert.ok(e3.measured);
    if (e3.measured) {
      assert.match(e3.note ?? '', /one earlier take, so it could be off by more than 30%/);
      assert.equal(e3.runs, 1);
      assert.equal(Math.round(e3.minSec * 10), Math.round(e3.maxSec * 10), 'one take gives one number');
    }
    // the 20-word block: predicted from that one take, then really run
    assert.equal(v1.loadEstimate, null, 'the model is loaded, so no load is charged');
    const c = vs.generate(id, {seq: seq(), requestId: requestId(), blocks: ['b3']});
    await x.svc.runner.waitFor(c.queued[0].jobId);
    const actual3 = job(x, id, c.queued[0].jobId).elapsedMs! / 1000;
    assert.ok(e3.measured && actual3 >= e3.minSec * 0.7 && actual3 <= e3.maxSec * 1.3, `block b3: estimated ${e3.measured ? e3.minSec.toFixed(2) : '?'} s, took ${actual3.toFixed(2)} s`);
    // two takes now: a range, and the note says how many
    const e2 = vs.view(id).blocks[1].estimate;
    assert.ok(e2.measured);
    if (e2.measured) assert.match(e2.note ?? '', /Based on 2 earlier takes\./);
    const b = vs.generate(id, {seq: seq(), requestId: requestId(), blocks: ['b2']});
    await x.svc.runner.waitFor(b.queued[0].jobId);
    const actual2 = job(x, id, b.queued[0].jobId).elapsedMs! / 1000;
    assert.ok(e2.measured && actual2 >= e2.minSec * 0.7 && actual2 <= e2.maxSec * 1.3, `block b2: estimated ${e2.measured ? `${e2.minSec.toFixed(2)} to ${e2.maxSec.toFixed(2)}` : '?'} s, took ${actual2.toFixed(2)} s`);
  }));

  test('the model load is shown as its own measured part when the engine is not loaded, and is not charged when it is', {timeout: 60_000}, () => withEnv({FAKE_SEC_PER_WORD: '0.05', FAKE_LOAD_DELAY: '0.6'}, async (x, vs) => {
    const id = draftIn(x, 'Load estimate', 4);
    const r = vs.generate(id, {seq: seqOf(x, id), requestId: requestId(), blocks: ['b1']});
    await x.svc.runner.waitFor(r.queued[0].jobId);
    await x.svc.host.shutdown(); // the engine is released
    const v = vs.view(id);
    assert.equal(v.engine.worker, 'none');
    assert.ok(v.loadEstimate && v.loadEstimate.sec !== null, 'load time was measured by the first run');
    assert.ok(Math.abs(v.loadEstimate!.sec! - 0.6) / 0.6 <= 0.5, `measured load ${v.loadEstimate!.sec} s for a 0.6 s model load`);
    assert.match(v.loadEstimate!.note, /Loading took about/);
  }));

  test('a re-roll of an up-to-date block is estimated too, and the load is shown when the engine has been released', {timeout: 60_000}, () => withEnv({FAKE_SEC_PER_WORD: '0.05', FAKE_LOAD_DELAY: '0.6'}, async (x, vs) => {
    const id = draftIn(x, 'Reroll estimate', 4);
    const r = vs.generate(id, {seq: seqOf(x, id), requestId: requestId()});
    for (const q of r.queued) await x.svc.runner.waitFor(q.jobId);
    const loaded = vs.view(id);
    assert.ok(loaded.blocks.every((b) => b.status === 'fresh' && b.estimate.measured), 'every up-to-date block has an estimate');
    assert.equal(loaded.loadEstimate, null);
    await x.svc.host.shutdown();
    const v = vs.view(id);
    assert.ok(v.totalEstimate === null, 'nothing needs generating');
    assert.ok(v.loadEstimate && v.loadEstimate.sec !== null, 'a re-roll would load the model, and the page can say so');
  }));
});

describe('splitting and merging blocks', () => {
  const allGenerated = async (x: FakeWorkspace, vs: VoiceService, title: string) => {
    const id = draftIn(x, title, 9);
    const r = vs.generate(id, {seq: seqOf(x, id), requestId: requestId()});
    for (const q of r.queued) await x.svc.runner.waitFor(q.jobId);
    return id;
  };
  const flat = (x: FakeWorkspace, id: string) => getEpisode(x.p, id).narration.blocks.flatMap((b) => b.segments).join(',');
  const layout = (x: FakeWorkspace, id: string) => getEpisode(x.p, id).narration.blocks.map((b) => `${b.id}:${b.segments.join('+')}`).join(' ');

  test('a split keeps the segment order, retains the old take, and only the blocks whose lines changed need narration', {timeout: 60_000}, async () => {
    const x = fakeWorkspace();
    try {
      const vs = new VoiceService(x.svc);
      const id = await allGenerated(x, vs, 'Split');
      const before = flat(x, id);
      assert.equal(layout(x, id), 'b1:s1+s2+s3 b2:s4+s5+s6 b3:s7+s8+s9');
      const p = vs.preview(id, {op: 'split', block: 'b2', after: 's4'});
      assert.match(p.lines[0], /Before: b2 \(s4 to s6\)\. After: b2 \(s4\) and b4 \(s5 and s6\)\. The order of the segments does not change\./);
      assert.deepEqual(p.needsGeneration, ['b2', 'b4']);
      assert.match(p.lines.join(' '), /Earlier takes of b2 \(1\) are kept/);
      assert.match(p.lines.join(' '), /b1, b3 are not affected/);
      assert.equal(layout(x, id), 'b1:s1+s2+s3 b2:s4+s5+s6 b3:s7+s8+s9', 'previewing changes nothing');
      const revBefore = listRevisions(x.p, id).length;
      const r = vs.edit(id, {seq: seqOf(x, id), op: {op: 'split', block: 'b2', after: 's4'}});
      assert.equal(layout(x, id), 'b1:s1+s2+s3 b2:s4 b4:s5+s6 b3:s7+s8+s9');
      assert.equal(flat(x, id), before, 'the segment order is unchanged');
      const revs = listRevisions(x.p, id);
      assert.equal(revs.length, revBefore + 1);
      assert.deepEqual([revs.at(-1)!.kind, revs.at(-1)!.label], ['blocks-edit', 'Split block b2 after s4 (new block b4)']);
      const v = vs.view(id);
      assert.deepEqual(v.blocks.map((b) => [b.id, b.status]), [['b1', 'fresh'], ['b2', 'stale'], ['b4', 'none'], ['b3', 'fresh']]);
      assert.equal(v.blocks[1].takes.length, 1, 'the earlier take of b2 is still in its list');
      assert.match(v.blocks[1].takes[0].why ?? '', /Made when this block held s4, s5, s6; it holds s4 now\./);
      assert.equal(v.blocks[0].takes[0].selected, true);
      assert.equal(v.blocks[3].takes[0].selected, true);
      assert.equal(r.preview.after.length, 2);
      // narration is generated only for the two blocks that changed
      const g = vs.generate(id, {seq: seqOf(x, id), requestId: requestId()});
      assert.deepEqual(g.queued.map((q) => q.block), ['b2', 'b4']);
      for (const q of g.queued) await x.svc.runner.waitFor(q.jobId);
      assert.deepEqual(vs.view(id).blocks.map((b) => b.status), ['fresh', 'fresh', 'fresh', 'fresh']);
    } finally { await x.close(); }
  });

  test('joining them again uses the take that was kept: the earlier version is recoverable without generating anything', {timeout: 60_000}, async () => {
    const x = fakeWorkspace();
    try {
      const vs = new VoiceService(x.svc);
      const id = await allGenerated(x, vs, 'Rejoin');
      vs.edit(id, {seq: seqOf(x, id), op: {op: 'split', block: 'b2', after: 's4'}});
      const g = vs.generate(id, {seq: seqOf(x, id), requestId: requestId()});
      for (const q of g.queued) await x.svc.runner.waitFor(q.jobId);
      const jobs = x.svc.list(id, 100).length;
      const p = vs.preview(id, {op: 'merge', block: 'b2'});
      assert.deepEqual(p.reusable.map((r) => [r.block, r.takeNumber]), [['b2', 1]]);
      assert.deepEqual(p.needsGeneration, []);
      vs.edit(id, {seq: seqOf(x, id), op: {op: 'merge', block: 'b2'}});
      assert.equal(layout(x, id), 'b1:s1+s2+s3 b2:s4+s5+s6 b3:s7+s8+s9');
      const v = vs.view(id);
      assert.deepEqual(v.blocks.map((b) => b.status), ['fresh', 'stale', 'fresh'], 'the take that is selected is for the split block, so the joined block shows the saved one as available');
      assert.ok(v.blocks[1].reusableTakeId !== null);
      const r = vs.generate(id, {seq: seqOf(x, id), requestId: requestId(), blocks: ['b2']});
      assert.deepEqual([r.queued.length, r.reused.length], [0, 1]);
      assert.equal(x.svc.list(id, 100).length, jobs, 'no job was queued');
      assert.equal(vs.view(id).blocks[1].status, 'fresh');
      assert.equal(vs.view(id).blocks[1].takes.length, 2, 'both the whole-block take and the take of its first part are saved');
    } finally { await x.close(); }
  });

  test('what is refused: a segment is never cut, the last block cannot be joined onward, a pause inside a block, a block too long, a stale page, a busy episode', {timeout: 60_000}, async () => {
    const x = fakeWorkspace();
    try {
      const vs = new VoiceService(x.svc);
      const id = draftIn(x, 'Refusals blocks', 9);
      const refused = (fn: () => unknown, re: RegExp) => assert.throws(fn, (e: unknown) => e instanceof VoiceError && e.code === 'refused' && re.test(e.message));
      const same = layout(x, id);
      refused(() => vs.preview(id, {op: 'split', block: 'b1', after: 's3'}), /last segment of b1.*never cut in the middle/);
      refused(() => vs.preview(id, {op: 'split', block: 'b1', after: 's9'}), /Segment s9 is not in block b1/);
      refused(() => vs.preview(id, {op: 'merge', block: 'b3'}), /last block/);
      refused(() => vs.preview(id, {op: 'merge', block: 'b1'}), /would be 120 words.*roughly 100 words/);
      // a pause after the joint
      const doc = getEpisode(x.p, id);
      saveEpisode(x.p, id, {...doc, narration: {...doc.narration, segments: doc.narration.segments.map((s) => (s.id === 's3' ? {...s, pauseAfter: 0.4} : s)), blocks: [{id: 'b1', segments: ['s1', 's2', 's3']}, {id: 'b2', segments: ['s4']}, {id: 'b3', segments: ['s5', 's6', 's7', 's8', 's9']}]}}, {baseSeq: seqOf(x, id)});
      refused(() => vs.preview(id, {op: 'merge', block: 'b1'}), /s3 has a pause of 0\.4 s after it/);
      const mid = layout(x, id);
      assert.throws(() => vs.edit(id, {seq: seqOf(x, id) - 1, op: {op: 'split', block: 'b3', after: 's5'}}), (e: unknown) => e instanceof VoiceError && e.code === 'changed');
      const r = vs.generate(id, {seq: seqOf(x, id), requestId: requestId(), blocks: ['b2']});
      assert.throws(() => vs.edit(id, {seq: seqOf(x, id), op: {op: 'split', block: 'b3', after: 's5'}}), (e: unknown) => e instanceof VoiceError && e.code === 'busy');
      await x.svc.runner.waitFor(r.queued[0].jobId);
      assert.equal(layout(x, id), mid, 'no refusal changed the blocks');
      assert.notEqual(same, mid);
    } finally { await x.close(); }
  });

  test('on a built episode a split leaves the untouched block\'s take alone and marks timing, the mixes and the video out of date', {timeout: 120_000}, async () => {
    const x = fakeWorkspace();
    try {
      const vs = new VoiceService(x.svc);
      const r = x.svc.startRebuild(EP, {seq: getEpisodeInfo(x.p, EP).seq, requestId: requestId()});
      await waitRebuild(x.svc, r.rebuildId, ['complete', 'failed']);
      assert.deepEqual(statusReport(x.p, EP).notFresh.filter((k) => !k.endsWith(':draft')), []);
      const first = getEpisode(x.p, EP).narration.blocks[0];
      assert.ok(first.segments.length >= 2);
      const takeOfOther = statusReport(x.p, EP).takes[getEpisode(x.p, EP).narration.blocks[1].id].artifactId;
      vs.edit(EP, {seq: getEpisodeInfo(x.p, EP).seq, op: {op: 'split', block: first.id, after: first.segments[0]}});
      const s = statusReport(x.p, EP);
      const blocks = getEpisode(x.p, EP).narration.blocks;
      assert.deepEqual(blocks.slice(0, 2).map((b) => b.segments.length), [1, first.segments.length - 1]);
      assert.notEqual(s.takes[first.id].status, 'fresh');
      assert.equal(s.takes[blocks[blocks.length - 1].id].status, 'fresh', 'the block that was not touched keeps its take');
      assert.equal(s.takes[blocks[blocks.length - 1].id].artifactId, takeOfOther);
      assert.notEqual(s.timing.status, 'fresh');
      assert.notEqual(s.mix.final.status, 'fresh');
      assert.notEqual(s.render.final.status, 'fresh');
    } finally { await x.close(); }
  });

  test('on a built episode, selecting another take marks timing, the mixes and the video out of date and nothing else', {timeout: 120_000}, async () => {
    const x = fakeWorkspace();
    try {
      const vs = new VoiceService(x.svc);
      const r = x.svc.startRebuild(EP, {seq: getEpisodeInfo(x.p, EP).seq, requestId: requestId()});
      await waitRebuild(x.svc, r.rebuildId, ['complete', 'failed']);
      assert.deepEqual(statusReport(x.p, EP).notFresh.filter((k) => !k.endsWith(':draft')), []);
      const blocks = getEpisode(x.p, EP).narration.blocks;
      const rr = vs.generate(EP, {seq: getEpisodeInfo(x.p, EP).seq, requestId: requestId(), blocks: [blocks[0].id], reroll: true});
      await x.svc.runner.waitFor(rr.queued[0].jobId);
      assert.deepEqual(statusReport(x.p, EP).notFresh.filter((k) => !k.endsWith(':draft')), [], 'a re-roll alone changes nothing that was built');
      const b = vs.view(EP).blocks[0];
      assert.equal(b.takes.at(-1)!.selected, false);
      const changed = vs.choose(EP, {block: blocks[0].id, artifactId: b.takes.at(-1)!.artifactId});
      assert.equal(changed.changed, true);
      assert.deepEqual(changed.outOfDate.sort(), ['mix:final', 'render:final', 'timing'], 'only what was built is reported as behind');
      const s = statusReport(x.p, EP);
      assert.deepEqual(Object.values(s.takes).map((t) => t.status), blocks.map(() => 'fresh'), 'no narration is regenerated');
      assert.deepEqual(s.notFresh.filter((k) => !k.endsWith(':draft')).sort(), ['mix:final', 'render:final', 'timing']);
    } finally { await x.close(); }
  });
});

describe('the listening sample', () => {
  test('the selected takes are joined as they would be heard; it is out of date as soon as a take changes; accents and missing takes say why not', {timeout: 120_000}, async () => {
    const x = fakeWorkspace();
    try {
      const vs = new VoiceService(x.svc);
      const id = draftIn(x, 'Sample', 9);
      assert.match(vs.view(id).sample.reason ?? '', /Every block needs a selected take/);
      assert.throws(() => vs.sample(id, {seq: seqOf(x, id), requestId: requestId()}), (e: unknown) => e instanceof VoiceError && e.code === 'blocked');
      const g = vs.generate(id, {seq: seqOf(x, id), requestId: requestId()});
      for (const q of g.queued) await x.svc.runner.waitFor(q.jobId);
      const v0 = vs.view(id);
      assert.equal(v0.sample.available, true);
      assert.equal(v0.sample.url, null);
      const s = vs.sample(id, {seq: seqOf(x, id), requestId: requestId()});
      await x.svc.runner.waitFor(s.jobId);
      const v = vs.view(id);
      assert.equal(job(x, id, s.jobId).state, 'succeeded');
      assert.equal(v.sample.fresh, true);
      assert.match(v.sample.url ?? '', /^\/media\/sample\/.+\.wav$/);
      const total = v.blocks.reduce((t, b) => t + (b.durationSec ?? 0), 0);
      assert.ok(v.sample.durationSec! > total, `the sample (${v.sample.durationSec} s) holds the takes (${total} s) and the lead-in and gaps between them`);
      assert.throws(() => vs.sample(id, {seq: seqOf(x, id), requestId: requestId()}), (e: unknown) => e instanceof VoiceError && e.code === 'nothing');
      // a re-roll and a different selection: the sample no longer matches
      const rr = vs.generate(id, {seq: seqOf(x, id), requestId: requestId(), blocks: ['b2'], reroll: true});
      await x.svc.runner.waitFor(rr.queued[0].jobId);
      assert.equal(vs.view(id).sample.fresh, true, 'a re-roll that was not selected does not change what would be heard');
      vs.choose(id, {block: 'b2', artifactId: vs.view(id).blocks[1].takes[1].artifactId});
      assert.equal(vs.view(id).sample.fresh, false);
      assert.equal(vs.view(id).sample.available, true);
      // the baseline's mix has accents, so a voice-only sample is not offered
      assert.match(vs.view(EP).sample.reason ?? '', /sound accents/);
    } finally { await x.close(); }
  });
});
