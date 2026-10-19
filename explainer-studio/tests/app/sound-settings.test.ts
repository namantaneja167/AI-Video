// Sound events and mix parameters belong to one episode: the layout of a new workspace, the migration of an old one, that a new
// episode starts without accents, that one episode's settings cannot reach another's hashes, and that bad cues stay errors.
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {after, before, describe, test} from 'node:test';
import {seedDemo} from '../../app/demo.ts';
import {baselineSources} from '../baseline-sources.ts';
import {Project} from '../../core/project.ts';
import {expectedNow, statusReport} from '../../core/artifacts.ts';
import {getEpisode} from '../../core/episodes.ts';
import {SoundSettingsError, clearEpisodeSound, ownSoundSettings, recordEpisodeSound, scopeSoundToEpisodes} from '../../core/soundSettings.ts';
import {getComponentHashes, getComponentValues, setComponent} from '../../core/state.ts';
import {accentCueProblems} from '../../src/library/dynamicCues.ts';
import {acceptImport, createPlan, submitImport} from '../../app/planning.ts';
import {defaultSelection} from '../../app/shared/importing.ts';
import {EP, fakeWorkspace, type FakeWorkspace} from './jobs-fixture.ts';

let w: FakeWorkspace;
before(() => { w = fakeWorkspace(); });
after(async () => { await w.close(); });

const draft = (title: string): string => {
  const made = createPlan(w.p, {title, audience: 'a', objective: 'o'});
  const r = submitImport(w.p, made.plan.id, {text: 'A model reads text. In small pieces.', via: 'paste'});
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  acceptImport(w.p, made.plan.id, r.import.id, {selection: defaultSelection(r.import.proposal), basePlanSeq: made.seq, baseEpisodeSeq: null});
  return made.plan.id;
};
const expected = (id: string) => JSON.stringify(expectedNow(w.p, id).expected);
const mixHashes = (id: string) => { const e = expectedNow(w.p, id).expected; return {draft: e.mix.draft, final: e.mix.final}; };
/** What is out of date among the outputs the baseline was built with (it has a final mix and video, no drafts). */
const notFresh = (p: Project) => statusReport(p, EP).notFresh.filter((k) => !k.endsWith(':draft'));
const POP = (gainDb: number) => ({accent: 'pop' as const, t: 1, gainDb});
/** A seeded workspace with the real tools recorded, so the baseline is fresh as it is in the demo. */
const seeded = () => {
  const tmp = mkdtempSync(join(tmpdir(), 'studio-sound-test-'));
  seedDemo(join(tmp, 'project'), baselineSources());
  const p = Project.open(join(tmp, 'project'));
  return {p, close: async () => { p.close(); rmSync(tmp, {recursive: true, force: true}); }};
};

describe('where the settings live', () => {
  test('the baseline records its own sound events and mix levels; the project default has no accents', () => {
    const own = ownSoundSettings(w.p, EP);
    assert.deepEqual(own, {soundEvents: true, mixParams: true});
    assert.equal((getComponentValues(w.p, EP).soundEvents as unknown[]).length, 16, 'the baseline keeps its 16 recorded events');
    assert.deepEqual((getComponentValues(w.p, EP).mixParams as Record<string, unknown>).accentBusDb, -12);
    const star = w.p.db.prepare("SELECT name, value_json FROM components WHERE scope='*' AND name IN ('soundEvents','mixParams')").all() as {name: string; value_json: string}[];
    assert.equal(star.find((r) => r.name === 'soundEvents')!.value_json, '[]');
    assert.deepEqual(Object.keys(JSON.parse(star.find((r) => r.name === 'mixParams')!.value_json)), ['mixScriptSha256']);
  });

  test('the seeded baseline is fresh, and its own events all resolve on its own scenes', async () => {
    const x = seeded();
    try { assert.deepEqual(notFresh(x.p), []); } finally { await x.close(); }
    assert.deepEqual(accentCueProblems(getComponentValues(w.p, EP).soundEvents as never, getEpisode(w.p, EP).scenes as never), []);
  });

  test('a new episode starts with no accents and default mix levels, and says nothing about the baseline\'s events', () => {
    const id = draft('Starts clean');
    assert.deepEqual(ownSoundSettings(w.p, id), {soundEvents: false, mixParams: false});
    assert.deepEqual(getComponentValues(w.p, id).soundEvents, []);
    const mp = getComponentValues(w.p, id).mixParams as Record<string, unknown>;
    assert.equal(mp.accentBusDb, undefined);
    assert.equal(w.svc.plan(id).notes.some((n) => /sound/i.test(n)), false);
  });
});

