// Runs one export in its own process with every way of starting a child process disabled, and prints what happened as JSON.
//   node tests/store/export-child.ts <projectRoot> <exportsRoot> <episodeId>
// The test that starts this checks that export started no process (no render, encode or remaster: those all need one).
import cp from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
import {Project} from '../../core/project.ts';
import {exportApproved, exportsOf} from '../../core/export.ts';

const [projectRoot, exportsRoot, episodeId] = process.argv.slice(2);
const p = Project.open(projectRoot);
const calls: string[] = [];
for (const k of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork'] as const) {
  (cp as any)[k] = (...a: unknown[]) => { calls.push(`${k}:${String(a[0])}`); throw new Error(`a process was started during export (${k} ${String(a[0])})`); };
}
syncBuiltinESMExports();
let out: Record<string, unknown>;
try {
  const r = exportApproved(p, episodeId, {exportsRoot});
  out = {ok: true, result: r, recorded: exportsOf(p, episodeId).length};
} catch (e) {
  out = {ok: false, error: (e as Error).message, code: (e as {code?: string}).code};
}
p.close();
process.stdout.write(JSON.stringify({...out, processesStarted: calls}) + '\n');
