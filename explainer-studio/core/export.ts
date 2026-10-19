// Export: copies the approved final video, byte for byte, into a package folder, with files derived from the approved record
// (captions, metadata, credits, checksums). It never renders, encodes, masters or re-muxes anything, and it starts no process: the
// video is a file copy checked by SHA-256 before and after, and the other files are written from data the project already holds.
//
// What is left out on purpose, because the package is meant to be shared: prompts and briefs (they live in the planning records, which
// are not exported), review notes, job and snapshot records, logs, absolute paths of this computer, and the notes of source records.
import {copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, constants} from 'node:fs';
import {join} from 'node:path';
import type {EpisodeV2} from '../src/schema2.ts';
import {approvalStatus, ApprovalVoidError, getApprovedFile, getSnapshot} from './artifacts.ts';
import {blobPath} from './blobs.ts';
import {all, get} from './db.ts';
import {getComponentValue} from './state.ts';
import {readBlob} from './blobs.ts';
import {sha256, sha256File} from './hash.ts';
import type {Project} from './project.ts';

export class ExportError extends Error {
  code: 'no-approval' | 'void' | 'missing' | 'altered' | 'exists' | 'copy-failed' | 'unsafe';
  changed: string[];
  constructor(code: ExportError['code'], message: string, changed: string[] = []) { super(message); this.name = 'ExportError'; this.code = code; this.changed = changed; }
}

export type ExportedFile = {name: string; sha256: string; bytes: number; role: 'video' | 'captions' | 'metadata' | 'credits' | 'checksums'};
export type ExportResult = {
  exportId: number; approvalId: number; dir: string; files: ExportedFile[];
  /** The approved file's hash, read from the project before the copy, from the copy after it, and from the project again afterwards. */
  verified: {before: string; copy: string; after: string};
  /** True when the package already existed with exactly this video, and was only verified. */
  alreadyExported: boolean;
};

export type ExportOptions = {
  /** Where packages go: <exportsRoot>/<episode>/<package>. */
  exportsRoot: string;
  /** public/library of the app, for font licences (optional). */
  libraryRoot?: string;
};

const pad = (n: number, w = 2) => String(Math.floor(n)).padStart(w, '0');
const clock = (sec: number, comma: boolean) => `${pad(sec / 3600)}:${pad((sec % 3600) / 60)}:${pad(sec % 60)}${comma ? ',' : '.'}${pad(Math.round((sec % 1) * 1000), 3).slice(0, 3)}`;

type TlCaption = {segment: string; text: string; words: {text: string; start: number; end: number}[]};
type Timeline = {durationSec: number; segments: {id: string; start: number; end: number}[]; captions: TlCaption[]};

/** Subtitle cues straight from the caption timing in the approved timeline. */
export function subtitles(tl: Timeline, format: 'srt' | 'vtt'): string {
  const cues = tl.captions.filter((c) => c.words.length).map((c, i, all) => {
    const start = c.words[0].start;
    const last = i === all.length - 1;
    const end = Math.min(tl.durationSec, Math.max(c.words[c.words.length - 1].end + (last ? 0.5 : 0.08), start + 0.3));
    return {start, end, text: c.text};
  });
  const body = cues.map((c, i) => `${format === 'srt' ? `${i + 1}\n` : ''}${clock(c.start, format === 'srt')} --> ${clock(c.end, format === 'srt')}\n${c.text}\n`).join('\n');
  return format === 'vtt' ? `WEBVTT\n\n${body}` : body;
}

const isWebUrl = (u: string | undefined): u is string => !!u && /^https?:\/\//i.test(u);

