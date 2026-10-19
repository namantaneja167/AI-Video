// The Voice stage: which blocks of narration have which takes, generating and re-rolling them on the existing job runner, auditioning and
// selecting takes, splitting and merging blocks, and a listening sample of the selected takes joined as they would be heard. This adds no
// scheduler and no worker: it decides WHAT to queue from the dependency hashes, and reads what the runner and the model host recorded.
//
// Rules it keeps: a take is never overwritten (a re-roll is a new artifact with a new seed); only a take made for exactly the block's
// current wording and voice can be selected; nothing is queued unless the page's saved version is still the current one; every job is
// created from a snapshot taken at that moment, so it runs on the revision and inputs recorded then.
import {existsSync, readFileSync} from 'node:fs';
import {expectedNow, getSnapshot, selectTake, statusReport, type Status} from '../core/artifacts.ts';
import {blobPath} from '../core/blobs.ts';
import {all, get} from '../core/db.ts';
import {computeExpected} from '../core/deps.ts';
import {ConflictError, ValidationError, getEpisode, getEpisodeInfo, listEpisodes, saveEpisode} from '../core/episodes.ts';
import {currentRows, getComponentHashes, getComponentValues, upstreamBlobs} from '../core/state.ts';
import {unsupportedInputs} from '../core/support.ts';
import {wavDuration} from '../core/timeline.ts';
import {mixScriptFingerprint} from '../core/toolchain.ts';
import {ownSoundSettings} from '../core/soundSettings.ts';
import type {EpisodeV2} from '../src/schema2.ts';
import type {EngineView, JobService} from './jobs.ts';
import {narrationBlockers} from './plan.ts';
import {editBlocks, spokenWords, type BlockOp} from './shared/blocks.ts';
import {fmtSec, takeEstimate, type Estimate, type MeasuredRuns} from './shared/costs.ts';
import {rangeLabel, type BlockPreview, type BlockRow, type GenerateReply, type SampleRow, type TakeRow, type VoiceView} from './shared/voice.ts';

export class VoiceError extends Error {
  code: 'busy' | 'changed' | 'blocked' | 'refused' | 'nothing' | 'unknown';
  detail: Record<string, unknown>;
  constructor(code: VoiceError['code'], message: string, detail: Record<string, unknown> = {}) {
    super(message);
    this.code = code;
    this.detail = detail;
  }
}

type TakeArtifact = {id: number; subject: string; inputs_hash: string; blob_hash: string; meta_json: string; snapshot_id: string | null; revision_number: number | null; created_at: number};
type TakeMeta = {seed?: number; durationSec?: number; genSec?: number; cacheHit?: boolean; imported?: {note?: string}};

const ACTIVE = ['queued', 'preparing', 'running', 'cancelling'];
const spokenOf = (s: EpisodeV2['narration']['segments'][number]) => s.speech ?? s.text;
const ids = (xs: string[]) => xs.join(', ');

export class VoiceService {
  private jobs: JobService;
  private requests = new Map<string, unknown>();

  constructor(jobs: JobService) { this.jobs = jobs; }
  private get p() { return this.jobs.p; }

  private docOfSnapshot(snapshotId: string | null): EpisodeV2 | null {
    if (!snapshotId) return null;
    try { return JSON.parse(readFileSync(blobPath(this.p, getSnapshot(this.p, snapshotId).docBlob), 'utf8')) as EpisodeV2; } catch { return null; }
  }

  /** The takes ever made for blocks of this episode, one row per distinct recording (a cache hit points at the recording it reused). */
  private takeArtifacts(episodeId: string): TakeArtifact[] {
    return all<TakeArtifact>(this.p.db.prepare("SELECT id, subject, inputs_hash, blob_hash, meta_json, snapshot_id, revision_number, created_at FROM artifacts WHERE episode_id=? AND kind='take' ORDER BY id"), episodeId)
      .filter((a) => existsSync(blobPath(this.p, a.blob_hash)));
  }

