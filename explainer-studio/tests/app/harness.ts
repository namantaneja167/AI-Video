// Test harness for the app: a temporary seeded workspace (never the persistent demo workspace), the real server, and a
// small Chrome DevTools client. Everything it creates is under its own temp directory and is removed by close().
import {spawn, type ChildProcess} from 'node:child_process';
import {existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {buildUi} from '../../app/build.ts';
import {ROOT, seedDemo} from '../../app/demo.ts';
import {baselineSources} from '../baseline-sources.ts';
import {JobService} from '../../app/jobs.ts';
import {createApp, type App} from '../../app/server.ts';
import {jobOptions, recordFakeTools} from './jobs-fixture.ts';
import {Project} from '../../core/project.ts';

export type Harness = {
  tmp: string; projectRoot: string; faultFile: string; port: number; token: string;
  project: Project; app: App;
  /** Present when started with {jobs: true}: the real job service on fake audio and render workers. */
  jobs?: JobService;
  url(path?: string): string;
  /** Stop the server cleanly and start it again on the same port and workspace (what ./studio-app does). */
  restart(): Promise<void>;
  /** Stop the server without closing the store first, as after a crash of the server process. */
  close(): Promise<void>;
};

/** A workspace of its own in a temp folder. `dist` reuses an already built page (read-only) instead of building one per workspace. */
export async function seedWorkspace(opts: {dist?: string} = {}) {
  const tmp = mkdtempSync(join(tmpdir(), 'studio-app-test-'));
  const projectRoot = join(tmp, 'project');
  seedDemo(projectRoot, baselineSources());
  const dist = opts.dist ?? join(tmp, 'dist');
  if (!opts.dist) await buildUi(dist);
  return {tmp, projectRoot, dist, faultFile: join(tmp, 'fault')};
}

/** The built page shared by a suite's workspaces. Remove `dir` when the suite ends. */
export async function buildSharedDist(): Promise<{dir: string; dist: string}> {
  const dir = mkdtempSync(join(tmpdir(), 'studio-app-dist-'));
  const dist = join(dir, 'dist');
  await buildUi(dist);
  return {dir, dist};
}

/**
 * Everything one browser test needs, and nothing it shares with another: its own workspace, server (own process, own port),
 * Chrome (own process and profile) and tabs. `dispose()` removes all of it, so a failed test leaves nothing behind for the next.
 */
export type TestEnv = {
  w: Awaited<ReturnType<typeof seedWorkspace>>;
  srv: Child;
  chrome: Chrome;
  tabs: Tab[];
  dispose(): Promise<void>;
};
export async function createTestEnv(dist: string, serverEnv: Record<string, string> | ((w: TestEnv['w']) => Record<string, string>) = {}, port = 0): Promise<TestEnv> {
  const w = await seedWorkspace({dist});
  const env = {w, srv: undefined as unknown as Child, chrome: undefined as unknown as Chrome, tabs: [] as Tab[]} as TestEnv;
  env.dispose = async () => {
    for (const t of env.tabs) await t.close().catch(() => undefined);
    env.tabs = [];
    await env.chrome?.close().catch(() => undefined);
    if (env.srv?.proc.exitCode === null) await env.srv.kill('SIGTERM').catch(() => undefined);
    rmSync(w.tmp, {recursive: true, force: true});
  };
  try {
    env.srv = await spawnServer(w, port, typeof serverEnv === 'function' ? serverEnv(w) : serverEnv);
    env.chrome = await Chrome.launch();
  } catch (e) { await env.dispose(); throw e; }
  return env;
}

export type Child = {proc: ChildProcess; port: number; token: string; url(path?: string): string; kill(signal: NodeJS.Signals): Promise<void>};
/** The server in its own process; kill('SIGKILL') is a crash. A restart is another spawnServer on the same port. */
export async function spawnServer(w: {projectRoot: string; dist: string; faultFile: string}, port = 0, env: Record<string, string> = {}): Promise<Child> {
  const proc = spawn('node', [resolve(ROOT, 'tests/app/serve.ts'), w.projectRoot, w.dist, String(port), w.faultFile], {stdio: ['ignore', 'pipe', 'inherit'], env: {...process.env, ...env}});
  const actual = await new Promise<number>((res, rej) => {
    let buf = '';
    proc.stdout!.on('data', (d) => { buf += d; const m = /READY (\d+)/.exec(buf); if (m) res(Number(m[1])); });
    proc.once('exit', (c) => rej(new Error(`server exited early (${c})`)));
  });
  const token = readFileSync(join(w.projectRoot, '.studio', 'app-token'), 'utf8').trim();
  return {
    proc, port: actual, token, url: (path = '/') => `http://127.0.0.1:${actual}${path}`,
    kill: async (signal) => { const done = new Promise((r) => proc.once('exit', r)); proc.kill(signal); await done; },
  };
}

export async function startApp(opts: {jobs?: boolean} = {}): Promise<Harness> {
  const {tmp, projectRoot, dist, faultFile} = await seedWorkspace();
  const h = {tmp, projectRoot, faultFile} as Harness;
  const boot = async (port = 0) => {
    h.project = Project.open(projectRoot);
    if (opts.jobs) { recordFakeTools(h.project); h.jobs = new JobService(jobOptions(h.project, projectRoot)); }
    h.app = createApp({project: h.project, projectRoot, workspaceLabel: 'Test workspace', distDir: dist, publicDir: resolve(ROOT, 'public'), faultFile, port, jobs: h.jobs});
    h.port = await h.app.start();
    h.token = h.app.token;
  };
  await boot();
  h.url = (path = '/') => `http://127.0.0.1:${h.port}${path}`;
  h.restart = async () => {
    const port = h.port;
    await h.app.stop();
    await h.jobs?.shutdown();
    h.project.close();
    await boot(port);
  };
  h.close = async () => {
    await h.app.stop();
    await h.jobs?.shutdown();
    try { h.project.close(); } catch { /* already closed */ }
    rmSync(tmp, {recursive: true, force: true});
  };
  return h;
}

/** Fetch helper with the sign-in cookie and the header the app page sends on writes. One connection per request: a pooled socket reused after a server restart can be reset by the client's own race (stale keep-alive), which is not the app's behaviour. */
export const api = (h: Harness) => async (method: string, path: string, body?: unknown, extra: Record<string, string> = {}) => {
  const res = await fetch(h.url(path), {method, headers: {cookie: `studio_token=${h.token}`, 'x-studio': '1', 'content-type': 'application/json', connection: 'close', ...extra}, body: body === undefined ? undefined : JSON.stringify(body)});
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return {status: res.status, json, text, headers: res.headers};
};

// ---- browser ------------------------------------------------------------------------------------------------------------
const CHROME = resolve(ROOT, 'node_modules/.remotion/chrome-headless-shell/mac-arm64/chrome-headless-shell-mac-arm64/chrome-headless-shell');
export const hasBrowser = existsSync(CHROME);

export class Tab {
  private ws!: WebSocket;
  private id = 0;
  private waiting = new Map<number, {resolve: (v: any) => void; reject: (e: Error) => void}>();
  consoleErrors: string[] = [];
  targetId = '';
  /** Leave-page prompts that appeared (accepted automatically, as a person would to reload). */
  dialogs: string[] = [];
  private base = '';
  failedRequests: string[] = [];
  static async open(wsUrl: string): Promise<Tab> {
    const t = new Tab();
    t.ws = new WebSocket(wsUrl);
    await new Promise<void>((res, rej) => { t.ws.onopen = () => res(); t.ws.onerror = () => rej(new Error('devtools socket failed')); });
    t.ws.onmessage = (m) => {
      const msg = JSON.parse(String(m.data));
      if (msg.id && t.waiting.has(msg.id)) { const w = t.waiting.get(msg.id)!; t.waiting.delete(msg.id); msg.error ? w.reject(new Error(msg.error.message)) : w.resolve(msg.result); }
      else if (msg.method === 'Page.javascriptDialogOpening') { t.dialogs.push(`${msg.params.type}: ${msg.params.message}`); void t.send('Page.handleJavaScriptDialog', {accept: true}); }
      else if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') t.consoleErrors.push(msg.params.args.map((a: any) => a.value ?? a.description).join(' '));
      else if (msg.method === 'Runtime.exceptionThrown') t.consoleErrors.push(msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text);
      else if (msg.method === 'Network.responseReceived' && msg.params.response.status >= 400) t.failedRequests.push(`${msg.params.response.status} ${msg.params.response.url}`);
    };
    await t.send('Page.enable'); await t.send('Runtime.enable'); await t.send('Network.enable');
    return t;
  }
  send(method: string, params: object = {}): Promise<any> {
    const id = ++this.id;
    this.ws.send(JSON.stringify({id, method, params}));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.waiting.delete(id); reject(new Error(`DevTools command ${method} did not answer within 15 s`)); }, 15000);
      this.waiting.set(id, {resolve: (v) => { clearTimeout(timer); resolve(v); }, reject: (e) => { clearTimeout(timer); reject(e); }});
    });
  }
  async viewport(width: number, height: number, deviceScaleFactor = 1) { await this.send('Emulation.setDeviceMetricsOverride', {width, height, deviceScaleFactor, mobile: false}); }
  async goto(url: string) { await this.send('Page.navigate', {url}); await this.waitFor('document.readyState === "complete"'); }
  async eval<T = any>(expr: string): Promise<T> {
    const r = await this.send('Runtime.evaluate', {expression: expr, returnByValue: true, awaitPromise: true});
    if (r.exceptionDetails) throw new Error(`eval failed: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}\n${expr}`);
    return r.result.value as T;
  }
  async waitFor(expr: string, timeoutMs = 15000, label = expr): Promise<void> {
    const t0 = Date.now();
    for (;;) {
      if (await this.eval<boolean>(`Boolean(${expr})`).catch(() => false)) return;
      if (Date.now() - t0 > timeoutMs) throw new Error(`timed out after ${timeoutMs} ms waiting for: ${label}`);
      await new Promise((r) => setTimeout(r, 50));
    }
  }
  private async center(sel: string) {
    const c = await this.eval<{x: number; y: number} | null>(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});if(!e)return null;e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
    if (!c) throw new Error(`no element for ${sel}`);
    return c;
  }
  async click(sel: string) {
    const {x, y} = await this.center(sel);
    await this.send('Input.dispatchMouseEvent', {type: 'mousePressed', x, y, button: 'left', clickCount: 1});
    await this.send('Input.dispatchMouseEvent', {type: 'mouseReleased', x, y, button: 'left', clickCount: 1});
  }
  async clickAt(x: number, y: number) {
    await this.send('Input.dispatchMouseEvent', {type: 'mousePressed', x, y, button: 'left', clickCount: 1});
    await this.send('Input.dispatchMouseEvent', {type: 'mouseReleased', x, y, button: 'left', clickCount: 1});
  }
  async rect(sel: string) { return this.eval<{x: number; y: number; width: number; height: number}>(`(()=>{const r=document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}})()`); }
  async screenshotClip(file: string, clip: {x: number; y: number; width: number; height: number}) {
    const r = await this.send('Page.captureScreenshot', {format: 'png', clip: {...clip, scale: 1}});
    writeFileSync(file, Buffer.from(r.data, 'base64'));
  }
  async dblclick(sel: string) {
    const {x, y} = await this.center(sel);
    for (const n of [1, 2]) {
      await this.send('Input.dispatchMouseEvent', {type: 'mousePressed', x, y, button: 'left', clickCount: n});
      await this.send('Input.dispatchMouseEvent', {type: 'mouseReleased', x, y, button: 'left', clickCount: n});
    }
  }
  /** A real mouse drag: button held (`buttons`), moved in steps, released where it ends. */
  async drag(sel: string, dx: number, dy: number) {
    const {x, y} = await this.center(sel);
    await this.send('Input.dispatchMouseEvent', {type: 'mouseMoved', x, y});
    await this.send('Input.dispatchMouseEvent', {type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1});
    for (let i = 1; i <= 5; i++) await this.send('Input.dispatchMouseEvent', {type: 'mouseMoved', x: x + (dx * i) / 5, y: y + (dy * i) / 5, button: 'left', buttons: 1});
    await this.send('Input.dispatchMouseEvent', {type: 'mouseReleased', x: x + dx, y: y + dy, button: 'left', buttons: 0, clickCount: 1});
  }
  /** Click into a field, replace its content with `text` the way typing would, character by character. */
  async fill(sel: string, text: string) {
    await this.click(sel);
    await this.eval(`document.querySelector(${JSON.stringify(sel)}).select()`);
    await this.send('Input.dispatchKeyEvent', {type: 'keyDown', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8});
    await this.send('Input.dispatchKeyEvent', {type: 'keyUp', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8});
    for (const ch of text) await this.send('Input.insertText', {text: ch});
  }
  /** Start recording what changes the selected segment (clicks, inputs, preference traffic, aria-selected changes) with page-relative times. */
  async traceSelection() {
    await this.eval(`(()=>{if(window.__selTrace)return;const log=window.__selTrace=[];const t0=performance.now();
      const sel=()=>document.querySelector('[data-segment][aria-selected=true]')?.dataset.segment??'';
      const rec=(why)=>log.push([Math.round(performance.now()-t0),sel(),why]);
      new MutationObserver(()=>rec('selection-attribute')).observe(document.body,{subtree:true,attributes:true,attributeFilter:['aria-selected']});
      document.addEventListener('click',(e)=>rec('click '+(e.target.closest?.('[data-segment]')?.dataset.segment??e.target.tagName)),true);
      document.addEventListener('input',(e)=>rec('input '+(e.target.id||e.target.tagName)),true);
      const f=window.fetch;window.fetch=(...a)=>{if(String(a[0]).includes('/api/ui'))rec('pref '+(a[1]?.method??'GET')+' '+(a[1]?.body??''));return f(...a);};
      rec('start');})()`);
  }
  async selectionTrace(): Promise<string> {
    const rows = await this.eval<unknown[][]>('window.__selTrace ?? []');
    return rows.map((r) => `${r[0]} ms  selected=${r[1] || '-'}  ${r[2]}`).join('\n');
  }
  /** A real key press on the focused element or the page. */
  async key(key: string, mods = 0) {
    const codes: Record<string, [string, number, string?]> = {' ': ['Space', 32, ' '], ']': ['BracketRight', 221, ']'], '[': ['BracketLeft', 219, '['], Tab: ['Tab', 9], Escape: ['Escape', 27], Enter: ['Enter', 13, '\r'], ArrowUp: ['ArrowUp', 38], ArrowDown: ['ArrowDown', 40], Home: ['Home', 36], s: ['KeyS', 83, 's']};
    const [code, vk, text] = codes[key] ?? [key, key.toUpperCase().charCodeAt(0), key];
    await this.send('Input.dispatchKeyEvent', {type: text && !mods ? 'keyDown' : 'rawKeyDown', key, code, windowsVirtualKeyCode: vk, text: mods ? undefined : text, modifiers: mods});
    await this.send('Input.dispatchKeyEvent', {type: 'keyUp', key, code, windowsVirtualKeyCode: vk, modifiers: mods});
  }
  async screenshot(file: string) {
    const r = await this.send('Page.captureScreenshot', {format: 'png'});
    writeFileSync(file, Buffer.from(r.data, 'base64'));
  }
  /** Closes this page in the browser (not only the socket), so that finished tests do not leave pages running. */
  async close() {
    try { this.ws.close(); } catch { /* closed */ }
    if (this.targetId) await fetch(`${this.base}/json/close/${this.targetId}`).catch(() => undefined);
  }
  attach(base: string, id: string) { this.base = base; this.targetId = id; }
}

