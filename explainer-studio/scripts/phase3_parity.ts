// Prototype parity, part A: the frozen prototype scene (PipScene10x, unchanged) rendered
//   (1) live, through its own composition `pip-scene-10x`;
//   (2) through the new library composition `studio-episode`, as a registered custom scene, with the prototype's
//       ORIGINAL timing, audio and authored performance.
// plus frames of the preserved prototype MP4. Writes stills into <out>; compare with scripts/phase3_compare.py.
// Reads the repo; writes only to a temp public dir and <out>. Protected folders are read, never modified.
//
//   node scripts/phase3_parity.ts --out <dir> [--pipeline <dir of a phase3_run output>]
//
// With --pipeline, the same frames are also rendered from the pipeline's own timeline (aligned words, cues from the rules) as
// `pipe-*.png`, and taken from its final MP4 as `pmp4-*.png`, so differences caused by alignment can be separated.
import {execFileSync} from 'node:child_process';
import {cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';

const root = resolve(import.meta.dirname, '..');
const arg = (n: string) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : undefined; };
const PIPE = arg('--pipeline') ? resolve(arg('--pipeline')!) : undefined;
const OUT = resolve(arg('--out') ?? join(root, 'out', 'phase3', 'parity-original'));
mkdirSync(OUT, {recursive: true});

const orig = JSON.parse(readFileSync(join(root, 'public/scenes/pip-10x/timing.json'), 'utf8'));
const c = orig.cues as Record<string, number>;
// representative frames: start, one just after each major beat, the middle and the last frame
const times: [string, number][] = [
  ['start', 0], ['card_in', c.card_in + 0.5], ['claim', c.claim + 0.5], ['sub', c.sub + 0.3], ['bars', c.bars + 0.8], ['notice', c.notice + 0.3],
  ['point', c.point + 0.6], ['callout', c.callout + 0.7], ['callout_text', c.callout_text + 0.5], ['contrast', c.contrast + 0.8],
  ['palms', c.palms + 0.5], ['resolve1', c.resolve1 + 0.6], ['resolve2', c.resolve2 + 0.8], ['end', orig.durationSec - 1 / 30],
];
const frames = times.map(([n, t]) => [n, Math.min(orig.frames - 1, Math.round(t * orig.fps))] as [string, number]);

const pub = mkdtempSync(join(tmpdir(), 'studio-p3-parity-'));
mkdirSync(join(pub, 'scenes', 'pip-10x'), {recursive: true});
cpSync(join(root, 'public/scenes/pip-10x'), join(pub, 'scenes', 'pip-10x'), {recursive: true});
cpSync(join(root, 'public/library'), join(pub, 'library'), {recursive: true});
mkdirSync(join(pub, 'generated', 'pip-10x', 'full'), {recursive: true});
cpSync(join(root, 'public/library/silence.wav'), join(pub, 'generated', 'pip-10x', 'full', 'audio.wav')); // the scene plays its own original audio

const data = {
  episode: {id: 'pip-10x', style: 'pip-paper', scenes: [{id: 'pip', type: 'pip-scene-10x', params: {}, layout: {template: 'card-over-pip'}, segments: orig.segments.map((s: any) => s.id)}]},
  timeline: {version: 1, durationSec: orig.durationSec, audio: 'audio.wav', segments: orig.segments.map((s: any) => ({id: s.id, start: s.start, end: s.end, words: []})), captions: [], chapters: [],
    scenes: [{id: 'pip', type: 'pip-scene-10x', start: 0, end: orig.durationSec}]},
  sceneData: {pip: {timing: orig}},
};
const stills: {composition: string; inputProps: Record<string, unknown>; frame: number; out: string}[] = frames.flatMap(([name, frame]) => [
  {composition: 'pip-scene-10x', inputProps: {timing: null}, frame, out: join(OUT, `live-${name}.png`)},
  {composition: 'studio-episode', inputProps: {episode: 'pip-10x', variant: 'full', data}, frame, out: join(OUT, `lib-${name}.png`)},
]);
if (PIPE) {
  const tl = JSON.parse(readFileSync(join(PIPE, 'timeline.json'), 'utf8'));
  const ep = JSON.parse(readFileSync(join(root, 'samples/pip-10x-pipeline/episode.json'), 'utf8'));
  mkdirSync(join(pub, 'generated', 'pip-10x-pipeline', 'full'), {recursive: true});
  cpSync(join(root, 'public/library/silence.wav'), join(pub, 'generated', 'pip-10x-pipeline', 'full', tl.audio));
  const pdata = {episode: {id: ep.id, style: ep.style, scenes: ep.scenes}, timeline: tl};
  for (const [name, frame] of frames) stills.push({composition: 'studio-episode', inputProps: {episode: ep.id, variant: 'full', data: pdata}, frame, out: join(OUT, `pipe-${name}.png`)});
  for (const [name, frame] of frames) execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', join(PIPE, `${ep.id}_final.mp4`), '-vf', `select=eq(n\\,${frame})`, '-vframes', '1', join(OUT, `pmp4-${name}.png`)]);
}
const spec = join(pub, 'spec.json');
writeFileSync(spec, JSON.stringify({publicDir: pub, stills}));
for (const [name, frame] of frames) {
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', join(root, 'out/pip_scene_10x_v1.mp4'), '-vf', `select=eq(n\\,${frame})`, '-vframes', '1', join(OUT, `mp4-${name}.png`)]);
}
writeFileSync(join(OUT, 'frames.json'), JSON.stringify(frames));
execFileSync('node', [join(root, 'scripts/phase3_stills.ts'), spec], {stdio: 'inherit'});
rmSync(pub, {recursive: true, force: true}); // the temp public dir this script made
console.log(`stills in ${OUT}`);
