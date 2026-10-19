import type {PlayerRef} from '@remotion/player';
import {useCallback, useEffect, useMemo, useReducer, useRef, useState} from 'react';
import type {Status} from '../../core/artifacts.ts';
import {FPS} from '../../src/theme';
import {Autosave, type KV} from '../shared/autosave.ts';
import {compareToBuild, differenceLines, previewFor} from '../shared/compare.ts';
import {staleItems, withRenderDrift, type MeasuredRuns} from '../shared/costs.ts';
import {addNote, setPauseAfter, setSegmentText, setSpeech, toggleEmphasis} from '../shared/edit.ts';
import {cancelJob, cancelRebuild, continueRebuild, getEpisode, getJobs, getLibrary, getMeasured, getPlan, getPrefs, getRevision, getRevisions, getSession, putPref, restoreRevision, retryJob, saveEpisode, startRebuild, type Build, type EpisodePayload, type JobsReply, type LibraryItem, type RevisionRow, type Session, type Timeline as Tl} from './api';
import {Notice, Rail, SaveChip, Stepper, type StageNote} from './Chrome';
import {Episodes} from './Episodes';
import {HistoryPanel} from './History';
import {Inspector} from './Inspector';
import {JobsTray} from './Jobs';
import {NoteComposer, type NoteTarget} from './Notes';
import {styleLabel, voiceLabel, when, whenShort} from './labels';
import {Outline} from './Outline';
import {Planner, isPlanTab, type PlanTab} from './Planner';
import {Voice} from './Voice';
import {Review} from './Review';
import {Playhead} from './playhead';
import {Preview} from './Preview';
import {PlanDialog, type PlanState} from './Rebuild';
import {useModal} from './useModal';
import {Settings} from './Settings';
import {StalePopover} from './Stale';
import {TL_DEFAULT, TL_MAX, TL_MIN, Timeline} from './Timeline';

const TAB = Math.random().toString(36).slice(2);
const localKV: KV = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* storage full or blocked: the in-memory edit still stands */ } },
  remove: (k) => { try { localStorage.removeItem(k); } catch { /* nothing to remove */ } },
};

type Boot = {session: Session; episodeId: string; payload: EpisodePayload; measured: MeasuredRuns; prefs: Record<string, string>};
type Shell = {session: Session; items: LibraryItem[]; measured: MeasuredRuns; prefs: Record<string, string>};
type Route = {screen: 'list'; notice?: string} | {screen: 'editor'; id: string} | {screen: 'plan'; id: string; tab: PlanTab} | {screen: 'voice'; id: string} | {screen: 'review'; id: string} | {screen: 'settings'};
type Nav = {list: () => void; editor: (id: string) => void; plan: (id: string, tab?: PlanTab) => void; voice: (id: string) => void; review: (id: string) => void};

/** The address says where you are: ?episode=ID opens the script editor, ?plan=ID&tab=research the planning steps, ?view=episodes the list. */
function routeFrom(search: string, items: LibraryItem[]): Route {
  const q = new URLSearchParams(search);
  const known = (id: string): Route | null => (items.some((i) => i.id === id) ? null : {screen: 'list', notice: `There is no episode "${id}" in this project, so the list is shown instead.`});
  const plan = q.get('plan');
  if (plan) { const t = q.get('tab'); return known(plan) ?? {screen: 'plan', id: plan, tab: isPlanTab(t) ? t : 'brief'}; }
  const ep = q.get('episode');
  if (ep) return known(ep) ?? {screen: 'editor', id: ep};
  const vo = q.get('voice');
  if (vo) return known(vo) ?? {screen: 'voice', id: vo};
  const rv = q.get('review');
  if (rv) return known(rv) ?? {screen: 'review', id: rv};
  if (q.get('view') === 'settings') return {screen: 'settings'};
  if (q.get('view') === 'episodes') return {screen: 'list'};
  // With a single episode and no drafts there is nothing to choose between: open it, as before drafts existed.
  return items.length === 1 && items[0].hasEpisode ? {screen: 'editor', id: items[0].id} : {screen: 'list'};
}
const urlFor = (r: Route): string => (r.screen === 'settings' ? '/?view=settings' : r.screen === 'list' ? '/?view=episodes' : r.screen === 'editor' ? `/?episode=${encodeURIComponent(r.id)}` : r.screen === 'voice' ? `/?voice=${encodeURIComponent(r.id)}` : r.screen === 'review' ? `/?review=${encodeURIComponent(r.id)}` : `/?plan=${encodeURIComponent(r.id)}&tab=${r.tab}`);

