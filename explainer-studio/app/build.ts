// Builds the browser bundle (explicit step, as in docs/studio/04-architecture.md): app/ui/main.tsx -> app/dist/app.js + app.css.
import {mkdirSync, writeFileSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {build} from 'esbuild';

export const DIST = resolve(import.meta.dirname, 'dist');

export async function buildUi(outDir = DIST): Promise<void> {
  mkdirSync(outDir, {recursive: true});
  await build({
    entryPoints: [resolve(import.meta.dirname, 'ui/main.tsx')],
    outdir: outDir, entryNames: 'app', bundle: true, format: 'esm', target: 'es2022', jsx: 'automatic', minify: false, sourcemap: false,
    loader: {'.css': 'css'}, logLevel: 'warning', define: {'process.env.NODE_ENV': '"production"'},
  });
  writeFileSync(join(outDir, 'index.html'), `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Explainer Studio</title><link rel="stylesheet" href="/app.css"></head>
<body><div id="root"></div><script type="module" src="/app.js"></script></body></html>
`);
}

if (import.meta.main) {
  await buildUi();
  console.log(`built ${DIST}`);
}