  private whyNot(a: TakeArtifact, doc: EpisodeV2, blockId: string): string {
    const old = this.docOfSnapshot(a.snapshot_id);
    if (!old) return 'Made from other wording or settings than this block has now.';
    const oldBlock = old.narration.blocks.find((b) => b.id === blockId);
    const block = doc.narration.blocks.find((b) => b.id === blockId)!;
    if (!oldBlock) return 'Made for a block of this name that was grouped differently.';
    if (JSON.stringify(oldBlock.segments) !== JSON.stringify(block.segments)) return `Made when this block held ${ids(oldBlock.segments)}; it holds ${ids(block.segments)} now.`;
    const before = new Map(old.narration.segments.map((s) => [s.id, spokenOf(s)]));
    const changed = block.segments.filter((id) => before.get(id) !== spokenOf(doc.narration.segments.find((s) => s.id === id)!));
    if (changed.length) return `Made from earlier wording of ${ids(changed)}.`;
    if (JSON.stringify(old.voice) !== JSON.stringify(doc.voice)) return 'Made with a different voice.';
    return 'Made with other voice settings than are recorded now.';
  }

  private durationOf(a: TakeArtifact): number | null {
    const m = JSON.parse(a.meta_json) as TakeMeta;
    if (typeof m.durationSec === 'number') return m.durationSec;
    try { return wavDuration(blobPath(this.p, a.blob_hash)).seconds; } catch { return null; }
  }

