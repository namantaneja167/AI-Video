// Rejected, abandoned and accepted imports across restarts and concurrent edits: what must not change, what must survive,
// and that two writers can never silently overwrite each other.
import assert from 'node:assert/strict';
import {existsSync, readFileSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import {after, before, describe, test} from 'node:test';
import {all, get} from '../../core/db.ts';
import {api, startApp, type Harness} from './harness.ts';

let h: Harness;
let call: ReturnType<typeof api>;
before(async () => { h = await startApp(); call = api(h); });
after(async () => { await h.close(); });

const mk = async (title: string) => (await call('POST', '/api/plans', {title, audience: 'a', objective: 'o'})).json;
const imp = (id: string, text: string) => call('POST', `/api/plans/${id}/imports`, {text, via: 'paste'});
const everything = (r: any) => ({sources: r.json.import.proposal.sources.map((_: unknown, i: number) => i), claims: r.json.import.proposal.claims.map((_: unknown, i: number) => i), script: r.json.import.proposal.script, storyboard: !!r.json.import.proposal.storyboard, confirmReplace: true});
const accept = (id: string, r: any, over: {planSeq?: number; episodeSeq?: number | null} = {}) =>
  call('POST', `/api/plans/${id}/imports/${r.json.import.id}/accept`, {selection: everything(r), basePlanSeq: over.planSeq ?? r.json.planSeq, baseEpisodeSeq: over.episodeSeq === undefined ? (r.json.episode?.seq ?? null) : over.episodeSeq});
const packet = (extra: object) => JSON.stringify({studioPacket: 1, ...extra});
const RESEARCH = packet({sources: [{title: 'Outline', note: 'mine'}], claims: [{text: 'A claim.', kind: 'assumption'}]});
const SCRIPT = 'The first line is here. The second line is here. The third line is here.';
const REWRITE = 'The first line is here. A reworded second line. A new third line.';

const snap = (id: string) => ({
  plan: get<any>(h.project.db.prepare('SELECT seq, doc_json FROM plans WHERE id=?'), id),
  planRevs: all<any>(h.project.db.prepare('SELECT number, kind, label, doc_hash FROM plan_revisions WHERE plan_id=? ORDER BY number'), id),
  episode: get<any>(h.project.db.prepare('SELECT seq, doc_hash, doc_json FROM episodes WHERE id=?'), id) ?? null,
  epRevs: all<any>(h.project.db.prepare('SELECT number, kind, label, doc_hash FROM revisions WHERE episode_id=? ORDER BY number'), id),
  ops: all<any>(h.project.db.prepare('SELECT seq, kind, doc_hash FROM ops WHERE episode_id=? ORDER BY seq'), id),
  file: existsSync(join(h.projectRoot, 'episodes', id, 'episode.json')) ? readFileSync(join(h.projectRoot, 'episodes', id, 'episode.json'), 'utf8') : null,
});
const imports = (id: string) => all<any>(h.project.db.prepare('SELECT id, state, sha256, content, proposal_json, result_json FROM imports WHERE plan_id=? ORDER BY id'), id);

/** A draft with an accepted script and research, ready for more imports. */
async function planned(title: string) {
  const made = await mk(title);
  const id = made.plan.id as string;
  const a = await imp(id, SCRIPT);
  assert.equal((await accept(id, a)).status, 200);
  const b = await imp(id, RESEARCH);
  const cur = (await call('GET', `/api/plans/${id}`)).json;
  assert.equal((await accept(id, b, {planSeq: cur.seq, episodeSeq: cur.episode.seq})).status, 200);
  return id;
}

describe('rejected and abandoned imports change nothing', () => {
  test('rejecting a proposal leaves the episode, its history, the plan and every provenance record exactly as they were', async () => {
    const id = await planned('Reject check');
    const proposal = await imp(id, REWRITE);
    assert.equal(proposal.status, 201);
    const before = snap(id);
    const importsBefore = imports(id).filter((i) => i.id !== proposal.json.import.id);
    const rej = await call('POST', `/api/plans/${id}/imports/${proposal.json.import.id}/reject`);
    assert.equal(rej.status, 200);
    assert.deepEqual(snap(id), before, 'plan, plan history, episode, revisions, ops and the episode file are all identical');
    assert.deepEqual(imports(id).filter((i) => i.id !== proposal.json.import.id), importsBefore, 'earlier imports and their provenance are untouched');
    const row = imports(id).find((i) => i.id === proposal.json.import.id);
    assert.equal(row.state, 'rejected');
    assert.equal(row.content, REWRITE, 'the rejected text is kept as a record');
    assert.equal(JSON.parse(row.result_json).summary[0], 'Not accepted. Nothing was changed.');
    assert.equal((await accept(id, proposal)).status, 409, 'a rejected import can never be accepted later');
    assert.equal((await call('POST', `/api/plans/${id}/imports/${proposal.json.import.id}/reject`)).status, 409);
    assert.deepEqual(snap(id), before);
  });

  test('a proposal that is only opened and closed ("decide later") stays Proposed and changes nothing, including across a restart', async () => {
    const id = await planned('Abandon check');
    const proposal = await imp(id, REWRITE);
    const before = snap(id);
    await call('GET', `/api/plans/${id}/imports/${proposal.json.import.id}`); // opened
    await h.restart();
    call = api(h);
    assert.deepEqual(snap(id), before);
    const again = await call('GET', `/api/plans/${id}/imports/${proposal.json.import.id}`);
    assert.equal(again.json.import.state, 'proposed');
    assert.equal(again.json.import.content, REWRITE);
    assert.equal(again.json.import.sha256, proposal.json.import.sha256);
    // accepting it later still records the hash of the text that was imported
    const ok = await accept(id, again);
    assert.equal(ok.status, 200, ok.text);
    const rev = snap(id).epRevs.at(-1);
    assert.equal(rev.kind, 'script-import');
    assert.ok(rev.label.includes(proposal.json.import.sha256.slice(0, 12)));
  });

  test('a failed or refused acceptance leaves the proposal Proposed with nothing recorded', async () => {
    const id = await planned('Refused check');
    const proposal = await imp(id, REWRITE);
    const cur = (await call('GET', `/api/plans/${id}`)).json;
    const before = snap(id);
    const noConfirm = await call('POST', `/api/plans/${id}/imports/${proposal.json.import.id}/accept`, {selection: {...everything(proposal), confirmReplace: false}, basePlanSeq: cur.seq, baseEpisodeSeq: cur.episode.seq});
    assert.equal(noConfirm.status, 422);
    const empty = await call('POST', `/api/plans/${id}/imports/${proposal.json.import.id}/accept`, {selection: {sources: [], claims: [], script: [], storyboard: false, confirmReplace: true}, basePlanSeq: cur.seq, baseEpisodeSeq: cur.episode.seq});
    assert.equal(empty.status, 422);
    assert.deepEqual(snap(id), before);
    assert.equal(imports(id).find((i) => i.id === proposal.json.import.id).state, 'proposed');
  });
});

describe('accepted imports survive a restart', () => {
  test('plan, history, provenance, import records, episode, its revisions and its file are identical after the server restarts', async () => {
    const id = await planned('Restart check');
    const sb = await imp(id, packet({storyboard: {scenes: [{segments: [1, 2], sceneType: 'cards'}, {segments: [3], sceneType: 'custom'}]}}));
    const cur = (await call('GET', `/api/plans/${id}`)).json;
    assert.equal((await accept(id, sb, {planSeq: cur.seq, episodeSeq: cur.episode.seq})).status, 200);
    const before = {snap: snap(id), imports: imports(id), payload: (await call('GET', `/api/plans/${id}`)).json};
    await h.restart();
    call = api(h);
    assert.deepEqual(snap(id), before.snap);
    assert.deepEqual(imports(id), before.imports);
    assert.deepEqual((await call('GET', `/api/plans/${id}`)).json, before.payload);
    assert.deepEqual(imports(id).map((i) => i.state), ['accepted', 'accepted', 'accepted']);
    const plan = JSON.parse(before.snap.plan.doc_json);
    assert.equal(plan.storyboard[0].provenance.sha256, imports(id)[2].sha256, 'the storyboard still names the import it came from');
  });

  test('if the server died after the commit but before the episode file was written, the file is recreated on the next start', async () => {
    const id = await planned('Crash gap check');
    const file = join(h.projectRoot, 'episodes', id, 'episode.json');
    const bytes = readFileSync(file, 'utf8');
    rmSync(file);
    await h.restart();
    call = api(h);
    assert.equal(existsSync(file), true, 'recreated at startup');
    assert.equal(readFileSync(file, 'utf8'), bytes);
  });
});

describe('concurrent writers never overwrite an accepted import silently', () => {
  test('two accepts of the same proposal at once: exactly one applies', async () => {
    const made = await mk('Double accept');
    const id = made.plan.id as string;
    const p = await imp(id, SCRIPT);
    const results = await Promise.all([accept(id, p), accept(id, p)]);
    assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
    const s = snap(id);
    assert.deepEqual(s.epRevs.map((r: any) => r.kind), ['create']);
    assert.equal(s.ops.filter((o: any) => o.kind === 'create').length, 1);
    assert.equal(imports(id).filter((i) => i.state === 'accepted').length, 1);
  });

  test('an accept racing a plan edit made from the same version: one wins, the other is refused, and nothing is lost', async () => {
    const id = await planned('Race plan edit');
    const p = await imp(id, RESEARCH);
    const cur = (await call('GET', `/api/plans/${id}`)).json;
    const edit = call('PUT', `/api/plans/${id}`, {plan: {...cur.plan, notes: 'Typed in another tab'}, baseSeq: cur.seq});
    const acc = accept(id, p, {planSeq: cur.seq, episodeSeq: cur.episode.seq});
    const [e, a] = await Promise.all([edit, acc]);
    assert.deepEqual([e.status, a.status].sort(), [200, 409]);
    const plan = JSON.parse(snap(id).plan.doc_json);
    if (e.status === 200) {
      assert.equal(plan.notes, 'Typed in another tab');
      assert.equal(imports(id).find((i) => i.id === p.json.import.id).state, 'proposed', 'the refused accept left the proposal waiting');
    } else {
      assert.equal(plan.notes, '');
      assert.equal(plan.sources.length, 2, 'the accepted research is in the plan, and the stale edit did not erase it');
    }
  });

  test('a stale editor tab cannot overwrite an accepted script replacement, and an accept cannot overwrite a newer editor save', async () => {
    const id = await planned('Race episode edit');
    const before = (await call('GET', `/api/episodes/${id}`)).json;
    const stale = structuredClone(before.doc);
    stale.narration.segments[0].text = 'Typed in a tab that did not see the import.';

    // the import lands first
    const p = await imp(id, REWRITE);
    const ok = await accept(id, p);
    assert.equal(ok.status, 200, ok.text);
    const put = await call('PUT', `/api/episodes/${id}`, {doc: stale, baseSeq: before.seq});
    assert.equal(put.status, 409);
    const after = (await call('GET', `/api/episodes/${id}`)).json;
    assert.equal(after.doc.narration.segments[1].text, 'A reworded second line.', 'the accepted script is intact');
    assert.equal(after.doc.narration.segments[0].text, 'The first line is here.');

    // an editor save lands first
    const p2 = await imp(id, 'The first line is here. Yet another second line. A newer third line.');
    const view = (await call('GET', `/api/episodes/${id}`)).json;
    const typed = structuredClone(view.doc);
    typed.narration.segments[2].text = 'Typed just now.';
    const saved = await call('PUT', `/api/episodes/${id}`, {doc: typed, baseSeq: view.seq});
    assert.equal(saved.status, 200);
    const late = await accept(id, p2, {episodeSeq: view.seq});
    assert.equal(late.status, 409);
    assert.equal((await call('GET', `/api/episodes/${id}`)).json.doc.narration.segments[2].text, 'Typed just now.');
    assert.equal(imports(id).find((i) => i.id === p2.json.import.id).state, 'proposed');
  });

  test('an accept and an editor save started together: exactly one applies and the document is one of the two, never a mixture', async () => {
    const id = await planned('Race simultaneous');
    const p = await imp(id, REWRITE);
    const view = (await call('GET', `/api/episodes/${id}`)).json;
    const typed = structuredClone(view.doc);
    typed.narration.segments[0].text = 'Typed at the same moment.';
    const [a, e] = await Promise.all([accept(id, p, {episodeSeq: view.seq}), call('PUT', `/api/episodes/${id}`, {doc: typed, baseSeq: view.seq})]);
    assert.deepEqual([a.status, e.status].sort(), [200, 409]);
    const texts = (await call('GET', `/api/episodes/${id}`)).json.doc.narration.segments.map((s: any) => s.text);
    if (a.status === 200) assert.deepEqual(texts, ['The first line is here.', 'A reworded second line.', 'A new third line.']);
    else assert.deepEqual(texts, ['Typed at the same moment.', 'The second line is here.', 'The third line is here.']);
  });
});
