// Types shared by the server and the browser for a rebuild plan.
import type {Estimate} from './costs.ts';

export type PlanStep = {
  key: string;
  stage: 'narration' | 'timing' | 'mix' | 'render';
  subject?: string;
  label: string;
  /** run: work will be done. reuse: a saved artifact for exactly these inputs is selected, no new work. current: already up to date. */
  action: 'run' | 'reuse' | 'current';
  why: string[];
  estimate: Estimate | null;
};
export type Blocker = {message: string; /** Segments the author can open to fix it. */ segments?: string[]};
export type PlanTotal = {minSec: number; maxSec: number; known: number; unknown: number};
export type ActiveWork = {rebuildId: string | null; jobs: number; description: string};

export type Plan = {
  episodeId: string;
  /** The saved version of the episode this plan was made for. */
  seq: number;
  docHash: string;
  /** draft: an unmastered video for review (never approvable); final: the mastered video that is reviewed, approved and exported. */
  mode: 'draft' | 'final';
  steps: PlanStep[];
  blockers: Blocker[];
  notes: string[];
  total: PlanTotal;
  nothingToDo: boolean;
  active: ActiveWork | null;
};
