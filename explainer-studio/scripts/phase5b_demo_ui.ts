// Phase 5B demonstration on the persistent demo workspace, through the real app in a real (headless) browser: a SEPARATE new draft
// goes from a pasted research answer and script to a valid Pip-cards storyboard, the storyboard is previewed and applied to the
// episode, one card is edited in the Scenes step, and the production preflight is read. It is the same steps as the browser test
// in tests/app/planner.slow.test.ts. The app must already be running (./studio-app). Nothing is narrated or rendered, and no job is
// started; the approved baseline episode and the earlier demo episode are only read.
//   node scripts/phase5b_demo_ui.ts
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {ROOT, DEMO_PROJECT} from '../app/demo.ts';
import {Chrome} from '../tests/app/harness.ts';
import {createEpisodeThroughUi} from '../tests/app/planner-scenario.ts';
import {READY_CONTENT, applyAndAdjustThroughUi} from '../tests/app/scenes-scenario.ts';

const PORT = 4317;
const token = readFileSync(join(DEMO_PROJECT, '.studio', 'app-token'), 'utf8').trim();
const base = `http://127.0.0.1:${PORT}`;
const OUT = resolve(ROOT, 'docs/studio/phase5b-evidence');
mkdirSync(OUT, {recursive: true});

const call = async (path: string) => (await fetch(`${base}${path}`, {headers: {cookie: `studio_token=${token}`}})).json() as Promise<any>;
const library = await call('/api/library');
const TITLE = 'Tokens in pieces';
if (library.items.some((i: any) => i.title === TITLE)) throw new Error(`the demo workspace already has "${TITLE}"; nothing was changed`);

const baselineBefore = await call('/api/episodes/context-window');
const otherBefore = await call('/api/episodes/what-is-a-token');
const content = READY_CONTENT({title: TITLE, audience: 'Curious beginners who have seen the context window episode', durationMin: '1'});

const chrome = await Chrome.launch();
try {
  const t = await chrome.tab();
  await t.viewport(1280, 800, 1);
  await t.goto(`${base}/?token=${token}`);
  await t.waitFor('document.querySelector(".ttl")', 30000, 'the app to appear');
  const shot = async (name: string) => t.screenshot(join(OUT, `demo-${name}.png`));
  const seen = await createEpisodeThroughUi(t, content, shot);
  const before = await call(`/api/episodes/${seen.planId}`);
  const s = await applyAndAdjustThroughUi(t, seen.planId, shot);
  const after = await call(`/api/episodes/${seen.planId}`);
  const plan = await call(`/api/plans/${seen.planId}`);
  const rebuildPlan = await call(`/api/episodes/${seen.planId}/plan`);
  const jobs = await call(`/api/jobs?episode=${seen.planId}`);
  const revs = (await call(`/api/episodes/${seen.planId}/revisions`)).revisions;
  const baselineAfter = await call('/api/episodes/context-window');
  const otherAfter = await call('/api/episodes/what-is-a-token');
  const result = {
    ranAt: new Date().toISOString(), planId: seen.planId, scriptRows: seen.rowsBeforeAccept, requestsOutsideThisApp: seen.external,
    consoleErrors: t.consoleErrors, failedRequests: t.failedRequests,
    applyPreview: s.changesText, appliedChip: s.appliedChip, compositionPreviewLabel: s.previewLabel, sceneKinds: s.kinds, savedMessage: s.savedMessage,
    narrationUnchangedByApply: JSON.stringify(before.doc.narration) === JSON.stringify(after.doc.narration),
    scenesNow: after.doc.scenes.map((x: any) => ({id: x.id, type: x.type, segments: x.segments, layout: x.layout?.template, cards: x.params?.cards?.map((c: any) => c.heading), actions: x.params?.actions?.map((a: any) => a.do)})),
    revisions: revs.map((r: any) => ({number: r.number, kind: r.kind, label: r.label})),
    productionPreflight: {blockers: rebuildPlan.blockers, steps: rebuildPlan.steps.map((x: any) => `${x.label}: ${x.action}`), notes: rebuildPlan.notes},
    jobsForThisDraft: jobs.jobs.length,
    plan: {producible: plan.check.producible, applied: plan.plan.applied},
    baseline: {before: {seq: baselineBefore.seq, docHash: baselineBefore.docHash}, after: {seq: baselineAfter.seq, docHash: baselineAfter.docHash}, unchanged: baselineBefore.docHash === baselineAfter.docHash && baselineBefore.seq === baselineAfter.seq},
    otherDemoEpisodeUnchanged: otherBefore.docHash === otherAfter.docHash && otherBefore.seq === otherAfter.seq,
  };
  writeFileSync(join(OUT, 'demo-run.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify({planId: result.planId, applyPreview: result.applyPreview, blockers: result.productionPreflight.blockers, jobs: result.jobsForThisDraft, baselineUnchanged: result.baseline.unchanged, otherUnchanged: result.otherDemoEpisodeUnchanged, narrationUnchangedByApply: result.narrationUnchangedByApply, consoleErrors: t.consoleErrors.length, failed: t.failedRequests, outside: seen.external.length}, null, 1));
} finally {
  await chrome.close();
}
