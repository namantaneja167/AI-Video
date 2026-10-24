// The next-episode workflow on a DISPOSABLE project, through the real page in a real browser:
// create an idea -> enter a hook and a script -> configure scenes -> preview the branded opening -> render -> inspect and download the
// matching cover -> change only the hook -> see the video and cover go out of date while narration, timing and audio are reused ->
// rebuild -> new matching cover -> (simulated sign-offs, disposable project only) approve and export -> restart -> check again.
//
// REAL here: the page and server, the project store and job runner, the timeline logic (Python), the audio mix with the opening chime
// (Python + ffmpeg), the Remotion render and the Remotion still of the cover, the dependency hashes, export and checksums.
// FAKE here: only the voice model and the forced aligner (a stand-in audio worker writes deterministic speech-like audio and the timing is
// the labelled estimate). Nothing here says how the narration sounds or whether the words are right.
//   node scripts/verify_next_episode.ts          (it creates and removes /tmp/p9-next-episode; it touches no other project)
import assert from 'node:assert/strict';
import {execFileSync, spawnSync} from 'node:child_process';
import {copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {JobService} from '../app/jobs.ts';
import {createApp} from '../app/server.ts';
import {DIST, buildUi} from '../app/build.ts';
import {ROOT, configureProject, createProject} from '../app/workspace.ts';
import {approve} from '../core/artifacts.ts';
import {blobPath} from '../core/blobs.ts';
import {verifyPackage} from '../core/export.ts';
import {Project} from '../core/project.ts';
import {ProductionSlot} from '../core/slot.ts';
import {currentRows, setComponent} from '../core/state.ts';
import {voiceRuntimeValue} from '../core/toolchain.ts';
import {Chrome, type Tab} from '../tests/app/harness.ts';
import {createEpisodeThroughUi, type Content} from '../tests/app/planner-scenario.ts';
import {FAKE_AUDIO, jobOptions} from '../tests/app/jobs-fixture.ts';
import {SIGNED} from '../tests/store/helpers.ts';

void configureProject;
const WORK = '/tmp/p9-next-episode';
const projectRoot = join(WORK, 'project');
const OUT = resolve(ROOT, 'docs/studio/pip-opening-evidence');
mkdirSync(OUT, {recursive: true});
rmSync(WORK, {recursive: true, force: true});
mkdirSync(WORK, {recursive: true});
const log = (...a: unknown[]) => console.log(new Date().toISOString().slice(11, 19), ...a);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const sel = (id: string) => `[data-testid="${id}"]`;
const text = (t: Tab, q: string) => t.eval<string>(`document.querySelector(${JSON.stringify(q)})?.innerText ?? ''`);
const sha = (f: string) => createHash('sha256').update(readFileSync(f)).digest('hex');

const HOOK1 = 'Chats forget their own start';
const HOOK2 = 'Long chats lose their start';
const CONTENT: Content = {
  title: 'Why a long chat loses its beginning (disposable check)',
  audience: 'People who use chat assistants',
  objective: 'Know that a model sees only a limited window of text, so long chats lose their start',
  durationMin: '1',
  researchBroken: JSON.stringify({studioPacket: 1, sources: [{title: 'Author outline'}], claims: [{text: 'A model has a limit.', kind: 'rumor'}]}, null, 2),
  research: JSON.stringify({studioPacket: 1, sources: [{title: 'Author outline', note: 'My own notes; no external source'}], claims: [{text: 'A model can only use a limited amount of text at once.', kind: 'fact', sources: [0], evidence: 'Author outline', caveat: 'The limit differs between models'}]}, null, 2),
  script: 'A model can only hold so much text at once. That limit is called its context window.\n\nWhen a chat grows past the limit, the oldest words fall out of view. The model cannot use what it can no longer see.\n\nSo in a long chat, repeat what matters.',
  adjust: {row: 2, text: 'When a chat grows past the limit, the oldest words fall out of view.'},
  storyboardReady: true,
  storyboard: JSON.stringify({studioPacket: 1, kind: 'storyboard', storyboard: {scenes: [
    {segments: [1, 2], sceneType: 'pip-cards', intention: 'A model holds a limited amount of text', mechanism: 'Two cards', pip: ['Pip points at each card'],
      params: {cards: [{heading: 'Only so much', body: 'A model keeps a limited amount of text in view.', at: {segment: 0, word: 'much'}}, {heading: 'The context window', body: 'That limit has a name.', at: {segment: 1, word: 'window'}}], actions: [{do: 'point', card: 0, at: {segment: 0, word: 'text'}}, {do: 'point', card: 1, at: {segment: 1, word: 'window'}}, {do: 'nod', at: {segment: 1, edge: 'end'}}]}},
    {segments: [3, 4], sceneType: 'pip-cards', intention: 'Old words fall out of view', mechanism: 'Three cards', pip: ['Pip looks at the first card, then hops'],
      params: {cards: [{heading: 'A long chat', body: 'The chat grows past the limit.', at: {segment: 0, word: 'grows'}}, {heading: 'Old words drop out', body: 'The oldest words are no longer in view.', at: {segment: 0, word: 'oldest'}}, {heading: 'Not seen, not used', body: 'The model cannot use what it cannot see.', at: {segment: 1, word: 'cannot'}}], actions: [{do: 'look', card: 0, at: {segment: 0, edge: 'start'}}, {do: 'hop', at: {segment: 1, word: 'longer'}}]}},
    {segments: [5], sceneType: 'pip-cards', intention: 'What to do about it', mechanism: 'One card', pip: [],
      params: {cards: [{heading: 'Repeat what matters', body: 'Say the important part again.', at: {segment: 0, word: 'repeat'}}], actions: [{do: 'look', card: 0, at: {segment: 0, word: 'matters'}}, {do: 'smile', at: {segment: 0, edge: 'end'}}]}},
  ]}}, null, 2),
};

const run: Record<string, any> = {ranAt: new Date().toISOString(), disposableProject: projectRoot, real: ['page and server', 'project store and job runner', 'timeline logic (Python)', 'audio mix with accents (Python + ffmpeg)', 'Remotion render', 'Remotion still (cover)', 'dependency hashes, freshness, export, checksums'], fake: ['voice model (stand-in audio worker)', 'forced aligner (labelled estimate)', 'sign-offs for the export step (simulated in this disposable project only)'], steps: []};
const step = (name: string, extra: Record<string, unknown> = {}) => { run.steps.push({name, ...extra}); log(name, JSON.stringify(extra).slice(0, 240)); };

// ---- the project and the app (fake narration only) -------------------------------------------------------------------------------
await buildUi();
createProject(projectRoot, 'Disposable: next-episode check');
process.env.FAKE_SEC_PER_WORD = '0.01';
const slot = new ProductionSlot();
type Live = {p: Project; jobs: JobService; app: ReturnType<typeof createApp>; base: string; token: string};
async function boot(): Promise<Live> {
  const p = Project.open(projectRoot);
  setComponent(p, 'voiceRuntime', voiceRuntimeValue(p, {profile: 'pip-voice-v1', repo: 'fake/model', revision: 'rev-1', mlxAudio: '0.0.0', mlx: '0.0.0', maxTokens: 600, audioWorker: FAKE_AUDIO}));
  setComponent(p, 'aligner', {id: 'estimated'});
  const jobs = new JobService(jobOptions(p, projectRoot, {
    env: {root: ROOT, qwenPython: join(ROOT, '.venv-qwen/bin/python'), python: join(ROOT, '.venv/bin/python'), audioWorker: FAKE_AUDIO, renderConcurrency: 2},
    runner: {pollMs: 500, killGraceMs: 1500, memory: undefined}, slot: {slot, project: 'Disposable next-episode check', projectRoot},
  }));
  const app = createApp({project: p, projectRoot, workspaceLabel: 'Disposable', jobs, distDir: DIST, publicDir: resolve(ROOT, 'public'), port: 0});
  const port = await app.start();
  return {p, jobs, app, base: `http://127.0.0.1:${port}`, token: app.token};
}
let live = await boot();
const call = async (method: string, path: string, body?: unknown) => {
  const res = await fetch(`${live.base}${path}`, {method, headers: {cookie: `studio_token=${live.token}`, 'x-studio': '1', 'content-type': 'application/json', connection: 'close'}, body: body === undefined ? undefined : JSON.stringify(body)});
  const buf = Buffer.from(await res.arrayBuffer());
  let json: any = null;
  try { json = JSON.parse(buf.toString()); } catch { /* not JSON */ }
  return {status: res.status, json, buf, headers: res.headers};
};
const get = async (path: string) => (await call('GET', path)).json;
const arts = (kinds = ['take', 'timing', 'mix']) => Object.fromEntries(currentRows(live.p, ID).filter((r) => kinds.includes(r.kind)).map((r) => [`${r.kind}:${r.subject}`, r.artifact_id]));

const chrome = await Chrome.launch();
let ID = '';
try {
  const t = await chrome.tab();
  await t.viewport(1280, 900, 1);
  const shot = (name: string) => t.screenshot(join(OUT, `${name}.png`));
  const nav = async (q: string) => { await t.goto(`${live.base}/?${q}`); await sleep(300); };
  await t.goto(`${live.base}/?token=${live.token}`);
  await t.waitFor('document.querySelector(".ttl")', 30000, 'the app');

  // 1. an idea, a brief, research, a script, a storyboard: the normal flow (the hook comes with the script)
  const seen = await createEpisodeThroughUi(t, CONTENT, async (n) => { if (['2-brief', '7-script-accepted'].includes(n)) await shot(`01-${n}`); });
  ID = seen.planId;
  const plan0 = await get(`/api/plans/${ID}`);
  assert.equal(plan0.plan.brand, 'pip-explains');
  const op0 = await get(`/api/episodes/${ID}/opening`);
  const doc0 = (await get(`/api/episodes/${ID}`)).doc;
  const mix0 = live.p.db.prepare("SELECT value_json FROM components WHERE scope=? AND name='mixParams'").get(ID) as any;
  step('new episode defaults', {style: doc0.style, hook: op0.hook, chimeCount: op0.signature.count, soundEvents: JSON.parse((live.p.db.prepare("SELECT value_json FROM components WHERE scope=? AND name='soundEvents'").get(ID) as any).value_json), mixParams: JSON.parse(mix0.value_json), titleStaysDescriptive: doc0.title});
  assert.equal(doc0.style, 'pip-paper-bundled');
  assert.equal(op0.signature.count, 1);
  assert.equal(op0.hook, null);
  const blockers0 = (await get(`/api/episodes/${ID}/plan`)).blockers.map((b: any) => b.message);
  assert.ok(blockers0.some((m: string) => /opening hook is not set/.test(m)), 'a Pip Explains episode without a hook cannot be built');
  step('hook is required before the first build', {blockers: blockers0.slice(0, 2)});

  // 2. enter the hook on the Script step (validation first, then the real hook)
  await nav(`plan=${ID}&tab=script`);
  await t.waitFor(`document.querySelector('${sel('opening-card')}')`, 20000, 'the hook card');
  await t.fill(sel('hook-input'), 'x'.repeat(49));
  await t.waitFor(`document.querySelector('${sel('hook-problems')}')`, 5000, 'the length message');
  run.invalidHookMessage = await text(t, sel('hook-problems'));
  assert.match(run.invalidHookMessage, /48/);
  assert.equal(await t.eval(`document.querySelector('${sel('hook-save')}').disabled`), true);
  await t.fill(sel('hook-input'), HOOK1);
  await t.waitFor(`document.querySelector('${sel('opening-preview')}')?.innerText.includes('PIP EXPLAINS')`, 20000, 'the opening preview');
  await shot('02-script-hook-preview');
  await t.click(sel('hook-save'));
  await t.waitFor(`document.querySelector('${sel('hook-saved')}')`, 15000, 'the hook saved');
  const saved = (await get(`/api/episodes/${ID}`)).doc;
  assert.equal(saved.scenes[0].openingHook, HOOK1);
  assert.equal(saved.title, CONTENT.title, 'the descriptive title is a separate field');
  step('hook entered on the Script step', {hook: saved.scenes[0].openingHook, title: saved.title, chime: await text(t, sel('signature-state'))});

  // 3. scenes: apply the storyboard (the hook is carried onto the real first scene), then look at the Scenes step
  await nav(`plan=${ID}&tab=storyboard`);
  await t.waitFor(`document.querySelector('${sel('apply-preview')}')`, 20000, 'apply');
  await t.click(sel('apply-preview'));
  await t.waitFor(`document.querySelector('${sel('apply-changes')}')`, 20000, 'the preview');
  await t.click(sel('apply-go'));
  await t.waitFor(`document.querySelector('${sel('applied-chip')}')`, 30000, 'applied');
  const applied = (await get(`/api/episodes/${ID}`)).doc;
  assert.equal(applied.scenes[0].type, 'pip-cards');
  assert.equal(applied.scenes[0].openingHook, HOOK1, 'applying the storyboard kept the hook');
  await nav(`plan=${ID}&tab=scenes`);
  await t.waitFor(`document.querySelector('${sel('typeface-card')}') && document.querySelector('${sel('opening-card')}')`, 20000, 'the scenes step');
  assert.equal(await t.eval(`document.querySelector('${sel('hook-input')}').value`), HOOK1);
  await t.waitFor(`document.querySelector('${sel('opening-preview')}')?.innerText.includes('PIP EXPLAINS')`, 20000, 'the opening preview');
  const previewText = await text(t, sel('opening-preview'));
  assert.ok(previewText.includes('PIP EXPLAINS') && previewText.toUpperCase().includes('CHATS FORGET'), previewText);
  await shot('03-scenes-hook-and-preview');
  step('scenes configured; the shared opening shows in the preview', {scenes: applied.scenes.map((s: any) => s.type), hookKept: applied.scenes[0].openingHook, previewShows: ['PIP EXPLAINS', HOOK1]});
  assert.ok(!(await get(`/api/episodes/${ID}/plan`)).blockers.length, 'nothing stands in the way of the first build');

  // 4. render: the real timeline, mix (with the chime) and Remotion render, started from the Review page
  await nav(`review=${ID}`);
  await t.waitFor(`document.querySelector('${sel('review-screen')}')`, 30000, 'the review screen');
  const build = async (label: string) => {
    const t0 = Date.now();
    await t.click(sel('make-final'));
    await t.waitFor(`document.querySelector('${sel('plan-dialog')}')`, 15000, 'the plan');
    await t.waitFor(`(() => { const b = document.querySelector('${sel('plan-start')}'); return !!b && !b.disabled; })()`, 60000, 'the plan to load');
    const rows = await t.eval<string[]>(`[...document.querySelectorAll('${sel('plan-table')} tr[data-step]')].map((r) => r.dataset.step + ':' + r.dataset.action)`);
    await t.click(sel('plan-start'));
    await t.waitFor(`document.querySelector('${sel('review-screen')}')?.dataset.busy === 'yes'`, 30000, 'the build to start');
    await t.waitFor(`document.querySelector('${sel('review-screen')}')?.dataset.busy === 'no'`, 25 * 60_000, 'the build to finish');
    step(label, {wallSec: Math.round((Date.now() - t0) / 100) / 10, plan: rows});
    return rows;
  };
  const rows1 = await build('first final video (real timing, mix, render)');
  const final1 = currentRows(live.p, ID).find((r) => r.kind === 'render' && r.subject === 'final')!;
  const mixRow = currentRows(live.p, ID).find((r) => r.kind === 'mix' && r.subject === 'final')!;
  const mixMeta = JSON.parse(mixRow.meta_json) as {used?: {accents?: {accent: string; t: number}[]}};
  const accents = mixMeta.used?.accents ?? [];
  assert.equal(accents.length, 1, 'the chime is mixed exactly once');
  assert.deepEqual([accents[0].accent, accents[0].t], ['chime', 0.12]);
  step('the chime in the delivered mix', {accents});
  const narrationAfterFirst = arts();

  // 5. inspect and download the matching cover
  await nav(`review=${ID}`);
  await t.waitFor(`document.querySelector('${sel('cover-card')}')`, 20000, 'the cover card');
  assert.equal(await t.eval(`document.querySelector('${sel('cover-card')}').dataset.state`), 'none');
  await shot('04-review-before-cover');
  await t.click(sel('make-cover'));
  await t.waitFor(`document.querySelector('${sel('cover-card')}')?.dataset.state === 'fresh'`, 5 * 60_000, 'the cover');
  await t.waitFor(`document.querySelector('${sel('cover-image')}')?.complete && document.querySelector('${sel('cover-image')}').naturalWidth > 0`, 20000, 'the cover image');
  const size = await t.eval<[number, number]>(`(() => { const i = document.querySelector('${sel('cover-image')}'); return [i.naturalWidth, i.naturalHeight]; })()`);
  assert.deepEqual(size, [1080, 1920]);
  await shot('05-review-with-cover');
  const view1 = await get(`/api/episodes/${ID}/review`);
  const cv1 = view1.selected.cover;
  const dl = await call('GET', cv1.downloadUrl);
  assert.equal(dl.status, 200);
  assert.match(dl.headers.get('content-disposition') ?? '', /attachment; filename="[a-z0-9-]+-cover\.png"/);
  assert.equal(createHash('sha256').update(dl.buf).digest('hex'), cv1.fileSha256, 'the download is the stored cover, byte for byte');
  const coverFile1 = join(WORK, 'cover1.png');
  writeFileSync(coverFile1, dl.buf);
  const frameFile = join(WORK, 'video-frame-20.png');
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', blobPath(live.p, final1.blob_hash), '-vf', 'select=eq(n\\,20)', '-vframes', '1', frameFile]);
  const filter = (f: string) => { const r = spawnSync('ffmpeg', ['-v', 'info', '-i', coverFile1, '-i', frameFile, '-lavfi', f, '-f', 'null', '-'], {encoding: 'utf8'}); return `${r.stdout}${r.stderr}`; };
  const above = (m: string) => `[0:v]crop=1080:1500:0:0[a];[1:v]crop=1080:1500:0:0[b];[a][b]${m}`; // everything above the caption band (y 1520 and below)
  const psnr = filter('psnr'), ssimOut = filter('ssim'), psnrAbove = filter(above('psnr')), ssimAbove = filter(above('ssim'));
  copyFileSync(frameFile, join(OUT, 'disposable-video-frame-20.png'));
  step('cover drawn and downloaded', {state: cv1.state, hook: cv1.hook, belongsToVideoSha256: cv1.renderSha256, sameAsVideoFile: cv1.renderSha256 === final1.blob_hash, pngSize: size, bytes: dl.buf.length, downloadSha256: createHash('sha256').update(dl.buf).digest('hex'), contentDisposition: dl.headers.get('content-disposition')});
  run.coverVersusVideoFrame20 = {note: 'measured; the video frame is H.264-compressed and may carry a caption, the cover is a lossless still without captions', wholeFrame: {psnrDb: Number(/average:([\d.]+)/.exec(psnr)?.[1]), ssim: Number(/All:([\d.]+)/.exec(ssimOut)?.[1])}, aboveCaptionBand_y0to1500: {psnrDb: Number(/average:([\d.]+)/.exec(psnrAbove)?.[1]), ssim: Number(/All:([\d.]+)/.exec(ssimAbove)?.[1])}};
  log('cover vs video frame 20', JSON.stringify(run.coverVersusVideoFrame20));
  copyFileSync(coverFile1, join(OUT, 'disposable-cover-1.png'));

  // 6. change ONLY the hook (Scenes step): the video and cover go out of date, the rest is reused
  await nav(`plan=${ID}&tab=scenes`);
  await t.waitFor(`document.querySelector('${sel('hook-input')}')`, 20000, 'the hook card');
  await t.fill(sel('hook-input'), HOOK2);
  await t.click(sel('hook-save'));
  await t.waitFor(`document.querySelector('${sel('hook-msg')}')?.dataset.tone === 'ok'`, 15000, 'the hook saved');
  const stale = await get(`/api/episodes/${ID}/review`);
  const planAfterHook = await get(`/api/episodes/${ID}/plan`);
  const runs = planAfterHook.steps.filter((s: any) => s.action === 'run').map((s: any) => s.key);
  assert.deepEqual(runs, ['render:final'], 'only the video has to be rebuilt');
  assert.equal(stale.videos.find((v: any) => v.renderArtifactId === final1.artifact_id).cover.state, 'outdated');
  assert.equal(stale.videos.find((v: any) => v.renderArtifactId === final1.artifact_id).fresh, false);
  await nav(`review=${ID}`);
  await t.waitFor(`document.querySelector('${sel('cover-outdated')}')`, 20000, 'the outdated notice');
  run.outdatedNotice = await text(t, sel('cover-outdated'));
  assert.equal(await t.eval(`!!document.querySelector('${sel('download-cover')}')`), false, 'an outdated cover is not offered for download');
  await shot('06-review-outdated');
  step('hook-only edit', {rebuildPlanRuns: runs, planSteps: planAfterHook.steps.map((s: any) => `${s.key}:${s.action}`), coverState: 'outdated', videoFresh: false, outdatedNotice: run.outdatedNotice});
  const rows2 = await build('second final video (video only)');
  assert.deepEqual(rows2.filter((r) => r.endsWith(':run')), ['render:final:run']);
  const narrationAfterSecond = arts();
  assert.deepEqual(narrationAfterSecond, narrationAfterFirst, 'the same takes, timing and mix artifacts');
  const jobs = (await get(`/api/jobs?episode=${ID}`)).jobs.map((j: any) => j.kind);
  const final2 = currentRows(live.p, ID).find((r) => r.kind === 'render' && r.subject === 'final')!;
  assert.notEqual(final2.artifact_id, final1.artifact_id);
  step('rebuild after the hook edit reused narration, timing and audio', {narrationJobsEver: jobs.filter((k: string) => k === 'tts.block').length, timingJobsEver: jobs.filter((k: string) => k === 'timing.build').length, mixJobsEver: jobs.filter((k: string) => k === 'mix.final').length, renderJobsEver: jobs.filter((k: string) => k === 'render.final').length, sameArtifacts: arts()});
  await nav(`review=${ID}`);
  await t.waitFor(`document.querySelector('${sel('cover-card')}')?.dataset.state === 'none'`, 20000, 'the new video has no cover yet');
  await t.click(sel('make-cover'));
  await t.waitFor(`document.querySelector('${sel('cover-card')}')?.dataset.state === 'fresh'`, 5 * 60_000, 'the new cover');
  const cv2 = (await get(`/api/episodes/${ID}/review`)).selected.cover;
  assert.notEqual(cv2.fileSha256, cv1.fileSha256);
  assert.equal(cv2.renderSha256, final2.blob_hash);
  assert.equal(cv2.hook, HOOK2);
  await t.waitFor(`document.querySelector('${sel('cover-image')}')?.complete && document.querySelector('${sel('cover-image')}').naturalWidth > 0`, 20000);
  await shot('07-review-new-cover');
  copyFileSync(join(WORK, 'cover1.png'), join(WORK, 'cover1-keep.png'));
  writeFileSync(join(OUT, 'disposable-cover-2.png'), (await call('GET', cv2.downloadUrl)).buf);
  step('new matching cover', {hook: cv2.hook, belongsToVideoSha256: cv2.renderSha256, differentFromFirst: cv2.fileSha256 !== cv1.fileSha256});
  assert.equal((await get(`/api/episodes/${ID}/review`)).videos.find((v: any) => v.renderArtifactId === final1.artifact_id).cover.state, 'outdated', 'the first cover stays with the first video');

  // 7. approve (simulated sign-offs, disposable project only) and export: the cover is in the package
  approve(live.p, ID, SIGNED);
  const exp = await call('POST', `/api/episodes/${ID}/review/export`, {tab: 'x'});
  assert.equal(exp.status, 200, JSON.stringify(exp.json));
  const dir: string = exp.json.result.dir;
  const files = exp.json.result.files as {name: string; role: string; sha256: string}[];
  const coverEntry = files.find((f) => f.role === 'cover')!;
  assert.ok(coverEntry && coverEntry.sha256 === cv2.fileSha256 && sha(join(dir, coverEntry.name)) === cv2.fileSha256);
  const meta = JSON.parse(readFileSync(join(dir, 'metadata.json'), 'utf8'));
  assert.equal(meta.cover.belongsToVideoSha256, files.find((f) => f.role === 'video')!.sha256);
  assert.ok(verifyPackage(dir).ok);
  step('export package (approval simulated in this disposable project)', {files: files.map((f) => `${f.role}:${f.name}`), coverSha256: coverEntry.sha256, packageVerified: true, metadataCover: meta.cover});

  // 8. restart: close everything, reopen the project, look again
  await t.goto('about:blank');
  await live.app.stop(); await live.jobs.shutdown(); live.p.close();
  live = await boot();
  await t.goto(`${live.base}/?token=${live.token}`);
  await nav(`plan=${ID}&tab=scenes`);
  await t.waitFor(`document.querySelector('${sel('hook-input')}')`, 20000, 'the hook card after the restart');
  await t.waitFor(`document.querySelector('${sel('hook-input')}').value === ${JSON.stringify(HOOK2)}`, 10000, 'the saved hook');
  assert.equal(await text(t, sel('signature-state')), 'On, once');
  await nav(`review=${ID}`);
  await t.waitFor(`document.querySelector('${sel('cover-card')}')?.dataset.state === 'fresh'`, 20000, 'the cover after the restart');
  await t.waitFor(`document.querySelector('${sel('cover-image')}')?.complete && document.querySelector('${sel('cover-image')}').naturalWidth === 1080`, 20000, 'the cover image after the restart');
  const after = (await get(`/api/episodes/${ID}/review`)).selected.cover;
  assert.equal(after.fileSha256, cv2.fileSha256);
  assert.equal(after.renderSha256, cv2.renderSha256);
  step('after a restart', {hook: HOOK2, chime: 'On, once', coverState: after.state, sameCover: after.fileSha256 === cv2.fileSha256, sameVideo: after.renderSha256 === cv2.renderSha256});

  // 9. the chime cannot be doubled
  const again = await call('POST', `/api/episodes/${ID}/opening`, {signature: true, tab: 'x'});
  const again2 = await call('POST', `/api/episodes/${ID}/opening`, {signature: true, tab: 'x'});
  assert.deepEqual([again.json.changed, again2.json.changed, again2.json.signature.count], [false, false, 1]);
  step('duplicate chime prevention', {secondRequest: 'changed: false', count: again2.json.signature.count, mixedAccents: accents.length});
  run.browser = {consoleErrors: t.consoleErrors.slice(0, 5), failedRequests: t.failedRequests.slice(0, 5)};
  run.result = 'every assertion in this script passed';
} finally {
  await chrome.close().catch(() => undefined);
  try { await live.app.stop(); await live.jobs.shutdown(); live.p.close(); } catch { /* already closed */ }
  slot.releaseAll();
  writeFileSync(join(OUT, 'run.json'), JSON.stringify(run, null, 2));
  rmSync(WORK, {recursive: true, force: true});
}
console.log(JSON.stringify({steps: run.steps.length, coverVersusVideoFrame20: run.coverVersusVideoFrame20, result: run.result}, null, 1));
void existsSync;
