// What accepting an import would change, before anything is written: the pure planner, the storyboard checks and the
// catalog of scene types (kept in step with the schema and the registry).
import assert from 'node:assert/strict';
import {describe, test} from 'node:test';
import {readFileSync} from 'node:fs';
import {EpisodeSchemaV2, SceneSchemaV2} from '../../src/schema2.ts';
import {briefFor} from '../../app/shared/handoff.ts';
import {ImportError, applyImport, defaultSelection, findSource, makeBlocks, planImport, type Selection} from '../../app/shared/importing.ts';
import {parseInput, type ParseContext, type Proposal} from '../../app/shared/packet.ts';
import {newPlan, researchWarnings, slugify, uniqueId, validatePlan} from '../../app/shared/plan.ts';
import {SCENE_TYPES, checkStoryboard, cueProblems, episodeScenesFromPlan, isPlaceholderEpisode, productionBlockers} from '../../app/shared/storyboard.ts';

const meta = {importId: 1, sha256: 'a'.repeat(64), at: 1_700_000_000_000, source: 'pasted text'};
const plan = () => newPlan({id: 'tokens', title: 'What is a token?', audience: 'Curious beginners', objective: 'Know what a token is', durationMin: 2});
const read = (obj: object, ctx: ParseContext = {existingSourceIds: [], existingScriptSegments: null}): Proposal => {
  const r = parseInput(JSON.stringify({studioPacket: 1, ...obj}), ctx);
  assert.equal(r.ok, true, r.ok ? '' : JSON.stringify(r.errors));
  return (r as {proposal: Proposal}).proposal;
};
const script = (...lines: string[]) => ({script: {segments: lines.map((text) => ({text}))}});

