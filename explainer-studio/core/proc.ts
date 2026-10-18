// Process ownership. A job may stop only processes it OWNS, identified by pid AND start time (a reused pid has a
// different start time) and recorded in the database when they were spawned or discovered as descendants of an
// owned process. Nothing is ever matched by name, command line or group, so unrelated Python, Node, browser
// or editor processes cannot be signalled. If processes cannot be inspected, nothing unverified is killed and the
// result says it is unconfirmed.
import {execFileSync, spawn, type ChildProcess, type SpawnOptions} from 'node:child_process';
import type {DatabaseSync} from 'node:sqlite';
import {all} from './db.ts';

export class ProcInspectionError extends Error {}

export type ProcInfo = {pid: number; ppid: number; pgid: number; rssKb: number; start: string; command: string};
export type PsFn = () => string;

const realPs: PsFn = () =>
  execFileSync('ps', ['-axo', 'pid=,ppid=,pgid=,rss=,lstart=,command='], {encoding: 'utf8', maxBuffer: 64 << 20, timeout: 10_000, stdio: ['ignore', 'pipe', 'ignore']});

const LINE = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\w{3}\s+\w{3}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}\s+\d{4})\s+(.*)$/;

export function parsePs(out: string): Map<number, ProcInfo> {
  const m = new Map<number, ProcInfo>();
  for (const line of out.split('\n')) {
    const r = LINE.exec(line);
    if (r) m.set(Number(r[1]), {pid: Number(r[1]), ppid: Number(r[2]), pgid: Number(r[3]), rssKb: Number(r[4]), start: r[5].replace(/\s+/g, ' '), command: r[6]});
  }
  return m;
}

/** Throws ProcInspectionError if the process table cannot be read, so callers never mistake "unknown" for "gone". */
export function snapshotProcs(ps: PsFn = realPs): Map<number, ProcInfo> {
  let out: string;
  try { out = ps(); } catch (e) { throw new ProcInspectionError(`process inspection unavailable: ${(e as Error).message.split('\n')[0]}`); }
  const m = parsePs(out);
  if (m.size === 0) throw new ProcInspectionError('process inspection returned no processes');
  return m;
}

export function descendantsOf(procs: Map<number, ProcInfo>, roots: number[]): number[] {
  const out = new Set<number>();
  const queue = [...roots];
  while (queue.length) {
    const cur = queue.pop()!;
    for (const p of procs.values()) if (p.ppid === cur && !out.has(p.pid) && p.pid !== cur) { out.add(p.pid); queue.push(p.pid); }
  }
  return [...out];
}

export type Owned = {pid: number; start: string; role: string};
type Row = {owner: string; pid: number; start: string; role: string};

export class OwnerRegistry {
  db: DatabaseSync;
  now: () => number;
  ps: PsFn;
  constructor(db: DatabaseSync, now: () => number = Date.now, ps: PsFn = realPs) {
    this.db = db;
    this.now = now;
    this.ps = ps;
  }
  record(owner: string, pid: number, start: string, role: string): void {
    this.db.prepare('INSERT INTO job_procs(owner,pid,start,role,recorded_at) VALUES(?,?,?,?,?) ON CONFLICT(owner,pid,start) DO UPDATE SET gone_at=NULL').run(owner, pid, start, role, this.now());
  }
  live(owner: string): Row[] {
    return all<Row>(this.db.prepare('SELECT owner, pid, start, role FROM job_procs WHERE owner=? AND gone_at IS NULL'), owner);
  }
  liveAll(): Row[] {
    return all<Row>(this.db.prepare('SELECT owner, pid, start, role FROM job_procs WHERE gone_at IS NULL'));
  }
  markGone(pid: number, start: string): void {
    this.db.prepare('UPDATE job_procs SET gone_at=? WHERE pid=? AND start=? AND gone_at IS NULL').run(this.now(), pid, start);
  }
  /** End an owner's claim without signalling anything (a lease on a worker that keeps running). */
  release(owner: string, role?: string): void {
    this.db.prepare(`UPDATE job_procs SET gone_at=? WHERE owner=? AND gone_at IS NULL${role ? ' AND role=?' : ''}`).run(...(role ? [this.now(), owner, role] : [this.now(), owner]));
  }
}

