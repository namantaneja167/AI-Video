// The project routes: info, a backup made from the running app (verified, then restored to another place), and the environment check.
import assert from 'node:assert/strict';
import {existsSync, mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {after, before, describe, test} from 'node:test';
import {verifyBackup, restoreBackup} from '../../core/backup.ts';
import {checkEnvironment, environmentReady} from '../../core/environment.ts';
import {getEpisode, listRevisions} from '../../core/episodes.ts';
import {Project} from '../../core/project.ts';
import {ROOT} from '../../app/workspace.ts';
import {api, startApp, type Harness} from './harness.ts';

describe('the project routes', {timeout: 120_000}, () => {
  let h: Harness;
  let call: ReturnType<typeof api>;
  before(async () => { h = await startApp(); call = api(h); });
  after(async () => { rmSync(`${h.projectRoot}-backups`, {recursive: true, force: true}); await h.close(); });

  test('info names the project, where backups go and what is stored', async () => {
    const r = await call('GET', '/api/project');
    assert.equal(r.status, 200);
    assert.equal(r.json.root, h.projectRoot);
    assert.equal(r.json.backupsDir, `${h.projectRoot}-backups`);
    assert.ok(r.json.schemaVersion >= 4 && r.json.episodes >= 1);
    assert.deepEqual(r.json.backups, []);
  });

  test('a backup made from the running app is verified, listed, and restores to a different place with the same documents and revisions', async () => {
    const r = await call('POST', '/api/project/backup', {});
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.verified, true);
    assert.deepEqual(verifyBackup(r.json.dir).problems, []);
    assert.match(r.json.restoreCommand, /scripts\/project\.ts restore/);
    assert.equal((await call('GET', '/api/project')).json.backups.length, 1);
    const target = join(mkdtempSync(join(tmpdir(), 'studio-api-restore-')), 'elsewhere');
    try {
      restoreBackup(r.json.dir, target);
      const p = Project.open(target);
      try {
        assert.deepEqual(getEpisode(p, 'context-window'), getEpisode(h.project, 'context-window'));
        assert.deepEqual(listRevisions(p, 'context-window').map((x) => x.docHash), listRevisions(h.project, 'context-window').map((x) => x.docHash));
      } finally { p.close(); }
    } finally { rmSync(join(target, '..'), {recursive: true, force: true}); }
  });

  test('a backup that cannot be written says so plainly and changes nothing', async () => {
    const bad = `${h.projectRoot}-backups`;
    // a file where the folder must be makes the write impossible
    rmSync(bad, {recursive: true, force: true});
    (await import('node:fs')).writeFileSync(bad, 'in the way');
    const r = await call('POST', '/api/project/backup', {});
    assert.equal(r.status, 500);
    assert.match(r.json.message, /could not be made.*Nothing in the project was changed/);
    rmSync(bad, {force: true});
    assert.equal((await call('GET', '/api/session')).status, 200, 'the app is still fine');
  });

  test('writes need the page header like every other write', async () => {
    const r = await fetch(h.url('/api/project/backup'), {method: 'POST', headers: {cookie: `studio_token=${h.token}`}});
    assert.equal(r.status, 403);
  });

  test('the environment route reports each requirement with what it is needed for', async () => {
    const r = await call('GET', '/api/environment');
    assert.equal(r.status, 200);
    const ids = r.json.checks.map((c: {id: string}) => c.id);
    for (const id of ['node', 'ffmpeg', 'ffprobe', 'fonts', 'qwen-python', 'model-tts', 'disk']) assert.ok(ids.includes(id), id);
    assert.ok(r.json.checks.every((c: {label: string; need: string}) => c.label && c.need));
  });
});

test('a machine missing its pieces is told what is missing and how to fix it, and nothing is installed', () => {
  const empty = mkdtempSync(join(tmpdir(), 'studio-env-'));
  try {
    const checks = checkEnvironment(empty);
    const nm = checks.find((c) => c.id === 'node-modules')!;
    assert.equal(nm.ok, false);
    assert.match(nm.fix!, /npm ci/);
    assert.equal(checks.find((c) => c.id === 'qwen-python')!.ok, false);
    assert.match(checks.find((c) => c.id === 'model-tts')!.fix!, /never downloaded implicitly/);
    assert.equal(environmentReady(checks), false);
    assert.equal(existsSync(join(empty, 'node_modules')), false, 'nothing was created');
    assert.equal(environmentReady(checkEnvironment(ROOT), ['app']), true, 'this checkout satisfies the basic needs');
  } finally { rmSync(empty, {recursive: true, force: true}); }
});
