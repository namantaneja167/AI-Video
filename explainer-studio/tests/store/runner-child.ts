// Child process for the restart test: runs a job that spawns owned processes, reports their pids, then hangs
// until the parent kills this whole process with SIGKILL (no cleanup runs).
import {writeSync} from 'node:fs';
import {putBytes} from '../../core/blobs.ts';
import {Project} from '../../core/project.ts';
import {descendantsOf, snapshotProcs} from '../../core/proc.ts';
import {JobRunner} from '../../core/runner.ts';

const [root] = process.argv.slice(2);
const p = Project.open(root);
const runner = new JobRunner(p, {
  pollMs: 100,
  handlers: {
    'timing.build': async (ctx) => {
      const c = ctx.spawn('worker', 'sh', ['-c', 'sleep 301 & sleep 301 & wait'], {stdio: 'ignore'});
      await new Promise((r) => setTimeout(r, 400));
      const pids = [c.pid!, ...descendantsOf(snapshotProcs(), [c.pid!])];
      writeSync(1, `READY ${JSON.stringify({pids, job: ctx.jobId})}\n`);
      await new Promise(() => {});
      return {blobHash: putBytes(p, 'never').hash};
    },
  },
});
runner.enqueue({episodeId: 'join-fanout', jobKind: 'timing.build'});
await runner.idle();
