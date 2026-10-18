import {mkdtempSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

export const ROOT = join(import.meta.dirname, '..');
export const FIXTURES = join(ROOT, 'tests', 'fixtures');

export const readJson = <T = any>(...parts: string[]): T => JSON.parse(readFileSync(join(ROOT, ...parts), 'utf8'));
export const fixture = <T = any>(name: string): T => JSON.parse(readFileSync(join(FIXTURES, name), 'utf8'));

/** JSON round trip, so zod output compares equal to JSON read from disk. */
export const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value));

const made: string[] = [];
process.on('exit', () => { for (const d of made) rmSync(d, {recursive: true, force: true}); });
/** A temporary folder that is removed when the test process exits. */
export const mkTmp = (prefix: string): string => {
  const d = mkdtempSync(join(tmpdir(), prefix));
  made.push(d);
  return d;
};
