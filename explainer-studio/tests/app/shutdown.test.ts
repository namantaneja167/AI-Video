// Stopping the server: requests already accepted are answered in full, idle connections are closed, a stalled client cannot
// hold the stop forever, and a restart on the same port always serves a fresh connection.
import assert from 'node:assert/strict';
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import http from 'node:http';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {after, before, describe, test} from 'node:test';
import {ROOT, seedDemo} from '../../app/demo.ts';
import {baselineSources} from '../baseline-sources.ts';
import {createApp, type App} from '../../app/server.ts';
import {Project} from '../../core/project.ts';

let tmp = '';
let root = '';
let dist = '';
before(() => {
  tmp = mkdtempSync(join(tmpdir(), 'studio-shutdown-'));
  root = join(tmp, 'project');
  seedDemo(root, baselineSources());
  dist = join(tmp, 'dist');
  mkdirSync(dist);
  writeFileSync(join(dist, 'index.html'), '<html></html>');
});
after(() => rmSync(tmp, {recursive: true, force: true}));

type Up = {project: Project; app: App; port: number; headers: Record<string, string>};
const boot = async (port = 0, stopGraceMs?: number): Promise<Up> => {
  const project = Project.open(root);
  const app = createApp({project, projectRoot: root, workspaceLabel: 't', distDir: dist, publicDir: resolve(ROOT, 'public'), port, stopGraceMs});
  const bound = await app.start();
  return {project, app, port: bound, headers: {cookie: `studio_token=${app.token}`, 'x-studio': '1', 'content-type': 'application/json'}};
};
const down = async (u: Up) => { await u.app.stop(); u.project.close(); };
const pref = (u: Up, key: string) => (u.project.db.prepare('SELECT value FROM ui_state WHERE key=?').get(key) as {value: string} | undefined)?.value;

describe('stopping the server', {timeout: 60_000}, () => {
  test('a request that has begun is answered in full and committed, and the stop completes after it', async () => {
    const u = await boot();
    const body = JSON.stringify({key: 'app.shutdown.inflight', value: 'kept'});
    const agent = new http.Agent({keepAlive: true});
    const req = http.request({host: '127.0.0.1', port: u.port, path: '/api/ui', method: 'PUT', headers: {...u.headers, 'content-length': Buffer.byteLength(body)}, agent});
    const reply = new Promise<{status: number; text: string}>((res, rej) => {
      req.on('response', (r) => { let t = ''; r.on('data', (d) => { t += d; }); r.on('end', () => res({status: r.statusCode!, text: t})); });
      req.on('error', rej);
    });
    req.write(body.slice(0, 10)); // the server has the request line and part of the body
    await new Promise((r) => setTimeout(r, 100));
    let stopped = false;
    const stopping = u.app.stop().then(() => { stopped = true; });
    await new Promise((r) => setTimeout(r, 100));
    assert.equal(stopped, false, 'the stop waits for the request that is in progress');
    req.end(body.slice(10));
    const r = await reply;
    assert.equal(r.status, 200);
    assert.deepEqual(JSON.parse(r.text), {ok: true});
    await stopping;
    assert.equal(pref(u, 'app.shutdown.inflight'), 'kept', 'what was answered was committed');
    agent.destroy();
    u.project.close();
  });

  test('idle keep-alive connections are closed by the server when it stops, so they are not left to fail on reuse', async () => {
    const u = await boot();
    const agent = new http.Agent({keepAlive: true, maxSockets: 1});
    const answered = new Promise<void>((res) => {
      const req = http.get({host: '127.0.0.1', port: u.port, path: '/api/health', headers: u.headers, agent}, (r) => { r.resume(); r.on('end', () => res()); });
      req.on('error', () => undefined);
    });
    const closed = new Promise<void>((res) => { agent.on('free', (socket) => { socket.once('close', () => res()); }); });
    await answered;
    await new Promise((r) => setTimeout(r, 100));
    const t0 = Date.now();
    await u.app.stop();
    await closed;
    assert.ok(Date.now() - t0 < 1000, 'closed promptly, not after the keep-alive timeout');
    agent.destroy();
    u.project.close();
  });

  test('a client that never finishes its request cannot hold the stop for longer than the grace period', async () => {
    const u = await boot(0, 300);
    const req = http.request({host: '127.0.0.1', port: u.port, path: '/api/ui', method: 'PUT', headers: {...u.headers, 'content-length': 500}});
    req.on('error', () => undefined);
    req.write('{"key":');
    await new Promise((r) => setTimeout(r, 100));
    const t0 = Date.now();
    await u.app.stop();
    const took = Date.now() - t0;
    assert.ok(took >= 250 && took < 2000, `stopped after the grace period (${took} ms)`);
    req.destroy();
    u.project.close();
  });

  test('server-sent event streams are ended by the stop', async () => {
    const u = await boot();
    const ended = new Promise<void>((res) => {
      http.get({host: '127.0.0.1', port: u.port, path: '/api/events', headers: u.headers}, (r) => { r.resume(); r.on('end', () => res()); r.on('close', () => res()); }).on('error', () => res());
    });
    await new Promise((r) => setTimeout(r, 100));
    await u.app.stop();
    await ended;
    u.project.close();
  });

  test('30 restarts on the same port: every fresh connection is answered', async () => {
    let u = await boot();
    const port = u.port;
    const failures: string[] = [];
    for (let i = 0; i < 30; i++) {
      await down(u);
      u = await boot(port);
      const r = await fetch(`http://127.0.0.1:${port}/api/health`, {headers: {...u.headers, connection: 'close'}}).catch((e) => ({status: `${i}: ${(e.cause?.code ?? e.message) as string}`}));
      if (r.status !== 200) failures.push(String(r.status));
    }
    assert.deepEqual(failures, []);
    await down(u);
  });
});
