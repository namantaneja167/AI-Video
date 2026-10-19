// The Voice stage through the app server: authentication, the routes and their refusals, audio of takes with byte ranges, an injected
// failure while saving a block change, and a server that is killed in the middle of narrating and comes back.
import assert from 'node:assert/strict';
import {rmSync} from 'node:fs';
import {after, before, describe, test} from 'node:test';
import {api, seedWorkspace, spawnServer, startApp, type Child, type Harness} from './harness.ts';

const sentence = (n: number) => `Sentence ${n} says exactly ${Array.from({length: 16}, (_, i) => `word${n}x${i}`).join(' ')}.`;
const SCRIPT = (count: number) => Array.from({length: count}, (_, i) => sentence(i + 1)).join(' ');
type Call = ReturnType<typeof api>;

async function draft(call: Call, title: string, sentences: number): Promise<string> {
  const made = (await call('POST', '/api/plans', {title, audience: 'a', objective: 'o'})).json;
  const id = made.plan.id as string;
  const imp = (await call('POST', `/api/plans/${id}/imports`, {text: SCRIPT(sentences), via: 'paste'})).json;
  const ok = await call('POST', `/api/plans/${id}/imports/${imp.import.id}/accept`, {selection: {sources: [], claims: [], script: imp.import.proposal.script, storyboard: false, confirmReplace: false}, basePlanSeq: imp.planSeq, baseEpisodeSeq: null});
  assert.equal(ok.status, 200, ok.text);
  return id;
}
const rid = () => `req-${Math.random().toString(36).slice(2, 12)}`;
async function poll<T>(what: string, fn: () => Promise<T | undefined | false>, ms = 60_000): Promise<T> {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v as T;
    if (Date.now() - t0 > ms) throw new Error(`timed out after ${ms} ms waiting for: ${what}`);
    await new Promise((r) => setTimeout(r, 80));
  }
}

