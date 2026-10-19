// The Review stage through the app server, on fake audio and render workers (the render is a real small MP4 carrying the real mastered mix).
// Sign-offs, playback and approval here are SIMULATED actions made through the same routes the page uses: the clock is moved forward so
// playback does not have to run in real time, and nothing in the product ticks, plays or approves by itself.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {existsSync, readFileSync} from 'node:fs';
import {join} from 'node:path';
import {after, before, describe, test} from 'node:test';
import {api, startApp, type Harness} from './harness.ts';

type Call = ReturnType<typeof api>;
const EP = 'context-window';
const rid = () => `req-${Math.random().toString(36).slice(2, 12)}`;
async function poll<T>(what: string, fn: () => Promise<T | undefined | false>, ms = 90_000): Promise<T> {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v as T;
    if (Date.now() - t0 > ms) throw new Error(`timed out after ${ms} ms waiting for: ${what}`);
    await new Promise((r) => setTimeout(r, 80));
  }
}

describe('the review routes', {timeout: 600_000}, () => {
  let h: Harness;
  let call: Call;
  let offset = 0;
  before(async () => {
    process.env.FAKE_RENDER_REAL = '1';
    h = await startApp({jobs: true});
    h.project.now = () => Date.now() + offset;
    call = api(h);
  });
  after(async () => { delete process.env.FAKE_RENDER_REAL; await h.close(); });
  const view = async (render?: number) => (await call('GET', `/api/episodes/${EP}/review${render ? `?render=${render}` : ''}`)).json;
  const post = (sub: string, body: Record<string, unknown>) => call('POST', `/api/episodes/${EP}/review/${sub}`, body);
  const build = async (mode: 'draft' | 'final') => {
    const seq = (await call('GET', `/api/episodes/${EP}`)).json.seq;
    const r = await call('POST', `/api/episodes/${EP}/rebuild`, {seq, requestId: rid(), mode});
    assert.equal(r.status, 202, r.text);
    await poll(`${mode} build to finish`, async () => { const v = await view(); return !v.busy && v.videos.some((x: any) => x.kind === mode && x.fresh) ? v : undefined; });
  };

  test('they need the sign-in, answer for episodes only, and refuse approval without an explicit confirmation', async () => {
    const unsigned = await fetch(h.url(`/api/episodes/${EP}/review`), {headers: {connection: 'close'}});
    assert.equal(unsigned.status, 401);
    assert.equal((await call('GET', '/api/episodes/nope/review')).status, 404);
    assert.equal((await post('approve', {roundId: 1})).status, 400, 'approval needs confirm: true');
    assert.equal((await post('approve', {roundId: 1, confirm: true}, )).status, 404, 'no such round');
    assert.equal((await call('POST', `/api/episodes/${EP}/review/approve`, {roundId: 1, confirm: true}, {'x-studio': '0'})).status, 403);
    const v = await view();
    assert.equal(v.episodeId, EP);
    assert.ok(v.videos.some((x: any) => x.kind === 'final'), 'the imported baseline final is listed');
    assert.equal(v.approval.state, 'none');
    assert.equal(v.exports.canExport, false);
    assert.deepEqual(v.signoffs.map((s: any) => s.ticked), [false, false, false, false]);
  });

  test('a draft is built and labelled as a draft; it cannot be approved and its round says so', async () => {
    const plan = (await call('GET', `/api/episodes/${EP}/plan?mode=draft`)).json;
    assert.equal(plan.mode, 'draft');
    await build('draft');
    const v = await view();
    const draft = v.videos.find((x: any) => x.kind === 'draft');
    assert.match(draft.label, /not mastered/);
    const opened = await post('round', {renderArtifactId: draft.renderArtifactId});
    assert.equal(opened.status, 200, opened.text);
    const d2 = (await view(draft.renderArtifactId)).selected;
    assert.equal(d2.round.number >= 1, true);
    const refused = await post('approve', {roundId: d2.round.id, confirm: true});
    assert.equal(refused.status, 422);
    assert.match(refused.json.message, /not for the current final video|draft/);
  });

  let finalId = 0;
  let roundId = 0;
  test('the final video is built mastered, a round is opened on that exact file, and the media is that file, served with byte ranges', async () => {
    await build('final');
    const v = await view();
    const fin = v.selected;
    assert.equal(fin.kind, 'final');
    assert.match(fin.label, /Final \(mastered\)/);
    finalId = fin.renderArtifactId;
    const r = await post('round', {renderArtifactId: finalId});
    assert.equal(r.status, 200);
    roundId = r.json.view.selected.round.id;
    const media = await fetch(h.url(fin.url), {headers: {cookie: `studio_token=${h.token}`, connection: 'close'}});
    assert.equal(media.status, 200);
    const bytes = Buffer.from(await media.arrayBuffer());
    assert.equal(createHash('sha256').update(bytes).digest('hex'), fin.fileSha256, 'the video the page plays is the file the review is bound to');
    const part = await fetch(h.url(fin.url), {headers: {cookie: `studio_token=${h.token}`, range: 'bytes=0-99', connection: 'close'}});
    assert.equal(part.status, 206);
  });

  test('production checks run as a job and the report says what kind each result is', async () => {
    const start = await post('checks', {renderArtifactId: finalId});
    assert.equal(start.status, 202, start.text);
    const v = await poll('the checks to finish', async () => { const x = await view(finalId); return x.report && !x.checksJob ? x : undefined; });
    const byId = Object.fromEntries(v.report.items.map((i: any) => [i.id, i]));
    assert.equal(byId['file.hash'].status, 'pass');
    assert.equal(byId['mastering.loudness'].status, 'pass');
    assert.equal(byId['narration.words'].kind, 'manual');
    assert.equal(byId['narration.words'].status, 'unchecked');
    assert.equal(byId['custom.scenes'].kind, 'partial');
    assert.ok(v.report.limits.length >= 3);
    assert.equal(v.selected.checks.state, 'done');
  });

  test('playback that could not have happened is refused; real-looking playback is recorded and measured', async () => {
    const dur = (await view(finalId)).selected.durationSec as number;
    assert.ok(dur > 5);
    const fast = await post('playback', {roundId, fromSec: 0, toSec: 14, heard: true, phone: false});
    assert.equal(fast.status, 200, 'the first report is allowed up to 15 s');
    const tooFast = await post('playback', {roundId, fromSec: 0, toSec: 14, heard: true, phone: false});
    assert.equal(tooFast.status, 422);
    assert.match(tooFast.json.message, /cannot have played/);
    assert.equal((await post('playback', {roundId, fromSec: 5, toSec: 4000, heard: true, phone: false})).status, 422);
    assert.equal((await post('playback', {roundId: 9999, fromSec: 0, toSec: 5, heard: true, phone: false})).status, 404);
    // SIMULATED: the rest of the file, with time moved forward between reports
    for (let a = 14; a < dur; a += 10) { offset += 11_000; const r = await post('playback', {roundId, fromSec: a, toSec: Math.min(dur, a + 10), heard: true, phone: a < 30}); assert.equal(r.status, 200, r.text); }
    const v = await view(finalId);
    assert.equal(v.coverage.complete, true);
    assert.ok(v.coverage.phoneHeardSec > 0 && v.coverage.heardSec >= dur - 1);
  });

  test('notes: written against the round, edited, resolved; a stale page conflicts and changes nothing', async () => {
    const v0 = await view(finalId);
    const seg = v0.segmentTimes[1];
    const added = await post('note', {roundId, text: 'Slow this down', type: 'voice', timeSec: seg.start + 0.5, segment: seg.id, seq: v0.seq, render: finalId});
    assert.equal(added.status, 200, added.text);
    const mine = added.json.view.notes.find((n: any) => n.note.text === 'Slow this down');
    assert.equal(mine.note.round >= 1, true);
    assert.equal(mine.note.render.id, String(finalId));
    assert.equal(mine.note.render.sha256, v0.selected.fileSha256);
    assert.equal(mine.onThisVideo, true);
    assert.equal(mine.note.context.segmentText, v0.segments.find((s: any) => s.id === seg.id).text);
    const stale = await post(`note/${mine.note.id}`, {op: 'edit', text: 'x', seq: v0.seq});
    assert.equal(stale.status, 409, 'the add moved the sequence, so the old page is stale');
    const seq = (await view(finalId)).seq;
    const edited = await post(`note/${mine.note.id}`, {op: 'edit', text: 'Slow this down a little', seq, render: finalId});
    assert.equal(edited.status, 200, edited.text);
    assert.equal((await post(`note/${mine.note.id}`, {op: 'frobnicate'})).status, 400);
    assert.equal(h.project && (await view(finalId)).readiness.blockers.some((b: string) => /1 note is still open/.test(b)), true, 'an open note blocks approval');
    const seq2 = (await view(finalId)).seq;
    assert.equal((await post(`note/${mine.note.id}`, {op: 'resolve', seq: seq2, render: finalId})).status, 200);
  });

  test('approval is refused until the confirmations are ticked by a person (SIMULATED), and the request cannot carry them', async () => {
    const before = await post('approve', {roundId, confirm: true, signoffs: {listened: true, watchedPhoneSize: true, customScenesReviewed: true, notesResolved: true}});
    assert.equal(before.status, 422, 'forged sign-offs in the request are ignored');
    assert.match(before.json.message, /confirmations are not ticked/);
    const checksNow = (await view(finalId)).report;
    for (const d of checksNow.captionDiffs.filter((x: any) => !x.confirmed)) assert.equal((await post('confirm-diff', {renderArtifactId: finalId, segment: d.segment, hash: d.hash, confirmed: true})).status, 200); // SIMULATED confirmation
    assert.equal((await post('confirm-diff', {renderArtifactId: finalId, segment: 's1', hash: 'not-a-real-hash', confirmed: true})).status, 422);
    await post('checks', {renderArtifactId: finalId});
    await poll('the second checks run', async () => { const x = await view(finalId); return !x.checksJob && x.report?.passed ? x : undefined; });
    assert.equal((await post('signoff', {roundId, item: 'looksFine', ticked: true})).status, 422);
    for (const item of ['listened', 'watchedPhoneSize', 'customScenesReviewed', 'notesResolved']) assert.equal((await post('signoff', {roundId, item, ticked: true, render: finalId})).status, 200); // SIMULATED ticks
    const v = await view(finalId);
    assert.deepEqual(v.readiness.blockers, [], v.readiness.blockers.join(' | '));
    const ok = await post('approve', {roundId, confirm: true});
    assert.equal(ok.status, 200, ok.text);
    assert.equal(ok.json.view.approval.state, 'valid');
    assert.equal(ok.json.view.approval.fileSha256, v.selected.fileSha256);
    assert.equal(ok.json.view.approval.rested.coverageComplete, true);
  });

  test('export copies the approved file byte for byte and the package has what the spec lists and nothing private', async () => {
    const r = await post('export', {});
    assert.equal(r.status, 200, r.text);
    const {dir, files, verified} = r.json.result;
    const fin = (await view(finalId)).selected;
    assert.deepEqual(verified, {before: fin.fileSha256, copy: fin.fileSha256, after: fin.fileSha256});
    const video = files.find((f: any) => f.role === 'video');
    assert.equal(createHash('sha256').update(readFileSync(join(dir, video.name))).digest('hex'), fin.fileSha256);
    for (const n of ['metadata.json', 'credits.md', 'checksums.sha256']) assert.ok(existsSync(join(dir, n)), n);
    const text = ['metadata.json', 'credits.md'].map((n) => readFileSync(join(dir, n), 'utf8')).join('\n');
    assert.ok(!text.includes(h.projectRoot) && !/\/Users\//.test(text));
    const again = await post('export', {});
    assert.equal(again.json.result.alreadyExported, true);
  });

  test('a change to an input voids approval, and export then refuses clearly and writes nothing new', async () => {
    const before = (await view()).exports.packages.length;
    const seq = (await call('GET', `/api/episodes/${EP}`)).json.seq;
    const doc = (await call('GET', `/api/episodes/${EP}`)).json.doc;
    doc.narration.segments[0].text += ' Really.';
    assert.equal((await call('PUT', `/api/episodes/${EP}`, {doc, baseSeq: seq, tab: 't'})).status, 200);
    const v = await view();
    assert.equal(v.approval.state, 'void');
    assert.ok(v.approval.changed.includes('content'));
    const r = await post('export', {});
    assert.equal(r.status, 409);
    assert.equal(r.json.error, 'export-void');
    assert.equal((await view()).exports.packages.length, before);
  });
});
