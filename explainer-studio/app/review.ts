// The review service: assembles what the Review screen shows and carries out what a person does there (open a round, play, tick, note,
// confirm a caption difference, approve, export). It adds no rules of its own: the rules are in core/review.ts, core/checks.ts and
// core/export.ts. Nothing here ticks a box, approves or exports without being asked to by that person's action.
import {existsSync, readFileSync, statSync} from 'node:fs';
import {join} from 'node:path';
import {approvalStatus, getSnapshot, statusReport} from '../core/artifacts.ts';
import {blobPath} from '../core/blobs.ts';
import {all, get} from '../core/db.ts';
import {coverFor} from '../core/cover.ts';
import {exportApproved, exportsOf, type ExportResult} from '../core/export.ts';
import {getEpisode, getEpisodeInfo} from '../core/episodes.ts';
import {
  addReviewNote, approveReviewed, assessNote, changeNote, checkReportFor, confirmCaptionDiff, coverageOf, getRound, getSignoffs, listRounds, openRound, readiness, recordPlayback,
  ReviewError, roundForRender, setSignoff, unconfirmCaptionDiff, type NoteChange, type PlaybackReport, type Round,
} from '../core/review.ts';
import {currentRows} from '../core/state.ts';
import type {Note} from '../src/schema2.ts';
import {listBuilds} from './builds.ts';
import type {JobService} from './jobs.ts';
import type {ApprovalView, CoverView, ExportView, NoteView, ReviewView, VideoRow} from './shared/review.ts';

export type ReviewOptions = {exportsRoot: string; libraryRoot?: string};

type RenderRow = {id: number; subject: string; blob_hash: string; snapshot_id: string | null; revision_number: number | null; created_at: number; meta_json: string};

export class ReviewService {
  readonly jobs: JobService;
  private o: ReviewOptions;
  constructor(jobs: JobService, o: ReviewOptions) { this.jobs = jobs; this.o = o; }
  private get p() { return this.jobs.p; }

  /** How long a rendered video is: its own render record, else the timing it was made from. */
  durationOf(renderArtifactId: number): number | null {
    const r = get<RenderRow>(this.p.db.prepare("SELECT id, subject, blob_hash, snapshot_id, revision_number, created_at, meta_json FROM artifacts WHERE id=? AND kind='render'"), renderArtifactId);
    if (!r) return null;
    const m = JSON.parse(r.meta_json) as {frames?: number; fps?: number};
    if (m.frames && m.fps) return Math.round((m.frames / m.fps) * 100) / 100;
    try {
      if (!r.snapshot_id) return null;
      const t = getSnapshot(this.p, r.snapshot_id).blobs.timing;
      return t ? (JSON.parse(readFileSync(blobPath(this.p, t), 'utf8')) as {durationSec: number}).durationSec : null;
    } catch { return null; }
  }

  private segmentTimes(renderArtifactId: number): {id: string; start: number; end: number}[] {
    try {
      const r = get<{snapshot_id: string | null}>(this.p.db.prepare('SELECT snapshot_id FROM artifacts WHERE id=?'), renderArtifactId);
      const t = r?.snapshot_id ? getSnapshot(this.p, r.snapshot_id).blobs.timing : null;
      return t ? (JSON.parse(readFileSync(blobPath(this.p, t), 'utf8')) as {segments: {id: string; start: number; end: number}[]}).segments.map((s) => ({id: s.id, start: s.start, end: s.end})) : [];
    } catch { return []; }
  }