export function App() {
  const [shell, setShell] = useState<Shell | null>(null);
  const [route, setRoute] = useState<Route>({screen: 'list'});
  const [fatal, setFatal] = useState<string | null>(null);
  useEffect(() => {
    (async () => {
      try {
        const session = await getSession();
        if (!session.episodes) { setFatal('This browser is not signed in to the app. Run ./studio-app in the explainer-studio folder; it opens the app with a fresh sign-in link.'); return; }
        const [items, measured, prefs] = await Promise.all([getLibrary(), getMeasured(), getPrefs()]);
        setShell({session, items, measured, prefs});
        setRoute(routeFrom(location.search, items));
      } catch {
        setFatal('The app server could not be reached. Start it with ./studio-app.');
      }
    })();
  }, []);
  useEffect(() => {
    const onPop = () => { void getLibrary().then((items) => { setShell((x) => x && {...x, items}); setRoute(routeFrom(location.search, items)); }, () => setRoute(routeFrom(location.search, shell?.items ?? []))); };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [shell]);
  const go = useCallback((r: Route) => { history.pushState(null, '', urlFor(r)); setRoute(r); }, []);
  const nav: Nav = useMemo(() => ({list: () => go({screen: 'list'}), editor: (id) => go({screen: 'editor', id}), plan: (id, tab = 'brief') => go({screen: 'plan', id, tab}), voice: (id) => go({screen: 'voice', id}), review: (id) => go({screen: 'review', id})}), [go]);
  // the list is read fresh each time it is shown
  useEffect(() => { if (route.screen === 'list' && shell) void getLibrary().then((items) => setShell((s) => s && {...s, items})); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [route.screen]);
  if (fatal) return <div className="boot" role="alert"><h2>Explainer Studio</h2><p>{fatal}</p></div>;
  if (!shell) return <div className="boot" role="status">Opening the workspace…</div>;
  const screen = (): React.ReactElement => {
    if (route.screen === 'settings') return <Settings workspace={shell.session.workspace} onList={nav.list} />;
    if (route.screen === 'list') return <Episodes items={shell.items} notice={route.notice} workspace={shell.session.workspace} onEditor={nav.editor} onPlan={(id) => nav.plan(id)} onCreated={(id) => nav.plan(id, 'brief')} />;
    if (route.screen === 'plan') return <Planner key={route.id} id={route.id} tab={route.tab} workspace={shell.session.workspace} onTab={(t) => nav.plan(route.id, t)} onList={nav.list} onEditor={() => nav.editor(route.id)} onVoice={() => nav.voice(route.id)} onReview={() => nav.review(route.id)} />;
    if (route.screen === 'voice') return <VoiceHost key={route.id} id={route.id} shell={shell} nav={nav} />;
    if (route.screen === 'review') return <Review key={route.id} id={route.id} workspace={shell.session.workspace} onList={nav.list} onEditor={() => nav.editor(route.id)} onVoice={() => nav.voice(route.id)} />;
    return <EditorHost key={route.id} id={route.id} shell={shell} nav={nav} />;
  };
  return <>{route.screen === 'editor' ? null : <ServerLinkBanner />}{screen()}</>;
}

/** The connection notice for the screens that do not have the editor's own: lost, back again, or back after the app was restarted. */
function ServerLinkBanner() {
  const [state, setState] = useState<'live' | 'lost' | 'back' | 'restarted'>('live');
  useEffect(() => {
    const es = new EventSource('/api/events');
    let serverId: string | null = null;
    let lost = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    es.addEventListener('hello', (ev) => {
      const d = JSON.parse((ev as MessageEvent).data) as {serverId: string};
      const restarted = serverId !== null && d.serverId !== serverId;
      serverId = d.serverId;
      if (restarted) setState('restarted');
      else if (lost) { setState('back'); if (timer) clearTimeout(timer); timer = setTimeout(() => setState('live'), 4000); }
      lost = false;
    });
    es.onerror = () => { lost = true; setState((x) => (x === 'restarted' ? x : 'lost')); };
    return () => { es.close(); if (timer) clearTimeout(timer); };
  }, []);
  if (state === 'live') return null;
  return (
    <div className={`linkbanner ${state === 'lost' ? 'bad' : ''}`} role="alert" data-testid="link-banner" data-state={state}>
      {state === 'lost' && <>Lost connection to the app. Nothing you have saved is lost, but changes made now cannot be saved until it returns. Work that was running may have stopped.</>}
      {state === 'back' && <>Connected again.</>}
      {state === 'restarted' && <>The app was restarted. Everything that had been saved is still here; any work that was running was stopped and can be started again. <button className="btn sm" onClick={() => location.reload()}>Reload this screen</button></>}
    </div>
  );
}

function VoiceHost({id, shell, nav}: {id: string; shell: Shell; nav: Nav}) {
  const planned = shell.items.find((i) => i.id === id)?.hasPlan ?? false;
  return <Voice id={id} workspace={shell.session.workspace} onList={nav.list} onEditor={() => nav.editor(id)} onPlan={(t) => nav.plan(id, t)} onReview={() => nav.review(id)} planned={planned} />;
}

function VideoDialog({build, onClose}: {build: NonNullable<Build>; onClose: () => void}) {
  const ref = useModal(onClose);
  const r = build.render!;
  return (
    <div className="scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="dialog video" role="dialog" aria-modal="true" aria-label="Rendered video" ref={ref}>
        <div className="dhead"><div><h2>Rendered video</h2><p className="muted">Build r{build.revision ?? '?'} · {r.kind === 'final' ? 'final' : 'draft'} · made {when(r.builtAt)}{r.fresh ? '' : ' · not made from your newest text'}</p></div><button className="btn sm" onClick={onClose}>Close</button></div>
        <video src={r.url} controls playsInline data-testid="rendered-video" />
      </div>
    </div>
  );
}

function EditorHost({id, shell, nav}: {id: string; shell: Shell; nav: Nav}) {
  const [loaded, setLoaded] = useState<{payload: EpisodePayload; measured: MeasuredRuns; prefs: Record<string, string>} | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);
  useEffect(() => {
    Promise.all([getEpisode(id), getMeasured(), getPrefs()]).then(([payload, measured, prefs]) => { if (payload && payload.doc) setLoaded({payload, measured, prefs}); else setFatal(`There is no episode "${id}" in this workspace.`); }).catch(() => setFatal('The app server could not be reached. Start it with ./studio-app.'));
  }, [id]);
  if (fatal) return <div className="boot" role="alert"><h2>Explainer Studio</h2><p>{fatal}</p><button className="btn" onClick={nav.list}>All episodes</button></div>;
  if (!loaded) return <div className="boot" role="status">Opening the episode…</div>;
  return <Editor boot={{session: shell.session, episodeId: id, payload: loaded.payload, measured: loaded.measured, prefs: loaded.prefs}} nav={nav} />;
}

const flag = (v: string | undefined, d = false) => (v === undefined ? d : v === '1');

function Editor({boot, nav}: {boot: Boot; nav: Nav}) {
  const {session, episodeId} = boot;
  const [measured, setMeasured] = useState(boot.measured);
  const [, force] = useReducer((n: number) => n + 1, 0);
  const [payload, setPayload] = useState(boot.payload);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [prefs, setPrefs] = useState(boot.prefs);
  const [conn, setConn] = useState<'live' | 'lost'>('live');
  const [restarted, setRestarted] = useState(false);
  const [editNotes, setEditNotes] = useState<string[]>([]);
  const [popover, setPopover] = useState(false);
  const [dismissedRestore, setDismissedRestore] = useState(false);
  const [pinned, setPinned] = useState<string | null>(null);
  const pinnedRef = useRef<string | null>(null);
  pinnedRef.current = pinned;
  const [drawer, setDrawer] = useState<'jobs' | 'history' | null>(null);
  const [jobsData, setJobsData] = useState<JobsReply | null>(null);
  const [jobsAt, setJobsAt] = useState(Date.now());
  const [plan, setPlan] = useState<PlanState>({open: false, plan: null, loading: false, message: null, starting: false});
  const planRequest = useRef('');
  const [rebuildNote, setRebuildNote] = useState<{tone: 'warn' | 'bad' | 'info'; text: string} | null>(null);
  const [revisions, setRevisions] = useState<RevisionRow[] | null>(null);
  const [historyMsg, setHistoryMsg] = useState<string | null>(null);
  const [videoOpen, setVideoOpen] = useState(false);
  const playerRef = useRef<PlayerRef | null>(null);
  const ph = useRef(new Playhead()).current;
  const saver = useRef<Autosave | null>(null);
  if (!saver.current) {
    saver.current = new Autosave({
      episodeId, committed: {doc: boot.payload.doc, seq: boot.payload.seq}, store: localKV, onChange: force,
      send: async (doc, baseSeq) => {
        const r = await saveEpisode(episodeId, doc, baseSeq, TAB);
        if (r.result.kind === 'ok') {
          setPayload((p) => ({...p, seq: r.result.kind === 'ok' ? r.result.seq : p.seq, status: r.status ?? p.status, docHash: r.docHash ?? p.docHash}));
          setSavedAt(Date.now());
        }
        return r.result;
      },
    });
  }
  const a = saver.current;
  // leaving the editor saves what can be saved first; anything that cannot be (a conflict, say) stays in this browser and is offered again
  const leave = useMemo(() => ({list: () => void a.flush().finally(nav.list), editor: nav.editor, plan: (id: string, tab?: PlanTab) => void a.flush().finally(() => nav.plan(id, tab)),
    // the Voice stage only ever uses saved text: what can be saved is saved first, and if it cannot be, the editor stays open and says why
    voice: async () => {
      await a.flush();
      const k = a.state.kind;
      if (k === 'saved') { nav.voice(episodeId); return; }
      const why = k === 'conflict' ? 'A newer saved version exists. Choose which text to keep first.' : k === 'invalid' ? 'Some edits cannot be saved yet. Fix them first.' : k === 'failed' ? 'Your latest edits could not be saved. Retry saving first.' : 'Your latest edits are still being saved. Try again in a moment.';
      setRebuildNote({tone: 'bad', text: `The Voice stage was not opened. ${why} Narration only uses saved text.`});
    },
    // Review plays the exact rendered file and works on saved text: unsaved edits are saved first, or the editor stays and says why
    review: async () => {
      await a.flush();
      const k = a.state.kind;
      if (k === 'saved') { nav.review(episodeId); return; }
      const why = k === 'conflict' ? 'A newer saved version exists. Choose which text to keep first.' : k === 'invalid' ? 'Some edits cannot be saved yet. Fix them first.' : k === 'failed' ? 'Your latest edits could not be saved. Retry saving first.' : 'Your latest edits are still being saved. Try again in a moment.';
      setRebuildNote({tone: 'bad', text: `Review was not opened. ${why} A review is made on saved text.`});
    }}), [a, nav, episodeId]);
  const doc = a.doc;
  const build = payload.build;
  const built = build?.builtDoc ?? null;

  // ---- preferences (kept in the workspace, so they survive reloads and restarts) -------------------------------------
  const setPref = useCallback((k: string, v: string) => { setPrefs((p) => ({...p, [k]: v})); void putPref(k, v); }, []);
  const outlineCollapsed = flag(prefs['app.outline.collapsed']);
  const inspectorCollapsed = flag(prefs['app.inspector.collapsed']);
  const [tlHeight, setTlHeight] = useState(() => Math.min(TL_MAX, Math.max(TL_MIN, Number(prefs['app.timeline.height']) || TL_DEFAULT)));
  const onTlHeight = (h: number, commit: boolean) => { setTlHeight(h); if (commit) void putPref('app.timeline.height', String(h)); };

  // ---- selection ---------------------------------------------------------------------------------------------------------
  const ids = doc.narration.segments.map((s) => s.id);
  const stored = prefs[`app.selected.${episodeId}`];
  const selected = stored && ids.includes(stored) ? stored : ids[0];
  const selRef = useRef(selected);
  selRef.current = selected;
  const startFrame = (id: string) => { const s = build?.timeline.segments.find((x) => x.id === id); return s ? Math.round(s.start * FPS) : null; };
  const select = useCallback((id: string, seek = true) => {
    if (id === selRef.current && !seek) return;
    selRef.current = id;
    setPref(`app.selected.${episodeId}`, id);
    if (seek) { const f = startFrame(id); if (f !== null) playerRef.current?.seekTo(f); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [episodeId, setPref, build]);
  const segmentAt = useCallback((frame: number) => build?.timeline.segments.find((s) => frame / FPS >= s.start && frame / FPS < s.end)?.id ?? null, [build]);
  const step = (d: number) => { const i = ids.indexOf(selRef.current); const n = ids[Math.max(0, Math.min(ids.length - 1, i + d))]; select(n); };
  useEffect(() => ph.subscribe(() => { if (!ph.playing) return; const s = segmentAt(ph.frame); if (s && s !== selRef.current) select(s, false); }), [ph, segmentAt, select]);
  const onReady = useCallback(() => { const f = startFrame(selRef.current); if (f) playerRef.current?.seekTo(f); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [build]);

  // ---- server events: other tabs, restarts, lost connection --------------------------------------------------------------
  const refetch = useCallback(async () => {
    try {
      const p = await getEpisode(episodeId, pinnedRef.current);
      setPayload(p);
      saver.current!.external({doc: p.doc, seq: p.seq});
    } catch { /* still unreachable: the connection notice stays */ }
  }, [episodeId]);

  // ---- jobs: what the tray shows, and what to refresh when work finishes ----------------------------------------------
  const lastStates = useRef<Map<number, string>>(new Map());
  const lastRebuilds = useRef<Map<string, string>>(new Map());
  const refreshJobs = useCallback(async () => {
    try {
      const d = await getJobs(episodeId);
      setJobsData(d);
      setJobsAt(Date.now());
      let finished = false;
      for (const j of d.jobs) {
        const before = lastStates.current.get(j.id);
        if (before && before !== j.state && !['queued', 'preparing', 'running', 'cancelling'].includes(j.state)) finished = true;
        lastStates.current.set(j.id, j.state);
      }
      for (const r of d.rebuilds) {
        const before = lastRebuilds.current.get(r.id);
        if (before && before !== r.state && r.state === 'complete') { setPinned(null); pinnedRef.current = null; setRebuildNote({tone: 'info', text: 'Rebuild finished. The preview now shows the new build, made from your saved text.'}); void getMeasured().then(setMeasured); }
        if (before && before !== r.state && (r.state === 'failed' || r.state === 'stopped' || r.state === 'cancelled')) setRebuildNote({tone: r.state === 'failed' ? 'bad' : 'warn', text: `${r.state === 'failed' ? 'A rebuild step failed' : r.state === 'cancelled' ? 'The rebuild was cancelled' : 'The rebuild stopped because you edited the text while it ran'}. The earlier build is still available.`});
        lastRebuilds.current.set(r.id, r.state);
      }
      if (finished) void refetch();
    } catch { /* offline: the connection notice stays */ }
  }, [episodeId, refetch]);
  const jobsTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const jobsSoon = useCallback(() => { if (jobsTimer.current) clearTimeout(jobsTimer.current); jobsTimer.current = setTimeout(() => void refreshJobs(), 120); }, [refreshJobs]);
  useEffect(() => { if (payload.rebuilds) void refreshJobs(); }, [payload.rebuilds, refreshJobs]);
  const activeJobs = (jobsData?.jobs ?? []).filter((j) => ['queued', 'preparing', 'running', 'cancelling'].includes(j.state)).length;
  useEffect(() => {
    const es = new EventSource('/api/events');
    let serverId: string | null = null;
    let wasLost = false;
    es.addEventListener('hello', (ev) => {
      const d = JSON.parse((ev as MessageEvent).data) as {serverId: string};
      if (serverId && d.serverId !== serverId) setRestarted(true);
      const reconnect = serverId !== null || wasLost;
      serverId = d.serverId;
      setConn('live');
      if (reconnect) { void refetch(); jobsSoon(); if (saver.current!.state.kind === 'failed') void saver.current!.flush(); }
    });
    es.addEventListener('committed', (ev) => { if ((JSON.parse((ev as MessageEvent).data) as {tab: string}).tab !== TAB) void refetch(); });
    es.addEventListener('jobs', () => jobsSoon());
    es.onerror = () => { wasLost = true; setConn('lost'); };
    return () => es.close();
  }, [refetch, jobsSoon]);
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => { if (saver.current!.dirty) { e.preventDefault(); } };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, []);

  // ---- rebuild: save first, show the plan, then start ------------------------------------------------------------------
  const newRequestId = () => `req-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const loadPlan = async (message: string | null = null) => {
    setPlan({open: true, plan: null, loading: true, message, starting: false});
    const r = await getPlan(episodeId);
    if (r.status !== 200) setPlan({open: true, plan: null, loading: false, message: (r.json as {message?: string}).message ?? 'The summary could not be made.', starting: false});
    else setPlan({open: true, plan: r.json, loading: false, message, starting: false});
  };
  const openPlan = async () => {
    setRebuildNote(null);
    await saver.current!.flush(); // pending valid edits are committed first
    const k = saver.current!.state.kind;
    if (k !== 'saved') {
      const why = k === 'conflict' ? 'A newer saved version exists. Choose which text to keep first.' : k === 'invalid' ? 'Some edits cannot be saved yet. Fix them first.' : k === 'failed' ? 'Your latest edits could not be saved. Retry saving first.' : 'Your latest edits are still being saved. Try again in a moment.';
      setRebuildNote({tone: 'bad', text: `Rebuild was not started. ${why} A rebuild only uses saved text.`});
      return;
    }
    planRequest.current = newRequestId();
    await loadPlan();
  };
  const startPlan = async () => {
    if (!plan.plan || plan.starting) return;
    setPlan((s) => ({...s, starting: true}));
    const r = await startRebuild(episodeId, plan.plan.seq, planRequest.current);
    if (r.status === 202) {
      setPlan({open: false, plan: null, loading: false, message: null, starting: false});
      const reused = (r.json.reused ?? []) as string[];
      if (!(r.json.jobIds as number[]).length) setRebuildNote({tone: 'info', text: `Everything needed already existed, so saved outputs were selected: ${reused.join(', ')}. Nothing was rebuilt.`});
      else setDrawer('jobs');
      void refreshJobs();
      void refetch();
    } else if (r.json.error === 'changed') {
      planRequest.current = newRequestId();
      await loadPlan('The episode was saved again after this summary was made. Here is the new summary; nothing was started.');
    } else if (r.json.error === 'blocked') {
      setPlan((s) => ({...s, starting: false, message: null, plan: s.plan && {...s.plan, blockers: r.json.blockers ?? s.plan.blockers}}));
    } else setPlan((s) => ({...s, starting: false, message: r.json.message ?? 'The rebuild could not be started.'}));
  };
  const trayActions = {
    cancel: (id: number) => void cancelJob(id).then(refreshJobs),
    retry: (id: number) => void retryJob(id).then((r) => { if (r.status !== 200) setRebuildNote({tone: 'warn', text: r.json.message ?? 'The step could not be retried.'}); void refreshJobs(); }),
    cancelRebuild: (id: string) => void cancelRebuild(id).then(refreshJobs),
    reviewRebuild: () => { setDrawer(null); void openPlan(); },
    continueRebuild: (id: string) => void continueRebuild(id).then((r) => { if (r.status !== 200) setRebuildNote({tone: 'warn', text: r.json.message ?? 'The rebuild could not be continued.'}); void refreshJobs(); }),
  };

  // ---- history: revisions and builds ----------------------------------------------------------------------------------------
  useEffect(() => { if (drawer === 'history') void getRevisions(episodeId).then(setRevisions); }, [drawer, episodeId, payload.seq]);
  const restore = async (n: number): Promise<string | null> => {
    await saver.current!.flush();
    if (saver.current!.state.kind !== 'saved') return 'Save or resolve your current edits first; a restore only applies to saved text.';
    const r = await restoreRevision(episodeId, n, saver.current!.committed.seq, TAB);
    if (r.status === 200) {
      const cur = r.json.current as EpisodePayload;
      setPayload(cur);
      saver.current!.external({doc: cur.doc, seq: cur.seq});
      setHistoryMsg(`Restored r${n}. Its text is now the current text, saved as a new revision. Nothing was deleted.`);
      void getRevisions(episodeId).then(setRevisions);
      return null;
    }
    void refetch();
    return r.status === 409 ? 'A newer saved version exists, so nothing was restored. The list has been refreshed.' : (r.json.message ?? 'The restore did not work.');
  };
  const previewBuild = (id: string | null) => {
    setPinned(id);
    pinnedRef.current = id;
    void getEpisode(episodeId, id).then((p) => setPayload((prev) => ({...prev, build: p.build, builds: p.builds, status: p.status})));
  };

  // ---- derived, truthful views of the preview ------------------------------------------------------------------------
  const diff = useMemo(() => (built ? compareToBuild(built, doc) : null), [built, doc]);
  const preview = useMemo(() => (build && built ? previewFor(built, build.timeline, doc) : null), [build, built, doc]);
  const lines = diff && preview ? differenceLines(diff, preview) : [];
  const items = a.state.kind === 'saved' ? withRenderDrift(staleItems(payload.status, built ?? doc, measured), payload.status, payload.renderDrift ?? [], measured) : null;
  const staleCount = items?.stale.length ?? 0;
  const edited = !!diff?.any;

  // ---- editing ---------------------------------------------------------------------------------------------------------------
  const seg = doc.narration.segments.find((s) => s.id === selected)!;
  const onText = (v: string) => { const r = setSegmentText(doc, selected, v); setEditNotes(r.notes); a.edit(r.doc); };
  const onSpeech = (v: string) => { setEditNotes([]); a.edit(setSpeech(doc, selected, v)); };
  const onPause = (v: number | undefined) => { setEditNotes([]); a.edit(setPauseAfter(doc, selected, v)); };
  // ---- review notes: N (or the + Note button) opens the composer at the playhead -------------------------------------------------
  const [noteTarget, setNoteTarget] = useState<NoteTarget | null>(null);
  const noteReturn = useRef<HTMLElement | null>(null);
  const openNote = () => {
    noteReturn.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frame = ph.frame;
    setNoteTarget({timeSec: build ? Math.round((frame / FPS) * 100) / 100 : undefined, segment: (build && segmentAt(frame)) || selRef.current});
  };
  const closeNote = () => { setNoteTarget(null); setTimeout(() => noteReturn.current?.focus(), 0); };
  const submitNote = (text: string, type: Parameters<typeof addNote>[1]['type']) => {
    if (!noteTarget) return;
    const r = addNote(doc, {text, type, timeSec: noteTarget.timeSec, segment: noteTarget.segment, render: build?.render ? {id: String(build.render.id), kind: build.render.kind === 'draft' ? 'draft' : 'final'} : undefined});
    if (r) a.edit(r.doc);
    closeNote();
  };
  const onWord = (i: number) => { setEditNotes([]); a.edit(toggleEmphasis(doc, selected, i)); };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') { e.preventDefault(); void saver.current!.flush(); return; }
      const t = e.target as HTMLElement;
      if (e.metaKey || e.ctrlKey || e.altKey || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable) return;
      if (e.key === ' ' && !/^(BUTTON|SUMMARY|A)$/.test(t.tagName) && t.getAttribute('role') !== 'separator') { e.preventDefault(); playerRef.current?.toggle(); }
      else if (e.key === ']') step(1);
      else if (e.key === '[') step(-1);
      else if (e.key === 'n' || e.key === 'N') { e.preventDefault(); openNote(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // ---- chrome state --------------------------------------------------------------------------------------------------------
  const stage = (s: Status): Record<number, StageNote> => {
    const takes = Object.values(s.takes);
    const out: Record<number, StageNote> = {};
    if (takes.length && takes.every((t) => t.status === 'none')) out[5] = {label: 'not built', tone: 'none'};
    else if (takes.length) out[5] = takes.every((t) => t.status === 'fresh') ? {label: 'up to date', tone: 'ok'} : {label: 'out of date', tone: 'warn'};
    const r = s.render.final;
    if (r.status !== 'none') out[8] = r.status === 'fresh' ? {label: 'final up to date', tone: 'ok'} : {label: 'out of date', tone: 'warn'};
    return out;
  };
  const buildLabel = build ? `Build r${build.revision ?? '?'} · ${whenShort(build.builtAt)}${build.imported ? ' · imported' : ''}` : 'Nothing built yet';
  const buildTitle = build ? `Last build of this episode: workspace revision ${build.revision ?? '?'}, built ${when(build.builtAt)}${build.imported ? `. ${build.imported.note}` : ''}` : '';
  const freshness = !build ? {tone: 'amber' as const, text: '', title: ''}
    : !edited && build.matchesLatestEdits ? {tone: 'green' as const, text: 'Matches your saved text', title: 'The timeline, audio and video of this build were all made from the text you have now.'}
    : edited ? {tone: 'amber' as const, text: 'Older than your edits', title: 'This build was made from earlier text. See the notice above the preview for what differs.'}
    : {tone: 'amber' as const, text: 'Needs a rebuild', title: 'Something this build depends on changed (for example the render sources). Use Rebuild to refresh it.'};
  const st = a.state;
  const data = useMemo(() => (preview ? {episode: preview.episode, timeline: preview.timeline as Tl} : null), [preview]);

  return (
    <div className="app">
      <Rail onEpisodes={leave.list} />
      <div className="main">
        <header className="top">
          <div className="titles">
            <span className="crumb">{session.workspace} · {voiceLabel(doc.voice)} · {styleLabel(doc.style)}</span>
            <h1 className="ttl" title={doc.title}>{doc.title}</h1>
          </div>
          <span className="spacer" />
          <button className={`chip btn-chip ${edited || staleCount ? 'amber' : 'green'}`} aria-haspopup="dialog" aria-expanded={popover} onClick={() => setPopover((v) => !v)} data-testid="stale-chip" data-stale={edited || staleCount ? 'true' : 'false'}>
            <i className={`dot ${edited || staleCount ? 'amber' : ''}`} />
            {items && staleCount ? `${staleCount} out of date` : edited ? 'Changed since build' : build ? 'As built' : 'Nothing built'}
          </button>
          <SaveChip state={st} savedAt={savedAt} onRetry={() => void a.flush()} />
          <button className={`btn sm ${drawer === 'history' ? 'on' : ''}`} onClick={() => setDrawer((d) => (d === 'history' ? null : 'history'))} aria-expanded={drawer === 'history'} data-testid="history-button">History</button>
          {payload.rebuilds && (
            <>
              <button className={`btn sm ${drawer === 'jobs' ? 'on' : ''}`} onClick={() => setDrawer((d) => (d === 'jobs' ? null : 'jobs'))} aria-expanded={drawer === 'jobs'} data-testid="jobs-button">
                Jobs{activeJobs > 0 && <span className="count" data-testid="jobs-count">{activeJobs}</span>}
              </button>
              <button className="btn pri" onClick={() => void openPlan()} disabled={!!payload.active || activeJobs > 0} title={payload.active || activeJobs > 0 ? 'A rebuild is in progress. See Jobs.' : 'Make a new video from your saved text'} data-testid="rebuild-button">Rebuild…</button>
            </>
          )}
        </header>
        <Stepper notes={stage(payload.status)} current={3} go={payload.planned ? {1: () => leave.plan(episodeId, 'brief'), 2: () => leave.plan(episodeId, 'research'), 4: () => leave.plan(episodeId, 'storyboard'), 6: () => leave.plan(episodeId, 'scenes'), ...(payload.rebuilds ? {5: () => void leave.voice(), 7: () => void leave.review()} : {})} : payload.rebuilds ? {5: () => void leave.voice(), 7: () => void leave.review()} : undefined} />
        <div className="notices">
          {st.kind === 'conflict' && (
            <Notice tone="bad" actions={<><button className="btn sm" onClick={() => void a.keepMine()}>Keep my edits and save on top</button><button className="btn sm" onClick={() => a.takeTheirs()}>Use the saved version</button></>}>
              <b>A newer saved version of this episode exists</b> (saved in another tab or session). Your edits are kept here until you choose.
              {a.restored === 'conflict' && ' These are edits from an earlier session, made before that newer version was saved.'}
            </Notice>
          )}
          {st.kind === 'failed' && <Notice tone="bad" actions={<button className="btn sm" onClick={() => void a.flush()}>Retry</button>}><b>Not saved.</b> {st.message}{/[.!?]$/.test(st.message) ? '' : '.'} Your edits are kept in this browser and nothing is lost.</Notice>}
          {st.kind === 'invalid' && <Notice tone="bad"><b>These edits can’t be saved yet.</b> {st.message}{/[.!?]$/.test(st.message) ? '' : '.'} They are kept; fix them and they save automatically.</Notice>}
          {a.restored === 'edits' && !dismissedRestore && <Notice tone="info" actions={<><button className="btn sm" onClick={() => a.discardEdits()}>Discard them</button><button className="btn sm" onClick={() => setDismissedRestore(true)}>OK</button></>}>Unsaved edits from your last session were put back. They are being saved now.</Notice>}
          {conn === 'lost' && <Notice tone="warn">Lost connection to the app. Edits are kept in this browser and saved when the connection returns.</Notice>}
          {restarted && <Notice tone="info" actions={<button className="btn sm" onClick={() => setRestarted(false)}>OK</button>}>The app was restarted. Everything that had been saved is still here.</Notice>}
          {rebuildNote && <Notice tone={rebuildNote.tone} actions={<><button className="btn sm" onClick={() => { setDrawer('jobs'); setRebuildNote(null); }}>Open jobs</button><button className="btn sm" onClick={() => setRebuildNote(null)}>OK</button></>}><span data-testid="rebuild-note">{rebuildNote.text}</span></Notice>}
          {activeJobs > 0 && !rebuildNote && <Notice tone="info" actions={<button className="btn sm" onClick={() => setDrawer('jobs')}>Open jobs</button>}><span data-testid="active-note">A rebuild is in progress{payload.active ? `: ${payload.active.description}` : ''}. You can keep editing; it uses the text it started with, and this preview stays on the last finished build until it completes.</span></Notice>}
          {editNotes.map((n) => <Notice key={n} tone="warn" actions={<button className="btn sm" onClick={() => setEditNotes([])}>OK</button>}>{n}</Notice>)}
        </div>
        <div className="work" style={{gridTemplateColumns: `${outlineCollapsed ? 56 : 292}px minmax(0,1fr) ${inspectorCollapsed ? 56 : 352}px`}}>
          <Outline doc={doc} timeline={build?.timeline ?? null} diff={diff} selected={selected} onSelect={(id) => select(id)} collapsed={outlineCollapsed} onToggle={() => setPref('app.outline.collapsed', outlineCollapsed ? '0' : '1')} />
          {build && data ? (
            <Preview id={episodeId} build={build} data={data} playerRef={playerRef} ph={ph} lines={lines} onOpenStale={() => setPopover(true)} staleCount={staleCount} buildLabel={buildLabel} buildTitle={buildTitle} freshness={freshness} isLatest={build.isLatest} onShowLatest={() => previewBuild(null)} hasVideo={!!build.render} onPlayVideo={() => setVideoOpen(true)} onAddNote={openNote} segmentAt={segmentAt} onPrev={() => step(-1)} onNext={() => step(1)} onReady={onReady} />
          ) : (
            <section className="center empty" aria-label="Preview"><div><h3>Nothing has been built for this episode yet</h3><p>The preview shows the last build. Narration and timing are built in a later version of this screen.</p></div></section>
          )}
          <Inspector doc={doc} segment={seg} diff={diff} build={build} status={payload.status} payload={payload} collapsed={inspectorCollapsed} onToggle={() => setPref('app.inspector.collapsed', inspectorCollapsed ? '0' : '1')} onText={onText} onSpeech={onSpeech} onPause={onPause} onToggleWord={onWord} onOpenStale={() => setPopover(true)} notes={doc.reviewNotes.filter((n) => n.anchor?.segment === seg.id)} />
        </div>
        {build && <Timeline tl={build.timeline} diff={diff} live={preview?.live ?? []} selected={selected} onSelect={(id) => select(id)} ph={ph} onSeek={(f) => playerRef.current?.seekTo(f)} height={tlHeight} onHeight={onTlHeight} notes={doc.reviewNotes} />}
        {noteTarget && <NoteComposer target={noteTarget} onAdd={submitNote} onCancel={closeNote} />}
        {drawer === 'jobs' && <JobsTray data={jobsData} fetchedAt={jobsAt} actions={trayActions} onClose={() => setDrawer(null)} episodeTitle={doc.title} />}
        {drawer === 'history' && (
          <HistoryPanel revisions={revisions} builds={payload.builds} loadDetail={(n) => getRevision(episodeId, n)} onRestore={restore} onPreviewBuild={previewBuild} onClose={() => { setDrawer(null); setHistoryMsg(null); }} message={historyMsg}
            restoreBlocked={st.kind === 'conflict' ? 'A newer saved version exists. Choose which text to keep before restoring.' : null} />
        )}
        {popover && <StalePopover view={{lines, items, saveKind: st.kind}} onClose={() => setPopover(false)} onRebuild={payload.rebuilds ? () => { setPopover(false); void openPlan(); } : undefined} />}
        {plan.open && <PlanDialog state={plan} onStart={() => void startPlan()} onClose={() => setPlan((x) => ({...x, open: false}))} onOpenSegment={(id) => { setPlan((x) => ({...x, open: false})); select(id); }} />}
        {videoOpen && build?.render && <VideoDialog build={build} onClose={() => setVideoOpen(false)} />}
      </div>
      <span className="sr-only" aria-live="polite">{st.kind === 'saved' ? 'All changes saved' : st.kind === 'failed' ? 'Not saved' : ''}</span>
    </div>
  );
}
