import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {validateEpisodeV2} from '../../src/migrate.ts';
import {Autosave, type Committed, type KV, type SendResult} from '../../app/shared/autosave.ts';
import {setSegmentText} from '../../app/shared/edit.ts';

const v = validateEpisodeV2(JSON.parse(readFileSync(new URL('../../samples/context-window/episode.json', import.meta.url), 'utf8')));
assert.ok(v.ok);
const base = v.episode;
const e = (n: number) => setSegmentText(base, 's1', `Edit number ${n}.`).doc;

const kind = (a: Autosave): string => a.state.kind;
const kv = (): KV & {m: Map<string, string>} => {
  const m = new Map<string, string>();
  return {m, get: (k) => m.get(k) ?? null, set: (k, x) => void m.set(k, x), remove: (k) => void m.delete(k)};
};
// Timers fire only when the test says so.
const timers = () => {
  const pending = new Map<number, () => void>();
  let id = 0;
  return {set: (fn: () => void) => { pending.set(++id, fn); return id; }, clear: (h: unknown) => void pending.delete(h as number), fire: () => { const all = [...pending.values()]; pending.clear(); all.forEach((f) => f()); }, count: () => pending.size};
};
const make = (send: (d: unknown, seq: number) => Promise<SendResult>, store = kv(), committed: Committed = {doc: base, seq: 1}, t = timers()) =>
  ({a: new Autosave({episodeId: 'x', committed, send: send as never, store, timers: t, now: () => 1}), store, t});

test('an edit is unsaved immediately, kept as a local draft, and Saved appears only after the server commits', async () => {
  let release!: (r: SendResult) => void;
  const {a, store, t} = make(() => new Promise((res) => (release = res)));
  a.edit(e(1));
  assert.equal(kind(a), 'unsaved');
  assert.ok(store.m.has('studio.draft.x'), 'draft kept before any save is attempted');
  t.fire();
  assert.equal(kind(a), 'saving');
  release({kind: 'ok', seq: 2});
  await new Promise((r) => setImmediate(r));
  assert.equal(kind(a), 'saved');
  assert.equal(a.committed.seq, 2);
  assert.equal(store.m.has('studio.draft.x'), false, 'draft removed once committed');
});

test('a failed save keeps the edits and the draft, shows the failure, and Retry saves them', async () => {
  let n = 0;
  const {a, store} = make(async () => (++n === 1 ? {kind: 'failed', message: 'disk full'} : {kind: 'ok', seq: 2}));
  a.edit(e(1));
  await a.flush();
  assert.deepEqual(a.state, {kind: 'failed', message: 'disk full'});
  assert.deepEqual(a.doc, e(1));
  assert.ok(store.m.has('studio.draft.x'));
  await a.flush(); // the Retry button
  assert.equal(a.state.kind, 'saved');
  assert.equal(a.committed.seq, 2);
});

test('a thrown network error is a failed save, not a lost edit', async () => {
  const {a} = make(async () => { throw new Error('Failed to fetch'); });
  a.edit(e(1));
  await a.flush();
  assert.equal(a.state.kind, 'failed');
  assert.deepEqual(a.doc, e(1));
});

test('an edit made while a save is in flight is saved next, on the new base', async () => {
  const calls: number[] = [];
  const releases: ((r: SendResult) => void)[] = [];
  const {a, t} = make((_d, seq) => { calls.push(seq); return new Promise((res) => releases.push(res)); });
  a.edit(e(1));
  t.fire();
  a.edit(e(2));
  releases[0]({kind: 'ok', seq: 2});
  await new Promise((r) => setImmediate(r));
  assert.equal(a.state.kind, 'unsaved', 'not Saved: the second edit is not committed');
  t.fire();
  releases[1]({kind: 'ok', seq: 3});
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(calls, [1, 2]);
  assert.equal(a.state.kind, 'saved');
  assert.deepEqual(a.committed.doc, e(2));
});

