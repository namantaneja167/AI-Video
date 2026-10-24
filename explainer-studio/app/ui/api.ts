import type {EpisodeV2} from '../../src/schema2.ts';
import type {Status} from '../../core/artifacts.ts';
import type {MeasuredRuns} from '../shared/costs.ts';
import type {Committed, SendResult} from '../shared/autosave.ts';
import type {ActiveWork, Plan} from '../shared/plan-types.ts';
import type {JobView, RebuildView, SlotView} from '../jobs.ts';
import type {ImportRow} from '../planning.ts';
import type {Selection} from '../shared/importing.ts';
import type {Proposal, ParseError} from '../shared/packet.ts';
import type {PlanDoc, PlanIssue} from '../shared/plan.ts';
import type {Application, StoryboardCheck} from '../shared/storyboard.ts';
import type {BlockPreview, GenerateReply, VoiceView} from '../shared/voice.ts';
import type {ReviewView} from '../shared/review.ts';

export type Timeline = {version: number; durationSec: number; audio: string; segments: {id: string; start: number; end: number; words: {text: string; start: number; end: number}[]}[]; captions: {segment: string; text: string; words: {text: string; start: number; end: number}[]; emphasis?: [number, number][]}[]; scenes: {id: string; type: string; start: number; end: number}[]} & Record<string, unknown>;
export type Imported = {from?: string; note: string} | null;
export type Build = {
  id: string; timingArtifactId: number; mixArtifactId: number; builtAt: number; revision: number | null; imported: Imported; source: string | null;
  builtDoc: EpisodeV2; timeline: Timeline; isLatest: boolean; matchesLatestEdits: boolean; outdatedFlag: boolean;
  audio: {kind: string; builtAt: number; imported: Imported; url: string; bytes: number; fresh: boolean; matchesTiming: boolean};
  render: {id: number; kind: string; url: string; bytes: number; builtAt: number; revision: number | null; fresh: boolean; imported: Imported} | null;
};
export type BuildSummary = {id: string; revision: number | null; builtAt: number; imported: Imported; outdatedFlag: boolean; hasVideo: boolean; isLatest: boolean; shown: boolean; hasFinalVideo: boolean; videoRevision: number | null; timingRevision: number | null};
export type EpisodePayload = {doc: EpisodeV2; seq: number; docHash: string; planned: boolean; renderDrift: string[]; status: Status; build: Build | null; builds: BuildSummary[]; rebuilds: boolean; active: ActiveWork | null; animatic?: AnimaticInfo};
export type AnimaticInfo = {state: 'none' | 'running' | 'fresh' | 'outdated'; artifactId: number | null; hook: string | null; seriesLabel: string | null; fileSha256: string | null; bytes: number | null; builtAt: number | null; why: string | null};
export type Session = {serverId: string; startedAt: number; workspace: string; rebuilds: boolean; episodes: {id: string; title: string; seq: number}[]};

const H = {'x-studio': '1', 'content-type': 'application/json'};
async function call<T>(method: string, url: string, body?: unknown): Promise<{status: number; json: T}> {
  const res = await fetch(url, {method, headers: H, body: body === undefined ? undefined : JSON.stringify(body), cache: 'no-store'});
  const json = (await res.json().catch(() => ({}))) as T;
  return {status: res.status, json};
}

export const getSession = () => call<Session>('GET', '/api/session').then((r) => r.json);
export const getEpisode = (id: string, build: string | null = null) => call<EpisodePayload>('GET', `/api/episodes/${id}${build ? `?build=${encodeURIComponent(build)}` : ''}`).then((r) => r.json);
export const getMeasured = () => call<MeasuredRuns>('GET', '/api/measured').then((r) => r.json);
export const getPrefs = () => call<Record<string, string>>('GET', '/api/ui').then((r) => r.json);
export const putPref = (key: string, value: string) => call('PUT', '/api/ui', {key, value}).catch(() => undefined);