  // ---- the view ----------------------------------------------------------------------------------------------------------
  view(episodeId: string): VoiceView {
    if (!listEpisodes(this.p).includes(episodeId)) throw new VoiceError('unknown', `No episode "${episodeId}" in this workspace.`);
    const {doc, expected} = expectedNow(this.p, episodeId);
    const info = getEpisodeInfo(this.p, episodeId);
    const status = statusReport(this.p, episodeId);
    const values = getComponentValues(this.p, episodeId);
    const current = new Map(currentRows(this.p, episodeId).filter((r) => r.kind === 'take').map((r) => [r.subject, r]));
    const artifacts = this.takeArtifacts(episodeId);
    const measured = this.jobs.measuredRuns();
    const engine = this.jobs.engine();
    const jobsAll = this.jobs.list(episodeId, 80, engine).filter((j) => j.kind === 'tts.block');
    const seg = new Map(doc.narration.segments.map((s) => [s.id, s]));

    const blocks: BlockRow[] = doc.narration.blocks.map((b) => {
      const mine = artifacts.filter((a) => a.subject === b.id);
      const byBlob = new Map<string, TakeArtifact[]>();
      for (const a of mine) byBlob.set(a.blob_hash, [...(byBlob.get(a.blob_hash) ?? []), a]);
      const sel = current.get(b.id);
      const takes: TakeRow[] = [...byBlob.values()].map((group, i) => {
        const first = group[0];
        const own = group.find((g) => !(JSON.parse(g.meta_json) as TakeMeta).cacheHit) ?? first;
        const meta = JSON.parse(own.meta_json) as TakeMeta;
        const compatible = group.some((g) => g.inputs_hash === expected.take[b.id]);
        return {
          artifactId: own.id, number: i + 1, seed: typeof meta.seed === 'number' ? meta.seed : null, createdAt: own.created_at, durationSec: this.durationOf(own),
          selected: !!sel && group.some((g) => g.id === sel.artifact_id), compatible, why: compatible ? null : this.whyNot(own, doc, b.id), cacheHit: false,
          imported: meta.imported ? (meta.imported.note ?? 'imported') : null, genSec: typeof meta.genSec === 'number' ? meta.genSec : null,
          url: `/media/take/${episodeId}/${own.id}.wav`, revision: own.revision_number,
        };
      });
      const selected = takes.find((t) => t.selected) ?? null;
      const reusable = takes.filter((t) => t.compatible && !t.selected).at(-1) ?? null;
      const words = spokenWords(doc, b.segments);
      const st = status.takes[b.id];
      const mineJobs = jobsAll.filter((j) => j.subject === b.id);
      const job = mineJobs.find((j) => ACTIVE.includes(j.state)) ?? mineJobs[0] ?? null;
      return {
        id: b.id, segments: b.segments.map((id) => ({id, text: seg.get(id)!.text, speech: seg.get(id)!.speech ?? null, pauseAfter: seg.get(id)!.pauseAfter ?? null})), words, gapAfterSec: b.gapAfterSec ?? null,
        status: st.status, reasons: st.reasons, selectedTakeId: selected?.artifactId ?? null, durationSec: selected?.durationSec ?? null, takes,
        reusableTakeId: st.status === 'fresh' && !reusable ? null : reusable?.artifactId ?? null, job,
        estimate: takeEstimate(words, measured, {engineLoaded: true}),
      };
    });

    const needed = blocks.filter((b) => b.status !== 'fresh' && b.reusableTakeId === null);
    const estimates = needed.map((b) => b.estimate);
    const loaded = engine.loaded === 'tts' && engine.worker === 'running';
    const loads = measured.runs.filter((r) => r.kind === 'take' && (r.loadSec ?? 0) > 0).map((r) => r.loadSec!);
    const loadSec = loads.length ? [...loads].sort((a, b) => a - b)[Math.floor((loads.length - 1) / 2)] : null;
    const blockers = [...narrationBlockers(this.p, doc, values, this.jobs.tools.audioWorker).map((b) => b.message), ...unsupportedInputs(doc, values).filter((m) => /pause|Manual timing/i.test(m))];
    const busy = !!this.jobs.activeWork(episodeId);
    const sound = ownSoundSettings(this.p, episodeId);

    return {
      episodeId, title: doc.title, seq: info.seq, docHash: info.docHash,
      voice: {engine: doc.voice.engine, profile: doc.voice.engine === 'qwen3-tts' ? doc.voice.profile : doc.voice.voice, model: (values.voiceRuntime as {model?: string; revision?: string} | undefined)?.model ? `${(values.voiceRuntime as {model: string}).model}` : null, referenceShort: (values.voiceRuntime as {referenceSha256?: string} | undefined)?.referenceSha256?.slice(0, 12) ?? null},
      blocks, engine, jobs: jobsAll.slice(0, 12), busy, blockers,
      downstream: this.downstream(status),
      sample: this.sampleRow(episodeId, doc, status, values, engine),
      loadEstimate: loaded ? null : {sec: loadSec, note: loadSec === null ? 'Loading the voice model has not been measured in this workspace yet.' : `Loading took about ${Math.round(loadSec)} s in earlier runs here.`},
      totalEstimate: needed.length ? {needed: needed.length, minSec: estimates.reduce((s, e) => s + (e.measured ? e.minSec : 0), 0), maxSec: estimates.reduce((s, e) => s + (e.measured ? e.maxSec : 0), 0), unmeasured: estimates.filter((e) => !e.measured).length} : null,
      sound: {events: Array.isArray(values.soundEvents) ? values.soundEvents.length : 0, own: sound.soundEvents},
    };
  }

  private downstream(s: Status): VoiceView['downstream'] {
    const name = (e: {status: string}) => (e.status === 'fresh' ? 'up to date' : e.status === 'none' ? 'not built' : e.status === 'missing' ? 'file missing' : 'out of date');
    const timing = name(s.timing), mixFinal = name(s.mix.final), renderFinal = name(s.render.final);
    const stale = [s.timing.status === 'stale' && 'timing', s.mix.final.status === 'stale' && 'the final mix', s.render.final.status === 'stale' && 'the final video'].filter(Boolean) as string[];
    return {timing, mixFinal, renderFinal, sentence: stale.length ? `${stale.join(', ')} ${stale.length === 1 ? 'was' : 'were'} built from other takes or wording, so ${stale.length === 1 ? 'it is' : 'they are'} out of date. They are rebuilt by Rebuild, not by this screen.` : 'Timing, the mix and the video are not affected by anything on this screen until a take changes.'};
  }

