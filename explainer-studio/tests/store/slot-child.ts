// Child process for the production-slot tests. Controlled workers only: no model, render or real job is involved.
//   slot-child.ts claim  <slotDir> <project> [projectRoot]    take the slot, print READY <pid>, hold it until killed
//   slot-child.ts runner <slotDir> <projectRoot> <name>       run a heavy job through a runner that holds the slot; the job starts
//                                                             an owned worker, prints READY {pids}, and hangs until killed
//   slot-child.ts race   <slotDir> <name> <startFile>         wait for the start file, make one claim attempt, print WON <pid> (and
//                                                             hold) or LOST <reason> (and exit)
//   slot-child.ts lockdb <slotDir>                            open the slot's database and sit inside an exclusive transaction
import {existsSync, writeSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {join} from 'node:path';
import {putBytes} from '../../core/blobs.ts';
import {descendantsOf, snapshotProcs} from '../../core/proc.ts';
import {Project} from '../../core/project.ts';
import {JobRunner} from '../../core/runner.ts';
import {ProductionSlot, SLOT_SCHEMA} from '../../core/slot.ts';

const [mode, dir, a, b] = process.argv.slice(2);
const hold = () => setInterval(() => {}, 1000);

if (mode === 'claim') {
  const r = new ProductionSlot({dir}).tryAcquire({project: a, projectRoot: b ?? `/tmp/${a}`, job: 'a held claim'});
  if (!r.ok) { writeSync(1, `BUSY ${r.why}\n`); process.exit(3); }
  writeSync(1, `READY ${process.pid}\n`);
  hold();
} else if (mode === 'race') {
  while (!existsSync(b)) { /* spin until the parent says go */ }
  const r = new ProductionSlot({dir, busyMs: 2000}).tryAcquire({project: a, projectRoot: `/tmp/${a}`, job: 'a race'});
  if (r.ok) { writeSync(1, `WON ${process.pid}\n`); hold(); } else { writeSync(1, `LOST ${r.why}\n`); process.exit(0); }
} else if (mode === 'lockdb') {
  const db = new DatabaseSync(join(dir, 'production-slot.sqlite'));
  db.exec(SLOT_SCHEMA);
  db.exec('BEGIN IMMEDIATE');
  (globalThis as {keep?: unknown}).keep = db; // a collected connection would close and give the lock up
  writeSync(1, `READY ${process.pid}\n`);
  hold();
} else {
  const p = Project.open(a);
  const runner = new JobRunner(p, {
    pollMs: 100,
    slot: {slot: new ProductionSlot({dir}), project: b, projectRoot: a, pollMs: 50},
    handlers: {
      'timing.build': async (ctx) => {
        const c = ctx.spawn('worker', 'sh', ['-c', 'sleep 301 & sleep 301 & wait'], {stdio: 'ignore'});
        await new Promise((r) => setTimeout(r, 500)); // the runner's sampling records the worker's helper processes
        const pids = [c.pid!, ...descendantsOf(snapshotProcs(), [c.pid!])];
        writeSync(1, `READY ${JSON.stringify({pids, app: process.pid})}\n`);
        await new Promise(() => {});
        return {blobHash: putBytes(p, 'never').hash};
      },
    },
  });
  runner.enqueue({episodeId: 'join-fanout', jobKind: 'timing.build'});
  await runner.idle();
}
