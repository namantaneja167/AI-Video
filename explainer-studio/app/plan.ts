// What a rebuild would do, worked out from the project's own dependency hashes before anything is queued. The plan only reads.
import {readFileSync} from 'node:fs';
import {findArtifactByInputs, findTake, getReference, getSnapshot, statusReport, type Status, type StatusEntry} from '../core/artifacts.ts';
import {blobPath} from '../core/blobs.ts';
import {get} from '../core/db.ts';
import {computeExpected, UNSET} from '../core/deps.ts';
import {getEpisode, getEpisodeInfo} from '../core/episodes.ts';
import {hashJson, sha256} from '../core/hash.ts';
import type {Project} from '../core/project.ts';
import {currentRows, getComponentHashes, getComponentValues, upstreamBlobs} from '../core/state.ts';
import {renderSettingsProblems, unsupportedInputs} from '../core/support.ts';
import {fileSha, mixScriptFingerprint, renderSourceProblems, renderToolProblems, timelineLogicValue, type ToolPaths} from '../core/toolchain.ts';
import type {SnapshotManifest} from '../core/artifacts.ts';
import type {EpisodeV2} from '../src/schema2.ts';
import {planningBlockers} from './planning.ts';
import {accentCueProblems, sceneCueSpec} from '../src/library/dynamicCues.ts';
import {resolveCues, type CueSegment} from '../src/library/cues.ts';
import {SCENE_CUES} from '../src/library/sceneSpecs.ts';
import {compareToBuild, spokenOf} from './shared/compare.ts';
import {estimateFor, totalEstimate, type MeasuredRuns} from './shared/costs.ts';
import type {Blocker, Plan, PlanStep} from './shared/plan-types.ts';

export type PlanContext = {tools: ToolPaths; sourceRoot: string; seed: number; measured: MeasuredRuns | null};

const docOfArtifact = (p: Project, artifactId: number | undefined): EpisodeV2 | null => {
  if (artifactId === undefined) return null;
  const r = get<{snapshot_id: string | null}>(p.db.prepare('SELECT snapshot_id FROM artifacts WHERE id=?'), artifactId);
  if (!r?.snapshot_id) return null;
  try { return JSON.parse(readFileSync(blobPath(p, getSnapshot(p, r.snapshot_id).docBlob), 'utf8')) as EpisodeV2; } catch { return null; }
};

const list = (xs: string[]) => xs.join(', ');
const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9]/g, '');

/** A scene times its animation on named words of the spoken text. If an edit removes one, timing would fail after narration was already paid for. */
export function cueTextProblems(doc: EpisodeV2): Blocker[] {
  const out: Blocker[] = [];
  const seg = new Map(doc.narration.segments.map((x) => [x.id, x]));
  for (const scene of doc.scenes) {
    const spec = sceneCueSpec(scene);
    if (!spec) continue;
    for (const [name, ref] of Object.entries(spec)) {
      if ('t' in ref) continue;
      const id = typeof ref.segment === 'number' ? scene.segments[ref.segment] : ref.segment;
      const s = id ? seg.get(id) : undefined;
      if (!s) { out.push({message: `Scene "${scene.id}" needs a segment at position ${String(ref.segment)} for its "${name}" moment, but the scene has too few segments.`}); continue; }
      if (typeof ref.at !== 'object') continue;
      const words = spokenOf(s).split(/\s+/).filter(Boolean);
      const key = ref.at.word;
      const found = typeof key === 'number' ? key < words.length : words.some((w) => norm(w) === norm(key));
      if (!found) out.push({message: `The scene times its "${name}" moment on the word "${key}" in segment ${s.id}, but the spoken text no longer contains it. Put the word back in the spoken text of ${s.id} (or keep it in the shown words and speak it).`, segments: [s.id]});
    }
  }
  return out;
}

