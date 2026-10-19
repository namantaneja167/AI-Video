// The Voice stage on fake audio and mix workers: what the view says, generating and re-rolling on the real runner, reusing saved takes,
// selecting takes, refusals, and that the engine and the job table never contradict each other. The real handlers, runner, hashes,
// timeline logic and mixer run; only the audio model and the video renderer are stand-ins.
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {join} from 'node:path';
import {after, before, describe, test} from 'node:test';
import {statusReport} from '../../core/artifacts.ts';
import {getEpisode, getEpisodeInfo, saveEpisode} from '../../core/episodes.ts';
import {getComponentValues, setComponent} from '../../core/state.ts';
import {acceptImport, createPlan, submitImport} from '../../app/planning.ts';
import {defaultSelection} from '../../app/shared/importing.ts';
import {VoiceError, VoiceService} from '../../app/voice.ts';
import {EP, fakeWorkspace, requestId, until, type FakeWorkspace} from './jobs-fixture.ts';

/** Twenty spoken words per sentence, so a block of three sentences is sixty words, the size blocks are made at. */
const sentence = (n: number) => `Sentence ${n} says exactly ${Array.from({length: 16}, (_, i) => `word${n}x${i}`).join(' ')}.`;
const SCRIPT = (count: number) => Array.from({length: count}, (_, i) => sentence(i + 1)).join(' ');

let w: FakeWorkspace;
let voice: VoiceService;
before(() => { w = fakeWorkspace(); voice = new VoiceService(w.svc); });
after(async () => { await w.close(); });

const draft = (title: string, sentences = 9): string => {
  const made = createPlan(w.p, {title, audience: 'a', objective: 'o'});
  const r = submitImport(w.p, made.plan.id, {text: SCRIPT(sentences), via: 'paste'});
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  acceptImport(w.p, made.plan.id, r.import.id, {selection: defaultSelection(r.import.proposal), basePlanSeq: made.seq, baseEpisodeSeq: null});
  return made.plan.id;
};
const seq = (id: string) => getEpisodeInfo(w.p, id).seq;
const gen = (id: string, o: {blocks?: string[]; reroll?: boolean} = {}) => voice.generate(id, {seq: seq(id), requestId: requestId(), ...o});
const finish = async (jobIds: number[]) => { for (const j of jobIds) await w.svc.runner.waitFor(j); };
const blockOf = (id: string, b: string) => voice.view(id).blocks.find((x) => x.id === b)!;
const states = (id: string) => voice.view(id).blocks.map((b) => b.status);

describe('the view', () => {
  test('a new episode has blocks of its own sentences, no takes, an unmeasured estimate, and a stopped engine', () => {
    const id = draft('View check');
    const v = voice.view(id);
    assert.deepEqual(v.blocks.map((b) => [b.id, b.segments.map((s) => s.id).join(',')]), [['b1', 's1,s2,s3'], ['b2', 's4,s5,s6'], ['b3', 's7,s8,s9']]);
    assert.deepEqual(v.blocks.map((b) => b.status), ['none', 'none', 'none']);
    assert.deepEqual(v.blocks.map((b) => b.takes.length), [0, 0, 0]);
    assert.equal(v.blocks[0].words, 60);
    assert.deepEqual(v.blocks[0].estimate, {measured: false} as never);
    assert.equal(v.engine.worker, 'none');
    assert.equal(v.engine.activity, 'stopped');
    assert.deepEqual(v.blockers, []);
    assert.equal(v.busy, false);
    assert.equal(v.sample.available, false, 'a sample needs takes first');
    assert.deepEqual(v.sound, {events: 0, own: false});
  });

  test('the baseline shows its imported takes as saved but not selectable for stale text, and says its mix has accents', () => {
    const v = voice.view(EP);
    assert.ok(v.blocks.length >= 2);
    assert.ok(v.blocks.every((b) => b.takes.length >= 1 && b.takes[0].imported));
    assert.match(v.sample.reason ?? '', /sound accents/);
    assert.equal(v.sound.events, 16);
  });
});

