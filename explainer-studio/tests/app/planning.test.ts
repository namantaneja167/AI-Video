// The planning workspace end to end on a real server and a real project store (fake workers, a temp workspace):
// drafts, research, imports that arrive as Proposed, acceptance through the normal save path, conflicts, atomicity,
// history, and that nothing here touches an existing episode or makes work for a build.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import dns from 'node:dns';
import {existsSync, readFileSync, readdirSync, rmSync, writeFileSync} from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import {join} from 'node:path';
import {after, before, describe, test} from 'node:test';
import {DatabaseSync} from 'node:sqlite';
import {all, get, SCHEMA_VERSION} from '../../core/db.ts';
import {statusReport} from '../../core/artifacts.ts';
import {getEpisode, getEpisodeInfo, listEpisodes, listRevisions} from '../../core/episodes.ts';
import {Project} from '../../core/project.ts';
import {seedDemo} from '../../app/demo.ts';
import {baselineSources} from '../baseline-sources.ts';
import {acceptImport, createPlan, getPlan, submitImport} from '../../app/planning.ts';
import {defaultSelection} from '../../app/shared/importing.ts';
import {EpisodeSchemaV2} from '../../src/schema2.ts';
import {api, startApp, type Harness} from './harness.ts';
import {tmpdir} from 'node:os';
import {mkdtempSync} from 'node:fs';

let h: Harness;
let call: ReturnType<typeof api>;
let initial: ReturnType<typeof baseline>;
before(async () => { h = await startApp({jobs: true}); call = api(h); initial = baseline(); });
after(async () => { await h.close(); });

const BASE = 'context-window';
const count = (table: string, where = '1=1', ...args: any[]) => (get<{n: number}>(h.project.db.prepare(`SELECT count(*) AS n FROM ${table} WHERE ${where}`), ...args))!.n;
const baseline = () => ({
  doc: getEpisodeInfo(h.project, BASE), jobs: count('jobs'), artifacts: count('artifacts'), revisions: count('revisions', 'episode_id=?', BASE),
  status: JSON.stringify(statusReport(h.project, BASE)), plan: JSON.stringify(h.jobs!.plan(BASE).steps.map((s) => `${s.key}:${s.action}`)),
});
const sha = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');
const noNetwork = <T>(fn: () => T): {result: T; attempts: string[]} => {
  const attempts: string[] = [];
  const saved = {fetch: globalThis.fetch, connect: net.Socket.prototype.connect, lookup: dns.lookup, req: http.request, sreq: https.request, get: http.get};
  const trip = (what: string) => (): never => { attempts.push(what); throw new Error(`network blocked: ${what}`); };
  (globalThis as any).fetch = trip('fetch');
  net.Socket.prototype.connect = trip('socket connect') as never;
  (dns as any).lookup = trip('dns lookup');
  (http as any).request = trip('http.request'); (https as any).request = trip('https.request'); (http as any).get = trip('http.get');
  try { return {result: fn(), attempts}; } finally {
    globalThis.fetch = saved.fetch; net.Socket.prototype.connect = saved.connect; (dns as any).lookup = saved.lookup;
    (http as any).request = saved.req; (https as any).request = saved.sreq; (http as any).get = saved.get;
  }
};

const SCRIPT = `Large models read text in small pieces. Those pieces are called tokens.

A token is not always a word. Sometimes it is just part of one.

Every model has a limit on how many tokens it can hold at once.`;
const RESEARCH = {studioPacket: 1, sources: [{title: 'Author notes on tokens', note: 'My own outline'}, {title: 'A tokenizer guide', url: 'https://example.org/tokenizers', publisher: 'Example Org', published: '2024-05-14'}], claims: [{text: 'A token is a piece of text a model reads.', kind: 'fact', sources: [1], evidence: 'Section 1 of the guide', caveat: 'Pieces differ between models'}, {text: 'Viewers know what a model is.', kind: 'assumption'}]};
const STORYBOARD = {studioPacket: 1, storyboard: {scenes: [{segments: [1, 2], sceneType: 'pip-cards', intention: 'Introduce tokens', mechanism: 'Two cards', pip: ['Pip points at a card']}, {segments: [3, 4], sceneType: 'custom', intention: 'Show a word split', mechanism: 'A word breaking into pieces', pip: ['Pip tilts head']}, {segments: [5], sceneType: 'context-window', intention: 'The limit', mechanism: 'A window', pip: []}]}};