function takeWhy(p: Project, doc: EpisodeV2, blockId: string, e: StatusEntry): string[] {
  if (e.status === 'none') return ['No narration has been built for this block yet'];
  if (e.status === 'missing') return ['Its saved audio file is missing'];
  const old = docOfArtifact(p, e.artifactId);
  const block = doc.narration.blocks.find((b) => b.id === blockId)!;
  if (old) {
    const before = new Map(old.narration.segments.map((s) => [s.id, spokenOf(s)]));
    const changed = block.segments.filter((id) => before.get(id) !== spokenOf(doc.narration.segments.find((s) => s.id === id)!));
    if (changed.length) return [`Spoken text changed in ${list(changed)}`];
    if (JSON.stringify(old.voice) !== JSON.stringify(doc.voice)) return ['The voice changed'];
  }
  return ['Something the narration depends on changed since it was built (for example the voice settings)'];
}

/** What stands in the way of generating narration for this episode: the voice, its recorded runtime and the approved reference. */
export function narrationBlockers(p: Project, doc: EpisodeV2, values: Record<string, unknown>, audioWorker: string): Blocker[] {
  const out: Blocker[] = [];
  if (doc.voice.engine !== 'qwen3-tts') out.push({message: `This episode uses the "${doc.voice.engine}" voice, which this build cannot run. Only the Qwen3-TTS voice is supported for rebuilds.`});
  if (values.voiceRuntime === undefined) out.push({message: 'The setting "voiceRuntime" is not recorded in this workspace, and narration needs it. This version cannot record it; it is set up by the workspace\'s creator.'});
  const vr = values.voiceRuntime as {workerSha256?: string; referenceSha256?: string; referenceTranscriptSha256?: string} | undefined;
  if (vr && doc.voice.engine === 'qwen3-tts') {
    if (vr.workerSha256 !== fileSha(audioWorker)) out.push({message: 'The audio worker script changed since the voice settings were recorded. Rebuilding narration with it would not match the recorded voice, so it is refused. Existing narration is unaffected.'});
    try {
      const ref = getReference(p, doc.voice.profile);
      if (ref.hash !== vr.referenceSha256 || sha256(String(ref.meta.script)) !== vr.referenceTranscriptSha256) out.push({message: `The approved voice reference "${doc.voice.profile}" is not the one recorded with the voice settings.`});
    } catch (e) { out.push({message: `The approved voice reference "${doc.voice.profile}" is not available: ${(e as Error).message}`}); }
  }
  return out;
}

function timingWhy(p: Project, doc: EpisodeV2, e: StatusEntry): string[] {
  if (e.status === 'none') return ['No timing has been built yet'];
  const old = docOfArtifact(p, e.artifactId);
  const out: string[] = [];
  if (old) {
    const d = compareToBuild(old, doc);
    const spoken = Object.values(d.segments).filter((s) => s.spoken).map((s) => s.id);
    const caps = Object.values(d.segments).filter((s) => (s.text || s.captions) && !s.spoken).map((s) => s.id);
    if (spoken.length) out.push(`Narration changes in ${list(spoken)}, so word timing must be measured again`);
    if (caps.length) out.push(`Caption text changed in ${list(caps)}`);
    if (!out.length && JSON.stringify(old.pacing) !== JSON.stringify(doc.pacing)) out.push('Pacing changed');
  }
  return out.length ? out : ['An input of the timing changed since it was built'];
}

/** An episode with no timing yet has nothing the recorded logic could contradict, so it may adopt the current logic. */
export const neverTimed = (p: Project, episodeId: string): boolean => !p.db.prepare("SELECT 1 FROM artifacts WHERE episode_id=? AND kind='timing' LIMIT 1").get(episodeId);

const CUE_RULES_FILE = 'src/library/sceneSpecs.ts';
/** The timeline-logic files whose hash no longer matches what the episode recorded. */
export function timelineLogicDrift(p: Project, episodeId: string, ctx: {sourceRoot: string; tools: ToolPaths}): string[] {
  const logic = getComponentValues(p, episodeId).timelineLogic as Record<string, string> | undefined;
  if (!logic) return [];
  const now = timelineLogicValue(ctx.sourceRoot, ctx.tools.timeline);
  return [...new Set([...Object.keys(logic), ...Object.keys(now)])].filter((k) => logic[k] !== now[k]).sort();
}

