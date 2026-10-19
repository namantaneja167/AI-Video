// Phase 8 recovery and relocation check on a REAL project that a running app has open: make a backup through the app, restore it into a fresh
// path somewhere else, start a second app on the restored copy, and compare what the two apps say about every episode (documents, history,
// selected takes, videos by SHA-256, notes, rounds and approval records). Then damage copies of the backup and show each is refused.
// Nothing in the original project is changed except that one backup folder is written next to it.
//   node scripts/phase8_restore_check.ts <projectDir> <port of the running app> <evidence name>
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {restoreBackup, verifyBackup} from '../core/backup.ts';
import {ROOT} from '../app/workspace.ts';

const [projectArg, portArg, name] = process.argv.slice(2);
if (!projectArg || !portArg || !name) throw new Error('usage: node scripts/phase8_restore_check.ts <projectDir> <port> <evidence name>');
const projectDir = resolve(projectArg);
const liveBase = `http://127.0.0.1:${portArg}`;
const tokenOf = (dir: string) => readFileSync(join(dir, '.studio', 'app-token'), 'utf8').trim();
const OUT = resolve(ROOT, 'docs/studio/phase8-evidence/recovery');
mkdirSync(OUT, {recursive: true});
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const get = async (base: string, token: string, path: string) => {
  const r = await fetch(`${base}${path}`, {headers: {cookie: `studio_token=${token}`}});
  return {status: r.status, json: await r.json().catch(() => null) as any, bytes: r.status === 200 && !(r.headers.get('content-type') ?? '').includes('json') ? Buffer.from(await r.arrayBuffer()) : null};
};
const bytesOf = async (base: string, token: string, path: string) => { const r = await fetch(`${base}${path}`, {headers: {cookie: `studio_token=${token}`}}); return {status: r.status, bytes: Buffer.from(await r.arrayBuffer())}; };

const record: Record<string, any> = {ranAt: new Date().toISOString(), project: '(real project, path not recorded)', steps: []};
const step = (what: string, ok: boolean, detail?: unknown) => { record.steps.push({what, ok, detail}); console.log(ok ? 'ok  ' : 'FAIL', what, detail === undefined ? '' : JSON.stringify(detail).slice(0, 200)); };

const liveToken = tokenOf(projectDir);
// 1. a backup made by the running app
const t0 = Date.now();
const b = await fetch(`${liveBase}/api/project/backup`, {method: 'POST', headers: {cookie: `studio_token=${liveToken}`, 'x-studio': '1', 'content-type': 'application/json'}, body: '{}'});
const made = await b.json() as any;
step('a backup was made by the running app and verified', b.status === 200 && made.verified === true, {seconds: (Date.now() - t0) / 1000, files: made.files, blobs: made.blobs, bytes: made.bytes});
if (b.status !== 200) throw new Error(JSON.stringify(made));
record.backup = {name: made.name, bytes: made.bytes, blobs: made.blobs};

// 2. restored into a fresh place that is not under this checkout or the original's folder
const parent = mkdtempSync(join(tmpdir(), 'studio-relocated-'));
const restored = join(parent, 'a different place', 'restored project');
const r0 = Date.now();
const report = restoreBackup(made.dir, restored);
step('restored into a fresh path', existsSync(join(restored, '.studio', 'project.sqlite')), {seconds: (Date.now() - r0) / 1000, missingBlobs: report.missingBlobs, interruptedJobs: report.interruptedJobs});
record.restoreReport = {missingBlobs: report.missingBlobs, interruptedJobs: report.interruptedJobs};