describe('the voice routes', () => {
  let h: Harness;
  let call: Call;
  before(async () => { h = await startApp({jobs: true}); call = api(h); });
  after(async () => { await h.close(); });
  const view = async (id: string) => (await call('GET', `/api/episodes/${id}/voice`)).json;

  test('they need the sign-in, answer for episodes only, and give the blocks of the baseline with their saved takes', async () => {
    const unsigned = await fetch(h.url('/api/episodes/context-window/voice'), {headers: {connection: 'close'}});
    assert.equal(unsigned.status, 401);
    const v = await view('context-window');
    assert.equal(v.episodeId, 'context-window');
    assert.ok(v.blocks.length >= 2 && v.blocks.every((b: any) => b.takes.length >= 1));
    assert.equal((await call('GET', '/api/episodes/nope/voice')).status, 404);
    assert.equal((await call('POST', '/api/episodes/context-window/voice/generate', {seq: 1})).status, 400);
    assert.equal((await call('POST', '/api/episodes/context-window/voice/generate', {seq: 1, requestId: rid()}, {'x-studio': '0'})).status, 403);
  });

  test('generate, audition, re-roll, select: the refusals have the right status and queue nothing; the audio is served with byte ranges', {timeout: 90_000}, async () => {
    const id = await draft(call, 'Routes flow', 6);
    const v0 = await view(id);
    assert.deepEqual(v0.blocks.map((b: any) => b.status), ['none', 'none']);
    const stale = await call('POST', `/api/episodes/${id}/voice/generate`, {seq: v0.seq - 1, requestId: rid()});
    assert.equal(stale.status, 409);
    assert.equal(stale.json.error, 'changed');
    assert.equal((await call('GET', `/api/jobs?episode=${id}`)).json.jobs.length, 0, 'a stale page queued nothing');
    const g = await call('POST', `/api/episodes/${id}/voice/generate`, {seq: v0.seq, requestId: rid()});
    assert.equal(g.status, 202);
    assert.deepEqual(g.json.queued.map((q: any) => q.block), ['b1', 'b2']);
    assert.equal(g.json.view.busy, true);
    const busy = await call('POST', `/api/episodes/${id}/voice/generate`, {seq: v0.seq, requestId: rid(), blocks: ['b1'], reroll: true});
    assert.equal(busy.status, 409);
    assert.equal(busy.json.error, 'busy');
    const done = await poll('both blocks narrated', async () => { const v = await view(id); return !v.busy && v.blocks.every((b: any) => b.status === 'fresh') && v; });
    const take = done.blocks[0].takes[0];
    // the audio of a take, whole and by range
    const whole = await call('GET', take.url);
    assert.equal(whole.status, 200);
    assert.equal(whole.headers.get('content-type'), 'audio/wav');
    assert.equal(whole.headers.get('accept-ranges'), 'bytes');
    const ranged = await fetch(h.url(take.url), {headers: {cookie: `studio_token=${h.token}`, range: 'bytes=0-43', connection: 'close'}});
    assert.equal(ranged.status, 206);
    assert.equal((await ranged.arrayBuffer()).byteLength, 44);
    // a take of another episode's address, or that is not a take, is not served
    assert.equal((await call('GET', take.url.replace(`/${id}/`, '/context-window/'))).status, 404);
    assert.equal((await call('GET', `/media/sample/${id}/${take.artifactId}.wav`)).status, 404, 'a take is not a sample');
    // re-roll and select
    const rr = await call('POST', `/api/episodes/${id}/voice/generate`, {seq: done.seq, requestId: rid(), blocks: ['b1'], reroll: true});
    assert.equal(rr.status, 202);
    const two = await poll('the second take', async () => { const v = await view(id); return !v.busy && v.blocks[0].takes.length === 2 && v; });
    assert.deepEqual(two.blocks[0].takes.map((t: any) => t.selected), [true, false]);
    const sel = await call('POST', `/api/episodes/${id}/voice/select`, {block: 'b1', artifactId: two.blocks[0].takes[1].artifactId, seq: two.seq});
    assert.equal(sel.status, 200);
    assert.deepEqual(sel.json.view.blocks[0].takes.map((t: any) => t.selected), [false, true]);
    // an episode edit makes the first take incompatible: refused with 422 and the reason
    const ep = (await call('GET', `/api/episodes/${id}`)).json;
    const put = await call('PUT', `/api/episodes/${id}`, {baseSeq: ep.seq, doc: {...ep.doc, narration: {...ep.doc.narration, segments: ep.doc.narration.segments.map((s: any) => (s.id === 's1' ? {...s, text: `${s.text} Edited.`} : s))}}});
    assert.equal(put.status, 200);
    const bad = await call('POST', `/api/episodes/${id}/voice/select`, {block: 'b1', artifactId: two.blocks[0].takes[0].artifactId});
    assert.equal(bad.status, 422);
    assert.match(bad.json.message, /earlier wording of s1/);
    const sample = await call('POST', `/api/episodes/${id}/voice/sample`, {seq: put.json.seq, requestId: rid()});
    assert.equal(sample.status, 422, 'the sample needs a take for every block');
  });

  test('a block change: preview writes nothing; a failure while saving changes nothing; the saved change is a revision; stale and busy are 409', {timeout: 90_000}, async () => {
    const id = await draft(call, 'Routes blocks', 6);
    const v = await view(id);
    const layout = async () => (await view(id)).blocks.map((b: any) => `${b.id}:${b.segments.map((s: any) => s.id).join('+')}`).join(' ');
    const before = await layout();
    const pv = await call('POST', `/api/episodes/${id}/voice/blocks`, {seq: v.seq, op: 'split', block: 'b1', after: 's1', preview: true});
    assert.equal(pv.status, 200);
    assert.match(pv.json.preview.lines[0], /Before: b1 \(s1 to s3\)\. After: b1 \(s1\) and b3 \(s2 and s3\)\./);
    assert.equal(await layout(), before, 'a preview changes nothing');
    const bad = await call('POST', `/api/episodes/${id}/voice/blocks`, {seq: v.seq, op: 'split', block: 'b1', after: 's3'});
    assert.equal(bad.status, 422);
    assert.match(bad.json.message, /nothing after it to split off/);
    // a failure inside the save: nothing is changed, the revision list is as it was
    const revsBefore = (await call('GET', `/api/episodes/${id}/revisions`)).json.revisions.length;
    const { writeFileSync } = await import('node:fs');
    writeFileSync(h.faultFile, '1');
    const failed = await call('POST', `/api/episodes/${id}/voice/blocks`, {seq: v.seq, op: 'split', block: 'b1', after: 's1'});
    rmSync(h.faultFile, {force: true});
    assert.equal(failed.status, 500);
    assert.equal(await layout(), before, 'a failed save changed nothing');
    assert.equal((await call('GET', `/api/episodes/${id}/revisions`)).json.revisions.length, revsBefore);
    const ok = await call('POST', `/api/episodes/${id}/voice/blocks`, {seq: v.seq, op: 'split', block: 'b1', after: 's1'});
    assert.equal(ok.status, 200);
    assert.equal(await layout(), 'b1:s1 b3:s2+s3 b2:s4+s5+s6');
    const revs = (await call('GET', `/api/episodes/${id}/revisions`)).json.revisions;
    assert.equal(revs[0].kind, 'blocks-edit');
    assert.equal(revs[0].kindLabel, 'Narration blocks changed');
    assert.match(revs[0].summary.join(' '), /Narration blocks are now b1 \(s1\), b3 \(s2 to s3\), b2 \(s4 to s6\)/);
    const stale = await call('POST', `/api/episodes/${id}/voice/blocks`, {seq: v.seq, op: 'merge', block: 'b1'});
    assert.equal(stale.status, 409);
    assert.equal(stale.json.error, 'changed');
    // work in progress blocks a change
    const g = await call('POST', `/api/episodes/${id}/voice/generate`, {seq: ok.json.seq, requestId: rid(), blocks: ['b1']});
    assert.equal(g.status, 202);
    const busy = await call('POST', `/api/episodes/${id}/voice/blocks`, {seq: ok.json.seq, op: 'merge', block: 'b1'});
    assert.equal(busy.status, 409);
    assert.equal(busy.json.error, 'busy');
    await poll('idle', async () => !(await view(id)).busy);
    const cancel = await call('POST', `/api/episodes/${id}/voice/cancel`, {});
    assert.equal(cancel.status, 200);
    assert.equal(cancel.json.cancelled, 0, 'nothing was left to cancel');
  });

  test('without a job service the screen says so instead of pretending', async () => {
    const plain = await startApp();
    try {
      const r = await api(plain)('GET', '/api/episodes/context-window/voice');
      assert.equal(r.status, 404);
      assert.match(r.json.message, /not available in this session/);
    } finally { await plain.close(); }
  });
});

