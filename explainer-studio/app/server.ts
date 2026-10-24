// The local app server: node:http on 127.0.0.1 only, with a token cookie, Host and Origin checks, a JSON API over core/ and the
// job service, audio and video with byte ranges, and server-sent events. Saving never starts work; only an explicit rebuild does.
import {randomBytes, timingSafeEqual} from 'node:crypto';
import {createReadStream, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync} from 'node:fs';
import {createServer, type IncomingMessage, type Server, type ServerResponse} from 'node:http';
import {basename, dirname, join} from 'node:path';
import {ApprovalError, statusReport} from '../core/artifacts.ts';
import {ExportError} from '../core/export.ts';
import {ReviewError} from '../core/review.ts';
import {blobPath} from '../core/blobs.ts';
import {ensureOpeningSignature, openingSignature, OPENING_SIGNATURE, removeOpeningSignature} from '../core/brand.ts';
import {coverFor} from '../core/cover.ts';
import {SoundSettingsError} from '../core/soundSettings.ts';
import {createBackup, verifyBackup} from '../core/backup.ts';
import {checkEnvironment} from '../core/environment.ts';
import {SCHEMA_VERSION, all, get, readSchemaVersion} from '../core/db.ts';
import {ConflictError, UnknownEpisodeError, ValidationError, getEpisode, getEpisodeInfo, getRevision, listEpisodes, listRevisions, saveEpisode} from '../core/episodes.ts';
import type {Project} from '../core/project.ts';
import {readMeasuredRuns} from './demo.ts';
import {displayBuild, listBuilds, parseBuildId, pickDefault} from './builds.ts';
import {RebuildError, type JobService} from './jobs.ts';
import {animaticFor} from '../core/animatic.ts';
import {proofsFor} from '../core/proof.ts';
import {VoiceError, VoiceService} from './voice.ts';
import {ReviewService} from './review.ts';
import {PreflightError} from '../core/runner.ts';
import {ApplyError, ImportStateError, LinkError, linkPlanToEpisode, PlanConflictError, PlanValidationError, UnknownPlanError, acceptImport, applyStoryboard, createPlan, getImport, getPlan, listImports, listPlanIds, listPlanRevisions, planExists, previewApplication, rejectImport, restorePlanRevision, savePlan, submitImport} from './planning.ts';
import {ImportError, type Selection} from './shared/importing.ts';
import {checkStoryboard, isPlaceholderEpisode} from './shared/storyboard.ts';
import {revisionKindLabel, shortSummary, summarizeChange} from './shared/revisions.ts';

export type AppOptions = {
  project: Project;
  /** Directory of the project (for the persisted token and the measured runs). */
  projectRoot: string;
  /** Shown in the UI: where the workspace lives. */
  workspaceLabel: string;
  /** The seeded demo or a user's own project (default: demo, as the tests were written). */
  kind?: 'demo' | 'project';
  distDir: string;
  publicDir: string;
  port?: number;
  /** Tests only: when this file exists, saves fail inside the transaction (nothing is committed). */
  faultFile?: string;
  /** Rebuilds and the jobs tray. Without it the app edits and previews only. */
  jobs?: JobService;
  /** Where export packages are written (default: <projectRoot>/exports). */
  exportsRoot?: string;
  /** How long stop() lets requests already in progress finish before cutting them off. */
  stopGraceMs?: number;
};

const ASSET_TYPES: Record<string, string> = {'.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8', '.woff2': 'font/woff2', '.wav': 'audio/wav', '.mp4': 'video/mp4', '.map': 'application/json'};
const ext = (p: string) => (p.match(/\.[a-z0-9]+$/i)?.[0] ?? '').toLowerCase();

function loadToken(projectRoot: string): string {
  const f = join(projectRoot, '.studio', 'app-token');
  if (existsSync(f)) return readFileSync(f, 'utf8').trim();
  mkdirSync(join(projectRoot, '.studio'), {recursive: true});
  const t = randomBytes(24).toString('hex');
  writeFileSync(f, t + '\n', {mode: 0o600});
  return t;
}

const safeEq = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const json = (res: ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, {'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store'});
  res.end(JSON.stringify(body));
};
const page = (res: ServerResponse, status: number, title: string, text: string) => {
  res.writeHead(status, {'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store'});
  res.end(`<!doctype html><meta charset="utf-8"><title>${title}</title><body style="font:16px -apple-system,sans-serif;max-width:34em;margin:12vh auto;padding:0 1em;color:#1F1D1A;background:#F5F2EA"><h2>${title}</h2><p>${text}</p>`);
};

export type App = {server: Server; token: string; start(): Promise<number>; stop(): Promise<void>; url(): string; serverId: string};

