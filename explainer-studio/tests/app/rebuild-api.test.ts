// The rebuild, jobs and revision endpoints, over HTTP, on a seeded workspace with fake audio and render workers.
import assert from 'node:assert/strict';
import {after, before, describe, test} from 'node:test';
import {all} from '../../core/db.ts';
import {api, startApp, type Harness} from './harness.ts';

let h: Harness;
let call: ReturnType<typeof api>;
before(async () => { h = await startApp({jobs: true}); call = api(h); });
after(async () => { await h.close(); });

const EP = '/api/episodes/context-window';
const edited = (doc: any, id: string, text: string, speech?: string) => ({
  ...doc,
  narration: {...doc.narration, segments: doc.narration.segments.map((s: any) => { if (s.id !== id) return s; const {emphasis: _e, speech: _s, ...rest} = s; return {...rest, text, ...(speech ? {speech} : {})}; })},
});
const rid = () => `req-${Math.random().toString(36).slice(2, 10)}`;
const episode = async (q = '') => (await call('GET', `${EP}${q}`)).json;
const jobsNow = async () => (await call('GET', '/api/jobs?episode=context-window')).json;
async function poll<T>(what: string, fn: () => Promise<T | undefined | false>, ms = 90_000): Promise<T> {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v as T;
    if (Date.now() - t0 > ms) throw new Error(`timed out after ${ms} ms waiting for: ${what}`);
    await new Promise((res) => setTimeout(res, 100));
  }
}
const settle = (id: string, states = ['complete']) => poll(`rebuild ${id} to be ${states.join(' or ')}`, async () => {
  const r = (await jobsNow()).rebuilds.find((x: any) => x.id === id);
  return r && states.includes(r.state) ? r : undefined;
});
const artifactCount = () => (all<{n: number}>(h.project.db.prepare('SELECT count(*) AS n FROM artifacts'))[0]).n;

