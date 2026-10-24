// The Pip Explains opening in the normal episode workflow, on a real server and project store with fake workers: new episodes get the
// brand defaults (the chime exactly once, the quiet mix levels, bundled fonts), a hook is required before such an episode is built and is
// carried through the storyboard, the chime cannot be doubled, older episodes are left alone, and an episode made without a planning
// document can be connected to one without changing it.
import assert from 'node:assert/strict';
import {after, before, describe, test} from 'node:test';
import {applyStoryboard, createPlan, getPlan, acceptImport, savePlan, submitImport} from '../../app/planning.ts';
import {defaultSelection} from '../../app/shared/importing.ts';
import {statusReport} from '../../core/artifacts.ts';
import {openingSignature} from '../../core/brand.ts';
import {get} from '../../core/db.ts';
import {getEpisode, getEpisodeInfo, listEpisodes, listRevisions} from '../../core/episodes.ts';
import {getComponentValue} from '../../core/state.ts';
import {api, startApp, type Harness} from './harness.ts';

let h: Harness;
let call: ReturnType<typeof api>;
before(async () => { h = await startApp({jobs: true}); call = api(h); });
after(async () => { await h.close(); });

const OLD = 'context-window';
const count = (table: string, where = '1=1', ...args: any[]) => (get<{n: number}>(h.project.db.prepare(`SELECT count(*) AS n FROM ${table} WHERE ${where}`), ...args))!.n;
const SCRIPT = '```json\n' + JSON.stringify({studioPacket: 1, script: {segments: [{text: 'Same app. Same price. Why is the second request faster?'}, {text: 'The first request checks the cache. Nothing there.'}]}}) + '\n```';
const startNew = async (title: string) => {
  const made = await call('POST', '/api/plans', {title, audience: 'Curious developers', objective: 'Understand a cache hit.', brand: 'pip-explains', tab: 't'});
  assert.equal(made.status, 201);
  const id = made.json.plan.id as string;
  const r = submitImport(h.project, id, {text: SCRIPT, via: 'paste'});
  assert.equal(r.ok, true);
  if (!r.ok) throw new Error('unreachable');
  const accepted = acceptImport(h.project, id, r.import.id, {selection: defaultSelection(r.import.proposal), basePlanSeq: getPlan(h.project, id).seq, baseEpisodeSeq: null});
  assert.equal(accepted.episodeCreated, true);
  return id;
};
const blockers = (id: string) => h.jobs!.plan(id, 'final').blockers.map((b) => b.message);