describe('a server killed while narrating', () => {
  let w: Awaited<ReturnType<typeof seedWorkspace>>;
  let srv: Child;
  let call: (method: string, path: string, body?: unknown) => Promise<{status: number; json: any}>;
  const mk = () => async (method: string, path: string, body?: unknown) => {
    const res = await fetch(srv.url(path), {method, headers: {cookie: `studio_token=${srv.token}`, 'x-studio': '1', 'content-type': 'application/json', connection: 'close'}, body: body === undefined ? undefined : JSON.stringify(body)});
    return {status: res.status, json: (await res.json().catch(() => null)) as any};
  };
  const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
  before(async () => { w = await seedWorkspace(); srv = await spawnServer(w, 0, {STUDIO_TEST_FAKE: '1', FAKE_GENERATE_DELAY: '30'}); call = mk(); });
  after(async () => { if (srv?.proc.exitCode === null) await srv.kill('SIGTERM'); rmSync(w.tmp, {recursive: true, force: true}); });

  test('the running block shows as interrupted with a working Retry, the blocks that were only waiting are not started, no worker is left, and nothing restarts by itself', {timeout: 120_000}, async () => {
    const id = await draft(call as never, 'Crash', 9);
    const v = (await call('GET', `/api/episodes/${id}/voice`)).json;
    const g = await call('POST', `/api/episodes/${id}/voice/generate`, {seq: v.seq, requestId: rid()});
    assert.equal(g.status, 202);
    assert.equal(g.json.queued.length, 3);
    const running = await poll('the first block generating', async () => { const j = (await call('GET', `/api/episodes/${id}/voice`)).json.jobs.find((x: any) => x.state === 'running' && x.displayStep === 'generating speech'); return j; });
    const workerPid = (await call('GET', `/api/episodes/${id}/voice`)).json.engine.pid as number;
    assert.ok(workerPid && alive(workerPid), 'the audio worker is running');
    const port = srv.port;
    await srv.kill('SIGKILL');
    srv = await spawnServer(w, port, {STUDIO_TEST_FAKE: '1'}); // restarted without the slow setting
    call = mk();
    const after = (await call('GET', `/api/episodes/${id}/voice`)).json;
    const byBlock = Object.fromEntries(after.jobs.map((j: any) => [j.subject, j]));
    assert.equal(byBlock.b1.state, 'failed');
    assert.match(byBlock.b1.friendlyError, /The app stopped while this was running\. Nothing was lost/);
    assert.equal(byBlock.b1.canRetry, true);
    for (const b of ['b2', 'b3']) {
      assert.equal(byBlock[b].state, 'cancelled', 'a block that was only waiting is not started by the new server');
      assert.match(byBlock[b].friendlyError, /restarted before this step started/);
    }
    assert.equal(after.busy, false);
    assert.equal(after.engine.worker, 'none');
    await poll('the worker that outlived the crash to be stopped', async () => !alive(workerPid), 10_000);
    assert.deepEqual(after.blocks.map((b: any) => b.takes.length), [0, 0, 0], 'no half-made take was kept');
    await new Promise((r) => setTimeout(r, 2000));
    assert.equal(((await call('GET', `/api/episodes/${id}/voice`)).json).busy, false, 'nothing was started again automatically');
    // retry what was interrupted, then the rest
    assert.equal((await call('POST', `/api/jobs/${running.id}/retry`)).status, 200);
    await poll('the first block narrated', async () => (await call('GET', `/api/episodes/${id}/voice`)).json.blocks[0].status === 'fresh');
    const next = (await call('GET', `/api/episodes/${id}/voice`)).json;
    const rest = await call('POST', `/api/episodes/${id}/voice/generate`, {seq: next.seq, requestId: rid()});
    assert.equal(rest.status, 202);
    assert.deepEqual(rest.json.queued.map((q: any) => q.block), ['b2', 'b3']);
    await poll('all narrated', async () => { const x = (await call('GET', `/api/episodes/${id}/voice`)).json; return !x.busy && x.blocks.every((b: any) => b.status === 'fresh'); });
  });
});
