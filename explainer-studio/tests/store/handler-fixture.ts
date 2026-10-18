// Shared set-up for tests that run the real handlers against fake workers: a temporary project holding the join-fanout
// episode with the Qwen voice, every setting recorded the way the product records it, and a runner wired to fakes.
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {addReference} from '../../core/artifacts.ts';
import {adoptEpisode, getEpisode, saveEpisode} from '../../core/episodes.ts';
import {makeHandlers, type HandlerEnv} from '../../core/handlers.ts';
import {OwnerRegistry} from '../../core/proc.ts';
import {JobRunner, type RunnerOptions} from '../../core/runner.ts';
import {setComponent} from '../../core/state.ts';
import {unsupportedInputs} from '../../core/support.ts';
import {captureRenderSources, mixParamsValue, timelineLogicValue, versionsValue, voiceRuntimeValue} from '../../core/toolchain.ts';
import {ModelHost} from '../../core/worker.ts';
import {newProject, type Clock, type TestProject} from './helpers.ts';

export const REPO = process.cwd();
export const EP = 'join-fanout';
export const FAKE_AUDIO = join(REPO, 'tests/store/fake-worker.py');
export const FAKE_RENDER = join(REPO, 'tests/store/fake-render-worker.ts');
export const MIX = join(REPO, 'workers/mix.py');
export const realClock = (): Clock => ({t: 0, now: () => Date.now(), advance: () => {}});
const py = process.env.PYTHON ?? 'python3';

/** A tiny stand-in for the checkout, for tests that change render sources. */
export function makeCheckout(): string {
  const root = mkdtempSync(join(tmpdir(), 'studio-checkout-'));
  const files: Record<string, string> = {
    'src/index.ts': 'export {};\n', 'src/theme.ts': 'export const C = 1;\n', 'src/scenes/a.tsx': 'export const A = 1;\n', 'package.json': '{"name":"x"}\n', 'public/assets/a.txt': 'asset a\n',
    'node_modules/remotion/package.json': '{"version":"4.0.536"}\n', 'node_modules/@remotion/renderer/package.json': '{"version":"4.0.536"}\n',
  };
  for (const [f, text] of Object.entries(files)) { mkdirSync(join(root, f, '..'), {recursive: true}); writeFileSync(join(root, f), text); }
  return root;
}
export const removeCheckout = (root: string) => { if (root.includes('studio-checkout-')) rmSync(root, {recursive: true, force: true}); };

export type Settings = {aligner?: 'estimated' | 'aligned'; voiceGainDb?: number; crf?: number; lufs?: number; audioWorker?: string; mixScript?: string};

/** Record every setting a final production needs, as the product does: values plus hashes of what is executed. */
export function recordSettings(t: TestProject, sourceRoot: string, s: Settings = {}): void {
  const {p} = t;
  captureRenderSources(p, sourceRoot);
  setComponent(p, 'voiceRuntime', voiceRuntimeValue(p, {profile: 'pip-voice-v1', repo: 'fake/model', revision: 'rev-1', mlxAudio: '0.0.0', mlx: '0.0.0', maxTokens: 600, audioWorker: s.audioWorker ?? FAKE_AUDIO}));
  setComponent(p, 'aligner', s.aligner === 'aligned' ? {id: 'qwen3-forced-aligner', revision: 'rev-a'} : {id: 'estimated'});
  setComponent(p, 'manualTiming', {});
  setComponent(p, 'soundEvents', []);
  setComponent(p, 'soundAssets', {});
  setComponent(p, 'mixParams', mixParamsValue(s.mixScript ?? MIX, s.voiceGainDb === undefined ? {} : {voiceGainDb: s.voiceGainDb}));
  setComponent(p, 'masteringParams', {lufs: s.lufs ?? -16, true_peak_db: -1.5, lra: 11});
  setComponent(p, 'timelineLogic', timelineLogicValue(REPO));
  setComponent(p, 'versions', versionsValue(sourceRoot, FAKE_RENDER));
  setComponent(p, 'renderSettings', {width: 1080, height: 1920, fps: 30, codec: 'h264', crf: s.crf ?? 18, audio: 'aac'});
}

export function writeReference(t: TestProject, name = 'pip-voice-v1', script = 'Ten times faster.', tone = 0): void {
  const f = join(t.root, `${name}.wav`);
  const b = Buffer.alloc(44 + 4800);
  b.write('RIFF', 0); b.writeUInt32LE(36 + 4800, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(24000, 24); b.writeUInt32LE(48000, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(4800, 40);
  b.writeInt16LE(tone, 44);
  writeFileSync(f, b);
  addReference(t.p, name, f, {script});
}

/** join-fanout with a block boundary after s07, so its one mid-block pause (s07, 0.3 s) ends a block and can be applied. */
export function splitAfterS07(t: TestProject): void {
  const doc = getEpisode(t.p, EP);
  const blocks = doc.narration.blocks.flatMap((b) => {
    const i = b.segments.indexOf('s07');
    return i >= 0 && i < b.segments.length - 1 ? [{id: `${b.id}a`, segments: b.segments.slice(0, i + 1)}, {id: `${b.id}b`, segments: b.segments.slice(i + 1)}] : [b];
  });
  saveEpisode(t.p, EP, {...doc, voice: {engine: 'qwen3-tts', profile: 'pip-voice-v1'}, narration: {...doc.narration, blocks}});
}

export type Fixture = {t: TestProject; r: JobRunner; host: ModelHost; env: HandlerEnv; blocks: string[]};
export function fixture(o: Settings & {sourceRoot?: string; runner?: Partial<RunnerOptions>; project?: TestProject} = {}): Fixture {
  const t = o.project ?? newProject({clock: realClock()});
  if (!o.project) {
    adoptEpisode(t.p, `episodes/${EP}/episode.json`);
    writeReference(t);
    splitAfterS07(t);
    recordSettings(t, o.sourceRoot ?? REPO, o);
  }
  const reg = new OwnerRegistry(t.p.db, t.p.now);
  const host = new ModelHost(reg, {cmd: py, args: [o.audioWorker ?? FAKE_AUDIO], rssThresholdBytes: 800 * 2 ** 20, killGraceMs: 600});
  const env: HandlerEnv = {root: REPO, qwenPython: '.venv-qwen/bin/python', python: '.venv/bin/python', audioWorker: o.audioWorker ?? FAKE_AUDIO, mixScript: o.mixScript ?? MIX, renderWorker: FAKE_RENDER, ...(o.sourceRoot ? {sourceRoot: o.sourceRoot} : {})};
  const r = new JobRunner(t.p, {pollMs: 80, killGraceMs: 600, host, reg, releaseBefore: (k) => k.startsWith('render.'), preflight: unsupportedInputs, handlers: makeHandlers(env), ...(o.runner ?? {})});
  return {t, r, host, env, blocks: getEpisode(t.p, EP).narration.blocks.map((b) => b.id)};
}