  private sampleRow(episodeId: string, doc: EpisodeV2, status: Status, values: Record<string, unknown>, engine?: EngineView): SampleRow {
    const row = currentRows(this.p, episodeId).find((r) => r.kind === 'mix' && r.subject === 'draft');
    const job = this.jobs.list(episodeId, 40, engine).find((j) => j.kind === 'mix.draft') ?? null;
    let reason: string | null = null;
    if (Array.isArray(values.soundEvents) && values.soundEvents.length) reason = 'This episode has sound accents, which are placed on its timing; its mix is built by Rebuild, and a voice-only sample is not offered.';
    else if (values.mixParams === undefined || (values.mixParams as {mixScriptSha256?: string}).mixScriptSha256 !== mixScriptFingerprint(this.jobs.tools.mix)) reason = 'The mix settings are not recorded for the mix script in use, so a sample cannot be mixed.';
    else if (doc.narration.blocks.some((b) => status.takes[b.id].status !== 'fresh')) reason = 'Every block needs a selected take for its current wording first.';
    const fresh = !!row && status.mix.draft.status === 'fresh';
    const url = row && existsSync(blobPath(this.p, row.blob_hash)) ? `/media/sample/${episodeId}/${row.artifact_id}.wav` : null;
    let durationSec: number | null = null;
    if (row) { try { durationSec = wavDuration(blobPath(this.p, row.blob_hash)).seconds; } catch { durationSec = null; } }
    const builtAt = row ? get<{created_at: number}>(this.p.db.prepare('SELECT created_at FROM artifacts WHERE id=?'), row.artifact_id)?.created_at ?? null : null;
    return {available: reason === null, reason, artifactId: row?.artifact_id ?? null, url, fresh, builtAt, durationSec, job};
  }

  // ---- generating and re-rolling -----------------------------------------------------------------------------------------------
  /**
   * Queue narration for blocks. Without `reroll`: each requested block that has no valid selected take either reuses a saved take
   * made for exactly its wording (selected, nothing generated) or is generated with the default seed. With `reroll`: each requested block
   * gets a NEW take with a seed not yet used for this wording; the take it already has stays selected until the author picks the new one.
   * Everything is refused, and nothing queued, unless the saved version the page saw is still the current one.
   */
  generate(episodeId: string, req: {seq: number; requestId: string; blocks?: string[]; reroll?: boolean}): GenerateReply {
    const known = this.requests.get(req.requestId) as GenerateReply | undefined;
    if (known) return {...known, repeated: true};
    if (!listEpisodes(this.p).includes(episodeId)) throw new VoiceError('unknown', `No episode "${episodeId}" in this workspace.`);
    const info = getEpisodeInfo(this.p, episodeId);
    if (info.seq !== req.seq) throw new VoiceError('changed', 'The episode was saved again after this screen was loaded, so nothing was started. Review the current blocks and try again.', {seq: info.seq});
    const active = this.jobs.activeWork(episodeId);
    if (active) throw new VoiceError('busy', `Work is already in progress for this episode (${active.description}). Wait for it or cancel it first.`, {active});
    const {doc, expected} = expectedNow(this.p, episodeId);
    const values = getComponentValues(this.p, episodeId);
    const blockers = [...narrationBlockers(this.p, doc, values, this.jobs.tools.audioWorker).map((b) => b.message), ...unsupportedInputs(doc, values)];
    if (blockers.length) throw new VoiceError('blocked', 'Narration cannot be generated yet.', {blockers});
    const status = statusReport(this.p, episodeId);
    const want = req.blocks?.length ? req.blocks : req.reroll ? [] : doc.narration.blocks.filter((b) => status.takes[b.id].status !== 'fresh').map((b) => b.id);
    if (req.reroll && !want.length) throw new VoiceError('refused', 'Say which block to re-roll.');
    const unknown = want.filter((id) => !doc.narration.blocks.some((b) => b.id === id));
    if (unknown.length) throw new VoiceError('unknown', `No block ${ids(unknown)} in this episode.`);
    if (!want.length) throw new VoiceError('nothing', 'Every block already has a selected take for its current wording; there is nothing to generate.');

    const artifacts = this.takeArtifacts(episodeId);
    const reply: GenerateReply = {queued: [], reused: [], skipped: [], repeated: false};
    const queuedIds: number[] = [];
    try {
      for (const id of want) {
        const mine = artifacts.filter((a) => a.subject === id && a.inputs_hash === expected.take[id]);
        const seeds = mine.map((a) => (JSON.parse(a.meta_json) as TakeMeta).seed).filter((s): s is number => typeof s === 'number');
        if (!req.reroll) {
          if (status.takes[id].status === 'fresh') { reply.skipped.push({block: id, why: 'it already has a selected take for its current wording'}); continue; }
          const saved = mine.filter((a) => !(JSON.parse(a.meta_json) as TakeMeta).cacheHit).at(-1);
          if (saved) {
            selectTake(this.p, episodeId, id, saved.id);
            reply.reused.push({block: id, takeNumber: this.takeNumber(artifacts, saved)});
            continue;
          }
        }
        const seed = req.reroll && seeds.length ? Math.max(...seeds) + 1 : this.jobs.defaultSeed;
        const jobId = this.jobs.runner.enqueue({episodeId, jobKind: 'tts.block', subject: id, params: {seed, voice: {requestId: req.requestId, reroll: !!req.reroll}}});
        queuedIds.push(jobId);
        reply.queued.push({block: id, jobId, seed});
      }
    } catch (e) {
      for (const j of queuedIds) void this.jobs.runner.cancel(j); // all or nothing: jobs queued by this request are withdrawn (they have not started)
      throw e;
    }
    this.requests.set(req.requestId, {...reply, repeated: false});
    return reply;
  }