export type SaveReply = {result: SendResult; status?: Status; docHash?: string};
export async function saveEpisode(id: string, doc: EpisodeV2, baseSeq: number, tab: string): Promise<SaveReply> {
  try {
    const r = await call<any>('PUT', `/api/episodes/${id}`, {doc, baseSeq, tab});
    if (r.status === 200) return {result: {kind: 'ok', seq: r.json.seq}, status: r.json.status, docHash: r.json.docHash};
    if (r.status === 409) return {result: {kind: 'conflict', current: {doc: r.json.current.doc, seq: r.json.current.seq} as Committed}};
    if (r.status === 422) return {result: {kind: 'invalid', message: friendlyIssues(r.json)}};
    return {result: {kind: 'failed', message: r.json.message ?? `The server answered ${r.status}.`}};
  } catch {
    return {result: {kind: 'failed', message: 'The app server could not be reached.'}};
  }
}

const friendlyIssues = (j: {message?: string; issues?: {path: string; message: string}[]}) =>
  (j.issues?.length ? j.issues.map((i) => `${i.path.replace(/^narration\.segments\.(\d+)\./, 'segment ')}: ${i.message}`).join('; ') : j.message) ?? 'The document is not valid yet.';

// ---- rebuilds, jobs, revisions -------------------------------------------------------------------------------------------
export type Blocker = Plan['blockers'][number];
export const getPlan = (id: string, mode: 'draft' | 'final' = 'final') => call<Plan>('GET', `/api/episodes/${id}/plan${mode === 'draft' ? '?mode=draft' : ''}`);
export const startRebuild = (id: string, seq: number, requestId: string, mode: 'draft' | 'final' = 'final') => call<any>('POST', `/api/episodes/${id}/rebuild`, {seq, requestId, mode});
export type JobsReply = {available: boolean; jobs: JobView[]; rebuilds: RebuildView[]; slot: SlotView | null};
export const getJobs = (episode: string) => call<JobsReply>('GET', `/api/jobs?episode=${encodeURIComponent(episode)}`).then((r) => r.json);
export const cancelJob = (id: number) => call<any>('POST', `/api/jobs/${id}/cancel`);
export const retryJob = (id: number) => call<any>('POST', `/api/jobs/${id}/retry`);
export const cancelRebuild = (id: string) => call<any>('POST', `/api/rebuilds/${id}/cancel`);
export const continueRebuild = (id: string) => call<any>('POST', `/api/rebuilds/${id}/continue`);

export type RevisionRow = {number: number; kind: string; kindLabel: string; label: string | null; createdAt: number; docHash: string; summary: string[]; short: string; isCurrent: boolean; builds: string[]};
export type RevisionDetail = RevisionRow & {segments: {id: string; text: string; speech: string | null}[]; ifRestored: string[]};
export const getRevisions = (id: string) => call<{revisions: RevisionRow[]}>('GET', `/api/episodes/${id}/revisions`).then((r) => r.json.revisions);
export const getRevision = (id: string, n: number) => call<RevisionDetail>('GET', `/api/episodes/${id}/revisions/${n}`).then((r) => r.json);
export const restoreRevision = (id: string, number: number, baseSeq: number, tab: string) => call<any>('POST', `/api/episodes/${id}/restore`, {number, baseSeq, tab});

// ---- planning: drafts, research, imports -----------------------------------------------------------------------------------
export type LibraryItem = {id: string; title: string; hasPlan: boolean; hasEpisode: boolean; segments: number | null; built: boolean; objective: string; audience: string; durationMin: number | null; sources: number; claims: number; scenes: number; updatedAt: number};
export type EpisodeBrief = {seq: number; segments: {id: string; text: string; speech: string | null}[]; standIn: boolean};
export type PlanPayload = {plan: PlanDoc; seq: number; updatedAt: number; episode: EpisodeBrief | null; imports: ImportRow[]; check: StoryboardCheck};
export type ImportDetail = ImportRow & {content: string; proposal: Proposal};
export type ImportPayload = {import: ImportDetail; plan: PlanDoc; planSeq: number; episode: {seq: number; doc: EpisodeV2} | null};
export type PlanRevisionRow = {number: number; kind: string; label: string | null; createdAt: number; isCurrent: boolean; summary: string};
export type Failure = {error?: string; message?: string; issues?: PlanIssue[]; errors?: ParseError[]; shape?: string | null; current?: PlanPayload | null; problems?: string[]};