/** Spawn in its own session and record its identity. The returned child is owned by `owner`. */
export function spawnOwned(reg: OwnerRegistry, owner: string, role: string, cmd: string, args: string[], opts: SpawnOptions = {}): ChildProcess {
  const child = spawn(cmd, args, {...opts, detached: true});
  if (child.pid === undefined) return child; // spawn failed; 'error' event reports it
  try {
    const info = snapshotProcs(reg.ps).get(child.pid);
    if (info) reg.record(owner, child.pid, info.start, role);
  } catch {
    // inspection unavailable: the handle is still ours, and killOwned will use it
  }
  return child;
}

/** Record `pid` (already verified as ours by the caller, e.g. a worker we spawned) as also owned by `owner`. */
export function lease(reg: OwnerRegistry, owner: string, pid: number, role: string): boolean {
  try {
    const info = snapshotProcs(reg.ps).get(pid);
    if (!info) return false;
    reg.record(owner, pid, info.start, role);
    return true;
  } catch {
    return false;
  }
}

export type KillResult = {signalled: number[]; survivors: Owned[]; confirmed: boolean; reason?: string};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Stop everything `owner` owns and everything that descends from it, verifying identity (pid + start time)
 * immediately before each signal. SIGTERM first, SIGKILL after the grace period. Never touches other processes.
 * `handles` are child processes we hold; they are used only if the process table cannot be read.
 */
export async function killOwned(reg: OwnerRegistry, owner: string, opts: {graceMs?: number; handles?: ChildProcess[]} = {}): Promise<KillResult> {
  const grace = opts.graceMs ?? 1500;
  const signalled = new Set<number>();
  const verifiedNow = (): {verified: Owned[]; procs: Map<number, ProcInfo>} => {
    const procs = snapshotProcs(reg.ps);
    const rows = reg.live(owner);
    const verified: Owned[] = [];
    for (const r of rows) {
      const cur = procs.get(r.pid);
      if (cur && cur.start === r.start) verified.push({pid: r.pid, start: r.start, role: r.role});
      else reg.markGone(r.pid, r.start); // gone, or the pid now belongs to something else: not ours any more
    }
    for (const pid of descendantsOf(procs, verified.map((v) => v.pid))) {
      const cur = procs.get(pid)!;
      if (!verified.some((v) => v.pid === pid)) {
        reg.record(owner, pid, cur.start, 'descendant');
        verified.push({pid, start: cur.start, role: 'descendant'});
      }
    }
    return {verified, procs};
  };
  const signal = (o: Owned, sig: NodeJS.Signals, procs: Map<number, ProcInfo>) => {
    if (procs.get(o.pid)?.start !== o.start) return; // identity re-checked against the latest table
    try { process.kill(o.pid, sig); signalled.add(o.pid); } catch { /* already gone */ }
  };

  try {
    for (let round = 0; round < 4; round++) {
      const {verified, procs} = verifiedNow();
      if (!verified.length) return {signalled: [...signalled], survivors: [], confirmed: true};
      for (const v of verified) signal(v, 'SIGTERM', procs);
      const until = Date.now() + grace;
      let left = verified;
      while (Date.now() < until && left.length) {
        await sleep(40);
        left = verifiedNow().verified;
      }
      if (left.length) {
        const procs2 = snapshotProcs(reg.ps);
        for (const v of left) signal(v, 'SIGKILL', procs2);
        const until2 = Date.now() + 3000;
        while (Date.now() < until2 && verifiedNow().verified.length) await sleep(40);
      }
    }
    const rest = verifiedNow().verified;
    return {signalled: [...signalled], survivors: rest, confirmed: rest.length === 0, reason: rest.length ? 'processes survived SIGKILL' : undefined};
  } catch (e) {
    if (!(e instanceof ProcInspectionError)) throw e;
    // Cannot verify identity: stop only the processes we hold handles for, and say that we cannot confirm.
    for (const h of opts.handles ?? []) { try { h.kill('SIGKILL'); } catch { /* gone */ } }
    return {signalled: [...signalled], survivors: [], confirmed: false, reason: e.message};
  }
}

