// A restart while a rebuild has more than one step of the same kind: the step that was running is interrupted, the ones that were
// only waiting are not started by the new process (nothing expensive restarts by itself), and nothing is left looking like work in
// progress. Each can be retried, and retrying one is not refused because a sibling of the same rebuild exists.
import assert from 'node:assert/strict';
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
async function poll<T>(what: string, fn: () => Promise<T | undefined | false>, ms = 60_000): Promise<T> {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v as T;
    if (Date.now() - t0 > ms) throw new Error(`timed out after ${ms} ms waiting for: ${what}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

before(async () => {
  w = await seedWorkspace();
  // every generation takes 3 s, so the first narration step is still running when the app is stopped
  srv = await spawnServer(w, 0, {STUDIO_TEST_FAKE: '1', FAKE_GENERATE_DELAY: '3'});
});
after(async () => {
  if (srv?.proc.exitCode === null) await srv.kill('SIGTERM');
  rmSync(w.tmp, {recursive: true, force: true});
});

describe('a restart in the middle of a two-step narration', {timeout: 180_000}, () => {
  test('the running step is interrupted, the waiting one is not started, both can be retried, and the rebuild then finishes', async () => {
    const ep = (await call('GET', EP)).json;
    const started = await call('POST', `${EP}/rebuild`, {seq: ep.seq, requestId: 'req-queued-0001'});
    assert.equal(started.status, 202);
    const rebuildId = started.json.rebuildId as string;
    const narration = (r: any) => r.jobs.filter((j: any) => j.rebuildId === rebuildId && j.kind === 'tts.block').sort((a: any, b: any) => a.id - b.id);
    await poll('the first narration step to run', async () => narration(await jobs()).some((j: any) => j.state === 'running'));
    assert.deepEqual(narration(await jobs()).map((j: any) => j.state).sort(), ['queued', 'running'], 'one step runs, the other waits');
    const port = srv.port;
    await srv.kill('SIGKILL');
    srv = await spawnServer(w, port, {STUDIO_TEST_FAKE: '1'}); // restarted without the slowness

    const after = await jobs();
    const [first, second] = narration(after);
    assert.equal(first.state, 'failed');
    assert.match(first.friendlyError, /The app stopped while this was running/);
    assert.equal(second.state, 'cancelled', 'a step that was only waiting is not left looking like work in progress');
    assert.match(second.friendlyError, /restarted before this step started/);
    assert.equal(second.canRetry, true);
    assert.equal(after.rebuilds.find((r: any) => r.id === rebuildId).state, 'failed');
    assert.equal(after.jobs.filter((j: any) => ['queued', 'preparing', 'running'].includes(j.state)).length, 0, 'nothing is queued or running');
    assert.equal((await call('GET', EP)).json.active, null, 'the episode does not claim to have work in progress, so Rebuild is not disabled');

    await new Promise((r) => setTimeout(r, 2000));
    assert.equal((await jobs()).jobs.filter((j: any) => ['queued', 'preparing', 'running'].includes(j.state) && j.rebuildId === rebuildId).length, 0, 'nothing started by itself');

    assert.equal((await call('POST', `/api/jobs/${first.id}/retry`)).status, 200, 'retrying one step is not refused because its sibling belongs to the same rebuild');
    assert.equal((await call('POST', `/api/jobs/${second.id}/retry`)).status, 200);
    await poll('the rebuild to finish', async () => (await jobs()).rebuilds.find((r: any) => r.id === rebuildId && r.state === 'complete'), 120_000);
    const done = (await call('GET', EP)).json;
    assert.equal(done.build.matchesLatestEdits, true);
  });
});
