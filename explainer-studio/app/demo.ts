// The persistent demo workspace: a real project store, separate from any real project, seeded once from the
// context-window revision 2 outputs and the saved narration takes. It is never deleted on exit and never overwritten on
// restart; replacing it is an explicit command (`./studio-app reset-demo --yes`) that moves the old one aside first.
import {copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {finishJob, startJob, statusReport} from '../core/artifacts.ts';
import {putFile} from '../core/blobs.ts';
import {adoptEpisode} from '../core/episodes.ts';
import {sha256File} from '../core/hash.ts';
import {Project} from '../core/project.ts';
import {setComponent} from '../core/state.ts';
import {defaultTools, mixParamsValue} from '../core/toolchain.ts';
import type {MeasuredRuns} from './shared/costs.ts';
import {ROOT, configureProject} from './workspace.ts';

export {ROOT};
export const DEMO_DIR = join(ROOT, 'demo-workspace');
export const DEMO_PROJECT = join(DEMO_DIR, 'pip-context-window');
export const DEMO_EPISODE = 'context-window';

const REV2 = join(ROOT, 'out/phase3/context-window-rev2');
const REV1 = join(ROOT, 'out/phase3/context-window-rev1');
export const SOURCES = {
  episode: join(ROOT, 'samples/context-window/episode.json'),
  settings: join(ROOT, 'samples/context-window/settings.json'),
  takes: {b1: join(REV2, 'takes/take-b1.wav'), b2: join(REV2, 'takes/take-b2.wav')},
  timeline: join(REV2, 'timeline.json'),
  mix: join(REV2, 'mastered-mix.wav'),
  video: join(REV2, 'context-window_final.mp4'),
  report2: join(REV2, 'validation-report.json'),
  report1: join(REV1, 'validation-report.json'),
};

export const demoExists = (): boolean => existsSync(join(DEMO_PROJECT, '.studio', 'project.sqlite'));

export function openDemo(): Project {
  if (!demoExists()) throw new Error(`the demo workspace does not exist yet (${DEMO_PROJECT}); start the app once to create it`);
  return Project.open(DEMO_PROJECT);
}

/** Creates the demo from the saved outputs. Refuses to run over an existing demo. */
export type BaselineSources = typeof SOURCES;

export function seedDemo(target = DEMO_PROJECT, sources: BaselineSources = SOURCES): {root: string} {
  if (existsSync(target)) throw new Error(`${target} already exists; it is never overwritten. Use "reset-demo --yes" to move it aside and start again.`);
  const missing = Object.values({...sources, ...sources.takes}).filter((f) => typeof f === 'string' && !existsSync(f));
  if (missing.length) throw new Error(`cannot seed the demo: missing ${missing.join(', ')}. They are saved outputs (not part of the source), restored from the recovery backup (../backups/pip-baseline-phase3-rev2). To work without the demo, make your own project: ./studio-app new <folder>.`);

  const settings = JSON.parse(readFileSync(sources.settings, 'utf8'));
  const report2 = JSON.parse(readFileSync(sources.report2, 'utf8'));
  const report1 = JSON.parse(readFileSync(sources.report1, 'utf8'));

  mkdirSync(join(target, 'episodes', DEMO_EPISODE), {recursive: true});
  copyFileSync(sources.episode, join(target, 'episodes', DEMO_EPISODE, 'episode.json'));
  const p = Project.open(target, {create: true});
  try {
    adoptEpisode(p, `episodes/${DEMO_EPISODE}/episode.json`);
    configureProject(p);
    const tools = defaultTools(ROOT);
    // the baseline's own sound configuration, recorded for it alone (the same values and hashes it was built with)
    setComponent(p, 'soundEvents', settings.soundEvents ?? [], DEMO_EPISODE);
    setComponent(p, 'mixParams', mixParamsValue(tools.mix, settings.mixParams ?? {}), DEMO_EPISODE);

    const imported = (file: string, what: string) => ({from: file.replace(ROOT + '/', ''), sha256: sha256File(file).hash, note: `${what} imported from the revision 2 outputs; it was not built by this workspace`});
    const record = (jobKind: any, subject: string | undefined, file: string, meta: Record<string, unknown>, seed?: number) => {
      const {jobId} = startJob(p, {episodeId: DEMO_EPISODE, jobKind, subject});
      const {hash} = putFile(p, file);
      return finishJob(p, jobId, {blobHash: hash, meta: {...meta, imported: imported(file, jobKind)}, seed});
    };
    const takeSeeds = (report2.takeMeta ?? []) as {seed?: number}[];
    record('tts.block', 'b1', sources.takes.b1, {}, takeSeeds[0]?.seed ?? 0);
    record('tts.block', 'b2', sources.takes.b2, {}, takeSeeds[1]?.seed ?? 0);
    record('timing.build', undefined, sources.timeline, {source: report2.timingMeta?.source ?? 'qwen-aligned'});
    record('mix.final', undefined, sources.mix, {measured: report2.mixMeta?.measured, mastering: report2.mixMeta?.mastering});
    record('render.final', undefined, sources.video, {measurements: 'see the revision 2 measurements'});

    const runs: MeasuredRuns['runs'] = [];
    const add = (report: any, tag: string, when: string, narration = true) => {
      const s = report.stageSeconds ?? {};
      const put = (label: string, kind: string, subject: string, note?: string) => { if (typeof s[label] === 'number') runs.push({kind, subject, seconds: s[label], source: `${tag} (${when})`, when, note}); };
      if (narration) {
        put('narration b1', 'take', 'b1', 'wall time including loading the voice model');
        put('narration b2', 'take', 'b2', 'wall time including loading the voice model');
      }
      put('timing (aligner)', 'timing', 'timeline');
      put('mix final (mastering)', 'mix', 'final');
      put('render final', 'render', 'final');
    };
    add(report1, 'revision 1 run of the context-window sample', new Date(report1.when ?? Date.now()).toISOString().slice(0, 10));
    add(report2, 'revision 2 run of the context-window sample', new Date(report2.when ?? Date.now()).toISOString().slice(0, 10), false); // its takes were imported, not generated
    const measured: MeasuredRuns = {version: 1, runs};
    writeFileSync(join(target, 'measured-runs.json'), JSON.stringify(measured, null, 2));

    const st = statusReport(p, DEMO_EPISODE);
    const bad = [...Object.entries(st.takes), ['timing', st.timing], ['mix final', st.mix.final], ['render final', st.render.final]].filter(([, e]: any) => e.status !== 'fresh');
    if (bad.length) throw new Error(`the seeded demo is not fresh: ${bad.map(([n, e]: any) => `${n}: ${e.status} (${e.reasons.join('; ')})`).join(' | ')}`);

    if (target === DEMO_PROJECT) writeFileSync(join(DEMO_DIR, 'README.txt'), `Demo workspace for the Explainer Studio app (slice 1).

${DEMO_PROJECT}
  A real project store (SQLite + blobs), created on ${new Date().toISOString()} from the context-window revision 2 outputs and the
  saved narration takes. Your edits in the app are committed here and are kept between runs. It is git-ignored and is NOT the real project.

Reopen it:      ./studio-app           (from explainer-studio/)
Start over:     ./studio-app reset-demo --yes   (moves this workspace aside to a "replaced" folder first; nothing is deleted)
Real projects:  not available yet (init/adopt is paused).
`);
    writeFileSync(join(target, 'DEMO-SEED.json'), JSON.stringify({createdAt: new Date().toISOString(), seededFrom: Object.fromEntries(Object.entries({...sources, ...sources.takes}).filter(([, v]) => typeof v === 'string').map(([k, v]) => [k, (v as string).replace(ROOT + '/', '')]))}, null, 2));
  } catch (e) {
    p.close();
    rmSync(target, {recursive: true, force: true}); // only the half-built workspace this call just created
    throw e;
  }
  p.close();
  return {root: target};
}

/** Explicit reset: the existing workspace is renamed, never deleted, then a fresh one is seeded. */
export function resetDemo(): {movedTo: string | null; root: string} {
  let movedTo: string | null = null;
  if (existsSync(DEMO_PROJECT)) {
    movedTo = `${DEMO_PROJECT}.replaced-${new Date().toISOString().replace(/[:.]/g, '-')}`;
    renameSync(DEMO_PROJECT, movedTo);
  }
  return {movedTo, root: seedDemo().root};
}

export function readMeasuredRuns(projectRoot: string): MeasuredRuns | null {
  const f = join(projectRoot, 'measured-runs.json');
  return existsSync(f) ? (JSON.parse(readFileSync(f, 'utf8')) as MeasuredRuns) : null;
}
