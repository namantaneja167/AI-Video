// Jobs survive the browser, and a killed server leaves interrupted work that is recoverable by an explicit retry (no automatic restarts).
// The server runs as its own process on fake workers so that it can be killed the hard way.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {rmSync} from 'node:fs';
import {after, before, describe, test} from 'node:test';
import {seedWorkspace, spawnServer, type Child} from './harness.ts';

let w: Awaited<ReturnType<typeof seedWorkspace>>;
let srv: Child;
const EP = '/api/episodes/context-window';
const call = async (method: string, path: string, body?: unknown) => {
  const res = await fetch(srv.url(path), {method, headers: {cookie: `studio_token=${srv.token}`, 'x-studio': '1', 'content-type': 'application/json', connection: 'close'}, body: body === undefined ? undefined : JSON.stringify(body)});
  return {status: res.status, json: (await res.json().catch(() => null)) as any};
};
const jobs = async () => (await call('GET', '/api/jobs?episode=context-window')).json;
async function poll<T>(what: string, fn: () => Promise<T | undefined | false>, ms = 90_000): Promise<T> {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v as T;
    if (Date.now() - t0 > ms) throw new Error(`timed out after ${ms} ms waiting for: ${what}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}
const fakeRenderers = () => execFileSync('ps', ['-ax', '-o', 'command'], {encoding: 'utf8'}).split('\n').filter((l) => l.includes('fake-render-worker') && l.includes(w.tmp));

before(async () => {
  w = await seedWorkspace();
  srv = await spawnServer(w, 0, {STUDIO_TEST_FAKE: '1', FAKE_RENDER_FRAMES: '600', FAKE_RENDER_STEP_MS: '50', FAKE_RENDER_CHILDREN: '1'});
});
after(async () => {
  if (srv?.proc.exitCode === null) await srv.kill('SIGTERM');
  rmSync(w.tmp, {recursive: true, force: true});
});

describe('server crash and recovery', {timeout: 240_000}, () => {
  test('a rebuild keeps running with no browser; killing the server leaves the step interrupted, nothing restarts by itself, and retry finishes it', async () => {
    const ep = (await call('GET', EP)).json;
    const started = await call('POST', `${EP}/rebuild`, {seq: ep.seq, requestId: 'req-restart-0001'});
    assert.equal(started.status, 202);
    const rebuildId = started.json.rebuildId as string;
    // no browser is attached at all; the work proceeds through narration, timing and mix to the (slow) render
    const render = await poll('render running', async () => (await jobs()).jobs.find((j: any) => j.rebuildId === rebuildId && j.kind === 'render.final' && j.state === 'running'));
    assert.ok(fakeRenderers().length >= 1, 'the render worker is running');
    const port = srv.port;
    await srv.kill('SIGKILL');

    // restart on the same workspace, without the slow settings
    srv = await spawnServer(w, port, {STUDIO_TEST_FAKE: '1'});
    const after = await jobs();
    const interrupted = after.jobs.find((j: any) => j.id === render.id);
    assert.equal(interrupted.state, 'failed');
    assert.match(interrupted.friendlyError, /The app stopped while this was running\. Nothing was lost/);
    assert.equal(interrupted.canRetry, true);
    const rb = after.rebuilds.find((r: any) => r.id === rebuildId);
    assert.equal(rb.state, 'failed');
    assert.equal(fakeRenderers().length, 0, 'the render worker that outlived the crash was stopped on recovery');
    await new Promise((r) => setTimeout(r, 2500));
    const quiet = await jobs();
    assert.equal(quiet.jobs.filter((j: any) => ['queued', 'preparing', 'running'].includes(j.state)).length, 0, 'nothing was started again automatically');
    // the steps that had finished are kept, and the earlier build with a video is still there
    const ep2 = (await call('GET', EP)).json;
    assert.ok(ep2.builds.some((b: any) => b.hasFinalVideo));

    assert.equal((await call('POST', `/api/jobs/${render.id}/retry`)).status, 200);
    await poll('rebuild complete', async () => (await jobs()).rebuilds.find((r: any) => r.id === rebuildId && r.state === 'complete'));
    const done = (await call('GET', EP)).json;
    assert.equal(done.build.matchesLatestEdits, true);
    assert.ok(done.build.render);
  });

  test('continuing a rebuild that has nothing left queues nothing', async () => {
    const ep = (await call('GET', EP)).json;
    const put = await call('PUT', EP, {baseSeq: ep.seq, doc: {...ep.doc, narration: {...ep.doc.narration, segments: ep.doc.narration.segments.map((s: any) => (s.id === 's3' ? {...s, text: 'Your text is cut into small pieces, called tokens.', speech: s.speech ?? s.text, emphasis: undefined} : s))}}});
    assert.equal(put.status, 200);
    const rb = (await call('POST', `${EP}/rebuild`, {seq: put.json.seq, requestId: 'req-restart-0002'})).json.rebuildId as string;
    await poll('rebuild complete', async () => (await jobs()).rebuilds.find((r: any) => r.id === rb && r.state === 'complete'));
    assert.equal((await call('POST', `/api/rebuilds/${rb}/continue`)).status, 200, 'a complete rebuild has nothing left, and asking again queues nothing');
    assert.equal((await jobs()).jobs.filter((j: any) => j.rebuildId === rb).length, 3);
  });
});
