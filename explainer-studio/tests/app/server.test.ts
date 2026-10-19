import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {after, before, test} from 'node:test';
import {resolve} from 'node:path';
import {existsSync, rmSync, writeFileSync} from 'node:fs';
import {ROOT} from '../../app/demo.ts';
import {getEpisode, getEpisodeInfo} from '../../core/episodes.ts';
import {all} from '../../core/db.ts';
import {api, startApp, type Harness} from './harness.ts';

let h: Harness;
let call: ReturnType<typeof api>;
before(async () => { h = await startApp(); call = api(h); });
after(async () => { await h.close(); });

const EP = '/api/episodes/context-window';
const edited = (doc: any, text: string, id = 's2') => ({...doc, narration: {...doc.narration, segments: doc.narration.segments.map((s: any) => (s.id === id ? {...s, text, emphasis: undefined} : s))}});
const jobCount = () => all<{n: number}>(h.project.db.prepare('SELECT count(*) AS n FROM jobs'))[0].n;

test('requests need the sign-in cookie, the app host, and (for writes) the app header and origin', async () => {
  const plain = (path: string, init: RequestInit = {}) => fetch(h.url(path), {redirect: 'manual', ...init});
  assert.equal((await plain('/api/session')).status, 401);
  assert.equal((await plain('/')).status, 401);
  assert.equal((await plain(`/api/session`, {headers: {cookie: 'studio_token=deadbeef'}})).status, 401);
  const signIn = await plain(`/?token=${h.token}`);
  assert.equal(signIn.status, 302);
  assert.match(signIn.headers.get('set-cookie') ?? '', /studio_token=[a-f0-9]+; HttpOnly; SameSite=Strict/);
  assert.equal((await plain(`/?token=wrong`)).status, 401);
  // a different Host header (DNS rebinding) is refused even with the cookie
  const {request} = await import('node:http');
  const status = await new Promise<number>((res, rej) => {
    const r = request({host: '127.0.0.1', port: h.port, path: '/api/session', headers: {host: 'evil.example', cookie: `studio_token=${h.token}`}}, (m) => { m.resume(); res(m.statusCode!); });
    r.on('error', rej); r.end();
  });
  assert.equal(status, 403);
  const body = {key: 'app.outline.collapsed', value: '1'};
  assert.equal((await plain('/api/ui', {method: 'PUT', headers: {cookie: `studio_token=${h.token}`, 'content-type': 'application/json'}, body: JSON.stringify(body)})).status, 403, 'no app header');
  assert.equal((await call('PUT', '/api/ui', body, {origin: 'http://evil.example'})).status, 403, 'foreign origin');
  assert.equal((await call('PUT', '/api/ui', body)).status, 200);
});

test('the episode payload carries the document, its saved version, and the last build with its audio', async () => {
  const r = await call('GET', EP);
  assert.equal(r.status, 200);
  assert.equal(r.json.doc.id, 'context-window');
  assert.equal(typeof r.json.seq, 'number');
  assert.equal(r.json.status.timing.status, 'fresh');
  const b = r.json.build;
  assert.equal(b.builtDoc.id, 'context-window');
  assert.equal(b.timeline.durationSec > 20, true);
  assert.equal(b.audio.fresh, true);
  assert.equal(b.audio.matchesTiming, true);
  assert.ok(b.imported, 'the seeded build says that it was imported');
  assert.equal(b.audio.url, `/media/generated/context-window/${b.id}/${b.timeline.audio}`);
  assert.match(b.render.url, /^\/media\/render\/context-window\/\d+\.mp4$/);
  assert.equal(b.isLatest, true);
  assert.equal(b.matchesLatestEdits, true);
});

test('a save is committed before the response, is visible in the store, and makes the right outputs out of date', async () => {
  const before = (await call('GET', EP)).json;
  const doc = edited(before.doc, 'That limit is called its context window.');
  const r = await call('PUT', EP, {doc, baseSeq: before.seq, tab: 't1'});
  assert.equal(r.status, 200);
  assert.equal(r.json.seq, before.seq + 1);
  assert.equal(getEpisodeInfo(h.project, 'context-window').seq, r.json.seq, 'committed in the store when the answer arrives');
  assert.equal(getEpisode(h.project, 'context-window').narration.segments[1].text, 'That limit is called its context window.');
  assert.equal(r.json.status.takes.b1.status, 'stale');
  assert.equal(r.json.status.takes.b2.status, 'fresh');
  assert.equal(r.json.status.timing.status, 'stale');
  // The preview data still comes from the build, not from the edit.
  const after = (await call('GET', EP)).json;
  assert.equal(after.build.builtDoc.narration.segments[1].text, 'That limit is its context window.');
  assert.equal(after.doc.narration.segments[1].text, 'That limit is called its context window.');
  assert.equal(after.build.audio.matchesTiming, true);
});

test('saving the same document again changes nothing; a missing base version is refused', async () => {
  const cur = (await call('GET', EP)).json;
  const same = await call('PUT', EP, {doc: cur.doc, baseSeq: cur.seq});
  assert.equal(same.json.changed, false);
  assert.equal(same.json.seq, cur.seq);
  assert.equal((await call('PUT', EP, {doc: cur.doc})).status, 400);
});