/**
 * True when only the cue rules changed and every cue the recorded timing holds still resolves to the same time under the
 * current rules, so re-timing cannot change what the existing scenes were timed on.
 */
export function cueRulesPreserved(p: Project, episodeId: string): boolean {
  const row = currentRows(p, episodeId).find((r) => r.kind === 'timing' && r.subject === 'timeline');
  if (!row) return false;
  const tl = JSON.parse(readFileSync(blobPath(p, row.blob_hash), 'utf8')) as {segments: CueSegment[]; scenes: {id: string; type: string}[]; cues?: Record<string, Record<string, number>>};
  const doc = getEpisode(p, episodeId);
  const byId = new Map(tl.segments.map((s) => [s.id, s]));
  for (const sc of tl.scenes) {
    const recorded = tl.cues?.[sc.id];
    const spec = SCENE_CUES[sc.type];
    if (!recorded || !spec) continue;
    const segs = doc.scenes.find((d) => d.id === sc.id)?.segments;
    if (!segs) return false;
    let now: Record<string, number>;
    try { now = resolveCues(spec, segs.map((id) => byId.get(id)!)); } catch { return false; }
    for (const [name, t] of Object.entries(recorded)) if (!(Math.abs((now[name] ?? NaN) - t) < 0.002)) return false;
  }
  return true;
}

/** Whether this episode may adopt the current timeline logic: it differs from what it recorded, and nothing it was timed on can change. */
export function timelineLogicAdoptable(p: Project, episodeId: string, ctx: {sourceRoot: string; tools: ToolPaths}): boolean {
  const drift = timelineLogicDrift(p, episodeId, ctx);
  if (!drift.length) return false;
  return neverTimed(p, episodeId) || (drift.every((f) => f === CUE_RULES_FILE) && cueRulesPreserved(p, episodeId));
}