let P = '';
let planSeq = 0;
const imp = async (text: string, via = 'paste', id = P) => call('POST', `/api/plans/${id}/imports`, {text, via, sourceName: via === 'file' ? 'chat-1.md' : undefined});
const rows = (r: any) => r.json.import.proposal.script as {text: string}[];

describe('drafts', () => {
  test('a draft is created with an id from its title, listed in the library, and the baseline episode is untouched', async () => {
    const before = baseline();
    const r = await call('POST', '/api/plans', {title: 'What is a token?', audience: 'Curious beginners', objective: 'Know what a token is', durationMin: 2});
    assert.equal(r.status, 201);
    P = r.json.plan.id;
    planSeq = r.json.seq;
    assert.equal(P, 'what-is-a-token');
    assert.equal(r.json.episode, null);
    const again = await call('POST', '/api/plans', {title: 'What is a token?'});
    assert.equal(again.json.plan.id, 'what-is-a-token-2', 'a second draft with the same title never reuses the id');
    const lib = await call('GET', '/api/library');
    const ids = lib.json.items.map((i: any) => i.id);
    assert.equal(ids.includes(BASE) && ids.includes(P), true);
    const base = lib.json.items.find((i: any) => i.id === BASE);
    assert.deepEqual([base.hasPlan, base.hasEpisode, base.built], [false, true, true]);
    const draft = lib.json.items.find((i: any) => i.id === P);
    assert.deepEqual([draft.hasPlan, draft.hasEpisode], [true, false]);
    assert.deepEqual(baseline(), before);
  });

  test('an empty title or an impossible length is refused with the field named', async () => {
    const a = await call('POST', '/api/plans', {title: '   '});
    assert.equal(a.status, 422);
    assert.equal(a.json.issues.some((i: any) => i.path === 'title'), true);
    const b = await call('POST', '/api/plans', {title: 'x', durationMin: 90});
    assert.equal(b.status, 422);
    assert.equal(b.json.issues[0].path, 'durationMin');
  });

  test('edits carry the sequence they were made against: a stale save is refused and changes nothing', async () => {
    const cur = await call('GET', `/api/plans/${P}`);
    const edited = {...cur.json.plan, notes: 'Keep it playful.'};
    const ok = await call('PUT', `/api/plans/${P}`, {plan: edited, baseSeq: cur.json.seq});
    assert.equal(ok.status, 200);
    assert.equal(ok.json.seq, cur.json.seq + 1);
    planSeq = ok.json.seq;
    const stale = await call('PUT', `/api/plans/${P}`, {plan: {...cur.json.plan, notes: 'Overwrite!'}, baseSeq: cur.json.seq});
    assert.equal(stale.status, 409);
    assert.equal(stale.json.current.plan.notes, 'Keep it playful.');
    assert.equal((await call('GET', `/api/plans/${P}`)).json.plan.notes, 'Keep it playful.');
    assert.equal((await call('PUT', `/api/plans/${P}`, {plan: edited})).status, 400, 'baseSeq is required');
    const bad = await call('PUT', `/api/plans/${P}`, {plan: {...edited, sources: [{id: 'src1', title: 'x', url: 'ftp://x', publisher: '', published: '', note: '', checked: null, provenance: null}]}, baseSeq: planSeq});
    assert.equal(bad.status, 422);
    assert.equal(bad.json.issues[0].path, 'sources[0].url');
  });
});

