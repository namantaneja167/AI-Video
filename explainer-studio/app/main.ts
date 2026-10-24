// ./studio-app                     start the local app on the persistent demo workspace and open it in the browser
// ./studio-app new <folder>         create a new, empty project in a new (or empty) folder, then open it
// ./studio-app open <folder>        open an existing project
// ./studio-app doctor               check what this computer has (Node, ffmpeg, Python environments, models, fonts) and how to fix what is missing
// ./studio-app reset-demo --yes     move the demo workspace aside (never deleted) and seed a fresh one
// Options: --no-open  --port N  --name "Project name" (with new)  --rebuild (rebuild the app page)
import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {DEMO_DIR, DEMO_PROJECT, demoExists, openDemo, resetDemo, seedDemo} from './demo.ts';
import {CorruptProjectError, ProjectLockedError, ProjectTooNewError} from '../core/project.ts';
import {ROOT, WorkspaceError, createProject, openProjectAt} from './workspace.ts';
import {scopeSoundToEpisodes} from '../core/soundSettings.ts';
import {DIST, buildUi} from './build.ts';
import {JobService} from './jobs.ts';
import {ProductionSlot} from '../core/slot.ts';
import {createApp} from './server.ts';

const args = process.argv.slice(2);
const flag = (n: string) => args.includes(n);
const value = (n: string) => args[args.indexOf(n) + 1];

if (args[0] === 'reset-demo') {
  if (!flag('--yes')) {
    console.error(`This moves the demo workspace aside (it is renamed, not deleted) and creates a fresh one.\nRun again with --yes to do it.\n${DEMO_PROJECT}`);
    process.exit(2);
  }
  const r = resetDemo();
  console.log(r.movedTo ? `The old demo workspace was kept at:\n  ${r.movedTo}` : 'There was no demo workspace.');
  console.log(`A fresh demo workspace was created at:\n  ${r.root}`);
  process.exit(0);
}
if (args[0] === 'doctor') {
  const {checkEnvironment, environmentReady} = await import('../core/environment.ts');
  const checks = checkEnvironment(ROOT, {deep: true});
  for (const c of checks) console.log(`${c.ok ? 'ok     ' : 'MISSING'}  ${c.label}: ${c.detail}${c.ok || !c.fix ? '' : `\n         -> ${c.fix}`}`);
  const ready = environmentReady(checks, ['app', 'video']);
  const narrate = environmentReady(checks, ['narration']);
  console.log(`\nEditing, review, checks and rendering: ${ready ? 'ready' : 'NOT ready'}.  Narration: ${narrate ? 'ready' : 'NOT ready (see above)'}.`);
  process.exit(ready ? 0 : 1);
}
const portAt = args.indexOf('--port');
const nameAt = args.indexOf('--name');
const valueIdx = new Set([portAt + 1, nameAt + 1].filter((i) => i > 0));
const positional = args.filter((a, i) => !a.startsWith('--') && !valueIdx.has(i));
const unknown = args.filter((a) => a.startsWith('--') && !['--no-open', '--rebuild', '--port', '--name'].includes(a));
const mode = positional[0] === 'new' || positional[0] === 'open' ? positional[0] : null;
const usage = 'Usage: ./studio-app [--no-open] [--port N]  |  ./studio-app doctor  |  ./studio-app new <folder> [--name "Name"]  |  ./studio-app open <folder>  |  ./studio-app reset-demo --yes';
if (unknown.length || (portAt >= 0 && !/^\d+$/.test(args[portAt + 1] ?? '')) || (!mode && positional.length) || (mode && positional.length !== 2)) {
  console.error(`${unknown.length ? `Unknown option "${unknown[0]}". ` : mode && positional.length !== 2 ? `"${mode}" needs exactly one folder. ` : portAt >= 0 && !/^\d+$/.test(args[portAt + 1] ?? '') ? '--port needs a number. ' : `Unknown argument "${positional[0]}". `}${usage}`);
  process.exit(2);
}

if (!existsSync(join(DIST, 'index.html')) || flag('--rebuild')) {
  console.log('Building the app page...');
  await buildUi();
}

let project: ReturnType<typeof openDemo>;
let projectRoot: string;
let workspaceLabel: string;
let workspaceDir: string;
let isDemo = false;
try {
  if (mode === 'new') {
    const made = createProject(positional[1], nameAt >= 0 ? args[nameAt + 1] : undefined);
    console.log(`Created the project "${made.name}" at ${made.root}`);
    ({project} = openProjectAt(made.root));
    [projectRoot, workspaceLabel, workspaceDir] = [made.root, made.name, made.root];
  } else if (mode === 'open') {
    const opened = openProjectAt(positional[1]);
    project = opened.project;
    [projectRoot, workspaceLabel, workspaceDir] = [resolve(positional[1]), opened.name, resolve(positional[1])];
  } else {
    isDemo = true;
    if (!demoExists()) {
      console.log('First run: creating the demo workspace from the saved context-window outputs (no models are used)...');
      seedDemo();
      console.log(`Created ${DEMO_PROJECT}`);
    }
    project = openDemo();
    [projectRoot, workspaceLabel, workspaceDir] = [DEMO_PROJECT, 'Demo workspace', DEMO_DIR];
  }
} catch (e) {
  const known = e instanceof WorkspaceError || /^cannot seed the demo/.test((e as Error).message) || e instanceof ProjectLockedError || e instanceof CorruptProjectError || e instanceof ProjectTooNewError;
  console.error(known ? (e as Error).message : `Could not open the project: ${(e as Error).message}`);
  process.exit(known ? 2 : 1);
}

const scoped = scopeSoundToEpisodes(project);
if (scoped.done) console.log(`Sound settings now belong to their episodes: ${scoped.episodes.join(', ')} keep what they were built with; new episodes start without accents.`);
// The real workers: the Qwen audio worker, the Python timeline logic, the mixer and the Remotion render worker, on the opened project's own job runner.
const qwenPython = join(ROOT, '.venv-qwen/bin/python');
const jobs = new JobService({project, env: {root: ROOT, qwenPython, python: join(ROOT, '.venv/bin/python'), renderConcurrency: 2}, workerPython: qwenPython, measuredFile: join(projectRoot, 'measured-runs.json'), slot: {slot: new ProductionSlot(), project: workspaceLabel, projectRoot}});
const app = createApp({project, projectRoot, workspaceLabel, kind: isDemo ? 'demo' : 'project', jobs, distDir: DIST, publicDir: resolve(ROOT, 'public'), port: flag('--port') ? Number(value('--port')) : 4317, faultFile: process.env.STUDIO_APP_TEST_FAULT});
let port: number;
try {
  port = await app.start();
} catch (e) {
  console.error(`Could not listen: ${(e as Error).message}\nIs another copy of the app already running? Use --port N to pick another port.`);
  await jobs.shutdown();
  project.close();
  process.exit(1);
}
console.log(`Explainer Studio is running (${isDemo ? 'demo workspace' : 'project'}: ${workspaceDir}).\nOpen: ${app.url()}\nPress Ctrl+C to stop. Your saved edits stay in the ${isDemo ? 'demo workspace' : 'project'}.`);
if (!flag('--no-open') && process.platform === 'darwin') spawn('open', [app.url()], {stdio: 'ignore', detached: true}).unref();

let closing = false;
const shutdown = async () => {
  if (closing) return;
  closing = true;
  await app.stop();
  await jobs.shutdown(); // running work is cancelled, which stops only the jobs' own processes
  project.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
