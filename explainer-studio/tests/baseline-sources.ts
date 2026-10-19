// What the seeded demo (and the many tests that use it) is made from: the saved revision 2 outputs when this checkout has them, and otherwise
// stand-ins made here, so the suite also runs in a clean checkout where outputs (out/) do not exist. The stand-ins have the real
// timeline, reports and durations (small data files in tests/fixtures/baseline); only the audio and video are synthetic.
import {copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ROOT, SOURCES, type BaselineSources} from '../app/demo.ts';
import {writeSpeechWav, writeVideo} from './media-fixtures.ts';

const FIX = join(ROOT, 'tests', 'fixtures', 'baseline');
const real = (): boolean => Object.values({...SOURCES, ...SOURCES.takes}).every((f) => typeof f !== 'string' || existsSync(f));
let made: BaselineSources | null = null;

/** True when the stand-ins are in use (the real saved outputs are not in this checkout). */
export const usingSyntheticBaseline = (): boolean => !real();

export function baselineSources(): BaselineSources {
  if (real()) return SOURCES;
  if (made) return made;
  const dir = mkdtempSync(join(tmpdir(), 'studio-synthetic-baseline-'));
  process.on('exit', () => rmSync(dir, {recursive: true, force: true}));
  mkdirSync(join(dir, 'takes'));
  const take = (name: string, seconds: number) => { const f = join(dir, 'takes', name); writeSpeechWav(f, {seconds}); return f; };
  const mix = join(dir, 'mastered-mix.wav');
  writeSpeechWav(mix, {seconds: 24.26, rate: 48000});
  const video = join(dir, 'context-window_final.mp4');
  writeVideo(video, {seconds: 24.28, lufs: -16});
  const timeline = join(dir, 'timeline.json');
  copyFileSync(join(FIX, 'rev2-timeline.json'), timeline);
  const report2 = join(dir, 'validation-report.json');
  copyFileSync(join(FIX, 'rev2-validation-report.json'), report2);
  const report1 = join(dir, 'validation-report-rev1.json');
  copyFileSync(join(FIX, 'rev1-validation-report.json'), report1);
  made = {...SOURCES, takes: {b1: take('take-b1.wav', 9.92), b2: take('take-b2.wav', 10.64)}, timeline, mix, video, report2, report1};
  return made;
}
