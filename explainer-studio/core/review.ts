// Review: rounds (one per reviewed video), notes written against a video, what was played and ticked against that exact file, and the
// approval that rests on all of it. Nothing here ticks a box, plays anything or approves by itself: every record comes from a call
// that a person's action causes, and approval reads its sign-offs from these records, never from the request that asks for approval.
//
// Notes live in the episode document (reviewNotes), as they did before rounds existed; a note edit goes through the normal save with
// the sequence check, so it conflicts with a newer save instead of overwriting it. Notes never enter a dependency hash.
import type {EpisodeV2, Note} from '../src/schema2.ts';
import {approve, ApprovalError, approvalStatus, checkInputsHash, SIGNOFFS, type Signoffs, statusReport} from './artifacts.ts';
import {CHECKS_VERSION, type CheckReport} from './checks.ts';
import {blobPath, requireBlob} from './blobs.ts';
import {all, get} from './db.ts';
import {getEpisode, getEpisodeInfo, saveEpisode} from './episodes.ts';
import {hashJson} from './hash.ts';
import type {Project} from './project.ts';
import {currentRows} from './state.ts';
import {readFileSync} from 'node:fs';

export class ReviewError extends Error {
  code: 'unknown' | 'refused' | 'conflict';
  constructor(code: ReviewError['code'], message: string) { super(message); this.name = 'ReviewError'; this.code = code; }
}

export type Round = {id: number; episodeId: string; number: number; renderArtifactId: number; kind: 'draft' | 'final'; fileSha256: string; openedAt: number; closedAt: number | null};
type RoundRow = {id: number; episode_id: string; number: number; render_artifact_id: number; kind: string; file_sha256: string; opened_at: number; closed_at: number | null};
const toRound = (r: RoundRow): Round => ({id: r.id, episodeId: r.episode_id, number: r.number, renderArtifactId: r.render_artifact_id, kind: r.kind as 'draft' | 'final', fileSha256: r.file_sha256, openedAt: r.opened_at, closedAt: r.closed_at});

export const getRound = (p: Project, roundId: number): Round => {
  const r = get<RoundRow>(p.db.prepare('SELECT * FROM review_rounds WHERE id=?'), roundId);
  if (!r) throw new ReviewError('unknown', `There is no review round ${roundId}.`);
  return toRound(r);
};
export const listRounds = (p: Project, episodeId: string): Round[] => all<RoundRow>(p.db.prepare('SELECT * FROM review_rounds WHERE episode_id=? ORDER BY number'), episodeId).map(toRound);
export const roundForRender = (p: Project, renderArtifactId: number): Round | null => {
  const r = get<RoundRow>(p.db.prepare('SELECT * FROM review_rounds WHERE render_artifact_id=?'), renderArtifactId);
  return r ? toRound(r) : null;
};

/** Start reviewing a video: records which exact file this round is about. Opening a video that already has a round returns that round. */
export function openRound(p: Project, episodeId: string, renderArtifactId: number): Round {
  return p.tx('open-round', () => {
    const existing = roundForRender(p, renderArtifactId);
    if (existing) { if (existing.episodeId !== episodeId) throw new ReviewError('refused', 'That video belongs to another episode.'); return existing; }
    const a = get<{episode_id: string; kind: string; subject: string; blob_hash: string}>(p.db.prepare('SELECT episode_id, kind, subject, blob_hash FROM artifacts WHERE id=?'), renderArtifactId);
    if (!a || a.kind !== 'render' || a.episode_id !== episodeId) throw new ReviewError('unknown', 'That is not a rendered video of this episode.');
    try { requireBlob(p, a.blob_hash); } catch { throw new ReviewError('refused', 'The video file is not in the project, so it cannot be reviewed.'); }
    const number = (get<{n: number | null}>(p.db.prepare('SELECT max(number) AS n FROM review_rounds WHERE episode_id=?'), episodeId)?.n ?? 0) + 1;
    const id = Number(p.db.prepare('INSERT INTO review_rounds(episode_id,number,render_artifact_id,kind,file_sha256,opened_at) VALUES(?,?,?,?,?,?)').run(episodeId, number, renderArtifactId, a.subject, a.blob_hash, p.now()).lastInsertRowid);
    return getRound(p, id);
  });
}