  private takeNumber(all: TakeArtifact[], a: TakeArtifact): number {
    const blobs = [...new Set(all.filter((x) => x.subject === a.subject).map((x) => x.blob_hash))];
    return blobs.indexOf(a.blob_hash) + 1;
  }

  // ---- choosing a take -------------------------------------------------------------------------------------------------------------
  /** Select a saved take for a block. Only a take made for the block's current wording and voice; the others stay saved. */
  choose(episodeId: string, req: {block: string; artifactId: number; seq?: number}): {changed: boolean; outOfDate: string[]} {
    if (!listEpisodes(this.p).includes(episodeId)) throw new VoiceError('unknown', `No episode "${episodeId}" in this workspace.`);
    if (req.seq !== undefined && getEpisodeInfo(this.p, episodeId).seq !== req.seq) throw new VoiceError('changed', 'The episode was saved again after this screen was loaded, so the take was not changed. Review the current blocks.');
    const active = this.jobs.activeWork(episodeId);
    if (active) throw new VoiceError('busy', `Work is in progress for this episode (${active.description}); choose a take when it has finished or been cancelled, so no step is left built on a take that was swapped under it.`);
    const {doc, expected} = expectedNow(this.p, episodeId);
    if (!doc.narration.blocks.some((b) => b.id === req.block)) throw new VoiceError('unknown', `No block ${req.block} in this episode.`);
    const a = this.takeArtifacts(episodeId).find((x) => x.id === req.artifactId && x.subject === req.block);
    if (!a) throw new VoiceError('unknown', `Artifact ${req.artifactId} is not a saved take of block ${req.block}.`);
    if (a.inputs_hash !== expected.take[req.block]) throw new VoiceError('refused', `That take cannot be used for block ${req.block} as it is now. ${this.whyNot(a, doc, req.block)} It stays saved.`);
    const cur = currentRows(this.p, episodeId).find((r) => r.kind === 'take' && r.subject === req.block);
    const same = !!cur && get<{blob_hash: string}>(this.p.db.prepare('SELECT blob_hash FROM artifacts WHERE id=?'), cur.artifact_id)?.blob_hash === a.blob_hash;
    if (same) return {changed: false, outOfDate: []};
    selectTake(this.p, episodeId, req.block, a.id);
    const s = statusReport(this.p, episodeId);
    // only outputs that were built and are now behind; something never built is not "out of date"
    const behind = [s.timing.status === 'stale' && 'timing', s.mix.draft.status === 'stale' && 'mix:draft', s.mix.final.status === 'stale' && 'mix:final', s.render.draft.status === 'stale' && 'render:draft', s.render.final.status === 'stale' && 'render:final'].filter(Boolean) as string[];
    return {changed: true, outOfDate: behind};
  }