test('a save on an old base version is a conflict: nothing is overwritten and the newer version comes back', async () => {
  const cur = (await call('GET', EP)).json;
  const first = await call('PUT', EP, {doc: edited(cur.doc, 'Your text is cut into small pieces called tokens.', 's3'), baseSeq: cur.seq});
  assert.equal(first.status, 200);
  const stale = await call('PUT', EP, {doc: edited(cur.doc, 'Another tab wrote this.', 's3'), baseSeq: cur.seq});
  assert.equal(stale.status, 409);
  assert.equal(stale.json.error, 'conflict');
  assert.equal(stale.json.current.seq, first.json.seq);
  assert.equal(getEpisode(h.project, 'context-window').narration.segments[2].text, 'Your text is cut into small pieces called tokens.', 'the earlier commit stands');
});

test('an invalid document is refused with the reason and nothing is stored', async () => {
  const cur = (await call('GET', EP)).json;
  const bad = edited(cur.doc, '');
  const r = await call('PUT', EP, {doc: bad, baseSeq: cur.seq});
  assert.equal(r.status, 422);
  assert.ok(r.json.message.length > 0);
  assert.equal(getEpisodeInfo(h.project, 'context-window').seq, cur.seq);
});

test('a failure while committing leaves the stored episode untouched, and the same save works once the fault is gone', async () => {
  const cur = (await call('GET', EP)).json;
  const doc = edited(cur.doc, 'Each token uses up some room, always.', 's4');
  writeFileSync(h.faultFile, 'x');
  const failed = await call('PUT', EP, {doc, baseSeq: cur.seq});
  assert.equal(failed.status, 500);
  assert.equal(failed.json.error, 'save-failed');
  assert.equal(getEpisodeInfo(h.project, 'context-window').seq, cur.seq, 'nothing committed');
  assert.equal(getEpisode(h.project, 'context-window').narration.segments[3].text, 'Each token uses up some room.');
  rmSync(h.faultFile);
  const retry = await call('PUT', EP, {doc, baseSeq: cur.seq});
  assert.equal(retry.status, 200);
});

test('committed edits and preferences survive a restart of the server', async () => {
  assert.equal((await call('PUT', '/api/ui', {key: 'app.selected.context-window', value: 's5'})).status, 200);
  const before = (await call('GET', EP)).json;
  await h.restart();
  call = api(h);
  const after = (await call('GET', EP)).json;
  assert.equal(after.seq, before.seq);
  assert.deepEqual(after.doc, before.doc);
  assert.equal((await call('GET', '/api/ui')).json['app.selected.context-window'], 's5');
  assert.equal(after.build.builtDoc.narration.segments[3].text, 'Each token uses up some room.');
});

test('preferences accept only the app keys', async () => {
  assert.equal((await call('PUT', '/api/ui', {key: 'something.else', value: '1'})).status, 400);
  assert.equal((await call('PUT', '/api/ui', {key: 'app.x', value: 'y'.repeat(600)})).status, 400);
});

test('the build audio is served with byte ranges, and nothing else is served from /media', async () => {
  const b = (await call('GET', EP)).json.build;
  const full = await fetch(h.url(b.audio.url), {headers: {cookie: `studio_token=${h.token}`}});
  assert.equal(full.status, 200);
  assert.equal(full.headers.get('content-type'), 'audio/wav');
  assert.equal(full.headers.get('accept-ranges'), 'bytes');
  const size = Number(full.headers.get('content-length'));
  assert.equal(size, b.audio.bytes);
  const part = await fetch(h.url(b.audio.url), {headers: {cookie: `studio_token=${h.token}`, range: 'bytes=0-43'}});
  assert.equal(part.status, 206);
  assert.equal(part.headers.get('content-range'), `bytes 0-43/${size}`);
  assert.equal(Buffer.from(await part.arrayBuffer()).subarray(0, 4).toString(), 'RIFF');
  assert.equal((await call('GET', '/media/generated/context-window/full/other.wav')).status, 404);
  assert.equal((await call('GET', '/media/generated/other-episode/full/x.wav')).status, 404);
  assert.equal((await call('GET', '/media/library/fonts/InterVariable.woff2')).status, 200);
  assert.equal((await call('GET', '/media/library/fonts/..%2F..%2Fpackage.json')).status, 404);
  assert.equal((await call('GET', '/media/library/fonts/manifest.json')).status, 404);
  assert.equal((await call('GET', '/media/../package.json')).status, 404);
});

test('events announce commits from other tabs, and the app starts no jobs', async () => {
  const before = jobCount();
  const res = await fetch(h.url('/api/events'), {headers: {cookie: `studio_token=${h.token}`}});
  const reader = res.body!.getReader();
  let text = '';
  const read = async (until: RegExp) => { const t0 = Date.now(); while (!until.test(text) && Date.now() - t0 < 5000) { const {value} = await reader.read(); text += Buffer.from(value!).toString(); } };
  await read(/event: hello/);
  assert.match(text, /"serverId"/);
  const cur = (await call('GET', EP)).json;
  await call('PUT', EP, {doc: edited(cur.doc, 'The reply uses room too, as well.', 's5'), baseSeq: cur.seq, tab: 'other'});
  await read(/event: committed/);
  assert.match(text, /"tab":"other"/);
  await reader.cancel();
  assert.equal(jobCount(), before, 'saving edits enqueues nothing');
});

test('the launcher refuses real projects and unknown arguments', () => {
  for (const args of [['init'], ['adopt', '/tmp/x'], ['--project', '/tmp/x', '--no-open']]) {
    let code = 0;
    try { execFileSync('node', [resolve(ROOT, 'app/main.ts'), ...args], {stdio: 'pipe'}); } catch (e) { code = (e as {status: number}).status; }
    assert.equal(code, 2, args.join(' '));
  }
  assert.equal(existsSync(resolve(ROOT, 'demo-workspace/pip-context-window.replaced')), false);
});
