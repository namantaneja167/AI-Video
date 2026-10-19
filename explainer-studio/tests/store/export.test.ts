// Export mechanics in isolated temporary projects. Approval here is made with explicitly SIMULATED sign-offs, checks and playback; the
// product never makes those on its own. What is tested: the copy is the approved bytes, hashed before and after; a missing, altered or
// void file fails clearly and writes nothing; export starts no process; and nothing private reaches the package.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {afterEach, describe, test} from 'node:test';
import {finishJob, startJob} from '../../core/artifacts.ts';
import {blobPath, putBytes} from '../../core/blobs.ts';
import {buildReport, type CheckItem} from '../../core/checks.ts';
import {adoptEpisode, getEpisode, saveEpisode} from '../../core/episodes.ts';
import {exportApproved, exportsOf, ExportError, publicLeaks, subtitles, verifyPackage} from '../../core/export.ts';
import {sha256File} from '../../core/hash.ts';
import {approveReviewed, openRound, recordPlayback, setSignoff} from '../../core/review.ts';
import {currentRows} from '../../core/state.ts';
import {ROOT, plain} from '../helpers.ts';
import {newProject, setAllComponents, type TestProject} from './helpers.ts';

const EP = 'join-fanout';
const DURATION = 30;
let t: TestProject;
let exportsRoot: string;
afterEach(() => t?.close());

const TIMELINE = {
  durationSec: DURATION, audio: 'narration.wav', scenes: [], mouth: [],
  segments: [{id: 's01', start: 0.5, end: 4}, {id: 's02', start: 4.2, end: 8}],
  captions: [
    {segment: 's01', text: 'Your pipeline succeeded.', words: [{text: 'Your', start: 0.5, end: 0.8}, {text: 'pipeline', start: 0.8, end: 1.4}, {text: 'succeeded.', start: 1.4, end: 2.2}]},
    {segment: 's02', text: 'Finance says paid revenue is ₹600.', words: [{text: 'Finance', start: 4.2, end: 4.7}, {text: 'says', start: 4.7, end: 5}, {text: '₹600.', start: 5, end: 6.4}]},
  ],
};
/** Not a real video: bytes that are not valid media at all, so a re-encode or a remux could not preserve them. */
const VIDEO_BYTES = Buffer.from(Array.from({length: 300_000}, (_, i) => (i * 131 + 7) % 251));

/** A project with a built and APPROVED final video (all review records simulated). */
function approved(mutate?: (doc: any) => void): {roundId: number; approvalId: number} {
  t = newProject();
  exportsRoot = join(t.root, 'exports');
  adoptEpisode(t.p, 'episodes/join-fanout/episode.json');
  setAllComponents(t.p, t.root);
  if (mutate) { const d0 = plain(getEpisode(t.p, EP)); mutate(d0); saveEpisode(t.p, EP, d0); }
  const run = (kind: Parameters<typeof startJob>[1]['jobKind'], subject: string | undefined, blob: Buffer | string, meta?: Record<string, unknown>) => {
    const j = startJob(t.p, {episodeId: EP, jobKind: kind, subject});
    return finishJob(t.p, j.jobId, {blobHash: putBytes(t.p, blob).hash, meta, seed: 1}).artifactId;
  };
  for (const b of getEpisode(t.p, EP).narration.blocks) run('tts.block', b.id, `take ${b.id}`);
  run('timing.build', undefined, JSON.stringify(TIMELINE));
  run('mix.draft', undefined, 'mix draft'); run('mix.final', undefined, 'mix final');
  run('render.draft', undefined, 'draft video'); run('render.final', undefined, VIDEO_BYTES, {mastered: true});
  const d = plain(getEpisode(t.p, EP)) as any;
  for (const n of d.reviewNotes) n.status = 'resolved';
  saveEpisode(t.p, EP, d);
  const finalId = currentRows(t.p, EP).find((r) => r.kind === 'render' && r.subject === 'final')!.artifact_id;
  const round = openRound(t.p, EP, finalId);
  const items: CheckItem[] = [{id: 'x', section: 'narration', title: 'x', kind: 'measured', status: 'pass', detail: 'simulated'}];
  const report = buildReport({renderArtifactId: finalId, renderKind: 'final', fileSha256: round.fileSha256, items, captionDiffs: [], sampled: {frames: 0, scenes: []}});
  const cj = startJob(t.p, {episodeId: EP, jobKind: 'check.suite', subject: String(finalId)});
  finishJob(t.p, cj.jobId, {blobHash: putBytes(t.p, JSON.stringify(report)).hash});
  for (const i of ['listened', 'watchedPhoneSize', 'customScenesReviewed', 'notesResolved']) setSignoff(t.p, round.id, i, true); // SIMULATED ticks
  for (let s = 0; s < DURATION; s += 10) { t.clock.advance(10_000); recordPlayback(t.p, round.id, DURATION, {fromSec: s, toSec: s + 10, heard: true, phone: true}); } // SIMULATED playback
  return {roundId: round.id, approvalId: approveReviewed(t.p, EP, round.id, DURATION)};
}
const approvedPath = () => blobPath(t.p, (t.p.db.prepare('SELECT file_sha256 f FROM approvals ORDER BY id DESC LIMIT 1').get() as {f: string}).f);