export function createApp(o: AppOptions): App {
  const p = o.project;
  const jobs = o.jobs;
  const voice = jobs ? new VoiceService(jobs) : null;
  const review = jobs ? new ReviewService(jobs, {exportsRoot: o.exportsRoot ?? join(o.projectRoot, 'exports'), libraryRoot: join(o.publicDir, 'library')}) : null;
  const token = loadToken(o.projectRoot);
  const serverId = randomBytes(6).toString('hex');
  const startedAt = Date.now();
  const clients = new Set<ServerResponse>();
  let port = o.port ?? 0;

  const hostOk = (req: IncomingMessage) => {
    const h = (req.headers.host ?? '').toLowerCase();
    return h === `127.0.0.1:${port}` || h === `localhost:${port}`;
  };
  const cookieToken = (req: IncomingMessage) => /(?:^|;\s*)studio_token=([a-f0-9]+)/.exec(req.headers.cookie ?? '')?.[1] ?? '';

  const broadcast = (event: string, data: unknown) => {
    for (const c of clients) c.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };
  const stopListening = jobs?.onChange(() => broadcast('jobs', {at: Date.now()}));

  const readBody = (req: IncomingMessage): Promise<any> =>
    new Promise((resolve, reject) => {
      let size = 0;
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => {
        size += c.length;
        if (size > 2_000_000) { reject(new Error('request too large')); req.destroy(); } else chunks.push(c);
      });
      req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch { reject(new Error('the request body is not valid JSON')); } });
      req.on('error', reject);
    });

  function sendFile(req: IncomingMessage, res: ServerResponse, file: string, type: string) {
    const size = statSync(file).size;
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '');
    const headers: Record<string, string | number> = {'content-type': type, 'accept-ranges': 'bytes', 'cache-control': 'no-store'};
    if (range && (range[1] || range[2])) {
      const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
      const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
      if (start >= size || start > end) { res.writeHead(416, {'content-range': `bytes */${size}`}); res.end(); return; }
      res.writeHead(206, {...headers, 'content-range': `bytes ${start}-${end}/${size}`, 'content-length': end - start + 1});
      if (req.method === 'HEAD') { res.end(); return; }
      createReadStream(file, {start, end}).pipe(res);
      return;
    }
    res.writeHead(200, {...headers, 'content-length': size});
    if (req.method === 'HEAD') { res.end(); return; }
    createReadStream(file).pipe(res);
  }

  // ---- what the preview is built from ------------------------------------------------------------------------------
  function episodePayload(id: string, requestedBuild: string | null = null) {
    const doc = getEpisode(p, id);
    const info = getEpisodeInfo(p, id);
    const status = statusReport(p, id);
    const builds = listBuilds(p, id);
    const shown = displayBuild(p, id, builds, requestedBuild, status);
    const current = pickDefault(builds, status);
    const build = shown && {
      id: shown.info.id, timingArtifactId: shown.info.timingId, mixArtifactId: shown.info.mixId, builtAt: shown.info.builtAt, revision: shown.info.revision, imported: shown.info.imported,
      source: null, builtDoc: shown.builtDoc, timeline: shown.timeline, audio: shown.audio, render: shown.render, isLatest: shown.info.id === current?.id, matchesLatestEdits: shown.matchesLatestEdits, outdatedFlag: shown.info.outdatedFlag,
    };
    return {
      doc, seq: info.seq, docHash: info.docHash, status, build, planned: planExists(p, id), renderDrift: jobs && builds.length ? jobs.renderDrift(id) : [],
      builds: builds.map((b) => ({id: b.id, revision: b.revision, builtAt: b.builtAt, imported: b.imported, outdatedFlag: b.outdatedFlag, hasVideo: !!b.render, isLatest: b.id === current?.id, shown: b.id === shown?.info.id, hasFinalVideo: b.render?.kind === 'final', videoRevision: b.render?.revision ?? null, timingRevision: b.timingRevision})),
      rebuilds: !!jobs, active: jobs?.activeWork(id) ?? null, animatic: animaticFor(p, id),
    };
  }

  function revisionRows(id: string) {
    const revs = listRevisions(p, id);
    const cur = getEpisodeInfo(p, id).docHash;
    const builtAt = new Map<number, string[]>();
    for (const r of all<{revision_number: number; kind: string}>(p.db.prepare('SELECT DISTINCT revision_number, kind FROM artifacts WHERE episode_id=? AND revision_number IS NOT NULL'), id)) {
      builtAt.set(r.revision_number, [...(builtAt.get(r.revision_number) ?? []), r.kind]);
    }
    let prev: ReturnType<typeof getRevision> | null = null;
    const rows = revs.map((r) => {
      const doc = getRevision(p, id, r.number);
      const lines = summarizeChange(prev, doc);
      prev = doc;
      return {number: r.number, kind: r.kind, kindLabel: revisionKindLabel(r.kind, r.label), label: r.label, createdAt: r.createdAt, docHash: r.docHash, summary: lines, short: shortSummary(lines), isCurrent: r.docHash === cur, builds: builtAt.get(r.number) ?? []};
    });
    return rows.reverse();
  }

  // ---- the planning workspace: drafts, research, imports --------------------------------------------------------------
  function planPayload(id: string) {
    const stored = getPlan(p, id);
    const has = listEpisodes(p).includes(id);
    const doc = has ? getEpisode(p, id) : null;
    const segments = doc?.narration.segments ?? [];
    return {
      plan: stored.plan, seq: stored.seq, updatedAt: stored.updatedAt,
      episode: doc ? {seq: getEpisodeInfo(p, id).seq, segments: segments.map((s) => ({id: s.id, text: s.text, speech: s.speech ?? null})), standIn: isPlaceholderEpisode(doc)} : null,
      imports: listImports(p, id),
      check: checkStoryboard(stored.plan, segments),
    };
  }
  const libraryItems = () => {
    const eps = new Set(listEpisodes(p));
    const plans = new Set(listPlanIds(p));
    return [...new Set([...eps, ...plans])].map((id) => {
      const stored = plans.has(id) ? getPlan(p, id) : null;
      const doc = eps.has(id) ? getEpisode(p, id) : null;
      const built = eps.has(id) && listBuilds(p, id).length > 0;
      return {
        id, title: stored?.plan.title ?? doc!.title, hasPlan: !!stored, hasEpisode: !!doc, segments: doc?.narration.segments.length ?? null, built,
        objective: stored?.plan.objective ?? doc?.learningObjective ?? '', audience: stored?.plan.audience ?? '', durationMin: stored?.plan.durationMin ?? null,
        sources: stored?.plan.sources.length ?? 0, claims: stored?.plan.claims.length ?? 0, scenes: stored?.plan.storyboard.length ?? 0,
        updatedAt: stored?.updatedAt ?? Number(get<{updated_at: number}>(p.db.prepare('SELECT updated_at FROM episodes WHERE id=?'), id)?.updated_at ?? 0),
      };
    }).sort((a, b) => b.updatedAt - a.updatedAt);
  };
  function planFailure(res: ServerResponse, e: unknown, id: string) {
    p.hooks.beforeCommit = undefined;
    if (e instanceof PlanConflictError || e instanceof ConflictError) return json(res, 409, {error: 'conflict', message: 'This was changed somewhere else since you opened it. Nothing was saved or accepted; the current version is shown.', current: planExists(p, id) ? planPayload(id) : null});
    if (e instanceof PlanValidationError || e instanceof ValidationError) return json(res, 422, {error: 'invalid', message: e.message, issues: e.issues});
    if (e instanceof ApplyError) return json(res, 422, {error: 'apply-blocked', message: e.message, problems: e.problems});
    if (e instanceof ImportError) return json(res, 422, {error: 'import-blocked', message: e.message});
    if (e instanceof ImportStateError) return json(res, 409, {error: 'import-resolved', message: e.message});
    if (e instanceof UnknownPlanError) return json(res, 404, {error: 'not-found', message: e.message});
    return json(res, 500, {error: 'failed', message: (e as Error).message});
  }
  const importPayload = (id: string, n: number) => {
    const imp = getImport(p, id, n);
    const stored = getPlan(p, id);
    const has = listEpisodes(p).includes(id);
    return {import: imp, plan: stored.plan, planSeq: stored.seq, episode: has ? {seq: getEpisodeInfo(p, id).seq, doc: getEpisode(p, id)} : null};
  };

  function saveFailure(res: ServerResponse, e: unknown, id: string) {
    p.hooks.beforeCommit = undefined;
    if (e instanceof ConflictError) return json(res, 409, {error: 'conflict', message: 'Someone else saved a newer version of this episode.', current: episodePayload(id)});
    if (e instanceof ValidationError) return json(res, 422, {error: 'invalid', message: e.message, issues: e.issues});
    return json(res, 500, {error: 'save-failed', message: (e as Error).message});
  }

  // ---- routes --------------------------------------------------------------------------------------------------------
  async function route(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`);
    const path = decodeURIComponent(url.pathname);
    const method = req.method ?? 'GET';

    if (!hostOk(req)) return page(res, 403, 'Not allowed', 'This app only answers requests addressed to 127.0.0.1 or localhost on its own port.');
    const queryToken = url.searchParams.get('token');
    if (method === 'GET' && path === '/' && queryToken && safeEq(queryToken, token)) {
      res.writeHead(302, {location: '/', 'set-cookie': `studio_token=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=31536000`, 'cache-control': 'no-store'});
      return void res.end();
    }
    if (!safeEq(cookieToken(req), token)) {
      if (path.startsWith('/api/')) return json(res, 401, {error: 'unauthorized', message: 'This browser session is not signed in. Open the app with ./studio-app.'});
      return page(res, 401, 'Open this app from the launcher', 'Run <code>./studio-app</code> in the explainer-studio folder; it opens the app with a fresh sign-in link.');
    }
    if (method !== 'GET' && method !== 'HEAD') {
      const origin = req.headers.origin;
      if (req.headers['x-studio'] !== '1' || (origin && origin !== `http://${req.headers.host}`)) return json(res, 403, {error: 'forbidden', message: 'Request was not sent by the app page.'});
    }

    // media: only builds' audio and videos, the bundled fonts and the silent track
    if (path.startsWith('/media/')) {
      const parts = path.split('/').slice(2);
      if (parts[0] === 'generated' && parts.length === 4) {
        if (!listEpisodes(p).includes(parts[1])) return json(res, 404, {error: 'not-found'});
        const want = parseBuildId(parts[2]);
        const build = listBuilds(p, parts[1]).find((b) => b.id === parts[2]);
        if (!want || !build) return json(res, 404, {error: 'not-found'});
        const mix = get<{blob_hash: string}>(p.db.prepare('SELECT blob_hash FROM artifacts WHERE id=?'), build.mixId);
        const timing = get<{blob_hash: string}>(p.db.prepare('SELECT blob_hash FROM artifacts WHERE id=?'), build.timingId);
        if (!mix || !timing || JSON.parse(readFileSync(blobPath(p, timing.blob_hash), 'utf8')).audio !== parts[3]) return json(res, 404, {error: 'not-found'});
        return sendFile(req, res, blobPath(p, mix.blob_hash), 'audio/wav');
      }
      if (parts[0] === 'animatic' && parts.length === 3 && parts[2] === 'opening.mp4') {
        if (!listEpisodes(p).includes(parts[1])) return json(res, 404, {error: 'not-found'});
        const an = animaticFor(p, parts[1]);
        if (!an.fileSha256 || !existsSync(blobPath(p, an.fileSha256))) return json(res, 404, {error: 'not-found'});
        return sendFile(req, res, blobPath(p, an.fileSha256), 'video/mp4');
      }
      if (parts[0] === 'proof' && parts.length === 3 && /^\d+\.mp4$/.test(parts[2])) {
        if (!listEpisodes(p).includes(parts[1])) return json(res, 404, {error: 'not-found'});
        const pr = proofsFor(p, parts[1]).find((x) => x.artifactId === Number(parts[2].slice(0, -4)));
        if (!pr || !existsSync(blobPath(p, pr.fileSha256))) return json(res, 404, {error: 'not-found'});
        return sendFile(req, res, blobPath(p, pr.fileSha256), 'video/mp4');
      }
      if (parts[0] === 'cover' && parts.length === 3 && /^\d+\.png$/.test(parts[2])) {
        // the cover of one video of the episode named in the address, and only while its file is in the project
        const rid = Number(parts[2].slice(0, -4));
        if (!listEpisodes(p).includes(parts[1])) return json(res, 404, {error: 'not-found'});
        const cv = (() => { try { return coverFor(p, parts[1], rid); } catch { return null; } })();
        if (!cv?.fileSha256 || !existsSync(blobPath(p, cv.fileSha256))) return json(res, 404, {error: 'not-found'});
        if (url.searchParams.get('download') === '1') { res.setHeader('content-disposition', `attachment; filename="${parts[1]}-cover.png"`); }
        return sendFile(req, res, blobPath(p, cv.fileSha256), 'image/png');
      }
      if (parts[0] === 'render' && parts.length === 3 && /^\d+\.mp4$/.test(parts[2])) {
        const a = get<{blob_hash: string; kind: string; episode_id: string}>(p.db.prepare('SELECT blob_hash, kind, episode_id FROM artifacts WHERE id=?'), Number(parts[2].slice(0, -4)));
        if (!a || a.kind !== 'render' || a.episode_id !== parts[1] || !existsSync(blobPath(p, a.blob_hash))) return json(res, 404, {error: 'not-found'});
        return sendFile(req, res, blobPath(p, a.blob_hash), 'video/mp4');
      }
      if ((parts[0] === 'take' || parts[0] === 'sample') && parts.length === 3 && /^\d+\.wav$/.test(parts[2])) {
        // a saved take of a block, or the voice-only listening sample (the draft mix): only of the episode named in the address
        const a = get<{blob_hash: string; kind: string; subject: string; episode_id: string}>(p.db.prepare('SELECT blob_hash, kind, subject, episode_id FROM artifacts WHERE id=?'), Number(parts[2].slice(0, -4)));
        const ok = !!a && a.episode_id === parts[1] && (parts[0] === 'take' ? a.kind === 'take' : a.kind === 'mix' && a.subject === 'draft') && existsSync(blobPath(p, a.blob_hash));
        if (!ok) return json(res, 404, {error: 'not-found'});
        return sendFile(req, res, blobPath(p, a!.blob_hash), 'audio/wav');
      }
      if (parts[0] === 'library' && parts[1] === 'silence.wav' && parts.length === 2) return sendFile(req, res, join(o.publicDir, 'library', 'silence.wav'), 'audio/wav');
      if (parts[0] === 'library' && parts[1] === 'fonts' && parts.length === 3) {
        const allowed = (JSON.parse(readFileSync(join(o.publicDir, 'library', 'fonts', 'manifest.json'), 'utf8')).files as {file: string}[]).map((f) => f.file);
        if (!allowed.includes(parts[2])) return json(res, 404, {error: 'not-found'});
        return sendFile(req, res, join(o.publicDir, 'library', 'fonts', parts[2]), 'font/woff2');
      }
      return json(res, 404, {error: 'not-found'});
    }

    if (path === '/api/events') {
      res.writeHead(200, {'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive'});
      res.write(`event: hello\ndata: ${JSON.stringify({serverId, startedAt})}\n\n`);
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return;
    }
    if (path === '/api/health') return json(res, 200, {ok: true, serverId});
    if (path === '/api/session') {
      return json(res, 200, {serverId, startedAt, workspace: o.workspaceLabel, rebuilds: !!jobs, episodes: listEpisodes(p).map((id) => ({id, title: getEpisode(p, id).title, seq: getEpisodeInfo(p, id).seq})), demo: (o.kind ?? 'demo') === 'demo', kind: o.kind ?? 'demo'});
    }
    // ---- the project: where it is, how to back it up, and what this machine has --------------------------------------------------
    if (path === '/api/project' && method === 'GET') {
      const backupsDir = `${o.projectRoot}-backups`;
      const backups = existsSync(backupsDir) ? readdirSync(backupsDir).filter((n) => existsSync(join(backupsDir, n, 'manifest.json'))).sort().reverse().map((n) => {
        try {
          const m = JSON.parse(readFileSync(join(backupsDir, n, 'manifest.json'), 'utf8')) as {createdAt: number; files: {bytes: number}[]};
          return {name: n, createdAt: m.createdAt, bytes: m.files.reduce((a, f) => a + f.bytes, 0), files: m.files.length};
        } catch { return {name: n, createdAt: 0, bytes: 0, files: 0}; }
      }) : [];
      const row = (k: string) => (p.db.prepare('SELECT value FROM meta WHERE key=?').get(k) as {value: string} | undefined)?.value;
      return json(res, 200, {name: row('project_name') ?? basename(o.projectRoot), kind: o.kind ?? 'demo', root: o.projectRoot, createdAt: Number(row('created_at')) || null, schemaVersion: readSchemaVersion(p.db), appSchemaVersion: SCHEMA_VERSION, episodes: listEpisodes(p).length, node: process.version, platform: `${process.platform} ${process.arch}`, backupsDir, backups, automaticBackups: existsSync(join(o.projectRoot, '.studio', 'backups')) ? readdirSync(join(o.projectRoot, '.studio', 'backups')).length : 0});
    }
    if (path === '/api/project/backup' && method === 'POST') {
      const dir = join(`${o.projectRoot}-backups`, `backup-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}`);
      try {
        const s = createBackup(p, dir, {includeDrafts: true});
        const v = verifyBackup(dir);
        if (!v.ok) return json(res, 500, {error: 'backup-failed', message: `The backup was written to ${dir} but did not verify (${v.problems.slice(0, 2).join('; ')}). Do not rely on it; try again.`});
        return json(res, 200, {name: basename(dir), dir, blobs: s.blobs, files: s.files, bytes: s.bytes, verified: true, restoreCommand: `node scripts/project.ts restore "${dir}" <an empty folder>`});
      } catch (e) {
        return json(res, 500, {error: 'backup-failed', message: `The backup could not be made: ${(e as Error).message}. Nothing in the project was changed.`});
      }
    }
    if (path === '/api/environment' && method === 'GET') {
      return json(res, 200, {checks: checkEnvironment(dirname(o.publicDir), {projectRoot: o.projectRoot, deep: url.searchParams.get('deep') === '1'})});
    }
    if (path === '/api/measured') return json(res, 200, jobs?.measuredRuns() ?? readMeasuredRuns(o.projectRoot) ?? {version: 1, runs: []});
    if (path === '/api/ui') {
      if (method === 'GET') return json(res, 200, Object.fromEntries(all<{key: string; value: string}>(p.db.prepare("SELECT key, value FROM ui_state WHERE key LIKE 'app.%'")).map((r) => [r.key, r.value])));
      if (method === 'PUT') {
        const b = await readBody(req);
        if (!/^app\.[A-Za-z0-9_.:-]{1,80}$/.test(String(b.key)) || typeof b.value !== 'string' || b.value.length > 500) return json(res, 400, {error: 'bad-request', message: 'unknown preference'});
        p.setUiState(b.key, b.value);
        return json(res, 200, {ok: true});
      }
    }

    // ---- jobs ------------------------------------------------------------------------------------------------------
    if (path === '/api/jobs' && method === 'GET') {
      if (!jobs) return json(res, 200, {available: false, jobs: [], rebuilds: [], slot: null});
      const ep = url.searchParams.get('episode');
      return json(res, 200, {available: true, jobs: jobs.list(ep ?? undefined), rebuilds: ep ? jobs.rebuilds(ep) : [], slot: jobs.slotView()});
    }
    const jobAct = /^\/api\/jobs\/(\d+)\/(cancel|retry)$/.exec(path);
    if (jobAct && method === 'POST') {
      if (!jobs) return json(res, 404, {error: 'not-found'});
      const id = Number(jobAct[1]);
      try {
        if (jobAct[2] === 'cancel') await jobs.cancel(id); else jobs.retry(id);
        return json(res, 200, {ok: true, job: jobs.list().find((j) => j.id === id)});
      } catch (e) {
        if (e instanceof RebuildError) return json(res, 409, {error: e.code, message: e.message});
        return json(res, 409, {error: 'not-allowed', message: (e as Error).message});
      }
    }
    const rbAct = /^\/api\/rebuilds\/(rb-[a-z0-9]+)\/(continue|cancel)$/.exec(path);
    if (rbAct && method === 'POST') {
      if (!jobs) return json(res, 404, {error: 'not-found'});
      try {
        if (rbAct[2] === 'cancel') await jobs.cancelRebuild(rbAct[1]); else jobs.continueRebuild(rbAct[1]);
        return json(res, 200, {ok: true});
      } catch (e) {
        if (e instanceof RebuildError) return json(res, 409, {error: e.code, message: e.message});
        return json(res, 500, {error: 'failed', message: (e as Error).message});
      }
    }

    // ---- planning: drafts, research, storyboard, imports ----------------------------------------------------------------
    if (path === '/api/library' && method === 'GET') return json(res, 200, {items: libraryItems()});
    const pl = /^\/api\/plans(?:\/([a-z0-9][a-z0-9_-]*)(?:\/(revisions|restore|imports|apply)(?:\/(\d+)(?:\/(accept|reject))?)?)?)?$/.exec(path);
    if (pl) {
      const id = pl[1];
      const sub = pl[2];
      try {
        if (!id) {
          if (method !== 'POST') return json(res, 405, {error: 'method-not-allowed'});
          const b = await readBody(req);
          const made = createPlan(p, {title: b.title, audience: b.audience, objective: b.objective, durationMin: b.durationMin ?? null, ...(b.brand === 'pip-explains' ? {brand: 'pip-explains' as const} : {})});
          broadcast('plan', {planId: made.plan.id, seq: made.seq, tab: String(b.tab ?? '')});
          return json(res, 201, planPayload(made.plan.id));
        }
        if (!planExists(p, id)) return json(res, 404, {error: 'not-found', message: `No plan "${id}" in this workspace.`});
        if (!sub) {
          if (method === 'GET') return json(res, 200, planPayload(id));
          if (method === 'PUT') {
            const b = await readBody(req);
            if (typeof b.baseSeq !== 'number') return json(res, 400, {error: 'bad-request', message: 'baseSeq is required so that a stale tab cannot overwrite newer edits.'});
            const r = savePlan(p, id, b.plan, {baseSeq: b.baseSeq, label: typeof b.label === 'string' ? b.label.slice(0, 120) : undefined});
            if (r.changed) broadcast('plan', {planId: id, seq: r.seq, tab: String(b.tab ?? '')});
            return json(res, 200, {...r, ...planPayload(id)});
          }
        }
        if (sub === 'apply') {
          if (method === 'GET') return json(res, 200, previewApplication(p, id));
          if (method === 'POST') {
            const b = await readBody(req);
            if (typeof b.basePlanSeq !== 'number' || typeof b.baseEpisodeSeq !== 'number') return json(res, 400, {error: 'bad-request', message: 'basePlanSeq and baseEpisodeSeq are required so that nothing newer is overwritten.'});
            if (o.faultFile && existsSync(o.faultFile)) p.hooks.beforeCommit = () => { throw new Error('injected failure before commit (test)'); };
            const r = applyStoryboard(p, id, {basePlanSeq: b.basePlanSeq, baseEpisodeSeq: b.baseEpisodeSeq, confirmReplace: !!b.confirmReplace});
            p.hooks.beforeCommit = undefined;
            broadcast('plan', {planId: id, seq: r.planSeq, tab: String(b.tab ?? '')});
            broadcast('committed', {episodeId: id, seq: r.episodeSeq, docHash: getEpisodeInfo(p, id).docHash, tab: String(b.tab ?? '')});
            return json(res, 200, {...r, ...planPayload(id)});
          }
        }
        if (sub === 'revisions' && method === 'GET') return json(res, 200, {revisions: listPlanRevisions(p, id)});
        if (sub === 'restore' && method === 'POST') {
          const b = await readBody(req);
          if (typeof b.number !== 'number' || typeof b.baseSeq !== 'number') return json(res, 400, {error: 'bad-request', message: 'number and baseSeq are required.'});
          const r = restorePlanRevision(p, id, b.number, b.baseSeq);
          if (r.changed) broadcast('plan', {planId: id, seq: r.seq, tab: String(b.tab ?? '')});
          return json(res, 200, {...r, ...planPayload(id)});
        }
        if (sub === 'imports') {
          if (!pl[3]) {
            if (method === 'GET') return json(res, 200, {imports: listImports(p, id)});
            if (method === 'POST') {
              const b = await readBody(req);
              if (typeof b.text !== 'string' || (b.via !== 'paste' && b.via !== 'file')) return json(res, 400, {error: 'bad-request', message: 'text and via (paste or file) are required.'});
              const r = submitImport(p, id, {text: b.text, via: b.via, sourceName: typeof b.sourceName === 'string' ? b.sourceName : undefined});
              if (!r.ok) return json(res, 422, {error: 'invalid-input', message: 'Nothing was imported.', shape: r.shape, errors: r.errors});
              return json(res, 201, importPayload(id, r.import.id));
            }
          } else {
            const n = Number(pl[3]);
            if (!pl[4] && method === 'GET') return json(res, 200, importPayload(id, n));
            if (pl[4] === 'reject' && method === 'POST') { rejectImport(p, id, n); return json(res, 200, importPayload(id, n)); }
            if (pl[4] === 'accept' && method === 'POST') {
              const b = await readBody(req);
              if (typeof b.basePlanSeq !== 'number' || (b.baseEpisodeSeq !== null && typeof b.baseEpisodeSeq !== 'number') || typeof b.selection !== 'object' || b.selection === null) return json(res, 400, {error: 'bad-request', message: 'selection, basePlanSeq and baseEpisodeSeq (a number, or null when there is no episode yet) are required.'});
              const sel = b.selection as Selection;
              if (o.faultFile && existsSync(o.faultFile)) p.hooks.beforeCommit = () => { throw new Error('injected failure before commit (test)'); };
              const r = acceptImport(p, id, n, {selection: {sources: sel.sources ?? [], claims: sel.claims ?? [], script: sel.script ?? null, storyboard: !!sel.storyboard, confirmReplace: !!sel.confirmReplace}, basePlanSeq: b.basePlanSeq, baseEpisodeSeq: b.baseEpisodeSeq});
              p.hooks.beforeCommit = undefined;
              broadcast('plan', {planId: id, seq: r.planSeq, tab: String(b.tab ?? '')});
              if (r.episodeSeq !== null) broadcast('committed', {episodeId: id, seq: r.episodeSeq, docHash: getEpisodeInfo(p, id).docHash, tab: String(b.tab ?? '')});
              return json(res, 200, {...r, ...planPayload(id), import: getImport(p, id, n)});
            }
          }
        }
      } catch (e) { return planFailure(res, e, id ?? ''); }
    }

    // ---- the Voice stage ------------------------------------------------------------------------------------------------
    const vo = /^\/api\/episodes\/([a-z0-9][a-z0-9_-]*)\/voice(?:\/(generate|select|blocks|sample|cancel))?$/.exec(path);
    if (vo) {
      if (!voice || !jobs) return json(res, 404, {error: 'not-found', message: 'The Voice screen is not available in this session.'});
      const id = vo[1];
      const sub = vo[2];
      try {
        if (!sub && method === 'GET') return json(res, 200, voice.view(id));
        if (sub && method === 'POST') {
          const b = await readBody(req);
          const tab = String(b.tab ?? '');
          if (sub === 'generate') {
            if (typeof b.seq !== 'number' || typeof b.requestId !== 'string' || !/^[A-Za-z0-9_-]{6,64}$/.test(b.requestId)) return json(res, 400, {error: 'bad-request', message: 'seq and requestId are required.'});
            const r = voice.generate(id, {seq: b.seq, requestId: b.requestId, blocks: Array.isArray(b.blocks) ? b.blocks.map(String) : undefined, reroll: b.reroll === true});
            broadcast('voice', {episodeId: id});
            return json(res, 202, {...r, view: voice.view(id)});
          }
          if (sub === 'select') {
            if (typeof b.block !== 'string' || typeof b.artifactId !== 'number') return json(res, 400, {error: 'bad-request', message: 'block and artifactId are required.'});
            const r = voice.choose(id, {block: b.block, artifactId: b.artifactId, seq: typeof b.seq === 'number' ? b.seq : undefined});
            broadcast('voice', {episodeId: id});
            return json(res, 200, {...r, view: voice.view(id)});
          }
          if (sub === 'blocks') {
            const op = b.op === 'split' && typeof b.block === 'string' && typeof b.after === 'string' ? {op: 'split' as const, block: b.block, after: b.after} : b.op === 'merge' && typeof b.block === 'string' ? {op: 'merge' as const, block: b.block} : null;
            if (!op || typeof b.seq !== 'number') return json(res, 400, {error: 'bad-request', message: 'seq and op (split with block and after, or merge with block) are required.'});
            if (b.preview === true) return json(res, 200, {preview: voice.preview(id, op)});
            if (o.faultFile && existsSync(o.faultFile)) p.hooks.beforeCommit = () => { throw new Error('injected failure before commit (test)'); };
            const r = voice.edit(id, {seq: b.seq, op});
            p.hooks.beforeCommit = undefined;
            broadcast('committed', {episodeId: id, seq: r.seq, docHash: getEpisodeInfo(p, id).docHash, tab});
            broadcast('voice', {episodeId: id});
            return json(res, 200, {...r, view: voice.view(id)});
          }
          if (sub === 'sample') {
            if (typeof b.seq !== 'number' || typeof b.requestId !== 'string' || !/^[A-Za-z0-9_-]{6,64}$/.test(b.requestId)) return json(res, 400, {error: 'bad-request', message: 'seq and requestId are required.'});
            const r = voice.sample(id, {seq: b.seq, requestId: b.requestId});
            broadcast('voice', {episodeId: id});
            return json(res, 202, {...r, view: voice.view(id)});
          }
          if (sub === 'cancel') {
            const n = await voice.cancelAll(id);
            broadcast('voice', {episodeId: id});
            return json(res, 200, {cancelled: n, view: voice.view(id)});
          }
        }
        return json(res, 405, {error: 'method-not-allowed'});
      } catch (e) {
        p.hooks.beforeCommit = undefined;
        if (e instanceof VoiceError) return json(res, e.code === 'unknown' ? 404 : e.code === 'blocked' || e.code === 'refused' ? 422 : 409, {error: e.code, message: e.message, ...e.detail});
        if (e instanceof PreflightError) return json(res, 422, {error: 'blocked', message: e.message});
        return json(res, 500, {error: 'failed', message: (e as Error).message});
      }
    }

    // ---- the Review stage: rounds, notes, checks, playback, sign-offs, approval, export ---------------------------------------
    const rv = /^\/api\/episodes\/([a-z0-9][a-z0-9_-]*)\/review(?:\/(round|checks|cover|playback|signoff|note|confirm-diff|approve|export))?(?:\/([a-z0-9_-]+))?$/.exec(path);
    if (rv) {
      if (!review || !jobs) return json(res, 404, {error: 'not-found', message: 'The Review screen is not available in this session.'});
      const id = rv[1];
      const sub = rv[2];
      if (!listEpisodes(p).includes(id)) return json(res, 404, {error: 'not-found', message: `No episode "${id}" in this workspace.`});
      try {
        if (!sub && method === 'GET') {
          const r = url.searchParams.get('render');
          return json(res, 200, review.view(id, r && /^\d+$/.test(r) ? Number(r) : null));
        }
        if (sub && method === 'POST') {
          const b = await readBody(req);
          const tab = String(b.tab ?? '');
          const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
          const fresh = () => json(res, 200, {ok: true, view: review.view(id, num(b.render))});
          if (sub === 'round') {
            if (num(b.renderArtifactId) === null) return json(res, 400, {error: 'bad-request', message: 'renderArtifactId is required.'});
            review.openRound(id, b.renderArtifactId);
            broadcast('review', {episodeId: id});
            return json(res, 200, {ok: true, view: review.view(id, b.renderArtifactId)});
          }
          if (sub === 'checks') {
            if (num(b.renderArtifactId) === null) return json(res, 400, {error: 'bad-request', message: 'renderArtifactId is required.'});
            const jobId = review.runChecks(id, b.renderArtifactId);
            broadcast('review', {episodeId: id});
            return json(res, 202, {ok: true, jobId, view: review.view(id, b.renderArtifactId)});
          }
          if (sub === 'cover') {
            if (num(b.renderArtifactId) === null) return json(res, 400, {error: 'bad-request', message: 'renderArtifactId is required.'});
            const jobId = review.makeCover(id, b.renderArtifactId);
            broadcast('review', {episodeId: id});
            return json(res, 202, {ok: true, jobId, view: review.view(id, b.renderArtifactId)});
          }
          if (sub === 'playback') {
            if (num(b.roundId) === null || num(b.fromSec) === null || num(b.toSec) === null) return json(res, 400, {error: 'bad-request', message: 'roundId, fromSec and toSec are required.'});
            review.playback(id, b.roundId, {fromSec: b.fromSec, toSec: b.toSec, heard: b.heard === true, phone: b.phone === true});
            return json(res, 200, {ok: true});
          }
          if (sub === 'signoff') {
            if (num(b.roundId) === null || typeof b.item !== 'string' || typeof b.ticked !== 'boolean') return json(res, 400, {error: 'bad-request', message: 'roundId, item and ticked are required.'});
            review.signoff(id, b.roundId, b.item, b.ticked);
            broadcast('review', {episodeId: id});
            return fresh();
          }
          if (sub === 'note') {
            const seq = num(b.seq) ?? undefined;
            if (!rv[3]) {
              if (num(b.roundId) === null || typeof b.text !== 'string') return json(res, 400, {error: 'bad-request', message: 'roundId and text are required.'});
              const r = review.addNote(id, {roundId: b.roundId, text: b.text, type: b.type ?? 'general', timeSec: num(b.timeSec) ?? undefined, segment: typeof b.segment === 'string' ? b.segment : undefined, word: num(b.word) ?? undefined, build: typeof b.build === 'string' ? b.build : undefined}, seq);
              broadcast('committed', {episodeId: id, seq: r.seq, docHash: getEpisodeInfo(p, id).docHash, tab});
              return fresh();
            }
            const op = b.op;
            const change = op === 'edit' && typeof b.text === 'string' ? {op: 'edit' as const, text: b.text, ...(typeof b.type === 'string' ? {type: b.type} : {})} : op === 'resolve' || op === 'wont-fix' ? {op: op as 'resolve' | 'wont-fix', text: typeof b.text === 'string' ? b.text : undefined} : op === 'reopen' || op === 'reassess' ? {op: op as 'reopen' | 'reassess'} : null;
            if (!change) return json(res, 400, {error: 'bad-request', message: 'op must be edit (with text), resolve, wont-fix, reopen or reassess.'});
            const r = review.changeNote(id, rv[3], change as never, seq);
            broadcast('committed', {episodeId: id, seq: r.seq, docHash: getEpisodeInfo(p, id).docHash, tab});
            return fresh();
          }
          if (sub === 'confirm-diff') {
            if (num(b.renderArtifactId) === null || typeof b.segment !== 'string' || typeof b.hash !== 'string') return json(res, 400, {error: 'bad-request', message: 'renderArtifactId, segment and hash are required.'});
            review.confirmDiff(id, b.renderArtifactId, b.segment, b.hash, b.confirmed !== false);
            return json(res, 200, {ok: true, view: review.view(id, b.renderArtifactId)});
          }
          if (sub === 'approve') {
            // the request names the round and nothing else: it cannot carry sign-offs, so it cannot tick them
            if (num(b.roundId) === null || b.confirm !== true) return json(res, 400, {error: 'bad-request', message: 'roundId and confirm: true are required. Approval is only recorded by an explicit action.'});
            const approvalId = review.approve(id, b.roundId);
            broadcast('review', {episodeId: id});
            return json(res, 200, {ok: true, approvalId, view: review.view(id)});
          }
          if (sub === 'export') {
            const r = review.export(id);
            broadcast('review', {episodeId: id});
            return json(res, 200, {ok: true, result: {dir: r.dir, files: r.files, verified: r.verified, alreadyExported: r.alreadyExported}, view: review.view(id)});
          }
        }
        return json(res, 405, {error: 'method-not-allowed'});
      } catch (e) {
        if (e instanceof ReviewError) return json(res, e.code === 'unknown' ? 404 : e.code === 'conflict' ? 409 : 422, {error: e.code, message: e.message, ...(e.code === 'conflict' ? {view: review.view(id)} : {})});
        if (e instanceof ApprovalError) return json(res, 422, {error: 'approval-refused', message: e.message, problems: e.problems});
        if (e instanceof ExportError) return json(res, e.code === 'unsafe' ? 422 : 409, {error: `export-${e.code}`, message: e.message, changed: e.changed});
        if (e instanceof RebuildError) return json(res, e.code === 'unknown' ? 404 : 409, {error: e.code, message: e.message});
        if (e instanceof PreflightError) return json(res, 422, {error: 'blocked', message: e.message});
        if (e instanceof ConflictError) return json(res, 409, {error: 'conflict', message: 'The episode was saved again since this page was loaded. Nothing was changed.'});
        return json(res, 500, {error: 'failed', message: (e as Error).message});
      }
    }

    // ---- the Pip Explains opening: its sound signature, and linking an episode to its planning document ---------------------
    const op = /^\/api\/episodes\/([a-z0-9][a-z0-9_-]*)\/(opening|link-plan)$/.exec(path);
    if (op) {
      const id = op[1];
      if (!listEpisodes(p).includes(id)) return json(res, 404, {error: 'not-found', message: `No episode "${id}" in this workspace.`});
      try {
        if (op[2] === 'opening' && method === 'GET') {
          const doc = getEpisode(p, id);
          return json(res, 200, {hook: doc.scenes[0]?.openingHook ?? null, title: doc.title, brand: planExists(p, id) ? getPlan(p, id).plan.brand ?? null : null, signature: openingSignature(p, id), signatureSpec: OPENING_SIGNATURE, pipStyle: doc.style === 'pip-paper' || doc.style === 'pip-paper-bundled'});
        }
        if (op[2] === 'opening' && method === 'POST') {
          const b = await readBody(req);
          if (typeof b.signature !== 'boolean') return json(res, 400, {error: 'bad-request', message: 'signature: true or false is required.'});
          const r = b.signature ? ensureOpeningSignature(p, id) : removeOpeningSignature(p, id);
          broadcast('committed', {episodeId: id, seq: getEpisodeInfo(p, id).seq, docHash: getEpisodeInfo(p, id).docHash, tab: String(b.tab ?? '')});
          return json(res, 200, {ok: true, ...r, signature: openingSignature(p, id)});
        }
        if (op[2] === 'link-plan' && method === 'POST') {
          const b = await readBody(req);
          const stored = linkPlanToEpisode(p, id, {audience: typeof b.audience === 'string' ? b.audience : undefined, brand: b.brand === true});
          broadcast('plan', {planId: id, tab: String(b.tab ?? '')});
          return json(res, 201, {ok: true, seq: stored.seq, plan: stored.plan});
        }
        return json(res, 405, {error: 'method-not-allowed'});
      } catch (e) {
        if (e instanceof LinkError) return json(res, 409, {error: 'link-refused', message: e.message});
        if (e instanceof SoundSettingsError) return json(res, 422, {error: 'sound-refused', message: e.message, problems: e.problems});
        if (e instanceof PlanValidationError) return json(res, 422, {error: 'invalid', message: e.message, issues: e.issues});
        return json(res, 500, {error: 'failed', message: (e as Error).message});
      }
    }

    // ---- episodes --------------------------------------------------------------------------------------------------
    const ep = /^\/api\/episodes\/([a-z0-9][a-z0-9_-]*)(?:\/(plan|rebuild|revisions|restore|animatic|proof))?(?:\/(\d+))?$/.exec(path);
    if (ep) {
      const id = ep[1];
      const sub = ep[2];
      if (!listEpisodes(p).includes(id)) return json(res, 404, {error: 'not-found', message: `No episode "${id}" in this workspace.`});
      if (!sub && !ep[3]) {
        if (method === 'GET') return json(res, 200, episodePayload(id, url.searchParams.get('build')));
        if (method === 'PUT') {
          const b = await readBody(req);
          if (typeof b.baseSeq !== 'number') return json(res, 400, {error: 'bad-request', message: 'baseSeq is required so that a stale tab cannot overwrite newer edits.'});
          try {
            if (o.faultFile && existsSync(o.faultFile)) p.hooks.beforeCommit = () => { throw new Error('injected failure before commit (test)'); };
            const r = saveEpisode(p, id, b.doc, {baseSeq: b.baseSeq});
            p.hooks.beforeCommit = undefined;
            if (r.changed) broadcast('committed', {episodeId: id, seq: r.seq, docHash: r.docHash, tab: String(b.tab ?? '')});
            return json(res, 200, {...r, status: statusReport(p, id)});
          } catch (e) { return saveFailure(res, e, id); }
        }
      }
      if (sub === 'plan' && method === 'GET') {
        if (!jobs) return json(res, 404, {error: 'not-found', message: 'Rebuilding is not available in this session.'});
        const m = url.searchParams.get('mode');
        return json(res, 200, jobs.plan(id, m === 'draft' ? 'draft' : 'final'));
      }
      if (sub === 'animatic' && method === 'POST') {
        if (!jobs) return json(res, 404, {error: 'not-found', message: 'Building is not available in this session.'});
        try {
          const jobId = jobs.startAnimatic(id);
          broadcast('review', {episodeId: id});
          return json(res, 202, {ok: true, jobId, animatic: animaticFor(p, id)});
        } catch (e) { return json(res, e instanceof RebuildError ? 409 : 500, {error: 'failed', message: (e as Error).message}); }
      }
      if (sub === 'animatic' && method === 'GET') return json(res, 200, animaticFor(p, id));
      if (sub === 'proof' && method === 'GET') return json(res, 200, {proofs: proofsFor(p, id)});
      if (sub === 'proof' && method === 'POST') {
        if (!jobs) return json(res, 404, {error: 'not-found', message: 'Building is not available in this session.'});
        const b = await readBody(req);
        if (typeof b.label !== 'string' || typeof b.from !== 'number' || typeof b.to !== 'number') return json(res, 400, {error: 'bad-request', message: 'label, from and to are required.'});
        try {
          const jobId = jobs.startProof(id, b.label, b.from, b.to);
          broadcast('review', {episodeId: id});
          return json(res, 202, {ok: true, jobId, proofs: proofsFor(p, id)});
        } catch (e) { return json(res, e instanceof RebuildError ? 409 : 500, {error: 'failed', message: (e as Error).message}); }
      }
      if (sub === 'rebuild' && method === 'POST') {
        if (!jobs) return json(res, 404, {error: 'not-found', message: 'Rebuilding is not available in this session.'});
        const b = await readBody(req);
        if (typeof b.seq !== 'number' || typeof b.requestId !== 'string' || !/^[A-Za-z0-9_-]{6,64}$/.test(b.requestId)) return json(res, 400, {error: 'bad-request', message: 'seq and requestId are required.'});
        try {
          const r = jobs.startRebuild(id, {seq: b.seq, requestId: b.requestId, mode: b.mode === 'draft' ? 'draft' : 'final'});
          return json(res, 202, {...r, jobs: jobs.list(id), rebuilds: jobs.rebuilds(id)});
        } catch (e) {
          if (e instanceof RebuildError) return json(res, e.code === 'blocked' ? 422 : 409, {error: e.code, message: e.message, ...e.detail});
          return json(res, 500, {error: 'failed', message: (e as Error).message});
        }
      }
      if (sub === 'revisions' && method === 'GET') {
        if (!ep[3]) return json(res, 200, {revisions: revisionRows(id)});
        const n = Number(ep[3]);
        try {
          const doc = getRevision(p, id, n);
          const row = revisionRows(id).find((r) => r.number === n)!;
          const current = getEpisode(p, id);
          return json(res, 200, {...row, segments: doc.narration.segments.map((s) => ({id: s.id, text: s.text, speech: s.speech ?? null})), ifRestored: summarizeChange(current, doc)});
        } catch (e) { return json(res, e instanceof UnknownEpisodeError ? 404 : 500, {error: 'not-found', message: (e as Error).message}); }
      }
      if (sub === 'restore' && method === 'POST') {
        const b = await readBody(req);
        if (typeof b.number !== 'number' || typeof b.baseSeq !== 'number') return json(res, 400, {error: 'bad-request', message: 'number and baseSeq are required.'});
        try {
          const doc = getRevision(p, id, b.number);
          if (o.faultFile && existsSync(o.faultFile)) p.hooks.beforeCommit = () => { throw new Error('injected failure before commit (test)'); };
          const r = saveEpisode(p, id, doc, {baseSeq: b.baseSeq, kind: 'restore', label: `restored r${b.number}`});
          p.hooks.beforeCommit = undefined;
          if (r.changed) broadcast('committed', {episodeId: id, seq: r.seq, docHash: r.docHash, tab: String(b.tab ?? '')});
          return json(res, 200, {...r, restored: b.number, status: statusReport(p, id), current: episodePayload(id)});
        } catch (e) {
          if (e instanceof UnknownEpisodeError) return json(res, 404, {error: 'not-found', message: e.message});
          return saveFailure(res, e, id);
        }
      }
    }
    if (path === '/' || path === '/index.html') return sendFile(req, res, join(o.distDir, 'index.html'), ASSET_TYPES['.html']);
    if (path === '/app.js' || path === '/app.css') return sendFile(req, res, join(o.distDir, path.slice(1)), ASSET_TYPES[ext(path)]);
    if (path === '/favicon.ico') { res.writeHead(204); return void res.end(); }
    return json(res, 404, {error: 'not-found'});
  }

  let stopping = false;
  const server = createServer((req, res) => {
    // once stopping, a connection ends with the response it is on, so no client is left holding a socket that will be reset
    res.once('finish', () => { if (stopping) req.socket.end(); });
    route(req, res).catch((e) => { if (!res.headersSent) json(res, 500, {error: 'server-error', message: (e as Error).message}); else res.end(); });
  });
  const ping = setInterval(() => { for (const c of clients) c.write('event: ping\ndata: {}\n\n'); }, 2000);
  ping.unref();

  return {
    server, token, serverId,
    start: () => new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(o.port ?? 0, '127.0.0.1', () => { port = (server.address() as {port: number}).port; resolve(port); });
    }),
    stop: () => new Promise((resolve) => {
      stopping = true;
      clearInterval(ping);
      stopListening?.();
      for (const c of clients) c.end();
      const cutOff = setTimeout(() => server.closeAllConnections(), o.stopGraceMs ?? 3000);
      server.close(() => { clearTimeout(cutOff); resolve(); });
      server.closeIdleConnections();
    }),
    url: () => `http://127.0.0.1:${port}/?token=${token}`,
  };
}
