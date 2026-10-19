// What the Voice screen shows and sends. Types and a few pure helpers shared by the server (which builds the view) and the page.
import type {EngineView, JobView} from '../jobs.ts';
import type {Estimate} from './costs.ts';

export type TakeRow = {
  artifactId: number;
  /** 1-based position among the takes ever made for a block of this name, oldest first. */
  number: number;
  seed: number | null;
  createdAt: number;
  durationSec: number | null;
  selected: boolean;
  /** Made from exactly the block's current wording, voice and settings: it can be selected. */
  compatible: boolean;
  /** Why an incompatible take cannot be used for this block as it is now. */
  why: string | null;
  cacheHit: boolean;
  /** Imported with the baseline, not generated here. */
  imported: string | null;
  genSec: number | null;
  /** The file, playable in the page. */
  url: string;
  revision: number | null;
};

export type BlockRow = {
  id: string;
  segments: {id: string; text: string; speech: string | null; pauseAfter: number | null}[];
  words: number;
  gapAfterSec: number | null;
  status: 'fresh' | 'stale' | 'none' | 'missing';
  reasons: string[];
  selectedTakeId: number | null;
  /** Duration of the selected take, whether or not it still fits the text. */
  durationSec: number | null;
  takes: TakeRow[];
  /** A saved take made for exactly this wording that is not the selected one: it can be used without generating. */
  reusableTakeId: number | null;
  /** The job working on this block now, else the newest one for it. */
  job: JobView | null;
  /** Generation-time estimate for this block, not counting the model load. */
  estimate: Estimate;
};

export type SampleRow = {
  available: boolean;
  /** Why it cannot be made, in a sentence. */
  reason: string | null;
  artifactId: number | null;
  url: string | null;
  fresh: boolean;
  builtAt: number | null;
  durationSec: number | null;
  job: JobView | null;
};

export type VoiceView = {
  episodeId: string;
  title: string;
  seq: number;
  docHash: string;
  voice: {engine: string; profile: string; model: string | null; referenceShort: string | null};
  blocks: BlockRow[];
  engine: EngineView;
  /** Newest narration jobs of this episode, for the progress list. */
  jobs: JobView[];
  /** Work is queued or running for this episode: starting more waits until it finishes or is cancelled. */
  busy: boolean;
  /** Reasons narration cannot be generated now. Empty means it can. */
  blockers: string[];
  downstream: {timing: string; mixFinal: string; renderFinal: string; sentence: string};
  sample: SampleRow;
  /** Estimate of the model load that a start would pay, when the engine is not already holding the model. */
  loadEstimate: {sec: number | null; note: string} | null;
  totalEstimate: {needed: number; minSec: number; maxSec: number; unmeasured: number} | null;
  sound: {events: number; own: boolean};
};

export type GenerateReply = {
  queued: {block: string; jobId: number; seed: number}[];
  reused: {block: string; takeNumber: number}[];
  skipped: {block: string; why: string}[];
  repeated: boolean;
};

export type BlockPreview = {
  lines: string[];
  before: {id: string; segments: string[]}[];
  after: {id: string; segments: string[]}[];
  needsGeneration: string[];
  reusable: {block: string; takeNumber: number}[];
  warnings: string[];
};

export const rangeLabel = (ids: string[]): string => (ids.length > 2 ? `${ids[0]} to ${ids[ids.length - 1]}` : ids.join(' and '));
