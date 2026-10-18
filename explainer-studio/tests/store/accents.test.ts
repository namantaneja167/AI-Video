// Sound accents through the real mix script (workers/mix.py + accents.py) inside the job pipeline.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {afterEach, describe, test} from 'node:test';
import {statusReport} from '../../core/artifacts.ts';
import {blobPath} from '../../core/blobs.ts';
import {setComponent} from '../../core/state.ts';
import {EP, fixture, type Fixture} from './handler-fixture.ts';
import type {TestProject} from './helpers.ts';

const fixtures: Fixture[] = [];
afterEach(async () => { for (const f of fixtures.splice(0)) { f.r.stop(); await f.host.shutdown().catch(() => {}); f.t.close(); } });
const use = () => { const f = fixture(); fixtures.push(f); return f; };
const run = async (f: Fixture, jobKind: any, subject?: string) => f.r.waitFor(f.r.enqueue({episodeId: EP, jobKind, subject}));
const meta = (t: TestProject, jobId: number) => JSON.parse((t.p.db.prepare('SELECT a.meta_json m FROM jobs j JOIN artifacts a ON a.id=j.artifact_id WHERE j.id=?').get(jobId) as any).m);
const current = (t: TestProject, kind: string, subject: string) => t.p.db.prepare('SELECT a.id, a.blob_hash h FROM current c JOIN artifacts a ON a.id=c.artifact_id WHERE c.episode_id=? AND c.kind=? AND c.subject=?').get(EP, kind, subject) as any;
const samples = (path: string) => { const b = readFileSync(path); const sr = b.readUInt32LE(24); return {sr, s: new Int16Array(b.buffer, b.byteOffset + 44, (b.length - 44) >> 1)}; };
// With any accent the mix needs the timing (accents sit on scene cues), so the timing is built first.
const allTakes = async (f: Fixture) => { for (const b of f.blocks) assert.equal((await run(f, 'tts.block', b)).state, 'succeeded'); assert.equal((await run(f, 'timing.build')).state, 'succeeded'); };

describe('sound accents in the mix', () => {
  test('an accent is added at its time, the voice is ducked only around it, and the job records the event', async () => {
    const f = use();
    await allTakes(f);
    assert.equal((await run(f, 'mix.draft')).state, 'succeeded');
    const plain = samples(blobPath(f.t.p, current(f.t, 'mix', 'draft').h));
    setComponent(f.t.p, 'soundEvents', [{accent: 'pop', t: 2.0, gainDb: -6}]);
    const row = await run(f, 'mix.draft');
    assert.equal(row.state, 'succeeded', row.error ?? '');
    const withAccent = samples(blobPath(f.t.p, current(f.t, 'mix', 'draft').h));
    assert.equal(withAccent.s.length, plain.s.length);
    const sr = plain.sr;
    let before = 0, near = 0, after = 0;
    for (let i = 0; i < plain.s.length; i++) {
      const d = Math.abs(withAccent.s[i] - plain.s[i]);
      if (i < 1.9 * sr) before = Math.max(before, d);
      else if (i < 2.6 * sr) near = Math.max(near, d);
      else if (i > 3.2 * sr) after = Math.max(after, d);
    }
    assert.equal(before, 0, 'nothing changes before the accent');
    assert.ok(near > 500, `the accent is audible around 2.0 s (${near})`);
    assert.equal(after, 0, 'nothing changes well after the accent (the ducking has recovered)');
    assert.deepEqual(meta(f.t, row.id).used.accents.map((a: any) => [a.accent, a.t, a.gain_db]), [['pop', 2, -6]]);
  });

  test('changing the gain of an accent makes the mix stale, and rebuilding it makes it fresh again', async () => {
    const f = use();
    await allTakes(f);
    assert.equal((await run(f, 'mix.draft')).state, 'succeeded');
    assert.equal(statusReport(f.t.p, EP).mix.draft.status, 'fresh');
    setComponent(f.t.p, 'soundEvents', [{accent: 'pop', t: 2.0, gainDb: -6}]);
    assert.notEqual(statusReport(f.t.p, EP).mix.draft.status, 'fresh');
    assert.equal((await run(f, 'mix.draft')).state, 'succeeded');
    assert.equal(statusReport(f.t.p, EP).mix.draft.status, 'fresh');
    setComponent(f.t.p, 'soundEvents', [{accent: 'pop', t: 2.0, gainDb: -9}]);
    assert.notEqual(statusReport(f.t.p, EP).mix.draft.status, 'fresh');
  });

  test('a queued mix keeps the accents it was queued with', async () => {
    const f = use();
    await allTakes(f);
    setComponent(f.t.p, 'soundEvents', [{accent: 'pop', t: 2.0, gainDb: -6}]);
    const id = f.r.enqueue({episodeId: EP, jobKind: 'mix.draft'});
    setComponent(f.t.p, 'soundEvents', [{accent: 'ding', t: 3.0, gainDb: -6}]);
    const row = await f.r.waitFor(id);
    assert.equal(row.state, 'outdated', row.error ?? '');
    assert.deepEqual(meta(f.t, id).used.accents.map((a: any) => a.accent), ['pop']);
  });

  test('an accent with no timing built yet is refused with a way out', async () => {
    const f = use();
    for (const b of f.blocks) await run(f, 'tts.block', b);
    setComponent(f.t.p, 'soundEvents', [{accent: 'pop', t: 2.0, gainDb: -6}]);
    const row = await run(f, 'mix.draft');
    assert.equal(row.state, 'failed');
    assert.match(row.error!, /build it first/);
  });

  test('an accent anchored to a cue that no scene provides fails the mix with a clear message', async () => {
    const f = use();
    await allTakes(f);
    setComponent(f.t.p, 'soundEvents', [{accent: 'pop', cue: 'nope', gainDb: -6}]);
    const row = await run(f, 'mix.draft');
    assert.equal(row.state, 'failed');
    assert.match(row.error!, /cue "nope" is not provided by any scene/);
  });

  test('an accent outside the episode is refused', async () => {
    const f = use();
    await allTakes(f);
    setComponent(f.t.p, 'soundEvents', [{accent: 'pop', t: 599, gainDb: -6}]);
    const row = await run(f, 'mix.draft');
    assert.equal(row.state, 'failed');
    assert.match(row.error!, /outside the episode/);
  });
});
