// Phase 5B: applying an accepted storyboard to the episode. What is previewed and refused, the revision and the conflict
// protection, that existing scene work is never silently replaced, the production preflight, and which outputs each kind of
// scene edit makes out of date (with fake audio and render workers; real hashes, timing logic and job planner).
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {after, before, describe, test} from 'node:test';
import {blobPath} from '../../core/blobs.ts';
import {ConflictError, getEpisode, getEpisodeInfo, listRevisions, restoreRevision, saveEpisode} from '../../core/episodes.ts';
import {statusReport} from '../../core/artifacts.ts';
import {getComponentValues, setComponent} from '../../core/state.ts';
import {SoundSettingsError, clearEpisodeSound, recordEpisodeSound} from '../../core/soundSettings.ts';
import {ApplyError, PlanConflictError, acceptImport, applyStoryboard, createPlan, getPlan, listPlanRevisions, previewApplication, savePlan, submitImport} from '../../app/planning.ts';
import {estimatedPreview} from '../../app/shared/estimate.ts';
import {defaultSelection} from '../../app/shared/importing.ts';
import {summarizeChange} from '../../app/shared/revisions.ts';
import {isPlaceholderEpisode} from '../../app/shared/storyboard.ts';
import {EpisodeSchemaV2} from '../../src/schema2.ts';
import {fakeWorkspace, requestId, until, type FakeWorkspace} from './jobs-fixture.ts';

let w: FakeWorkspace;
before(() => { w = fakeWorkspace(); });
after(async () => { await w.close(); });

const SCRIPT = 'Models read text in small pieces. Those pieces are called tokens. Each token takes up room. A model can hold only so many tokens.';
const scene1 = {title: 'Tokens', cards: [{heading: 'Text', body: 'A model reads text.'}, {heading: 'Pieces', body: 'Small pieces called tokens.', at: {segment: 1, word: 'tokens'}}], actions: [{do: 'point', at: {segment: 0, word: 'pieces'}, card: 0}, {do: 'nod', at: {segment: 1, edge: 'end'}}]};
const scene2 = {cards: [{heading: 'Room', body: 'Each token takes up room.'}, {heading: 'Limit', body: 'Only so many fit.'}], actions: [{do: 'look', at: {segment: 0}, card: 1}]};
const board = (scenes: object[]) => JSON.stringify({studioPacket: 1, storyboard: {scenes}});
const GOOD = board([{segments: [1, 2], sceneType: 'pip-cards', intention: 'Introduce tokens', mechanism: 'Two cards', pip: ['Pip points at the first card'], params: scene1}, {segments: [3, 4], sceneType: 'pip-cards', intention: 'The limit', mechanism: 'Two cards', pip: [], params: scene2}]);

const seqs = (id: string) => ({plan: getPlan(w.p, id).seq, episode: getEpisodeInfo(w.p, id).seq});
const importAndAccept = (id: string, text: string, confirmReplace = false) => {
  const r = submitImport(w.p, id, {text, via: 'paste'});
  assert.equal(r.ok, true, r.ok ? '' : JSON.stringify(r.errors));
  if (!r.ok) throw new Error('unreachable');
  const s = seqs(id);
  return acceptImport(w.p, id, r.import.id, {selection: {...defaultSelection(r.import.proposal), confirmReplace}, basePlanSeq: s.plan, baseEpisodeSeq: s.episode});
};
/** A draft with an accepted script (the episode exists, with its stand-in scene). */
function draft(title: string): string {
  const made = createPlan(w.p, {title, audience: 'a', objective: 'o'});
  const r = submitImport(w.p, made.plan.id, {text: SCRIPT, via: 'paste'});
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  acceptImport(w.p, made.plan.id, r.import.id, {selection: defaultSelection(r.import.proposal), basePlanSeq: made.seq, baseEpisodeSeq: null});
  return made.plan.id;
}
const apply = (id: string, confirmReplace = false) => { const s = seqs(id); return applyStoryboard(w.p, id, {basePlanSeq: s.plan, baseEpisodeSeq: s.episode, confirmReplace}); };
const editEpisode = (id: string, fn: (d: ReturnType<typeof getEpisode>) => ReturnType<typeof getEpisode>) => saveEpisode(w.p, id, fn(structuredClone(getEpisode(w.p, id))), {baseSeq: getEpisodeInfo(w.p, id).seq});
const snapshot = (id: string) => JSON.stringify({plan: getPlan(w.p, id), ep: getEpisodeInfo(w.p, id), revs: listRevisions(w.p, id), plans: listPlanRevisions(w.p, id)});