export function closeRound(p: Project, roundId: number): Round {
  getRound(p, roundId);
  p.db.prepare('UPDATE review_rounds SET closed_at=? WHERE id=? AND closed_at IS NULL').run(p.now(), roundId);
  return getRound(p, roundId);
}

// ---- playback coverage ---------------------------------------------------------------------------------------------
export type PlaybackReport = {fromSec: number; toSec: number; /** Sound was on (not muted, volume above zero). */ heard: boolean; /** Shown at phone size. */ phone: boolean};
const MAX_CHUNK_SEC = 15;
/** A report may cover at most this much more than the time that really passed since the previous one (a little slack for timers). */
const SLACK = 1.25, SLACK_ADD_SEC = 2;

/**
 * Record that a stretch of the video was played. The server cannot know what a person saw or heard; it only refuses reports that
 * could not have happened (outside the file, longer than the time that passed, wrong order), so playback cannot be filled in at once.
 */
export function recordPlayback(p: Project, roundId: number, durationSec: number, r: PlaybackReport): void {
  const round = getRound(p, roundId);
  if (![r.fromSec, r.toSec].every(Number.isFinite) || r.fromSec < 0 || r.toSec <= r.fromSec) throw new ReviewError('refused', 'That is not a playback range.');
  if (r.toSec > durationSec + 0.5) throw new ReviewError('refused', 'That range goes past the end of the video.');
  if (r.toSec - r.fromSec > MAX_CHUNK_SEC) throw new ReviewError('refused', `A playback report covers at most ${MAX_CHUNK_SEC} seconds.`);
  const now = p.now();
  const last = get<{m: number | null}>(p.db.prepare('SELECT max(at) AS m FROM review_playback WHERE round_id=?'), roundId)?.m ?? null;
  const elapsed = last === null ? MAX_CHUNK_SEC : (now - last) / 1000;
  if (r.toSec - r.fromSec > elapsed * SLACK + SLACK_ADD_SEC) throw new ReviewError('refused', 'That much video cannot have played in the time since the last report.');
  p.db.prepare('INSERT INTO review_playback(round_id,from_ms,to_ms,heard,phone,at) VALUES(?,?,?,?,?,?)').run(roundId, Math.round(r.fromSec * 1000), Math.round(Math.min(r.toSec, durationSec) * 1000), r.heard ? 1 : 0, r.phone ? 1 : 0, now);
  void round;
}

export type Coverage = {
  durationSec: number;
  /** Seconds of the file that were played at all, with the sound on, and at phone size with the sound on. */
  playedSec: number; heardSec: number; phoneHeardSec: number;
  /** Stretches of the file never played with the sound on. Gaps under the tolerance are seek granularity, not skipped video. */
  unheard: [number, number][];
  /** Every second of the file was played with the sound on (gaps no longer than the tolerance, and no more than one second in all). */
  complete: boolean;
};
export const COVERAGE_GAP_SEC = 0.35;

const union = (ranges: [number, number][]): [number, number][] => {
  const out: [number, number][] = [];
  for (const [a, b] of [...ranges].sort((x, y) => x[0] - y[0])) {
    if (out.length && a <= out[out.length - 1][1] + 1e-6) out[out.length - 1][1] = Math.max(out[out.length - 1][1], b); else out.push([a, b]);
  }
  return out;
};
const total = (rs: [number, number][]) => rs.reduce((s, [a, b]) => s + (b - a), 0);

export function coverageOf(p: Project, roundId: number, durationSec: number): Coverage {
  const rows = all<{from_ms: number; to_ms: number; heard: number; phone: number}>(p.db.prepare('SELECT from_ms, to_ms, heard, phone FROM review_playback WHERE round_id=?'), roundId);
  const sec = (r: {from_ms: number; to_ms: number}): [number, number] => [r.from_ms / 1000, r.to_ms / 1000];
  const heard = union(rows.filter((r) => r.heard).map(sec));
  const unheard: [number, number][] = [];
  let at = 0;
  for (const [a, b] of heard) { if (a > at + 1e-6) unheard.push([at, a]); at = Math.max(at, b); }
  if (at < durationSec - 1e-6) unheard.push([at, durationSec]);
  const gapSum = total(unheard);
  const r2 = (n: number) => Math.round(n * 100) / 100;
  return {
    durationSec, playedSec: r2(total(union(rows.map(sec)))), heardSec: r2(total(heard)), phoneHeardSec: r2(total(union(rows.filter((r) => r.heard && r.phone).map(sec)))),
    unheard: unheard.map(([a, b]) => [r2(a), r2(b)]), complete: unheard.every(([a, b]) => b - a <= COVERAGE_GAP_SEC) && gapSum <= 1,
  };
}