describe('generating, caching and re-rolling', () => {
  let id = '';
  before(() => { id = draft('Generate flow'); });

  test('generating every block runs one job per block, one at a time, in block order, and selects each take', async () => {
    const r = gen(id);
    assert.deepEqual(r.queued.map((q) => [q.block, q.seed]), [['b1', 11], ['b2', 11], ['b3', 11]]);
    assert.equal(voice.view(id).busy, true);
    await finish(r.queued.map((q) => q.jobId));
    const jobs = r.queued.map((q) => w.svc.list(id, 20).find((j) => j.id === q.jobId)!);
    assert.deepEqual(jobs.map((j) => j.state), ['succeeded', 'succeeded', 'succeeded']);
    for (let i = 1; i < jobs.length; i++) assert.ok(jobs[i].startedAt! >= jobs[i - 1].finishedAt!, 'heavy jobs never overlap');
    const v = voice.view(id);
    assert.deepEqual(v.blocks.map((b) => b.status), ['fresh', 'fresh', 'fresh']);
    assert.ok(v.blocks.every((b) => b.takes.length === 1 && b.takes[0].selected && b.takes[0].seed === 11 && b.durationSec !== null && b.durationSec > 5));
    assert.equal(v.busy, false);
    assert.ok(existsSync(join(w.projectRoot, '.studio')), 'the project is intact');
  });

  test('nothing is generated again for text that already has a selected take, and a repeated request is the same request', () => {
    assert.throws(() => gen(id), (e: unknown) => e instanceof VoiceError && e.code === 'nothing');
    const a = voice.generate(id, {seq: seq(id), requestId: 'req-repeat-0001', blocks: ['b1'], reroll: true});
    const b = voice.generate(id, {seq: seq(id), requestId: 'req-repeat-0001', blocks: ['b1'], reroll: true});
    assert.equal(b.repeated, true);
    assert.deepEqual(b.queued, a.queued);
  });

  test('a re-roll makes a new take with a new seed, never overwrites, and leaves the selection alone until it is chosen', async () => {
    await finish(voice.view(id).jobs.filter((j) => ['queued', 'running', 'preparing'].includes(j.state)).map((j) => j.id));
    const before = blockOf(id, 'b1');
    assert.equal(before.takes.length, 2, 'the re-roll from the previous test finished');
    const [first, second] = before.takes;
    assert.equal(first.seed, 11);
    assert.equal(second.seed, 12, 'a seed not used for this wording before');
    assert.equal(first.selected, true, 'the take it had stays selected');
    assert.equal(second.selected, false);
    assert.equal(second.compatible, true);
    assert.notEqual(first.artifactId, second.artifactId);
    assert.equal(before.status, 'fresh', 'a re-roll changes nothing that was built');
    assert.ok(existsSync(join(w.projectRoot, '.studio')));
  });

  test('another re-roll uses the next seed again, and the first take is still there, playable and selectable', async () => {
    const r = gen(id, {blocks: ['b1'], reroll: true});
    assert.equal(r.queued[0].seed, 13);
    await finish(r.queued.map((q) => q.jobId));
    const b = blockOf(id, 'b1');
    assert.deepEqual(b.takes.map((t) => t.seed), [11, 12, 13]);
    assert.deepEqual(b.takes.map((t) => t.selected), [true, false, false]);
    assert.ok(b.takes.every((t) => /^\/media\/take\/.+\.wav$/.test(t.url)));
  });

  test('choosing a take changes only that block; every take stays saved', () => {
    const b = blockOf(id, 'b1');
    const third = b.takes[2];
    const r = voice.choose(id, {block: 'b1', artifactId: third.artifactId, seq: seq(id)});
    assert.equal(r.changed, true);
    const after = blockOf(id, 'b1');
    assert.deepEqual(after.takes.map((t) => t.selected), [false, false, true]);
    assert.equal(after.status, 'fresh');
    assert.deepEqual(states(id), ['fresh', 'fresh', 'fresh']);
    assert.equal(voice.choose(id, {block: 'b1', artifactId: third.artifactId}).changed, false, 'choosing the selected take again is not a change');
  });

  test('a take made for earlier wording is kept but refused, with the reason', async () => {
    const old = blockOf(id, 'b2').takes[0];
    const doc = getEpisode(w.p, id);
    saveEpisode(w.p, id, {...doc, narration: {...doc.narration, segments: doc.narration.segments.map((s) => (s.id === 's5' ? {...s, text: `${s.text} Changed.`} : s))}}, {baseSeq: seq(id)});
    const v = blockOf(id, 'b2');
    assert.equal(v.status, 'stale');
    assert.equal(v.takes[0].compatible, false);
    assert.match(v.takes[0].why ?? '', /Made from earlier wording of s5\./);
    assert.throws(() => voice.choose(id, {block: 'b2', artifactId: old.artifactId}), (e: unknown) => e instanceof VoiceError && e.code === 'refused' && /earlier wording of s5/.test(e.message));
    assert.deepEqual(states(id), ['fresh', 'stale', 'fresh'], 'only the block whose words changed is out of date');
  });

  test('editing the wording back reuses the saved take: nothing is generated', async () => {
    const r = gen(id, {blocks: ['b2']});
    assert.equal(r.queued.length, 1, 'the new wording has no saved take, so one is generated');
    await finish(r.queued.map((q) => q.jobId));
    assert.equal(blockOf(id, 'b2').takes.length, 2);
    const doc = getEpisode(w.p, id);
    saveEpisode(w.p, id, {...doc, narration: {...doc.narration, segments: doc.narration.segments.map((s) => (s.id === 's5' ? {...s, text: s.text.replace(' Changed.', '')} : s))}}, {baseSeq: seq(id)});
    const b = blockOf(id, 'b2');
    assert.equal(b.status, 'stale');
    assert.ok(b.reusableTakeId !== null, 'a saved take for exactly this wording is offered');
    const jobsBefore = w.svc.list(id, 100).length;
    const r2 = gen(id, {blocks: ['b2']});
    assert.deepEqual([r2.queued.length, r2.reused.length], [0, 1]);
    assert.equal(r2.reused[0].takeNumber, 1);
    assert.equal(w.svc.list(id, 100).length, jobsBefore, 'no job was queued');
    assert.equal(blockOf(id, 'b2').status, 'fresh');
  });
});