  // ---- splitting and merging blocks ---------------------------------------------------------------------------------------------------
  /** What a split or a merge would do to the takes and to what is built from them, in sentences. Nothing is written. */
  preview(episodeId: string, op: BlockOp): BlockPreview {
    const {doc, components} = expectedNow(this.p, episodeId);
    const r = editBlocks(doc, op);
    if (!r.ok) throw new VoiceError('refused', r.reason);
    return this.explain(episodeId, doc, r.doc, r.before.map((b) => b.id), r.after.map((b) => b.id), r.warnings, components);
  }

  edit(episodeId: string, req: {seq: number; op: BlockOp}): {seq: number; label: string; preview: BlockPreview} {
    if (!listEpisodes(this.p).includes(episodeId)) throw new VoiceError('unknown', `No episode "${episodeId}" in this workspace.`);
    if (getEpisodeInfo(this.p, episodeId).seq !== req.seq) throw new VoiceError('changed', 'The episode was saved again after this screen was loaded, so the blocks were not changed. Review the current blocks.');
    const active = this.jobs.activeWork(episodeId);
    if (active) throw new VoiceError('busy', `Work is in progress for this episode (${active.description}); change the blocks when it has finished or been cancelled.`);
    const {doc, components} = expectedNow(this.p, episodeId);
    const r = editBlocks(doc, req.op);
    if (!r.ok) throw new VoiceError('refused', r.reason);
    const preview = this.explain(episodeId, doc, r.doc, r.before.map((b) => b.id), r.after.map((b) => b.id), r.warnings, components);
    try {
      const saved = saveEpisode(this.p, episodeId, r.doc, {baseSeq: req.seq, kind: 'blocks-edit', label: r.label});
      return {seq: saved.seq, label: r.label, preview};
    } catch (e) {
      if (e instanceof ConflictError) throw new VoiceError('changed', 'The episode was saved again at the same moment, so the blocks were not changed.');
      if (e instanceof ValidationError) throw new VoiceError('refused', `The new grouping is not valid: ${e.message}`);
      throw e;
    }
  }

