// Regression tests for the Phase 1 review findings. Every test works in its own temporary folder.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {afterEach, describe, test} from 'node:test';
import {DatabaseSync} from 'node:sqlite';
import {addReference, failJob, finishJob, pinArtifact, selectTake, startJob} from '../../core/artifacts.ts';
import {BackupVerifyError, createBackup, restoreBackup, validateManifest, verifyBackup} from '../../core/backup.ts';
import {adoptEpisode, createRevision, getEpisode, saveEpisode} from '../../core/episodes.ts';
import {executeCleanup, gc, planCleanup, planDigest, StalePlanError} from '../../core/gc.ts';
import {sha256, sha256File} from '../../core/hash.ts';
import {acquireLock, judgeHolder, makeProbe, ProjectLockedError, readLock, type ProcessInfo, type ProcessProbe} from '../../core/lock.ts';
import {Project, recoverFromBackup} from '../../core/project.ts';
import {mkTmp, plain, ROOT} from '../helpers.ts';
import {fakeBlob, newProject, setAllComponents, type TestProject} from './helpers.ts';

let t: TestProject | undefined;
afterEach(() => {
  t?.close();
  t = undefined;
});
const DAY = 86_400_000;

// ============================================================ 1. backup restore =======================================

/** A small real backup: database, one blob (approved reference), tracked files. */
function makeBackup(): {dir: string; parent: string} {
  t = newProject();
  adoptEpisode(t.p, 'episodes/join-fanout/episode.json');
  const ref = join(t.root, 'reference.wav');
  writeFileSync(ref, 'approved reference bytes');
  addReference(t.p, 'ref', ref);
  const parent = mkTmp('studio-rv-');
  const dir = join(parent, 'bk');
  createBackup(t.p, dir);
  return {dir, parent};
}
const readManifest = (dir: string) => JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
function writeManifest(dir: string, m: unknown) {
  const text = JSON.stringify(m, null, 1) + '\n';
  writeFileSync(join(dir, 'manifest.json'), text);
  writeFileSync(join(dir, 'manifest.json.sha256'), sha256(text) + '\n');
}
const rewrite = (dir: string, fn: (m: any) => void) => {
  const m = readManifest(dir);
  fn(m);
  writeManifest(dir, m);
};
/** After changing a file inside a backup, make its manifest entry (and so the checksum) agree with the new bytes. */
function refresh(dir: string, rel: string) {
  const s = sha256File(join(dir, rel));
  rewrite(dir, (m) => { const e = m.files.find((f: any) => f.path === rel); e.sha256 = s.hash; e.bytes = s.bytes; });
}
const entry = (kind: string, path: string, content = 'x') => ({kind, path, sha256: sha256(content), bytes: content.length});

function assertRefused(dir: string, parent: string, re: RegExp, opts: {verifyFails?: boolean} = {}) {
  const v = verifyBackup(dir);
  if (opts.verifyFails ?? true) {
    assert.equal(v.ok, false);
    assert.match(v.problems.join(' | '), re);
  }
  const target = join(parent, 'restored');
  assert.throws(() => restoreBackup(dir, target), (e: BackupVerifyError) => e instanceof BackupVerifyError && re.test(e.message));
  assert.equal(existsSync(target), false, 'nothing was published');
  assert.deepEqual(readdirSync(parent).filter((n) => n.includes('restoring')), [], 'no staging folder left');
  for (const stray of ['escape.txt', 'escape-sentinel.txt']) assert.equal(existsSync(join(parent, stray)), false, `${stray} must not appear outside the restore destination`);
}