/** The words a package may carry: no absolute paths of this computer, no project-internal folders. */
export function publicLeaks(text: string, extra: string[] = []): string[] {
  const found: string[] = [];
  for (const [re, what] of [[/\/Users\/[^\s"']+/, 'a macOS home path'], [/\/home\/[^\s"']+/, 'a home path'], [/[A-Za-z]:\\[^\s"']+/, 'a Windows path'], [/file:\/\//i, 'a file: address'], [/\.studio\b/, 'the project folder'], [/\bprompt/i, 'the word "prompt"']] as [RegExp, string][]) {
    if (re.test(text)) found.push(what);
  }
  for (const e of extra) if (e && text.includes(e)) found.push('a path of this computer');
  return found;
}

function approvedSnapshot(p: Project, approvalId: number): {doc: EpisodeV2; timeline: Timeline; renderMeta: Record<string, unknown>; approvedAt: number; settings: {width: number; height: number; fps: number}; versions: {remotion?: string}} {
  const a = get<{artifact_id: number; approved_at: number}>(p.db.prepare('SELECT artifact_id, approved_at FROM approvals WHERE id=?'), approvalId)!;
  const art = get<{snapshot_id: string | null; meta_json: string}>(p.db.prepare('SELECT snapshot_id, meta_json FROM artifacts WHERE id=?'), a.artifact_id)!;
  if (!art.snapshot_id) throw new ExportError('missing', 'The approved video has no recorded inputs, so its captions and credits cannot be made from them.');
  const snap = getSnapshot(p, art.snapshot_id);
  const doc = JSON.parse(readBlob(p, snap.docBlob).toString()) as EpisodeV2;
  if (!snap.blobs.timing) throw new ExportError('missing', 'The approved video has no recorded timing.');
  const timeline = JSON.parse(readFileSync(blobPath(p, snap.blobs.timing), 'utf8')) as Timeline;
  const values = (snap.componentValues ?? {}) as {renderSettings?: {width?: number; height?: number; fps?: number}; versions?: {remotion?: string}};
  return {doc, timeline, renderMeta: JSON.parse(art.meta_json), approvedAt: a.approved_at, settings: {width: values.renderSettings?.width ?? 1080, height: values.renderSettings?.height ?? 1920, fps: values.renderSettings?.fps ?? 30}, versions: values.versions ?? {}};
}

export function exportApproved(p: Project, episodeId: string, o: ExportOptions): ExportResult {
  // 1. only a valid approval, and only the exact bytes that were approved
  const status = approvalStatus(p, episodeId);
  if (status.state === 'none') throw new ExportError('no-approval', 'There is no approved final video to export.');
  const recorded = get<{file_sha256: string}>(p.db.prepare('SELECT file_sha256 FROM approvals WHERE id=?'), status.approvalId!)!.file_sha256;
  if (!existsSync(blobPath(p, recorded))) throw new ExportError('missing', 'The approved video file is missing from the project. Nothing was exported.', ['file']);
  if (status.state === 'void') throw new ExportError('void', `Approval is void, so nothing was exported. What changed: ${status.changed.join(', ')}.`, status.changed);
  let approved: ReturnType<typeof getApprovedFile>;
  try { approved = getApprovedFile(p, episodeId); }
  catch (e) {
    if (e instanceof ApprovalVoidError) throw new ExportError(e.changed.includes('file') ? 'altered' : 'void', e.message, e.changed);
    throw e;
  }
  const before = sha256File(approved.path).hash;
  if (before !== approved.sha256) throw new ExportError('altered', 'The approved file is not the file that was approved (its SHA-256 differs). Nothing was exported.', ['file']);

  // 2. everything public is made from the approved record; check it before anything is written
  const snap = approvedSnapshot(p, status.approvalId!);
  const { doc, timeline } = snap;
  const slug = doc.id;
  const dir = join(o.exportsRoot, episodeId, `approval-${status.approvalId}-${approved.sha256.slice(0, 8)}`);
  const videoName = `${slug}.mp4`;
  const meta = (() => {
    const voice = getComponentValue<{model?: string; engine?: string}>(p, 'voiceRuntime', episodeId);
    const chapters = doc.chapters.map((c) => ({label: c.label, startSec: Math.round((timeline.segments.find((s) => s.id === c.segment)?.start ?? 0) * 100) / 100}));
    return {
      title: doc.title, description: doc.learningObjective, language: 'en',
      durationSec: Math.round(timeline.durationSec * 100) / 100, width: snap.settings.width, height: snap.settings.height, fps: snap.settings.fps,
      video: {file: videoName, sha256: approved.sha256, bytes: approved.bytes, codec: 'h264', audio: 'aac', note: 'The file is exactly the approved video; it was copied, not re-encoded.'},
      chapters, captions: {srt: `${slug}.srt`, vtt: `${slug}.vtt`},
      synthetic: {narration: true, disclosure: 'The narration is a synthetic voice made with a text-to-speech model, reading the script. The presenter, Pip, is an illustrated character.'},
      voiceModel: voice?.model ?? null,
      approvedAt: new Date(snap.approvedAt).toISOString(),
    };
  })();
  const fonts = (() => {
    if (!o.libraryRoot || doc.style !== 'pip-paper-bundled') return [];
    const f = join(o.libraryRoot, 'fonts', 'manifest.json');
    if (!existsSync(f)) return [];
    return (JSON.parse(readFileSync(f, 'utf8')).files as {family: string; license: string; version: string; source: string}[]).map((x) => ({family: x.family, license: x.license, version: x.version, source: x.source}));
  })();
  const sources = doc.sources.map((s) => ({title: s.title, ...(isWebUrl(s.url) ? {url: s.url} : {})}));
  const credits = [
    `# ${doc.title}`, '',
    'Narration: a synthetic voice (text-to-speech), reading the script written for this video.',
    'Presenter: Pip, an illustrated character.',
    `Made with Remotion${snap.versions.remotion ? ` ${snap.versions.remotion}` : ''}, rendered to H.264 video with AAC audio.`,
    ...(fonts.length ? ['', '## Fonts', ...fonts.map((f) => `- ${f.family} ${f.version} (${f.license}), ${f.source}`)] : []),
    ...(sources.length ? ['', '## Sources', ...sources.map((s) => `- ${s.title}${s.url ? ` (${s.url})` : ''}`)] : []),
    '',
  ].join('\n');
  const texts: Record<string, string> = {
    [`${slug}.srt`]: subtitles(timeline, 'srt'), [`${slug}.vtt`]: subtitles(timeline, 'vtt'),
    'metadata.json': JSON.stringify(meta, null, 2) + '\n', 'credits.md': credits,
  };
  for (const [name, text] of Object.entries(texts)) {
    const leaks = publicLeaks(text, [p.root, process.env.HOME ?? '']);
    if (leaks.length) throw new ExportError('unsafe', `${name} would contain ${leaks.join(', ')}, which must not leave the project. Nothing was exported.`);
  }

  // 3. the video is a byte copy, never overwriting a different file
  const dest = join(dir, videoName);
  const exists = existsSync(dest);
  if (exists && sha256File(dest).hash !== approved.sha256) throw new ExportError('exists', `The package folder already holds a different ${videoName}. It was not overwritten and nothing was exported.`);
  mkdirSync(dir, {recursive: true});
  if (!exists) {
    try { copyFileSync(approved.path, dest, constants.COPYFILE_EXCL); } catch (e) { throw new ExportError('copy-failed', `The file could not be copied: ${(e as Error).message}`); }
  }
  const copied = sha256File(dest).hash;
  if (copied !== approved.sha256) {
    rmSync(dest, {force: true});
    throw new ExportError('copy-failed', 'The copy does not match the approved file (SHA-256 differs); it was removed and nothing was exported.');
  }
  // 4. the derived files, then checksums over everything that is in the package
  for (const [name, text] of Object.entries(texts)) writeFileSync(join(dir, name), text);
  const entries: ExportedFile[] = [
    {name: videoName, sha256: copied, bytes: approved.bytes, role: 'video'},
    ...Object.entries(texts).map(([name, text]): ExportedFile => ({name, sha256: sha256(text), bytes: Buffer.byteLength(text), role: name.endsWith('.json') ? 'metadata' : name.endsWith('.md') ? 'credits' : 'captions'})),
  ];
  const sums = entries.map((e) => `${e.sha256}  ${e.name}`).join('\n') + '\n';
  writeFileSync(join(dir, 'checksums.sha256'), sums);
  entries.push({name: 'checksums.sha256', sha256: sha256(sums), bytes: Buffer.byteLength(sums), role: 'checksums'});

  // 5. the approved file in the project is unchanged by all this
  const after = sha256File(approved.path).hash;
  if (after !== approved.sha256) throw new ExportError('altered', 'The approved file changed while it was being exported. The package must not be used.', ['file']);
  const id = Number(p.db.prepare('INSERT INTO exports(episode_id,approval_id,dir,file_sha256,files_json,exported_at) VALUES(?,?,?,?,?,?)').run(episodeId, status.approvalId!, dir, approved.sha256, JSON.stringify(entries), p.now()).lastInsertRowid);
  return {exportId: id, approvalId: status.approvalId!, dir, files: entries, verified: {before, copy: copied, after}, alreadyExported: exists};
}

/** Re-read a package from disk and compare it with its checksum file: the package is intact, or these files are not. */
export function verifyPackage(dir: string): {ok: boolean; problems: string[]} {
  const problems: string[] = [];
  const f = join(dir, 'checksums.sha256');
  if (!existsSync(f)) return {ok: false, problems: ['checksums.sha256 is missing']};
  for (const line of readFileSync(f, 'utf8').split('\n').filter(Boolean)) {
    const [sum, name] = [line.slice(0, 64), line.slice(66)];
    const file = join(dir, name);
    if (!existsSync(file)) problems.push(`${name} is missing`);
    else if (sha256File(file).hash !== sum) problems.push(`${name} does not match its recorded SHA-256`);
  }
  return {ok: problems.length === 0, problems};
}

export const exportsOf = (p: Project, episodeId: string) =>
  all<{id: number; approval_id: number; dir: string; file_sha256: string; files_json: string; exported_at: number}>(p.db.prepare('SELECT id, approval_id, dir, file_sha256, files_json, exported_at FROM exports WHERE episode_id=? ORDER BY id DESC'), episodeId)
    .map((r) => ({id: r.id, approvalId: r.approval_id, dir: r.dir, fileSha256: r.file_sha256, files: JSON.parse(r.files_json) as ExportedFile[], exportedAt: r.exported_at}));
