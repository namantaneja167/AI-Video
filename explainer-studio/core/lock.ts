// Single-writer lock. A lock may be taken over only when its holder is CONFIRMED gone. If the holder cannot
// be inspected (blocked or failing process probe, permission denied, unreadable lock), the answer is
// "unknown" and unknown never lets a second writer in.
import {execFileSync} from 'node:child_process';
import {existsSync, linkSync, readFileSync, unlinkSync, writeFileSync} from 'node:fs';

export class ProjectLockedError extends Error {}

export type ProcessInfo = {state: 'dead'} | {state: 'alive'; started: string | null; reason?: string};
export type ProcessProbe = (pid: number) => ProcessInfo;
export type ProbeDeps = {kill: (pid: number, signal: 0) => void; ps: (pid: number) => string};

const realDeps: ProbeDeps = {
  kill: (pid, signal) => { process.kill(pid, signal); },
  ps: (pid) => execFileSync('ps', ['-o', 'lstart=', '-p', String(pid)], {encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000}),
};

/**
 * "dead" only when the OS says the process does not exist (ESRCH). Anything else that goes wrong is reported as
 * alive with an unknown start time, never as dead.
 */
export function makeProbe(deps: ProbeDeps = realDeps): ProcessProbe {
  return (pid) => {
    try {
      deps.kill(pid, 0);
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (code === 'ESRCH') return {state: 'dead'};
      if (code !== 'EPERM') return {state: 'alive', started: null, reason: `liveness probe failed (${code ?? (e as Error).message})`};
    }
    try {
      const started = deps.ps(pid).trim();
      return started ? {state: 'alive', started} : {state: 'alive', started: null, reason: 'process inspection returned no start time'};
    } catch (e) {
      return {state: 'alive', started: null, reason: `process inspection unavailable (${(e as Error).message.split('\n')[0]})`};
    }
  };
}
export const defaultProbe: ProcessProbe = makeProbe();

export type LockRecord = {pid: number; started: string | null};
export type Verdict = {kind: 'stale'; why: string} | {kind: 'live'} | {kind: 'unknown'; why: string};

export function judgeHolder(rec: LockRecord, info: ProcessInfo): Verdict {
  if (info.state === 'dead') return {kind: 'stale', why: `process ${rec.pid} is confirmed not running`};
  if (rec.started !== null && info.started !== null) {
    return rec.started === info.started ? {kind: 'live'} : {kind: 'stale', why: `pid ${rec.pid} now belongs to a different process`};
  }
  return {kind: 'unknown', why: info.reason ?? 'the lock holder\'s start time was not recorded'};
}

export function readLock(path: string): LockRecord | null {
  try {
    const r = JSON.parse(readFileSync(path, 'utf8'));
    return Number.isInteger(r?.pid) && r.pid > 0 && (typeof r.started === 'string' || r.started === null) ? {pid: r.pid, started: r.started} : null;
  } catch {
    return null;
  }
}

/** Create the lock file with its full content in one atomic step (a reader never sees a half-written lock). */
function createLock(path: string, rec: LockRecord): void {
  const tmp = `${path}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
  writeFileSync(tmp, JSON.stringify(rec));
  try {
    linkSync(tmp, path); // fails with EEXIST if a lock already exists
  } finally {
    unlinkSync(tmp);
  }
}

/** Judge an existing lock file. Returns null if there is none. */
export function lockVerdict(path: string, probe: ProcessProbe): (Verdict & {pid?: number}) | null {
  if (!existsSync(path)) return null;
  const rec = readLock(path);
  if (!rec) return {kind: 'unknown', why: 'the lock file is unreadable, so its holder cannot be identified'};
  return {...judgeHolder(rec, probe(rec.pid)), pid: rec.pid};
}

export function acquireLock(path: string, probe: ProcessProbe = defaultProbe): void {
  const me = probe(process.pid);
  const mine: LockRecord = {pid: process.pid, started: me.state === 'alive' ? me.started : null};
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      createLock(path, mine);
      return;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
      const v = lockVerdict(path, probe);
      if (v === null) continue; // released between our attempt and our check
      if (v.kind === 'stale') {
        try { unlinkSync(path); } catch { /* someone else took it over first; the next attempt decides */ }
        continue;
      }
      if (v.kind === 'live') throw new ProjectLockedError(`project is open in another process (pid ${v.pid}); close it first`);
      throw new ProjectLockedError(
        `cannot tell whether another process holds this project: ${v.why}. Refusing to open it. ` +
          `If you have confirmed no other Explainer Studio process is running, delete ${path} and try again.`,
      );
    }
  }
  throw new ProjectLockedError('could not take the project lock');
}

export function releaseLock(path: string): void {
  const rec = readLock(path);
  if (rec && rec.pid === process.pid) {
    try { unlinkSync(path); } catch { /* already gone */ }
  }
}