describe('one episode\'s sound settings cannot affect another', () => {
  let a = '', b = '';
  before(() => { a = draft('Isolation A'); b = draft('Isolation B'); });

  test('recording sound for A changes A\'s mix hashes only', () => {
    const [baseBefore, bBefore, aBefore] = [expected(EP), expected(b), mixHashes(a)];
    const hashesBefore = {base: getComponentHashes(w.p, EP), b: getComponentHashes(w.p, b)};
    recordEpisodeSound(w.p, a, {soundEvents: [POP(-6)], mixParams: {voiceGainDb: 2}});
    assert.equal(expected(EP), baseBefore, 'the baseline is unchanged');
    assert.equal(expected(b), bBefore, 'the other new episode is unchanged');
    assert.deepEqual(getComponentHashes(w.p, EP), hashesBefore.base);
    assert.deepEqual(getComponentHashes(w.p, b), hashesBefore.b);
    assert.notDeepEqual(mixHashes(a), aBefore, 'A\'s own mix does depend on them');
    assert.equal((getComponentValues(w.p, a).soundEvents as unknown[]).length, 1);
    assert.equal((getComponentValues(w.p, a).mixParams as Record<string, unknown>).voiceGainDb, 2);
    assert.deepEqual(getComponentValues(w.p, b).soundEvents, []);
  });

  test('changing the baseline\'s settings changes only the baseline, and A keeps what it recorded', async () => {
    const [aBefore, bBefore] = [expected(a), expected(b)];
    const events = getComponentValues(w.p, EP).soundEvents as {gainDb: number}[];
    const hashes = getComponentHashes(w.p, EP);
    recordEpisodeSound(w.p, EP, {soundEvents: events.map((e, i) => (i === 0 ? {...e, gainDb: -3} : e)) as never});
    assert.equal(expected(a), aBefore);
    assert.equal(expected(b), bBefore);
    assert.notEqual(getComponentHashes(w.p, EP).soundEvents, hashes.soundEvents, 'its own settings changed');
    // put it back: the hash returns to what the build was made with
    recordEpisodeSound(w.p, EP, {soundEvents: events as never});
    assert.deepEqual(getComponentHashes(w.p, EP), hashes);
    // and on a workspace where the baseline is fresh, the change makes its mix out of date, then back
    const x = seeded();
    try {
      const ev = getComponentValues(x.p, EP).soundEvents as {gainDb: number}[];
      recordEpisodeSound(x.p, EP, {soundEvents: ev.map((e, i) => (i === 0 ? {...e, gainDb: -3} : e)) as never});
      assert.notEqual(statusReport(x.p, EP).mix.final.status, 'fresh');
      recordEpisodeSound(x.p, EP, {soundEvents: ev as never});
      assert.deepEqual(notFresh(x.p), []);
    } finally { await x.close(); }
  });

  test('clearing A\'s settings returns it to the default without touching the others', () => {
    const [baseBefore, bBefore] = [expected(EP), expected(b)];
    clearEpisodeSound(w.p, a);
    assert.deepEqual(getComponentValues(w.p, a).soundEvents, []);
    assert.equal(expected(EP), baseBefore);
    assert.equal(expected(b), bBefore);
  });

  test('changing the project default reaches an episode that has no settings of its own, and not one that has', () => {
    const [baseBefore, bBefore] = [expected(EP), expected(b)];
    const star = (name: string) => JSON.parse((w.p.db.prepare("SELECT value_json FROM components WHERE scope='*' AND name=?").get(name) as {value_json: string}).value_json);
    const old = star('soundEvents');
    try {
      setComponent(w.p, 'soundEvents', [POP(-9)]);
      assert.equal(expected(EP), baseBefore, 'the baseline records its own, so the default does not reach it');
      assert.notEqual(expected(b), bBefore, 'an episode with none inherits the default');
    } finally { setComponent(w.p, 'soundEvents', old); }
    assert.equal(expected(b), bBefore);
  });
});