// ---- sign-offs ---------------------------------------------------------------------------------------------------------
export type SignoffRecord = {item: (typeof SIGNOFFS)[number]; ticked: boolean; at: number | null};

/** Record that a person ticked (or unticked) one box for this round's video. A box is only ever set by this call. */
export function setSignoff(p: Project, roundId: number, item: string, ticked: boolean): SignoffRecord[] {
  const round = getRound(p, roundId);
  if (!(SIGNOFFS as readonly string[]).includes(item)) throw new ReviewError('refused', `"${item}" is not one of the sign-offs.`);
  if (round.closedAt !== null) throw new ReviewError('refused', 'This round is closed.');
  p.db.prepare('INSERT INTO review_signoffs(round_id,item,ticked,at) VALUES(?,?,?,?) ON CONFLICT(round_id,item) DO UPDATE SET ticked=excluded.ticked, at=excluded.at').run(roundId, item, ticked ? 1 : 0, p.now());
  return getSignoffs(p, roundId);
}
export function getSignoffs(p: Project, roundId: number): SignoffRecord[] {
  const rows = all<{item: string; ticked: number; at: number}>(p.db.prepare('SELECT item, ticked, at FROM review_signoffs WHERE round_id=?'), roundId);
  return SIGNOFFS.map((item) => { const r = rows.find((x) => x.item === item); return {item, ticked: r?.ticked === 1, at: r ? r.at : null}; });
}

// ---- caption/speech differences the author confirms ---------------------------------------------------------------------------
export function confirmCaptionDiff(p: Project, episodeId: string, segmentId: string, diffHash: string): void {
  p.db.prepare('INSERT OR IGNORE INTO caption_confirmations(episode_id,segment_id,diff_hash,at) VALUES(?,?,?,?)').run(episodeId, segmentId, diffHash, p.now());
}
export function unconfirmCaptionDiff(p: Project, episodeId: string, segmentId: string, diffHash: string): void {
  p.db.prepare('DELETE FROM caption_confirmations WHERE episode_id=? AND segment_id=? AND diff_hash=?').run(episodeId, segmentId, diffHash);
}

// ---- notes -------------------------------------------------------------------------------------------------------------------------
const segmentOf = (doc: EpisodeV2, id: string) => doc.narration.segments.find((s) => s.id === id);
const sceneOf = (doc: EpisodeV2, segmentId: string) => doc.scenes.find((s) => s.segments.includes(segmentId));
export const segmentHash = (doc: EpisodeV2, id: string): string | null => { const s = segmentOf(doc, id); return s ? hashJson({text: s.text, speech: s.speech ?? null, captions: s.captions ?? null, emphasis: s.emphasis ?? null}) : null; };
export const sceneHash = (doc: EpisodeV2, segmentId: string): string | null => { const sc = sceneOf(doc, segmentId); return sc ? hashJson(sc) : null; };

export type NoteAssessment = {
  /** current: nothing it was written about has changed; reassess: the content changed since (or since the author last said it still applies); orphaned: its segment is gone; legacy: written before context was kept. */
  state: 'current' | 'reassess' | 'orphaned' | 'legacy';
  reasons: string[];
};