describe('what is refused, and why, before anything is written', () => {
  test('an episode with only its stand-in scene and no storyboard cannot be applied', () => {
    const id = draft('No storyboard');
    const pre = previewApplication(w.p, id);
    assert.equal(pre.application.scenes, null);
    assert.deepEqual(pre.application.problems, ['No scenes are planned in the storyboard yet.']);
  });

  test('every kind of problem is reported scene by scene: missing parameters, an unsupported type, a custom scene, missing cue words, lines left out, lines in two scenes', () => {
    const id = draft('Problem report');
    importAndAccept(id, board([
      {segments: [1], sceneType: 'pip-cards'},
      {segments: [2], sceneType: 'hologram-3d'},
      {segments: [2, 3], sceneType: 'custom'},
      {segments: [3], sceneType: 'pip-cards', params: {cards: [{heading: 'x', at: {segment: 0, word: 'unicorn'}}], actions: [{do: 'nod', at: {segment: 5}}]}},
      {segments: [3], sceneType: 'cards', params: {title: 't', cards: [{heading: 'h', lines: [{text: 'x'}]}]}},
    ]));
    const { application: a } = previewApplication(w.p, id);
    assert.equal(a.scenes, null);
    const text = a.problems.join('\n');
    assert.match(text, /Scene 1 \(Pip cards, sb1\): Its parameters are not complete: no parameters are recorded/);
    assert.match(text, /Scene 2 \(hologram-3d, sb2\): "hologram-3d" is not a scene type this app has/);
    assert.match(text, /Scene 3 \(Custom scene \(to be built\), sb3\): A custom scene has to be designed and built by a developer/);
    assert.match(text, /Scene 4 \(Pip cards, sb4\): The "card1" moment is timed on the word "unicorn" in line 1 of the scene \(s3\)/);
    assert.match(text, /Scene 4 \(Pip cards, sb4\): The "action1" moment needs line 6 of the scene, which is not planned into this scene/);
    assert.match(text, /Scene 5 \(Cards \(dark style\), sb5\): Cards \(dark style\) is drawn only in the dark legacy style; this episode uses Pip's warm-paper style/);
    assert.match(text, /Narration with no scene: s4\./);
    assert.match(text, /Narration in more than one scene: s2, s3\./);
  });

  test('a layout the content does not fit is reported with the numbers, and changes with the layout', () => {
    const id = draft('Fit report');
    const long = 'x'.repeat(100);
    const cards = Array.from({length: 4}, (_, i) => ({heading: `Card ${i + 1}`, body: long}));
    importAndAccept(id, board([{segments: [1, 2, 3, 4], sceneType: 'pip-cards', params: {cards}}]));
    const tight = previewApplication(w.p, id).application;
    assert.equal(tight.scenes, null);
    assert.equal(tight.problems.length, 4);
    assert.match(tight.problems[0], /Scene 1 \(Pip cards, sb1\): Layout "content-led": card 1 is \d+ px tall; its text needs about \d+ px\./);
    const id2 = draft('Fit report, shorter text');
    importAndAccept(id2, board([{segments: [1, 2, 3, 4], sceneType: 'pip-cards', params: {cards: cards.map((c) => ({...c, body: 'Short.'}))}}]));
    assert.equal(previewApplication(w.p, id2).application.scenes?.length, 1);
  });

  test('scenes out of narration order are refused even when every line is covered once', () => {
    const id = draft('Order report');
    const p = {cards: [{heading: 'A'}]};
    importAndAccept(id, board([{segments: [3, 4], sceneType: 'pip-cards', params: p}, {segments: [1, 2], sceneType: 'pip-cards', params: p}]));
    assert.match(previewApplication(w.p, id).application.problems.join(' '), /scenes must follow the narration in order, without gaps \(the script runs s1, s2, s3, s4; the scenes run s3, s4, s1, s2\)/);
  });

  test('a refused application changes nothing: no revision, no new sequence, plan untouched', () => {
    const id = draft('Refusal changes nothing');
    importAndAccept(id, board([{segments: [1, 2, 3, 4], sceneType: 'custom'}]));
    const before = snapshot(id);
    assert.throws(() => apply(id), (e: unknown) => e instanceof ApplyError && /cannot be applied yet: \d+ problem/.test(e.message) && e.problems.length > 0);
    assert.equal(snapshot(id), before);
  });
});

describe('applying a complete, valid storyboard', () => {
  let id = '';
  test('the preview lists the new scenes, and nothing is written by previewing', () => {
    id = draft('Apply flow');
    importAndAccept(id, GOOD);
    const before = snapshot(id);
    const { application: a } = previewApplication(w.p, id);
    assert.deepEqual(a.problems, []);
    assert.equal(a.replaces, false, 'only the stand-in is replaced');
    assert.deepEqual(a.changes.map((c) => [c.id, c.change]), [['sb1', 'new'], ['sb2', 'new']]);
    assert.match(a.changes[0].after!, /^Pip cards · lines s1 to s2 · 2 cards \("Text", "Pieces"\) · 2 Pip actions · layout content-led$/);
    assert.equal(snapshot(id), before);
  });

  test('applying is one revision on the normal save path; the narration is untouched; the plan records it', () => {
    const before = getEpisode(w.p, id);
    const r = apply(id);
    assert.equal(r.scenes, 2);
    const after = getEpisode(w.p, id);
    assert.doesNotThrow(() => EpisodeSchemaV2.parse(after));
    assert.deepEqual(after.narration, before.narration, 'segments and blocks are exactly as they were');
    assert.deepEqual(after.scenes.map((s) => [s.id, s.type, s.segments]), [['sb1', 'pip-cards', ['s1', 's2']], ['sb2', 'pip-cards', ['s3', 's4']]]);
    assert.equal(isPlaceholderEpisode(after), false);
    const revs = listRevisions(w.p, id);
    assert.deepEqual(revs.map((x) => x.kind), ['create', 'scenes-apply']);
    assert.equal(revs[1].label, 'Scenes applied from the storyboard (2 scenes)');
    assert.deepEqual(summarizeChange(getRevisionDoc(1), after), ['Scenes: added sb1, sb2; removed storyboard-pending']);
    const plan = getPlan(w.p, id);
    assert.deepEqual(plan.plan.applied?.sceneIds, ['sb1', 'sb2']);
    assert.equal(plan.plan.applied?.episodeSeq, getEpisodeInfo(w.p, id).seq);
    assert.equal(listPlanRevisions(w.p, id)[0].kind, 'apply');
    assert.equal(JSON.parse(readFileSync(join(w.projectRoot, 'episodes', id, 'episode.json'), 'utf8')).scenes.length, 2, 'the episode file follows');
  });

  const getRevisionDoc = (n: number) => JSON.parse(w.p.db.prepare('SELECT doc_json FROM revisions WHERE episode_id=? AND number=?').get(id, n)!.doc_json as string);

  test('applying the same storyboard again says there is nothing to apply', () => {
    const before = snapshot(id);
    assert.throws(() => apply(id), (e: unknown) => e instanceof ApplyError && /already has exactly these scenes/.test(e.problems.join(' ')));
    assert.equal(snapshot(id), before);
  });

  test('production preflight: no blockers once the scenes are applied; with the stand-in it said why', () => {
    assert.deepEqual(w.svc.plan(id).blockers, []);
    const fresh = draft('Preflight before');
    const msgs = w.svc.plan(fresh).blockers.map((b) => b.message);
    assert.ok(msgs.some((m) => /only a stand-in scene/.test(m)));
  });

  test('a new episode starts without accents; its own unknown cue is refused when recorded, and is a blocker if it gets into the store anyway', () => {
    assert.deepEqual(getComponentValues(w.p, id).soundEvents, [], 'no accents of another episode');
    assert.deepEqual(w.svc.plan(id).notes.filter((n) => /sound/i.test(n)), []);
    assert.throws(() => recordEpisodeSound(w.p, id, {soundEvents: [{accent: 'pop', cue: 'window_in', gainDb: -6}]}), (e: unknown) => e instanceof SoundSettingsError && /cue "window_in", which no scene of this episode provides/.test(e.message));
    assert.deepEqual(getComponentValues(w.p, id).soundEvents, [], 'a refused record changes nothing');
    setComponent(w.p, 'soundEvents', [{accent: 'pop', cue: 'no-such-cue', gainDb: -6}], id);
    try { assert.ok(w.svc.plan(id).blockers.some((b) => /cue "no-such-cue", which no scene of this episode provides\. The mix would refuse it\./.test(b.message))); }
    finally { clearEpisodeSound(w.p, id); }
    assert.deepEqual(w.svc.plan(id).blockers, []);
  });

  test('preflight reads the scenes the episode actually has: a cue word taken out of the narration is a blocker', () => {
    const id2 = draft('Preflight cue');
    importAndAccept(id2, GOOD);
    apply(id2);
    assert.deepEqual(w.svc.plan(id2).blockers, []);
    editEpisode(id2, (d) => ({...d, narration: {...d.narration, segments: d.narration.segments.map((s) => (s.id === 's1' ? {...s, text: 'Models read text in small chunks.'} : s))}}));
    const blockers = w.svc.plan(id2).blockers.map((b) => b.message);
    assert.ok(blockers.some((m) => /times its "action1" moment on the word "pieces" in segment s1/.test(m)), blockers.join(' | '));
  });
});

describe('conflicts and atomicity', () => {
  test('a stale episode or plan sequence refuses the application and changes nothing', () => {
    const id = draft('Apply conflicts');
    importAndAccept(id, GOOD);
    const s = seqs(id);
    const before = snapshot(id);
    assert.throws(() => applyStoryboard(w.p, id, {basePlanSeq: s.plan, baseEpisodeSeq: s.episode - 1, confirmReplace: false}), ConflictError);
    assert.throws(() => applyStoryboard(w.p, id, {basePlanSeq: s.plan - 1, baseEpisodeSeq: s.episode, confirmReplace: false}), PlanConflictError);
    assert.equal(snapshot(id), before);
  });

  test('an editor save that lands first is kept: the application made from the older version is refused', () => {
    const id = draft('Apply vs editor');
    importAndAccept(id, GOOD);
    const s = seqs(id);
    editEpisode(id, (d) => ({...d, narration: {...d.narration, segments: d.narration.segments.map((x) => (x.id === 's3' ? {...x, text: 'Each token takes up a lot of room.'} : x))}}));
    assert.throws(() => applyStoryboard(w.p, id, {basePlanSeq: s.plan, baseEpisodeSeq: s.episode, confirmReplace: false}), ConflictError);
    assert.equal(getEpisode(w.p, id).narration.segments[2].text, 'Each token takes up a lot of room.');
    assert.equal(isPlaceholderEpisode(getEpisode(w.p, id)), true);
  });

  test('a failure inside the transaction leaves the plan, the episode, its revisions and its file as they were', () => {
    const id = draft('Apply atomic');
    importAndAccept(id, GOOD);
    const before = snapshot(id);
    const file = readFileSync(join(w.projectRoot, 'episodes', id, 'episode.json'), 'utf8');
    w.p.hooks.beforeCommit = () => { throw new Error('injected failure before commit'); };
    try { assert.throws(() => apply(id), /injected failure/); } finally { w.p.hooks.beforeCommit = undefined; }
    assert.equal(snapshot(id), before);
    assert.equal(readFileSync(join(w.projectRoot, 'episodes', id, 'episode.json'), 'utf8'), file);
    assert.equal(apply(id).scenes, 2, 'the same request works once the fault is gone');
  });
});

describe('existing scene work is never silently replaced', () => {
  test('after the author edits an applied scene, applying again shows the difference and needs a yes; the edited version stays in History', () => {
    const id = draft('Replace scenes');
    importAndAccept(id, GOOD);
    apply(id);
    // the author's own work in the Scenes step
    editEpisode(id, (d) => ({...d, scenes: d.scenes.map((s) => (s.id === 'sb1' ? {...s, params: {...(s.params as object), title: 'My own title'}} : s)) as never}));
    const edited = getEpisode(w.p, id).scenes;
    // the plan changes (a scene is dropped from the storyboard)
    const stored = getPlan(w.p, id);
    savePlan(w.p, id, {...stored.plan, storyboard: stored.plan.storyboard.map((s) => (s.id === 'sb2' ? {...s, segmentIds: ['s3', 's4']} : {...s, segmentIds: ['s1', 's2']}))}, {baseSeq: stored.seq});
    const { application: a } = previewApplication(w.p, id);
    assert.equal(a.replaces, true);
    assert.deepEqual(a.changes.map((c) => [c.id, c.change]), [['sb1', 'changed'], ['sb2', 'same']]);
    assert.match(a.confirm[0], /already has 2 scenes of its own. Applying changes 1 of them \(1 changed, 0 new, 0 removed\)/);
    const before = snapshot(id);
    assert.throws(() => apply(id, false), (e: unknown) => e instanceof ApplyError && /needs your confirmation first/.test(e.message));
    assert.equal(snapshot(id), before, 'nothing changed without the yes');
    apply(id, true);
    assert.equal((getEpisode(w.p, id).scenes[0].params as {title?: string}).title, 'Tokens');
    const revs = listRevisions(w.p, id);
    assert.deepEqual(revs.map((r) => r.kind), ['create', 'scenes-apply', 'scenes-before', 'scenes-apply']);
    // recover the author's own version with the existing restore
    const before2 = revs.find((r) => r.kind === 'scenes-before')!;
    assert.equal(before2.label, 'Before the storyboard was applied');
    const back = restoreRevision(w.p, id, before2.number);
    assert.equal(back.changed, true);
    assert.deepEqual(getEpisode(w.p, id).scenes, edited);
    assert.equal((getEpisode(w.p, id).scenes[0].params as {title?: string}).title, 'My own title');
  });
});

describe('which outputs a scene edit makes out of date (fake audio and render workers)', () => {
  let id = '';
  const steps = () => Object.fromEntries(w.svc.plan(id).steps.map((s) => [s.key, s.action]));
  const build = async () => {
    const r = w.svc.startRebuild(id, {seq: getEpisodeInfo(w.p, id).seq, requestId: requestId()});
    await until(`rebuild ${r.rebuildId} to finish`, () => { const x = w.svc.rebuilds(id, 20).find((y) => y.id === r.rebuildId)?.state; return x === 'complete' || x === 'failed'; });
    assert.equal(w.svc.rebuilds(id, 20).find((x) => x.id === r.rebuildId)?.state, 'complete', w.svc.list(id, 50).map((j) => `${j.label}: ${j.state} ${j.error ?? ''}`).join('; '));
  };
  const setScene = (n: number, fn: (p: any) => any) => editEpisode(id, (d) => ({...d, scenes: d.scenes.map((s, i) => (i === n ? {...s, params: fn(structuredClone(s.params))} : s)) as never}));

  test('the first rebuild plans every stage and finishes; then everything is up to date', async () => {
    id = draft('Freshness');
    importAndAccept(id, GOOD);
    apply(id);
    assert.deepEqual(steps(), {'take:b1': 'run', timing: 'run', 'mix:final': 'run', 'render:final': 'run'});
    await build();
    assert.deepEqual(steps(), {'take:b1': 'current', timing: 'current', 'mix:final': 'current', 'render:final': 'current'});
  });

  test('card text and Pip options that do not move a cue: only the video is out of date, narration and timing are kept', () => {
    setScene(0, (p) => { p.cards[0].body = 'A model reads any text.'; p.idle = false; return p; });
    assert.deepEqual(steps(), {'take:b1': 'current', timing: 'current', 'mix:final': 'current', 'render:final': 'run'});
    const s = statusReport(w.p, id);
    assert.equal(s.timing.status, 'fresh');
    assert.deepEqual(Object.values(s.takes).map((t) => t.status), ['fresh']);
  });

  test('the layout and the caption setting are video-only too', async () => {
    await build();
    editEpisode(id, (d) => ({...d, scenes: d.scenes.map((s, i) => (i === 0 ? {...s, layout: {...(s.layout as object), template: 'dense-pip', captionZone: 'off'}} : s)) as never}));
    assert.deepEqual(steps(), {'take:b1': 'current', timing: 'current', 'mix:final': 'current', 'render:final': 'run'});
  });

  test('moving a cue (a card that appears on another word) or adding a Pip action re-times and re-renders, and keeps the narration', async () => {
    await build();
    setScene(0, (p) => { p.cards[1].at = {segment: 1, word: 'called'}; return p; });
    assert.deepEqual(steps(), {'take:b1': 'current', timing: 'run', 'mix:final': 'current', 'render:final': 'run'});
    await build();
    assert.deepEqual(steps(), {'take:b1': 'current', timing: 'current', 'mix:final': 'current', 'render:final': 'current'});
    setScene(1, (p) => { p.actions.push({do: 'hop', at: {segment: 1, edge: 'end'}}); return p; });
    assert.deepEqual(steps(), {'take:b1': 'current', timing: 'run', 'mix:final': 'current', 'render:final': 'run'});
  });

  test('the timeline the timing job writes carries the cues of the scene parameters', async () => {
    await build();
    const row = w.p.db.prepare("SELECT blob_hash FROM artifacts WHERE episode_id=? AND kind='timing' ORDER BY id DESC LIMIT 1").get(id) as {blob_hash: string};
    const tl = JSON.parse(readFileSync(blobPath(w.p, row.blob_hash), 'utf8'));
    assert.deepEqual(Object.keys(tl.cues.sb1), ['card1', 'card2', 'action1', 'action2', 'voice_end']);
    assert.deepEqual(Object.keys(tl.cues.sb2), ['card1', 'card2', 'action1', 'action2', 'voice_end']);
    assert.equal(tl.cues.sb1.card2 > tl.cues.sb1.card1, true);
  });

  test('a spoken-text edit still stales the narration first, as for any episode', () => {
    editEpisode(id, (d) => ({...d, narration: {...d.narration, segments: d.narration.segments.map((s) => (s.id === 's3' ? {...s, text: 'Each token uses a little room.'} : s))}}));
    assert.equal(steps()['take:b1'], 'run');
  });
});

describe('the composition preview', () => {
  test('is made from estimated timing: every scene resolves its cues, there is no audio, and it says it is a preview', () => {
    const id = draft('Preview');
    importAndAccept(id, GOOD);
    apply(id);
    const e = estimatedPreview(getEpisode(w.p, id));
    assert.deepEqual(e.problems, []);
    assert.equal(e.data.previewOnly, true);
    assert.equal(e.data.timeline.audio, '');
    assert.deepEqual(Object.keys(e.data.timeline.cues!.sb1), ['card1', 'card2', 'action1', 'action2', 'voice_end']);
    assert.ok(e.durationSec > 6 && e.durationSec < 40);
    assert.equal(e.data.timeline.scenes.length, 2);
    assert.equal(e.data.timeline.scenes[1].start > 0, true);
  });
  test('a cue that cannot be found is reported instead of drawn', () => {
    const id = draft('Preview bad cue');
    importAndAccept(id, GOOD);
    apply(id);
    const doc = getEpisode(w.p, id);
    const broken = {...doc, narration: {...doc.narration, segments: doc.narration.segments.map((s) => (s.id === 's1' ? {...s, text: 'Models read text in small chunks.'} : s))}};
    assert.match(estimatedPreview(broken).problems.join(' '), /no word "pieces"/);
  });
});