describe('what stays an error', () => {
  test('a cue no scene of the episode provides is refused when recorded, with the event named', () => {
    const before = expected(EP);
    assert.throws(() => recordEpisodeSound(w.p, EP, {soundEvents: [{accent: 'pop', cue: 'not_a_cue', gainDb: -6}]}), (e: unknown) => e instanceof SoundSettingsError && /Sound event 1 \(pop\) is placed on the cue "not_a_cue", which no scene of this episode provides\./.test(e.message));
    assert.equal(expected(EP), before, 'nothing was recorded');
  });

  test('a cue of another episode\'s scene is refused for an episode that does not have that scene', () => {
    const id = draft('Wrong cues');
    const baseEvents = getComponentValues(w.p, EP).soundEvents as never[];
    assert.throws(() => recordEpisodeSound(w.p, id, {soundEvents: baseEvents}), (e: unknown) => e instanceof SoundSettingsError && e.problems.length === 16 && /window_in/.test(e.problems[0]));
    assert.deepEqual(getComponentValues(w.p, id).soundEvents, []);
  });

  test('a named scene that is not there, an unsupported accent and an out-of-range mix level are each reported', () => {
    const id = draft('Bad input');
    assert.throws(() => recordEpisodeSound(w.p, id, {soundEvents: [{accent: 'pop', cue: 'x', scene: 'nope', gainDb: 0}]}), /names scene "nope", which this episode does not have/);
    assert.throws(() => recordEpisodeSound(w.p, id, {soundEvents: [{accent: 'laser', t: 1, gainDb: 0} as never]}), /not one of the supported accents/);
    assert.throws(() => recordEpisodeSound(w.p, id, {mixParams: {voiceGainDb: 40}}), /voiceGainDb must be a number from -24 to 12/);
    assert.throws(() => recordEpisodeSound(w.p, id, {mixParams: {reverb: 1} as never}), /cannot be set here/);
  });

  test('if bad events get into the store anyway, the preflight blocks the mix and names the cue', () => {
    const id = draft('Forced');
    setComponent(w.p, 'soundEvents', [{accent: 'pop', cue: 'forced_cue', gainDb: -6}], id);
    assert.ok(w.svc.plan(id).blockers.some((x) => /"forced_cue", which no scene of this episode provides\. The mix would refuse it\./.test(x.message)));
  });
});

describe('a workspace made with one project-wide set', () => {
  const legacy = () => {
    const x = seeded();
    // the layout before this change: the baseline's rows are the project-wide rows
    x.p.db.exec("DELETE FROM components WHERE scope='*' AND name IN ('soundEvents','mixParams')");
    x.p.db.exec(`UPDATE components SET scope='*' WHERE scope='${EP}' AND name IN ('soundEvents','mixParams')`);
    return x;
  };

  test('is moved to the episode it was built with, with the same hashes, so nothing goes out of date', async () => {
    const x = legacy();
    try {
      const hashesBefore = getComponentHashes(x.p, EP);
      const artifacts = x.p.db.prepare('SELECT count(*) AS n FROM artifacts').get() as {n: number};
      assert.deepEqual(notFresh(x.p), []);
      const r = scopeSoundToEpisodes(x.p);
      assert.deepEqual([r.done, r.episodes], [true, [EP]]);
      assert.deepEqual(getComponentHashes(x.p, EP), hashesBefore, 'the same values and hashes it was built with');
      assert.deepEqual(notFresh(x.p), []);
      assert.deepEqual(ownSoundSettings(x.p, EP), {soundEvents: true, mixParams: true});
      assert.deepEqual(x.p.db.prepare('SELECT count(*) AS n FROM artifacts').get(), artifacts, 'no build record was touched');
      const star = x.p.db.prepare("SELECT value_json FROM components WHERE scope='*' AND name='soundEvents'").get() as {value_json: string};
      assert.equal(star.value_json, '[]');
      const note = JSON.parse((x.p.db.prepare("SELECT value FROM meta WHERE key='sound_settings_scoped'").get() as {value: string}).value);
      assert.deepEqual(note.episodes, [EP]);
      assert.deepEqual(scopeSoundToEpisodes(x.p).done, false, 'running it again does nothing');
    } finally { await x.close(); }
  });

  test('an episode without builds is not given the old events', async () => {
    const x = legacy();
    try {
      scopeSoundToEpisodes(x.p);
      const made = createPlan(x.p, {title: 'After', audience: 'a', objective: 'o'});
      const r = submitImport(x.p, made.plan.id, {text: 'One line. Two lines.', via: 'paste'});
      if (!r.ok) throw new Error('import');
      acceptImport(x.p, made.plan.id, r.import.id, {selection: defaultSelection(r.import.proposal), basePlanSeq: made.seq, baseEpisodeSeq: null});
      assert.deepEqual(getComponentValues(x.p, made.plan.id).soundEvents, []);
    } finally { await x.close(); }
  });

  test('with no built episode there is nothing to attach the old settings to, so it changes nothing', async () => {
    const x = legacy();
    try {
      x.p.db.exec('DELETE FROM current; DELETE FROM artifacts;');
      const r = scopeSoundToEpisodes(x.p);
      assert.equal(r.done, false);
      assert.equal((getComponentValues(x.p, EP).soundEvents as unknown[]).length, 16, 'still what it was');
    } finally { await x.close(); }
  });
});
