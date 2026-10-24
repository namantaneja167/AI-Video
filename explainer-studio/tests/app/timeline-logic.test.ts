// An episode that has never been timed adopts the current timeline logic for itself; one that has keeps the guard.
import assert from 'node:assert/strict';
import {after, before, describe, test} from 'node:test';
import {statusReport} from '../../core/artifacts.ts';
import {createEpisode, getEpisode, getEpisodeInfo} from '../../core/episodes.ts';
import {getComponentHashes, setComponent} from '../../core/state.ts';
import {timelineLogicValue} from '../../core/toolchain.ts';
import {cueRulesPreserved, timelineLogicAdoptable} from '../../app/plan.ts';
import {SCENE_CUES} from '../../src/library/sceneSpecs.ts';
import {EP, fakeWorkspace, requestId, setCaptionOnly, until, type FakeWorkspace} from './jobs-fixture.ts';
import {ROOT} from '../helpers.ts';

let w: FakeWorkspace;
const NEW = 'never-timed-episode';
before(() => {
  w = fakeWorkspace();
  const doc = structuredClone(getEpisode(w.p, EP));
  createEpisode(w.p, {...doc, id: NEW, title: 'A second episode in the same project'});
  setComponent(w.p, 'timelineLogic', {'src/library/sceneSpecs.ts': 'recorded-before-the-cue-rules-changed'});
});
after(async () => { await w.close(); });

const timingBlocked = (id: string) => w.svc.plan(id).blockers.some((b) => /timeline logic files changed/.test(b.message));

describe('timeline logic that changed after the project recorded it', {timeout: 300_000}, () => {
  test('an episode that already has timing is still refused when its timing would have to run', () => {
    assert.notEqual(statusReport(w.p, EP).timing.status, 'none', 'the seeded episode has timing');
    setCaptionOnly(w.p, 's2', 'That limit is called its context window.');
    assert.ok(w.svc.plan(EP).steps.some((s) => s.key === 'timing' && s.action === 'run'));
    assert.equal(timingBlocked(EP), true);
  });

  test('an episode with no timing yet is not blocked, is told why, and records the current logic for itself only', async () => {
    const plan = w.svc.plan(NEW);
    assert.equal(timingBlocked(NEW), false);
    assert.ok(plan.notes.some((n) => /never been timed/.test(n)));
    const before = getComponentHashes(w.p, EP).timelineLogic;
    w.svc.startRebuild(NEW, {seq: getEpisodeInfo(w.p, NEW).seq, requestId: requestId()});
    await until('the new episode to finish its rebuild', () => { const js = w.svc.list(NEW, 20); return js.length >= 5 && js.every((j) => j.state === 'succeeded' || j.state === 'failed') && js; }, 120_000)
      .then((js) => assert.ok(js.every((j) => j.state === 'succeeded'), js.map((j) => `${j.kind}:${j.state} ${j.error ?? ''}`).join('; ')));
    const own = w.p.db.prepare("SELECT value_json FROM components WHERE scope=? AND name='timelineLogic'").get(NEW) as {value_json: string} | undefined;
    assert.ok(own, 'the episode records its own logic');
    assert.deepEqual(JSON.parse(own.value_json), timelineLogicValue(ROOT, w.svc.tools.timeline));
    assert.equal(getComponentHashes(w.p, EP).timelineLogic, before, 'the other episode keeps what it recorded');
    assert.equal(statusReport(w.p, NEW).timing.status, 'fresh');
  });
});

describe('cue rules that changed for an episode that already has timing', {timeout: 120_000}, () => {
  let x: FakeWorkspace;
  before(() => { x = fakeWorkspace(); });
  after(async () => { await x.close(); });
  const recordWith = (file: string) => setComponent(x.p, 'timelineLogic', {...timelineLogicValue(ROOT, x.svc.tools.timeline), [file]: 'recorded-earlier'});
  const blocked = () => x.svc.plan(EP).blockers.some((b) => /timeline logic files changed/.test(b.message));
  const needsTiming = () => x.svc.plan(EP).steps.some((s) => s.key === 'timing' && s.action === 'run');

  test('only the cue rules differ and every recorded cue still resolves the same: allowed, with a note', () => {
    recordWith('src/library/sceneSpecs.ts');
    setCaptionOnly(x.p, 's2', 'That limit is called its context window.');
    assert.ok(needsTiming());
    assert.equal(blocked(), false);
    assert.ok(x.svc.plan(EP).notes.some((n) => /Only the scene cue rules changed/.test(n)));
    assert.equal(timelineLogicAdoptable(x.p, EP, {sourceRoot: ROOT, tools: x.svc.tools}), true);
  });

  test('another timeline file differs: still refused', () => {
    recordWith('core/timeline.ts');
    assert.equal(blocked(), true);
    assert.equal(timelineLogicAdoptable(x.p, EP, {sourceRoot: ROOT, tools: x.svc.tools}), false);
  });

  test('a cue rule now resolves to a different time than the recorded timing holds: refused', () => {
    recordWith('src/library/sceneSpecs.ts');
    const spec = SCENE_CUES['context-window'];
    SCENE_CUES['context-window'] = {...spec, label: {segment: 5, at: 'end'}};
    try {
      assert.equal(cueRulesPreserved(x.p, EP), false);
      assert.equal(blocked(), true);
    } finally { SCENE_CUES['context-window'] = spec; }
    assert.equal(cueRulesPreserved(x.p, EP), true);
  });
});