  private explain(episodeId: string, before: EpisodeV2, after: EpisodeV2, oldIds: string[], newIds: string[], warnings: string[], components: ReturnType<typeof getComponentHashes>): BlockPreview {
    const up = upstreamBlobs(this.p, episodeId, after);
    const next = computeExpected(after, components, up);
    const artifacts = this.takeArtifacts(episodeId);
    const lines: string[] = [];
    const needsGeneration: string[] = [];
    const reusable: BlockPreview['reusable'] = [];
    const desc = (d: EpisodeV2, bid: string) => rangeLabel(d.narration.blocks.find((b) => b.id === bid)!.segments);
    lines.push(`Before: ${oldIds.map((id) => `${id} (${desc(before, id)})`).join(' and ')}. After: ${newIds.map((id) => `${id} (${desc(after, id)})`).join(' and ')}. The order of the segments does not change.`);
    for (const id of newIds) {
      const hits = artifacts.filter((a) => a.subject === id && a.inputs_hash === next.take[id]);
      if (hits.length) {
        const n = this.takeNumber(artifacts, hits.at(-1)!);
        reusable.push({block: id, takeNumber: n});
        lines.push(`${id}: a saved take (take ${n}) was made for exactly these lines, so it can be used again; nothing needs generating for it.`);
      } else { needsGeneration.push(id); lines.push(`${id}: no saved take was made for exactly these lines, so it needs a new take.`); }
    }
    for (const id of oldIds) {
      const had = artifacts.filter((a) => a.subject === id);
      const still = !newIds.includes(id) ? 'the block no longer exists under that grouping' : 'it was made for the old grouping';
      if (had.length) lines.push(`Earlier takes of ${id} (${new Set(had.map((a) => a.blob_hash)).size}) are kept and stay in the take list: ${still}, so they cannot be selected for the new lines. If you undo this change they become usable again.`);
    }
    const untouched = before.narration.blocks.filter((b) => !oldIds.includes(b.id)).map((b) => b.id);
    if (untouched.length) lines.push(`${ids(untouched)} ${untouched.length === 1 ? 'is' : 'are'} not affected: ${untouched.length === 1 ? 'its take stays' : 'their takes stay'} selected and nothing is regenerated for ${untouched.length === 1 ? 'it' : 'them'}.`);
    lines.push('Timing, the audio mixes and the video were built from the old takes, so they will be out of date until narration is rebuilt. The text, scenes and everything else are unchanged.');
    return {lines, before: oldIds.map((id) => ({id, segments: before.narration.blocks.find((b) => b.id === id)!.segments})), after: newIds.map((id) => ({id, segments: after.narration.blocks.find((b) => b.id === id)!.segments})), needsGeneration, reusable, warnings};
  }

  // ---- the listening sample ---------------------------------------------------------------------------------------------------------------
  /** Join the selected takes as they would be heard (the episode's gaps and pacing, no mastering, no accents) into one file to listen to for consistency and seams. */
  sample(episodeId: string, req: {seq: number; requestId: string}): {jobId: number; repeated: boolean} {
    const known = this.requests.get(req.requestId) as {jobId: number} | undefined;
    if (known) return {jobId: known.jobId, repeated: true};
    if (!listEpisodes(this.p).includes(episodeId)) throw new VoiceError('unknown', `No episode "${episodeId}" in this workspace.`);
    if (getEpisodeInfo(this.p, episodeId).seq !== req.seq) throw new VoiceError('changed', 'The episode was saved again after this screen was loaded, so nothing was started.');
    const active = this.jobs.activeWork(episodeId);
    if (active) throw new VoiceError('busy', `Work is already in progress for this episode (${active.description}).`, {active});
    const {doc} = expectedNow(this.p, episodeId);
    const status = statusReport(this.p, episodeId);
    const row = this.sampleRow(episodeId, doc, status, getComponentValues(this.p, episodeId));
    if (!row.available) throw new VoiceError('blocked', row.reason!);
    if (row.fresh) throw new VoiceError('nothing', 'The listening sample already matches the selected takes.');
    const jobId = this.jobs.runner.enqueue({episodeId, jobKind: 'mix.draft', params: {voice: {sample: true, requestId: req.requestId}}});
    this.requests.set(req.requestId, {jobId});
    return {jobId, repeated: false};
  }

  /** Cancel every narration or sample job this screen started for the episode that has not finished. Only the jobs' own processes are stopped. */
  async cancelAll(episodeId: string): Promise<number> {
    const open = this.jobs.list(episodeId, 80).filter((j) => ACTIVE.includes(j.state) && (j.kind === 'tts.block' || j.kind === 'mix.draft') && j.rebuildId === null);
    for (const j of open.filter((x) => x.state === 'queued')) await this.jobs.cancel(j.id);
    for (const j of open.filter((x) => x.state !== 'queued' && x.state !== 'cancelling')) await this.jobs.cancel(j.id);
    return open.length;
  }

  /** Estimate shown beside a block, as one sentence. */
  static describeEstimate(e: Estimate): string {
    return e.measured ? `about ${fmtSec(e.minSec)}${Math.round(e.maxSec) !== Math.round(e.minSec) ? ` to ${fmtSec(e.maxSec)}` : ''}` : 'not measured';
  }
}

export type {MeasuredRuns};