const sleepSync = (ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

export type ReapResult = {reaped: number[]; survivors: Owned[]; inspection: 'ok' | 'unavailable' | 'not-needed'};

/**
 * Startup recovery: stop every recorded process that is still alive with the SAME identity it was recorded with
 * (plus its descendants). Synchronous so it can run while a project is being opened. Without a readable process
 * table nothing is touched and the result says so.
 */
export function reapAllSync(reg: OwnerRegistry, graceMs = 1500): ReapResult {
  const rows = reg.liveAll();
  if (!rows.length) return {reaped: [], survivors: [], inspection: 'not-needed'};
  let procs: Map<number, ProcInfo>;
  try { procs = snapshotProcs(reg.ps); } catch { return {reaped: [], survivors: rows.map((r) => ({pid: r.pid, start: r.start, role: r.role})), inspection: 'unavailable'}; }
  const targets = new Map<number, string>();
  for (const r of rows) {
    if (procs.get(r.pid)?.start === r.start) targets.set(r.pid, r.start);
    else reg.markGone(r.pid, r.start);
  }
  for (const pid of descendantsOf(procs, [...targets.keys()])) targets.set(pid, procs.get(pid)!.start);
  const alive = () => {
    const now = snapshotProcs(reg.ps);
    return [...targets].filter(([pid, start]) => now.get(pid)?.start === start);
  };
  const send = (sig: NodeJS.Signals) => { for (const [pid] of alive()) { try { process.kill(pid, sig); } catch { /* gone */ } } };
  send('SIGTERM');
  for (let t = 0; t < graceMs && alive().length; t += 40) sleepSync(40);
  send('SIGKILL');
  for (let t = 0; t < 3000 && alive().length; t += 40) sleepSync(40);
  const left = new Set(alive().map(([pid]) => pid));
  for (const [pid, start] of targets) if (!left.has(pid)) reg.markGone(pid, start);
  return {reaped: [...targets.keys()].filter((p) => !left.has(p)), survivors: [...left].map((pid) => ({pid, start: targets.get(pid)!, role: 'orphan'})), inspection: 'ok'};
}

/** Sum of resident memory of everything `owner` owns (identity-verified) plus descendants; records new descendants. */
export function ownedRssBytes(reg: OwnerRegistry, owner: string): number {
  const procs = snapshotProcs(reg.ps);
  const roots = reg.live(owner).filter((r) => procs.get(r.pid)?.start === r.start).map((r) => r.pid);
  const all_ = new Set<number>([...roots, ...descendantsOf(procs, roots)]);
  for (const pid of all_) {
    const cur = procs.get(pid)!;
    if (!roots.includes(pid)) reg.record(owner, pid, cur.start, 'descendant');
  }
  let kb = 0;
  for (const pid of all_) kb += procs.get(pid)!.rssKb;
  return kb * 1024;
}

export type MemoryProbe = () => {pressure: number; swapUsedMb: number | null};
export const systemMemory: MemoryProbe = () => {
  let pressure = 1;
  let swap: number | null = null;
  try { pressure = Number(execFileSync('sysctl', ['-n', 'kern.memorystatus_vm_pressure_level'], {encoding: 'utf8'}).trim()) || 1; } catch { /* leave level 1 */ }
  try { swap = Number(/used = ([\d.]+)M/.exec(execFileSync('sysctl', ['-n', 'vm.swapusage'], {encoding: 'utf8'}))?.[1] ?? NaN); } catch { /* unknown */ }
  return {pressure, swapUsedMb: Number.isFinite(swap) ? swap : null};
};
