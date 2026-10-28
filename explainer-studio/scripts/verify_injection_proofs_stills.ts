// Seeking and determinism check for the injection presentation proofs: renders the same frames of each treatment in ascending order
// and in a shuffled order (a fresh seek every time) and compares the PNG bytes. The frames stay on disk so the video can be compared with them.
// usage: node scripts/verify_injection_proofs_stills.ts <doc.json> <timeline.json> <outDir>
import {createHash} from 'node:crypto';
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {bundle} from '@remotion/bundler';
import {renderStill, selectComposition} from '@remotion/renderer';
import {passageWindow} from '../src/library/scenes/injection/passage.ts';

const [, , docPath, timelinePath, outDir] = process.argv;
const doc = JSON.parse(readFileSync(docPath, 'utf8'));
const timeline = JSON.parse(readFileSync(timelinePath, 'utf8'));
const win = passageWindow(timeline.segments);
const f0 = Math.round(win.from * 30), f1 = Math.round(win.to * 30) - 1;
const frames = [f0, f0 + 24, f0 + 70, f0 + 120, f0 + 165, f0 + 210, f0 + 250, f0 + 290, f0 + 330, f0 + 370, f1 - 3, f1];
const order = [11, 3, 7, 0, 9, 5, 2, 10, 6, 1, 8, 4];
const root = process.cwd();
const sha = (f: string) => createHash('sha256').update(readFileSync(f)).digest('hex');
const serveUrl = await bundle({entryPoint: `${root}/src/index.ts`, publicDir: `${root}/public`, outDir: '/tmp/vp-bundle'});
const result: Record<string, unknown> = {window: win, frames};
for (const treatment of (process.env.PROOF_NAMES ?? 'baseline,interface,investigation,mechanism').split(',')) {
  const d = structuredClone(doc);
  d.scenes[0].params = treatment === 'baseline' ? {} : {treatment};
  const props = {episode: d.id, variant: 'full', data: {episode: {id: d.id, style: d.style, scenes: d.scenes}, timeline, previewOnly: true}};
  const composition = await selectComposition({serveUrl, id: 'studio-episode', inputProps: props});
  const renderAt = async (frame: number, dir: string) => { const out = `${dir}/${frame}.png`; await renderStill({composition, serveUrl, frame, output: out, inputProps: props, imageFormat: 'png', overwrite: true}); return sha(out); };
  const a = `${outDir}/${treatment}/ascending`, b = `${outDir}/${treatment}/shuffled`;
  mkdirSync(a, {recursive: true}); mkdirSync(b, {recursive: true});
  const t0 = Date.now();
  const asc: Record<number, string> = {}; for (const f of frames) asc[f] = await renderAt(f, a);
  const shuf: Record<number, string> = {}; for (const i of order) shuf[frames[i]] = await renderAt(frames[i], b);
  const same = frames.filter((f) => asc[f] === shuf[f]).length;
  result[treatment] = {frames: frames.length, identicalAfterShuffle: same, ms: Date.now() - t0, sha256: asc};
  console.log(treatment, `${same}/${frames.length} identical after a shuffled seek order`);
}
writeFileSync(`${outDir}/stills.json`, JSON.stringify(result, null, 1));
