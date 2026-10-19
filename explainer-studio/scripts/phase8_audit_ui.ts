// Phase 8 usability audit: what a person meets in a new, empty project and when things go wrong. Records observations; it does not decide
// what is acceptable (the findings are read and judged afterwards). Runs its own copy of the app on a throwaway project in a temp folder.
//   node scripts/phase8_audit_ui.ts [outfile.json]
import {spawn, type ChildProcess} from 'node:child_process';
import {mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {Chrome, type Tab} from '../tests/app/harness.ts';
import {createEpisodeThroughUi} from '../tests/app/planner-scenario.ts';
import {READY_CONTENT, applyAndAdjustThroughUi} from '../tests/app/scenes-scenario.ts';
import {createProject, ROOT} from '../app/workspace.ts';

const OUT = resolve(ROOT, 'docs/studio/phase8-evidence/audit');
mkdirSync(OUT, {recursive: true});
const PORT = 4413;
const dir = join(mkdtempSync(join(tmpdir(), 'studio-audit-')), 'audit project');
createProject(dir, 'Audit project');
const token = () => readFileSync(join(dir, '.studio', 'app-token'), 'utf8').trim();
const base = `http://127.0.0.1:${PORT}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const log = (...a: unknown[]) => console.log(new Date().toISOString().slice(11, 19), ...a);

let server: ChildProcess | null = null;
const start = async (): Promise<void> => {
  server = spawn(process.execPath, [join(ROOT, 'app', 'main.ts'), 'open', dir, '--no-open', '--port', String(PORT)], {cwd: ROOT, stdio: ['ignore', 'inherit', 'inherit']});
  for (let i = 0; i < 200; i++) { try { if ((await fetch(`${base}/api/health`, {headers: {cookie: `studio_token=${token()}`}})).ok) return; } catch { /* not yet */ } await sleep(100); }
  throw new Error('the app did not start');
};
const stop = async (sig: NodeJS.Signals) => {
  const s = server;
  if (!s) return;
  server = null;
  s.kill(sig);
  await new Promise((r) => s.once('exit', r));
};

const findings: {id: string; area: string; observed: unknown}[] = [];
const note = (id: string, area: string, observed: unknown) => { findings.push({id, area, observed}); log(id, JSON.stringify(observed).slice(0, 220)); };
const bodyText = (t: Tab) => t.eval<string>('document.body.innerText.replace(/\\s+/g, " ").trim().slice(0, 600)');
const active = (t: Tab) => t.eval<string>(`(() => { const e = document.activeElement; return e ? (e.tagName.toLowerCase() + (e.dataset?.testid ? '[' + e.dataset.testid + ']' : '') + ' "' + (e.getAttribute('aria-label') || e.innerText || e.value || '').toString().slice(0, 40).replace(/\\s+/g, ' ') + '"') : 'none'; })()`);
const tabs = async (t: Tab, n: number) => { const seq: string[] = []; for (let i = 0; i < n; i++) { await t.key('Tab'); seq.push(await active(t)); } return seq; };

const chrome = await Chrome.launch();
try {
  await start();
  const t = await chrome.tab();
  await t.viewport(1280, 800, 1);
  const shot = (name: string) => t.screenshot(join(OUT, `${name}.png`));
  let signedIn = false;
  const open = async (q = '') => {
    if (!signedIn) { await t.goto(`${base}/?token=${token()}`); signedIn = true; await sleep(400); } // the first visit sets the sign-in cookie; the token link drops the query
    await t.goto(`${base}/?${q}`);
    await sleep(400);
  };

  // ---- 1. empty project
  await open();
  await t.waitFor('document.querySelector("[data-testid=episode-list]")', 20000, 'the episode list');
  note('empty-list', 'empty states', await bodyText(t));
  await shot('01-empty-list');

  // ---- 2. keyboard: the first stops, then open the dialog from the keyboard
  note('tab-order-list', 'keyboard', await tabs(t, 8));
  await t.eval('document.querySelector("[data-testid=new-episode]").focus()');
  await t.key('Enter');
  await t.waitFor('document.querySelector("[data-testid=new-episode-dialog]")', 5000, 'the dialog');
  note('dialog-focus', 'keyboard', await active(t));
  note('dialog-tab-order', 'keyboard', await tabs(t, 7));
  await t.key('Escape');
  await sleep(200);
  note('after-escape', 'keyboard', {dialogOpen: await t.eval('!!document.querySelector("[data-testid=new-episode-dialog]")'), focus: await active(t)});

  // ---- 3. invalid input in the new-episode form
  await t.click('[data-testid=new-episode]');
  await t.waitFor('document.querySelector("[data-testid=new-title]")');
  await t.click('[data-testid=new-create]');
  note('empty-title', 'invalid input', await t.eval('document.querySelector("[data-testid=new-error]")?.innerText ?? null'));
  await t.fill('[data-testid=new-title]', 'x'.repeat(400));
  await t.fill('[data-testid=new-duration]', 'abc');
  await t.click('[data-testid=new-create]');
  note('bad-duration', 'invalid input', await t.eval('document.querySelector("[data-testid=new-error]")?.innerText ?? null'));
  await t.fill('[data-testid=new-duration]', '');
  await t.click('[data-testid=new-create]');
  await sleep(600);
  note('long-title', 'invalid input', {error: await t.eval('document.querySelector("[data-testid=new-error]")?.innerText ?? null'), url: await t.eval('location.search')});
  await shot('02-long-title');
  await open('view=episodes');

  // ---- 4. routes that name something that is not there
  for (const q of ['episode=nope', 'plan=nope', 'voice=nope', 'review=nope', 'plan=nope&tab=storyboard', 'foo=bar']) {
    await open(q);
    await sleep(700);
    note(`route-${q}`, 'unknown routes', {text: await bodyText(t), links: await t.eval('[...document.querySelectorAll("a,button")].slice(0, 6).map((e) => e.innerText.trim()).filter(Boolean)')});
  }
  await shot('03-unknown-plan');

  // ---- 5. one real episode, scenes applied, no narration: the Voice and Review screens before any work
  await open('view=episodes');
  await t.waitFor('document.querySelector("[data-testid=episode-list]")');
  const content = READY_CONTENT({title: 'Audit episode', audience: 'Testers', durationMin: '1'});
  const seen = await createEpisodeThroughUi(t, content, async () => undefined);
  await applyAndAdjustThroughUi(t, seen.planId, async () => undefined);
  const id = seen.planId;
  note('new-episode-style', 'fonts', (await (await fetch(`${base}/api/episodes/${id}`, {headers: {cookie: `studio_token=${token()}`}})).json() as any).doc.style);
  await open(`voice=${id}`);
  await t.waitFor('document.querySelector("[data-testid=voice-screen]")', 20000).catch(async () => note('voice-did-not-open', 'BUG?', await bodyText(t)));
  note('voice-before-any-take', 'empty states', await bodyText(t));
  await shot('04-voice-empty');
  await open(`review=${id}`);
  await t.waitFor('document.querySelector("[data-testid=review-screen]")', 20000).catch(async () => note('review-did-not-open', 'BUG?', await bodyText(t)));
  note('review-before-any-video', 'empty states', await bodyText(t));
  await shot('05-review-empty');
  await open(`plan=${id}&tab=storyboard`);
  note('tab-order-planner', 'keyboard', await tabs(t, 10));

  // ---- 6. connection loss on the screens other than the editor, then recovery
  const lost = async (area: string, q: string, ready: string) => {
    await open(q);
    await t.waitFor(ready, 20000);
    await stop('SIGKILL');
    await sleep(6000);
    const during = {text: await bodyText(t), alerts: await t.eval('[...document.querySelectorAll("[role=alert],[role=status],.notices *")].map((e) => e.innerText.trim()).filter(Boolean).slice(0, 5)')};
    note(`lost-${area}`, 'connection loss', during);
    await shot(`06-lost-${area}`);
    await start();
    await sleep(9000);
    note(`recovered-${area}`, 'connection loss', {alerts: await t.eval('[...document.querySelectorAll("[role=alert],[role=status],.notices *")].map((e) => e.innerText.trim()).filter(Boolean).slice(0, 5)')});
  };
  await lost('planner', `plan=${id}&tab=brief`, 'document.querySelector("[data-screen=plan]")');
  await lost('voice', `voice=${id}`, 'document.querySelector("[data-testid=voice-screen]")');
  await lost('review', `review=${id}`, 'document.querySelector("[data-testid=review-screen]")');
  await lost('editor', `episode=${id}`, 'document.querySelector(".ttl")');

  // ---- 7. viewports
  for (const [w, h] of [[1280, 800], [1024, 700], [900, 700]] as const) {
    await t.viewport(w, h, 1);
    await open(`episode=${id}`);
    await t.waitFor('document.querySelector(".ttl")', 20000);
    await sleep(500);
    note(`viewport-${w}x${h}`, 'viewport', await t.eval('({scrollW: document.documentElement.scrollWidth, scrollH: document.documentElement.scrollHeight, w: innerWidth, h: innerHeight})'));
    await shot(`07-editor-${w}x${h}`);
  }
  note('console', 'errors', {consoleErrors: t.consoleErrors.slice(0, 20), failedRequests: t.failedRequests.slice(0, 20)});
} finally {
  await chrome.close();
  await stop('SIGTERM');
  writeFileSync(process.argv[2] ?? join(OUT, 'audit.json'), JSON.stringify({ranAt: new Date().toISOString(), findings}, null, 2) + '\n');
  rmSync(resolve(dir, '..'), {recursive: true, force: true}); // the throwaway project this script made
}