describe('export copies the exact approved file', () => {
  test('the package holds a byte-identical video, hashed before, after the copy, and again after the export', () => {
    approved();
    const r = exportApproved(t.p, EP, {exportsRoot});
    const sha = sha256File(approvedPath()).hash;
    assert.deepEqual(r.verified, {before: sha, copy: sha, after: sha});
    const video = r.files.find((f) => f.role === 'video')!;
    assert.equal(video.sha256, sha);
    assert.ok(readFileSync(join(r.dir, video.name)).equals(VIDEO_BYTES), 'the exported bytes are the approved bytes');
    assert.equal(statSync(join(r.dir, video.name)).size, VIDEO_BYTES.length);
    assert.deepEqual(readdirSync(r.dir).sort(), [`${EP}.mp4`, `${EP}.srt`, `${EP}.vtt`, 'checksums.sha256', 'credits.md', 'metadata.json'].sort());
    assert.deepEqual(verifyPackage(r.dir), {ok: true, problems: []});
    assert.equal(exportsOf(t.p, EP)[0].files.length, 6);
    assert.equal(r.alreadyExported, false);
  });

  test('exporting again verifies and reuses the same package; it never overwrites or duplicates', () => {
    approved();
    const a = exportApproved(t.p, EP, {exportsRoot});
    const before = statSync(join(a.dir, `${EP}.mp4`)).mtimeMs;
    const b = exportApproved(t.p, EP, {exportsRoot});
    assert.equal(b.dir, a.dir);
    assert.equal(b.alreadyExported, true);
    assert.equal(statSync(join(b.dir, `${EP}.mp4`)).mtimeMs, before, 'the existing copy was not rewritten');
  });

  test('a different file already in the package folder is never overwritten', () => {
    approved();
    const dir = join(exportsRoot, EP, `approval-${(t.p.db.prepare('SELECT max(id) m FROM approvals').get() as {m: number}).m}-${sha256File(approvedPath()).hash.slice(0, 8)}`);
    mkdirSync(dir, {recursive: true});
    writeFileSync(join(dir, `${EP}.mp4`), 'something else');
    assert.throws(() => exportApproved(t.p, EP, {exportsRoot}), (e: ExportError) => e.code === 'exists' && /not overwritten/.test(e.message));
    assert.equal(readFileSync(join(dir, `${EP}.mp4`), 'utf8'), 'something else');
  });
});

describe('export fails clearly and writes nothing', () => {
  test('no approval', () => {
    t = newProject();
    adoptEpisode(t.p, 'episodes/join-fanout/episode.json');
    assert.throws(() => exportApproved(t.p, EP, {exportsRoot: join(t.root, 'exports')}), (e: ExportError) => e.code === 'no-approval');
    assert.equal(existsSync(join(t.root, 'exports')), false);
  });

  test('a void approval (an input changed after approval) names what changed', () => {
    approved();
    const d = plain(getEpisode(t.p, EP)) as any;
    d.narration.segments.find((s: any) => s.id === 's07').text += '!';
    saveEpisode(t.p, EP, d);
    assert.throws(() => exportApproved(t.p, EP, {exportsRoot}), (e: ExportError) => e.code === 'void' && e.changed.includes('content') && /Approval is void/.test(e.message));
    assert.equal(existsSync(exportsRoot), false);
  });

  test('a missing approved file', async () => {
    approved();
    const f = approvedPath();
    chmodSync(f, 0o644);
    (await import('node:fs')).rmSync(f);
    assert.throws(() => exportApproved(t.p, EP, {exportsRoot}), (e: ExportError) => e.code === 'missing' && /missing from the project/.test(e.message));
    assert.equal(existsSync(exportsRoot), false);
  });

  test('an altered approved file (one byte changed)', () => {
    approved();
    const f = approvedPath();
    chmodSync(f, 0o644);
    const bytes = readFileSync(f);
    bytes[1000] ^= 1;
    writeFileSync(f, bytes);
    assert.throws(() => exportApproved(t.p, EP, {exportsRoot}), (e: ExportError) => e.code === 'altered' && /(damaged|SHA-256 differs|not the file)/.test(e.message));
    assert.equal(existsSync(exportsRoot), false);
  });
});