/** Computed, never stored: whether what a note was written about has changed. The note itself (its text, its original context) is never altered by this. */
export function assessNote(note: Note, doc: EpisodeV2): NoteAssessment {
  const seg = note.anchor?.segment;
  if (!seg || !note.context) return {state: 'legacy', reasons: note.context ? [] : ['It was written before notes kept the text they were about, so changes cannot be detected.']};
  if (!segmentOf(doc, seg)) return {state: 'orphaned', reasons: [`Segment ${seg}, which it was written on, no longer exists.`]};
  const base = note.reassessed ?? {segmentHash: note.context.segmentHash, sceneHash: note.context.sceneHash};
  const reasons: string[] = [];
  if (segmentHash(doc, seg) !== base.segmentHash) reasons.push(`The wording of segment ${seg} changed${note.reassessed ? ' after you last confirmed this note' : ' since it was written'}.`);
  if (base.sceneHash !== undefined && sceneHash(doc, seg) !== base.sceneHash) reasons.push(`The scene that shows segment ${seg} changed${note.reassessed ? ' after you last confirmed this note' : ' since it was written'}.`);
  return reasons.length ? {state: 'reassess', reasons} : {state: 'current', reasons: []};
}

const sourceDoc = (p: Project, round: Round): EpisodeV2 | null => {
  const r = get<{snapshot_id: string | null}>(p.db.prepare('SELECT snapshot_id FROM artifacts WHERE id=?'), round.renderArtifactId);
  if (!r?.snapshot_id) return null;
  try {
    const m = JSON.parse(get<{manifest_json: string}>(p.db.prepare('SELECT manifest_json FROM snapshots WHERE id=?'), r.snapshot_id)!.manifest_json) as {docBlob: string};
    return JSON.parse(readFileSync(blobPath(p, m.docBlob), 'utf8')) as EpisodeV2;
  } catch { return null; }
};

export type NewNote = {roundId: number; text: string; type: Note['type']; timeSec?: number; segment?: string; word?: number; build?: string};

function saveNotes(p: Project, episodeId: string, change: (doc: EpisodeV2) => EpisodeV2, expectSeq?: number): {seq: number; doc: EpisodeV2} {
  const info = getEpisodeInfo(p, episodeId);
  if (expectSeq !== undefined && expectSeq !== info.seq) throw new ReviewError('conflict', 'The episode was saved again since this page was loaded. Nothing was changed; the page has been refreshed.');
  const next = change(getEpisode(p, episodeId));
  const r = saveEpisode(p, episodeId, next, {baseSeq: info.seq});
  return {seq: r.seq, doc: next};
}

/** A note written against a round's video: it keeps the round, the file, and the text of the segment and scene as they were then. */
export function addReviewNote(p: Project, episodeId: string, n: NewNote, expectSeq?: number): {note: Note; seq: number} {
  const text = n.text.trim();
  if (!text) throw new ReviewError('refused', 'A note needs some text.');
  const round = getRound(p, n.roundId);
  if (round.episodeId !== episodeId) throw new ReviewError('refused', 'That round belongs to another episode.');
  const made: {note?: Note} = {};
  const saved = saveNotes(p, episodeId, (doc) => {
    const used = new Set(doc.reviewNotes.map((x) => x.id));
    let k = doc.reviewNotes.length + 1;
    while (used.has(`n${k}`)) k++;
    // the context is the text of the video that was reviewed, when the round's own record has it, else of the episode now
    const ref = sourceDoc(p, round) ?? doc;
    const seg = n.segment ? segmentOf(ref, n.segment) : undefined;
    const note: Note = {
      id: `n${k}`, text, type: n.type, status: 'open',
      ...(n.segment ? {anchor: {segment: n.segment, ...(n.word !== undefined ? {word: n.word} : {})}} : {}),
      ...(n.timeSec !== undefined ? {timeSec: Math.round(n.timeSec * 100) / 100} : {}),
      render: {id: String(round.renderArtifactId), kind: round.kind, ...(n.build ? {build: n.build} : {}), sha256: round.fileSha256},
      round: round.number, createdAt: p.now(),
      ...(seg && n.segment ? {context: {segmentText: seg.text, ...(seg.speech !== undefined ? {speech: seg.speech} : {}), segmentHash: segmentHash(ref, n.segment)!, ...(sceneOf(ref, n.segment) ? {sceneId: sceneOf(ref, n.segment)!.id, sceneHash: sceneHash(ref, n.segment)!} : {}), at: p.now()}} : {}),
      events: [{at: p.now(), kind: 'created'}],
    };
    made.note = note;
    return {...doc, reviewNotes: [...doc.reviewNotes, note]};
  }, expectSeq);
  return {note: made.note!, seq: saved.seq};
}