describe('a new Pip Explains episode', () => {
  let id = '';
  test('starts with the brand defaults: bundled fonts, the quiet chime exactly once, the quiet mix levels, and no hook yet', async () => {
    id = await startNew('Why caching helps');
    assert.equal(getPlan(h.project, id).plan.brand, 'pip-explains');
    const doc = getEpisode(h.project, id);
    assert.equal(doc.style, 'pip-paper-bundled');
    assert.equal(doc.scenes[0].openingHook, undefined, 'the hook is the author\'s to write');
    assert.deepEqual(getComponentValue(h.project, 'soundEvents', id), [{t: 0.12, accent: 'chime', gainDb: -21}]);
    assert.equal(openingSignature(h.project, id).count, 1);
    const mix = getComponentValue<Record<string, unknown>>(h.project, 'mixParams', id)!;
    assert.deepEqual([mix.voiceGainDb, mix.accentBusDb, mix.accentDuck], [0, -12, 0.7]);
    assert.ok(typeof mix.mixScriptSha256 === 'string', 'the recorded mix script is kept');
  });

  test('cannot be built until its opening hook is set, and says where to set it', () => {
    const b = blockers(id);
    assert.ok(b.some((m) => /opening hook is not set/.test(m) && /Script or Scenes step/.test(m)), b.join(' | '));
  });

  test('the hook is validated by the episode\'s own schema: at most 48 characters, trimmed, first scene only', async () => {
    const cur = await call('GET', `/api/episodes/${id}`);
    const long = structuredClone(cur.json.doc);
    long.scenes[0].openingHook = 'x'.repeat(49);
    const r = await call('PUT', `/api/episodes/${id}`, {doc: long, baseSeq: cur.json.seq, tab: 't'});
    assert.equal(r.status, 422);
    assert.match(JSON.stringify(r.json), /48/);
    const blank = structuredClone(cur.json.doc);
    blank.scenes[0].openingHook = '   ';
    assert.equal((await call('PUT', `/api/episodes/${id}`, {doc: blank, baseSeq: cur.json.seq, tab: 't'})).status, 422);
  });

  test('a saved hook clears that blocker and leaves the title alone; the opening info reads it back', async () => {
    const cur = await call('GET', `/api/episodes/${id}`);
    const doc = structuredClone(cur.json.doc);
    doc.scenes[0].openingHook = '  Faster apps do less work  ';
    const r = await call('PUT', `/api/episodes/${id}`, {doc, baseSeq: cur.json.seq, tab: 't'});
    assert.equal(r.status, 200);
    assert.equal(getEpisode(h.project, id).scenes[0].openingHook, 'Faster apps do less work');
    assert.equal(getEpisode(h.project, id).title, 'Why caching helps', 'the descriptive title is a separate field');
    assert.ok(!blockers(id).some((m) => /opening hook is not set/.test(m)));
    const o = await call('GET', `/api/episodes/${id}/opening`);
    assert.deepEqual([o.json.hook, o.json.title, o.json.brand, o.json.signature.count, o.json.pipStyle], ['Faster apps do less work', 'Why caching helps', 'pip-explains', 1, true]);
  });

  test('applying a storyboard keeps the hook on the new first scene', () => {
    const stored = getPlan(h.project, id);
    const sb = {id: 'sb1', segmentIds: ['s1', 's2'], sceneType: 'pip-cards', intention: '', mechanism: '', pip: [], params: {cards: [{heading: 'Cache', body: 'A saved copy'}], actions: [], idle: true}, provenance: null};
    savePlan(h.project, id, {...stored.plan, storyboard: [sb]}, {baseSeq: stored.seq});
    const s2 = getPlan(h.project, id);
    const res = applyStoryboard(h.project, id, {basePlanSeq: s2.seq, baseEpisodeSeq: getEpisodeInfo(h.project, id).seq, confirmReplace: true});
    assert.equal(res.scenes, 1);
    const scene = getEpisode(h.project, id).scenes[0];
    assert.equal(scene.type, 'pip-cards');
    assert.equal(scene.openingHook, 'Faster apps do less work', 'the storyboard does not take the hook away');
    assert.equal(getComponentValue<unknown[]>(h.project, 'soundEvents', id)!.length, 1, 'and the chime is still recorded once');
  });
});

describe('the opening chime is recorded exactly once', () => {
  let id = '';
  before(async () => { id = await startNew('Chime counting'); });

  test('turning it on again does nothing; copies are reduced to one; turning it off removes only the chime', async () => {
    const on = await call('POST', `/api/episodes/${id}/opening`, {signature: true, tab: 't'});
    assert.equal(on.status, 200);
    assert.equal(on.json.changed, false);
    assert.equal(on.json.signature.count, 1);
    // two copies, plus another sound that must survive
    const {recordEpisodeSound} = await import('../../core/soundSettings.ts');
    recordEpisodeSound(h.project, id, {soundEvents: [{t: 0.12, accent: 'chime', gainDb: -21}, {t: 5, accent: 'ding', gainDb: -15}, {t: 0.12, accent: 'chime', gainDb: -21}]});
    assert.equal(openingSignature(h.project, id).count, 2);
    const fix = await call('POST', `/api/episodes/${id}/opening`, {signature: true, tab: 't'});
    assert.equal(fix.json.changed, true);
    assert.equal(fix.json.removedDuplicates, 1);
    assert.deepEqual(getComponentValue(h.project, 'soundEvents', id), [{t: 0.12, accent: 'chime', gainDb: -21}, {t: 5, accent: 'ding', gainDb: -15}]);
    const off = await call('POST', `/api/episodes/${id}/opening`, {signature: false, tab: 't'});
    assert.equal(off.json.signature.count, 0);
    assert.deepEqual(getComponentValue(h.project, 'soundEvents', id), [{t: 5, accent: 'ding', gainDb: -15}]);
    const again = await call('POST', `/api/episodes/${id}/opening`, {signature: true, tab: 't'});
    assert.equal(again.json.signature.count, 1);
    assert.equal((await call('POST', `/api/episodes/${id}/opening`, {signature: true, tab: 't'})).json.changed, false);
  });

  test('a request without a clear answer is refused', async () => {
    assert.equal((await call('POST', `/api/episodes/${id}/opening`, {tab: 't'})).status, 400);
  });
});