describe('accepting a first script creates the episode', () => {
  test('a valid episode with a stand-in scene, ids s1..sn, blocks of at most 60 words, and provenance on the plan', () => {
    const proposal = read(script('A model reads text in pieces.', 'Those pieces are called tokens.'));
    const r = applyImport({plan: plan(), episode: null, proposal, selection: defaultSelection(proposal), meta});
    assert.equal(r.episode.mode, 'create');
    const doc = r.episode.doc!;
    assert.doesNotThrow(() => EpisodeSchemaV2.parse(doc));
    assert.deepEqual(doc.narration.segments.map((s) => s.id), ['s1', 's2']);
    assert.equal(doc.title, 'What is a token?');
    assert.equal(doc.learningObjective, 'Know what a token is');
    assert.equal(isPlaceholderEpisode(doc), true);
    assert.deepEqual(doc.scenes[0].segments, ['s1', 's2']);
    assert.deepEqual(r.plan.script.provenance, meta);
    assert.match(r.label, /^Imported from pasted text \(#1, aaaaaaaaaaaa\)$/);
  });

  test('blocks never split a segment and stay within 60 words', () => {
    const seg = (id: string, n: number) => ({id, text: Array(n).fill('w').join(' ')});
    assert.deepEqual(makeBlocks([seg('s1', 30), seg('s2', 30), seg('s3', 30)]).map((b) => b.segments), [['s1', 's2'], ['s3']]);
    assert.deepEqual(makeBlocks([seg('s1', 90)]).map((b) => b.segments), [['s1']]);
  });

  test('an empty row, no rows, or too many rows block the import with a clear reason', () => {
    const proposal = read(script('One.', 'Two.'));
    const sel = (rows: {text: string}[]): Selection => ({...defaultSelection(proposal), script: rows});
    assert.throws(() => applyImport({plan: plan(), episode: null, proposal, selection: sel([{text: 'ok'}, {text: '  '}]), meta}), /Segment 2 is empty/);
    assert.throws(() => applyImport({plan: plan(), episode: null, proposal, selection: sel([]), meta}), /no segments/);
    assert.throws(() => applyImport({plan: plan(), episode: null, proposal, selection: sel(Array.from({length: 201}, () => ({text: 'x'}))), meta}), /at most 200/);
  });
});

describe('sources and claims', () => {
  const proposal = read({sources: [{title: 'Guide', url: 'https://www.example.org/guide/'}, {title: 'Notes'}], claims: [{text: 'A', kind: 'fact', sources: [0]}, {text: 'B', kind: 'assumption'}]});
  test('they are added with new ids, provenance and links between them', () => {
    const r = applyImport({plan: plan(), episode: null, proposal, selection: defaultSelection(proposal), meta});
    assert.deepEqual(r.plan.sources.map((s) => s.id), ['src1', 'src2']);
    assert.deepEqual(r.plan.claims.map((c) => [c.id, c.sourceIds]), [['c1', ['src1']], ['c2', []]]);
    assert.deepEqual(r.plan.sources[0].provenance, meta);
    assert.equal(r.plan.sources[0].checked, null, 'a saved link is never marked checked by the app');
    assert.equal(r.episode.mode, 'none');
  });
  test('a source that is already recorded (same address, however written) is not added twice', () => {
    const first = applyImport({plan: plan(), episode: null, proposal, selection: defaultSelection(proposal), meta}).plan;
    const again = read({sources: [{title: 'The guide again', url: 'http://example.org/guide'}]});
    assert.equal(findSource(first.sources, again.sources[0])?.id, 'src1', 'scheme, a leading www and a trailing slash do not make a different page');
    assert.equal(findSource(first.sources, {title: 'x', url: 'https://example.org/guide?page=2'}), undefined, 'a different query is a different page');
    const same = read({sources: [{title: 'Guide (copy)', url: 'https://example.org/guide'}], claims: [{text: 'C', kind: 'fact', sources: [0]}]});
    const {preview, result} = planImport({plan: first, episode: null, proposal: same, selection: defaultSelection(same), meta: {...meta, importId: 2}});
    assert.equal(preview.sources[0].action, 'already-recorded');
    assert.equal(result!.plan.sources.length, 2);
    assert.deepEqual(result!.plan.claims.at(-1)!.sourceIds, ['src1']);
  });
  test('a claim whose source was not accepted loses that link and the preview says so', () => {
    const {preview, result} = planImport({plan: plan(), episode: null, proposal, selection: {...defaultSelection(proposal), sources: [1]}, meta});
    assert.deepEqual(preview.claims[0].lostLinks, [0]);
    assert.deepEqual(result!.plan.claims[0].sourceIds, []);
  });
  test('unselected items are not added at all', () => {
    const r = applyImport({plan: plan(), episode: null, proposal, selection: {...defaultSelection(proposal), sources: [], claims: [1]}, meta});
    assert.deepEqual([r.plan.sources.length, r.plan.claims.length], [0, 1]);
  });
  test('research warnings: facts without sources, unknown sources, unchecked sources', () => {
    const r = applyImport({plan: plan(), episode: null, proposal: read({claims: [{text: 'Bare fact', kind: 'fact'}]}), selection: {sources: [], claims: [0], script: null, storyboard: false, confirmReplace: false}, meta}).plan;
    assert.match(researchWarnings(r)[0].text, /fact with no source/);
    const withSrc = applyImport({plan: plan(), episode: null, proposal, selection: defaultSelection(proposal), meta}).plan;
    assert.equal(researchWarnings(withSrc).some((w) => /rests only on sources you have not checked/.test(w.text)), true);
  });
});

describe('replacing an existing script', () => {
  const created = () => {
    const first = read(script('One line here.', 'Two lines here.', 'Three lines here.'));
    const r = applyImport({plan: plan(), episode: null, proposal: first, selection: defaultSelection(first), meta});
    return {plan: r.plan, episode: {doc: r.episode.doc!, seq: 5}};
  };
  test('needs an explicit yes, and the preview lists every changed, new and removed line', () => {
    const {plan: p, episode} = created();
    const next = read(script('One line here.', 'Two lines, reworded.'), {existingSourceIds: [], existingScriptSegments: 3});
    const sel = defaultSelection(next);
    const {preview, result} = planImport({plan: p, episode, proposal: next, selection: sel, meta});
    assert.equal(result, null);
    assert.equal(preview.script.mode, 'replace');
    assert.deepEqual(preview.script.rows.map((r) => [r.id, r.change]), [['s1', 'same'], ['s2', 'changed'], ['s3', 'removed']]);
    assert.match(preview.confirm[0], /Replace the script: 2 of 3 lines change/);
    assert.throws(() => applyImport({plan: p, episode, proposal: next, selection: sel, meta}), /needs your confirmation/);
    const yes = applyImport({plan: p, episode, proposal: next, selection: {...sel, confirmReplace: true}, meta});
    assert.equal(yes.episode.mode, 'replace');
    assert.deepEqual(yes.episode.doc!.narration.segments.map((s) => [s.id, s.text]), [['s1', 'One line here.'], ['s2', 'Two lines, reworded.']]);
    assert.doesNotThrow(() => EpisodeSchemaV2.parse(yes.episode.doc));
  });
  test('a segment whose text is unchanged keeps everything the author set on it', () => {
    const {plan: p, episode} = created();
    episode.doc.narration.segments[0].captions = ['One line', 'here.'];
    const next = read(script('One line here.', 'Brand new second.', 'Three lines here.'));
    const r = applyImport({plan: p, episode, proposal: next, selection: {...defaultSelection(next), confirmReplace: true}, meta});
    assert.deepEqual(r.episode.doc!.narration.segments[0].captions, ['One line', 'here.']);
    assert.equal(r.episode.doc!.narration.segments[2].text, 'Three lines here.');
  });
  test('an identical script is reported as unchanged and needs no confirmation', () => {
    const {plan: p, episode} = created();
    const same = read(script('One line here.', 'Two lines here.', 'Three lines here.'));
    const {preview, result} = planImport({plan: p, episode, proposal: same, selection: defaultSelection(same), meta});
    assert.equal(preview.script.mode, 'unchanged');
    assert.equal(result!.episode.mode, 'none');
  });
  test('an episode that has real scenes, or beats pointing at removed lines, is never overwritten', () => {
    const {plan: p, episode} = created();
    const real = {doc: {...episode.doc, scenes: [{...episode.doc.scenes[0], id: 'sc1'}]}, seq: 6};
    const next = read(script('Only one.'));
    assert.throws(() => applyImport({plan: p, episode: real, proposal: next, selection: {...defaultSelection(next), confirmReplace: true}, meta}), ImportError);
    const beat = {doc: {...episode.doc, beats: [{id: 'b1', segment: 's3', cue: 'x', at: 'start' as const}]}, seq: 6};
    assert.throws(() => applyImport({plan: p, episode: beat, proposal: next, selection: {...defaultSelection(next), confirmReplace: true}, meta}), /Beats or markers point at s3/);
  });
  test('notes anchored to a removed line stay, without the anchor', () => {
    const {plan: p, episode} = created();
    episode.doc.reviewNotes = [{id: 'n1', text: 'check', type: 'general', status: 'open', anchor: {segment: 's3'}}];
    const next = read(script('One line here.', 'Two lines here.'));
    const r = applyImport({plan: p, episode, proposal: next, selection: {...defaultSelection(next), confirmReplace: true}, meta});
    assert.equal(r.episode.doc!.reviewNotes.length, 1);
    assert.equal(r.episode.doc!.reviewNotes[0].anchor, undefined);
  });
});

describe('the storyboard', () => {
  const both = read({...script('A model reads text.', 'It reads in pieces.', 'The pieces are tokens.'), storyboard: {scenes: [{segments: [1, 2], sceneType: 'pip-cards', intention: 'show', mechanism: 'two cards', pip: ['points']}, {segments: [3], sceneType: 'hologram-3d', intention: '', mechanism: '', pip: []}]}});
  test('positions become segment ids and the plan keeps what the author asked for, including a type the app does not have', () => {
    const r = applyImport({plan: plan(), episode: null, proposal: both, selection: defaultSelection(both), meta});
    assert.deepEqual(r.plan.storyboard.map((s) => [s.id, s.segmentIds, s.sceneType]), [['sb1', ['s1', 's2'], 'pip-cards'], ['sb2', ['s3'], 'hologram-3d']]);
    assert.deepEqual(r.plan.storyboard[0].provenance, meta);
  });
  test('replacing an existing storyboard needs a yes', () => {
    const first = applyImport({plan: plan(), episode: null, proposal: both, selection: defaultSelection(both), meta});
    const next = read({storyboard: {scenes: [{segments: [1, 2, 3], sceneType: 'custom'}]}}, {existingSourceIds: [], existingScriptSegments: 3});
    const {preview, result} = planImport({plan: first.plan, episode: {doc: first.episode.doc!, seq: 2}, proposal: next, selection: defaultSelection(next), meta});
    assert.equal(result, null);
    assert.equal(preview.storyboard.mode, 'replace');
    assert.match(preview.confirm[0], /Replace the storyboard: 2 planned scenes become 1/);
  });
  test('without parameters an available type is incomplete, and an unknown type is unsupported', () => {
    const r = applyImport({plan: plan(), episode: null, proposal: both, selection: defaultSelection(both), meta});
    const check = checkStoryboard(r.plan, r.episode.doc!.narration.segments);
    assert.deepEqual(check.scenes.map((s) => [s.kind, s.state]), [['reusable', 'incomplete'], ['unsupported', 'unsupported']]);
    assert.match(check.scenes[0].blockers.join(' '), /parameters are not complete: .*no parameters are recorded/);
    assert.match(check.scenes[1].blockers[0], /"hologram-3d" is not a scene type this app has/);
    assert.equal(check.producible, false);
    assert.equal(check.summary, '0 of 2 planned scenes are ready, 1 incomplete (content, cue words or room missing), 1 of an unsupported type.');
  });
  test('a custom scene needs implementation; unassigned lines are named', () => {
    const p = {...plan(), storyboard: [{id: 'sb1', segmentIds: ['s1'], sceneType: 'custom', intention: '', mechanism: '', pip: [], provenance: null}]};
    const c = checkStoryboard(p, [{id: 's1', text: 'a'}, {id: 's2', text: 'b'}]);
    assert.deepEqual([c.scenes[0].kind, c.scenes[0].state], ['custom', 'custom']);
    assert.match(c.scenes[0].blockers[0], /developer/);
    assert.deepEqual(c.unassigned, ['s2']);
    assert.match(c.problems.join(' '), /1 narration segment is in no scene \(s2\)/);
  });
  test('a scene tied to its own content reports the cue words the narration lacks, and passes when they are there', () => {
    const lines = ['A model can only read so much at once.', 'That limit is called the context window.', 'Your text is split into pieces called tokens.', 'The history is kept.', 'The reply is written.', 'Input and output share the window.', 'The window fills.', 'Some stop. Others drop older text.'].map((text, i) => ({id: `s${i + 1}`, text}));
    const seg = new Map(lines.map((l) => [l.id, l]));
    assert.deepEqual(cueProblems('context-window', lines.map((l) => l.id), seg), []);
    const missing = cueProblems('context-window', lines.slice(0, 3).map((l) => l.id), seg);
    assert.equal(missing.length > 0, true);
    assert.match(missing[0], /needs line \d+ of the scene/);
    const reworded = new Map(lines.map((l) => [l.id, l.id === 's2' ? {...l, text: 'That limit has a name.'} : l]));
    assert.match(cueProblems('context-window', lines.map((l) => l.id), reworded).join(' '), /timed on the word "context" in line 2 of the scene \(s2\)/);
  });
  test('the rebuild blockers include the stand-in scene and why the storyboard is not ready', () => {
    const r = applyImport({plan: plan(), episode: null, proposal: both, selection: defaultSelection(both), meta});
    const b = productionBlockers(r.plan, r.episode.doc!);
    assert.equal(b.length, 2);
    assert.match(b[0].message, /only a stand-in scene/);
    assert.match(b[1].message, /^Storyboard: 0 of 2 planned scenes are ready/);
  });
});

describe('a storyboard with parameters can become ready', () => {
  const CARDS = {title: 'Tokens', cards: [{heading: 'Text', body: 'A model reads text.'}, {heading: 'Pieces', body: 'In small pieces.'}]};
  const planWith = (scenes: object[]) => ({...plan(), storyboard: scenes.map((s, i) => ({id: `sb${i + 1}`, intention: '', mechanism: '', pip: [], provenance: null, ...s})) as never});
  const lines = [{id: 's1', text: 'A model reads text.'}, {id: 's2', text: 'In small pieces.'}];

  test('valid parameters on an available type make the scene ready, and the storyboard producible when every line is covered', () => {
    const p = planWith([{segmentIds: ['s1', 's2'], sceneType: 'pip-cards', params: CARDS}]);
    const c = checkStoryboard(p, lines);
    assert.deepEqual(c.scenes.map((s) => s.state), ['ready']);
    assert.deepEqual(c.scenes[0].blockers, []);
    assert.equal(c.producible, true);
    assert.deepEqual(c.problems, []);
    assert.equal(c.summary, '1 of 1 planned scene is ready.');
  });

  test("parameters that fail the type's own schema leave it incomplete, naming the field", () => {
    const p = planWith([{segmentIds: ['s1', 's2'], sceneType: 'pip-cards', params: {title: 'x', cards: [{heading: '', body: 'a'}]}}]);
    const c = checkStoryboard(p, lines);
    assert.equal(c.scenes[0].state, 'incomplete');
    assert.match(c.scenes[0].blockers.join(' '), /params\.cards\.0\.heading/);
    assert.equal(c.producible, false);
  });

  test('all four states appear side by side, each with its own reason', () => {
    const p = planWith([
      {segmentIds: ['s1'], sceneType: 'pip-cards', params: CARDS},
      {segmentIds: ['s2'], sceneType: 'pip-cards'},
      {segmentIds: ['s3'], sceneType: 'custom'},
      {segmentIds: ['s4'], sceneType: 'hologram-3d'},
    ]);
    const c = checkStoryboard(p, [1, 2, 3, 4].map((n) => ({id: `s${n}`, text: `Line ${n}.`})));
    assert.deepEqual(c.scenes.map((s) => s.state), ['ready', 'incomplete', 'custom', 'unsupported']);
    assert.equal(c.summary, '1 of 4 planned scenes are ready, 1 incomplete (content, cue words or room missing), 1 custom (need implementation), 1 of an unsupported type.');
  });

  test('an own-content scene is ready only with valid parameters and the narration its cues need', () => {
    const narration = ['A model can only read so much at once.', 'That limit is its context window.', 'Your text is cut into small pieces called tokens.', 'Each token uses up some room.', 'The reply uses room too.', 'In many models, input and output share one budget.', 'When it fills, what happens depends on the product.', 'Some stop. Others drop older text.'].map((text, i) => ({id: `s${i + 1}`, text}));
    const params = {prompt: 'Why is the sky blue today?', pieces: ['Why', ' is', ' the', ' sky', ' blue', ' to', 'day', '?'], capacity: 60, inputTokens: 24, outputTokens: 36};
    const ids = narration.map((n) => n.id);
    const good = planWith([{segmentIds: ids, sceneType: 'context-window', params}]);
    assert.equal(checkStoryboard(good, narration).scenes[0].state, 'ready');
    const noParams = planWith([{segmentIds: ids, sceneType: 'context-window'}]);
    assert.equal(checkStoryboard(noParams, narration).scenes[0].state, 'incomplete');
    const reworded = narration.map((n) => (n.id === 's2' ? {...n, text: 'That limit has a name.'} : n));
    const c = checkStoryboard(good, reworded);
    assert.equal(c.scenes[0].state, 'incomplete');
    assert.match(c.scenes[0].blockers.join(' '), /timed on the word "context"/);
  });

  test('a ready storyboard converts to scenes that the episode schema accepts; one that is not ready converts to nothing', () => {
    const proposal = read(script('A model reads text.', 'In small pieces.'));
    const made = applyImport({plan: plan(), episode: null, proposal, selection: defaultSelection(proposal), meta});
    const p = planWith([{segmentIds: ['s1', 's2'], sceneType: 'pip-cards', params: CARDS}]);
    const scenes = episodeScenesFromPlan(p, made.episode.doc!.narration.segments);
    assert.ok(scenes);
    assert.doesNotThrow(() => EpisodeSchemaV2.parse({...made.episode.doc!, scenes}));
    assert.equal(episodeScenesFromPlan(planWith([{segmentIds: ['s1', 's2'], sceneType: 'pip-cards'}]), made.episode.doc!.narration.segments), null);
    const ready = productionBlockers(p, made.episode.doc!);
    assert.equal(ready.length, 1);
    assert.match(ready[0].message, /planned scenes are ready but have not been applied to this episode/);
  });

  test('parameters in a pasted packet are checked at import against the scene type, with the exact path', () => {
    const none = {existingSourceIds: [], existingScriptSegments: null};
    const base = {studioPacket: 1, script: {segments: [{text: 'A model reads text.'}]}};
    const ok = parseInput(JSON.stringify({...base, storyboard: {scenes: [{segments: [1], sceneType: 'pip-cards', params: CARDS}]}}), none);
    assert.equal(ok.ok, true);
    const bad = parseInput(JSON.stringify({...base, storyboard: {scenes: [{segments: [1], sceneType: 'pip-cards', params: {title: 'x', cards: [{heading: 5}]}}, {segments: [1], sceneType: 'custom', params: {a: 1}}]}}), none);
    assert.equal(bad.ok, false);
    const errs = (bad as {errors: {path: string; message: string}[]}).errors;
    assert.equal(errs[0].path, 'storyboard.scenes[0].params.cards[0].heading');
    assert.match(errs[0].message, /must be a string, but it is a number/);
    assert.equal(errs[1].path, 'storyboard.scenes[1].params');
    assert.match(errs[1].message, /only be given for a scene type this app has/);
  });
});

describe('the scene catalog', () => {
  test('lists exactly the scene types the episode schema has, plus "custom"; registered Pip scenes are marked as tied to their content', () => {
    const schemaTypes = SceneSchemaV2.options.map((o) => o.shape.type.value as string).sort();
    const catalog = SCENE_TYPES.filter((t) => t.id !== 'custom').map((t) => t.id).sort();
    assert.deepEqual(catalog, schemaTypes);
    // the registry imports React components, so it is read as text rather than loaded
    const registered = [...readFileSync('src/library/registry.ts', 'utf8').matchAll(/^\s*'([a-z0-9-]+)':\s*\{type:/gm)].map((m) => m[1]);
    assert.deepEqual(registered.sort(), ['context-window', 'pip-cards', 'pip-dense-fixture', 'pip-scene-10x']);
    for (const id of registered.filter((r) => r !== 'pip-cards')) assert.notEqual(SCENE_TYPES.find((t) => t.id === id)?.reuse, 'data-driven', `${id} is a registered Pip scene tied to its content`);
    assert.equal(SCENE_TYPES.find((t) => t.id === 'pip-cards')?.reuse, 'data-driven', 'the one reusable Pip scene');
    for (const t of SCENE_TYPES.filter((t) => t.reuse === 'data-driven' && !t.pip)) assert.equal(registered.includes(t.id), false, `${t.id} is a legacy data-driven scene`);
  });
});

describe('plans and briefs', () => {
  test('ids come from titles and never collide', () => {
    assert.equal(slugify('What is a token? (Part 1)'), 'what-is-a-token-part-1');
    assert.equal(slugify('!!!'), 'episode');
    assert.equal(uniqueId('tokens', ['tokens', 'tokens-2']), 'tokens-3');
  });
  test('the plan schema is strict: unknown fields, non-http links and bad dates are refused', () => {
    const p = {...plan(), sources: [{id: 'src1', title: 'x', url: 'file:///etc/passwd', publisher: '', published: '2024-13', note: '', checked: null, provenance: null}]};
    const v = validatePlan(p);
    assert.equal(v.ok, false);
    const paths = (v as {issues: {path: string}[]}).issues.map((i) => i.path);
    assert.deepEqual(paths.sort(), ['sources[0].published', 'sources[0].url']);
    assert.equal(validatePlan({...plan(), extra: 1}).ok, false);
  });
  test('each brief states the episode, the exact format, and the rules, and writes only text', () => {
    const p = {...plan(), notes: 'Keep it playful.'};
    const research = briefFor('research', p);
    assert.match(research, /Title: What is a token\?/);
    assert.match(research, /about 2 minutes \(roughly 300 words of narration\)/);
    assert.match(research, /"studioPacket": 1/);
    assert.match(research, /Never invent a link/);
    assert.match(research, /Keep it playful\./);
    const s = briefFor('script', p);
    assert.match(s, /If you cannot produce JSON, reply with the plain script/);
    const sb = briefFor('storyboard', p, [{id: 's1', text: 'First line.'}, {id: 's2', text: 'Second line.'}]);
    assert.match(sb, /1\. First line\.\n2\. Second line\./);
    for (const t of SCENE_TYPES) assert.match(sb, new RegExp(`"${t.id}"`));
    assert.match(briefFor('storyboard', p), /no accepted script yet/);
  });
  test('a brief that includes example JSON is itself a valid packet', () => {
    for (const kind of ['research', 'script', 'storyboard'] as const) {
      const text = briefFor(kind, plan(), [{id: 's1', text: 'a'}, {id: 's2', text: 'b'}]);
      const block = /```json\n([\s\S]*?)\n```/.exec(text)![1];
      const r = parseInput(block, {existingSourceIds: [], existingScriptSegments: 2});
      // the research example refers to source 0 and the storyboard example to segments 1 and 2
      assert.equal(r.ok, true, `${kind}: ${r.ok ? '' : JSON.stringify(r.errors)}`);
    }
  });
});