describe('export renders, encodes and masters nothing', () => {
  test('the export module has no way to start a process (static check)', () => {
    const code = readFileSync(join(ROOT, 'core', 'export.ts'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    assert.doesNotMatch(code, /child_process|\b(spawn|spawnSync|exec|execSync|execFile|execFileSync|fork)\s*\(|ffmpeg|ffprobe|render-worker|\.\/media\.ts/i);
  });

  test('run in its own process with every process start disabled, an export succeeds and no process was started', () => {
    approved();
    const root = t.root;
    t.p.close();
    const out = JSON.parse(execFileSync('node', [join(ROOT, 'tests/store/export-child.ts'), root, join(root, 'exports'), EP], {encoding: 'utf8'}).trim().split('\n').at(-1)!);
    assert.equal(out.ok, true, out.error);
    assert.deepEqual(out.processesStarted, []);
    assert.equal(out.recorded, 1);
    assert.deepEqual(verifyPackage(out.result.dir), {ok: true, problems: []});
    assert.ok(readFileSync(join(out.result.dir, `${EP}.mp4`)).equals(VIDEO_BYTES));
  });
});

describe('what the package may contain', () => {
  const textFiles = (dir: string) => readdirSync(dir).filter((f) => !f.endsWith('.mp4')).map((f) => [f, readFileSync(join(dir, f), 'utf8')] as const);

  test('credits list public sources by title and web address only; notes and local file addresses stay out of every file', () => {
    approved((d) => {
      d.sources = [{title: 'A public guide', url: 'https://example.org/guide', note: 'PRIVATE: from my own prompt notes'}, {title: 'Local file source', url: 'file:///Users/someone/secret.pdf'}];
      d.reviewNotes.push({id: 'private1', text: 'SECRET note', type: 'general', status: 'resolved'});
    });
    const r = exportApproved(t.p, EP, {exportsRoot});
    const files = textFiles(r.dir);
    const credits = files.find(([n]) => n === 'credits.md')![1];
    assert.match(credits, /A public guide \(https:\/\/example\.org\/guide\)/);
    assert.match(credits, /- Local file source\n/);
    for (const [name, text] of files) {
      assert.doesNotMatch(text, /SECRET|PRIVATE|secret\.pdf|file:\/\//, name);
      assert.deepEqual(publicLeaks(text, [t.root, process.env.HOME ?? '']), [], name);
      assert.ok(!text.includes(t.root), `${name} has no path of this project`);
    }
    const meta = JSON.parse(files.find(([n]) => n === 'metadata.json')![1]);
    assert.deepEqual(Object.keys(meta).sort(), ['approvedAt', 'captions', 'chapters', 'description', 'durationSec', 'fps', 'height', 'language', 'synthetic', 'title', 'video', 'voiceModel', 'width']);
    assert.equal(meta.video.sha256, r.verified.before);
    assert.match(meta.synthetic.disclosure, /synthetic voice/);
  });

  test('a title that carries a local path is refused before anything is written', () => {
    approved((d) => { d.title = 'Notes from /Users/someone/Documents/draft'; });
    assert.throws(() => exportApproved(t.p, EP, {exportsRoot}), (e: ExportError) => e.code === 'unsafe' && /Nothing was exported/.test(e.message));
    assert.equal(existsSync(exportsRoot), false);
  });

  test('captions are made from the approved timeline, in SRT and WebVTT', () => {
    const srt = subtitles(TIMELINE, 'srt');
    assert.match(srt, /^1\n00:00:00,500 --> 00:00:02,28\d?\nYour pipeline succeeded\.\n/);
    assert.match(srt, /\n2\n00:00:04,200 --> /);
    const vtt = subtitles(TIMELINE, 'vtt');
    assert.ok(vtt.startsWith('WEBVTT\n\n00:00:00.500 --> '));
    assert.match(vtt, /Finance says paid revenue is ₹600\./);
  });

  test('the leak guard recognises paths and the project folder', () => {
    assert.ok(publicLeaks('see /Users/me/x').length);
    assert.ok(publicLeaks('C:\\Users\\me\\x').length);
    assert.ok(publicLeaks('in .studio/blobs').length);
    assert.deepEqual(publicLeaks('A guide to tokens, https://example.org/a'), []);
  });
});