test('a conflict keeps the edits until the author chooses; keep-mine saves on top, take-theirs discards', async () => {
  const theirs: Committed = {doc: e(9), seq: 5};
  let mode: 'conflict' | 'ok' = 'conflict';
  const seen: number[] = [];
  const {a, store} = make(async (_d, seq) => { seen.push(seq); return mode === 'conflict' ? {kind: 'conflict', current: theirs} : {kind: 'ok', seq: 6}; });
  a.edit(e(1));
  await a.flush();
  assert.equal(a.state.kind, 'conflict');
  assert.deepEqual(a.doc, e(1));
  a.edit(e(2)); // further edits wait
  assert.equal(a.state.kind, 'conflict');
  mode = 'ok';
  await a.keepMine();
  assert.deepEqual(seen, [1, 5]);
  assert.equal(a.state.kind, 'saved');
  assert.deepEqual(a.committed.doc, e(2));

  const b = make(async () => ({kind: 'conflict', current: theirs}), kv());
  b.a.edit(e(1));
  await b.a.flush();
  b.a.takeTheirs();
  assert.equal(b.a.state.kind, 'saved');
  assert.deepEqual(b.a.doc, theirs.doc);
  assert.equal(b.store.m.has('studio.draft.x'), false);
  assert.equal(store.m.has('studio.draft.x'), false);
});

test('an invalid document is reported, kept, and not retried in a loop', async () => {
  let n = 0;
  const {a, t} = make(async () => { n++; return {kind: 'invalid', message: 'text must not be empty'}; });
  a.edit(e(1));
  t.fire();
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(a.state, {kind: 'invalid', message: 'text must not be empty'});
  assert.equal(t.count(), 0);
  assert.equal(n, 1);
});

test('after a reload, unsaved edits are restored on the same base and saved; on a newer base the author is asked', async () => {
  const store = kv();
  const first = make(async () => ({kind: 'failed', message: 'x'}), store);
  first.a.edit(e(1)); // draft written, "browser closed" before the save
  const sent: number[] = [];
  const re = make(async (_d, seq) => { sent.push(seq); return {kind: 'ok', seq: 2}; }, store, {doc: base, seq: 1});
  assert.equal(re.a.restored, 'edits');
  assert.deepEqual(re.a.doc, e(1));
  assert.equal(re.a.state.kind, 'unsaved');
  re.t.fire();
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(sent, [1]);
  assert.equal(re.a.state.kind, 'saved');

  const store2 = kv();
  make(async () => ({kind: 'ok', seq: 2}), store2).a.edit(e(1));
  const late = make(async () => ({kind: 'ok', seq: 8}), store2, {doc: e(7), seq: 7});
  assert.equal(late.a.restored, 'conflict');
  assert.equal(late.a.state.kind, 'conflict');
  assert.deepEqual(late.a.doc, e(1), 'the unsaved edits are still there');
});

test('a draft equal to the saved version is dropped, and other tabs update only a clean editor', () => {
  const store = kv();
  store.set('studio.draft.x', JSON.stringify({baseSeq: 1, doc: base, at: 1}));
  const {a} = make(async () => ({kind: 'ok', seq: 2}), store);
  assert.equal(a.restored, null);
  assert.equal(store.m.has('studio.draft.x'), false);
  assert.equal(a.external({doc: e(3), seq: 4}), true);
  assert.deepEqual(a.doc, e(3));
  a.edit(e(5));
  assert.equal(a.external({doc: e(6), seq: 9}), false, 'unsaved edits are never replaced silently');
  assert.deepEqual(a.doc, e(5));
});

test('editing back to the saved text is not unsaved', () => {
  const {a, store} = make(async () => ({kind: 'ok', seq: 2}));
  a.edit(e(1));
  a.edit(base);
  assert.equal(a.state.kind, 'saved');
  assert.equal(store.m.has('studio.draft.x'), false);
});
