// Bundle a TypeScript/TSX entry for Node with esbuild (a transitive dependency of @remotion/bundler, used only by tests).
import {build} from 'esbuild';
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {mkTmp} from '../helpers.ts';

export async function loadBundled<T = any>(entry: string): Promise<T> {
  const out = await build({entryPoints: [entry], bundle: true, platform: 'node', format: 'esm', write: false, jsx: 'automatic', logLevel: 'silent', loader: {'.ts': 'ts', '.tsx': 'tsx'}});
  const file = join(mkTmp('studio-bundle-'), 'entry.mjs');
  writeFileSync(file, out.outputFiles[0].text);
  return import(pathToFileURL(file).href);
}
