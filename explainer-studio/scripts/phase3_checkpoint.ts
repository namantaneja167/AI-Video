// Representative stills of a Pip sample BEFORE any narration or render: the timeline here uses ESTIMATED word timing
// (0.3 s per word, a short pause after punctuation) and a synthetic mouth track. It shows composition and staging only;
// the production timing comes from the real narration and the aligner. No models, no audio.
//
//   node scripts/phase3_checkpoint.ts --episode <episode.json> --out <dir> [--timeline <timeline.json>]
//
// With --timeline, the REAL timeline of an earlier run (aligned words, real mouth track) is used instead of the estimate; its cues and
// emphasis are recomputed from the episode's current rules, so a revised scene can be previewed on real timing without narrating again.
import {execFileSync} from 'node:child_process';
import {cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {annotateTimeline, assembleSegTimings, buildTimelineViaPython, planLayout} from '../core/timeline.ts';
import {EpisodeSchemaV2} from '../src/schema2.ts';
import {timelineEpisode} from '../core/timeline.ts';

const root = resolve(import.meta.dirname, '..');
const arg = (n: string) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : undefined; };
const OUT = resolve(arg('--out') ?? (() => { throw new Error('--out is required'); })());
const doc = EpisodeSchemaV2.parse(JSON.parse(readFileSync(resolve(arg('--episode') ?? (() => { throw new Error('--episode is required'); })()), 'utf8')));
mkdirSync(OUT, {recursive: true});

const fps = 30;
let timeline: any;
if (arg('--timeline')) {
  timeline = JSON.parse(readFileSync(resolve(arg('--timeline')!), 'utf8'));
  delete timeline.cues;
  annotateTimeline(timeline, doc, timeline.mouth);
} else {
  // ---- estimated timing, block by block (times local to the block)
  const blockTimings = doc.narration.blocks.map((b) => {
    let t = 0;
    const segments = b.segments.map((sid) => {
      const text = doc.narration.segments.find((s) => s.id === sid)!.text;
      const start = t;
      const words = text.split(/\s+/).map((w) => {
        const s = t;
        t += 0.3 + Math.min(0.1, w.length * 0.01);
        const e = t;
        if (/[,]$/.test(w)) t += 0.12;
        if (/[.?!]$/.test(w)) t += 0.18;
        return {text: w, start: s, end: e};
      });
      return {id: sid, start, end: words[words.length - 1].end, words};
    });
    return {blockId: b.id, source: 'estimated' as const, segments, durationSec: t};
  });
  const layout = planLayout(doc, Object.fromEntries(blockTimings.map((b) => [b.blockId, b.durationSec])));
  const {segTimings, timingSources, source} = assembleSegTimings(layout, blockTimings);
  const run = async (cmd: string, args: string[], stdin: string) => execFileSync(cmd, args, {input: stdin, encoding: 'utf8', maxBuffer: 1 << 26});
  timeline = await buildTimelineViaPython(run, join(root, '.venv/bin/python'), join(root, 'pipeline/timeline_cli.py'), {episode: timelineEpisode(doc), segTimings, source, variant: 'full', audioDuration: layout.totalSec, timingSources});
  // synthetic mouth: open during words only
  const mouth = Array.from({length: Math.ceil(layout.totalSec * fps)}, (_, f) => {
    const tt = f / fps;
    const w = Object.values(segTimings).flatMap((s) => s.words).find((x) => tt >= x.start && tt < x.end);
    return w ? Math.round((0.35 + 0.35 * Math.abs(Math.sin(tt * 23))) * 1000) / 1000 : 0;
  });
  annotateTimeline(timeline, doc, mouth);
}
writeFileSync(join(OUT, arg('--timeline') ? 'timeline-real.json' : 'timeline-estimated.json'), JSON.stringify(timeline, null, 1));

// ---- frames
const cues = (timeline.cues?.[doc.scenes[0].id] ?? {}) as Record<string, number>;
const want: [string, number][] = [['window_in', 0.6], ['label', 0.9], ['split', 0.6], ['tokens_fly', 1.1], ['history', 0.9], ['history_end', 0.1], ['reply_end', 0.1], ['input_word', 0.35], ['output_word', 0.3], ['share', 0.8], ['full', 0.6], ['leave', 1.4], ['drop', 1.0], ['back', 1.0], ['settled', 0.6]];
const times: [string, number][] = Object.keys(cues).length ? want.filter(([n]) => cues[n] !== undefined).map(([n, dt]) => [n, cues[n] + dt] as [string, number]) : [['mid', timeline.durationSec * 0.5], ['late', timeline.durationSec * 0.85]];
const frames = times.map(([n, t]) => [n, Math.min(Math.ceil(timeline.durationSec * fps) - 1, Math.round(t * fps))] as [string, number]);
frames.push(['end', Math.round(timeline.durationSec * fps) - 1]);

const pub = mkdtempSync(join(tmpdir(), 'studio-p3-cp-'));
cpSync(join(root, 'public/library'), join(pub, 'library'), {recursive: true});
mkdirSync(join(pub, 'generated', doc.id, 'full'), {recursive: true});
cpSync(join(root, 'public/library/silence.wav'), join(pub, 'generated', doc.id, 'full', timeline.audio));
const data = {episode: {id: doc.id, style: doc.style, scenes: doc.scenes}, timeline};
const stills = frames.map(([name, frame]) => ({composition: 'studio-episode', inputProps: {episode: doc.id, variant: 'full', data}, frame, out: join(OUT, `f-${String(frame).padStart(3, '0')}-${name}.png`)}));
writeFileSync(join(pub, 'spec.json'), JSON.stringify({publicDir: pub, stills}));
writeFileSync(join(OUT, 'frames.json'), JSON.stringify(frames));
execFileSync('node', [join(root, 'scripts/phase3_stills.ts'), join(pub, 'spec.json')], {stdio: 'inherit'});
console.log(`estimated duration ${timeline.durationSec}s; ${frames.length} stills in ${OUT}`);
rmSync(pub, {recursive: true, force: true}); // the temp public dir this script made
console.log(JSON.stringify(cues));