describe('older episodes are preserved', () => {
  test('an existing episode keeps its sound, its builds and its status, and is not asked for a hook', async () => {
    const before = {info: getEpisodeInfo(h.project, OLD), jobs: count('jobs'), artifacts: count('artifacts'), revisions: listRevisions(h.project, OLD).length, status: JSON.stringify(statusReport(h.project, OLD)), sound: JSON.stringify(getComponentValue(h.project, 'soundEvents', OLD))};
    const o = await call('GET', `/api/episodes/${OLD}/opening`);
    assert.deepEqual([o.json.hook, o.json.brand], [null, null]);
    assert.ok(!h.jobs!.plan(OLD, 'final').blockers.some((b) => /opening hook/.test(b.message)));
    const after = {info: getEpisodeInfo(h.project, OLD), jobs: count('jobs'), artifacts: count('artifacts'), revisions: listRevisions(h.project, OLD).length, status: JSON.stringify(statusReport(h.project, OLD)), sound: JSON.stringify(getComponentValue(h.project, 'soundEvents', OLD))};
    assert.deepEqual(after, before);
  });
});

describe('connecting an episode that has no planning document', () => {
  test('adds the brief, sources and storyboard written from the episode itself, and changes nothing else', async () => {
    assert.equal((await call('GET', '/api/library')).json.items.find((i: any) => i.id === OLD).hasPlan, false);
    const before = {info: getEpisodeInfo(h.project, OLD), doc: JSON.stringify(getEpisode(h.project, OLD)), jobs: count('jobs'), artifacts: count('artifacts'), revisions: count('revisions', 'episode_id=?', OLD), status: JSON.stringify(statusReport(h.project, OLD)), plan: JSON.stringify(h.jobs!.plan(OLD, 'final').steps.map((s) => `${s.key}:${s.action}`)), sound: JSON.stringify(getComponentValue(h.project, 'soundEvents', OLD)), takes: count('artifacts', "kind='take'")};
    const r = await call('POST', `/api/episodes/${OLD}/link-plan`, {audience: 'People new to AI', tab: 't'});
    assert.equal(r.status, 201, JSON.stringify(r.json));
    const plan = getPlan(h.project, OLD).plan;
    const doc = getEpisode(h.project, OLD);
    assert.equal(plan.id, OLD);
    assert.equal(plan.title, doc.title);
    assert.equal(plan.objective, doc.learningObjective);
    assert.equal(plan.audience, 'People new to AI');
    assert.equal(plan.brand, undefined, 'an older episode is not marked as a Pip Explains episode');
    assert.deepEqual(plan.storyboard.map((s) => [s.sceneType, s.segmentIds.join(',')]), doc.scenes.map((s) => [s.type, s.segments.join(',')]));
    assert.match(plan.notes, /copied from the episode itself; nothing was researched or imported/);
    assert.equal(plan.claims.length, 0, 'no claims are invented');
    const after = {info: getEpisodeInfo(h.project, OLD), doc: JSON.stringify(getEpisode(h.project, OLD)), jobs: count('jobs'), artifacts: count('artifacts'), revisions: count('revisions', 'episode_id=?', OLD), status: JSON.stringify(statusReport(h.project, OLD)), plan: JSON.stringify(h.jobs!.plan(OLD, 'final').steps.map((s) => `${s.key}:${s.action}`)), sound: JSON.stringify(getComponentValue(h.project, 'soundEvents', OLD)), takes: count('artifacts', "kind='take'")};
    assert.deepEqual(after, before, 'the episode, its takes, history, status and rebuild plan are exactly as they were');
    assert.equal(count('plans', 'id=?', OLD), 1);
    assert.equal(count('plan_revisions', 'plan_id=?', OLD), 1);
    assert.equal((await call('GET', '/api/library')).json.items.find((i: any) => i.id === OLD).hasPlan, true);
    assert.equal(listEpisodes(h.project).filter((e) => e === OLD).length, 1, 'no second episode was made');
  });

  test('is refused when the episode already has one, or does not exist', async () => {
    const again = await call('POST', `/api/episodes/${OLD}/link-plan`, {tab: 't'});
    assert.equal(again.status, 409);
    assert.match(again.json.message, /already has its planning document/);
    assert.equal((await call('POST', '/api/episodes/no-such-episode/link-plan', {tab: 't'})).status, 404);
  });
});
