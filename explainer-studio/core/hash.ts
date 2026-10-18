import {createHash} from 'node:crypto';
import {closeSync, openSync, readSync} from 'node:fs';
import {stableStringify} from '../src/migrate.ts';

export {stableStringify};
export const sha256 = (data: string | Uint8Array): string => createHash('sha256').update(data).digest('hex');
export const hashJson = (value: unknown): string => sha256(stableStringify(value));

export function sha256File(path: string): {hash: string; bytes: number} {
  const h = createHash('sha256');
  const fd = openSync(path, 'r');
  const buf = Buffer.allocUnsafe(1 << 20);
  let bytes = 0;
  try {
    for (;;) {
      const n = readSync(fd, buf, 0, buf.length, null);
      if (!n) break;
      h.update(buf.subarray(0, n));
      bytes += n;
    }
  } finally {
    closeSync(fd);
  }
  return {hash: h.digest('hex'), bytes};
}