export function buildPlan(p: Project, episodeId: string, ctx: PlanContext, active: Plan['active'] = null, mode: 'draft' | 'final' = 'final'): Plan {
  const doc = getEpisode(p, episodeId);
  const info = getEpisodeInfo(p, episodeId);
  const status: Status = statusReport(p, episodeId);
  const values = getComponentValues(p, episodeId);
  const hashes = getComponentHashes(p, episodeId);
  const steps: PlanStep[] = [];
  const blockers: Blocker[] = [];
  const notes: string[] = [];
  const est = (kind: string, subject: string) => estimateFor(kind, subject, ctx.measured);

  // ---- narration, one step per block
  for (const b of doc.narration.blocks) {
    const e = status.takes[b.id];
    const label = `Narration, block ${b.id} (${list(b.segments)})`;
    if (e.status === 'fresh') { steps.push({key: `take:${b.id}`, stage: 'narration', subject: b.id, label, action: 'current', why: [], estimate: null}); continue; }
    const hit = findTake(p, episodeId, b.id, ctx.seed);
    if (hit) steps.push({key: `take:${b.id}`, stage: 'narration', subject: b.id, label, action: 'reuse', why: [...takeWhy(p, doc, b.id, e), 'A saved take for exactly this text and voice exists and will be selected; nothing is regenerated'], estimate: null});
    else steps.push({key: `take:${b.id}`, stage: 'narration', subject: b.id, label, action: 'run', why: takeWhy(p, doc, b.id, e), estimate: est('take', b.id)});
  }
  const narrationRuns = steps.some((s) => s.stage === 'narration' && s.action === 'run');

  // ---- timing, mix, render. An output made earlier from exactly the same inputs is selected instead of rebuilt (undoing an edit).
  // Downstream hashes depend on the blobs upstream, so they can only be predicted while every earlier step is current or reused.
  const comp = getComponentHashes(p, episodeId);
  const hypo = upstreamBlobs(p, episodeId, doc);
  let predictable = true;
  for (const st of steps.filter((x) => x.stage === 'narration' && x.action !== 'current')) {
    const hit = st.action === 'reuse' ? findTake(p, episodeId, st.subject!, ctx.seed) : undefined;
    if (hit) hypo.takes[st.subject!] = hit.blobHash; else predictable = false;
  }
  const drift = renderSourceProblems(p, {components: hashes} as SnapshotManifest, ctx.sourceRoot);
  const toolDrift = renderToolProblems(ctx.sourceRoot, values.versions as never, ctx.tools.renderWorker);
  const sourcesChanged = drift.length > 0 || toolDrift.length > 0;
  const accents = Array.isArray(values.soundEvents) && values.soundEvents.length > 0;
  const upstreamChanges = () => steps.some((x) => x.action !== 'current');
  const reuseWhy = (label: string) => `A saved ${label} made from exactly these inputs exists and will be selected; nothing is rebuilt`;

  const stage = (key: string, kind: string, subject: string, label: string, e: StatusEntry, expectedHash: () => string, setBlob: (blob: string) => void, why: string[], forceRun = false, upstreamOf: () => boolean = upstreamChanges) => {
    if (e.status === 'fresh' && !upstreamOf() && !forceRun) { steps.push({key, stage: kind as PlanStep['stage'], label, action: 'current', why: [], estimate: null}); return; }
    const hit = predictable && !forceRun ? findArtifactByInputs(p, episodeId, kind === 'mix' ? 'mix' : kind, subject, expectedHash()) : undefined;
    if (hit) { setBlob(hit.blobHash); steps.push({key, stage: kind as PlanStep['stage'], label, action: 'reuse', why: [reuseWhy(label.toLowerCase())], estimate: null}); return; }
    predictable = false;
    steps.push({key, stage: kind as PlanStep['stage'], label, action: 'run', why, estimate: est(kind, subject)});
  };
  const narrationChanges = steps.some((x) => x.stage === 'narration' && x.action !== 'current');
  stage('timing', 'timing', 'timeline', 'Timing and captions', status.timing, () => computeExpected(doc, comp, hypo).timing, (b) => { hypo.timing = b; },
    status.timing.status === 'none' ? ['No timing has been built yet'] : narrationChanges ? ['Narration changes, so word timing must be measured again'] : timingWhy(p, doc, status.timing));
  const timingRuns = steps.at(-1)!.action === 'run';
  const Mode = mode === 'final' ? 'Final' : 'Draft';
  stage(`mix:${mode}`, 'mix', mode, `${Mode} audio mix`, status.mix[mode], () => computeExpected(doc, comp, hypo).mix[mode], (b) => { hypo.mix[mode] = b; },
    status.mix[mode].status === 'none' ? [`No ${mode} mix has been built yet`] : [narrationChanges ? 'The narration audio changes' : accents && upstreamChanges() ? 'Sound accents are placed on the scene timing, which changes' : 'An input of the mix changed since it was built'],
    false, () => steps.some((x) => x.action !== 'current' && (x.stage === 'narration' || accents))); // without accents the mix does not depend on the timing
  const mixRuns = steps.at(-1)!.action === 'run';
  stage(`render:${mode}`, 'render', mode, `${Mode} video`, status.render[mode], () => computeExpected(doc, comp, hypo).render[mode].hash, () => undefined,
    status.render[mode].status === 'none' ? [`No ${mode} video has been built yet`]
      : [...(upstreamChanges() ? ['The timing or audio it is made from changes'] : status.render[mode].status !== 'fresh' ? ['The text, emphasis or scene it shows changed since it was built'] : []), ...(sourcesChanged ? [`The app's render sources changed since they were recorded (${[...drift, ...toolDrift].slice(0, 3).join('; ')}${drift.length + toolDrift.length > 3 ? '; ...' : ''}). They will be recorded again when the rebuild starts.`] : [])],
    sourcesChanged);
  const renderRuns = steps.at(-1)!.action === 'run';

  // ---- inputs this build cannot apply, and tools that no longer match what was recorded
  blockers.push(...planningBlockers(p, episodeId));
  for (const m of unsupportedInputs(doc, values)) {
    const ids = /\(([a-z0-9_, -]+)\) cannot be applied/.exec(m)?.[1]?.split(',').map((s) => s.trim());
    blockers.push({message: m, ...(ids ? {segments: ids} : {})});
  }
  const unset = (name: string) => hashes[name as keyof typeof hashes] === UNSET;
  const needSetting = (name: string, used: string) => { if (unset(name)) blockers.push({message: `The setting "${name}" is not recorded in this workspace, and ${used} needs it. This version cannot record it; it is set up by the workspace's creator.`}); };
  if (narrationRuns) blockers.push(...narrationBlockers(p, doc, values, ctx.tools.audioWorker));
  if (timingRuns) {
    blockers.push(...cueTextProblems(doc));
    needSetting('timelineLogic', 'timing');
    const logic = values.timelineLogic as Record<string, string> | undefined;
    if (logic && hashJson(logic) !== hashJson(timelineLogicValue(ctx.sourceRoot, ctx.tools.timeline))) {
      if (timelineLogicAdoptable(p, episodeId, ctx)) notes.push(neverTimed(p, episodeId) ? 'The timeline logic (cue rules) changed since this workspace recorded it. This episode has never been timed, so starting the rebuild records the current logic for this episode only; other episodes keep what they recorded.' : 'Only the scene cue rules changed since this episode recorded its timeline logic, and every cue its timing holds still resolves to the same time. Starting the rebuild records the current rules for this episode only; other episodes keep what they recorded.');
      else blockers.push({message: 'The timeline logic files changed since they were recorded, so timing would not match the recorded settings and is refused.'});
    }
  }
  if (mixRuns) {
    needSetting('mixParams', 'the mix'); if (mode === 'final') needSetting('masteringParams', 'the final mix');
    const mp = values.mixParams as {mixScriptSha256?: string} | undefined;
    if (mp && mp.mixScriptSha256 !== mixScriptFingerprint(ctx.tools.mix)) blockers.push({message: 'The mix script changed since the mix settings were recorded, so the mix would not match them and is refused.'});
    if (accents) for (const m of accentCueProblems(values.soundEvents as never, doc.scenes as never)) blockers.push({message: `${m} The mix would refuse it.`});
  }
  if (renderRuns) {
    needSetting('renderSettings', 'the video'); needSetting('versions', 'the video');
    for (const m of renderSettingsProblems(values.renderSettings)) if (!unset('renderSettings')) blockers.push({message: `Render settings: ${m}.`});
  }

  if (sourcesChanged) notes.push('The render sources recorded for this workspace differ from the working copy. Starting the rebuild records the current ones; the final video is rebuilt because of it.');
  if (steps.some((s) => s.action === 'run' && s.stage === 'narration')) notes.push('Narration uses the approved Pip voice on the models already installed on this computer. Nothing is downloaded.');
  if (steps.some((s) => s.action === 'run' && s.stage !== 'narration')) notes.push('Later steps are checked again as earlier ones finish; one whose inputs turn out unchanged is skipped.');
  notes.push(mode === 'final' ? 'This builds the final video: the audio is mastered, and this is the file that is reviewed, approved and exported.' : 'This builds a draft video for review: the audio is the unmastered mix, and a draft can never be approved or exported.');

  const run = steps.filter((s) => s.action === 'run');
  const total = totalEstimate(run.map((s) => ({key: s.key, label: s.label, state: 'stale' as const, why: s.why, estimate: s.estimate!})));
  return {episodeId, seq: info.seq, docHash: info.docHash, mode, steps, blockers, notes, total, nothingToDo: steps.every((s) => s.action === 'current'), active};
}
