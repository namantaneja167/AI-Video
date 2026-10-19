// Builds: which timing, mix and render belong together. A build is a timing plus the newest mix that was made from the same
// takes, pacing and block layout (and, when sound accents are placed on scene cues, from that very timing), plus the renders
// made from exactly that pair. Nothing is paired by recency alone, so the preview never mixes artifacts of different builds.
import {existsSync, readFileSync, statSync} from 'node:fs';
import {getSnapshot, type SnapshotManifest, type Status} from '../core/artifacts.ts';
import {blobPath} from '../core/blobs.ts';
import {all, get} from '../core/db.ts';
import {blockGaps} from '../core/deps.ts';
import type {Project} from '../core/project.ts';
import type {EpisodeV2} from '../src/schema2.ts';

type Row = {id: number; kind: string; subject: string; blob_hash: string; snapshot_id: string | null; revision_number: number | null; created_at: number; outdated: number; meta_json: string};
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export type RenderInfo = {id: number; kind: 'draft' | 'final'; revision: number | null; builtAt: number; blobHash: string; snapshotId: string | null; imported: {note?: string} | null};
export type BuildInfo = {
  id: string; timingId: number; mixId: number; mixKind: 'draft' | 'final';
  /** The video of this build, if it has one. Each video made from the same timing and mix is a build of its own. */
  render: RenderInfo | null;
  /** The revision of the document this build shows (its newest render's, else its timing's). */
  revision: number | null; timingRevision: number | null;
  docHash: string; builtAt: number; imported: {note?: string} | null;
  /** Its timing was finished after the episode had already changed. */
  outdatedFlag: boolean;
  sortKey: number;
};

type Snap = {manifest: SnapshotManifest; doc: EpisodeV2};

export const buildId = (timingId: number, mixId: number, renderId: number | null) => `b${timingId}-${mixId}-${renderId ?? 0}`;
export const parseBuildId = (v: string): {timingId: number; mixId: number; renderId: number | null} | null => {
  const m = /^b(\d+)-(\d+)-(\d+)$/.exec(v);
  return m ? {timingId: Number(m[1]), mixId: Number(m[2]), renderId: Number(m[3]) || null} : null;
};

function loader(p: Project) {
  const cache = new Map<string, Snap | null>();
  return (snapshotId: string | null): Snap | null => {
    if (!snapshotId) return null;
    if (!cache.has(snapshotId)) {
      try {
        const manifest = getSnapshot(p, snapshotId);
        cache.set(snapshotId, {manifest, doc: JSON.parse(readFileSync(blobPath(p, manifest.docBlob), 'utf8')) as EpisodeV2});
      } catch { cache.set(snapshotId, null); }
    }
    return cache.get(snapshotId)!;
  };
}

const accentsOf = (s: Snap): boolean => {
  const ev = s.manifest.componentValues?.soundEvents;
  return s.manifest.componentValues === undefined ? true : Array.isArray(ev) && ev.length > 0;
};

/** The same audio: same takes, same placement of blocks, and the same timing when accents follow scene cues. */
function audioCompatible(timing: Row, ts: Snap, mix: Row, ms: Snap): boolean {
  if (!same(ts.manifest.blobs.takes, ms.manifest.blobs.takes)) return false;
  if (!same(ts.doc.pacing, ms.doc.pacing) || !same(blockGaps(ts.doc), blockGaps(ms.doc)) || !same(ts.doc.narration.blocks, ms.doc.narration.blocks)) return false;
  return !accentsOf(ms) || ms.manifest.blobs.timing === timing.blob_hash;
}