export const getLibrary = () => call<{items: LibraryItem[]}>('GET', '/api/library').then((r) => r.json.items ?? []);
export const createPlan = (b: {title: string; audience: string; objective: string; durationMin: number | null; brand?: 'pip-explains'}) => call<PlanPayload & Failure>('POST', '/api/plans', {...b, tab: TAB_ID});
export const getPlanPayload = (id: string) => call<PlanPayload & Failure>('GET', `/api/plans/${id}`);
export const savePlanDoc = (id: string, plan: PlanDoc, baseSeq: number, label?: string) => call<PlanPayload & Failure>('PUT', `/api/plans/${id}`, {plan, baseSeq, label, tab: TAB_ID});
export const getPlanRevisions = (id: string) => call<{revisions: PlanRevisionRow[]}>('GET', `/api/plans/${id}/revisions`).then((r) => r.json.revisions ?? []);
export const restorePlanRevision = (id: string, number: number, baseSeq: number) => call<PlanPayload & Failure>('POST', `/api/plans/${id}/restore`, {number, baseSeq, tab: TAB_ID});
export const submitImport = (id: string, text: string, via: 'paste' | 'file', sourceName?: string) => call<ImportPayload & Failure>('POST', `/api/plans/${id}/imports`, {text, via, sourceName});
export const getImportPayload = (id: string, n: number) => call<ImportPayload & Failure>('GET', `/api/plans/${id}/imports/${n}`);
export const acceptImport = (id: string, n: number, selection: Selection, basePlanSeq: number, baseEpisodeSeq: number | null) => call<PlanPayload & Failure & {summary?: string[]}>('POST', `/api/plans/${id}/imports/${n}/accept`, {selection, basePlanSeq, baseEpisodeSeq, tab: TAB_ID});
export const rejectImport = (id: string, n: number) => call<ImportPayload & Failure>('POST', `/api/plans/${id}/imports/${n}/reject`, {});
export type ApplyPreview = {application: Application; planSeq: number; episodeSeq: number};
export const getApplyPreview = (id: string) => call<ApplyPreview & Failure>('GET', `/api/plans/${id}/apply`);
export const applyScenes = (id: string, basePlanSeq: number, baseEpisodeSeq: number, confirmReplace: boolean) => call<PlanPayload & Failure & {scenes?: number; revision?: number | null}>('POST', `/api/plans/${id}/apply`, {basePlanSeq, baseEpisodeSeq, confirmReplace, tab: TAB_ID});
// ---- the Voice stage -----------------------------------------------------------------------------------------------------------
export type VoiceFailure = {error?: string; message?: string; blockers?: string[]};
export type VoiceReply = VoiceFailure & {view?: VoiceView};
export const getVoice = (id: string) => call<VoiceView & VoiceFailure>('GET', `/api/episodes/${id}/voice`);
export const voiceGenerate = (id: string, seq: number, requestId: string, o: {blocks?: string[]; reroll?: boolean} = {}) => call<GenerateReply & VoiceReply>('POST', `/api/episodes/${id}/voice/generate`, {seq, requestId, ...o, tab: TAB_ID});
export const voiceSelect = (id: string, block: string, artifactId: number, seq: number) => call<{changed?: boolean; outOfDate?: string[]} & VoiceReply>('POST', `/api/episodes/${id}/voice/select`, {block, artifactId, seq, tab: TAB_ID});
export type BlockOpBody = {op: 'split'; block: string; after: string} | {op: 'merge'; block: string};
export const voiceBlocks = (id: string, seq: number, op: BlockOpBody, preview: boolean) => call<{preview?: BlockPreview; label?: string} & VoiceReply>('POST', `/api/episodes/${id}/voice/blocks`, {seq, ...op, preview, tab: TAB_ID});
export const voiceSample = (id: string, seq: number, requestId: string) => call<{jobId?: number} & VoiceReply>('POST', `/api/episodes/${id}/voice/sample`, {seq, requestId, tab: TAB_ID});
export const voiceCancel = (id: string) => call<{cancelled?: number} & VoiceReply>('POST', `/api/episodes/${id}/voice/cancel`, {tab: TAB_ID});

