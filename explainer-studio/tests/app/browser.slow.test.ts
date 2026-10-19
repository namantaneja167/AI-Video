// Browser acceptance tests for Phase 4 slice 1: a real browser drives the real app on a temporary workspace (a few minutes).
// Run with STUDIO_SLOW=1 (npm run test:slow). Set STUDIO_SHOTS=<dir> to also keep screenshots.
// Nothing here touches the persistent demo workspace; everything is under temp directories this file creates and removes.
import assert from 'node:assert/strict';
import {execFileSync, spawnSync} from 'node:child_process';
import {cpSync, mkdirSync, rmSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {after, afterEach, before, beforeEach, describe, test} from 'node:test';
import {ROOT} from '../../app/demo.ts';
import {setSegmentText} from '../../app/shared/edit.ts';
import {acquireHeavy} from '../heavy-lock.ts';
import {buildSharedDist, createTestEnv, spawnServer, type Child, type Chrome, type Tab, type TestEnv} from './harness.ts';

const skip = process.env.STUDIO_SLOW ? false : 'set STUDIO_SLOW=1 to run the browser tests';
const SHOTS = process.env.STUDIO_SHOTS;

// Every test gets its own workspace, server, port, Chrome and tabs (beforeEach/afterEach); a test that needs earlier work makes it
// itself through the API, so nothing one test does or leaves behind can change another.
let env: TestEnv;
let w: TestEnv['w'];
let srv: Child;
let chrome: Chrome;
let tabs: Tab[] = [];
const problems: string[] = [];
const refused: string[] = [];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const call = async (method: string, path: string, body?: unknown) => {
  const res = await fetch(srv.url(path), {method, headers: {cookie: `studio_token=${srv.token}`, 'x-studio': '1', 'content-type': 'application/json', connection: 'close'}, body: body === undefined ? undefined : JSON.stringify(body)});
  return {status: res.status, json: (await res.json().catch(() => null)) as any};
};
const open = async (dsf = 1): Promise<Tab> => {
  const t = await chrome.tab();
  tabs.push(t);
  await t.viewport(1280, 800, dsf);
  await t.goto(srv.url(`/?token=${srv.token}`));
  await t.waitFor('document.querySelector(".ttl") && document.querySelector("[data-testid=player] div")', 30000, 'the editor to appear');
  return t;
};
/** An edit made through the API, as another tab would make it. */
let setupTabs = 0;
const putEdit = async (fn: (doc: any) => any) => {
  const cur = (await call('GET', '/api/episodes/context-window')).json;
  const r = await call('PUT', '/api/episodes/context-window', {doc: fn(structuredClone(cur.doc)), baseSeq: cur.seq, tab: `test-setup-${++setupTabs}`});
  assert.equal(r.status, 200, `setup edit refused: ${JSON.stringify(r.json)}`);
};
/** The caption edit the first browser test makes by typing: segment s2 now reads differently from the build. */
const editS2 = () => putEdit((doc) => setSegmentText(doc, 's2', 'That limit is called its context window.').doc);
const save = (t: Tab) => t.eval<string>('document.querySelector("[data-save]")?.dataset.save ?? ""');
const waitSave = (t: Tab, state: string, ms = 8000) => t.waitFor(`document.querySelector("[data-save]")?.dataset.save === ${JSON.stringify(state)}`, ms, `save state ${state}`);
const shot = async (t: Tab, name: string) => { if (SHOTS) { mkdirSync(SHOTS, {recursive: true}); await t.screenshot(join(SHOTS, name)); } };
const segText = async (id: string) => (await call('GET', '/api/episodes/context-window')).json.doc.narration.segments.find((s: any) => s.id === id).text as string;
const player = (t: Tab) => t.eval<string>('document.querySelector("[data-testid=player]").innerText');
const field = (t: Tab, sel: string) => t.eval<string>(`document.querySelector(${JSON.stringify(sel)}).value`);
const selected = (t: Tab) => t.eval<string>('document.querySelector("[data-segment][aria-selected=true]")?.dataset.segment ?? ""');
const frame = async (t: Tab) => Number(await t.eval('document.querySelector("[data-testid=timecode]").dataset.frame'));
const ssim = (a: string, b: string, W: number, H: number): number => {
  const crop = `scale=${W}:${H}:flags=lanczos,crop=${W - 24}:${H - 24}:12:12`;
  const r = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', a, '-i', b, '-lavfi', `[0:v]${crop}[x];[1:v]${crop}[y];[x][y]ssim`, '-f', 'null', '-'], {encoding: 'utf8'});
  const m = /All:([0-9.]+)/.exec(r.stderr);
  assert.ok(m, `ssim output not understood: ${r.stderr.slice(-300)}`);
  return Number(m![1]);
};

let releaseHeavy = () => {};
let shared: {dir: string; dist: string} | undefined;
if (!skip) {
  before(async () => { releaseHeavy = await acquireHeavy('browser.slow'); shared = await buildSharedDist(); }, {timeout: 40 * 60_000});
  after(() => { releaseHeavy(); if (shared) rmSync(shared.dir, {recursive: true, force: true}); });
}

describe('editable preview in a real browser', {skip, timeout: 30 * 60_000}, () => {
  beforeEach(async () => {
    env = await createTestEnv(shared!.dist);
    ({w, srv, chrome, tabs} = env);
  });
  // Pages are closed after each test (many live Players slow the browser down); what they logged is kept for the last test.
  afterEach(async () => {
    for (const t of tabs) {
      problems.push(...t.consoleErrors.filter((e) => !/Failed to fetch|ERR_CONNECTION_REFUSED|EventSource|net::ERR/.test(e)).map((e) => `console: ${e}`));
      refused.push(...t.failedRequests.filter((r) => !/\/api\/events/.test(r)).map((r) => r.split(' ')[0]));
    }
    env.srv = srv; // a test may have restarted the server
    await env.dispose();
  });

  test('1280 x 800: every region is on screen, the page itself never scrolls, and nothing differs from the build', async () => {
    const t = await open();
    await sleep(1200);
    const m = await t.eval<any>(`(()=>{const d=document.documentElement;const r=(s)=>{const e=document.querySelector(s);if(!e)return null;const b=e.getBoundingClientRect();return {x:b.x,y:b.y,w:b.width,h:b.height}};return {sw:d.scrollWidth,sh:d.scrollHeight,outline:r('.outline'),insp:r('.insp'),center:r('.center'),tl:r('.tl'),top:r('.top'),steps:r('.steps'),phone:r('.phone')}})()`);
    assert.equal(m.sw, 1280, 'no horizontal page scrollbar');
    assert.equal(m.sh, 800, 'no vertical page scrollbar');
    for (const k of ['outline', 'insp', 'center', 'tl', 'top', 'steps', 'phone']) {
      assert.ok(m[k], `${k} exists`);
      assert.ok(m[k].x >= 0 && m[k].y >= 0 && m[k].x + m[k].w <= 1280.5 && m[k].y + m[k].h <= 800.5, `${k} lies inside the window: ${JSON.stringify(m[k])}`);
    }
    assert.ok(m.phone.h >= 300, `the phone preview is usable (${Math.round(m.phone.h)}px tall)`);
    assert.equal(await t.eval('document.querySelector("[data-testid=preview-banner]")'), null, 'nothing differs, so no banner');
    assert.match(await t.eval('document.querySelector("[data-testid=build-label]").innerText'), /^Build r\d+ · .* · imported$/);
    assert.equal(await save(t), 'saved');
    assert.equal(await t.eval('document.querySelector("[data-testid=stale-chip]").dataset.stale'), 'false');
    assert.equal(await t.eval('document.querySelectorAll("[data-segment]").length'), 8);
    assert.deepEqual(t.consoleErrors, []);
    assert.deepEqual(t.failedRequests, []);
    await shot(t, '01-editor-as-built.png');
  });

  test('the preview agrees with a rendered frame at three sampled times, and not with a different time', {timeout: 240000}, async () => {
    const t = await open(3); // the preview is drawn at three device pixels per CSS pixel so that it can be compared with a full-size render
    const built = (await call('GET', '/api/episodes/context-window')).json.build;
    const lanes = await t.rect('[data-testid=lanes]');
    const dir = join(w.tmp, 'parity');
    mkdirSync(dir, {recursive: true});
    const frames: number[] = [];
    for (const sec of [2.4, 9.5, 17.0]) {
      await t.clickAt(lanes.x + (sec / built.timeline.durationSec) * lanes.width, lanes.y + 40);
      await sleep(1000);
      const f = await frame(t);
      frames.push(f);
      await t.screenshotClip(join(dir, `player-${f}.png`), await t.rect('[data-testid=player]'));
    }
    const near = frames[0] + 15, other = frames[0] + 90;
    const pub = join(dir, 'public');
    mkdirSync(join(pub, 'generated', 'context-window', 'full'), {recursive: true});
    cpSync(join(ROOT, 'public/library'), join(pub, 'library'), {recursive: true});
    cpSync(join(ROOT, 'public/library/silence.wav'), join(pub, 'generated', 'context-window', 'full', built.timeline.audio));
    const data = {episode: {id: 'context-window', style: built.builtDoc.style, scenes: built.builtDoc.scenes}, timeline: built.timeline};
    const stills = [...frames, near, other].map((f) => ({composition: 'studio-episode', inputProps: {episode: 'context-window', variant: 'full', data}, frame: f, out: join(dir, `still-${f}.png`)}));
    writeFileSync(join(dir, 'spec.json'), JSON.stringify({publicDir: pub, stills}));
    execFileSync('node', [join(ROOT, 'scripts/phase3_stills.ts'), join(dir, 'spec.json')], {cwd: ROOT, stdio: 'pipe'});
    const r = await t.rect('[data-testid=player]');
    // Compared at the preview's size in CSS pixels: the clip may sit on a fraction of a device pixel, and downscaling removes that offset.
    const W = Math.round(r.width), H = Math.round(r.height);
    const match = frames.map((f) => ssim(join(dir, `player-${f}.png`), join(dir, `still-${f}.png`), W, H));
    const nearScore = ssim(join(dir, `player-${frames[0]}.png`), join(dir, `still-${near}.png`), W, H);
    const farScore = ssim(join(dir, `player-${frames[0]}.png`), join(dir, `still-${other}.png`), W, H);
    console.log(`    parity (SSIM, 1 = identical) at ${W}x${H}: preview vs render of the same frame ${frames.join(', ')}: ${match.map((m) => m.toFixed(3)).join(', ')}; preview at frame ${frames[0]} vs render of frame ${near} (0.5 s later): ${nearScore.toFixed(3)}, of frame ${other} (3 s later): ${farScore.toFixed(3)}`);
    if (SHOTS) { // the comparison is kept for the author to judge by eye: preview on the top row, rendered frame below, at the same three times
      mkdirSync(SHOTS, {recursive: true});
      const ins = [...frames.map((f) => join(dir, `player-${f}.png`)), ...frames.map((f) => join(dir, `still-${f}.png`))];
      const filter = `${ins.map((_, i) => `[${i}:v]scale=300:-1:flags=lanczos[v${i}]`).join(';')};[v0][v1][v2]hstack=inputs=3[top];[v3][v4][v5]hstack=inputs=3[bot];[top][bot]vstack=inputs=2`;
      execFileSync('ffmpeg', ['-v', 'error', '-y', ...ins.flatMap((f) => ['-i', f]), '-filter_complex', filter, '-frames:v', '1', join(SHOTS, 'parity-sheet.png')]);
      writeFileSync(join(SHOTS, 'parity.json'), JSON.stringify({
        method: 'Remotion Player in headless Chrome (3 device pixels per CSS pixel) against a Remotion still of the same frame from the same timeline; SSIM compared at the preview size in CSS pixels',
        framesAt30fps: frames, seconds: frames.map((f) => Math.round((f / 30) * 100) / 100), previewSizeCssPx: [W, H], ssimSameFrame: match.map((m) => Math.round(m * 1000) / 1000),
        ssimPreviewVsRenderHalfSecondLater: Math.round(nearScore * 1000) / 1000, ssimPreviewVsRenderThreeSecondsLater: Math.round(farScore * 1000) / 1000,
        byEye: 'not judged: the author looks at parity-sheet.png',
      }, null, 2));
    }
    // The threshold comes from the measured baseline: a same-frame pair must beat a frame only half a second away.
    for (const m of match) assert.ok(m > Math.max(nearScore, farScore), `a matching frame (${m}) must score higher than a frame half a second away (${nearScore})`);
    assert.ok(match[0] - nearScore > 0.01, 'the same-frame score is clearly above the half-second-away score');
  });

  test('a text edit turns the badges amber within a second, the preview stays the last build, and the explanation shows what is stale and what it costs', async () => {
    const t = await open();
    await t.click('[data-segment="s2"]');
    assert.match(await player(t), /That limit is/);
    const before = await player(t);
    await t.fill('#f-text', 'That limit is called its context window.');
    const t0 = Date.now();
    await t.waitFor('document.querySelector("[data-testid=stale-chip]").dataset.stale === "true" && document.querySelector("[data-segment=s2]").dataset.changed === "true" && document.querySelector("[data-testid=scene-badge]")', 1000, 'amber badges within 1 s');
    const ms = Date.now() - t0;
    console.log(`    badges amber ${ms} ms after the last keystroke was handled`);
    assert.ok(ms < 1000);
    assert.equal(await save(t) === 'unsaved' || await save(t) === 'saving' || await save(t) === 'saved', true);
    // truthful preview: still the build, with a banner that says so; the new words are not drawn
    assert.match(await t.eval('document.querySelector("[data-testid=preview-banner]").innerText'), /last build, not your edits[\s\S]*Spoken text changed in s2/);
    assert.equal(await player(t), before);
    assert.doesNotMatch(await player(t), /called/);
    assert.match(await t.eval('document.querySelector("[data-testid=build-label]").innerText'), /^Build r\d+/);
    await waitSave(t, 'saved');
    assert.equal(await segText('s2'), 'That limit is called its context window.', 'committed in the store');
    await t.click('[data-testid=stale-chip]');
    await t.waitFor('document.querySelectorAll("[data-testid=stale-row]").length === 4');
    const rows = await t.eval<string[][]>('[...document.querySelectorAll("[data-testid=stale-row]")].map(r=>[...r.children].map(c=>c.innerText))');
    assert.deepEqual(rows.map((r) => r[0]), ['Narration, block b1 (s1, s2, s3, s4)', 'Timing and captions', 'Final audio mix', 'Final video']);
    for (const r of rows) assert.match(r[2], /estimate\)$|^Not measured$/);
    assert.match(rows[0][2], /^about 3\d s \(estimate\)$/);
    assert.match(await t.eval('document.querySelector("[data-testid=stale-total]").innerText'), /estimate\)/);
    await shot(t, '03-stale-explained.png');
    await t.key('Escape');
    await t.waitFor('!document.querySelector("[data-testid=stale-popover]")');
    await shot(t, '02-edited-stale.png');
  });

  test('emphasis shows live when the words are the built ones, and says so when they are not', async () => {
    await editS2(); // s2's words differ from the build; s3's do not
    const t = await open();
    await t.click('[data-segment="s3"]');
    const liveBefore = await t.eval<number>('document.querySelectorAll(".b.emph.live").length');
    assert.equal(liveBefore, 0);
    await t.click('.w:nth-of-type(1)'); // the word "Your" in s3
    await t.waitFor('document.querySelectorAll(".b.emph.live").length === 1');
    assert.match(await t.eval('document.querySelector("[data-testid=preview-banner]").innerText'), /Emphasis in s3 is shown live/);
    // s2 was edited in the previous test (its words differ from the build): an emphasis edit there is explained, not drawn
    await t.click('[data-segment="s2"]');
    await t.click('.words .w:nth-of-type(1)');
    await t.waitFor('document.querySelector("[data-testid=preview-banner]").innerText.includes("Emphasis in s2")');
    assert.match(await t.eval('document.querySelector("[data-testid=preview-banner]").innerText'), /Emphasis in s2: its words changed after the build/);
    await waitSave(t, 'saved');
  });

  test('after a reload the committed edits, the selected segment, the panel sizes and the preview truth are all still there', async () => {
    await editS2();
    const t = await open();
    await t.click('[data-segment="s5"]');
    const before = await t.rect('.stagewrap');
    await t.click('.outline .ph button');            // collapse the outline
    await t.click('.insp .ph button');               // collapse the inspector
    await t.click('.grip');
    await t.key('ArrowUp');                          // timeline taller by 24 px
    await t.key('ArrowUp');
    const tl1 = await t.eval<number>('document.querySelector(".tl").getBoundingClientRect().height');
    await sleep(500);
    await t.goto(srv.url('/'));
    await t.waitFor('document.querySelector(".ttl") && document.querySelector("[data-testid=player] div")', 30000);
    assert.equal(await selected(t), '', 'the outline stays collapsed, so segments are not listed');
    assert.equal(await t.eval('document.querySelectorAll(".outline.slim").length'), 1);
    assert.equal(await t.eval('document.querySelectorAll(".insp.slim").length'), 1);
    const after = await t.rect('.stagewrap');
    assert.ok(after.width > before.width + 400, `the preview area stays wide after a reload (${Math.round(before.width)} px open, ${Math.round(after.width)} px collapsed)`);
    assert.equal(await t.eval<number>('document.querySelector(".tl").getBoundingClientRect().height'), tl1, 'timeline height survives the reload');
    // reopen the panels: the selection (s5) and the committed text come back
    await t.click('.outline .ph button');
    await t.click('.insp .ph button');
    assert.equal(await selected(t), 's5');
    assert.equal(await t.eval('document.querySelector("[data-segment=s2] .tx").innerText'), 'That limit is called its context window.');
    assert.equal(await save(t), 'saved');
    assert.equal(await t.eval('document.querySelector("[data-testid=stale-chip]").dataset.stale'), 'true', 'still different from the build after a reload');
    assert.match(await t.eval('document.querySelector("[data-testid=preview-banner]").innerText'), /Spoken text changed in s2/);
    await t.dblclick('.grip');
    assert.equal(await t.eval<number>('document.querySelector(".tl").getBoundingClientRect().height'), 224 + 0, 'double-click resets the timeline');
  });

  test('collapsing the side panels gives the preview the room', async () => {
    const t = await open();
    for (const sel of ['.outline.slim .ph button', '.insp.slim .ph button']) if (await t.eval(`!!document.querySelector(${JSON.stringify(sel)})`)) await t.click(sel);
    const base = await t.rect('.stagewrap');
    await t.click('.insp .ph button');
    const a = await t.rect('.stagewrap');
    await t.click('.outline .ph button');
    const b = await t.rect('.stagewrap');
    console.log(`    preview area width: ${Math.round(base.width)} px open, ${Math.round(a.width)} px with the inspector collapsed, ${Math.round(b.width)} px with both collapsed`);
    assert.ok(a.width > base.width + 250);
    assert.ok(b.width > a.width + 200);
    await shot(t, '05-panels-collapsed.png');
    await t.click('.insp .ph button');
    await t.click('.outline .ph button');
  });

  test('timeline height: dragging the edge stays between the minimum and maximum, double-click and Home reset it, the page never scrolls, and the height survives a reload', async () => {
    const t = await open();
    const height = () => t.eval<number>('Math.round(document.querySelector(".tl").getBoundingClientRect().height)');
    const noScroll = async (what: string) => assert.deepEqual(await t.eval('[document.documentElement.scrollWidth, document.documentElement.scrollHeight]'), [1280, 800], `no page scrollbars ${what}`);
    assert.equal(await height(), 224, 'starts at the default height');
    await t.drag('.grip', 0, -50);
    assert.equal(await height(), 274, 'dragging the edge up by 50 px makes the timeline 50 px taller');
    await t.drag('.grip', 0, -300); // far beyond the 146 px left to the maximum, with the pointer still inside the window
    assert.equal(await height(), 420, 'dragging far up stops at the maximum');
    await noScroll('at the maximum');
    await t.drag('.grip', 0, 340); // the pointer stays inside the window; 340 px is more than the 300 px between maximum and minimum
    assert.equal(await height(), 120, 'dragging far down stops at the minimum');
    await noScroll('at the minimum');
    await t.drag('.grip', 0, -60); // 180 px
    const chosen = await height();
    assert.equal(chosen, 180);
    await sleep(500);
    await t.goto(srv.url('/'));
    await t.waitFor('document.querySelector(".ttl") && document.querySelector("[data-testid=player] div")', 30000);
    assert.equal(await height(), chosen, 'the height survives a reload');
    await t.dblclick('.grip');
    assert.equal(await height(), 224, 'double-click resets');
    await t.drag('.grip', 0, -80);
    assert.equal(await height(), 304);
    await t.eval('document.querySelector(".grip").focus()');
    await t.key('Home');
    assert.equal(await height(), 224, 'Home resets from the keyboard');
    await t.key('ArrowUp');
    assert.equal(await height(), 248, 'arrow keys resize in 24 px steps');
    await shot(t, '20-timeline-resized.png');
  });

  test('N adds a timestamped note at the playhead from the keyboard, shows it on the timeline and in the inspector, and changes nothing a rebuild would act on', async () => {
    const t = await open();
    await t.click('[data-segment="s1"]');
    await t.eval('document.activeElement && document.activeElement.blur()');
    await t.key(']'); // playhead into segment s2
    const at = await frame(t) / 30;
    await t.key('n');
    await t.waitFor('document.querySelector("[data-testid=note-composer]")', 3000, 'the note composer after pressing N');
    assert.equal(await t.eval('document.activeElement.id'), 'f-note', 'the text box has the focus, so typing can start at once');
    assert.match(await t.eval('document.querySelector("[data-testid=note-target]").innerText'), /^0:0\d\.\d · s2$/);
    await shot(t, '21-note-composer.png');
    for (const ch of 'Slow down on "context window".') await t.send('Input.insertText', {text: ch});
    await t.key('Enter');
    await t.waitFor('!document.querySelector("[data-testid=note-composer]")', 3000, 'the composer to close');
    await waitSave(t, 'saved');
    const notes = (await call('GET', '/api/episodes/context-window')).json.doc.reviewNotes as any[];
    assert.equal(notes.length, 1);
    assert.deepEqual([notes[0].text, notes[0].type, notes[0].status, notes[0].anchor.segment], ['Slow down on "context window".', 'general', 'open', 's2']);
    assert.ok(Math.abs(notes[0].timeSec - at) < 0.05, `the note is stamped with the playhead time (${notes[0].timeSec} s, playhead ${at} s)`);
    assert.ok(notes[0].render?.id, 'it records the build it was written against');
    assert.equal(await t.eval('document.querySelectorAll("[data-testid=note-marker]").length'), 1, 'a marker on the timeline');
    await t.eval('document.activeElement && document.activeElement.blur()');
    assert.match(await t.eval('document.querySelector("[data-testid=notes-list]").innerText'), /notes \(1\)[\s\S]*general[\s\S]*slow down on/i);
    // a note is not an edit to anything that is built
    assert.equal(await t.eval('document.querySelector("[data-testid=stale-chip]").dataset.stale'), 'false', 'no badge turns amber');
    assert.equal(await t.eval('!!document.querySelector("[data-testid=preview-banner]")'), false);
    assert.equal((await call('GET', '/api/episodes/context-window')).json.status.render.final.status, 'fresh', 'the final video is still fresh');
    await shot(t, '22-note-added.png');
    // Escape cancels without adding; N typed into a field is just a letter
    await t.key('n');
    await t.waitFor('document.querySelector("[data-testid=note-composer]")');
    await t.send('Input.insertText', {text: 'never saved'});
    await t.key('Escape');
    await t.waitFor('!document.querySelector("[data-testid=note-composer]")');
    assert.equal(((await call('GET', '/api/episodes/context-window')).json.doc.reviewNotes as any[]).length, 1);
    await t.click('#f-text');
    await t.key('n');
    assert.equal(await t.eval('!!document.querySelector("[data-testid=note-composer]")'), false, 'typing the letter n in a field does not open the composer');
    // the mouse path and the Tab path reach the same composer
    await t.click('[data-testid=add-note]');
    await t.waitFor('document.querySelector("[data-testid=note-composer]")');
    await t.key('Escape');
    await t.waitFor('!document.querySelector("[data-testid=note-composer]")');
    await t.click('[data-testid=note-marker]');
    await sleep(300);
    assert.ok(Math.abs((await frame(t)) / 30 - notes[0].timeSec) < 0.1, 'clicking the marker seeks to the note');
  });

  test('the keyboard alone plays, pauses and moves between segments, and reaches the fields', async () => {
    const t = await open();
    await t.click('[data-segment="s1"]');
    await t.eval('document.activeElement && document.activeElement.blur()');
    assert.equal(await selected(t), 's1');
    await t.key(']');
    assert.equal(await selected(t), 's2');
    const f2 = await frame(t);
    assert.ok(Math.abs(f2 - Math.round(3.5 * 30)) < 40, `seeked into s2 (frame ${f2})`);
    await t.key(']');
    await t.key('[');
    assert.equal(await selected(t), 's2');
    await t.eval('document.activeElement && document.activeElement.blur()');
    await t.key(' ');
    await t.waitFor('document.querySelector("[aria-label=Pause]")', 4000, 'playing after Space');
    const p1 = await frame(t);
    await sleep(700);
    assert.ok(await frame(t) > p1, 'the playhead moves while playing');
    await t.key(' ');
    await t.waitFor('document.querySelector("[aria-label=Play]")', 4000, 'paused after Space');
    const stopped = await frame(t);
    await sleep(400);
    assert.equal(await frame(t), stopped);
    // Tab reaches the segment list, the transport and the editing fields
    await t.eval('document.activeElement.blur(); window.scrollTo(0,0)');
    const seen = new Set<string>();
    for (let i = 0; i < 60; i++) {
      await t.key('Tab');
      seen.add(await t.eval<string>('(()=>{const e=document.activeElement;return e.id||e.getAttribute("aria-label")||e.dataset.segment||e.tagName})()'));
    }
    for (const want of ['Play', 'Next segment', 'Add note', 'Position in the preview', 'f-text', 'f-speech', 'f-pause']) assert.ok(seen.has(want), `Tab reaches ${want}; reached: ${[...seen].join(' | ')}`);
    assert.ok([...seen].some((s) => /^s\d$/.test(s)), 'Tab reaches the segment list');
    // Cmd+S saves at once instead of waiting for the pause
    await t.fill('#f-pause', '0.4');
    await t.key('s', 4);
    await waitSave(t, 'saved', 1500);
    assert.equal((await call('GET', '/api/episodes/context-window')).json.doc.narration.segments[1].pauseAfter, 0.4);
  });

  test('a failed save keeps the edit, says so, survives a reload, and Retry saves it', async () => {
    const t = await open();
    writeFileSync(w.faultFile, 'x');
    await t.click('[data-segment="s6"]');
    await t.fill('#f-text', 'In many models, input and output share a single budget.');
    await waitSave(t, 'failed');
    assert.match(await t.eval('document.querySelector(".notice.bad").innerText'), /Not saved[\s\S]*Your edits are kept/);
    assert.equal(await segText('s6'), 'In many models, input and output share one budget.', 'the store still has the old text');
    assert.equal(await field(t, '#f-text'), 'In many models, input and output share a single budget.', 'the edit is still on screen');
    await shot(t, '04-failed-save.png');
    // reload while the save is failing: the browser asks before leaving a page with unsaved edits, then the edit comes back from the local draft
    await t.goto(srv.url('/'));
    assert.equal(t.dialogs.length, 1, 'the leave-page prompt appeared');
    await t.waitFor('document.querySelector(".ttl") && document.querySelector("[data-testid=player] div")', 30000);
    await t.click('[data-segment="s6"]');
    assert.equal(await field(t, '#f-text'), 'In many models, input and output share a single budget.', 'restored after the reload');
    await t.waitFor('document.querySelector("[data-save]").dataset.save === "failed"', 8000, 'failed again after the reload');
    rmSync(w.faultFile);
    await t.click('.notice.bad .btn');
    await waitSave(t, 'saved');
    assert.equal(await segText('s6'), 'In many models, input and output share a single budget.');
    assert.equal(await t.eval('document.querySelector(".notice.bad")'), null);
  });

  test('a second tab: clean tabs follow a save, and a tab with unsaved edits is asked what to do instead of overwriting', async () => {
    const a = await open();
    const b = await open();
    await a.click('[data-segment="s7"]');
    await b.click('[data-segment="s7"]');
    await a.fill('#f-text', 'When it fills, what happens depends on the product you use.');
    await waitSave(a, 'saved');
    await b.waitFor(`document.querySelector('#f-text').value === 'When it fills, what happens depends on the product you use.'`, 6000, 'the clean tab to follow the save');
    // now A has an unsaved edit while someone else commits first
    await a.fill('#f-text', 'When it fills, A wrote this.');
    const cur = (await call('GET', '/api/episodes/context-window')).json;
    const doc = structuredClone(cur.doc);
    doc.narration.segments.find((s: any) => s.id === 's7').text = 'When it fills, B wrote this.';
    delete doc.narration.segments.find((s: any) => s.id === 's7').emphasis;
    assert.equal((await call('PUT', '/api/episodes/context-window', {doc, baseSeq: cur.seq, tab: 'other'})).status, 200);
    await a.waitFor('document.querySelector("[data-save]").dataset.save === "conflict"', 6000, 'a conflict');
    assert.match(await a.eval('document.querySelector(".notice.bad").innerText'), /newer saved version[\s\S]*kept here/);
    assert.equal(await field(a, '#f-text'), 'When it fills, A wrote this.', 'A is not overwritten silently');
    assert.equal(await segText('s7'), 'When it fills, B wrote this.', 'and A did not overwrite B');
    await shot(a, '06-conflict.png');
    await a.click('.notice.bad .btn:nth-of-type(2)'); // use the saved version
    await waitSave(a, 'saved');
    assert.equal(await field(a, '#f-text'), 'When it fills, B wrote this.');
    // second round: keep mine
    await a.fill('#f-text', 'When it fills, A wrote this again.');
    const cur2 = (await call('GET', '/api/episodes/context-window')).json;
    const doc2 = structuredClone(cur2.doc);
    doc2.narration.segments.find((s: any) => s.id === 's7').text = 'When it fills, B wrote it again.';
    delete doc2.narration.segments.find((s: any) => s.id === 's7').emphasis;
    await call('PUT', '/api/episodes/context-window', {doc: doc2, baseSeq: cur2.seq, tab: 'other'});
    await a.waitFor('document.querySelector("[data-save]").dataset.save === "conflict"', 6000);
    await a.click('.notice.bad .btn:nth-of-type(1)'); // keep my edits
    await waitSave(a, 'saved');
    assert.equal(await segText('s7'), 'When it fills, A wrote this again.');
  });

  test('a server killed without warning loses nothing that was saved, shows the failure for what is not, and recovers by itself', {timeout: 90000}, async () => {
    const t = await open();
    await t.click('[data-segment="s8"]');
    await t.fill('#f-text', 'Some stop. Others drop the older text.');
    await waitSave(t, 'saved');
    const committed = await call('GET', '/api/episodes/context-window');
    const port = srv.port;
    await srv.kill('SIGKILL');
    // an edit while the server is gone
    await t.fill('#f-text', 'Some stop. Others drop the oldest text.');
    await waitSave(t, 'failed', 8000);
    await t.waitFor('document.querySelector(".notice.warn")?.innerText.includes("Lost connection")', 15000, 'the lost-connection notice');
    assert.equal(await field(t, '#f-text'), 'Some stop. Others drop the oldest text.', 'the edit is kept in the page');
    await shot(t, '07-server-down.png');
    // restart on the same workspace and port: the committed data is intact (stale lock and all)
    srv = await spawnServer(w, port);
    const after = await call('GET', '/api/episodes/context-window');
    assert.equal(after.json.seq, committed.json.seq);
    assert.equal(await segText('s8'), 'Some stop. Others drop the older text.', 'what was saved before the crash is there');
    // the page notices, tells the author, and saves the edit it was holding
    await waitSave(t, 'saved', 30000);
    assert.equal(await segText('s8'), 'Some stop. Others drop the oldest text.');
    assert.match(await t.eval('document.body.innerText'), /The app was restarted/);
  });

  test('no console errors, and the only refused requests were the ones the tests provoked', () => {
    assert.deepEqual(problems, []);
    // two injected commit failures (500) and two deliberate conflicts (409); nothing else was refused
    assert.deepEqual(refused.sort(), ['409', '409', '500', '500']);
  });
});