  private videoRows(episodeId: string): VideoRow[] {
    const status = statusReport(this.p, episodeId);
    const builds = listBuilds(this.p, episodeId);
    const jobs = all<{subject: string; state: string}>(this.p.db.prepare("SELECT subject, state FROM jobs WHERE episode_id=? AND kind='check.suite' AND state IN ('queued','preparing','running','cancelling')"), episodeId);
    const rows = all<RenderRow>(this.p.db.prepare("SELECT id, subject, blob_hash, snapshot_id, revision_number, created_at, meta_json FROM artifacts WHERE episode_id=? AND kind='render' ORDER BY id DESC LIMIT 30"), episodeId)
      .filter((r) => existsSync(blobPath(this.p, r.blob_hash)));
    return rows.map((r): VideoRow => {
      const kind = r.subject as 'draft' | 'final';
      const round = roundForRender(this.p, r.id);
      const report = checkReportFor(this.p, episodeId, r.id);
      const running = jobs.some((j) => j.subject === String(r.id));
      const cv = coverFor(this.p, episodeId, r.id);
      const cover: CoverView | null = cv.hook || cv.coverArtifactId ? {state: cv.state, hook: cv.hook, fileSha256: cv.fileSha256, bytes: cv.bytes, width: cv.width, height: cv.height, frame: cv.frame, builtAt: cv.builtAt, renderSha256: cv.renderSha256, why: cv.why, url: cv.coverArtifactId ? `/media/cover/${episodeId}/${r.id}.png` : null, downloadUrl: cv.coverArtifactId ? `/media/cover/${episodeId}/${r.id}.png?download=1` : null, filename: `${episodeId}-cover.png`} : null;
      return {
        renderArtifactId: r.id, kind, label: kind === 'final' ? 'Final (mastered)' : 'Draft (not mastered)', buildId: builds.find((b) => b.render?.id === r.id)?.id ?? null,
        revision: r.revision_number, builtAt: r.created_at, fileSha256: r.blob_hash, bytes: statSync(blobPath(this.p, r.blob_hash)).size, durationSec: this.durationOf(r.id),
        url: `/media/render/${episodeId}/${r.id}.mp4`,
        isCurrent: status.render[kind].artifactId === r.id, fresh: status.render[kind].artifactId === r.id && status.render[kind].status === 'fresh',
        imported: (JSON.parse(r.meta_json) as {imported?: {note?: string}}).imported?.note ?? null,
        round: round ? {id: round.id, number: round.number, closedAt: round.closedAt} : null,
        checks: {state: running ? 'running' : report ? 'done' : 'none', passed: report ? report.report.passed : null, fail: report?.report.summary.fail ?? 0, warn: report?.report.summary.warn ?? 0, unchecked: report?.report.summary.unchecked ?? 0, ranAt: report?.ranAt ?? null},
        cover,
      };
    });
  }

  view(episodeId: string, requested: number | null = null): ReviewView {
    const doc = getEpisode(this.p, episodeId);
    const info = getEpisodeInfo(this.p, episodeId);
    const videos = this.videoRows(episodeId);
    const selected = (requested !== null ? videos.find((v) => v.renderArtifactId === requested) : undefined) ?? videos.find((v) => v.kind === 'final' && v.isCurrent) ?? videos.find((v) => v.kind === 'draft' && v.isCurrent) ?? videos[0] ?? null;
    const rounds = new Map(listRounds(this.p, episodeId).map((r) => [r.number, r]));
    const roundWords = (r: Round | undefined) => (r ? `round ${r.number}, ${r.kind === 'final' ? 'final (mastered)' : 'draft'} video` : null);
    const notes: NoteView[] = doc.reviewNotes.map((n: Note) => ({
      note: n, assessment: assessNote(n, doc), against: n.round !== undefined ? roundWords(rounds.get(n.round)) : n.render ? `${n.render.kind} video (written before rounds)` : null,
      onThisVideo: !!selected && n.render?.id === String(selected.renderArtifactId),
    }));
    const report = selected ? checkReportFor(this.p, episodeId, selected.renderArtifactId) : null;
    const round = selected ? roundForRender(this.p, selected.renderArtifactId) : null;
    const dur = selected?.durationSec ?? null;
    const curFinal = videos.find((v) => v.kind === 'final' && v.isCurrent) ?? null;
    const ready = readiness(this.p, episodeId, curFinal?.durationSec ?? null);
    const approval = this.approvalView(episodeId);
    const status = approvalStatus(this.p, episodeId);
    const confirmed = new Set(all<{segment_id: string; diff_hash: string}>(this.p.db.prepare('SELECT segment_id, diff_hash FROM caption_confirmations WHERE episode_id=?'), episodeId).map((r) => `${r.segment_id}:${r.diff_hash}`));
    const jobs = this.jobs.list(episodeId, 30);
    const exportsView: ExportView = {
      canExport: status.state === 'valid', why: status.state === 'valid' ? null : status.state === 'none' ? 'Nothing is approved yet.' : `Approval is void: ${status.changed.join(', ')} changed since it was recorded.`,
      packages: exportsOf(this.p, episodeId).map((e) => ({id: e.id, dir: e.dir, fileSha256: e.fileSha256, exportedAt: e.exportedAt, files: e.files})),
    };
    return {
      episodeId, title: doc.title, seq: info.seq, videos, selected, notes, report: report?.report ?? null,
      checksJob: jobs.find((j) => j.kind === 'check.suite' && ['queued', 'preparing', 'running', 'cancelling'].includes(j.state) && selected && j.subject === String(selected.renderArtifactId)) ?? null,
      coverage: round && dur !== null ? coverageOf(this.p, round.id, dur) : null,
      signoffs: round ? getSignoffs(this.p, round.id) : getSignoffs(this.p, -1),
      readiness: ready, approval, exports: exportsView, jobs, busy: !!this.jobs.activeWork(episodeId),
      segments: doc.narration.segments.map((s) => ({id: s.id, text: s.text})),
      segmentTimes: selected ? this.segmentTimes(selected.renderArtifactId) : [],
      captionDiffs: (report?.report.captionDiffs ?? []).map((d) => ({...d, confirmed: confirmed.has(`${d.segment}:${d.hash}`)})),
      exportsDir: join(this.o.exportsRoot, episodeId),
    };
  }