// ---- the Review stage -------------------------------------------------------------------------------------------------------
export type ReviewFailure = {error?: string; message?: string; problems?: string[]; changed?: string[]};
export type ReviewReply = ReviewFailure & {ok?: boolean; view?: ReviewView; jobId?: number; approvalId?: number; result?: {dir: string; files: {name: string; role: string; bytes: number; sha256: string}[]; verified: {before: string; copy: string; after: string}; alreadyExported: boolean}};
export const getReview = (id: string, render: number | null = null) => call<ReviewView & ReviewFailure>('GET', `/api/episodes/${id}/review${render ? `?render=${render}` : ''}`).then((r) => r.json);
const rv = (id: string, sub: string, body: Record<string, unknown>) => call<ReviewReply>('POST', `/api/episodes/${id}/review/${sub}`, {...body, tab: TAB_ID}).then((r) => r.json);
export const reviewRound = (id: string, renderArtifactId: number) => rv(id, 'round', {renderArtifactId});
export const reviewChecks = (id: string, renderArtifactId: number) => rv(id, 'checks', {renderArtifactId});
export type OpeningInfo = {hook: string | null; title: string; brand: 'pip-explains' | null; signature: {count: number; events: number}; signatureSpec: {t: number; accent: string; gainDb: number}; pipStyle: boolean};
export const getOpening = (id: string) => call<OpeningInfo>('GET', `/api/episodes/${id}/opening`).then((r) => r.json);
export const setOpeningSignature = (id: string, on: boolean) => call<any>('POST', `/api/episodes/${id}/opening`, {signature: on, tab: TAB_ID});
export const startAnimatic = (id: string) => call<any>('POST', `/api/episodes/${id}/animatic`, {tab: TAB_ID});
export const linkPlan = (id: string, b: {audience?: string; brand?: boolean}) => call<any>('POST', `/api/episodes/${id}/link-plan`, {...b, tab: TAB_ID});
export const reviewCover = (id: string, renderArtifactId: number) => rv(id, 'cover', {renderArtifactId});
export const reviewPlayback = (id: string, roundId: number, fromSec: number, toSec: number, heard: boolean, phone: boolean) => rv(id, 'playback', {roundId, fromSec, toSec, heard, phone});
export const reviewSignoff = (id: string, roundId: number, item: string, ticked: boolean, render: number | null) => rv(id, 'signoff', {roundId, item, ticked, render});
export const reviewNoteAdd = (id: string, b: {roundId: number; text: string; type: string; timeSec?: number; segment?: string; build?: string; seq: number; render: number | null}) => rv(id, 'note', b);
export const reviewNoteChange = (id: string, noteId: string, b: Record<string, unknown>) => rv(id, `note/${noteId}`, b);
export const reviewConfirmDiff = (id: string, renderArtifactId: number, segment: string, hash: string, confirmed: boolean) => rv(id, 'confirm-diff', {renderArtifactId, segment, hash, confirmed});
export const reviewApprove = (id: string, roundId: number) => rv(id, 'approve', {roundId, confirm: true});
export const reviewExport = (id: string) => rv(id, 'export', {});

/** Identifies this tab so that it does not refetch its own saves. */
export const TAB_ID = Math.random().toString(36).slice(2);

export type ProjectInfo = {name: string; kind: 'demo' | 'project'; root: string; createdAt: number | null; schemaVersion: number; appSchemaVersion: number; episodes: number; node: string; platform: string; backupsDir: string; backups: {name: string; createdAt: number; bytes: number; files: number}[]; automaticBackups: number};
export type EnvCheckRow = {id: string; label: string; ok: boolean; need: 'app' | 'narration' | 'video' | 'checks'; detail: string; fix?: string};
export type BackupResult = {name?: string; dir?: string; blobs?: number; files?: number; bytes?: number; verified?: boolean; restoreCommand?: string; message?: string};
export const getProject = () => call<ProjectInfo>('GET', '/api/project').then((r) => r.json);
export const makeBackup = () => call<BackupResult>('POST', '/api/project/backup', {});
export const getEnvironment = (deep: boolean) => call<{checks: EnvCheckRow[]}>('GET', `/api/environment${deep ? '?deep=1' : ''}`).then((r) => r.json.checks ?? []);
