import assert from 'node:assert/strict';
import {spawn, spawnSync} from 'node:child_process';
import {existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {afterEach, describe, test} from 'node:test';
import {startJob, statusReport} from '../../core/artifacts.ts';
import {blobPath, verifyAll} from '../../core/blobs.ts';
import {adoptEpisode, getEpisode, listEpisodes, saveEpisode} from '../../core/episodes.ts';
import {CorruptProjectError, NotAProjectError, Project, ProjectLockedError, ProjectTooNewError, recoverFromBackup} from '../../core/project.ts';
import {DatabaseSync} from 'node:sqlite';
import {SCHEMA_VERSION} from '../../core/db.ts';
import {assertTemp, buildAll, newProject, setAllComponents, tempRoot, type TestProject} from './helpers.ts';

let t: TestProject;
afterEach(() => t?.close());
const reopen = () => {
  t.p.close();
  t.p = Project.open(t.root, {now: t.clock.now});
};

describe('single writer', () => {
  test('a second open of a live project is refused', () => {
    t = newProject();
    assert.throws(() => Project.open(t.root), ProjectLockedError);
  });

  test('a lock left by a dead process is taken over (a reaped process, so no race and no ps needed)', () => {
    t = newProject();
    const dead = spawnSync(process.execPath, ['-e', '0']);
    assert.equal(dead.status, 0);
    t.p.close();
    writeFileSync(join(t.root, '.studio/lock'), JSON.stringify({pid: dead.pid, started: 'Mon Jan  1 00:00:00 2001'}));
    t.p = Project.open(t.root, {now: t.clock.now});
    assert.ok(t.p);
  });

  test('a lock held by another LIVE process is respected (probe injected, so the test does not depend on ps)', () => {
    t = newProject();
    t.p.close();
    writeFileSync(join(t.root, '.studio/lock'), JSON.stringify({pid: 424242, started: 'Mon Oct 18 10:00:00 2026'}));
    const live = () => ({state: 'alive' as const, started: 'Mon Oct 18 10:00:00 2026'});
    assert.throws(() => Project.open(t.root, {probe: live}), ProjectLockedError);
    rmSync(join(t.root, '.studio/lock'), {force: true});
    t.p = Project.open(t.root, {now: t.clock.now});
  });

  test('opening a folder that is not a project fails clearly instead of creating one', () => {
    const root = tempRoot();
    assert.throws(() => Project.open(root), NotAProjectError);
  });
});

describe('recovery protocol on open', () => {
  test('running jobs become failed(interrupted), their workspaces are deleted, and nothing is left "running"', () => {
    t = newProject();
    adoptEpisode(t.p, 'episodes/join-fanout/episode.json');
    const j = startJob(t.p, {episodeId: 'join-fanout', jobKind: 'timing.build'});
    mkdirSync(join(t.p.tmpDir, String(j.jobId)), {recursive: true});
    writeFileSync(join(t.p.tmpDir, String(j.jobId), 'partial.wav'), 'half');
    reopen();
    assert.deepEqual(t.p.recovery.interruptedJobs, [j.jobId]);
    const row = t.p.db.prepare('SELECT state, error FROM jobs WHERE id=?').get(j.jobId)!;
    assert.deepEqual([row.state, row.error], ['failed', 'interrupted']);
    assert.equal(existsSync(join(t.p.tmpDir, String(j.jobId))), false);
    assert.equal(t.p.db.prepare("SELECT COUNT(*) c FROM jobs WHERE state='running'").get()!.c, 0);
  });

  test('a missing blob is reported, marks the output missing, and stales what was built on it', () => {
    t = newProject();
    adoptEpisode(t.p, 'episodes/join-fanout/episode.json');
    setAllComponents(t.p, t.root);
    buildAll(t.p, 'join-fanout');
    const h = t.p.db.prepare("SELECT a.blob_hash h FROM current c JOIN artifacts a ON a.id=c.artifact_id WHERE c.kind='timing'").get()!.h as string;
    rmSync(blobPath(t.p, h));
    reopen();
    assert.deepEqual(t.p.recovery.missingBlobs, [h]);
    const s = statusReport(t.p, 'join-fanout');
    assert.equal(s.timing.status, 'missing');
    assert.equal(s.render.final.status, 'stale');
  });

  test('UI state (open episode, panel sizes) survives a restart', () => {
    t = newProject({seed: false});
    t.p.setUiState('editor', JSON.stringify({outline: 'collapsed', timelineHeight: 250}));
    reopen();
    assert.deepEqual(JSON.parse(t.p.getUiState('editor')!), {outline: 'collapsed', timelineHeight: 250});
  });

  test('a project from a newer build is refused', () => {
    t = newProject({seed: false});
    t.p.db.exec("UPDATE meta SET value='99' WHERE key='schema_version'");
    t.p.close();
    assert.throws(() => Project.open(t.root), ProjectTooNewError);
    const db = new DatabaseSync(join(t.root, '.studio/project.sqlite'));
    db.exec(`UPDATE meta SET value='${SCHEMA_VERSION}' WHERE key='schema_version'`);
    db.close();
    t.p = Project.open(t.root, {now: t.clock.now});
  });
});

describe('automatic database backups', () => {
  test('a scheduled backup is taken when the last one is old, and only the newest few are kept', () => {
    t = newProject({seed: false});
    for (let i = 0; i < 13; i++) {
      t.clock.advance(7 * 3600_000);
      reopen();
    }
    assert.ok(Project.listBackups(t.p.dir).length <= 10);
    assert.ok(Project.listBackups(t.p.dir).length >= 1);
  });

  test('a backup is a complete, openable database', () => {
    t = newProject();
    adoptEpisode(t.p, 'episodes/join-fanout/episode.json');
    const file = t.p.autoBackup('manual');
    const root2 = tempRoot();
    mkdirSync(join(root2, '.studio/backups'), {recursive: true});
    mkdirSync(join(root2, '.studio/blobs'), {recursive: true});
    mkdirSync(join(root2, '.studio/tmp'), {recursive: true});
    writeFileSync(join(root2, '.studio/project.sqlite'), readFileSync(file));
    const p2 = Project.open(root2);
    assert.deepEqual(listEpisodes(p2), ['join-fanout']);
    p2.close();
  });
});

describe('a damaged database', () => {
  test('is detected on open with a clear error; recovery restores the newest good backup and keeps the damaged file aside', () => {
    t = newProject();
    adoptEpisode(t.p, 'episodes/join-fanout/episode.json');
    const doc = JSON.parse(JSON.stringify(getEpisode(t.p, 'join-fanout')));
    saveEpisode(t.p, 'join-fanout', {...doc, title: 'in the backup'});
    t.p.autoBackup('manual');
    saveEpisode(t.p, 'join-fanout', {...doc, title: 'after the backup'});
    t.p.close();
    const db = join(t.root, '.studio/project.sqlite');
    for (const ext of ['-wal', '-shm']) rmSync(db + ext, {force: true});
    writeFileSync(db, Buffer.concat([Buffer.from('not a sqlite database at all, '), readFileSync(db).subarray(30)]));
    let err: unknown;
    try { Project.open(t.root); } catch (e) { err = e; }
    assert.ok(err instanceof CorruptProjectError);
    assert.ok((err as CorruptProjectError).backups.length >= 1);
    assert.match((err as Error).message, /integrity check/);
    const r = recoverFromBackup(t.root);
    assert.ok(existsSync(r.movedAside), 'damaged database kept, not deleted');
    t.p = Project.open(t.root, {now: t.clock.now});
    assert.equal(getEpisode(t.p, 'join-fanout').title, 'in the backup');
  });

  test('recovery refuses when no usable backup exists', () => {
    t = newProject({seed: false});
    t.p.close();
    for (const f of readdirSync(join(t.root, '.studio/backups'))) rmSync(join(t.root, '.studio/backups', f));
    assert.throws(() => recoverFromBackup(t.root), /no usable automatic backup/);
    t.p = Project.open(t.root, {now: t.clock.now});
  });
});

describe('kill -9 during a burst of edits (separate process, temporary project)', () => {
  test('every edit reported as saved survives; no corrupt state; no orphan references; projection never mistaken for an external edit', async () => {
    const root = tempRoot('studio-kill-');
    assertTemp(root);
    const child = join(import.meta.dirname, 'kill-child.ts');
    let next = 1;
    let totalReported = 0;
    for (let round = 0; round < 6; round++) {
      const killAfter = 6 + ((round * 7) % 31); // lines to wait for before the kill, varied per round
      const reported = await new Promise<number>((resolve, reject) => {
        const c = spawn(process.execPath, [child, root, String(next)], {stdio: ['ignore', 'pipe', 'inherit']});
        let buf = '';
        let ready = false;
        let saved = 0;
        let last = next - 1;
        c.stdout.on('data', (d: Buffer) => {
          buf += d.toString();
          const lines = buf.split('\n');
          buf = lines.pop()!;
          for (const l of lines) {
            if (l === 'READY') ready = true;
            const m = /^saved (\d+) /.exec(l);
            if (m) { saved++; last = Number(m[1]); }
          }
          if (ready && saved >= killAfter) c.kill('SIGKILL');
        });
        c.on('error', reject);
        c.on('exit', () => resolve(last));
      });
      totalReported += reported - (next - 1);
      const p = Project.open(root);
      try {
        const integrity = p.db.prepare('PRAGMA integrity_check').get()!.integrity_check;
        assert.equal(integrity, 'ok');
        const title = getEpisode(p, 'join-fanout').title;
        const n = Number(/^edit (\d+)$/.exec(title)![1]);
        assert.ok(n >= reported, `round ${round}: reported ${reported} saved but the project is at ${n}`);
        const v = verifyAll(p);
        assert.deepEqual([v.missing, v.corrupt], [[], []]);
        for (const a of p.recovery.projections) assert.notEqual(a.action, 'external', 'our own half-finished write must not look like a hand edit');
        JSON.parse(readFileSync(join(root, 'episodes/join-fanout/episode.json'), 'utf8')); // a whole file, never half of one
        for (const r of p.db.prepare('SELECT blob_hash FROM revision_refs').all()) assert.ok(existsSync(blobPath(p, r.blob_hash as string)));
        next = n + 1;
      } finally {
        p.close();
      }
    }
    assert.ok(totalReported >= 30, `only ${totalReported} edits were reported across the rounds`);
    rmSync(root, {recursive: true, force: true});
  });
});

