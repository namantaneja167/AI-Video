// A seeded workspace whose recorded workers are the test fakes (no models, no browser), plus the real job service on it.
// The real handlers, runner, timeline logic and mixer run; only the audio model and the video renderer are stand-ins.
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {ROOT, seedDemo} from '../../app/demo.ts';
import {baselineSources} from '../baseline-sources.ts';
import {JobService, type JobServiceOptions} from '../../app/jobs.ts';
import {getEpisode, getEpisodeInfo, saveEpisode} from '../../core/episodes.ts';
import type {HandlerEnv} from '../../core/handlers.ts';
import {Project} from '../../core/project.ts';
import {setComponent} from '../../core/state.ts';
import {versionsValue, voiceRuntimeValue} from '../../core/toolchain.ts';
import type {EpisodeV2} from '../../src/schema2.ts';
import {setSegmentText} from '../../app/shared/edit.ts';

export const EP = 'context-window';
export const FAKE_AUDIO = resolve(ROOT, 'tests/store/fake-worker.py');
export const FAKE_RENDER = resolve(ROOT, 'tests/store/fake-render-worker.ts');
export const FAKE_PROBE = resolve(ROOT, 'tests/store/fake-probe-worker.ts');

export const fakeEnv = (extra: Partial<HandlerEnv> = {}): HandlerEnv => ({
  root: ROOT, qwenPython: resolve(ROOT, '.venv-qwen/bin/python'), python: resolve(ROOT, '.venv/bin/python'), audioWorker: FAKE_AUDIO, renderWorker: FAKE_RENDER, probeWorker: FAKE_PROBE, renderConcurrency: 1, ...extra,
});

/** Record the fake workers as the workspace's tools, the way the product records the real ones. */
export function recordFakeTools(p: Project): void {
  setComponent(p, 'voiceRuntime', voiceRuntimeValue(p, {profile: 'pip-voice-v1', repo: 'fake/model', revision: 'rev-1', mlxAudio: '0.0.0', mlx: '0.0.0', maxTokens: 600, audioWorker: FAKE_AUDIO}));
  setComponent(p, 'aligner', {id: 'estimated'});
  setComponent(p, 'versions', versionsValue(ROOT, FAKE_RENDER));
}

export const jobOptions = (p: Project, projectRoot: string, extra: Partial<JobServiceOptions> = {}): JobServiceOptions => ({
  project: p, env: fakeEnv(), workerPython: process.env.PYTHON ?? 'python3', measuredFile: join(projectRoot, 'measured-runs.json'), idleShutdownMs: 60_000,
  runner: {pollMs: 80, killGraceMs: 600, memory: undefined}, host: {rssThresholdBytes: 800 * 2 ** 20, killGraceMs: 600}, ...extra,
});

export type FakeWorkspace = {tmp: string; projectRoot: string; p: Project; svc: JobService; close(): Promise<void>};

/** A fresh seeded workspace with fake tools. Its baseline builds are the imported ones until the first rebuild. */
export function fakeWorkspace(extra: Partial<JobServiceOptions> = {}): FakeWorkspace {
  const tmp = mkdtempSync(join(tmpdir(), 'studio-jobs-test-'));
  const projectRoot = join(tmp, 'project');
  seedDemo(projectRoot, baselineSources());
  const p = Project.open(projectRoot);
  recordFakeTools(p);
  const svc = new JobService(jobOptions(p, projectRoot, extra));
  return {
    tmp, projectRoot, p, svc,
    close: async () => {
      await svc.shutdown();
      try { p.close(); } catch { /* already closed */ }
      rmSync(tmp, {recursive: true, force: true});
    },
  };
}

// ---- editing helpers (the same edits the browser makes) ---------------------------------------------------------------
export function edit(p: Project, fn: (doc: EpisodeV2) => EpisodeV2): void {
  saveEpisode(p, EP, fn(getEpisode(p, EP)), {baseSeq: getEpisodeInfo(p, EP).seq});
}
/** New words, spoken the same way: the narration changes. */
export const setSpoken = (p: Project, id: string, text: string) => edit(p, (d) => {
  const next = setSegmentText(d, id, text).doc;
  return {...next, narration: {...next.narration, segments: next.narration.segments.map((s) => { if (s.id !== id) return s; const {speech: _s, ...rest} = s; return rest; })}};
});
/** New caption words while the spoken text stays what it was: narration is reused. */
export const setCaptionOnly = (p: Project, id: string, text: string) => edit(p, (d) => {
  const spoken = d.narration.segments.find((s) => s.id === id)!;
  const keep = spoken.speech ?? spoken.text;
  const next = setSegmentText(d, id, text).doc;
  return {...next, narration: {...next.narration, segments: next.narration.segments.map((s) => (s.id === id ? {...s, speech: keep} : s))}};
});
/** What undoing an edit does: the whole segment goes back to exactly what it was (caption line breaks included), which typing the old words
 *  again does not do, because changing a segment's words resets its caption line breaks. */
export const readSegment = (p: Project, id: string) => structuredClone(getEpisode(p, EP).narration.segments.find((s) => s.id === id)!);
export const putSegmentBack = (p: Project, segment: ReturnType<typeof readSegment>) => edit(p, (d) => ({...d, narration: {...d.narration, segments: d.narration.segments.map((s) => (s.id === segment.id ? segment : s))}}));
export const segmentText = (p: Project, id: string) => getEpisode(p, EP).narration.segments.find((s) => s.id === id)!.text;

export async function until<T>(what: string, fn: () => T | undefined | false, ms = 60_000): Promise<T> {
  const t0 = Date.now();
  for (;;) {
    const v = fn();
    if (v) return v as T;
    if (Date.now() - t0 > ms) throw new Error(`timed out after ${ms} ms waiting for: ${what}`);
    await new Promise((r) => setTimeout(r, 60));
  }
}
export const rebuildState = (svc: JobService, id: string) => svc.rebuilds(EP, 20).find((r) => r.id === id)?.state;
export const waitRebuild = (svc: JobService, id: string, states: string[], ms = 90_000) => until(`rebuild ${id} to be ${states.join(' or ')}`, () => { const s = rebuildState(svc, id); return s && states.includes(s) ? s : undefined; }, ms);
let n = 0;
export const requestId = () => `req-${Date.now().toString(36)}-${++n}`;
