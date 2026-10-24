// What a job needs from the working checkout, recorded when settings are made and verified when a job runs.
// Settings live in the job snapshot; code that is executed from the checkout (workers, timeline logic, render sources)
// cannot be frozen in Phase 2, so each job refuses to run if the checkout no longer matches what was recorded.
import {execFileSync} from 'node:child_process';
import {existsSync, readdirSync, readFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import type {SnapshotManifest} from './artifacts.ts';
import {getReference} from './artifacts.ts';
import {readBlob} from './blobs.ts';
import {UNSET} from './deps.ts';
import {sha256, sha256File} from './hash.ts';
import type {Project} from './project.ts';
import {captureFileSet, setComponent} from './state.ts';

export const fileSha = (path: string): string => sha256File(path).hash;

export type ToolPaths = {audioWorker: string; mix: string; renderWorker: string; probeWorker: string; stillWorker: string; timeline: string[]};
export const defaultTools = (root: string): ToolPaths => ({
  audioWorker: join(root, 'workers/audio_worker.py'),
  mix: join(root, 'workers/mix.py'),
  renderWorker: join(root, 'workers/render-worker.ts'),
  probeWorker: join(root, 'workers/probe-worker.ts'),
  stillWorker: join(root, 'workers/still-worker.ts'),
  timeline: ['pipeline/timeline.py', 'pipeline/timeline_cli.py', 'core/timeline.ts', 'workers/mouth.py', 'src/library/cues.ts', 'src/library/sceneSpecs.ts'].map((f) => join(root, f)),
});

/** Hashes of the files that produce timelines, keyed by path relative to the root. */
export const timelineLogicValue = (root: string, files = defaultTools(root).timeline) =>
  Object.fromEntries(files.map((f) => [f.slice(root.length + 1), fileSha(f)]));

export type VoiceRuntimeInput = {profile: string; repo: string; revision: string; mlxAudio: string; mlx: string; maxTokens: number; audioWorker: string};
/** Everything that decides how a take sounds: model, versions, the approved reference and its exact transcript, generation limits. */
export function voiceRuntimeValue(p: Project, o: VoiceRuntimeInput) {
  const ref = getReference(p, o.profile);
  if (typeof ref.meta.script !== 'string') throw new Error(`approved reference "${o.profile}" has no recorded transcript`);
  return {
    engine: 'qwen3-tts', model: o.repo, revision: o.revision, mlxAudio: o.mlxAudio, mlx: o.mlx, profile: o.profile,
    referenceSha256: ref.hash, referenceTranscriptSha256: sha256(ref.meta.script),
    generation: {maxTokens: o.maxTokens, sampling: 'library defaults of the pinned mlx-audio (not overridden by this project)'},
    workerSha256: fileSha(o.audioWorker),
  };
}

/** The mix script and the accent synthesizer next to it (if any) count as one thing. */
export const mixScriptFingerprint = (mixScript: string): string => {
  const accents = join(dirname(mixScript), 'accents.py');
  return existsSync(accents) ? sha256(`${fileSha(mixScript)}:${fileSha(accents)}`) : fileSha(mixScript);
};
export const mixParamsValue = (mixScript: string, extra: {voiceGainDb?: number; accentBusDb?: number; accentDuck?: number} = {}) => ({...extra, mixScriptSha256: mixScriptFingerprint(mixScript)});

const installedVersion = (root: string, pkg: string): string => JSON.parse(readFileSync(join(root, 'node_modules', pkg, 'package.json'), 'utf8')).version;
export function versionsValue(root: string, renderWorker: string) {
  return {
    remotion: installedVersion(root, 'remotion'), remotionRenderer: installedVersion(root, '@remotion/renderer'), node: process.version,
    ffmpeg: execFileSync('ffmpeg', ['-version'], {encoding: 'utf8'}).split('\n')[0], renderWorkerSha256: fileSha(renderWorker),
  };
}

// ---- render sources ------------------------------------------------------------------------------------------------
const walk = (root: string, dir: string, skip: (rel: string) => boolean): string[] =>
  readdirSync(join(root, dir), {withFileTypes: true}).flatMap((e) => {
    const rel = `${dir}/${e.name}`;
    if (skip(rel) || e.name === '.DS_Store') return [];
    return e.isDirectory() ? walk(root, rel, skip) : [rel];
  });

/** Source files the render bundle is built from: all of src/ except generated output, plus package and build configuration. */
export const codeFiles = (root: string): string[] =>
  [...walk(root, 'src', (r) => r === 'src/generated'), ...['package.json', 'package-lock.json', 'tsconfig.json', 'remotion.config.ts'].filter((f) => existsSync(join(root, f)))].sort();
/** public/assets, plus public/library (fonts and the silent track the library copies into every render). */
export const assetFiles = (root: string): string[] => ['public/assets', 'public/library'].flatMap((d) => (existsSync(join(root, d)) ? walk(root, d, () => false) : [])).sort();

/** Copy the render sources into the project (so a record of exactly what was rendered exists) and record their hashes. */
export function captureRenderSources(p: Project, root: string): Record<string, {hash: string; files: number}> {
  const out: Record<string, {hash: string; files: number}> = {};
  out.code = captureFileSet(p, 'code', root, codeFiles(root));
  out.theme = captureFileSet(p, 'theme', root, ['src/theme.ts']);
  out.assets = captureFileSet(p, 'assets', root, assetFiles(root));
  setComponent(p, 'fonts', {note: 'system font stack from src/theme.ts; the episode composition loads no font files'});
  return out;
}

/** Differences between the working checkout and the file sets a job was queued against. Empty means they match. */
export function renderSourceProblems(p: Project, snapshot: SnapshotManifest, root: string): string[] {
  const problems: string[] = [];
  const current: Record<string, string[]> = {code: codeFiles(root), theme: ['src/theme.ts'], assets: assetFiles(root)};
  for (const name of ['code', 'theme', 'assets'] as const) {
    const hash = snapshot.components[name];
    if (hash === UNSET) { problems.push(`${name}: no recorded file set`); continue; }
    const manifest = JSON.parse(readBlob(p, hash).toString()) as {files: {path: string; sha256: string}[]};
    const recorded = new Set(manifest.files.map((f) => f.path));
    for (const f of manifest.files) {
      const abs = join(root, f.path);
      if (!existsSync(abs)) problems.push(`${name}: ${f.path} is missing`);
      else if (fileSha(abs) !== f.sha256) problems.push(`${name}: ${f.path} changed`);
    }
    for (const f of current[name]) if (!recorded.has(f)) problems.push(`${name}: ${f} was added`);
  }
  return problems;
}

export function renderToolProblems(root: string, versions: {remotion?: string; remotionRenderer?: string; renderWorkerSha256?: string} | undefined, renderWorker: string): string[] {
  if (!versions) return ['versions: not recorded'];
  const out: string[] = [];
  if (versions.remotion !== installedVersion(root, 'remotion')) out.push(`remotion ${installedVersion(root, 'remotion')} is installed, ${versions.remotion ?? 'nothing'} was recorded`);
  if (versions.remotionRenderer !== installedVersion(root, '@remotion/renderer')) out.push(`@remotion/renderer ${installedVersion(root, '@remotion/renderer')} is installed, ${versions.remotionRenderer ?? 'nothing'} was recorded`);
  if (versions.renderWorkerSha256 !== fileSha(renderWorker)) out.push('the render worker script changed');
  return out;
}