  private approvalView(episodeId: string): ApprovalView {
    const s = approvalStatus(this.p, episodeId);
    if (s.state === 'none') return {state: 'none', changed: [], approvedAt: null, fileSha256: null, revision: null, rested: null};
    const a = get<{file_sha256: string; approved_at: number; revision_number: number}>(this.p.db.prepare('SELECT file_sha256, approved_at, revision_number FROM approvals WHERE id=?'), s.approvalId);
    const rr = get<{round_id: number; coverage_json: string; detail_json: string}>(this.p.db.prepare('SELECT round_id, coverage_json, detail_json FROM approval_review WHERE approval_id=?'), s.approvalId);
    let rested: ApprovalView['rested'] = null;
    if (rr) {
      const d = JSON.parse(rr.detail_json) as {signoffTimes: Record<string, number | null>; checkVersion: string};
      rested = {roundNumber: getRound(this.p, rr.round_id).number, checkVersion: d.checkVersion, coverageComplete: (JSON.parse(rr.coverage_json) as {complete: boolean}).complete, signoffTimes: d.signoffTimes};
    }
    return {state: s.state, changed: s.changed, approvedAt: a?.approved_at ?? null, fileSha256: a?.file_sha256 ?? null, revision: a?.revision_number ?? null, rested};
  }

  // ---- what a person does ---------------------------------------------------------------------------------------------------------
  openRound(episodeId: string, renderArtifactId: number): Round { return openRound(this.p, episodeId, renderArtifactId); }

  runChecks(episodeId: string, renderArtifactId: number): number { return this.jobs.startChecks(episodeId, renderArtifactId); }

  /** Draw the cover of one video: its branded opening, without captions. */
  makeCover(episodeId: string, renderArtifactId: number): number {
    const cv = coverFor(this.p, episodeId, renderArtifactId);
    if (!cv.hook) throw new ReviewError('refused', 'This video has no branded opening (its first scene has no opening hook), so there is no cover to make from it.');
    return this.jobs.startCover(episodeId, renderArtifactId);
  }

  private roundOf(episodeId: string, roundId: number): {round: Round; duration: number} {
    const round = getRound(this.p, roundId);
    if (round.episodeId !== episodeId) throw new ReviewError('refused', 'That round belongs to another episode.');
    const duration = this.durationOf(round.renderArtifactId);
    if (duration === null) throw new ReviewError('refused', 'The length of this video is not known, so playback cannot be recorded against it.');
    return {round, duration};
  }

  playback(episodeId: string, roundId: number, r: PlaybackReport): void {
    const {duration} = this.roundOf(episodeId, roundId);
    recordPlayback(this.p, roundId, duration, r);
  }

  signoff(episodeId: string, roundId: number, item: string, ticked: boolean) {
    this.roundOf(episodeId, roundId);
    return setSignoff(this.p, roundId, item, ticked);
  }

  addNote(episodeId: string, n: Parameters<typeof addReviewNote>[2], expectSeq?: number) { return addReviewNote(this.p, episodeId, n, expectSeq); }
  changeNote(episodeId: string, noteId: string, c: NoteChange, expectSeq?: number) { return changeNote(this.p, episodeId, noteId, c, expectSeq); }

  /** The author confirms (or takes back) that one caption and speech difference, exactly as listed for this video, is intended. */
  confirmDiff(episodeId: string, renderArtifactId: number, segment: string, hash: string, confirmed: boolean): void {
    const report = checkReportFor(this.p, episodeId, renderArtifactId);
    if (!report?.report.captionDiffs.some((d) => d.segment === segment && d.hash === hash)) throw new ReviewError('refused', 'That difference is not in this video\'s check report (the wording may have changed). Run the checks again.');
    if (confirmed) confirmCaptionDiff(this.p, episodeId, segment, hash); else unconfirmCaptionDiff(this.p, episodeId, segment, hash);
  }

  /** The approval is recorded from the round's own records. The request carries no sign-offs: it cannot tick anything. */
  approve(episodeId: string, roundId: number): number {
    const {duration} = this.roundOf(episodeId, roundId);
    return approveReviewed(this.p, episodeId, roundId, duration);
  }

  export(episodeId: string): ExportResult { return exportApproved(this.p, episodeId, {exportsRoot: this.o.exportsRoot, libraryRoot: this.o.libraryRoot}); }

  /** The video a round is about must be the one the person is playing: the media address is built from it. */
  currentFinalId(episodeId: string): number | null { return currentRows(this.p, episodeId).find((r) => r.kind === 'render' && r.subject === 'final')?.artifact_id ?? null; }
}
