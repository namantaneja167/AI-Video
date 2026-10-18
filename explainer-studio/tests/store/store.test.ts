import assert from 'node:assert/strict';
import {chmodSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {afterEach, describe, test} from 'node:test';
import {addReference, getReference, ReferenceImmutableError} from '../../core/artifacts.ts';
import {blobPath, CorruptBlobError, MissingBlobError, putBytes, putFile, readBlob, requireBlob, verifyAll, verifyBlob} from '../../core/blobs.ts';
import {
  adoptEpisode, ConflictError, createRevision, diffDocs, EpisodeExistsError, externalChanges, getEpisode, getRevision, importExternal, keepProjectVersion,
  listRevisions, reconcileV1Import, restoreRevision, saveEpisode, ValidationError, classifyProjection,
} from '../../core/episodes.ts';
import {sha256} from '../../core/hash.ts';
import {Project} from '../../core/project.ts';
import {plain} from '../helpers.ts';
import {newProject, type TestProject} from './helpers.ts';

let t: TestProject;
afterEach(() => t?.close());
const epPath = (root: string) => join(root, 'episodes/join-fanout/episode.json');
const fileHash = (root: string) => sha256(readFileSync(epPath(root)));

describe('adopting an episode', () => {
  test('stores it as v2, creates revision r1, and leaves the file byte-for-byte untouched', () => {
    t = newProject();
    const before = readFileSync(epPath(t.root));
    adoptEpisode(t.p, 'episodes/join-fanout/episode.json');
    assert.deepEqual(readFileSync(epPath(t.root)), before);
    const doc = getEpisode(t.p, 'join-fanout');
    assert.equal(doc.schemaVersion, 2);
    assert.deepEqual(listRevisions(t.p, 'join-fanout').map((r) => [r.number, r.kind]), [[1, 'adopt']]);
    assert.equal(classifyProjection(t.p, 'join-fanout').state, 'in-sync');
    assert.throws(() => adoptEpisode(t.p, 'episodes/join-fanout/episode.json'), EpisodeExistsError);
  });

  test('rejects an invalid file with the reasons and stores nothing', () => {
    t = newProject();
    const bad = JSON.parse(readFileSync(epPath(t.root), 'utf8'));
    bad.scenes[0].segments.pop();
    writeFileSync(epPath(t.root), JSON.stringify(bad));
    assert.throws(() => adoptEpisode(t.p, 'episodes/join-fanout/episode.json'), ValidationError);
    assert.equal(t.p.db.prepare('SELECT COUNT(*) c FROM episodes').get()!.c, 0);
  });
});

describe('transactional saves', () => {
  const setup = () => {
    t = newProject();
    adoptEpisode(t.p, 'episodes/join-fanout/episode.json');
    return plain(getEpisode(t.p, 'join-fanout'));
  };

  test('a save is one commit: seq advances, the working document changes, the file is rewritten as v1', () => {
    const doc = setup();
    const before = t.p.db.prepare('SELECT seq FROM episodes').get()!.seq as number;
    doc.title = 'A better title';
    const r = saveEpisode(t.p, 'join-fanout', doc);
    assert.equal(r.changed, true);
    assert.ok(r.seq > before);
    assert.equal(getEpisode(t.p, 'join-fanout').title, 'A better title');
    assert.equal(r.projection, 'written');
    const onDisk = JSON.parse(readFileSync(epPath(t.root), 'utf8'));
    assert.equal(onDisk.schemaVersion, 1, 'lossless documents stay readable by the legacy commands');
    assert.equal(onDisk.title, 'A better title');
  });

  test('saving identical content is a no-op', () => {
    const doc = setup();
    const r = saveEpisode(t.p, 'join-fanout', doc);
    assert.deepEqual([r.changed, r.projection], [false, 'unchanged']);
  });

  test('an invalid document changes nothing, in the database or on disk', () => {
    const doc = setup();
    const seq = t.p.db.prepare('SELECT seq FROM episodes').get()!.seq;
    const bytes = readFileSync(epPath(t.root));
    doc.scenes[0].segments.pop();
    assert.throws(() => saveEpisode(t.p, 'join-fanout', doc), ValidationError);
    assert.equal(t.p.db.prepare('SELECT seq FROM episodes').get()!.seq, seq);
    assert.deepEqual(readFileSync(epPath(t.root)), bytes);
  });

  test('a failure just before COMMIT rolls everything back (no op, no revision, no document change)', () => {
    const doc = setup();
    const ops = t.p.db.prepare('SELECT COUNT(*) c FROM ops').get()!.c;
    t.p.policy.checkpointOps = 1; // would also create a revision in the same transaction
    t.p.hooks.beforeCommit = () => { throw new Error('disk full'); };
    doc.title = 'never saved';
    assert.throws(() => saveEpisode(t.p, 'join-fanout', doc), /disk full/);
    t.p.hooks.beforeCommit = undefined;
    assert.equal(t.p.db.prepare('SELECT COUNT(*) c FROM ops').get()!.c, ops);
    assert.notEqual(getEpisode(t.p, 'join-fanout').title, 'never saved');
    assert.equal(listRevisions(t.p, 'join-fanout').length, 1);
  });

  test('optimistic concurrency: a stale baseSeq is refused', () => {
    const doc = setup();
    const {seq} = saveEpisode(t.p, 'join-fanout', {...doc, title: 'one'});
    assert.throws(() => saveEpisode(t.p, 'join-fanout', {...doc, title: 'two'}, {baseSeq: seq - 1}), ConflictError);
    assert.equal(saveEpisode(t.p, 'join-fanout', {...doc, title: 'two'}, {baseSeq: seq}).changed, true);
  });

  test('a v2-only feature makes the projection v2, so the legacy commands refuse it instead of dropping it', () => {
    const doc = setup();
    doc.scenes[1].layout = {template: 'split-dense', captionZone: 'bottom', mascot: {mode: 'docked', position: 'bottom-left', scale: 0.55}};
    saveEpisode(t.p, 'join-fanout', doc);
    assert.equal(JSON.parse(readFileSync(epPath(t.root), 'utf8')).schemaVersion, 2);
  });
});

describe('revisions', () => {
  const setup = () => {
    t = newProject();
    adoptEpisode(t.p, 'episodes/join-fanout/episode.json');
    return plain(getEpisode(t.p, 'join-fanout'));
  };

  test('automatic checkpoints after N edits or after a time limit; identical state is not re-recorded', () => {
    const doc = setup();
    t.p.policy.checkpointOps = 3;
    for (let i = 1; i <= 7; i++) saveEpisode(t.p, 'join-fanout', {...doc, title: `edit ${i}`});
    assert.deepEqual(listRevisions(t.p, 'join-fanout').map((r) => r.kind), ['adopt', 'auto', 'auto']);
    t.clock.advance(6 * 60_000);
    saveEpisode(t.p, 'join-fanout', {...doc, title: 'after a pause'});
    assert.equal(listRevisions(t.p, 'join-fanout').at(-1)!.kind, 'auto');
    const n = listRevisions(t.p, 'join-fanout').length;
    assert.equal(createRevision(t.p, 'join-fanout', {kind: 'auto'}), n, 'nothing changed since the last revision');
  });

  test('milestones keep a name; revisions are immutable snapshots of the document', () => {
    const doc = setup();
    saveEpisode(t.p, 'join-fanout', {...doc, title: 'v-one'});
    const n = createRevision(t.p, 'join-fanout', {kind: 'milestone', label: 'script locked'});
    saveEpisode(t.p, 'join-fanout', {...doc, title: 'v-two'});
    assert.equal(getRevision(t.p, 'join-fanout', n).title, 'v-one');
    assert.equal(listRevisions(t.p, 'join-fanout').find((r) => r.number === n)!.label, 'script locked');
  });

  test('restore creates a NEW revision and leaves all history intact', () => {
    const doc = setup();
    saveEpisode(t.p, 'join-fanout', {...doc, title: 'first'});
    const keep = createRevision(t.p, 'join-fanout', {kind: 'milestone', label: 'keep'});
    saveEpisode(t.p, 'join-fanout', {...doc, title: 'second'});
    const before = listRevisions(t.p, 'join-fanout');
    const res = restoreRevision(t.p, 'join-fanout', keep);
    assert.equal(getEpisode(t.p, 'join-fanout').title, 'first');
    const after = listRevisions(t.p, 'join-fanout');
    assert.equal(after.length, before.length + 1);
    assert.deepEqual(after.slice(0, before.length), before, 'existing revisions unchanged');
    assert.equal(after.at(-1)!.kind, 'restore');
    assert.equal(res.revision, after.at(-1)!.number);
  });

  test('diff lists exactly the changed paths', () => {
    const doc = setup();
    const changed = plain(doc);
    changed.title = 'x';
    (changed.scenes[0].params as any).dashboard.value = '₹1';
    assert.deepEqual(diffDocs(doc, changed).map((d) => d.path).sort(), ['scenes.0.params.dashboard.value', 'title']);
  });
});

describe('content-addressed blobs and verified references', () => {
  test('same bytes are stored once; files are read-only; a source file is never modified', () => {
    t = newProject({seed: false});
    const a = putBytes(t.p, 'hello');
    const b = putBytes(t.p, 'hello');
    assert.equal(a.hash, b.hash);
    assert.equal(t.p.db.prepare('SELECT COUNT(*) c FROM blobs').get()!.c, 1);
    assert.equal(statSync(blobPath(t.p, a.hash)).mode & 0o222, 0, 'no write bits');
    const src = join(t.root, 'src.bin');
    writeFileSync(src, 'payload');
    const before = sha256(readFileSync(src));
    const c = putFile(t.p, src);
    assert.equal(c.hash, before);
    assert.equal(sha256(readFileSync(src)), before);
  });

  test('a reference to a missing, unregistered or damaged blob is refused', () => {
    t = newProject({seed: false});
    const {hash} = putBytes(t.p, 'abc');
    requireBlob(t.p, hash);
    assert.throws(() => requireBlob(t.p, sha256('never stored')), MissingBlobError);
    chmodSync(blobPath(t.p, hash), 0o644);
    writeFileSync(blobPath(t.p, hash), 'abX'); // same size, different bytes
    requireBlob(t.p, hash); // cheap check passes (size equal)...
    assert.throws(() => verifyBlob(t.p, hash), CorruptBlobError); // ...the full check does not
    assert.throws(() => readBlob(t.p, hash), CorruptBlobError);
    writeFileSync(blobPath(t.p, hash), 'a');
    assert.throws(() => requireBlob(t.p, hash), CorruptBlobError);
  });

  test('verifyAll finds missing, corrupt and orphan files', () => {
    t = newProject({seed: false});
    const a = putBytes(t.p, 'one').hash;
    const b = putBytes(t.p, 'two').hash;
    chmodSync(blobPath(t.p, a), 0o644);
    writeFileSync(blobPath(t.p, a), 'ONE');
    chmodSync(blobPath(t.p, b), 0o644);
    writeFileSync(blobPath(t.p, b), '');
    rmSync(blobPath(t.p, b));
    const orphan = sha256('orphan');
    mkdirSync(join(t.p.blobDir, orphan.slice(0, 2)), {recursive: true});
    writeFileSync(blobPath(t.p, orphan), 'orphan');
    const r = verifyAll(t.p);
    assert.deepEqual([r.corrupt, r.missing, r.orphanFiles], [[a], [b], [orphan]]);
  });

  test('foreign keys stop any table from referencing an unregistered blob', () => {
    t = newProject({seed: false});
    assert.throws(() => t.p.db.prepare('INSERT INTO refs(name,blob_hash,meta_json,approved_at) VALUES(?,?,?,?)').run('x', sha256('nope'), '{}', 1), /FOREIGN KEY/);
  });

  test('approved references are ingested, verified on every read, and immutable', () => {
    t = newProject({seed: false});
    const src = join(t.root, 'ref.wav');
    writeFileSync(src, 'RIFF-approved-voice');
    const {hash} = addReference(t.p, 'pip-voice-v1', src, {note: 'B-US'});
    assert.equal(getReference(t.p, 'pip-voice-v1').hash, hash);
    assert.equal(addReference(t.p, 'pip-voice-v1', src).hash, hash, 'same content is idempotent');
    writeFileSync(src, 'different');
    assert.throws(() => addReference(t.p, 'pip-voice-v1', src), ReferenceImmutableError);
    chmodSync(blobPath(t.p, hash), 0o644);
    writeFileSync(blobPath(t.p, hash), 'RIFF-tampered-voice');
    assert.throws(() => getReference(t.p, 'pip-voice-v1'), CorruptBlobError);
  });
});

describe('external episode.json changes', () => {
  const setup = () => {
    t = newProject();
    adoptEpisode(t.p, 'episodes/join-fanout/episode.json');
    const doc = plain(getEpisode(t.p, 'join-fanout'));
    saveEpisode(t.p, 'join-fanout', {...doc, title: 'managed title'}); // first save writes the projection
    return doc;
  };
  const edit = (root: string, fn: (ep: any) => void) => {
    const ep = JSON.parse(readFileSync(epPath(root), 'utf8'));
    fn(ep);
    writeFileSync(epPath(root), JSON.stringify(ep, null, 2));
  };

  test('our own writes are never reported as external', () => {
    setup();
    assert.deepEqual(externalChanges(t.p), []);
    t.p.close();
    t.p = Project.open(t.root, {now: t.clock.now});
    assert.deepEqual(t.p.recovery.projections, [{episodeId: 'join-fanout', action: 'in-sync'}]);
  });

  test('a hand edit is detected without a restart, and later saves do NOT overwrite it', () => {
    const doc = setup();
    edit(t.root, (ep) => (ep.narration.segments[0].text = 'Edited by hand in an editor.'));
    const ext = externalChanges(t.p);
    assert.equal(ext.length, 1);
    const handEdited = fileHash(t.root);
    const r = saveEpisode(t.p, 'join-fanout', {...doc, title: 'a later in-app edit'});
    assert.equal(r.projection, 'external-pending');
    assert.equal(fileHash(t.root), handEdited, 'file bytes untouched');
    assert.equal(getEpisode(t.p, 'join-fanout').title, 'a later in-app edit', 'the project keeps its own state');
  });

  test('a hand edit is detected when the project is reopened', () => {
    setup();
    t.p.close();
    edit(t.root, (ep) => (ep.title = 'edited while closed'));
    t.p = Project.open(t.root, {now: t.clock.now});
    assert.deepEqual(t.p.recovery.projections, [{episodeId: 'join-fanout', action: 'external'}]);
    assert.equal(getEpisode(t.p, 'join-fanout').title, 'managed title');
  });

  test('importing creates a new revision, keeps block plan and beat ids stable, and then the file is ours again', () => {
    const doc = setup();
    saveEpisode(t.p, 'join-fanout', doc);
    const idsBefore = getEpisode(t.p, 'join-fanout').beats.map((b) => b.id);
    edit(t.root, (ep) => {
      ep.narration.segments[1].text = ep.narration.segments[1].text + ' Edited.';
      ep.events.unshift({segment: 's01', at: 'end', cue: 'checks'});
    });
    const res = importExternal(t.p, 'join-fanout');
    assert.equal(res.imported, true);
    const after = getEpisode(t.p, 'join-fanout');
    assert.match(after.narration.segments[1].text, /Edited\.$/);
    assert.equal(after.beats.length, idsBefore.length + 1);
    for (const id of idsBefore) assert.ok(after.beats.some((b) => b.id === id), `beat ${id} kept its id`);
    assert.equal(listRevisions(t.p, 'join-fanout').at(-1)!.kind, 'import');
    assert.deepEqual(externalChanges(t.p), []);
    assert.equal(saveEpisode(t.p, 'join-fanout', {...after, title: 'next'}).projection, 'written');
  });

  test('reconcile keeps custom blocks and layouts that v1 cannot carry', () => {
    const doc = setup();
    const custom = plain(doc);
    custom.narration.blocks = [{id: 'one', segments: custom.narration.segments.slice(0, 2).map((s: any) => s.id)}, {id: 'two', segments: custom.narration.segments.slice(2).map((s: any) => s.id)}];
    custom.scenes[1].layout.template = 'split-dense';
    custom.scenes[1].layout.mascot.mode = 'docked';
    const raw = JSON.parse(readFileSync(epPath(t.root), 'utf8'));
    raw.title = 'hand edit';
    const merged = reconcileV1Import(custom, raw);
    assert.deepEqual(merged.narration.blocks.map((b) => b.id), ['one', 'two']);
    assert.equal(merged.scenes[1].layout.template, 'split-dense');
    assert.equal(merged.title, 'hand edit');
  });

  test('keeping the project version restores the file and saves the discarded bytes aside', () => {
    setup();
    edit(t.root, (ep) => (ep.title = 'about to be discarded'));
    const {savedAs} = keepProjectVersion(t.p, 'join-fanout');
    assert.ok(savedAs && existsSync(savedAs));
    assert.match(readFileSync(savedAs!, 'utf8'), /about to be discarded/);
    assert.equal(JSON.parse(readFileSync(epPath(t.root), 'utf8')).title, 'managed title');
    assert.deepEqual(externalChanges(t.p), []);
  });

  test('a deleted file is recreated; a half-finished projection (crash after commit) is completed, not flagged', () => {
    const doc = setup();
    rmSync(epPath(t.root));
    t.p.close();
    t.p = Project.open(t.root, {now: t.clock.now});
    assert.deepEqual(t.p.recovery.projections, [{episodeId: 'join-fanout', action: 'recreated'}]);
    // simulate: the commit happened but the process died before the file was rewritten
    const before = fileHash(t.root);
    t.p.hooks.beforeCommit = undefined;
    const pr = t.p.db.prepare('SELECT confirmed_seq FROM projections').get()!;
    t.p.db.exec(`UPDATE projections SET confirmed_seq = ${Number(pr.confirmed_seq) - 1}`);
    const {projection} = saveEpisode(t.p, 'join-fanout', {...doc, title: 'lagging'});
    assert.equal(projection, 'written');
    assert.notEqual(fileHash(t.root), before);
  });

  test('restoring an old version of the file by hand is still treated as external, not silently overwritten', () => {
    const doc = setup();
    const oldBytes = readFileSync(epPath(t.root));
    saveEpisode(t.p, 'join-fanout', {...doc, title: 'newer'});
    writeFileSync(epPath(t.root), oldBytes); // user pastes back an older projection
    t.p.close();
    t.p = Project.open(t.root, {now: t.clock.now});
    assert.deepEqual(t.p.recovery.projections, [{episodeId: 'join-fanout', action: 'external'}]);
  });
});