describe('imports arrive as Proposed and change nothing until accepted', () => {
  test('invalid JSON shows the exact place and reason, and imports nothing', async () => {
    const before = {imports: count('imports'), plan: await call('GET', `/api/plans/${P}`)};
    const r = await imp('{\n  "studioPacket": 1,\n  "claims": [{"text": "x", "kind": "rumour"}]\n}');
    assert.equal(r.status, 422);
    assert.equal(r.json.message, 'Nothing was imported.');
    assert.deepEqual(r.json.errors.map((e: any) => e.path), ['claims[0].kind']);
    const syntax = await imp('{"studioPacket": 1,');
    assert.match(syntax.json.errors[0].path, /^\(line 1, column \d+\)$/);
    assert.equal(count('imports'), before.imports, 'no record is kept of a rejected paste');
    assert.deepEqual((await call('GET', `/api/plans/${P}`)).json.plan, before.plan.json.plan);
  });

  test('a valid paste is stored whole, hashed, and stays Proposed; the plan and the episode list are unchanged', async () => {
    const before = await call('GET', `/api/plans/${P}`);
    const r = await imp(SCRIPT);
    assert.equal(r.status, 201);
    assert.equal(r.json.import.state, 'proposed');
    assert.equal(r.json.import.shape, 'script');
    assert.equal(r.json.import.sha256, sha(SCRIPT));
    assert.equal(r.json.import.content, SCRIPT, 'the original content is kept verbatim');
    assert.equal(r.json.import.via, 'paste');
    assert.equal(rows(r).length, 5);
    const after = await call('GET', `/api/plans/${P}`);
    assert.equal(after.json.seq, before.json.seq);
    assert.deepEqual(after.json.plan, before.json.plan);
    assert.equal(listEpisodes(h.project).includes(P), false, 'no episode exists yet');
    assert.equal(after.json.imports[0].state, 'proposed');
    // an import from a file keeps the file name
    const f = await imp(SCRIPT, 'file');
    assert.equal(f.json.import.sourceName, 'chat-1.md');
    assert.equal(f.json.import.via, 'file');
    await call('POST', `/api/plans/${P}/imports/${f.json.import.id}/reject`);
  });

  test('the import path makes no network request (every way out is blocked while it runs)', () => {
    const {result, attempts} = noNetwork(() => {
      const made = createPlan(h.project, {title: 'Offline check', objective: 'x', audience: 'y'});
      const text = '```json\n' + JSON.stringify({...RESEARCH, script: {segments: [{text: 'Offline line one.'}, {text: 'Offline line two.'}]}}) + '\n```';
      const r = submitImport(h.project, made.plan.id, {text, via: 'paste'});
      assert.equal(r.ok, true);
      if (!r.ok) throw new Error('unreachable');
      const accepted = acceptImport(h.project, made.plan.id, r.import.id, {selection: defaultSelection(r.import.proposal), basePlanSeq: made.seq, baseEpisodeSeq: null});
      return {id: made.plan.id, accepted};
    });
    assert.deepEqual(attempts, []);
    assert.equal(result.accepted.episodeCreated, true);
    assert.equal(getPlan(h.project, result.id).plan.sources[1].url, 'https://example.org/tokenizers', 'a saved link is only recorded');
  });

  test('none of the planning or import code can reach the network (checked in the source too)', () => {
    const files = ['app/planning.ts', 'app/shared/packet.ts', 'app/shared/importing.ts', 'app/shared/handoff.ts', 'app/shared/plan.ts', 'app/shared/storyboard.ts', 'app/ui/Planner.tsx', 'app/ui/Episodes.tsx', 'app/ui/Import.tsx', 'app/ui/Research.tsx', 'app/ui/Storyboard.tsx'].filter((f) => existsSync(f));
    assert.equal(files.length >= 6, true);
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      assert.doesNotMatch(src, /\bfetch\s*\(|XMLHttpRequest|WebSocket|node:(https?|net|dns|tls|dgram|child_process)|from 'https?'|navigator\.sendBeacon/, `${f} must not make requests`);
      // the one live connection the planner opens is to this app's own event stream
      for (const m of src.matchAll(/new EventSource\(([^)]*)\)/g)) assert.equal(m[1], "'/api/events'", `${f} may only listen to this app's own events`);
    }
  });
});

