// Renders still frames from the studio's compositions into a folder. Used for checkpoints and parity measurements.
// Bundles once with the given public dir (never the repo's own), then renders each still. No models are loaded.
//
//   node scripts/phase3_stills.ts <spec.json>
//   spec: {publicDir, stills: [{composition, inputProps, frame, out}]}
import {readFileSync} from 'node:fs';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {bundle} from '@remotion/bundler';
import {renderStill, selectComposition} from '@remotion/renderer';

type Spec = {publicDir: string; stills: {composition: string; inputProps: Record<string, unknown>; frame: number; out: string}[]};
const spec = JSON.parse(readFileSync(process.argv[2], 'utf8')) as Spec;
const root = resolve(import.meta.dirname, '..');
const outDir = mkdtempSync(join(tmpdir(), 'studio-stills-bundle-'));
const t0 = Date.now();
const serveUrl = await bundle({entryPoint: join(root, 'src', 'index.ts'), publicDir: spec.publicDir, outDir});
console.log(`bundled in ${Date.now() - t0} ms`);
const comps = new Map<string, Awaited<ReturnType<typeof selectComposition>>>();
for (const s of spec.stills) {
  const key = s.composition + JSON.stringify(s.inputProps).length + s.composition;
  let comp = comps.get(key);
  if (!comp) { comp = await selectComposition({serveUrl, id: s.composition, inputProps: s.inputProps}); comps.set(key, comp); }
  await renderStill({composition: comp, serveUrl, output: s.out, frame: s.frame, inputProps: s.inputProps, imageFormat: 'png', overwrite: true});
}
console.log(`rendered ${spec.stills.length} stills in ${Date.now() - t0} ms`);
rmSync(outDir, {recursive: true, force: true});
process.exit(0);
