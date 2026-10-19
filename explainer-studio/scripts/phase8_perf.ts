// Phase 8 measurements: how long the app takes to start and a few representative operations take on THIS machine. It starts its own app on a
// throwaway project and measures; it does not decide what is acceptable. Run with the machine otherwise idle.
//   node scripts/phase8_perf.ts [outfile.json]
import {spawn} from 'node:child_process';
import {mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {Chrome} from '../tests/app/harness.ts';
import {ROOT, createProject} from '../app/workspace.ts';
import {buildUi} from '../app/build.ts';

const OUT = resolve(ROOT, 'docs/studio/phase8-evidence/perf');
mkdirSync(OUT, {recursive: true});
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const parent = mkdtempSync(join(tmpdir(), 'studio-perf-'));
const dir = join(parent, 'perf project');
const result: Record<string, unknown> = {measuredAt: new Date().toISOString(), machine: {node: process.version, platform: `${process.platform} ${process.arch}`}, runs: {}};
const stats = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return {n: s.length, min: s[0], median: s[Math.floor(s.length / 2)], max: s[s.length - 1]}; };

async function startApp(args: string[]): Promise<{ms: number; stop: () => Promise<void>; url: string}> {
  const t0 = performance.now();
  const child = spawn(process.execPath, [join(ROOT, 'app', 'main.ts'), ...args, '--no-open', '--port', '0'], {cwd: ROOT, stdio: ['ignore', 'pipe', 'inherit']});
  const url: string = await new Promise((res, rej) => {
    let buf = '';
    child.stdout!.on('data', (d: Buffer) => { buf += d; const m = /Open: (http:\/\/127\.0\.0\.1:\d+\/\?token=\w+)/.exec(buf); if (m) res(m[1]); });
    child.once('exit', (c) => rej(new Error(`exited ${c}`)));
  });
  const ms = performance.now() - t0;
  return {ms, url, stop: async () => { child.kill('SIGTERM'); await new Promise((r) => child.once('exit', r)); }};
}

try {
  // the page bundle
  const b0 = performance.now(); await buildUi(); result.pageBundleBuildMs = Math.round(performance.now() - b0);
  // creating a project
  const c0 = performance.now(); createProject(dir, 'Perf'); result.createProjectMs = Math.round(performance.now() - c0);
  // startup of the app on an existing project: process start to "running", 5 times
  const starts: number[] = [];
  for (let i = 0; i < 5; i++) { const a = await startApp(['open', dir]); starts.push(Math.round(a.ms)); await a.stop(); }
  result.startupOpenProjectMs = {runs: starts, ...stats(starts)};
  // page: first usable screen, and the common operations, in a real browser
  const app = await startApp(['open', dir]);
  const chrome = await Chrome.launch();
  try {
    const t = await chrome.tab();
    await t.viewport(1280, 800, 1);
    const base = app.url.split('/?')[0];
    const f0 = performance.now();
    await t.goto(app.url);
    await t.waitFor('document.querySelector("[data-testid=empty-project]")', 30000);
    result.firstScreenMs = Math.round(performance.now() - f0);
    const timed = async (name: string, fn: () => Promise<void>) => { const s = performance.now(); await fn(); (result.operations as Record<string, number>)[name] = Math.round(performance.now() - s); };
    result.operations = {};
    await timed('create a draft from the form', async () => {
      await t.click('[data-testid=new-episode]');
      await t.fill('[data-testid=new-title]', 'Perf episode');
      await t.click('[data-testid=new-create]');
      await t.waitFor('document.querySelector("[data-screen=plan]")', 20000);
    });
    await timed('open the Project screen with the quick environment check', async () => {
      await t.goto(`${base}/?view=settings`);
      await t.waitFor('document.querySelector("[data-testid=env-node]")', 20000);
    });
    const token = readFileSync(join(dir, '.studio', 'app-token'), 'utf8').trim();
    await timed('a backup of a small project, written and verified', async () => {
      const r = await fetch(`${base}/api/project/backup`, {method: 'POST', headers: {cookie: `studio_token=${token}`, 'x-studio': '1', 'content-type': 'application/json'}, body: '{}'});
      if (r.status !== 200) throw new Error(await r.text());
    });
    await timed('the thorough environment check (starts both Python environments)', async () => {
      await fetch(`${base}/api/environment?deep=1`, {headers: {cookie: `studio_token=${token}`}});
    });
    // quick API round trips
    const lat: number[] = [];
    for (let i = 0; i < 30; i++) { const s = performance.now(); await fetch(`${base}/api/library`, {headers: {cookie: `studio_token=${token}`}}); lat.push(performance.now() - s); }
    result.libraryRequestMs = stats(lat.map((x) => Math.round(x * 10) / 10));
  } finally { await chrome.close(); await app.stop(); }
  writeFileSync(process.argv[2] ?? join(OUT, 'perf-run.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result, null, 2));
} finally {
  rmSync(parent, {recursive: true, force: true});
  rmSync(`${dir}-backups`, {recursive: true, force: true});
}
