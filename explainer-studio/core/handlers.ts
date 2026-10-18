// Job handlers: narration (Qwen3-TTS, approved reference), timing (aligner or labelled estimate + the Python timeline
// logic), mix (placement, gain, mastering) and render (Remotion in its own process).
//
// Inputs: a handler reads settings ONLY from its job snapshot (what was recorded when the job was queued), never from
// the project's current settings. Files executed from the checkout (workers, timeline logic, render sources) cannot be
// frozen in Phase 2, so each handler first verifies they match what was recorded and otherwise refuses to run.
import type {SpawnOptions} from 'node:child_process';
import {copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import type {EpisodeV2} from '../src/schema2.ts';
import {findTakeByInputs, getReference, type JobKind} from './artifacts.ts';
import {blobPath, putFile, requireBlob} from './blobs.ts';
import {UNSET, type ComponentName} from './deps.ts';
import {hashJson, sha256} from './hash.ts';
import {PreflightError, type JobCtx, type JobHandler} from './runner.ts';
import {renderSettingsProblems, unsupportedInputs} from './support.ts';
import {accentTimes, type AccentEvent} from '../src/library/accents.ts';
import {checkFonts} from '../src/library/fontCheck.ts';
import {annotateTimeline, assembleSegTimings, buildTimelineViaPython, planLayout, timelineEpisode, wavDuration, type BlockTiming, type RunText} from './timeline.ts';
import {defaultTools, fileSha, mixScriptFingerprint, renderSourceProblems, renderToolProblems, timelineLogicValue} from './toolchain.ts';
import {WorkerError} from './worker.ts';

export type HandlerEnv = {
  /** Repository root (the app directory): where pipeline/, workers/ and src/ live. */
  root: string;
  /** .venv-qwen interpreter (mlx-audio, numpy, scipy) and the one for the pure-Python timeline logic. */
  qwenPython: string;
  python: string;
  defaultSeed?: number;
  renderConcurrency?: number;
  /** The scripts that are actually executed; tests substitute fakes. Their hashes are checked against the recorded settings. */
  audioWorker?: string;
  mixScript?: string;
  renderWorker?: string;
  timelineFiles?: string[];
  /** Where render sources are read from (default: root). */
  sourceRoot?: string;
};

const spoken = (s: EpisodeV2['narration']['segments'][number]) => s.speech ?? s.text;
const blockText = (doc: EpisodeV2, blockId: string) => {
  const seg = new Map(doc.narration.segments.map((s) => [s.id, s]));
  return doc.narration.blocks.find((b) => b.id === blockId)!.segments.map((id) => spoken(seg.get(id)!));
};

/** Run a process owned by the job; resolves with stdout, rejects with the stderr tail. Cancelling the job kills it. */
function runText(ctx: JobCtx, role: string, cwd: string): RunText {
  return (cmd, args, stdin) => new Promise((resolve, reject) => {
    const opts: SpawnOptions = {cwd, stdio: ['pipe', 'pipe', 'pipe']};
    const child = ctx.spawn(role, cmd, args, opts);
    let out = '', err = '';
    child.stdout!.setEncoding('utf8').on('data', (d: string) => { out += d; });
    child.stderr!.setEncoding('utf8').on('data', (d: string) => { err = (err + d).slice(-4000); });
    child.on('error', reject);
    child.on('exit', (code, sig) => (code === 0 ? resolve(out) : reject(new Error(`${role} ${sig ? `was stopped (${sig})` : `exited with code ${code}`}: ${err.trim().split('\n').slice(-3).join(' | ')}`))));
    child.stdin!.on('error', () => { /* the exit handler reports it */ });
    child.stdin!.end(stdin);
  });
}

/** A recorded blob this job needs; refuses instead of substituting anything. */
function recordedBlob(ctx: JobCtx, what: string, hash: string | null | undefined): string {
  if (!hash) throw new PreflightError(`${what} does not exist yet; build it first`);
  try { requireBlob(ctx.p, hash); } catch { throw new PreflightError(`${what} recorded for this job (${hash.slice(0, 12)}) is no longer in the project; refusing to use anything else`); }
  return hash;
}

/** A plain-value setting as recorded when the job was queued. */
function recorded<T>(ctx: JobCtx, name: ComponentName): T | undefined {
  const values = ctx.snapshot.componentValues;
  if (!values) throw new PreflightError('this job was queued by an older build that did not record its settings; queue it again');
  const value = values[name];
  const hash = ctx.snapshot.components[name];
  if (value === undefined) {
    if (hash !== UNSET) throw new PreflightError(`the recorded value of setting "${name}" is unavailable`);
    return undefined;
  }
  if (hashJson(value) !== hash) throw new PreflightError(`the recorded setting "${name}" does not match its recorded hash`);
  return value as T;
}
const need = <T>(v: T | undefined, what: string): T => {
  if (v === undefined) throw new PreflightError(`${what} was not recorded for this job`);
  return v;
};

/** Reject inputs this build cannot apply, from the job's own snapshot, before any expensive work. */
function guard(ctx: JobCtx): void {
  const problems = unsupportedInputs(ctx.doc, ctx.snapshot.componentValues ?? {});
  if (problems.length) throw new PreflightError(`${ctx.kind} refused:\n- ${problems.join('\n- ')}`);
}

/** Every block's take from the job's snapshot, copied into the workspace as <block>.wav. */
function stageTakes(ctx: JobCtx): Record<string, string> {
  const paths: Record<string, string> = {};
  for (const b of ctx.doc.narration.blocks) {
    const hash = recordedBlob(ctx, `the take for block "${b.id}"`, ctx.snapshot.blobs.takes[b.id]);
    paths[b.id] = join(ctx.ws, `${b.id}.wav`);
    copyFileSync(blobPath(ctx.p, hash), paths[b.id]);
  }
  return paths;
}

type VoiceRuntime = {engine: string; model: string; revision: string; mlxAudio: string; mlx: string; referenceSha256: string; referenceTranscriptSha256: string; generation: {maxTokens: number}; workerSha256: string};

export function makeHandlers(env: HandlerEnv): Partial<Record<JobKind, JobHandler>> {
  const tools = {...defaultTools(env.root), ...(env.audioWorker ? {audioWorker: env.audioWorker} : {}), ...(env.mixScript ? {mix: env.mixScript} : {}), ...(env.renderWorker ? {renderWorker: env.renderWorker} : {}), ...(env.timelineFiles ? {timeline: env.timelineFiles} : {})};
  const cli = join(env.root, 'pipeline', 'timeline_cli.py');
  const sourceRoot = env.sourceRoot ?? env.root;

  const tts: JobHandler = async (ctx) => {
    guard(ctx);
    const {doc, snapshot} = ctx;
    if (doc.voice.engine !== 'qwen3-tts') throw new PreflightError(`episode "${doc.id}" uses voice engine "${doc.voice.engine}", which this worker cannot run`);
    const vr = need(recorded<VoiceRuntime>(ctx, 'voiceRuntime'), 'the voice runtime');
    const seed = Number(ctx.params.seed ?? env.defaultSeed ?? 11);
    const hit = findTakeByInputs(ctx.p, ctx.episodeId, ctx.subject, snapshot.expected.take[ctx.subject], seed);
    if (hit) { // block-level cache: same text, voice runtime and seed
      ctx.progress({step: 'cache hit: reusing the existing take', detail: {artifactId: hit.artifactId}});
      return {blobHash: hit.blobHash, seed, meta: {cacheHit: true, reusedArtifact: hit.artifactId}};
    }
    if (!ctx.host) throw new PreflightError('no audio worker is configured');
    if (vr.workerSha256 !== fileSha(tools.audioWorker)) throw new PreflightError('the audio worker script changed since the voice runtime was recorded; record it again');
    const ref = getReference(ctx.p, doc.voice.profile);
    const transcript = ref.meta.script;
    if (typeof transcript !== 'string') throw new PreflightError(`approved reference "${doc.voice.profile}" has no recorded transcript`);
    if (ref.hash !== vr.referenceSha256 || sha256(transcript) !== vr.referenceTranscriptSha256) throw new PreflightError(`reference "${doc.voice.profile}" is not the reference (audio and transcript) recorded in the voice runtime`);
    ctx.progress({step: 'loading the voice model'});
    ctx.host.ensureWorker();
    ctx.leaseHost(); // so cancelling this job can stop the worker it is using
    await ctx.host.ensureModel('tts');
    const refWav = join(ctx.ws, 'reference.wav');
    copyFileSync(ref.path, refWav);
    const out = join(ctx.ws, 'take.wav');
    const r = await ctx.host.request('generate', {
      text: blockText(doc, ctx.subject).join(' '), ref_wav: refWav, ref_sha256: ref.hash, ref_text: transcript, seed, out_wav: out,
      max_tokens: vr.generation.maxTokens, expect: {model_revision: vr.revision, mlx_audio: vr.mlxAudio, mlx: vr.mlx},
    }, {
      timeoutMs: 15 * 60_000,
      onEvent: (e) => ctx.progress({step: 'generating speech', detail: {audioSeconds: e.audio_s, elapsedSeconds: e.elapsed_s}}), // the total is unknown: no fraction
    });
    const {hash} = putFile(ctx.p, out);
    return {blobHash: hash, seed, meta: {
      cacheHit: false, durationSec: r.duration_s, sampleRate: r.sample_rate, genSec: r.gen_s, rtf: r.rtf, mlxPeakBytes: r.peak_bytes,
      used: {referenceSha256: ref.hash, referenceTranscriptSha256: sha256(transcript), model: vr.model, revision: vr.revision, mlxAudio: vr.mlxAudio, maxTokens: vr.generation.maxTokens, workerSha256: vr.workerSha256},
    }};
  };

  const timing: JobHandler = async (ctx) => {
    guard(ctx);
    const {doc} = ctx;
    const aligner = recorded<{id: string; revision?: string}>(ctx, 'aligner');
    const wantAligned = !!aligner && aligner.id !== 'estimated';
    const logic = need(recorded<Record<string, string>>(ctx, 'timelineLogic'), 'the timeline logic fingerprint');
    const actualLogic = timelineLogicValue(env.root, tools.timeline);
    if (hashJson(logic) !== hashJson(actualLogic)) throw new PreflightError('the timeline logic files changed since the timeline logic was recorded; record it again');
    if (!ctx.host) throw new PreflightError('no audio worker is configured');
    ctx.progress({step: 'reading the takes'});
    const wavs = stageTakes(ctx);
    const layout = planLayout(doc, Object.fromEntries(Object.entries(wavs).map(([id, p]) => [id, wavDuration(p).seconds])));
    ctx.host.ensureWorker();
    ctx.leaseHost();
    if (wantAligned) {
      ctx.progress({step: 'loading the aligner'});
      await ctx.host.ensureModel('aligner');
      await ctx.host.request('check', {model: 'aligner', expect: {model_revision: aligner!.revision}}, {timeoutMs: 30_000}); // a mismatch refuses the job; it must not degrade to the estimate
    }
    const blocks: BlockTiming[] = [];
    const notes: string[] = [];
    const t0 = Date.now();
    for (const [i, b] of doc.narration.blocks.entries()) {
      const spokenTexts = blockText(doc, b.id);
      const segments = b.segments.map((id, k) => ({id, text: spokenTexts[k]}));
      ctx.progress({step: `${wantAligned ? 'aligning' : 'estimating'} block ${i + 1} of ${doc.narration.blocks.length}`, fraction: i / doc.narration.blocks.length});
      let source: BlockTiming['source'] = wantAligned ? 'aligned' : 'estimated';
      let res: any;
      if (wantAligned) {
        try { res = await ctx.host.request('align', {wav: wavs[b.id], segments}, {timeoutMs: 5 * 60_000}); }
        catch (e) { if (!(e instanceof WorkerError)) throw e; source = 'estimated'; notes.push(`block "${b.id}": alignment failed (${e.message}); estimated instead`); }
      }
      if (source === 'estimated') res = await ctx.host.request('estimate', {wav: wavs[b.id], segments}, {timeoutMs: 60_000});
      blocks.push({blockId: b.id, source, segments: res.segments});
    }
    ctx.progress({step: 'building the timeline'});
    const {segTimings, timingSources, source} = assembleSegTimings(layout, blocks);
    const timeline = await buildTimelineViaPython(runText(ctx, 'timeline', env.root), env.python, cli, {
      episode: timelineEpisode(doc), segTimings, source, variant: 'full', audioDuration: layout.totalSec, timingSources,
    });
    ctx.progress({step: 'measuring the mouth track from the audio'});
    const {mouth} = JSON.parse(await runText(ctx, 'mouth', env.root)(env.qwenPython, [join(env.root, 'workers', 'mouth.py')], JSON.stringify({
      blocks: layout.blocks.map((b) => ({wav: wavs[b.id], offset_sec: b.offsetSec})), total_sec: layout.totalSec, fps: 30,
    })));
    annotateTimeline(timeline, doc, mouth);
    const file = join(ctx.ws, 'timeline.json');
    writeFileSync(file, JSON.stringify(timeline));
    const blob = putFile(ctx.p, file);
    return {blobHash: blob.hash, meta: {source, alignerId: aligner?.id ?? null, alignerRevision: aligner?.revision ?? null, alignSeconds: Math.round((Date.now() - t0) / 100) / 10, notes, durationSec: layout.totalSec, timelineLogic: actualLogic}};
  };

  const mix = (kind: 'draft' | 'final'): JobHandler => async (ctx) => {
    guard(ctx);
    const {doc} = ctx;
    const params = need(recorded<{voiceGainDb?: number; accentBusDb?: number; accentDuck?: number; mixScriptSha256?: string}>(ctx, 'mixParams'), 'the mix parameters (with the mix script hash)');
    if (params.mixScriptSha256 !== mixScriptFingerprint(tools.mix)) throw new PreflightError('the mix script changed since the mix parameters were recorded; record them again');
    const master = kind === 'final' ? need(recorded<{lufs: number; true_peak_db: number; lra: number}>(ctx, 'masteringParams'), 'the mastering targets') : undefined;
    ctx.progress({step: 'reading the takes'});
    const wavs = stageTakes(ctx);
    const layout = planLayout(doc, Object.fromEntries(Object.entries(wavs).map(([id, p]) => [id, wavDuration(p).seconds])));
    const events = (recorded<AccentEvent[]>(ctx, 'soundEvents') ?? []);
    let accents: {accent: string; t: number; gain_db: number; params: Record<string, unknown>}[] = [];
    if (events.length) {
      const timeline = JSON.parse(readFileSync(blobPath(ctx.p, recordedBlob(ctx, 'the timing (accents are placed on scene cues)', ctx.snapshot.blobs.timing)), 'utf8'));
      let times: number[];
      try { times = accentTimes(events, timeline.cues); } catch (e) { throw new PreflightError(`mix refused: ${(e as Error).message}`); }
      accents = events.map((e, i) => ({accent: e.accent, t: times[i], gain_db: e.gainDb, params: e.params ?? {}}));
      if (accents.some((a) => a.t < 0 || a.t > layout.totalSec)) throw new PreflightError('mix refused: a sound event falls outside the episode');
    }
    const out = join(ctx.ws, 'mix.wav');
    ctx.progress({step: kind === 'final' ? 'placing the takes and mastering' : 'placing the takes'});
    const facts = JSON.parse(await runText(ctx, 'mix', env.root)(env.qwenPython, [tools.mix], JSON.stringify({
      out, total_sec: layout.totalSec, gain_db: params.voiceGainDb ?? 0, blocks: layout.blocks.map((b) => ({wav: wavs[b.id], offset_sec: b.offsetSec})), master: master ?? null,
      accents, accent_bus_db: params.accentBusDb ?? -12, accent_duck: params.accentDuck ?? 0.55,
    })));
    const {hash} = putFile(ctx.p, out);
    return {blobHash: hash, meta: {...facts, durationSec: layout.totalSec, used: {mastering: master ?? null, voiceGainDb: params.voiceGainDb ?? 0, mixScriptSha256: params.mixScriptSha256, accents, accentBusDb: params.accentBusDb ?? -12, accentDuck: params.accentDuck ?? 0.55}}};
  };

  const render = (kind: 'draft' | 'final'): JobHandler => async (ctx) => {
    guard(ctx);
    const {doc, snapshot} = ctx;
    const timelineHash = recordedBlob(ctx, 'the timing', snapshot.blobs.timing);
    const mixHash = recordedBlob(ctx, `the ${kind} mix`, snapshot.blobs.mix[kind]);
    const settings = need(recorded<Record<string, unknown>>(ctx, 'renderSettings'), 'the render settings');
    const bad = renderSettingsProblems(settings);
    if (bad.length) throw new PreflightError(`render refused:\n- ${bad.join('\n- ')}`);
    const versions = recorded<{remotion?: string; remotionRenderer?: string; renderWorkerSha256?: string}>(ctx, 'versions');
    const toolBad = renderToolProblems(sourceRoot, versions, tools.renderWorker);
    if (toolBad.length) throw new PreflightError(`render refused; the toolchain differs from the one recorded:\n- ${toolBad.join('\n- ')}`);
    const srcBad = renderSourceProblems(ctx.p, snapshot, sourceRoot);
    if (srcBad.length) throw new PreflightError(`render refused; the working checkout differs from the sources recorded when the job was queued (${srcBad.length}):\n- ${srcBad.slice(0, 8).join('\n- ')}${srcBad.length > 8 ? '\n- ...' : ''}`);
    const timeline = JSON.parse(readFileSync(blobPath(ctx.p, timelineHash), 'utf8'));
    const variant = 'full';
    const pub = join(ctx.ws, 'public', 'generated', doc.id, variant);
    mkdirSync(pub, {recursive: true});
    copyFileSync(blobPath(ctx.p, mixHash), join(pub, timeline.audio));
    mkdirSync(join(ctx.ws, 'tmp'), {recursive: true});
    const libraryPublic = join(sourceRoot, 'public', 'library'); // fonts and the silent track; verified above as part of the recorded assets
    if (doc.style === 'pip-paper-bundled') {
      const bad = checkFonts(join(libraryPublic, 'fonts'));
      if (bad.length) throw new PreflightError(`render refused: the bundled fonts are not intact (${bad.join('; ')}). Restore public/library/fonts.`);
    }
    if (existsSync(libraryPublic)) cpSync(libraryPublic, join(ctx.ws, 'public', 'library'), {recursive: true});
    const crf = kind === 'draft' ? 28 : (settings.crf as number);
    const out = join(ctx.ws, 'render.mp4');
    const spec = join(ctx.ws, 'render-job.json');
    writeFileSync(spec, JSON.stringify({
      entry: join(sourceRoot, 'src', 'index.ts'), publicDir: join(ctx.ws, 'public'), bundleDir: join(ctx.ws, 'bundle'), out, composition: 'studio-episode',
      inputProps: {episode: doc.id, variant, data: {episode: {id: doc.id, style: doc.style ?? 'legacy-dark', scenes: doc.scenes}, timeline}}, crf, concurrency: env.renderConcurrency ?? 2,
    }));
    const child = ctx.spawn('render-worker', process.execPath, [tools.renderWorker, spec], {cwd: sourceRoot, stdio: ['ignore', 'pipe', 'pipe'], env: {TMPDIR: join(ctx.ws, 'tmp')}});
    const result = await new Promise<any>((resolve, reject) => {
      let buf = '', err = '', res: any, failure: string | undefined;
      child.stdout!.setEncoding('utf8').on('data', (d: string) => {
        buf += d;
        const lines = buf.split('\n'); buf = lines.pop()!;
        for (const l of lines) {
          let m: any; try { m = JSON.parse(l); } catch { continue; }
          if (m.event === 'progress') ctx.progress({step: m.step, ...(typeof m.fraction === 'number' ? {fraction: m.fraction} : {}), detail: {renderedFrames: m.renderedFrames, encodedFrames: m.encodedFrames, totalFrames: m.totalFrames}});
          else if (m.event === 'result') res = m.data;
          else if (m.event === 'error') failure = m.message;
        }
      });
      child.stderr!.setEncoding('utf8').on('data', (d: string) => { err = (err + d).slice(-4000); });
      child.on('error', reject);
      child.on('exit', (code, sig) => (code === 0 && res ? resolve(res) : reject(new Error(failure ?? `render worker ${sig ? `was stopped (${sig})` : `exited with code ${code}`}: ${err.trim().split('\n').slice(-3).join(' | ')}`))));
    });
    const {hash} = putFile(ctx.p, out);
    return {blobHash: hash, meta: {...result, kind, used: {crf, settings, timelineBlob: timelineHash, mixBlob: mixHash, sourcesVerifiedAgainstRecorded: true, remotion: versions?.remotion}}};
  };

  return {'tts.block': tts, 'timing.build': timing, 'mix.draft': mix('draft'), 'mix.final': mix('final'), 'render.draft': render('draft'), 'render.final': render('final')} satisfies Partial<Record<JobKind, JobHandler>>;
}