// 3. a second app on the restored copy
const child = spawn(process.execPath, [join(ROOT, 'app', 'main.ts'), 'open', restored, '--no-open', '--port', '0'], {cwd: ROOT, stdio: ['ignore', 'pipe', 'inherit']});
const url: string = await new Promise((res, rej) => { let buf = ''; child.stdout!.on('data', (d: Buffer) => { buf += d; const m = /Open: (http:\/\/127\.0\.0\.1:\d+)\//.exec(buf); if (m) res(m[1]); }); child.once('exit', (c) => rej(new Error(`the restored app exited with ${c}`))); });
const restToken = tokenOf(restored);
try {
  const lib = (await get(liveBase, liveToken, '/api/library')).json.items as {id: string}[];
  const libR = (await get(url, restToken, '/api/library')).json.items as {id: string}[];
  step('the same episodes are listed', JSON.stringify(lib.map((i) => i.id).sort()) === JSON.stringify(libR.map((i) => i.id).sort()), lib.map((i) => i.id));
  const rows: any[] = [];
  for (const {id} of lib) {
    const live = (await get(liveBase, liveToken, `/api/episodes/${id}`)).json;
    const rest = (await get(url, restToken, `/api/episodes/${id}`)).json;
    const row: Record<string, unknown> = {id};
    if (!live?.doc) { rows.push({id, note: 'no episode document (a planning draft)'}); continue; }
    row.document = JSON.stringify(live.doc) === JSON.stringify(rest.doc) && live.docHash === rest.docHash;
    const lrev = (await get(liveBase, liveToken, `/api/episodes/${id}/revisions`)).json.revisions.map((x: any) => [x.number, x.kind, x.docHash]);
    const rrev = (await get(url, restToken, `/api/episodes/${id}/revisions`)).json.revisions.map((x: any) => [x.number, x.kind, x.docHash]);
    row.revisions = JSON.stringify(lrev) === JSON.stringify(rrev) ? lrev.length : 'DIFFERENT';
    const lv = (await get(liveBase, liveToken, `/api/episodes/${id}/review`)).json;
    const rv = (await get(url, restToken, `/api/episodes/${id}/review`)).json;
    const vids = (v: any) => (v?.videos ?? []).map((x: any) => [x.kind, x.fileSha256, x.checks?.state, x.checks?.passed, x.round?.number ?? null, x.isCurrent]);
    row.videos = JSON.stringify(vids(lv)) === JSON.stringify(vids(rv)) ? vids(lv).length : {live: vids(lv), restored: vids(rv)};
    row.notes = JSON.stringify((lv?.notes ?? []).map((n: any) => [n.note.id, n.note.status, n.note.text])) === JSON.stringify((rv?.notes ?? []).map((n: any) => [n.note.id, n.note.status, n.note.text]));
    row.approval = JSON.stringify([lv?.approval?.state, lv?.approval?.fileSha256, lv?.signoffs]) === JSON.stringify([rv?.approval?.state, rv?.approval?.fileSha256, rv?.signoffs]);
    // every video of the restored project plays back as the same bytes
    const fileChecks: boolean[] = [];
    for (const x of rv?.videos ?? []) { const f = await bytesOf(url, restToken, x.url); fileChecks.push(f.status === 200 && sha(f.bytes) === x.fileSha256); }
    row.videoBytesMatchTheirHash = fileChecks.length ? fileChecks.every(Boolean) : 'no videos';
    // selected takes
    const lvoice = (await get(liveBase, liveToken, `/api/episodes/${id}/voice`)).json;
    const rvoice = (await get(url, restToken, `/api/episodes/${id}/voice`)).json;
    const takes = (v: any) => (v?.blocks ?? []).map((bl: any) => [bl.id, bl.status, (bl.takes ?? []).filter((t: any) => t.selected).map((t: any) => t.number)]);
    row.selectedTakes = JSON.stringify(takes(lvoice)) === JSON.stringify(takes(rvoice)) ? takes(lvoice) : {live: takes(lvoice), restored: takes(rvoice)};
    const tk: boolean[] = [];
    for (const bl of rvoice?.blocks ?? []) for (const tkn of bl.takes ?? []) { const lb = (lvoice.blocks.find((x: any) => x.id === bl.id)?.takes ?? []).find((t: any) => t.number === tkn.number); if (!lb) continue; const a = await bytesOf(liveBase, liveToken, lb.audioUrl ?? lb.url); const c = await bytesOf(url, restToken, tkn.audioUrl ?? tkn.url); tk.push(a.status === 200 && c.status === 200 && sha(a.bytes) === sha(c.bytes)); }
    row.takeAudioBytesEqual = tk.length ? tk.every(Boolean) : 'no takes';
    rows.push(row);
  }
  record.episodes = rows;
  const bad = rows.filter((r) => Object.values(r).some((v) => v === false || (v && typeof v === 'object' && !Array.isArray(v) && 'live' in (v as object)) || v === 'DIFFERENT'));
  step('every episode compares equal between the original and the restored copy', bad.length === 0, rows);
  record.restoredWorksAsAProject = (await get(url, restToken, '/api/project')).json?.root === restored;
  step('the restored app reports its own new location, not the original', record.restoredWorksAsAProject);
} finally {
  child.kill('SIGTERM');
  await new Promise((r) => child.once('exit', r));
}

// 4. damaged copies of the backup are refused, each into its own empty target, and leave nothing behind
const damaged: Record<string, string> = {};
const bk = (label: string, mutate: (dir: string) => void) => {
  const copy = join(parent, `damaged-${label}`);
  cpSync(made.dir, copy, {recursive: true});
  const files = (d: string): string[] => readdirSync(d, {withFileTypes: true}).flatMap((e) => (e.isDirectory() ? files(join(d, e.name)) : [join(d, e.name)]));
  mutate(copy);
  const target = join(parent, `into-${label}`);
  let outcome = 'RESTORED (unexpected)';
  try { restoreBackup(copy, target); } catch (e) { outcome = `refused: ${(e as Error).message.split('\n')[0].slice(0, 120)}`; }
  damaged[label] = outcome + (existsSync(target) ? ' [LEFT A FOLDER BEHIND]' : '');
  void files;
};
const firstBlob = (dir: string) => { const d = join(dir, 'blobs'); const a = readdirSync(d)[0]; return join(d, a, readdirSync(join(d, a))[0]); };
bk('one-changed-byte', (d) => { const f = firstBlob(d); chmodSync(f, 0o644); const buf = readFileSync(f); buf[0] ^= 0xff; writeFileSync(f, buf); });
bk('a-missing-file', (d) => { const f = firstBlob(d); chmodSync(f, 0o644); rmSync(f); });
bk('no-manifest', (d) => rmSync(join(d, 'manifest.json')));
bk('truncated-database', (d) => { const f = join(d, 'project.sqlite'); writeFileSync(f, readFileSync(f).subarray(0, 4096)); });
record.damagedBackups = damaged;
step('every damaged copy of the backup is refused and leaves nothing behind', Object.values(damaged).every((v) => v.startsWith('refused') && !v.includes('LEFT')), damaged);
// restoring into a non-empty folder
mkdirSync(join(parent, 'busy'));
writeFileSync(join(parent, 'busy', 'mine.txt'), 'x');
let busy = 'RESTORED (unexpected)';
try { restoreBackup(made.dir, join(parent, 'busy')); } catch (e) { busy = `refused: ${(e as Error).message.slice(0, 80)}`; }
step('restoring into a folder that has files in it is refused', busy.startsWith('refused') && readFileSync(join(parent, 'busy', 'mine.txt'), 'utf8') === 'x', busy);
step('the original backup is still intact', verifyBackup(made.dir).problems.length === 0);
writeFileSync(join(OUT, `${name}.json`), JSON.stringify(record, null, 2) + '\n');
rmSync(parent, {recursive: true, force: true});
console.log(record.steps.every((s: any) => s.ok) ? '\nall steps ok' : '\nSOME STEPS FAILED');
process.exit(record.steps.every((s: any) => s.ok) ? 0 : 1);
void sleep;