export class Chrome {
  private proc!: ChildProcess;
  private dir = '';
  private port = 0;
  static async launch(): Promise<Chrome> {
    const c = new Chrome();
    c.dir = mkdtempSync(join(tmpdir(), 'studio-app-chrome-'));
    c.proc = spawn(CHROME, ['--no-sandbox', '--disable-gpu', '--remote-debugging-port=0', `--user-data-dir=${c.dir}`, '--autoplay-policy=no-user-gesture-required', 'about:blank'], {stdio: ['ignore', 'ignore', 'pipe']});
    c.port = await new Promise<number>((res, rej) => {
      let buf = '';
      const to = setTimeout(() => rej(new Error('Chrome did not report a debugging port')), 15000);
      c.proc.stderr!.on('data', (d) => { buf += d; const m = /DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)\//.exec(buf); if (m) { clearTimeout(to); res(Number(m[1])); } });
      c.proc.once('exit', () => rej(new Error('Chrome exited early')));
    });
    return c;
  }
  async tab(): Promise<Tab> {
    const r = await fetch(`http://127.0.0.1:${this.port}/json/new?about:blank`, {method: 'PUT'});
    const t = (await r.json()) as {webSocketDebuggerUrl: string; id: string};
    const tab = await Tab.open(t.webSocketDebuggerUrl);
    tab.attach(`http://127.0.0.1:${this.port}`, t.id);
    return tab;
  }
  /** Stops only the browser process this object started, and removes its temporary profile. */
  async close() {
    const exited = new Promise((r) => this.proc.once('exit', r));
    this.proc.kill('SIGTERM');
    await Promise.race([exited, new Promise((r) => setTimeout(r, 3000))]);
    rmSync(this.dir, {recursive: true, force: true});
  }
}
