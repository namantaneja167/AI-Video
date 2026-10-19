// Cross-process lock for the resource-heavy suites (browser and render tests). `node --test` runs files in parallel; on this
// 16 GB Mac, several Chrome instances plus Remotion renders push it into swap, and the tests then fail for reasons unrelated
// to the code. Heavy suites therefore take turns, whatever flags the runner is given. Fast tests do not use this and stay parallel.
// The lock is a directory (atomic to create) holding the owner's pid; a lock whose owner has died is taken over.
import {mkdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const LOCK = join(tmpdir(), 'studio-heavy-tests.lock');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code === 'EPERM'; } };

/** Wait for our turn; resolves to the function that gives it up. */
export async function acquireHeavy(who: string, timeoutMs = 30 * 60_000): Promise<() => void> {
  const t0 = Date.now();
  for (;;) {
    try {
      mkdirSync(LOCK);
      writeFileSync(join(LOCK, 'owner'), JSON.stringify({pid: process.pid, who, since: Date.now()}));
      let released = false;
      const release = () => { if (!released) { released = true; rmSync(LOCK, {recursive: true, force: true}); } };
      process.once('exit', release);
      return release;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
    }
    let owner: {pid: number} | null = null;
    try { owner = JSON.parse(readFileSync(join(LOCK, 'owner'), 'utf8')); } catch { /* being created or removed */ }
    if (owner && !alive(owner.pid)) rmSync(LOCK, {recursive: true, force: true}); // its owner died without releasing
    if (Date.now() - t0 > timeoutMs) throw new Error(`${who}: waited ${Math.round(timeoutMs / 1000)} s for the heavy-test lock`);
    await sleep(300);
  }
}
