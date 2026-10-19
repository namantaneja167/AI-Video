// Measure one build of a workspace episode, and keep the two kinds of check apart:
//   - final output (loudness, peak, lag, duration): measured on the build's own MP4 and mastered mix;
//   - voice-only placement: measured on the build's takes placed on the build's layout with no accents and no mastering,
//     rebuilt here from the exact saved takes (no narration is generated, nothing in the workspace is changed).
//
//   node scripts/phase4_measure_build.ts --workspace <dir> --episode <id> --out <dir> [--build b<timing>-<mix>-<render>] [--mp4-name <file>]
//
// Without --build the build that matches the episode's current timing, mix and video is used.
import {execFileSync} from 'node:child_process';
import {copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {pickDefault, listBuilds} from '../app/builds.ts';
import {getSnapshot, statusReport} from '../core/artifacts.ts';
import {blobPath} from '../core/blobs.ts';
import {get} from '../core/db.ts';
import {sha256File} from '../core/hash.ts';
import {Project} from '../core/project.ts';
import {planLayout, wavDuration} from '../core/timeline.ts';
import {mixScriptFingerprint, defaultTools} from '../core/toolchain.ts';
import type {EpisodeV2} from '../src/schema2.ts';

const root = resolve(import.meta.dirname, '..');
const arg = (name: string): string | undefined => { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : undefined; };
const workspace = resolve(arg('workspace') ?? '');
const episodeId = arg('episode') ?? '';
const out = resolve(arg('out') ?? '');
if (!arg('workspace') || !episodeId || !arg('out')) throw new Error('usage: phase4_measure_build.ts --workspace <dir> --episode <id> --out <dir> [--build <id>]');

const p = Project.open(workspace);
try {
  const builds = listBuilds(p, episodeId);
  const status = statusReport(p, episodeId);
  const build = arg('build') ? builds.find((b) => b.id === arg('build')) : pickDefault(builds, status);
  if (!build) throw new Error(`no such build: ${arg('build') ?? '(current)'}`);
  if (build.render?.kind !== 'final') throw new Error(`build ${build.id} has no final video to measure`);
  const artifact = (id: number) => get<{blob_hash: string; snapshot_id: string | null; meta_json: string}>(p.db.prepare('SELECT blob_hash, snapshot_id, meta_json FROM artifacts WHERE id=?'), id)!;
  const timing = artifact(build.timingId);
  const mix = artifact(build.mixId);
  if (!mix.snapshot_id) throw new Error(`mix ${build.mixId} has no recorded inputs (it was not built by this workspace); the layout cannot be rebuilt exactly`);

  // The mix's own recorded inputs: the document it saw, the takes it placed, its parameters.
  const snap = getSnapshot(p, mix.snapshot_id);
  const doc = JSON.parse(readFileSync(blobPath(p, snap.docBlob), 'utf8')) as EpisodeV2;
  const takeFiles: Record<string, string> = {};
  for (const b of doc.narration.blocks) {
    const hash = snap.blobs.takes[b.id];
    if (!hash) throw new Error(`the mix recorded no take for block "${b.id}"`);
    takeFiles[b.id] = blobPath(p, hash);
  }
  const layout = planLayout(doc, Object.fromEntries(Object.entries(takeFiles).map(([id, f]) => [id, wavDuration(f).seconds])));
  const mixMeta = JSON.parse(mix.meta_json) as {durationSec?: number; used?: {voiceGainDb?: number; mixScriptSha256?: string}};
  if (mixMeta.durationSec !== undefined && Math.abs(mixMeta.durationSec - layout.totalSec) > 0.0005) throw new Error(`the rebuilt layout is ${layout.totalSec} s but the mix was ${mixMeta.durationSec} s: the recorded inputs do not reproduce it`);
  const tools = defaultTools(root);
  if (mixMeta.used?.mixScriptSha256 && mixMeta.used.mixScriptSha256 !== mixScriptFingerprint(tools.mix)) throw new Error('the mix script changed since this mix was made; its layout cannot be reproduced exactly');
  const params = snap.componentValues as {masteringParams?: {lufs: number; true_peak_db: number}; soundEvents?: unknown[]} | undefined;
  const mastering = params?.masteringParams;
  if (!mastering) throw new Error('the mix recorded no mastering targets');

  mkdirSync(out, {recursive: true});
  const voiceOnly = join(out, 'voice-only-placement.wav');
  if (existsSync(voiceOnly)) rmSync(voiceOnly, {force: true});
  const python = join(root, '.venv-qwen', 'bin', 'python');
  const facts = JSON.parse(execFileSync(python, [tools.mix], {
    encoding: 'utf8',
    input: JSON.stringify({out: voiceOnly, total_sec: layout.totalSec, gain_db: mixMeta.used?.voiceGainDb ?? 0, blocks: layout.blocks.map((b) => ({wav: takeFiles[b.id], offset_sec: b.offsetSec})), master: null, accents: []}),
  })) as {samples: number; sample_rate: number; mode: string};

  const mp4 = join(out, arg('mp4-name') ?? `${episodeId}_${build.id}.mp4`);
  const wav = join(out, 'mastered-mix.wav');
  const tlf = join(out, 'timeline.json');
  for (const f of [mp4, wav, tlf]) if (existsSync(f)) rmSync(f, {force: true});
  copyFileSync(blobPath(p, build.render.blobHash), mp4);
  copyFileSync(blobPath(p, mix.blob_hash), wav);
  copyFileSync(blobPath(p, timing.blob_hash), tlf);

  const measured = join(out, 'measurements.json');
  const stdout = execFileSync(python, [join(root, 'scripts', 'phase2_measure.py'), mp4, wav, tlf, measured, String(mastering.lufs), String(mastering.true_peak_db)], {encoding: 'utf8', env: {...process.env, PLACEMENT_WAV: voiceOnly}});
  const result = JSON.parse(readFileSync(measured, 'utf8'));
  // What the voice-only file was made from, so the placement result can be traced to exact inputs.
  result.voice_only_placement.reconstruction = {
    build: build.id, mixArtifact: build.mixId, timingArtifact: build.timingId, renderArtifact: build.render.id,
    takes: layout.blocks.map((b) => ({block: b.id, blob: snap.blobs.takes[b.id], offsetSec: b.offsetSec, durationSec: b.durationSec, sha256: sha256File(takeFiles[b.id]).hash})),
    totalSec: layout.totalSec, voiceGainDb: mixMeta.used?.voiceGainDb ?? 0, mixScriptSha256: mixMeta.used?.mixScriptSha256 ?? null,
    accents: 0, mastering: null, samples: facts.samples, sampleRate: facts.sample_rate,
    note: 'Rebuilt with the same mix script from this build\'s saved takes and recorded layout; no narration was generated.',
    mixHadAccents: Array.isArray(params?.soundEvents) ? params!.soundEvents!.length : null,
  };
  writeFileSync(measured, JSON.stringify(result, null, 2));
  console.log(stdout);
  console.log(`build ${build.id}: ${mp4}`);
} finally {
  p.close();
}