describe('rebuild, jobs and revisions over HTTP', {timeout: 300_000}, () => {
  test('the plan endpoint explains what will run, and a rebuild needs the saved version it was made for', async () => {
    const ep = await episode();
    assert.equal(ep.rebuilds, true);
    const plan = (await call('GET', `${EP}/plan`)).json;
    assert.equal(plan.seq, ep.seq);
    assert.deepEqual(plan.blockers, []);
    assert.equal(plan.steps.find((s: any) => s.key === 'render:final').action, 'run');
    assert.equal((await call('POST', `${EP}/rebuild`, {seq: ep.seq})).status, 400, 'a request id is required');
    const stale = await call('POST', `${EP}/rebuild`, {seq: ep.seq - 1, requestId: rid()});
    assert.equal(stale.status, 409);
    assert.equal(stale.json.error, 'changed');
  });

  test('two clicks at once are one rebuild; another one is refused while it runs; it finishes and the new build is previewable with its own audio and video', async () => {
    const ep = await episode();
    const id = rid();
    const [a, b] = await Promise.all([call('POST', `${EP}/rebuild`, {seq: ep.seq, requestId: id}), call('POST', `${EP}/rebuild`, {seq: ep.seq, requestId: id})]);
    assert.equal(a.status, 202);
    assert.equal(b.status, 202);
    assert.equal(a.json.rebuildId, b.json.rebuildId);
    assert.equal([a.json.repeated, b.json.repeated].filter(Boolean).length, 1);
    const other = await call('POST', `${EP}/rebuild`, {seq: ep.seq, requestId: rid()});
    assert.equal(other.status, 409);
    assert.equal(other.json.error, 'busy');
    await settle(a.json.rebuildId);
    assert.equal((await jobsNow()).jobs.filter((j: any) => j.rebuildId === a.json.rebuildId).length, 5, 'one job per step, not per click');
    const now = await episode();
    assert.equal(now.builds.length, 2);
    assert.equal(now.build.isLatest, true);
    assert.equal(now.build.matchesLatestEdits, true);
    assert.ok(now.build.render);
    assert.equal(now.build.imported, null);
    const audio = await fetch(h.url(now.build.audio.url), {headers: {cookie: `studio_token=${h.token}`, range: 'bytes=0-43'}});
    assert.equal(audio.status, 206);
    const video = await fetch(h.url(now.build.render.url), {headers: {cookie: `studio_token=${h.token}`}});
    assert.equal(video.status, 200);
    assert.equal(video.headers.get('content-type'), 'video/mp4');
    // the earlier (imported) build is still there, with its own audio and video
    const old = now.builds.find((x: any) => !x.isLatest);
    const oldEp = await episode(`?build=${old.id}`);
    assert.equal(oldEp.build.id, old.id);
    assert.notEqual(oldEp.build.audio.url, now.build.audio.url);
    assert.ok(oldEp.build.imported);
    assert.equal(oldEp.build.matchesLatestEdits, false);
    assert.equal((await fetch(h.url(oldEp.build.audio.url), {headers: {cookie: `studio_token=${h.token}`}})).status, 200);
  });

  test('only builds of this episode are served as media', async () => {
    const now = await episode();
    const audio = now.build.audio.url as string;
    assert.equal((await call('GET', audio.replace(/\/b\d+-\d+-\d+\//, '/b9999-9999-0/'))).status, 404);
    assert.equal((await call('GET', audio.replace('context-window', 'other'))).status, 404);
    assert.equal((await call('GET', '/media/render/context-window/999999.mp4')).status, 404);
    const timing = (all<{id: number}>(h.project.db.prepare("SELECT id FROM artifacts WHERE kind='take' LIMIT 1")))[0].id;
    assert.equal((await call('GET', `/media/render/context-window/${timing}.mp4`)).status, 404, 'an artifact that is not a render is not served as one');
  });

  test('cancel and retry over HTTP; the earlier build stays available', async () => {
    const ep = await episode();
    const put = await call('PUT', EP, {doc: edited(ep.doc, 's6', 'In many models, input and output share a single budget.', 'In many models, input and output share one budget.'), baseSeq: ep.seq});
    assert.equal(put.status, 200);
    const ep2 = await episode();
    process.env.FAKE_RENDER_FRAMES = '300'; process.env.FAKE_RENDER_STEP_MS = '50';
    let jobId = 0; let rebuildId = '';
    try {
      const r = await call('POST', `${EP}/rebuild`, {seq: ep2.seq, requestId: rid()});
      assert.equal(r.status, 202);
      rebuildId = r.json.rebuildId;
      const job = await poll('render running', async () => (await jobsNow()).jobs.find((x: any) => x.rebuildId === rebuildId && x.kind === 'render.final' && x.state === 'running'), 120_000);
      jobId = job.id;
      const running = (await jobsNow()).jobs.find((x: any) => x.id === jobId);
      assert.equal(running.canCancel, true);
      assert.equal(typeof running.elapsedMs, 'number');
      const c = await call('POST', `/api/jobs/${jobId}/cancel`);
      assert.equal(c.status, 200);
    } finally { delete process.env.FAKE_RENDER_FRAMES; delete process.env.FAKE_RENDER_STEP_MS; }
    const after = await jobsNow();
    assert.equal(after.jobs.find((x: any) => x.id === jobId).state, 'cancelled');
    assert.equal(after.rebuilds.find((x: any) => x.id === rebuildId).state, 'cancelled');
    assert.ok((await episode()).builds.some((b: any) => b.hasFinalVideo), 'an earlier build with a video is still available');
    assert.equal((await call('POST', `/api/jobs/${jobId}/cancel`)).status, 200, 'cancelling a finished job changes nothing');
    assert.equal((await call('POST', `/api/jobs/${jobId}/retry`)).status, 200);
    await settle(rebuildId);
    assert.equal((await jobsNow()).jobs.find((x: any) => x.id === jobId).state, 'succeeded');
  });

  test('the revision list has understandable summaries and restoring creates a new revision without deleting anything', async () => {
    const list = (await call('GET', `${EP}/revisions`)).json.revisions as any[];
    assert.ok(list.length >= 2);
    assert.equal(list[0].number, Math.max(...list.map((r) => r.number)), 'newest first');
    assert.equal(list.find((r) => r.number === 1).kindLabel, 'Imported episode');
    assert.ok(list.some((r) => r.summary.some((l: string) => /changed in s6/.test(l))), `a summary names the edited segment: ${JSON.stringify(list.map((r) => r.summary))}`);
    assert.equal(list.filter((r) => r.isCurrent).length >= 1, true);
    const detail = (await call('GET', `${EP}/revisions/1`)).json;
    assert.equal(detail.segments.length, 8);
    assert.ok(detail.ifRestored.length > 0);

    const cur = await episode();
    const artifactsBefore = artifactCount();
    // a stale tab cannot restore over newer saves
    assert.equal((await call('POST', `${EP}/restore`, {number: 1, baseSeq: cur.seq - 1})).status, 409);
    const r = await call('POST', `${EP}/restore`, {number: 1, baseSeq: cur.seq});
    assert.equal(r.status, 200);
    assert.equal(r.json.restored, 1);
    const after = (await call('GET', `${EP}/revisions`)).json.revisions as any[];
    assert.equal(after.length, list.length + 1, 'one new revision; none removed');
    assert.equal(after[0].kind, 'restore');
    assert.match(after[0].kindLabel, /Restored r1/);
    assert.equal(artifactCount(), artifactsBefore, 'builds and takes are untouched');
    assert.equal((await episode()).doc.narration.segments[5].text, detail.segments[5].text);
    // restoring what is already current changes nothing
    const again = await call('POST', `${EP}/restore`, {number: 1, baseSeq: (await episode()).seq});
    assert.equal(again.json.changed, false);
    // the restored text was narrated before: its take is reused, not generated
    const plan = (await call('GET', `${EP}/plan`)).json;
    assert.ok(plan.steps.some((s: any) => s.action === 'reuse' || s.action === 'current'));
  });
});
