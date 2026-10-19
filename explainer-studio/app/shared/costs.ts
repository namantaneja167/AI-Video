// Rebuild costs, honestly: only from durations measured in earlier real runs. No run, no number.
import type {Status} from '../../core/artifacts.ts';
import type {EpisodeV2} from '../../src/schema2.ts';

export type MeasuredRun = {kind: string; subject: string; seconds: number; source: string; when: string; note?: string; /** Takes made by this workspace: the words spoken, seconds spent loading the model (0 when it was already loaded) and seconds generating. */ words?: number; loadSec?: number; genSec?: number; audioSec?: number};
export type MeasuredRuns = {version: 1; runs: MeasuredRun[]};

export type Estimate = {measured: false} | {measured: true; minSec: number; maxSec: number; runs: number; sources: string[]; /** How far to trust it, in words, when the basis is thin. */ note?: string};

export function estimateFor(kind: string, subject: string, m: MeasuredRuns | null): Estimate {
  const hits = (m?.runs ?? []).filter((r) => r.kind === kind && r.subject === subject);
  if (!hits.length) return {measured: false};
  const secs = hits.map((r) => r.seconds);
  return {measured: true, minSec: Math.min(...secs), maxSec: Math.max(...secs), runs: hits.length, sources: [...new Set(hits.map((r) => r.source))]};
}

const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };

/**
 * Time to narrate a block of this many words, from real takes this workspace made: generation seconds per word (a range from the
 * slowest and fastest earlier take), plus the model load when the engine is not already loaded. With one earlier take the range
 * is a single number and says so; with none it says "Not measured". (Earlier runs recorded only by block name are not used: a block of
 * the same name in another episode says nothing about this one.)
 */
export function takeEstimate(words: number, m: MeasuredRuns | null, o: {engineLoaded: boolean}): Estimate {
  const real = (m?.runs ?? []).filter((r) => r.kind === 'take' && r.words && r.words > 0 && r.genSec !== undefined);
  if (!real.length) return {measured: false};
  const rates = real.map((r) => r.genSec! / r.words!);
  const loads = real.map((r) => r.loadSec ?? 0).filter((x) => x > 0);
  // what a take costs besides generating and loading: the snapshot, copying the reference, saving the file (per block, whatever its length)
  const overhead = median(real.map((r) => Math.max(0, r.seconds - (r.genSec ?? 0) - (r.loadSec ?? 0))));
  const lo = words * Math.min(...rates) + overhead;
  const hi = words * Math.max(...rates) + overhead;
  const load = o.engineLoaded ? 0 : loads.length ? median(loads) : 0;
  const notes = [
    real.length === 1 ? 'Based on one earlier take, so it could be off by more than 30%.' : `Based on ${real.length} earlier takes.`,
    overhead >= 0.5 ? `Includes about ${overhead.toFixed(1)} s of fixed time per block.` : '',
    o.engineLoaded ? '' : loads.length ? `Includes about ${Math.round(load)} s to load the voice model.` : 'Does not include loading the voice model, which has not been measured.',
  ].filter(Boolean);
  return {measured: true, minSec: lo + load, maxSec: hi + load, runs: real.length, sources: [...new Set(real.map((r) => r.source))], note: notes.join(' ')};
}

export const fmtSec = (s: number): string => (s < 90 ? `${Math.round(s)} s` : `${Math.floor(s / 60)} min ${Math.round(s % 60)} s`);
export const fmtEstimate = (e: Estimate): string => {
  if (!e.measured) return 'Not measured';
  const lo = Math.round(e.minSec);
  const hi = Math.round(e.maxSec);
  return lo === hi ? `about ${fmtSec(lo)} (estimate)` : `about ${fmtSec(lo)} to ${fmtSec(hi)} (estimate)`;
};

export type StaleItem = {key: string; label: string; state: 'stale' | 'missing'; why: string[]; estimate: Estimate};
export type NotBuilt = {key: string; label: string};

const label = (key: string, doc: EpisodeV2): string => {
  if (key === 'timing') return 'Timing and captions';
  const [kind, sub] = key.split(':');
  if (kind === 'take') {
    const b = doc.narration.blocks.find((x) => x.id === sub);
    return `Narration, block ${sub}${b ? ` (${b.segments.join(', ')})` : ''}`;
  }
  if (kind === 'mix') return sub === 'final' ? 'Final audio mix' : 'Draft audio mix';
  return sub === 'final' ? 'Final video' : 'Draft video';
};

/** Outputs that exist but are out of date (with cost), and outputs that were never built. */
export function staleItems(status: Status, doc: EpisodeV2, m: MeasuredRuns | null): {stale: StaleItem[]; notBuilt: NotBuilt[]} {
  const entries: [string, {status: string; reasons: string[]}][] = [
    ...Object.entries(status.takes).map(([id, e]) => [`take:${id}`, e] as [string, typeof e]),
    ['timing', status.timing],
    ['mix:draft', status.mix.draft], ['mix:final', status.mix.final], ['render:draft', status.render.draft], ['render:final', status.render.final],
  ];
  const stale: StaleItem[] = [];
  const notBuilt: NotBuilt[] = [];
  for (const [key, e] of entries) {
    if (e.status === 'fresh') continue;
    if (e.status === 'none') { notBuilt.push({key, label: label(key, doc)}); continue; }
    const [kind, sub] = key === 'timing' ? ['timing', 'timeline'] : key.split(':');
    stale.push({key, label: label(key, doc), state: e.status === 'missing' ? 'missing' : 'stale', why: e.reasons.map(friendlyReason), estimate: estimateFor(kind === 'take' ? 'take' : kind === 'mix' ? 'mix' : kind === 'render' ? 'render' : 'timing', sub, m)});
  }
  return {stale, notBuilt};
}

function friendlyReason(r: string): string {
  if (r === 'inputs changed since it was built') return 'Something it depends on changed after it was built';
  if (r === 'output file is missing') return 'Its file is missing';
  const up = /^upstream (.+) is not fresh$/.exec(r);
  return up ? `Waits for: ${up[1].replace(/^take /, 'narration ').replace('timing', 'timing and captions').replace(/^mix /, 'audio mix ')}` : r;
}

export function totalEstimate(items: StaleItem[]): {minSec: number; maxSec: number; known: number; unknown: number} {
  let minSec = 0, maxSec = 0, known = 0, unknown = 0;
  for (const i of items) {
    if (i.estimate.measured) { minSec += i.estimate.minSec; maxSec += i.estimate.maxSec; known++; } else unknown++;
  }
  return {minSec, maxSec, known, unknown};
}

/** The final video was made from other render sources or tools than the ones in use now: it is out of date even though no input of its own changed. */
export function withRenderDrift(items: {stale: StaleItem[]; notBuilt: NotBuilt[]}, status: Status, drift: string[], m: MeasuredRuns | null): {stale: StaleItem[]; notBuilt: NotBuilt[]} {
  if (!drift.length || status.render.final.status === 'none' || items.stale.some((s) => s.key === 'render:final')) return items;
  const shown = drift.slice(0, 3).join('; ') + (drift.length > 3 ? `; and ${drift.length - 3} more` : '');
  return {...items, stale: [...items.stale, {key: 'render:final', label: 'Final video', state: 'stale', why: [`The app's render sources changed since it was built (${shown})`], estimate: estimateFor('render', 'final', m)}]};
}
