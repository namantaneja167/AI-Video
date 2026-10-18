// Node-side check that the bundled fonts are present and unchanged, and that each one's licence file is next to it.
// A missing or altered font is a failure, never a silent fallback to another face.
import {createHash} from 'node:crypto';
import {existsSync, readFileSync} from 'node:fs';
import {join} from 'node:path';

type Entry = {family: string; file: string; sha256: string; license: string; licenseFile: string; licenseSha256: string};
const sha = (p: string) => createHash('sha256').update(readFileSync(p)).digest('hex');

/** Problems with the font directory (public/library/fonts). Empty means every font and licence is present and matches the manifest. */
export function checkFonts(dir: string): string[] {
  const mf = join(dir, 'manifest.json');
  if (!existsSync(mf)) return ['the font manifest (manifest.json) is missing'];
  const files = (JSON.parse(readFileSync(mf, 'utf8')) as {files: Entry[]}).files;
  const out: string[] = [];
  for (const f of files) {
    for (const [what, name, want] of [['font', f.file, f.sha256], ['licence', f.licenseFile, f.licenseSha256]] as const) {
      const p = join(dir, name);
      if (!existsSync(p)) out.push(`${f.family}: ${what} file ${name} is missing`);
      else if (sha(p) !== want) out.push(`${f.family}: ${what} file ${name} differs from the manifest`);
    }
  }
  return out;
}