export type NoteChange =
  | {op: 'edit'; text: string; type?: Note['type']}
  | {op: 'resolve'; text?: string}
  | {op: 'wont-fix'; text?: string}
  | {op: 'reopen'}
  | {op: 'reassess'};

/** Edit, resolve, dismiss, reopen, or confirm that a note still applies after the content changed. The original text is kept in the note's events. */
export function changeNote(p: Project, episodeId: string, noteId: string, change: NoteChange, expectSeq?: number): {note: Note; seq: number} {
  const made: {note?: Note} = {};
  const saved = saveNotes(p, episodeId, (doc) => {
    const i = doc.reviewNotes.findIndex((x) => x.id === noteId);
    if (i < 0) throw new ReviewError('unknown', `There is no note ${noteId}.`);
    const old = doc.reviewNotes[i];
    const at = p.now();
    const ev = (kind: NonNullable<Note['events']>[number]['kind'], text?: string) => [...(old.events ?? []), {at, kind, ...(text ? {text} : {})}];
    let next: Note;
    if (change.op === 'edit') {
      const text = change.text.trim();
      if (!text) throw new ReviewError('refused', 'A note needs some text.');
      next = {...old, text, ...(change.type ? {type: change.type} : {}), events: ev('edited', old.text)};
    } else if (change.op === 'resolve') next = {...old, status: 'resolved', events: ev('resolved', change.text?.trim() || undefined)};
    else if (change.op === 'wont-fix') next = {...old, status: 'wont-fix', events: ev('wont-fix', change.text?.trim() || undefined)};
    else if (change.op === 'reopen') next = {...old, status: 'open', events: ev('reopened')};
    else {
      const seg = old.anchor?.segment;
      const h = seg ? segmentHash(doc, seg) : null;
      if (!seg || !h) throw new ReviewError('refused', 'This note has no segment that still exists to confirm it against.');
      next = {...old, reassessed: {at, segmentHash: h, ...(sceneHash(doc, seg) ? {sceneHash: sceneHash(doc, seg)!} : {})}, events: ev('reassessed')};
    }
    made.note = next;
    return {...doc, reviewNotes: doc.reviewNotes.map((x, j) => (j === i ? next : x))};
  }, expectSeq);
  return {note: made.note!, seq: saved.seq};
}

// ---- checks ---------------------------------------------------------------------------------------------------------------------------
/** The newest check report made for exactly this video and this version of the suite, if there is one. */
export function checkReportFor(p: Project, episodeId: string, renderArtifactId: number): {artifactId: number; report: CheckReport; ranAt: number} | null {
  let inputs: string;
  try { inputs = checkInputsHash(p, renderArtifactId); } catch { return null; }
  const a = get<{id: number; blob_hash: string; created_at: number}>(p.db.prepare("SELECT id, blob_hash, created_at FROM artifacts WHERE episode_id=? AND kind='check' AND subject=? AND inputs_hash=? ORDER BY id DESC LIMIT 1"), episodeId, String(renderArtifactId), inputs);
  if (!a) return null;
  try { return {artifactId: a.id, report: JSON.parse(readFileSync(blobPath(p, a.blob_hash), 'utf8')) as CheckReport, ranAt: a.created_at}; } catch { return null; }
}

// ---- approval -----------------------------------------------------------------------------------------------------------------------
export type Readiness = {
  round: Round | null;
  /** Everything that stands between this video and approval, in plain words. Empty means approval can be recorded by a person's action. */
  blockers: string[];
  signoffs: SignoffRecord[];
  coverage: Coverage | null;
  checks: {artifactId: number; passed: boolean; version: string} | null;
  openNotes: number;
};

