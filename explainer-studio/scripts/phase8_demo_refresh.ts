// After the render sources changed in Phase 8 (the probe now waits for the bundled fonts), the Phase 7 demo's videos were listed as out of date.
// This remakes them through the app's own routes (narration is reused; no job but timing-free renders and checks runs), re-runs the production
// checks, and records whether the bytes are the same. It opens no round, ticks nothing, approves and exports nothing.
//   node scripts/phase8_demo_refresh.ts
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {ROOT, DEMO_PROJECT} from '../app/demo.ts';

const ID = 'voice-demo-prompts';
const base = 'http://127.0.0.1:4317';
const token = readFileSync(join(DEMO_PROJECT, '.studio', 'app-token'), 'utf8').trim();
const OUT = resolve(ROOT, 'docs/studio/phase8-evidence/demo-refresh');
mkdirSync(OUT, {recursive: true});
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const call = async (method: string, path: string, body?: unknown) => {
  const r = await fetch(`${base}${path}`, {method, headers: {cookie: `studio_token=${token}`, 'x-studio': '1', 'content-type': 'application/json', connection: 'close'}, body: body === undefined ? undefined : JSON.stringify(body)});
  return {status: r.status, json: await r.json().catch(() => null) as any};
};
const active = async () => ((await call('GET', `/api/jobs?episode=${ID}`)).json.jobs as any[]).some((j) => ['queued', 'preparing', 'running', 'cancelling'].includes(j.state));
const waitIdle = async (what: string) => { for (const end = Date.now() + 10 * 60_000; Date.now() < end; await sleep(1000)) { if (!(await active())) return; } throw new Error(`timed out waiting for ${what}`); };
if (await active()) throw new Error('work is already running for this draft');

const before = (await call('GET', `/api/episodes/${ID}/review`)).json;
const beforeInfo = {videos: before.videos.map((v: any) => [v.kind, v.fileSha256, v.fresh, v.isCurrent, v.round?.number ?? null]), approval: before.approval.state, signoffsTicked: before.signoffs.filter((s: any) => s.ticked).length, notes: before.notes.length};
const baseline = (await call('GET', '/api/episodes/context-window')).json;
const record: Record<string, any> = {ranAt: new Date().toISOString(), before: beforeInfo, rebuilds: []};
for (const mode of ['draft', 'final'] as const) {
  const plan = (await call('GET', `/api/episodes/${ID}/plan${mode === 'draft' ? '?mode=draft' : ''}`)).json;
  const steps = plan.steps.map((s: any) => `${s.key}:${s.action}`);
  if (plan.nothingToDo) { record.rebuilds.push({mode, steps, skipped: 'already up to date'}); continue; }
  const seq = (await call('GET', `/api/episodes/${ID}`)).json.seq;
  const t0 = Date.now();
  const r = await call('POST', `/api/episodes/${ID}/rebuild`, {seq, requestId: `req-${Date.now().toString(36)}-${mode}`, mode});
  if (r.status !== 202) throw new Error(`${mode} rebuild refused: ${JSON.stringify(r.json)}`);
  await sleep(1500);
  await waitIdle(`the ${mode} rebuild`);
  record.rebuilds.push({mode, steps, wallSec: Math.round((Date.now() - t0) / 100) / 10});
  console.log(`${mode} rebuilt: ${(Date.now() - t0) / 1000} s`, steps.join(', '));
}
const view = (await call('GET', `/api/episodes/${ID}/review`)).json;
record.checks = {};
for (const kind of ['draft', 'final']) {
  const row = view.videos.find((v: any) => v.kind === kind && v.isCurrent);
  if (!row) continue;
  const t0 = Date.now();
  await call('POST', `/api/episodes/${ID}/review/checks`, {renderArtifactId: row.renderArtifactId});
  await sleep(1500);
  await waitIdle(`the ${kind} checks`);
  const v = (await call('GET', `/api/episodes/${ID}/review?render=${row.renderArtifactId}`)).json;
  record.checks[kind] = {renderArtifactId: row.renderArtifactId, fileSha256: v.report.fileSha256, summary: v.report.summary, passed: v.report.passed, wallSec: Math.round((Date.now() - t0) / 100) / 10, warnings: v.report.items.filter((i: any) => i.status === 'warn').map((i: any) => `${i.id}: ${i.detail}`)};
  console.log(`${kind} checks:`, JSON.stringify(v.report.summary), 'sha', v.report.fileSha256.slice(0, 8));
}
const after = (await call('GET', `/api/episodes/${ID}/review`)).json;
record.after = {videos: after.videos.map((v: any) => [v.kind, v.fileSha256, v.fresh, v.isCurrent, v.round?.number ?? null]), approval: after.approval.state, signoffsTicked: after.signoffs.filter((s: any) => s.ticked).length, notes: after.notes.length, exportPossible: after.exports.canExport};
const baselineAfter = (await call('GET', '/api/episodes/context-window')).json;
record.baselineUnchanged = baseline.docHash === baselineAfter.docHash && baseline.seq === baselineAfter.seq;
record.newestVideosHaveTheSameBytesAsBefore = ['draft', 'final'].every((k) => before.videos.find((v: any) => v.kind === k && v.isCurrent)?.fileSha256 === after.videos.find((v: any) => v.kind === k && v.isCurrent)?.fileSha256);
writeFileSync(join(OUT, 'demo-refresh.json'), JSON.stringify(record, null, 2) + '\n');
console.log(JSON.stringify({baselineUnchanged: record.baselineUnchanged, sameBytes: record.newestVideosHaveTheSameBytesAsBefore, approval: record.after.approval, signoffs: record.after.signoffsTicked}));
