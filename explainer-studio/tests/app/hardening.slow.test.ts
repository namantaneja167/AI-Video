// The app's own behaviour when something is missing or goes wrong, in a real browser on a NEW (empty) project: the first-run screen, dialogs
// from the keyboard, links to things that do not exist, bad input, a lost or restarted server, and the Project screen's backup.
// Run with STUDIO_SLOW=1 (npm run test:slow).
import assert from 'node:assert/strict';
import {spawn, type ChildProcess} from 'node:child_process';
import {existsSync, mkdtempSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {after, before, describe, test} from 'node:test';
import {ROOT, createProject} from '../../app/workspace.ts';
import {verifyBackup} from '../../core/backup.ts';
import {Chrome, type Tab} from './harness.ts';

const skip = process.env.STUDIO_SLOW ? false : 'set STUDIO_SLOW=1 to run the browser tests';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const sel = (id: string) => `[data-testid="${id}"]`;
const text = (t: Tab, q: string) => t.eval<string>(`document.querySelector(${JSON.stringify(q)})?.innerText ?? ''`);
const active = (t: Tab) => t.eval<string>(`(() => { const e = document.activeElement; return e ? (e.dataset?.testid ?? e.tagName.toLowerCase()) : ''; })()`);
const insideDialog = (t: Tab) => t.eval<boolean>(`!!document.activeElement?.closest('[role=dialog]')`);

describe('the app on an empty project', {skip, timeout: 10 * 60_000}, () => {
  const parent = mkdtempSync(join(tmpdir(), 'studio-hard-'));
  const dir = join(parent, 'hardening project');
  let server: ChildProcess | null = null;
  let port = 0;
  let chrome: Chrome;
  let t: Tab;
  const token = () => readFileSync(join(dir, '.studio', 'app-token'), 'utf8').trim();
  const start = async () => {
    server = spawn(process.execPath, [join(ROOT, 'app', 'main.ts'), 'open', dir, '--no-open', '--port', String(port || 0)], {cwd: ROOT, stdio: ['ignore', 'pipe', 'inherit']});
    const url: string = await new Promise((res, rej) => {
      let buf = '';
      server!.stdout!.on('data', (d: Buffer) => { buf += d; const m = /Open: (http:\/\/127\.0\.0\.1:\d+)\//.exec(buf); if (m) res(m[1]); });
      server!.once('exit', (c) => rej(new Error(`the app exited with ${c}`)));
    });
    port = Number(new URL(url).port);
  };
  const stop = async (sig: NodeJS.Signals) => { const s = server; if (!s) return; server = null; s.kill(sig); await new Promise((r) => s.once('exit', r)); };
  const base = () => `http://127.0.0.1:${port}`;
  let signedIn = false;
  const open = async (q = '') => {
    if (!signedIn) { await t.goto(`${base()}/?token=${token()}`); signedIn = true; await sleep(300); }
    await t.goto(`${base()}/?${q}`);
    await t.waitFor('document.querySelector(".ttl, .boot[role=alert]")', 20000, 'the page');
  };

  before(async () => {
    createProject(dir, 'Hardening project');
    await start();
    chrome = await Chrome.launch();
    t = await chrome.tab();
    await t.viewport(1280, 800, 1);
  });
  after(async () => { await chrome?.close(); await stop('SIGTERM'); rmSync(parent, {recursive: true, force: true}); rmSync(`${dir}-backups`, {recursive: true, force: true}); });

  test('the first screen explains what an episode is and offers to start one', async () => {
    await open();
    await t.waitFor(`document.querySelector('[data-testid=empty-project]')`, 10000, 'the first-run card');
    assert.match(await text(t, sel('empty-project')), /no episodes yet[\s\S]*Idea, Research, Script, Storyboard, Scenes, Voice, then Review[\s\S]*nothing is built until you ask/);
    assert.match(await text(t, '.crumb'), /Hardening project/);
  });

  test('a dialog opened from the keyboard keeps focus inside, closes on Escape from anywhere, and returns focus to what opened it', async () => {
    await open();
    await t.eval(`document.querySelector('[data-testid=new-episode]').focus()`);
    await t.key('Enter');
    await t.waitFor(`document.querySelector('[data-testid=new-episode-dialog]')`, 5000);
    assert.equal(await insideDialog(t), true, 'focus moved into the dialog');
    for (let i = 0; i < 12; i++) { await t.key('Tab'); assert.equal(await insideDialog(t), true, `Tab ${i + 1} stayed inside`); }
    for (let i = 0; i < 3; i++) { await t.key('Tab', 8); assert.equal(await insideDialog(t), true, 'Shift+Tab stayed inside'); }
    await t.key('Escape');
    await t.waitFor(`!document.querySelector('[data-testid=new-episode-dialog]')`, 5000, 'the dialog to close');
    assert.equal(await active(t), 'new-episode', 'focus is back on the button that opened it');
  });

  test('bad input is refused in words, in the page, before anything is created', async () => {
    await open();
    await t.click(sel('new-episode'));
    await t.click(sel('new-create'));
    assert.equal(await text(t, sel('new-error')), 'Give the episode a title.');
    await t.fill(sel('new-title'), 'A title');
    await t.fill(sel('new-duration'), 'abc');
    await t.click(sel('new-create'));
    assert.match(await text(t, sel('new-error')), /minutes, between 0\.25 and 30/);
    await t.fill(sel('new-duration'), '');
    await t.fill(sel('new-title'), 'x'.repeat(201));
    await t.click(sel('new-create'));
    await t.waitFor(`document.querySelector('[data-testid=new-error]')?.innerText.includes('200')`, 10000, 'the length message');
    await t.key('Escape');
    const list = await (await fetch(`${base()}/api/library`, {headers: {cookie: `studio_token=${token()}`}})).json() as {items: unknown[]};
    assert.deepEqual(list.items, [], 'nothing was created');
  });

  test('a link to an episode that does not exist says so instead of silently showing the list', async () => {
    for (const q of ['episode=nope', 'plan=nope&tab=storyboard', 'voice=nope', 'review=nope']) {
      await open(q);
      await t.waitFor(`document.querySelector('[data-testid=route-notice]')`, 10000, q);
      assert.match(await text(t, sel('route-notice')), /There is no episode "nope" in this project/);
    }
    await open('foo=bar');
    assert.equal(await t.eval('!!document.querySelector("[data-testid=route-notice]")'), false, 'an unknown option is just ignored');
  });

  test('the Project screen: a verified backup from the page, listed, with how to restore it and a plain check of this computer', async () => {
    await open();
    await t.click(sel('rail-settings'));
    await t.waitFor(`document.querySelector('[data-testid=project-card] dl')`, 15000, 'the project card');
    assert.match(await text(t, sel('project-card')), /Hardening project/);
    await t.click(sel('backup-now'));
    await t.waitFor(`document.querySelector('[data-testid=backup-result]')`, 120000, 'the backup');
    assert.match(await text(t, sel('backup-result')), /Backed up and verified/);
    assert.match(await text(t, sel('backup-result')), /scripts\/project\.ts restore/);
    await t.waitFor(`document.querySelectorAll('[data-testid=backup-list] li').length === 1`, 10000, 'the list');
    const dirs = `${dir}-backups`;
    assert.ok(existsSync(dirs));
    const name = (await text(t, `${sel('backup-list')} li code`)).trim();
    assert.deepEqual(verifyBackup(join(dirs, name)).problems, []);
    await t.waitFor(`document.querySelector('[data-testid=env-node]')`, 15000, 'the environment list');
    assert.equal(await t.eval('document.querySelector("[data-testid=env-node]").dataset.ok'), 'yes');
  });

  test('a lost server shows a banner on every screen that has no connection notice of its own, and a restart is announced', async () => {
    await open();
    await t.click(sel('new-episode'));
    await t.fill(sel('new-title'), 'Connection test');
    await t.click(sel('new-create'));
    await t.waitFor(`document.querySelector('[data-screen=plan]')`, 15000, 'the planner');
    await stop('SIGKILL');
    await t.waitFor(`document.querySelector('[data-testid=link-banner]')?.dataset.state === 'lost'`, 30000, 'the lost banner');
    assert.match(await text(t, sel('link-banner')), /Lost connection to the app\. Nothing you have saved is lost/);
    await start();
    await t.waitFor(`document.querySelector('[data-testid=link-banner]')?.dataset.state === 'restarted'`, 60000, 'the restarted banner');
    assert.match(await text(t, sel('link-banner')), /The app was restarted\. Everything that had been saved is still here/);
    const title = await (await fetch(`${base()}/api/library`, {headers: {cookie: `studio_token=${token()}`}})).json() as {items: {title: string}[]};
    assert.deepEqual(title.items.map((i) => i.title), ['Connection test'], 'the episode made before the kill is still there');
  });

  test('the page made no problems of its own', () => {
    assert.deepEqual(t.consoleErrors.filter((e) => !/Failed to load resource|EventSource|net::ERR/.test(e)), []);
  });
});