describe('what is refused, and that a refusal starts nothing', () => {
  test('a stale page, a busy episode and a take for the wrong block each refuse without side effects', async () => {
    const id = draft('Refusals');
    const jobsBefore = () => w.svc.list(id, 100).length;
    assert.throws(() => voice.generate(id, {seq: seq(id) - 1, requestId: requestId()}), (e: unknown) => e instanceof VoiceError && e.code === 'changed');
    assert.equal(jobsBefore(), 0, 'a stale sequence queues nothing');
    const r = gen(id, {blocks: ['b1']});
    assert.throws(() => gen(id, {blocks: ['b2']}), (e: unknown) => e instanceof VoiceError && e.code === 'busy');
    assert.throws(() => voice.choose(id, {block: 'b1', artifactId: 1}), (e: unknown) => e instanceof VoiceError && e.code === 'busy');
    await finish(r.queued.map((q) => q.jobId));
    assert.throws(() => voice.choose(id, {block: 'b2', artifactId: blockOf(id, 'b1').takes[0].artifactId}), (e: unknown) => e instanceof VoiceError && e.code === 'unknown');
    assert.throws(() => gen(id, {blocks: ['b9']}), (e: unknown) => e instanceof VoiceError && e.code === 'unknown');
    assert.throws(() => gen(id, {reroll: true}), (e: unknown) => e instanceof VoiceError && e.code === 'refused');
    assert.equal(jobsBefore(), 1);
  });

  test('a voice or runtime that cannot be produced blocks generation with the reason, and queues nothing', async () => {
    const x = fakeWorkspace();
    try {
      const vs = new VoiceService(x.svc);
      const made = createPlan(x.p, {title: 'Blocked', audience: 'a', objective: 'o'});
      const r = submitImport(x.p, made.plan.id, {text: SCRIPT(3), via: 'paste'});
      if (!r.ok) throw new Error('import');
      acceptImport(x.p, made.plan.id, r.import.id, {selection: defaultSelection(r.import.proposal), basePlanSeq: made.seq, baseEpisodeSeq: null});
      const id = made.plan.id;
      setComponent(x.p, 'voiceRuntime', {...(getComponentValues(x.p, id).voiceRuntime as object), referenceSha256: '0000'});
      const v = vs.view(id);
      assert.ok(v.blockers.some((m) => /approved voice reference .* is not the one recorded/.test(m)), v.blockers.join(' | '));
      assert.throws(() => vs.generate(id, {seq: getEpisodeInfo(x.p, id).seq, requestId: requestId()}), (e: unknown) => e instanceof VoiceError && e.code === 'blocked' && Array.isArray(e.detail.blockers));
      assert.equal(x.svc.list(id, 10).length, 0);
    } finally { await x.close(); }
  });
});