describe('accepting', () => {
  test('research is added to the plan with provenance; no episode is made; the baseline does not move', async () => {
    const before = baseline();
    const r = await imp(JSON.stringify(RESEARCH), 'file');
    const id = r.json.import.id;
    const res = await call('POST', `/api/plans/${P}/imports/${id}/accept`, {selection: {sources: [0, 1], claims: [0, 1], script: null, storyboard: false, confirmReplace: false}, basePlanSeq: r.json.planSeq, baseEpisodeSeq: null});
    assert.equal(res.status, 200, res.text);
    const plan = res.json.plan;
    assert.deepEqual(plan.sources.map((s: any) => s.id), ['src1', 'src2']);
    assert.deepEqual(plan.claims.map((c: any) => [c.id, c.kind, c.sourceIds]), [['c1', 'fact', ['src2']], ['c2', 'assumption', []]]);
    assert.deepEqual(plan.sources[1].provenance, {importId: id, sha256: sha(JSON.stringify(RESEARCH)), at: plan.sources[1].provenance.at, source: 'chat-1.md'});
    assert.equal(plan.sources[1].checked, null, 'a link is recorded, not fetched or verified');
    assert.equal(res.json.import.state, 'accepted');
    assert.equal(res.json.episode, null);
    assert.deepEqual(baseline(), before);
    planSeq = res.json.seq;
  });

  test('accepting a script creates the episode through the normal store: valid document, a permanent revision, and the file', async () => {
    const r = await imp(SCRIPT);
    const rowsEdited = rows(r).map((x, i) => (i === 0 ? {...x, text: 'Big models read text in small pieces.'} : x));
    const res = await call('POST', `/api/plans/${P}/imports/${r.json.import.id}/accept`, {selection: {sources: [], claims: [], script: rowsEdited, storyboard: false, confirmReplace: false}, basePlanSeq: r.json.planSeq, baseEpisodeSeq: null});
    assert.equal(res.status, 200, res.text);
    assert.equal(res.json.episodeCreated, true);
    const doc = getEpisode(h.project, P);
    assert.doesNotThrow(() => EpisodeSchemaV2.parse(doc));
    assert.equal(doc.narration.segments[0].text, 'Big models read text in small pieces.', 'the author’s adjustment is what was accepted');
    assert.equal(doc.narration.segments.length, 5);
    assert.deepEqual(doc.scenes.map((s) => s.id), ['storyboard-pending']);
    const revs = listRevisions(h.project, P);
    assert.deepEqual(revs.map((x) => x.kind), ['create']);
    assert.match(revs[0].label ?? '', /^Imported from pasted text \(#\d+, [a-f0-9]{12}\)$/);
    const file = join(h.projectRoot, 'episodes', P, 'episode.json');
    assert.equal(existsSync(file), true);
    assert.equal(JSON.parse(readFileSync(file, 'utf8')).id, P);
    assert.equal(res.json.projection, 'written');
    assert.equal(res.json.episode.standIn, true);
    assert.equal((await call('GET', `/api/episodes/${P}`)).json.planned, true);
    assert.equal((await call('GET', `/api/episodes/${BASE}`)).json.planned, false);
    planSeq = res.json.seq;
  });

  test('a storyboard is accepted against the script; every scene is reported with what stops it; nothing claims it can be produced', async () => {
    const r = await imp(JSON.stringify(STORYBOARD));
    assert.equal(r.status, 201, r.text);
    const res = await call('POST', `/api/plans/${P}/imports/${r.json.import.id}/accept`, {selection: {sources: [], claims: [], script: null, storyboard: true, confirmReplace: false}, basePlanSeq: r.json.planSeq, baseEpisodeSeq: r.json.episode.seq});
    assert.equal(res.status, 200, res.text);
    assert.deepEqual(res.json.plan.storyboard.map((s: any) => [s.id, s.segmentIds, s.sceneType]), [['sb1', ['s1', 's2'], 'pip-cards'], ['sb2', ['s3', 's4'], 'custom'], ['sb3', ['s5'], 'context-window']]);
    assert.deepEqual(res.json.check.scenes.map((s: any) => [s.kind, s.state]), [['reusable', 'incomplete'], ['custom', 'custom'], ['own-content', 'incomplete']]);
    assert.equal(res.json.check.producible, false);
    assert.match(res.json.check.scenes[2].blockers.join(' '), /moment/, 'the narration lacks the words the context-window scene times itself on');
    planSeq = res.json.seq;
  });

  test('a second research import changes neither the episode nor anything a build depends on', async () => {
    const epBefore = getEpisodeInfo(h.project, P);
    const opsBefore = count('ops', 'episode_id=?', P);
    const statusBefore = JSON.stringify(statusReport(h.project, P));
    const stepsBefore = JSON.stringify(h.jobs!.plan(P).steps);
    const r = await imp(JSON.stringify({studioPacket: 1, claims: [{text: 'Another wording.', kind: 'proposed-wording'}]}));
    const res = await call('POST', `/api/plans/${P}/imports/${r.json.import.id}/accept`, {selection: {sources: [], claims: [0], script: null, storyboard: false, confirmReplace: false}, basePlanSeq: r.json.planSeq, baseEpisodeSeq: r.json.episode.seq});
    assert.equal(res.status, 200);
    assert.deepEqual(getEpisodeInfo(h.project, P), epBefore);
    assert.equal(count('ops', 'episode_id=?', P), opsBefore);
    assert.equal(JSON.stringify(statusReport(h.project, P)), statusBefore);
    assert.equal(JSON.stringify(h.jobs!.plan(P).steps), stepsBefore);
    planSeq = res.json.seq;
  });

  test('the rebuild plan for this episode is blocked, and says why, before any worker is asked to do anything', async () => {
    const plan = (await call('GET', `/api/episodes/${P}/plan`)).json;
    const msgs = plan.blockers.map((b: any) => b.message) as string[];
    assert.equal(msgs.some((m) => /only a stand-in scene/.test(m)), true);
    assert.equal(msgs.some((m) => /^Storyboard: 0 of 3 planned scenes are ready, 2 incomplete .*, 1 custom/.test(m)), true);
    const start = await call('POST', `/api/episodes/${P}/rebuild`, {seq: plan.seq, requestId: 'req-planning-1'});
    assert.equal(start.status, 422);
    assert.equal(count('jobs', 'episode_id=?', P), 0);
  });
});

describe('replacing, conflicts, atomicity, history', () => {
  const NEW = 'Big models read text in small pieces. Those pieces are called tokens.\n\nA token can be a whole word. Or only part of one.';
  test('replacing the script needs an explicit yes; with it, it is one new revision on the normal save path', async () => {
    const r = await imp(NEW);
    const ep = r.json.episode;
    const sel = {sources: [], claims: [], script: rows(r), storyboard: false, confirmReplace: false};
    const refused = await call('POST', `/api/plans/${P}/imports/${r.json.import.id}/accept`, {selection: sel, basePlanSeq: r.json.planSeq, baseEpisodeSeq: ep.seq});
    assert.equal(refused.status, 422);
    assert.match(refused.json.message, /needs your confirmation first: Replace the script: \d of 5 lines change/);
    assert.equal(getEpisodeInfo(h.project, P).seq, ep.seq, 'nothing changed');
    assert.equal(getImport(r.json.import.id).state, 'proposed');
    const ok = await call('POST', `/api/plans/${P}/imports/${r.json.import.id}/accept`, {selection: {...sel, confirmReplace: true}, basePlanSeq: r.json.planSeq, baseEpisodeSeq: ep.seq});
    assert.equal(ok.status, 200, ok.text);
    const doc = getEpisode(h.project, P);
    assert.deepEqual(doc.narration.segments.map((s) => s.id), ['s1', 's2', 's3', 's4']);
    const revs = listRevisions(h.project, P);
    assert.deepEqual(revs.map((x) => x.kind), ['create', 'script-import']);
    assert.equal(count('ops', "episode_id=? AND kind='script-import'", P), 1);
    // the storyboard that pointed at the removed segment is flagged, not silently rewritten
    assert.match(ok.json.check.problems.join(' '), /planned scenes? (is|are) ready/);
    assert.equal(ok.json.check.scenes[2].blockers.some((b: string) => /refers to s5, which is not in the script/.test(b)), true);
    planSeq = ok.json.seq;
  });

  test('the earlier script is recovered with the existing History restore, as a new revision', async () => {
    const info = getEpisodeInfo(h.project, P);
    const r = await call('POST', `/api/episodes/${P}/restore`, {number: 1, baseSeq: info.seq});
    assert.equal(r.status, 200, r.text);
    const doc = getEpisode(h.project, P);
    assert.equal(doc.narration.segments.length, 5);
    assert.equal(doc.narration.segments[0].text, 'Big models read text in small pieces.');
    assert.deepEqual(listRevisions(h.project, P).map((x) => x.kind), ['create', 'script-import', 'restore']);
  });

  test('a stale plan or episode sequence refuses the acceptance and leaves everything as it was', async () => {
    const r = await imp(NEW);
    const sel = {sources: [], claims: [], script: rows(r), storyboard: false, confirmReplace: true};
    const staleEp = await call('POST', `/api/plans/${P}/imports/${r.json.import.id}/accept`, {selection: sel, basePlanSeq: r.json.planSeq, baseEpisodeSeq: r.json.episode.seq - 1});
    assert.equal(staleEp.status, 409);
    const stalePlan = await call('POST', `/api/plans/${P}/imports/${r.json.import.id}/accept`, {selection: sel, basePlanSeq: r.json.planSeq - 1, baseEpisodeSeq: r.json.episode.seq});
    assert.equal(stalePlan.status, 409);
    assert.equal(getEpisode(h.project, P).narration.segments.length, 5);
    assert.equal(getImport(r.json.import.id).state, 'proposed');
    await call('POST', `/api/plans/${P}/imports/${r.json.import.id}/reject`);
    const again = await call('POST', `/api/plans/${P}/imports/${r.json.import.id}/accept`, {selection: sel, basePlanSeq: r.json.planSeq, baseEpisodeSeq: r.json.episode.seq});
    assert.equal(again.status, 409, 'a rejected import cannot be accepted later');
    assert.equal(again.json.error, 'import-resolved');
  });

  test('a failure in the middle of acceptance commits nothing: no plan change, no episode, no file, the import is still Proposed', async () => {
    const made = (await call('POST', '/api/plans', {title: 'Atomic check', objective: 'o', audience: 'a'})).json;
    const id = made.plan.id;
    const r = await imp(JSON.stringify({...RESEARCH, script: {segments: [{text: 'Line one for atomicity.'}, {text: 'Line two for atomicity.'}]}}), 'paste', id);
    const body = {selection: defaultSelection(r.json.import.proposal), basePlanSeq: r.json.planSeq, baseEpisodeSeq: null};
    writeFileSync(h.faultFile, 'x');
    try {
      const bad = await call('POST', `/api/plans/${id}/imports/${r.json.import.id}/accept`, body);
      assert.equal(bad.status, 500);
      assert.match(bad.json.message, /injected failure/);
    } finally { rmSync(h.faultFile, {force: true}); }
    assert.equal(getPlan(h.project, id).seq, made.seq);
    assert.equal(getPlan(h.project, id).plan.sources.length, 0);
    assert.equal(listEpisodes(h.project).includes(id), false);
    assert.equal(existsSync(join(h.projectRoot, 'episodes', id)), false);
    assert.equal(getImport(r.json.import.id).state, 'proposed');
    assert.equal(count('plan_revisions', 'plan_id=?', id), 1);
    const good = await call('POST', `/api/plans/${id}/imports/${r.json.import.id}/accept`, body);
    assert.equal(good.status, 200, good.text);
    assert.equal(listEpisodes(h.project).includes(id), true);
  });

  test('plan history keeps every version; restore brings one back as a new revision and never touches the episode', async () => {
    const cur = (await call('GET', `/api/plans/${P}`)).json;
    const revs = (await call('GET', `/api/plans/${P}/revisions`)).json.revisions as {number: number; kind: string; summary: string; isCurrent: boolean}[];
    assert.equal(revs[0].isCurrent, true);
    assert.equal(revs.some((r) => r.kind === 'import' && /sources \(0 to 2\)/.test(r.summary)), true, 'the research import is a visible step');
    const target = revs.find((r) => r.kind === 'import' && /sources \(0 to 2\)/.test(r.summary))!;
    const epBefore = getEpisodeInfo(h.project, P);
    const edit = await call('PUT', `/api/plans/${P}`, {plan: {...cur.plan, sources: [], claims: []}, baseSeq: cur.seq});
    assert.equal(edit.json.plan.sources.length, 0);
    const res = await call('POST', `/api/plans/${P}/restore`, {number: target.number, baseSeq: edit.json.seq});
    assert.equal(res.status, 200);
    assert.equal(res.json.plan.sources.length, 2, 'the sources are back');
    const after = (await call('GET', `/api/plans/${P}/revisions`)).json.revisions;
    assert.equal(after[0].kind, 'restore');
    assert.deepEqual(getEpisodeInfo(h.project, P), epBefore);
  });

  test('every ordinary edit to an existing episode still works on a planned episode (the normal save path)', async () => {
    const info = getEpisodeInfo(h.project, P);
    const doc = getEpisode(h.project, P);
    const edited = {...doc, narration: {...doc.narration, segments: doc.narration.segments.map((s, i) => (i === 1 ? {...s, text: 'Those pieces are called tokens, said Pip.'} : s))}};
    const r = await call('PUT', `/api/episodes/${P}`, {doc: edited, baseSeq: info.seq});
    assert.equal(r.status, 200);
    assert.equal((await call('PUT', `/api/episodes/${P}`, {doc: edited, baseSeq: info.seq})).status, 409);
  });
});

describe('existing work is preserved', () => {
  test('after everything above the baseline episode, its builds, jobs and revisions are exactly as they were', async () => {
    assert.deepEqual(baseline(), initial);
  });

  test('opening a workspace made before this version adds the planning tables and keeps everything else', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'studio-migrate-'));
    try {
      const root = join(tmp, 'project');
      seedDemo(root, baselineSources());
      const db = new DatabaseSync(join(root, '.studio', 'project.sqlite'));
      db.exec("DROP TABLE imports; DROP TABLE plan_revisions; DROP TABLE plans; DROP TABLE exports; DROP TABLE approval_review; DROP TABLE caption_confirmations; DROP TABLE review_signoffs; DROP TABLE review_playback; DROP TABLE review_rounds; UPDATE meta SET value='2' WHERE key='schema_version'");
      const eps = (get<{n: number}>(db.prepare('SELECT count(*) AS n FROM episodes')))!.n;
      db.close();
      const p = Project.open(root);
      try {
        assert.equal(get<{value: string}>(p.db.prepare("SELECT value FROM meta WHERE key='schema_version'"))!.value, String(SCHEMA_VERSION));
        assert.equal(get<{n: number}>(p.db.prepare('SELECT count(*) AS n FROM episodes'))!.n, eps);
        assert.equal(get<{n: number}>(p.db.prepare('SELECT count(*) AS n FROM plans'))!.n, 0);
        assert.equal(readdirSync(join(root, '.studio', 'backups')).some((f) => /\.sqlite$/.test(f)), true, 'a copy was taken before migrating');
      } finally { p.close(); }
    } finally { rmSync(tmp, {recursive: true, force: true}); }
  });
});

function getImport(id: number) { return {state: all<{state: string}>(h.project.db.prepare('SELECT state FROM imports WHERE id=?'), id)[0].state}; }
