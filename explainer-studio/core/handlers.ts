// Job handlers: narration (Qwen3-TTS, approved reference), timing (aligner or labelled estimate + the Python timeline
// logic), mix (placement and mastering) and render (Remotion in its own process). Each reads ONLY its job snapshot.
import type {SpawnOptions} from 'node:child_process';
import {copyFileSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {findTakeByInputs, getReference, type JobKind} from './artifacts.ts';
import {blobPath, putFile, requireBlob} from './blobs.ts';
import {hashJson} from './hash.ts';
import {PreflightError, type JobCtx, type JobHandler, type JobResult} from './runner.ts';
import {getComponentValue} from './state.ts';
import {assembleSegTimings, buildTimelineViaPython, planLayout, timelineEpisode, wavDuration, type BlockTiming, type RunText} from './timeline.ts';
import {WorkerError} from './worker.ts';
import type {EpisodeV2} from '../src/schema2.ts';

export type HandlerEnv = {
  /** Repository root: where pipeline/, workers/ and src/ live. */
  root: string;
  /** .venv-qwen interpreter (mlx-audio, numpy, scipy) and the one for the pure-Python timeline logic. */
  qwenPython: string;
  python: string;
  defaultSeed?: number;
  renderConcurrency?: number;
  /** Script run with node for render jobs. Default: workers/render-worker.ts (tests substitute a fake). */
  renderWorker?: string;
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

const needBlob = (what: string, hash: string | null | undefined): string => {
  if (!hash) throw new PreflightError(`${what} does not exist yet; build it first`);
  return hash;
};

/** Blob hashes of every block's take in the job's snapshot, copied into the workspace as <block>.wav. */
function stageTakes(ctx: JobCtx): Record<string, string> {
  const paths: Record<string, string> = {};
  for (const b of ctx.doc.narration.blocks) {
    const hash = needBlob(`the take for block "${b.id}"`, ctx.snapshot.blobs.takes[b.id]);
    requireBlob(ctx.p, hash);
    paths[b.id] = join(ctx.ws, `${b.id}.wav`);
    copyFileSync(blobPath(ctx.p, hash), paths[b.id]);
  }
  return paths;
}

export function makeHandlers(env: HandlerEnv): Partial<Record<JobKind, JobHandler>> {
  const cli = join(env.root, 'pipeline', 'timeline_cli.py');

  const tts: JobHandler = async (ctx) => {
    const {doc, snapshot} = ctx;
    if (doc.voice.engine !== 'qwen3-tts') throw new PreflightError(`episode "${doc.id}" uses voice engine "${doc.voice.engine}", which this worker cannot run`);
    const seed = Number(ctx.params.seed ?? env.defaultSeed ?? 11);
    const hit = findTakeByInputs(ctx.p, ctx.episodeId, ctx.subject, snapshot.expected.take[ctx.subject], seed);
    if (hit) { // block-level cache: same text, voice runtime and seed
      ctx.progress({step: 'cache hit: reusing the existing take', detail: {artifactId: hit.artifactId}});
      return {blobHash: hit.blobHash, seed, meta: {cacheHit: true, reusedArtifact: hit.artifactId}};
    }
    if (!ctx.host) throw new PreflightError('no audio worker is configured');
    const ref = getReference(ctx.p, doc.voice.profile);
    const refText = ref.meta.script;
    if (typeof refText !== 'string') throw new PreflightError(`approved reference "${doc.voice.profile}" has no recorded script`);
    ctx.progress({step: 'loading the voice model'});
    ctx.host.ensureWorker();
    ctx.leaseHost(); // so cancelling this job can stop the worker it is using
    await ctx.host.ensureModel('tts');
    const refWav = join(ctx.ws, 'reference.wav');
    copyFileSync(ref.path, refWav);
    const out = join(ctx.ws, 'take.wav');
    const text = blockText(doc, ctx.subject).join(' ');
    const r = await ctx.host.request('generate', {text, ref_wav: refWav, ref_sha256: ref.hash, ref_text: refText, seed, out_wav: out}, {
      timeoutMs: 15 * 60_000,
      onEvent: (e) => ctx.progress({step: 'generating speech', detail: {audioSeconds: e.audio_s, elapsedSeconds: e.elapsed_s}}), // the total is unknown: no fraction
    });
    const {hash} = putFile(ctx.p, out);
    return {blobHash: hash, seed, meta: {cacheHit: false, durationSec: r.duration_s, sampleRate: r.sample_rate, genSec: r.gen_s, rtf: r.rtf, mlxPeakBytes: r.peak_bytes, referenceSha256: ref.hash}};
  };

  const timing: JobHandler = async (ctx) => {
    const {doc, snapshot} = ctx;
    ctx.progress({step: 'reading the takes'});
    const wavs = stageTakes(ctx);
    const layout = planLayout(doc, Object.fromEntries(Object.entries(wavs).map(([id, p]) => [id, wavDuration(p).seconds])));
    const alignerValue = getComponentValue<{id: string}>(ctx.p, 'aligner', ctx.episodeId);
    if (hashJson(alignerValue) !== snapshot.components.aligner) throw new PreflightError('the aligner setting changed after this job was queued; enqueue it again');
    const wantAligned = !!alignerValue && alignerValue.id !== 'estimated';
    if (!ctx.host) throw new PreflightError('no audio worker is configured');
    ctx.host.ensureWorker();
    ctx.leaseHost();
    if (wantAligned) { ctx.progress({step: 'loading the aligner'}); await ctx.host.ensureModel('aligner'); }
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
    const blob = putFile(ctx.p, (() => { const f = join(ctx.ws, 'timeline.json'); writeFileSync(f, JSON.stringify(timeline)); return f; })());
    return {blobHash: blob.hash, meta: {source, alignerId: alignerValue?.id ?? null, alignSeconds: Math.round((Date.now() - t0) / 100) / 10, notes, durationSec: layout.totalSec}};
  };

  const mix = (kind: 'draft' | 'final'): JobHandler => async (ctx) => {
    const {doc} = ctx;
    ctx.progress({step: 'reading the takes'});
    const wavs = stageTakes(ctx);
    const layout = planLayout(doc, Object.fromEntries(Object.entries(wavs).map(([id, p]) => [id, wavDuration(p).seconds])));
    const master = kind === 'final' ? getComponentValue<{lufs: number; true_peak_db: number; lra: number}>(ctx.p, 'masteringParams', ctx.episodeId) : undefined;
    if (kind === 'final' && !master) throw new PreflightError('no mastering targets are recorded');
    const out = join(ctx.ws, 'mix.wav');
    ctx.progress({step: kind === 'final' ? 'placing the takes and mastering' : 'placing the takes'});
    const facts = JSON.parse(await runText(ctx, 'mix', env.root)(env.qwenPython, [join(env.root, 'workers', 'mix.py')], JSON.stringify({
      out, total_sec: layout.totalSec, blocks: layout.blocks.map((b) => ({wav: wavs[b.id], offset_sec: b.offsetSec})), master: master ?? null,
    })));
    const {hash} = putFile(ctx.p, out);
    return {blobHash: hash, meta: {...facts, durationSec: layout.totalSec}};
  };

  const render = (kind: 'draft' | 'final'): JobHandler => async (ctx) => {
    const {doc, snapshot} = ctx;
    const timelineHash = needBlob('the timing', snapshot.blobs.timing);
    const mixHash = needBlob(`the ${kind} mix`, snapshot.blobs.mix[kind]);
    requireBlob(ctx.p, timelineHash); requireBlob(ctx.p, mixHash);
    const timeline = JSON.parse(readFileSync(blobPath(ctx.p, timelineHash), 'utf8'));
    const variant = 'full';
    const pub = join(ctx.ws, 'public', 'generated', doc.id, variant);
    mkdirSync(pub, {recursive: true});
    copyFileSync(blobPath(ctx.p, mixHash), join(pub, timeline.audio));
    mkdirSync(join(ctx.ws, 'tmp'), {recursive: true});
    const settings = getComponentValue<{crf?: number}>(ctx.p, 'renderSettings', ctx.episodeId) ?? {};
    const out = join(ctx.ws, 'render.mp4');
    const spec = join(ctx.ws, 'render-job.json');
    writeFileSync(spec, JSON.stringify({
      entry: join(env.root, 'src', 'index.ts'), publicDir: join(ctx.ws, 'public'), bundleDir: join(ctx.ws, 'bundle'), out, composition: 'studio-episode',
      inputProps: {episode: doc.id, variant, data: {episode: {id: doc.id, scenes: doc.scenes}, timeline}}, crf: kind === 'draft' ? 28 : (settings.crf ?? 18), concurrency: env.renderConcurrency ?? 2,
    }));
    const child = ctx.spawn('render-worker', process.execPath, [env.renderWorker ?? join(env.root, 'workers', 'render-worker.ts'), spec], {cwd: env.root, stdio: ['ignore', 'pipe', 'pipe'], env: {TMPDIR: join(ctx.ws, 'tmp')}});
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
    return {blobHash: hash, meta: {...result, kind}};
  };

  return {'tts.block': tts, 'timing.build': timing, 'mix.draft': mix('draft'), 'mix.final': mix('final'), 'render.draft': render('draft'), 'render.final': render('final')} satisfies Partial<Record<JobKind, JobHandler>>;
}

export type {JobResult};
