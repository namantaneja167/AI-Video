// The preferred visual benchmark is one exact file. Its record (docs/studio/benchmark/benchmark.json) is checked against the
// file when the file is present. The file is git-ignored output, so a clean checkout does not have it: the test then skips
// and says why (the copy is in the recovery backup).
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {existsSync, readFileSync, statSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {test} from 'node:test';

const ROOT = resolve(import.meta.dirname, '..');
const rec = JSON.parse(readFileSync(join(ROOT, 'docs/studio/benchmark/benchmark.json'), 'utf8')) as {
  preferredVisualBenchmark: {path: string; sha256: string; bytes: number};
  comparedWith: {path: string; sha256: string; bytes?: number}[];
  brandedOpeningReferences: {video: {path: string; sha256: string; bytes: number}; cover: {path: string; sha256: string; bytes: number}};
};

test('the benchmark record is well formed and names the three roles', () => {
  const b = rec.preferredVisualBenchmark;
  assert.equal(b.path, 'out/phase4/slice2/context-window_slice2_rebuilt.mp4');
  assert.match(b.sha256, /^[0-9a-f]{64}$/);
  assert.equal(rec.comparedWith.length, 2);
  assert.match(rec.brandedOpeningReferences.video.sha256, /^[0-9a-f]{64}$/);
  assert.match(rec.brandedOpeningReferences.cover.sha256, /^[0-9a-f]{64}$/);
  for (const c of rec.comparedWith) assert.match(c.sha256, /^[0-9a-f]{64}$/);
});

for (const [name, entry] of [['the preferred benchmark', rec.preferredVisualBenchmark], ...rec.comparedWith.map((c) => [c.path, c] as const), ['the branded caching video', rec.brandedOpeningReferences.video], ['the branded caching cover', rec.brandedOpeningReferences.cover]] as const) {
  const file = join(ROOT, entry.path);
  test(`${name} is byte-for-byte the recorded file`, {skip: !existsSync(file) && `${entry.path} is git-ignored output and is not in this checkout (it is in the recovery backup)`}, () => {
    if (entry.bytes !== undefined) assert.equal(statSync(file).size, entry.bytes);
    assert.equal(createHash('sha256').update(readFileSync(file)).digest('hex'), entry.sha256);
  });
}