/** Every build of the episode that can be played back, newest first. */
export function listBuilds(p: Project, episodeId: string): BuildInfo[] {
  const rows = all<Row>(p.db.prepare("SELECT id, kind, subject, blob_hash, snapshot_id, revision_number, created_at, outdated, meta_json FROM artifacts WHERE episode_id=? AND kind IN ('timing','mix','render') ORDER BY id DESC"), episodeId)
    .filter((r) => existsSync(blobPath(p, r.blob_hash)));
  const snap = loader(p);
  const mixes = rows.filter((r) => r.kind === 'mix');
  const renders = rows.filter((r) => r.kind === 'render');
  const out: BuildInfo[] = [];
  for (const t of rows.filter((r) => r.kind === 'timing')) {
    const ts = snap(t.snapshot_id);
    if (!ts) continue;
    const ordered = [...mixes.filter((m) => m.subject === 'final'), ...mixes.filter((m) => m.subject === 'draft')];
    const m = ordered.find((x) => { const ms = snap(x.snapshot_id); return !!ms && audioCompatible(t, ts, x, ms); });
    if (!m) continue;
    const rs = renders.filter((r) => { const s = snap(r.snapshot_id); return !!s && s.manifest.blobs.timing === t.blob_hash && s.manifest.blobs.mix[r.subject as 'draft' | 'final'] === (r.subject === m.subject ? m.blob_hash : null); })
      .sort((a, b) => (a.subject === b.subject ? b.id - a.id : a.subject === 'final' ? -1 : 1));
    const meta = JSON.parse(t.meta_json) as {imported?: {note?: string}};
    const make = (r: Row | undefined): BuildInfo => {
      const shown = (r ? snap(r.snapshot_id) : ts)!;
      return {
        id: buildId(t.id, m.id, r?.id ?? null), timingId: t.id, mixId: m.id, mixKind: m.subject as 'draft' | 'final',
        render: r ? {id: r.id, kind: r.subject as 'draft' | 'final', revision: r.revision_number, builtAt: r.created_at, blobHash: r.blob_hash, snapshotId: r.snapshot_id, imported: (JSON.parse(r.meta_json) as {imported?: {note?: string}}).imported ?? null} : null,
        revision: shown.manifest.revision, timingRevision: t.revision_number, docHash: shown.manifest.docHash,
        builtAt: Math.max(t.created_at, m.created_at, r?.created_at ?? 0), imported: (r ? (JSON.parse(r.meta_json) as {imported?: {note?: string}}).imported : meta.imported) ?? null, outdatedFlag: t.outdated === 1 || r?.outdated === 1,
        sortKey: Math.max(t.id, m.id, r?.id ?? 0),
      };
    };
    if (!rs.length) out.push(make(undefined));
    for (const r of rs) out.push(make(r));
  }
  return out.sort((a, b) => b.sortKey - a.sortKey);
}

export type DisplayedBuild = {
  info: BuildInfo; builtDoc: EpisodeV2; timeline: any;
  audio: {kind: 'draft' | 'final'; url: string; bytes: number; builtAt: number; fresh: boolean; imported: unknown; matchesTiming: true};
  render: {id: number; kind: 'draft' | 'final'; url: string; bytes: number; builtAt: number; revision: number | null; fresh: boolean; imported: unknown} | null;
  /** Timing, mix and (when there is one) render are all the current outputs and all are up to date. */
  matchesLatestEdits: boolean;
};

/** The build made of the current timing, mix and video (what the episode's status describes); else the newest one that can be played. */
export function pickDefault(builds: BuildInfo[], status: Status): BuildInfo | undefined {
  const pair = builds.filter((b) => b.timingId === status.timing.artifactId && b.mixId === status.mix[b.mixKind].artifactId);
  return pair.find((b) => b.render && b.render.id === status.render[b.render.kind].artifactId) ?? pair[0] ?? builds[0];
}

/** The requested build (or the default) with everything the preview needs, all from one build. */
export function displayBuild(p: Project, episodeId: string, builds: BuildInfo[], requested: string | null, status: Status): DisplayedBuild | null {
  const info = (requested ? builds.find((b) => b.id === requested) : undefined) ?? pickDefault(builds, status);
  if (!info) return null;
  const snapshots = loader(p);
  const timingRow = get<Row>(p.db.prepare('SELECT id, kind, subject, blob_hash, snapshot_id, revision_number, created_at, outdated, meta_json FROM artifacts WHERE id=?'), info.timingId)!;
  const mixRow = get<Row>(p.db.prepare('SELECT id, kind, subject, blob_hash, snapshot_id, revision_number, created_at, outdated, meta_json FROM artifacts WHERE id=?'), info.mixId)!;
  const renderTop = info.render ?? undefined;
  const doc = (renderTop ? snapshots(renderTop.snapshotId) : null)?.doc ?? snapshots(timingRow.snapshot_id)!.doc;
  const timeline = JSON.parse(readFileSync(blobPath(p, timingRow.blob_hash), 'utf8'));
  const timingFresh = status.timing.status === 'fresh' && status.timing.artifactId === info.timingId;
  const mixFresh = status.mix[info.mixKind].status === 'fresh' && status.mix[info.mixKind].artifactId === info.mixId;
  const renderFresh = !!renderTop && status.render[renderTop.kind].status === 'fresh' && status.render[renderTop.kind].artifactId === renderTop.id;
  return {
    info, builtDoc: doc, timeline,
    audio: {kind: info.mixKind, url: `/media/generated/${episodeId}/${info.id}/${timeline.audio}`, bytes: statSync(blobPath(p, mixRow.blob_hash)).size, builtAt: mixRow.created_at, fresh: mixFresh, imported: (JSON.parse(mixRow.meta_json) as {imported?: unknown}).imported ?? null, matchesTiming: true},
    render: renderTop ? {id: renderTop.id, kind: renderTop.kind, url: `/media/render/${episodeId}/${renderTop.id}.mp4`, bytes: statSync(blobPath(p, renderTop.blobHash)).size, builtAt: renderTop.builtAt, revision: renderTop.revision, fresh: renderFresh, imported: renderTop.imported} : null,
    matchesLatestEdits: timingFresh && mixFresh && (renderTop ? renderFresh : true),
  };
}
