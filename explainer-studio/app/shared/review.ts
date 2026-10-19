// What the Review screen shows: everything comes from one reading of the server (the saved episode, the dependency hashes, the job table and
// the review records), so the page cannot say two different things. Types only; no logic that needs the server.
import type {Note} from '../../src/schema2.ts';
import type {CheckReport} from '../../core/checks.ts';
import type {Coverage, NoteAssessment, Readiness, SignoffRecord} from '../../core/review.ts';
import type {JobView} from '../jobs.ts';

export type VideoRow = {
  renderArtifactId: number;
  kind: 'draft' | 'final';
  /** "Draft" or "Final (mastered)": never confusable with each other on screen. */
  label: string;
  buildId: string | null;
  revision: number | null;
  builtAt: number;
  fileSha256: string;
  bytes: number;
  durationSec: number | null;
  url: string;
  /** The newest video of its kind. */
  isCurrent: boolean;
  /** Made from exactly the current inputs. */
  fresh: boolean;
  imported: string | null;
  round: {id: number; number: number; closedAt: number | null} | null;
  checks: {state: 'none' | 'running' | 'done'; passed: boolean | null; fail: number; warn: number; unchecked: number; ranAt: number | null};
};

export type NoteView = {
  note: Note;
  assessment: NoteAssessment;
  /** The round's video, in words, so a note says which video it was written against. */
  against: string | null;
  /** Written against the video that is open now. */
  onThisVideo: boolean;
};

export type ApprovalView = {
  state: 'none' | 'valid' | 'void';
  changed: string[];
  approvedAt: number | null;
  fileSha256: string | null;
  revision: number | null;
  /** What it rested on (from the record made at approval). */
  rested: {roundNumber: number; checkVersion: string; coverageComplete: boolean; signoffTimes: Record<string, number | null>} | null;
};

export type ExportView = {
  /** An approved, valid final video exists, so it can be exported. */
  canExport: boolean;
  why: string | null;
  packages: {id: number; dir: string; fileSha256: string; exportedAt: number; files: {name: string; role: string; bytes: number; sha256: string}[]}[];
};

export type ReviewView = {
  episodeId: string;
  title: string;
  seq: number;
  videos: VideoRow[];
  selected: VideoRow | null;
  notes: NoteView[];
  report: CheckReport | null;
  checksJob: JobView | null;
  coverage: Coverage | null;
  signoffs: SignoffRecord[];
  readiness: Readiness;
  approval: ApprovalView;
  exports: ExportView;
  jobs: JobView[];
  /** A heavy job (a build or a check) is queued or running for this episode. */
  busy: boolean;
  segments: {id: string; text: string}[];
  /** When each segment is spoken in the selected video (from the timing it was made from), to anchor a note to the segment at the playhead. */
  segmentTimes: {id: string; start: number; end: number}[];
  /** Caption/speech differences the author can confirm, with whether each was confirmed. */
  captionDiffs: CheckReport['captionDiffs'];
  /** Where packages are written, shown to the author only. */
  exportsDir: string;
};

/** Failures still worth showing: a failed job is history once a later job for the same work has succeeded or is running. */
export function unresolvedFailures<T extends {id: number; kind: string; subject: string; state: string}>(jobs: T[]): T[] {
  const live = ['succeeded', 'queued', 'preparing', 'running', 'cancelling'];
  return jobs.filter((j) => j.state === 'failed' && !jobs.some((k) => k.id > j.id && k.kind === j.kind && k.subject === j.subject && live.includes(k.state)));
}