/** What approval of this episode's current final video still needs. Computed on every call from the records; nothing is remembered. */
export function readiness(p: Project, episodeId: string, durationSec: number | null): Readiness {
  const blockers: string[] = [];
  const cur = currentRows(p, episodeId).find((r) => r.kind === 'render' && r.subject === 'final');
  const round = cur ? roundForRender(p, cur.artifact_id) : null;
  const status = statusReport(p, episodeId);
  if (!cur) blockers.push('There is no final video. Make one first; a draft cannot be approved.');
  else {
    if (status.render.final.status !== 'fresh') blockers.push(`The final video is ${status.render.final.status === 'stale' ? 'out of date: ' + status.render.final.reasons.join('; ') : status.render.final.status}.`);
    if (JSON.parse(cur.meta_json).mastered !== true) blockers.push('The final video is not recorded as mastered.');
    if (!round) blockers.push('This final video has not been opened for review yet. Start a review round on it.');
  }
  const signoffs = round ? getSignoffs(p, round.id) : SIGNOFFS.map((item) => ({item, ticked: false, at: null}));
  const coverage = round && durationSec !== null ? coverageOf(p, round.id, durationSec) : null;
  const checks = cur ? checkReportFor(p, episodeId, cur.artifact_id) : null;
  if (round) {
    if (cur && round.fileSha256 !== cur.blob_hash) blockers.push('The review round was for a different file than the current final video.');
    if (!checks) blockers.push('The production checks have not been run on this exact file.');
    else if (checks.report.version !== CHECKS_VERSION) blockers.push('The production checks were made by an older version of the suite; run them again.');
    else if (!checks.report.passed) blockers.push(`The production checks have ${checks.report.summary.fail} failing item${checks.report.summary.fail === 1 ? '' : 's'}.`);
    const missing = signoffs.filter((s) => !s.ticked).map((s) => s.item);
    if (missing.length) blockers.push(`These confirmations are not ticked: ${missing.join(', ')}.`);
    if (!coverage || !coverage.complete) blockers.push('The whole video has not been played with the sound on in this round.');
  }
  const doc = getEpisode(p, episodeId);
  const openNotes = doc.reviewNotes.filter((n) => n.status === 'open').length;
  if (openNotes) blockers.push(`${openNotes} note${openNotes === 1 ? ' is' : 's are'} still open. Resolve them or mark them won't fix.`);
  return {round, blockers, signoffs, coverage, checks: checks ? {artifactId: checks.artifactId, passed: checks.report.passed, version: checks.report.version} : null, openNotes};
}

/**
 * Record approval of the current final video. The sign-offs, the playback coverage and the check report are read from the records of
 * the round, not from the caller; anything missing refuses the approval and names what. The approval itself (file hash, input hash,
 * moving the approved pointer) is the existing `approve`, in the same transaction as the record of what it rested on.
 */
export function approveReviewed(p: Project, episodeId: string, roundId: number, durationSec: number): number {
  const round = getRound(p, roundId);
  if (round.episodeId !== episodeId) throw new ReviewError('refused', 'That round belongs to another episode.');
  const cur = currentRows(p, episodeId).find((r) => r.kind === 'render' && r.subject === 'final');
  if (!cur || cur.artifact_id !== round.renderArtifactId) throw new ApprovalError('cannot approve:\n  - this round is not for the current final video', ['this round is not for the current final video']);
  if (round.kind !== 'final') throw new ApprovalError('cannot approve:\n  - a draft cannot be approved', ['a draft cannot be approved']);
  const r = readiness(p, episodeId, durationSec);
  if (r.blockers.length) throw new ApprovalError(`cannot approve:\n  - ${r.blockers.join('\n  - ')}`, r.blockers);
  const signoffs = Object.fromEntries(r.signoffs.map((s) => [s.item, s.ticked])) as Signoffs;
  const doc = getEpisode(p, episodeId);
  const detail = {signoffTimes: Object.fromEntries(r.signoffs.map((s) => [s.item, s.at])), openNotes: doc.reviewNotes.filter((n) => n.status === 'open').length, checkVersion: r.checks!.version, note: 'Ticks and playback ranges record actions, not attention or correctness.'};
  return approve(p, episodeId, signoffs, (approvalId) => {
    p.db.prepare('INSERT INTO approval_review(approval_id,round_id,checks_artifact_id,coverage_json,detail_json) VALUES(?,?,?,?,?)').run(approvalId, roundId, r.checks!.artifactId, JSON.stringify(r.coverage), JSON.stringify(detail));
    p.db.prepare('UPDATE review_rounds SET closed_at=COALESCE(closed_at, ?) WHERE id=?').run(p.now(), roundId);
  });
}

export {approvalStatus};
