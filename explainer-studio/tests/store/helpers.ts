// Shared test support. Every project here lives in a fresh temporary folder: destructive recovery, restore and
// cleanup tests must never touch the real studio, so each helper refuses any path outside the system temp dir.
import {cpSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, relative, sep} from 'node:path';
import {putBytes} from '../../core/blobs.ts';
import {finishJob, startJob, type JobKind} from '../../core/artifacts.ts';
import {getEpisode} from '../../core/episodes.ts';
import {captureFileSet, setComponent} from '../../core/state.ts';
import {Project} from '../../core/project.ts';
import {ROOT} from '../helpers.ts';

export function assertTemp(path: string): void {
  const tmp = realpathSync(tmpdir());
  const real = realpathSync(path);
  const rel = relative(tmp, real);
  if (rel.startsWith('..') || rel === '' || real === ROOT || real.startsWith(ROOT + sep)) throw new Error(`refusing to run a destructive test outside the temp dir: ${path}`);
}

const made: string[] = [];
process.on('exit', () => { for (const d of made) rmSync(d, {recursive: true, force: true}); });

export const tempRoot = (prefix = 'studio-p1-'): string => {
  const d = mkdtempSync(join(tmpdir(), prefix));
  assertTemp(d);
  made.push(d);
  return d;
};

export type Clock = {t: number; now: () => number; advance: (ms: number) => void};
export const makeClock = (start = 1_700_000_000_000): Clock => {
  const c = {t: start, now: () => c.t, advance: (ms: number) => { c.t += ms; }};
  return c;
};

/** Copy the repository's real episodes (read-only) into a temp project. */
export function seedEpisodes(root: string, names = ['join-fanout']): void {
  assertTemp(root);
  for (const n of names) {
    mkdirSync(join(root, 'episodes', n), {recursive: true});
    cpSync(join(ROOT, 'episodes', n, 'episode.json'), join(root, 'episodes', n, 'episode.json'));
  }
}

export type TestProject = {p: Project; root: string; clock: Clock; close: () => void};
export function newProject(opts: {seed?: string[] | false; clock?: Clock} = {}): TestProject {
  const root = tempRoot();
  const clock = opts.clock ?? makeClock();
  if (opts.seed !== false) seedEpisodes(root, opts.seed ?? ['join-fanout']);
  const p = Project.open(root, {create: true, now: clock.now});
  const tp: TestProject = {p, root, clock, close: () => { try { tp.p.close(); } catch { /* already closed */ } rmSync(root, {recursive: true, force: true}); }};
  return tp;
}

/** Record every component a final render needs, with a tiny real file set for assets, fonts, code and theme. */
export function setAllComponents(p: Project, root: string): void {
  assertTemp(root);
  const dirs: Record<string, string[]> = {assets: ['art/a.png'], fonts: ['fonts/f.woff2'], code: ['src/a.tsx', 'src/b.ts'], theme: ['src/theme.ts']};
  for (const [name, files] of Object.entries(dirs)) {
    for (const f of files) {
      mkdirSync(join(root, 'work', f, '..'), {recursive: true});
      writeFileSync(join(root, 'work', f), `${name}:${f}:v1`);
    }
  }
  for (const [name, files] of Object.entries(dirs)) captureFileSet(p, name as any, join(root, 'work'), files);
  setComponent(p, 'voiceRuntime', {engine: 'kokoro', model: 'kokoro-0.9', ref: null});
  setComponent(p, 'versions', {remotion: '4.0.536', chrome: 'test'});
  setComponent(p, 'renderSettings', {width: 1080, height: 1920, fps: 30, codec: 'h264', crf: 18, audio: 'aac'});
  setComponent(p, 'aligner', {id: 'estimated'});
  setComponent(p, 'manualTiming', {});
  setComponent(p, 'timelineLogic', {hash: 'logic-v1'});
  setComponent(p, 'soundEvents', []);
  setComponent(p, 'soundAssets', {});
  setComponent(p, 'mixParams', {voiceGain: 0});
}

export const fakeBlob = (p: Project, text: string) => putBytes(p, text).hash;

/** Produce every output through real jobs so everything is fresh. Returns the artifact ids by role. */
export function buildAll(p: Project, episodeId: string, tag = 'a'): Record<string, number> {
  const ids: Record<string, number> = {};
  const run = (jobKind: JobKind, subject: string | undefined, label: string, meta?: Record<string, unknown>, seed = 1) => {
    const {jobId} = startJob(p, {episodeId, jobKind, subject});
    const r = finishJob(p, jobId, {blobHash: fakeBlob(p, `${tag}:${label}`), meta, seed});
    ids[label] = r.artifactId;
    return r;
  };
  for (const b of getEpisode(p, episodeId).narration.blocks) run('tts.block', b.id, `take:${b.id}`);
  run('timing.build', undefined, 'timing');
  run('mix.draft', undefined, 'mix:draft');
  run('mix.final', undefined, 'mix:final');
  run('render.draft', undefined, 'render:draft');
  run('render.final', undefined, 'render:final', {mastered: true});
  return ids;
}

export const SIGNED = {listened: true, watchedPhoneSize: true, customScenesReviewed: true, notesResolved: true};
