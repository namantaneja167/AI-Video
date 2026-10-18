import assert from 'node:assert/strict';
import {chmodSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {afterEach, describe, test} from 'node:test';
import {
  addReference, approvalStatus, ApprovalError, approve, finishJob, getApprovedFile, getReference, listArtifacts, pinArtifact, selectTake, startJob, statusReport,
} from '../../core/artifacts.ts';
import {BackupError, BackupVerifyError, createBackup, RestoreTargetError, restoreBackup, verifyBackup} from '../../core/backup.ts';
import {blobPath, verifyAll} from '../../core/blobs.ts';
import {adoptEpisode, createRevision, getEpisode, listRevisions, saveEpisode} from '../../core/episodes.ts';
import {gc, reachableBlobs, thinRevisions} from '../../core/gc.ts';
import {sha256, sha256File} from '../../core/hash.ts';
import {Project} from '../../core/project.ts';
import {captureFileSet, currentRows} from '../../core/state.ts';
import {ROOT, plain} from '../helpers.ts';
import {assertTemp, buildAll, fakeBlob, newProject, setAllComponents, SIGNED, tempRoot, type TestProject} from './helpers.ts';

let t: TestProject;
const extra: string[] = [];
afterEach(() => {
  t?.close();
  for (const d of extra.splice(0)) rmSync(d, {recursive: true, force: true});
});
const tmp = () => {
  const d = tempRoot('studio-bk-');
  extra.push(d);
  return d;
};
const DAY = 86_400_000;
const REAL_REF = join(ROOT, 'reference/pip-voice/approved-v1');

/** A project with revisions, selected takes, an approved final render, an approved reference and some garbage. */
function rich() {
  t = newProject();
  // real approved voice reference, copied (never modified) into the temp project as tracked source material
  cpSync(REAL_REF, join(t.root, 'reference/pip-voice/approved-v1'), {recursive: true});
  mkdirSync(join(t.root, 'public/assets'), {recursive: true});
  writeFileSync(join(t.root, 'public/assets/a.png'), 'png-bytes');
  adoptEpisode(t.p, 'episodes/join-fanout/episode.json');
  setAllComponents(t.p, t.root);
  const ids = buildAll(t.p, 'join-fanout', 'a');
  createRevision(t.p, 'join-fanout', {kind: 'milestone', label: 'before approval'});
  const approval = approve(t.p, 'join-fanout', SIGNED);
  const ref = addReference(t.p, 'pip-voice-v1', join(t.root, 'reference/pip-voice/approved-v1/pip_qwen_B-US_general_american.wav'), {voice: 'B-US'});
  // later work: new outputs, so older ones become superseded and approval becomes void
  const doc = plain(getEpisode(t.p, 'join-fanout'));
  saveEpisode(t.p, 'join-fanout', {...doc, chapters: [{...doc.chapters[0], label: 'Newer'}, ...doc.chapters.slice(1)]});
  buildAll(t.p, 'join-fanout', 'b');
  const garbage = [fakeBlob(t.p, 'unreferenced one'), fakeBlob(t.p, 'unreferenced two')];
  return {ids, approval, ref, garbage};
}

const norm = (p: Project, opts: {drafts: boolean}) => {
  const q = (sql: string) => p.db.prepare(sql).all().map((r) => ({...r}));
  const draftArt = opts.drafts ? '' : " AND NOT (a.kind='render' AND a.subject='draft')";
  const draftRole = opts.drafts ? '' : " AND rr.role <> 'render:draft'";
  return {
    revisions: q('SELECT episode_id, number, kind, label, doc_hash FROM revisions ORDER BY episode_id, number'),
    revisionRefs: q(`SELECT r.episode_id, r.number, rr.role, rr.blob_hash FROM revision_refs rr JOIN revisions r ON r.id=rr.revision_id WHERE 1=1${draftRole} ORDER BY r.number, rr.role`),
    current: q(`SELECT c.kind, c.subject, a.inputs_hash, a.blob_hash, a.meta_json FROM current c JOIN artifacts a ON a.id=c.artifact_id WHERE 1=1${draftArt} ORDER BY c.kind, c.subject`),
    approvals: q('SELECT id, episode_id, file_sha256, parts_json, inputs_hash, revision_number, signoffs_json FROM approvals ORDER BY id'),
    approved: q('SELECT * FROM approved'),
    refs: q('SELECT name, blob_hash, meta_json FROM refs'),
    components: q('SELECT scope, name, hash, value_json, blob_hash FROM components ORDER BY scope, name'),
    filesets: q('SELECT manifest_hash, path, blob_hash FROM fileset_files ORDER BY manifest_hash, path'),
  };
};

describe('backup', () => {
  test('is a self-contained, checksummed folder with the approved reference, selected takes, approved render and source files', () => {
    const {approval, ref, garbage} = rich();
    const dest = join(tmp(), 'bk');
    const sum = createBackup(t.p, dest);
    const v = verifyBackup(dest);
    assert.deepEqual(v.problems, []);
    const have = new Set(v.manifest!.files.filter((f) => f.kind === 'blob').map((f) => f.path.split('/').pop()));
    assert.ok(have.has(ref.hash), 'approved reference');
    const approved = t.p.db.prepare('SELECT file_sha256 f FROM approvals WHERE id=?').get(approval)!.f as string;
    assert.ok(have.has(approved), 'approved render');
    for (const r of currentRows(t.p, 'join-fanout').filter((r) => r.kind === 'take')) assert.ok(have.has(r.blob_hash), `selected take ${r.subject}`);
    for (const g of garbage) assert.ok(!have.has(g), 'unreferenced cache is never included');
    const files = v.manifest!.files.filter((f) => f.kind === 'file').map((f) => f.path);
    assert.ok(files.includes('files/episodes/join-fanout/episode.json'));
    assert.ok(files.includes('files/reference/pip-voice/approved-v1/approved.json'));
    assert.ok(files.includes('files/public/assets/a.png'));
    assert.ok(sum.blobs > 5);
  });

  test('restore into an empty folder reproduces revisions, selections, approvals, references, components and artifact metadata exactly', () => {
    const {approval, ref} = rich();
    const before = norm(t.p, {drafts: false});
    const dest = join(tmp(), 'bk');
    createBackup(t.p, dest);
    const target = join(tmp(), 'restored');
    const report = restoreBackup(dest, target);
    assert.deepEqual(report.missingBlobs, []);
    const p2 = Project.open(target);
    try {
      assert.deepEqual(norm(p2, {drafts: true}), before);
      assert.deepEqual(verifyAll(p2), {checked: verifyAll(p2).checked, missing: [], corrupt: [], orphanFiles: []});
      assert.equal(getReference(p2, 'pip-voice-v1').hash, ref.hash);
      assert.equal(sha256File(getReference(p2, 'pip-voice-v1').path).hash, sha256File(join(REAL_REF, 'pip_qwen_B-US_general_american.wav')).hash, 'same bytes as the approved voice reference');
      assert.equal(p2.db.prepare('SELECT approval_id a FROM approved').get()!.a, approval);
      for (const r of [...currentRows(p2, 'join-fanout')]) assert.ok(existsSync(blobPath(p2, r.blob_hash)));
      // tracked sources came back byte for byte
      for (const rel of ['episodes/join-fanout/episode.json', 'reference/pip-voice/approved-v1/approved.json', 'public/assets/a.png']) {
        assert.equal(sha256(readFileSync(join(target, rel))), sha256(readFileSync(join(t.root, rel))), rel);
      }
    } finally {
      p2.close();
    }
  });

  test('the approved file and a still-valid approval survive a restore; status is identical apart from draft renders', () => {
    t = newProject();
    adoptEpisode(t.p, 'episodes/join-fanout/episode.json');
    setAllComponents(t.p, t.root);
    buildAll(t.p, 'join-fanout');
    approve(t.p, 'join-fanout', SIGNED);
    const approvedSha = getApprovedFile(t.p, 'join-fanout').sha256;
    const dest = join(tmp(), 'bk');
    createBackup(t.p, dest);
    const target = join(tmp(), 'r');
    restoreBackup(dest, target);
    const p2 = Project.open(target);
    try {
      assert.equal(approvalStatus(p2, 'join-fanout').state, 'valid');
      assert.equal(getApprovedFile(p2, 'join-fanout').sha256, approvedSha);
      const s = statusReport(p2, 'join-fanout');
      assert.equal(s.render.final.status, 'fresh');
      assert.equal(s.render.draft.status, 'none', 'drafts are not included by default');
    } finally {
      p2.close();
    }
  });

  test('draft renders are included only on request', () => {
    t = newProject();
    adoptEpisode(t.p, 'episodes/join-fanout/episode.json');
    setAllComponents(t.p, t.root);
    buildAll(t.p, 'join-fanout');
    const dest = join(tmp(), 'bk');
    createBackup(t.p, dest, {includeDrafts: true});
    const target = join(tmp(), 'r');
    restoreBackup(dest, target);
    const p2 = Project.open(target);
    try {
      assert.equal(statusReport(p2, 'join-fanout').render.draft.status, 'fresh');
    } finally {
      p2.close();
    }
  });

  test('a damaged backup file is rejected, nothing is restored, and no half-made folder is left', () => {
    rich();
    const dest = join(tmp(), 'bk');
    createBackup(t.p, dest);
    const blobs = verifyBackup(dest).manifest!.files.filter((f) => f.kind === 'blob');
    const victim = join(dest, blobs[3].path);
    const bytes = readFileSync(victim);
    chmodSync(victim, 0o644);
    writeFileSync(victim, Buffer.concat([bytes.subarray(0, bytes.length - 1), Buffer.from([bytes.at(-1)! ^ 0xff])]));
    const target = join(tmp(), 'r');
    assert.throws(() => restoreBackup(dest, target), (e: BackupVerifyError) => e instanceof BackupVerifyError && e.problems.some((p) => p.includes(blobs[3].path)));
    assert.equal(existsSync(target), false);
    assert.deepEqual(readdirSync(join(target, '..')).filter((n) => n.includes('restoring')), []);
  });

  test('a missing file, a tampered manifest and a non-empty target are all refused', () => {
    rich();
    const dest = join(tmp(), 'bk');
    createBackup(t.p, dest);
    const target = join(tmp(), 'r');
    mkdirSync(target);
    writeFileSync(join(target, 'keep.txt'), 'existing');
    assert.throws(() => restoreBackup(dest, target), RestoreTargetError);
    assert.equal(readFileSync(join(target, 'keep.txt'), 'utf8'), 'existing');
    assert.throws(() => createBackup(t.p, target), BackupError);

    const manifest = join(dest, 'manifest.json');
    const original = readFileSync(manifest, 'utf8');
    writeFileSync(manifest, original.replace('"format": 1', '"format": 2'));
    assert.match(verifyBackup(dest).problems.join(' '), /manifest\.json does not match/);
    writeFileSync(manifest, original);
    const some = verifyBackup(dest).manifest!.files.find((f) => f.kind === 'file')!;
    rmSync(join(dest, some.path));
    assert.match(verifyBackup(dest).problems.join(' '), /is missing/);
  });

  test('backing up while a retained blob is missing fails loudly instead of producing a hollow backup', () => {
    rich();
    const row = currentRows(t.p, 'join-fanout').find((r) => r.kind === 'timing')!;
    rmSync(blobPath(t.p, row.blob_hash));
    assert.throws(() => createBackup(t.p, join(tmp(), 'bk')), /file is missing/);
  });

  test('the live project and the original voice reference are not modified by backup and restore', () => {
    const refBefore = sha256File(join(REAL_REF, 'pip_qwen_B-US_general_american.wav')).hash;
    rich();
    const before = norm(t.p, {drafts: true});
    const dest = join(tmp(), 'bk');
    createBackup(t.p, dest);
    restoreBackup(dest, join(tmp(), 'r'));
    assert.deepEqual(norm(t.p, {drafts: true}), before);
    assert.equal(sha256File(join(REAL_REF, 'pip_qwen_B-US_general_american.wav')).hash, refBefore);
  });
});

describe('reference-safe cleanup', () => {
  test('dry run lists exactly what a real run removes; only unreachable blobs older than the grace period', () => {
    const {garbage} = rich();
    t.clock.advance(20 * DAY);
    const young = fakeBlob(t.p, 'young garbage');
    const dry = gc(t.p, {graceMs: 14 * DAY});
    assert.equal(dry.applied, false);
    for (const g of garbage) assert.ok(dry.blobs.some((b) => b.hash === g));
    assert.ok(!dry.blobs.some((b) => b.hash === young), 'within the grace period');
    assert.ok(existsSync(blobPath(t.p, garbage[0])), 'a dry run removes nothing');
    const real = gc(t.p, {apply: true, graceMs: 14 * DAY});
    assert.deepEqual(real.blobs.map((b) => b.hash).sort(), dry.blobs.map((b) => b.hash).sort());
    for (const g of garbage) assert.equal(existsSync(blobPath(t.p, g)), false);
    assert.ok(existsSync(blobPath(t.p, young)));
    assert.deepEqual(gc(t.p, {graceMs: 14 * DAY}).blobs, [], 'nothing left to collect');
  });

  test('nothing reachable is removed: approved render, approved reference, selected takes, retained revisions, file sets, pins', () => {
    const {approval, ref, ids} = rich();
    const pinned = listArtifacts(t.p, 'join-fanout').find((a) => a.kind === 'mix' && a.subject === 'draft' && a.id !== ids['mix:draft'])!;
    pinArtifact(t.p, pinned.id);
    t.clock.advance(60 * DAY);
    const reach = reachableBlobs(t.p);
    gc(t.p, {apply: true, graceMs: DAY});
    for (const h of reach) assert.ok(existsSync(blobPath(t.p, h)), `reachable blob ${h} was removed`);
    assert.deepEqual([verifyAll(t.p).missing, verifyAll(t.p).corrupt], [[], []]);
    assert.ok(existsSync(blobPath(t.p, pinned.blob_hash)));
    assert.equal(getReference(t.p, 'pip-voice-v1').hash, ref.hash);
    assert.equal(t.p.db.prepare('SELECT approval_id a FROM approved').get()!.a, approval);
    assert.equal(sha256File(blobPath(t.p, t.p.db.prepare('SELECT file_sha256 f FROM approvals WHERE id=?').get(approval)!.f as string)).hash, t.p.db.prepare('SELECT file_sha256 f FROM approvals WHERE id=?').get(approval)!.f);
  });

  test('an approved render and an approved reference are roots in their own right (even with no revision or current pointer left)', () => {
    const {approval} = rich();
    const approved = t.p.db.prepare('SELECT file_sha256 f FROM approvals WHERE id=?').get(approval)!.f as string;
    t.p.db.exec('DELETE FROM current; DELETE FROM revisions'); // revision_refs cascade
    const reach = reachableBlobs(t.p);
    assert.ok(reach.has(approved), 'approved render');
    assert.ok(reach.has(t.p.db.prepare("SELECT blob_hash h FROM refs WHERE name='pip-voice-v1'").get()!.h as string), 'approved reference');
    t.clock.advance(90 * DAY);
    gc(t.p, {apply: true, graceMs: DAY});
    assert.ok(existsSync(blobPath(t.p, approved)));
  });

  test('the snapshot of a running job is protected until the job ends', () => {
    t = newProject();
    adoptEpisode(t.p, 'episodes/join-fanout/episode.json');
    setAllComponents(t.p, t.root);
    const job = startJob(t.p, {episodeId: 'join-fanout', jobKind: 'timing.build'});
    const doc = plain(getEpisode(t.p, 'join-fanout'));
    saveEpisode(t.p, 'join-fanout', {...doc, narration: {...doc.narration, segments: doc.narration.segments.map((x: any, i: number) => (i === 0 ? {...x, text: `${x.text} More words.`} : x))}});
    t.clock.advance(100 * DAY);
    const snapDoc = t.p.db.prepare("SELECT blob_hash h FROM snapshot_refs WHERE role='doc'").get()!.h as string;
    gc(t.p, {apply: true, graceMs: DAY, thin: {keepRecent: 0, dailyDays: 0}});
    assert.ok(existsSync(blobPath(t.p, snapDoc)), 'frozen episode of the running job survives');
    const done = finishJob(t.p, job.jobId, {blobHash: fakeBlob(t.p, 'timing')});
    assert.equal(done.outcome, 'outdated', 'the episode moved on while it ran');
    assert.equal(existsSync(blobPath(t.p, done.artifactId ? t.p.db.prepare('SELECT blob_hash h FROM artifacts WHERE id=?').get(done.artifactId)!.h as string : '')), true, 'its output is kept until cleanup decides otherwise');
  });

  test('thinning keeps milestones, approvals, adopt/restore revisions, the newest and anything an approval points at', () => {
    t = newProject();
    adoptEpisode(t.p, 'episodes/join-fanout/episode.json');
    setAllComponents(t.p, t.root);
    t.p.policy.checkpointOps = 1;
    const doc = plain(getEpisode(t.p, 'join-fanout'));
    for (let i = 0; i < 30; i++) {
      saveEpisode(t.p, 'join-fanout', {...doc, title: `edit ${i}`});
      t.clock.advance(3600_000);
      if (i === 5) createRevision(t.p, 'join-fanout', {kind: 'milestone', label: 'm'});
    }
    buildAll(t.p, 'join-fanout');
    approve(t.p, 'join-fanout', SIGNED);
    const before = listRevisions(t.p, 'join-fanout');
    const removed = thinRevisions(t.p, 'join-fanout', {keepRecent: 5, dailyDays: 30});
    const after = listRevisions(t.p, 'join-fanout');
    assert.ok(removed.length > 5, `only ${removed.length} removed`);
    for (const r of before) {
      const gone = removed.includes(r.number);
      if (['milestone', 'approval', 'adopt', 'restore'].includes(r.kind) || r.number === before.at(-1)!.number) assert.equal(gone, false, `${r.kind} r${r.number} must stay`);
    }
    for (const r of after) assert.equal(r.docHash, before.find((b) => b.number === r.number)!.docHash, 'kept revisions are unchanged');
    assert.equal(after.length, before.length - removed.length);
  });

  test('blobs held only by thinned revisions are collected; blobs held by retained revisions are kept', () => {
    t = newProject();
    adoptEpisode(t.p, 'episodes/join-fanout/episode.json');
    setAllComponents(t.p, t.root);
    t.p.policy.checkpointOps = 1;
    const doc = plain(getEpisode(t.p, 'join-fanout'));
    const held: string[] = [];
    for (let i = 0; i < 12; i++) {
      saveEpisode(t.p, 'join-fanout', {...doc, title: `round ${i}`});
      const blk = doc.narration.blocks[0].id;
      const j = startJob(t.p, {episodeId: 'join-fanout', jobKind: 'tts.block', subject: blk});
      const h = fakeBlob(t.p, `take round ${i}`);
      const done = finishJob(t.p, j.jobId, {blobHash: h, seed: i});
      selectTake(t.p, 'join-fanout', blk, done.artifactId); // each round's take becomes the selected one
      held.push(h);
      createRevision(t.p, 'join-fanout', {kind: i === 3 ? 'milestone' : 'auto'});
      t.clock.advance(3600_000);
    }
    t.clock.advance(40 * DAY);
    const res = gc(t.p, {apply: true, graceMs: DAY, thin: {keepRecent: 2, dailyDays: 30}});
    assert.ok(Object.values(res.thinned).flat().length > 0);
    const surviving = new Set(reachableBlobs(t.p));
    const alive = held.filter((h) => existsSync(blobPath(t.p, h)));
    assert.ok(alive.length < held.length, 'some old takes were collected');
    assert.ok(existsSync(blobPath(t.p, held[3])), 'the milestone revision still holds its take');
    assert.ok(existsSync(blobPath(t.p, held[11])), 'the newest take is current');
    for (const h of alive) assert.ok(surviving.has(h), 'whatever remains is still referenced');
  });
});

// ---- randomised check: after any mix of work, thinning and cleanup, everything retained still verifies -------
function rng(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let x = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

/** Walk the retained state row by row (independently of the SQL used by cleanup) and check every file. */
function assertRetainedIntact(p: Project, mustKeep: Set<string>) {
  const need = new Set<string>(mustKeep);
  const rows = (sql: string) => p.db.prepare(sql).all();
  for (const r of rows('SELECT blob_hash h FROM revision_refs')) need.add(r.h as string);
  for (const r of rows('SELECT a.blob_hash h FROM current c JOIN artifacts a ON a.id=c.artifact_id')) need.add(r.h as string);
  for (const r of rows('SELECT ap.file_sha256 h, a.blob_hash h2 FROM approvals ap JOIN artifacts a ON a.id=ap.artifact_id')) { need.add(r.h as string); need.add(r.h2 as string); }
  for (const r of rows('SELECT blob_hash h FROM refs')) need.add(r.h as string);
  for (const r of rows('SELECT blob_hash h FROM artifacts WHERE pinned=1')) need.add(r.h as string);
  for (const c of rows('SELECT blob_hash h FROM components WHERE blob_hash IS NOT NULL')) {
    need.add(c.h as string);
    for (const f of rows(`SELECT blob_hash h FROM fileset_files WHERE manifest_hash='${c.h}'`)) need.add(f.h as string);
  }
  for (const j of rows("SELECT snapshot_id s FROM jobs WHERE state='running'")) for (const r of rows(`SELECT blob_hash h FROM snapshot_refs WHERE snapshot_id='${j.s}'`)) need.add(r.h as string);
  for (const h of need) {
    assert.ok(existsSync(blobPath(p, h)), `retained blob ${h} is gone`);
    assert.equal(sha256File(blobPath(p, h)).hash, h, `retained blob ${h} is damaged`);
  }
}

describe('randomised work, thinning and cleanup', () => {
  for (const seed of [1, 2, 3, 4, 5, 6]) {
    test(`seed ${seed}: nothing reachable from retained state is ever lost`, () => {
      t = newProject();
      assertTemp(t.root);
      adoptEpisode(t.p, 'episodes/join-fanout/episode.json');
      setAllComponents(t.p, t.root);
      t.p.policy.checkpointOps = 3;
      const rand = rng(seed);
      const pick = <T>(xs: T[]) => xs[Math.floor(rand() * xs.length)];
      const must = new Set<string>();
      const blocks = getEpisode(t.p, 'join-fanout').narration.blocks.map((b) => b.id);
      let n = 0;
      let dryChecked = false;
      for (let step = 0; step < 90; step++) {
        const op = rand();
        const doc = plain(getEpisode(t.p, 'join-fanout'));
        if (op < 0.2) saveEpisode(t.p, 'join-fanout', {...doc, title: `t${step}`, scenes: doc.scenes.map((s: any, i: number) => (i === 0 ? {...s, params: {...s.params, dashboard: {...s.params.dashboard, value: `₹${step}`}}} : s))});
        else if (op < 0.3) saveEpisode(t.p, 'join-fanout', {...doc, narration: {...doc.narration, segments: doc.narration.segments.map((s: any, i: number) => (i === 0 ? {...s, text: `${s.text} ${step}`} : s))}});
        else if (op < 0.6) {
          const kind = pick(['tts.block', 'tts.block', 'timing.build', 'mix.draft', 'mix.final', 'render.draft', 'render.final'] as const);
          const j = startJob(t.p, {episodeId: 'join-fanout', jobKind: kind, subject: kind === 'tts.block' ? pick(blocks) : undefined});
          const h = fakeBlob(t.p, `s${seed} out ${n++}`);
          if (rand() < 0.08) continue; // leave this job running (in flight)
          finishJob(t.p, j.jobId, {blobHash: h, meta: {mastered: kind === 'render.final'}, seed: Math.floor(rand() * 3)});
        } else if (op < 0.68) {
          const takes = listArtifacts(t.p, 'join-fanout').filter((a) => a.kind === 'take');
          if (takes.length) { const a = pick(takes); try { selectTake(t.p, 'join-fanout', a.subject, a.id); } catch { /* subject is a merged-away block */ } }
        } else if (op < 0.74) createRevision(t.p, 'join-fanout', {kind: 'milestone', label: `m${step}`});
        else if (op < 0.79) {
          const a = pick(listArtifacts(t.p, 'join-fanout'));
          if (a) { pinArtifact(t.p, a.id); must.add(a.blob_hash); }
        } else if (op < 0.83) {
          const f = join(t.root, `ref${step}.wav`);
          writeFileSync(f, `reference ${seed} ${step}`);
          must.add(addReference(t.p, `ref-${step}`, f).hash);
        } else if (op < 0.88) {
          try { approve(t.p, 'join-fanout', SIGNED); const row = t.p.db.prepare('SELECT file_sha256 f FROM approvals ORDER BY id DESC LIMIT 1').get(); must.add(row!.f as string); } catch (e) { assert.ok(e instanceof ApprovalError); }
        } else if (op < 0.92) {
          writeFileSync(join(t.root, 'work/src/a.tsx'), `code changed ${step}`);
          captureFileSet(t.p, 'code', join(t.root, 'work'), ['src/a.tsx', 'src/b.ts']);
        } else {
          t.clock.advance(Math.floor(rand() * 3 * DAY));
          if (rand() < 0.5) {
            const dry = gc(t.p, {graceMs: 2 * DAY});
            if (!dryChecked && step > 40) {
              dryChecked = true;
              const real = gc(t.p, {apply: true, graceMs: 2 * DAY, thin: false});
              assert.deepEqual(real.blobs.map((b) => b.hash).sort(), dry.blobs.map((b) => b.hash).sort(), 'dry run equals real run');
            } else gc(t.p, {apply: true, graceMs: 2 * DAY, thin: {keepRecent: 4, dailyDays: 5}});
            assertRetainedIntact(t.p, must);
          }
        }
        t.clock.advance(60_000);
      }
      t.clock.advance(10 * DAY);
      gc(t.p, {apply: true, graceMs: 2 * DAY, thin: {keepRecent: 4, dailyDays: 5}});
      assertRetainedIntact(t.p, must);
      assert.deepEqual(gc(t.p, {graceMs: 2 * DAY}).blobs, [], 'a second cleanup finds nothing');
      assert.deepEqual([verifyAll(t.p).missing, verifyAll(t.p).corrupt], [[], []]);
      if (approvalStatus(t.p, 'join-fanout').state === 'valid') getApprovedFile(t.p, 'join-fanout');
      // and the cleaned project still backs up and restores
      const dest = join(tmp(), 'bk');
      createBackup(t.p, dest, {includeDrafts: true});
      const target = join(tmp(), 'r');
      restoreBackup(dest, target);
      const p2 = Project.open(target);
      try { assert.deepEqual([verifyAll(p2).missing, verifyAll(p2).corrupt], [[], []]); } finally { p2.close(); }
    });
  }
});