describe('review finding 1: restore validates the whole manifest and the staged database before publishing', () => {
  test('the reported repro: "files/../escape-sentinel.txt" is rejected and nothing is written outside', () => {
    const parent = mkTmp('studio-rv-');
    const bk = join(parent, 'crafted');
    mkdirSync(join(bk, 'files'), {recursive: true});
    writeFileSync(join(bk, 'escape-sentinel.txt'), 'sentinel');
    const manifest = {format: 1, createdAt: 1, schemaVersion: 1, includeDrafts: false, files: [entry('file', 'files/../escape-sentinel.txt', 'sentinel')]};
    writeManifest(bk, manifest);
    assertRefused(bk, parent, /"\.\." segment/);
  });

  const cases: [string, (m: any) => void, RegExp][] = [
    ['an absolute path', (m) => m.files.push(entry('file', '/etc/hosts')), /absolute/],
    ['a Windows drive path', (m) => m.files.push(entry('file', 'C:/x')), /absolute/],
    ['a backslash', (m) => m.files.push(entry('file', 'files\\x')), /backslash/],
    ['a "." segment', (m) => m.files.push(entry('file', 'files/./x')), /"\." or "\.\." segment/],
    ['a ".." segment inside the path', (m) => m.files.push(entry('file', 'files/a/../../x')), /"\.\." segment/],
    ['an empty segment', (m) => m.files.push(entry('file', 'files//x')), /empty/],
    ['a trailing slash', (m) => m.files.push(entry('file', 'files/x/')), /trailing slash|ends with a slash/],
    ['an invalid kind', (m) => m.files.push(entry('symlink', 'files/x')), /invalid kind "symlink"/],
    ['a missing kind', (m) => m.files.push({path: 'files/x', sha256: sha256('x'), bytes: 1}), /invalid kind/],
    ['a file entry outside files/', (m) => m.files.push(entry('file', 'elsewhere/x')), /under files\//],
    ['a restore into .studio', (m) => m.files.push(entry('file', 'files/.studio/project.sqlite')), /may not be restored into/],
    ['a restore into .git', (m) => m.files.push(entry('file', 'files/.git/config')), /may not be restored into/],
    ['a blob whose name is not its hash', (m) => m.files.push(entry('blob', `blobs/aa/${'b'.repeat(64)}`)), /does not match its sha256/],
    ['a blob path of the wrong shape', (m) => m.files.push(entry('blob', 'blobs/x')), /blob path must be/],
    ['a database entry with another name', (m) => (m.files.find((f: any) => f.kind === 'db').path = 'other.sqlite'), /must be project\.sqlite/],
    ['no database entry', (m) => (m.files = m.files.filter((f: any) => f.kind !== 'db')), /exactly one database entry \(found 0\)/],
    ['two database entries', (m) => m.files.push({...m.files.find((f: any) => f.kind === 'db')}), /exactly one database entry \(found 2\)|duplicate path/],
    ['a duplicate path', (m) => m.files.push({...m.files.find((f: any) => f.kind === 'file')}), /duplicate path/],
    ['destinations that differ only by case', (m) => m.files.push(entry('file', 'files/Readme.txt'), entry('file', 'files/README.txt')), /collides/],
    ['a path that is both a file and a folder', (m) => m.files.push(entry('file', 'files/x'), entry('file', 'files/x/y')), /both a file and a folder/],
    ['a bad checksum format', (m) => m.files.push({...entry('file', 'files/x'), sha256: 'zz'}), /64 lowercase hex/],
    ['a negative size', (m) => m.files.push({...entry('file', 'files/x'), bytes: -1}), /non-negative integer/],
    ['an unsupported format', (m) => (m.format = 2), /unsupported manifest format/],
    ['an unsupported schema version', (m) => (m.schemaVersion = 99), /unsupported schema version 99/],
    ['a non-boolean includeDrafts', (m) => (m.includeDrafts = 'no'), /includeDrafts/],
  ];
  for (const [name, mutate, re] of cases) {
    test(`rejects ${name}, before any write`, () => {
      const {dir, parent} = makeBackup();
      rewrite(dir, mutate);
      assertRefused(dir, parent, re);
    });
  }

  test('rejects a manifest whose "files" is not an array, or is not an object at all', () => {
    const {dir, parent} = makeBackup();
    rewrite(dir, (m) => (m.files = {a: 1}));
    assertRefused(dir, parent, /files must be an array/);
    writeManifest(dir, ['not', 'an', 'object']);
    assertRefused(dir, parent, /not an object/);
  });

  test('a valid manifest from a real backup passes validation', () => {
    const {dir} = makeBackup();
    const v = validateManifest(readManifest(dir));
    assert.deepEqual(v.problems, []);
    assert.equal(verifyBackup(dir).ok, true);
  });

  test('rejects a file reached through a symbolic link, even when the bytes match the checksum', () => {
    const {dir, parent} = makeBackup();
    const rel = 'files/episodes/join-fanout/episode.json';
    const outside = join(parent, 'outside.json');
    writeFileSync(outside, readFileSync(join(dir, rel)));
    rmSync(join(dir, rel));
    symlinkSync(outside, join(dir, rel));
    assertRefused(dir, parent, /symbolic link/);
  });

  test('rejects a symlinked folder inside the backup', () => {
    const {dir, parent} = makeBackup();
    const outsideDir = join(parent, 'outside-dir');
    mkdirSync(join(outsideDir, 'join-fanout'), {recursive: true});
    writeFileSync(join(outsideDir, 'join-fanout/episode.json'), readFileSync(join(dir, 'files/episodes/join-fanout/episode.json')));
    rmSync(join(dir, 'files/episodes'), {recursive: true});
    symlinkSync(outsideDir, join(dir, 'files/episodes'));
    assertRefused(dir, parent, /symbolic link/);
  });

  test('rejects a symlinked manifest', () => {
    const {dir, parent} = makeBackup();
    const real = join(parent, 'real-manifest.json');
    writeFileSync(real, readFileSync(join(dir, 'manifest.json')));
    rmSync(join(dir, 'manifest.json'));
    symlinkSync(real, join(dir, 'manifest.json'));
    assertRefused(dir, parent, /manifest\.json goes through a symbolic link/);
  });

  test('a database that is not a database is refused after staging and nothing is published', () => {
    const {dir, parent} = makeBackup();
    writeFileSync(join(dir, 'project.sqlite'), 'this is not sqlite');
    refresh(dir, 'project.sqlite');
    assert.equal(verifyBackup(dir).ok, true, 'checksums agree; only the staged database check can catch this');
    assertRefused(dir, parent, /restored database/, {verifyFails: false});
  });

  test('a database from a newer schema is refused', () => {
    const {dir, parent} = makeBackup();
    const db = new DatabaseSync(join(dir, 'project.sqlite'));
    db.exec("UPDATE meta SET value='99' WHERE key='schema_version'");
    db.close();
    refresh(dir, 'project.sqlite');
    assertRefused(dir, parent, /unsupported schema version 99/, {verifyFails: false});
  });

  test('a database that references a blob the backup does not carry is refused', () => {
    const {dir, parent} = makeBackup();
    const blob = readManifest(dir).files.find((f: any) => f.kind === 'blob');
    rmSync(join(dir, blob.path));
    rewrite(dir, (m) => (m.files = m.files.filter((f: any) => f.path !== blob.path)));
    assertRefused(dir, parent, /references blob .* does not contain/, {verifyFails: false});
  });

  test('a backup that carries a blob the database does not know is refused', () => {
    const {dir, parent} = makeBackup();
    const h = sha256('stray');
    mkdirSync(join(dir, 'blobs', h.slice(0, 2)), {recursive: true});
    writeFileSync(join(dir, 'blobs', h.slice(0, 2), h), 'stray');
    rewrite(dir, (m) => m.files.push(entry('blob', `blobs/${h.slice(0, 2)}/${h}`, 'stray')));
    assertRefused(dir, parent, /does not know/, {verifyFails: false});
  });

  test('restoring a good backup still works end to end after the stricter checks', () => {
    const {dir, parent} = makeBackup();
    const target = join(parent, 'ok');
    const report = restoreBackup(dir, target);
    assert.deepEqual(report.missingBlobs, []);
    const p2 = Project.open(target);
    p2.close();
    assert.equal(existsSync(join(target, '.studio/lock')), false);
  });
});

// ============================================================ 2. cleanup with thinning ================================

/** The scenario from the review: 12 rounds, each with its own selected take and an automatic revision. */
function thinningScenario() {
  t = newProject();
  adoptEpisode(t.p, 'episodes/join-fanout/episode.json');
  setAllComponents(t.p, t.root);
  t.p.policy.checkpointOps = 1;
  const doc = plain(getEpisode(t.p, 'join-fanout'));
  const block = doc.narration.blocks[0].id;
  for (let i = 0; i < 12; i++) {
    saveEpisode(t.p, 'join-fanout', {...doc, title: `round ${i}`});
    const j = startJob(t.p, {episodeId: 'join-fanout', jobKind: 'tts.block', subject: block});
    const done = finishJob(t.p, j.jobId, {blobHash: fakeBlob(t.p, `take ${i}`), seed: i});
    selectTake(t.p, 'join-fanout', block, done.artifactId);
    createRevision(t.p, 'join-fanout', {kind: 'auto'});
    t.clock.advance(3_600_000);
  }
  t.clock.advance(60 * DAY);
  return {opts: {graceMs: DAY, thin: {keepRecent: 2, dailyDays: 30}}};
}
const counts = (p: Project) => ({
  revisions: Number(p.db.prepare('SELECT COUNT(*) c FROM revisions').get()!.c),
  blobs: Number(p.db.prepare('SELECT COUNT(*) c FROM blobs').get()!.c),
  artifacts: Number(p.db.prepare('SELECT COUNT(*) c FROM artifacts').get()!.c),
  files: readdirSync(join(p.blobDir)).length,
});

describe('review finding 2: cleanup is planned without changes, then executed exactly', () => {
  test('the reported repro: the dry run includes thinning and matches the real run exactly', () => {
    const {opts} = thinningScenario();
    const before = counts(t!.p);
    const dry = gc(t!.p, opts);
    assert.deepEqual(counts(t!.p), before, 'a dry run changes nothing');
    assert.ok(dry.thinnedIds.length > 5, 'thinning is part of the preview');
    assert.ok(Object.values(dry.thinned).flat().length === dry.thinnedIds.length);
    const real = gc(t!.p, {...opts, apply: true});
    assert.deepEqual(real.blobs, dry.blobs, 'same blobs');
    assert.deepEqual(real.thinned, dry.thinned, 'same revisions thinned');
    assert.deepEqual([real.orphanFiles, real.tmpEntries, real.freedBytes], [dry.orphanFiles, dry.tmpEntries, dry.freedBytes]);
    assert.equal(counts(t!.p).revisions, before.revisions - dry.thinnedIds.length);
    assert.equal(counts(t!.p).blobs, before.blobs - dry.blobs.length);
    assert.equal(planCleanup(t!.p, opts).blobs.length, 0, 'nothing further to do');
  });

  test('planning never mutates: not revisions, blobs, artifacts or files', () => {
    const {opts} = thinningScenario();
    const before = counts(t!.p);
    for (let i = 0; i < 3; i++) planCleanup(t!.p, opts);
    assert.deepEqual(counts(t!.p), before);
  });

  test('thinned revisions free only what no retained state still holds', () => {
    const {opts} = thinningScenario();
    const plan = planCleanup(t!.p, opts);
    const withoutThin = planCleanup(t!.p, {graceMs: DAY, thin: false});
    assert.ok(plan.blobs.length > withoutThin.blobs.length, 'thinning frees more than plain cleanup');
    const newest = t!.p.db.prepare("SELECT a.blob_hash h FROM current c JOIN artifacts a ON a.id=c.artifact_id WHERE c.kind='take'").get()!.h;
    assert.ok(!plan.blobs.some((b) => b.hash === newest), 'the current take is never planned for removal');
  });

  const changes: [string, (p: Project, root: string) => void][] = [
    ['an edit that creates a revision', (p) => { const d = plain(getEpisode(p, 'join-fanout')); saveEpisode(p, 'join-fanout', {...d, title: 'changed after preview'}, {kind: 'milestone'}); }],
    ['a new blob', (p) => { fakeBlob(p, 'arrived after the preview'); }],
    ['a pinned output', (p) => { const a = p.db.prepare('SELECT id FROM artifacts ORDER BY id LIMIT 1').get()!; pinArtifact(p, a.id as number); }],
    ['a new revision', (p) => { createRevision(p, 'join-fanout', {kind: 'milestone', label: 'late'}); }],
    ['a started job', (p) => { startJob(p, {episodeId: 'join-fanout', jobKind: 'timing.build'}); }],
    ['an approved reference', (p, root) => { writeFileSync(join(root, 'late.wav'), 'late'); addReference(p, 'late', join(root, 'late.wav')); }],
    ['a file appearing in temp', (p) => { writeFileSync(join(p.tmpDir, 'new-entry'), 'x'); }],
  ];
  for (const [name, change] of changes) {
    test(`a plan is refused if the project changed after the preview: ${name}`, () => {
      const {opts} = thinningScenario();
      const plan = planCleanup(t!.p, opts);
      change(t!.p, t!.root);
      const before = counts(t!.p);
      assert.throws(() => executeCleanup(t!.p, plan), StalePlanError);
      assert.throws(() => gc(t!.p, {apply: true, plan}), /Run a new preview/);
      assert.deepEqual(counts(t!.p), before, 'nothing was removed or thinned');
      const fresh = planCleanup(t!.p, opts);
      assert.equal(executeCleanup(t!.p, fresh).applied, true, 'a refreshed preview runs');
    });
  }

  test('a running job that ends after the preview (its snapshot stops protecting blobs) makes the plan stale', () => {
    const {opts} = thinningScenario();
    const job = startJob(t!.p, {episodeId: 'join-fanout', jobKind: 'timing.build'});
    const plan = planCleanup(t!.p, opts);
    failJob(t!.p, job.jobId, 'worker crashed');
    assert.throws(() => executeCleanup(t!.p, plan), StalePlanError);
  });

  test('an unchanged project executes the previewed plan even if time has passed', () => {
    const {opts} = thinningScenario();
    const plan = planCleanup(t!.p, opts);
    t!.clock.advance(30 * DAY);
    const real = executeCleanup(t!.p, plan);
    assert.deepEqual(real.thinned, plan.thinned);
    assert.equal(real.blobs.length, plan.blobs.length);
  });

  test('the plan digest identifies exactly what will run', () => {
    const {opts} = thinningScenario();
    const a = planCleanup(t!.p, opts);
    t!.clock.advance(1000);
    assert.equal(planDigest(planCleanup(t!.p, opts)), planDigest(a), 'same work, same digest');
    fakeBlob(t!.p, 'older than the grace period by the time it matters');
    t!.clock.advance(5 * DAY);
    assert.notEqual(planDigest(planCleanup(t!.p, opts)), planDigest(a), 'different work, different digest');
  });

  test('the CLI refuses --apply without a digest, and with a stale one', () => {
    const {opts} = thinningScenario();
    void opts;
    const root = t!.root;
    t!.p.close();
    const run = (...a: string[]) => spawnSyncNode(['scripts/project.ts', 'gc', ...a, '--root', root, '--grace-days', '1', '--thin', '--keep-recent', '2']);
    const preview = JSON.parse(run().stdout);
    assert.equal(preview.applied, false);
    assert.ok(preview.thinned && Object.keys(preview.thinned).length);
    const noDigest = run('--apply');
    assert.notEqual(noDigest.status, 0);
    assert.match(noDigest.stderr, /--expect/);
    const stale = run('--apply', '--expect', 'f'.repeat(64));
    assert.notEqual(stale.status, 0);
    assert.match(stale.stderr, /new preview/);
    const done = run('--apply', '--expect', preview.digest);
    assert.equal(done.status, 0, done.stderr);
    assert.equal(JSON.parse(done.stdout).applied, true);
    t!.p = Project.open(root, {now: t!.clock.now});
  });
});

const spawnSyncNode = (args: string[]) => spawnSync(process.execPath, args, {cwd: ROOT, encoding: 'utf8'});

// ============================================================ 3. automatic recovery ===================================

function projectWithBackups() {
  t = newProject();
  adoptEpisode(t.p, 'episodes/join-fanout/episode.json');
  const doc = plain(getEpisode(t.p, 'join-fanout'));
  saveEpisode(t.p, 'join-fanout', {...doc, title: 'in the good backup'});
  const good = t.p.autoBackup('good');
  saveEpisode(t.p, 'join-fanout', {...doc, title: 'after the backup'});
  t.p.close();
  const dir = join(t.root, '.studio');
  for (const ext of ['-wal', '-shm']) rmSync(join(dir, 'project.sqlite' + ext), {force: true});
  writeFileSync(join(dir, 'project.sqlite'), 'damaged current database');
  return {dir, good};
}
const bytes = (f: string) => readFileSync(f);

describe('review finding 3: recovery skips unusable backups and touches nothing until one is validated', () => {
  test('the reported repro: a newer backup of invalid bytes is skipped and the valid older one is used', () => {
    const {dir, good} = projectWithBackups();
    const bad = join(dir, 'backups/db-9999999999999-invalid.sqlite');
    writeFileSync(bad, 'invalid database');
    const r = recoverFromBackup(t!.root);
    assert.equal(r.restoredFrom, good);
    assert.deepEqual(r.skipped.map((s) => s.path), [bad]);
    assert.match(r.skipped[0].reason, /not a database/);
    t!.p = Project.open(t!.root, {now: t!.clock.now});
    assert.equal(getEpisode(t!.p, 'join-fanout').title, 'in the good backup');
    assert.equal(bytes(bad).toString(), 'invalid database', 'a skipped candidate is left exactly as it was');
    assert.ok(readFileSync(r.movedAside).toString() === 'damaged current database', 'the damaged database is kept aside');
  });

  test('several unusable candidates (garbage, empty, wrong schema, directory) are all skipped, newest first', () => {
    const {dir, good} = projectWithBackups();
    const b = join(dir, 'backups');
    writeFileSync(join(b, 'db-9999999999995-garbage.sqlite'), 'garbage');
    writeFileSync(join(b, 'db-9999999999996-empty.sqlite'), '');
    mkdirSync(join(b, 'db-9999999999997-dir.sqlite'));
    const wrong = join(b, 'db-9999999999998-newer-schema.sqlite');
    rmSync(wrong, {force: true});
    const db = new DatabaseSync(wrong);
    db.exec("PRAGMA journal_mode=DELETE; CREATE TABLE meta(key TEXT PRIMARY KEY, value TEXT); INSERT INTO meta VALUES('schema_version','99')");
    db.close();
    const r = recoverFromBackup(t!.root);
    assert.equal(r.restoredFrom, good);
    assert.equal(r.skipped.length, 4);
    assert.ok(r.skipped.some((s) => /unsupported schema version 99/.test(s.reason)));
  });

  test('backups are ordered by their timestamp, not by their text', () => {
    const {dir} = projectWithBackups();
    const b = join(dir, 'backups');
    for (const f of readdirSync(b)) rmSync(join(b, f));
    const mk = (name: string, title: string) => {
      const d = new DatabaseSync(join(b, name));
      d.exec(`PRAGMA journal_mode=DELETE; CREATE TABLE meta(key TEXT PRIMARY KEY, value TEXT); INSERT INTO meta VALUES('schema_version','1'); INSERT INTO meta VALUES('marker','${title}')`);
      d.close();
    };
    mk('db-9-old.sqlite', 'nine');
    mk('db-10-new.sqlite', 'ten');
    const r = recoverFromBackup(t!.root);
    assert.match(r.restoredFrom, /db-10-new/);
  });

  test('when no candidate is usable the current database is left exactly as it was, with no leftovers', () => {
    const {dir} = projectWithBackups();
    const b = join(dir, 'backups');
    for (const f of readdirSync(b)) writeFileSync(join(b, f), 'ruined');
    const before = bytes(join(dir, 'project.sqlite'));
    assert.throws(() => recoverFromBackup(t!.root), /no usable automatic backup found \(skipped: /);
    assert.deepEqual(bytes(join(dir, 'project.sqlite')), before);
    assert.deepEqual(readdirSync(dir).filter((n) => /corrupt|recovering/.test(n)), []);
  });

  test('a failure while publishing leaves the current database untouched', () => {
    const {dir} = projectWithBackups();
    const before = bytes(join(dir, 'project.sqlite'));
    chmodSync(dir, 0o555); // cannot create the staged copy or rename anything
    try {
      assert.throws(() => recoverFromBackup(t!.root), /no usable automatic backup/);
    } finally {
      chmodSync(dir, 0o755);
    }
    assert.deepEqual(bytes(join(dir, 'project.sqlite')), before);
    assert.deepEqual(readdirSync(dir).filter((n) => /corrupt|recovering/.test(n)), []);
  });

  test('backups are opened read-only: probing them creates no journal files and does not change them', () => {
    const {dir, good} = projectWithBackups();
    const before = sha256File(good).hash;
    recoverFromBackup(t!.root);
    assert.equal(sha256File(good).hash, before);
    assert.deepEqual(readdirSync(join(dir, 'backups')).filter((n) => /-wal$|-shm$|-journal$/.test(n)), []);
  });

  test('handles are released: many failed and successful recoveries leave no open database files', () => {
    const {dir} = projectWithBackups();
    for (let i = 0; i < 40; i++) writeFileSync(join(dir, 'backups', `db-99999999999${String(i).padStart(2, '0')}-bad.sqlite`), 'x'.repeat(i + 1));
    const r = recoverFromBackup(t!.root);
    assert.equal(r.skipped.length, 40);
    const lsof = spawnSync('lsof', ['-p', String(process.pid)], {encoding: 'utf8'});
    if (lsof.status === 0) assert.ok(!lsof.stdout.split('\n').some((l) => l.includes(join(dir, 'backups'))), 'a backup file is still open');
    rmSync(join(dir, 'backups'), {recursive: true}); // would fail on some platforms if handles leaked
  });

  test('recovery refuses while the project is open or its holder is unknown', () => {
    t = newProject();
    assert.throws(() => recoverFromBackup(t!.root), ProjectLockedError);
  });
});

// ============================================================ 4. single-writer lock ===================================

const alive = (started: string | null, reason?: string): ProcessInfo => ({state: 'alive', started, ...(reason ? {reason} : {})});
const err = (code: string) => Object.assign(new Error(code), {code});
const fixedProbe = (info: ProcessInfo): ProcessProbe => () => info;

describe('review finding 4: the lock is taken over only from a confirmed-dead holder', () => {
  describe('the process probe', () => {
    const probe = (kill: () => void, ps: () => string) => makeProbe({kill, ps});
    test('ESRCH from the liveness check is the only way to be "dead"', () => {
      assert.deepEqual(probe(() => { throw err('ESRCH'); }, () => 'unused')(123), {state: 'dead'});
    });
    test('alive with a start time when both checks work', () => {
      assert.deepEqual(probe(() => {}, () => '  Mon Oct 18 10:00:00 2026\n')(123), {state: 'alive', started: 'Mon Oct 18 10:00:00 2026'});
    });
    test('EPERM means the process exists but belongs to someone else: alive, never dead', () => {
      assert.deepEqual(probe(() => { throw err('EPERM'); }, () => 'T')(123), {state: 'alive', started: 'T'});
    });
    for (const [name, ps] of [
      ['ps is blocked (EACCES)', () => { throw err('EACCES'); }],
      ['ps is missing (ENOENT)', () => { throw err('ENOENT'); }],
      ['ps times out', () => { throw err('ETIMEDOUT'); }],
      ['ps prints nothing', () => ''],
      ['ps prints only whitespace', () => ' \n'],
    ] as [string, () => string][]) {
      test(`unavailable inspection (${name}) is "alive, start unknown", not dead`, () => {
        const r = probe(() => {}, ps)(123);
        assert.equal(r.state, 'alive');
        assert.equal((r as any).started, null);
        assert.ok((r as any).reason);
      });
    }
    test('an unexpected error from the liveness check is also unknown, not dead', () => {
      const r = probe(() => { throw err('EINVAL'); }, () => 'T')(123);
      assert.deepEqual([r.state, (r as any).started], ['alive', null]);
    });
  });

  describe('the verdict', () => {
    const rec = (started: string | null) => ({pid: 7, started});
    test('dead holder: stale', () => assert.equal(judgeHolder(rec('T'), {state: 'dead'}).kind, 'stale'));
    test('same start time: live', () => assert.equal(judgeHolder(rec('T'), alive('T')).kind, 'live'));
    test('different start time (pid reused): stale', () => assert.equal(judgeHolder(rec('T'), alive('U')).kind, 'stale'));
    test('unknown current start: unknown', () => assert.equal(judgeHolder(rec('T'), alive(null, 'blocked')).kind, 'unknown'));
    test('unrecorded start time in the lock: unknown', () => assert.equal(judgeHolder(rec(null), alive('T')).kind, 'unknown'));
    test('nothing known on either side: unknown', () => assert.equal(judgeHolder(rec(null), alive(null)).kind, 'unknown'));
  });

  const lockFile = () => join(t!.root, '.studio/lock');
  const closeProject = () => t!.p.close();

  test('REGRESSION: with process inspection unavailable a second open is refused (the reported failure)', () => {
    t = newProject({seed: false});
    closeProject();
    const blocked = fixedProbe(alive(null, 'process inspection unavailable (EACCES)'));
    const first = Project.open(t.root, {probe: blocked});
    try {
      assert.equal(readLock(lockFile())!.started, null, 'the first writer could not record its start time');
      assert.throws(() => Project.open(t!.root, {probe: blocked}), (e: Error) => e instanceof ProjectLockedError && /cannot tell whether another process holds this project/.test(e.message));
      assert.ok(existsSync(lockFile()), 'the lock was not deleted by the refused open');
      assert.equal(readLock(lockFile())!.pid, process.pid);
    } finally {
      first.close();
    }
    t.p = Project.open(t.root, {now: t.clock.now});
  });

  test('a lock from another process whose liveness cannot be inspected is respected, not removed', () => {
    t = newProject({seed: false});
    closeProject();
    writeFileSync(lockFile(), JSON.stringify({pid: 424242, started: 'Mon Jan  1 00:00:00 2001'}));
    for (const info of [alive(null, 'ps blocked'), alive(null)]) {
      assert.throws(() => Project.open(t!.root, {probe: fixedProbe(info)}), ProjectLockedError);
      assert.equal(readLock(lockFile())!.pid, 424242, 'lock untouched');
    }
    rmSync(lockFile());
    t.p = Project.open(t.root, {now: t.clock.now});
  });

  test('a lock that did not record its start time is respected while its holder exists', () => {
    t = newProject({seed: false});
    closeProject();
    writeFileSync(lockFile(), JSON.stringify({pid: 424242, started: null}));
    assert.throws(() => Project.open(t!.root, {probe: fixedProbe(alive('Mon Oct 18 10:00:00 2026'))}), /cannot tell/);
    rmSync(lockFile());
    t.p = Project.open(t.root, {now: t.clock.now});
  });

  test('an unreadable or malformed lock file is never assumed stale', () => {
    t = newProject({seed: false});
    closeProject();
    for (const junk of ['', 'garbage', '{"pid":"x"}', '{"pid":-1,"started":null}', '{"pid":5}']) {
      writeFileSync(lockFile(), junk);
      assert.throws(() => Project.open(t!.root, {probe: fixedProbe({state: 'dead'})}), (e: Error) => e instanceof ProjectLockedError && /unreadable/.test(e.message), `lock content ${JSON.stringify(junk)}`);
      assert.equal(readFileSync(lockFile(), 'utf8'), junk);
    }
    rmSync(lockFile());
    t.p = Project.open(t.root, {now: t.clock.now});
  });

  test('a confirmed-dead holder is taken over', () => {
    t = newProject({seed: false});
    closeProject();
    writeFileSync(lockFile(), JSON.stringify({pid: 424242, started: 'T'}));
    t.p = Project.open(t.root, {probe: fixedProbe({state: 'dead'}), now: t.clock.now});
    assert.equal(readLock(lockFile())!.pid, process.pid);
  });

  test('a pid that now belongs to a different process (different start time) is taken over', () => {
    t = newProject({seed: false});
    closeProject();
    writeFileSync(lockFile(), JSON.stringify({pid: 424242, started: 'Mon Jan  1 00:00:00 2001'}));
    t.p = Project.open(t.root, {probe: fixedProbe(alive('Tue Feb  2 00:00:00 2010')), now: t.clock.now});
    assert.equal(readLock(lockFile())!.pid, process.pid);
  });

  test('a live holder with a matching start time gets the "open in another process" message', () => {
    t = newProject({seed: false});
    closeProject();
    writeFileSync(lockFile(), JSON.stringify({pid: 424242, started: 'T'}));
    assert.throws(() => Project.open(t!.root, {probe: fixedProbe(alive('T'))}), /open in another process \(pid 424242\)/);
    rmSync(lockFile());
    t.p = Project.open(t.root, {now: t.clock.now});
  });

  test('the lock file is created whole and atomically (no temporary files are left behind)', () => {
    t = newProject({seed: false});
    assert.deepEqual(readdirSync(join(t.root, '.studio')).filter((n) => n.endsWith('.tmp')), []);
    assert.equal(readLock(lockFile())!.pid, process.pid);
  });

  test('two acquisitions racing for the same lock: exactly one wins', () => {
    const dir = mkTmp('studio-lock-');
    const path = join(dir, 'lock');
    const probe = fixedProbe(alive('T'));
    acquireLock(path, probe);
    assert.throws(() => acquireLock(path, probe), ProjectLockedError);
  });

  test('recovery from a damaged database also refuses when the holder cannot be inspected', () => {
    t = newProject({seed: false});
    closeProject();
    writeFileSync(lockFile(), JSON.stringify({pid: 424242, started: 'T'}));
    assert.throws(() => recoverFromBackup(t!.root, {probe: fixedProbe(alive(null, 'ps blocked'))}), /cannot tell whether the project is in use/);
    rmSync(lockFile());
    t.p = Project.open(t.root, {now: t.clock.now});
  });

  test('a real second process holding the project is detected without relying on ps in the test', () => {
    t = newProject({seed: false});
    closeProject();
    const child = spawnSync('sleep', ['0']); // a real, already finished process: its pid is confirmed gone
    assert.equal(child.status, 0);
    writeFileSync(lockFile(), JSON.stringify({pid: child.pid, started: 'T'}));
    t.p = Project.open(t.root, {now: t.clock.now}); // real probe: kill(pid, 0) says ESRCH
    assert.equal(readLock(lockFile())!.pid, process.pid);
  });
});

