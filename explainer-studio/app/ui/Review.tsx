// The Review stage: the exact video file that is being reviewed (not the live Player preview), notes written against it in rounds,
// the production checks, the confirmations a person ticks, approval and export. Everything shown comes from one reading of the server;
// every action here is a person's click. The page ticks nothing, approves nothing and exports nothing by itself, and it says what each
// record is: playing the video and ticking a box record that someone did it, not that they paid attention or that the content is right.
import {useCallback, useEffect, useRef, useState} from 'react';
import type {CheckItem} from '../../core/checks.ts';
import type {Note} from '../../src/schema2.ts';
import {unresolvedFailures, type NoteView, type ReviewView, type VideoRow} from '../shared/review.ts';
import type {Plan} from '../shared/plan-types.ts';
import {cancelJob, getPlan, getReview, reviewApprove, reviewChecks, reviewCover, reviewConfirmDiff, reviewExport, reviewNoteAdd, reviewNoteChange, reviewPlayback, reviewRound, reviewSignoff, startRebuild, type ReviewReply} from './api';
import {Notice, Rail, Stepper, type StageNote} from './Chrome';
import {mmss, when, whenShort} from './labels';
import {PlanDialog, type PlanState} from './Rebuild';

type Msg = {tone: 'warn' | 'bad' | 'info'; text: string};
const newRequestId = () => `req-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const short = (h: string) => `${h.slice(0, 12)}…`;
const MB = (b: number) => `${(b / 2 ** 20).toFixed(1)} MB`;

const KIND: Record<CheckItem['kind'], string> = {measured: 'Measured', heuristic: 'Heuristic warning', partial: 'Only partly checked', manual: 'You judge'};
const STATUS: Record<CheckItem['status'], {label: string; cls: string}> = {pass: {label: 'Pass', cls: 'green'}, warn: {label: 'Warning', cls: 'amber'}, fail: {label: 'Fail', cls: 'rose'}, unchecked: {label: 'Not examined', cls: ''}, info: {label: 'Fact', cls: 'acc'}};
const SECTION: Record<CheckItem['section'], string> = {narration: 'Narration', captions: 'Captions and spoken text', layout: 'Fonts, overflow and overlaps', mastering: 'Video file and mastering', custom: 'Custom scenes'};
const SIGNOFF: Record<string, string> = {
  listened: 'I listened to the whole file (voice, pauses, accents, sound accents).',
  watchedPhoneSize: 'I watched it at phone size with the sound on.',
  customScenesReviewed: 'I looked at the frames of every custom scene.',
  notesResolved: 'I resolved or dismissed every open note.',
};
const NOTE_TYPES: Note['type'][] = ['voice', 'visual', 'copy', 'timing', 'factual', 'general'];
const NOTE_STATE: Record<NoteView['assessment']['state'], {label: string; cls: string}> = {current: {label: '', cls: ''}, reassess: {label: 'Needs reassessment', cls: 'amber'}, orphaned: {label: 'Its segment is gone', cls: 'rose'}, legacy: {label: 'Older note', cls: ''}};

function useBusyPoll(active: boolean, fn: () => void) {
  useEffect(() => { if (!active) return; const t = setInterval(fn, 1500); return () => clearInterval(t); }, [active, fn]);
}

export function Review({id, workspace, onList, onEditor, onVoice}: {id: string; workspace: string; onList: () => void; onEditor: () => void; onVoice: () => void}) {
  const [view, setView] = useState<ReviewView | null>(null);
  const [picked, setPicked] = useState<number | null>(null);
  const [msg, setMsg] = useState<Msg | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);
  const [plan, setPlan] = useState<PlanState & {mode: 'draft' | 'final'}>({open: false, plan: null, loading: false, message: null, starting: false, mode: 'final'});
  const planRequest = useRef('');
  const pickedRef = useRef<number | null>(null);
  pickedRef.current = picked;

  const load = useCallback(async () => {
    const r = await getReview(id, pickedRef.current);
    if (r.error && !r.videos) { setFatal(r.message ?? 'The review could not be loaded.'); return; }
    setView(r as ReviewView);
  }, [id]);
  useEffect(() => { void load().catch(() => setFatal('The app server could not be reached. Start it with ./studio-app.')); }, [load, picked]);
  useEffect(() => {
    const es = new EventSource('/api/events');
    const soon = (() => { let t: ReturnType<typeof setTimeout> | null = null; return () => { if (t) clearTimeout(t); t = setTimeout(() => void load().catch(() => undefined), 150); }; })();
    es.addEventListener('jobs', soon); es.addEventListener('review', soon); es.addEventListener('committed', soon);
    return () => es.close();
  }, [load]);
  useBusyPoll(!!view?.busy, () => void load().catch(() => undefined));

  const apply = (r: ReviewReply, okText?: string) => {
    if (r.view) setView(r.view);
    if (r.error || (r.message && !r.ok)) {
      setMsg({tone: 'bad', text: `${r.message ?? 'That did not work.'}${r.problems ? ` ${r.problems.join(' ')}` : ''}`});
      if (r.error === 'conflict' || r.error === 'blocked') void load();
    } else if (okText) setMsg({tone: 'info', text: okText});
    return !r.error;
  };

  if (fatal) return <div className="boot" role="alert"><h2>Explainer Studio</h2><p>{fatal}</p><button className="btn" onClick={onList}>All episodes</button></div>;
  if (!view) return <div className="boot" role="status">Opening the review…</div>;
  const v = view;
  const sel = v.selected;
  const stageNotes: Record<number, StageNote> = {7: {label: v.readiness.blockers.length ? `${v.readiness.blockers.length} to do` : 'ready', tone: v.readiness.blockers.length ? 'warn' : 'ok'}};
  if (v.approval.state === 'valid') stageNotes[9] = {label: 'approved', tone: 'ok'};
  else if (v.approval.state === 'void') stageNotes[9] = {label: 'approval void', tone: 'warn'};

  // ---- building a draft or the final video: the same plan dialog the editor uses, then the same job runner ----------------------------
  const openPlan = async (mode: 'draft' | 'final') => {
    setMsg(null);
    planRequest.current = newRequestId();
    setPlan({open: true, plan: null, loading: true, message: null, starting: false, mode});
    const r = await getPlan(id, mode);
    if (r.status !== 200) setPlan((s) => ({...s, loading: false, message: (r.json as {message?: string}).message ?? 'The summary could not be made.'}));
    else setPlan((s) => ({...s, loading: false, plan: r.json as Plan}));
  };
  const startPlan = async () => {
    if (!plan.plan || plan.starting) return;
    setPlan((s) => ({...s, starting: true}));
    const r = await startRebuild(id, plan.plan.seq, planRequest.current, plan.mode);
    if (r.status === 202) { setPlan((s) => ({...s, open: false, starting: false})); void load(); }
    else if (r.json.error === 'changed') { setPlan((s) => ({...s, starting: false})); void openPlan(plan.mode); setMsg({tone: 'warn', text: 'The episode was saved again after that summary was made. Here is the new summary; nothing was started.'}); }
    else setPlan((s) => ({...s, starting: false, message: r.json.message ?? 'It could not be started.', plan: r.json.blockers && s.plan ? {...s.plan, blockers: r.json.blockers} : s.plan}));
  };

  return (
    <div className="app" data-testid="review-screen" data-busy={v.busy ? 'yes' : 'no'}>
      <Rail onEpisodes={onList} />
      <div className="main plain" data-screen="review">
        <header className="top">
          <div className="titles"><span className="crumb">{workspace} · Review</span><h1 className="ttl" title={v.title}>{v.title}</h1></div>
          <span className="spacer" />
          <button className="btn sm" onClick={onEditor}>Script editor</button>
          <button className="btn sm" onClick={onVoice}>Voice</button>
          <button className="btn sm" onClick={() => void openPlan('draft')} disabled={v.busy} data-testid="make-draft" title="A draft video for review: unmastered audio, never approvable">Make a draft video…</button>
          <button className="btn pri sm" onClick={() => void openPlan('final')} disabled={v.busy} data-testid="make-final" title="The mastered video that is reviewed, approved and exported">Make the final video…</button>
        </header>
        <Stepper notes={stageNotes} current={7} go={{3: onEditor, 5: onVoice, 8: () => document.querySelector('[data-testid=review-work]')?.scrollIntoView({block: 'start'}), 9: () => document.querySelector('[data-testid=review-export]')?.scrollIntoView({block: 'start'})}} />
        <div className="notices">
          {msg && <Notice tone={msg.tone} actions={<button className="btn sm" onClick={() => setMsg(null)}>OK</button>}><span data-testid="review-note">{msg.text}</span></Notice>}
          <Notice tone="info"><span data-testid="review-limits">Playing the video and ticking a box <b>record that you did it</b>. They do not show that you paid attention, or that the content is correct. The checks cannot find a word the voice dropped; only listening can.</span></Notice>
        </div>
        <main className="page" aria-label="Review">
        <div className="rv-grid">
          <Videos v={v} onPick={(rid) => { setPicked(rid); }} onBuild={openPlan} onCancel={(jid) => void cancelJob(jid).then(() => load())} />
          <div className="rv-main">
            {sel ? <Player key={sel.renderArtifactId} v={v} sel={sel} apply={apply} reload={load} /> : <div className="card"><h3>No video yet</h3><p className="muted">Make a draft video to review. A draft has unmastered audio and can never be approved; the final video is the mastered file that is reviewed, approved and exported.</p></div>}
            {sel && <Notes v={v} sel={sel} apply={apply} />}
          </div>
          <div className="rv-side">
            {sel?.cover && <CoverCard v={v} sel={sel} cover={sel.cover} apply={apply} />}
            {sel && <Checks v={v} sel={sel} apply={apply} />}
            {sel && <Approval v={v} sel={sel} apply={apply} />}
            <Export v={v} apply={apply} />
          </div>
        </div>
        </main>
        {plan.open && <PlanDialog state={plan} onStart={() => void startPlan()} onClose={() => setPlan((s) => ({...s, open: false}))} onOpenSegment={() => setPlan((s) => ({...s, open: false}))} />}
      </div>
    </div>
  );
}

// ---- the list of videos (rounds) and the work in progress ---------------------------------------------------------------------------
function Videos({v, onPick, onBuild, onCancel}: {v: ReviewView; onPick: (id: number) => void; onBuild: (m: 'draft' | 'final') => void; onCancel: (jobId: number) => void}) {
  const active = v.jobs.filter((j) => ['queued', 'preparing', 'running', 'cancelling'].includes(j.state));
  return (
    <aside className="rv-list" aria-label="Videos" data-testid="video-list">
      <h3>Videos</h3>
      <p className="muted small">Each video is reviewed in its own round. A draft is the unmastered audio and can never be approved. The final video is the mastered file that is approved and exported.</p>
      {active.length > 0 && (
        <div className="rv-work" data-testid="review-work">
          {active.map((j) => (
            <div key={j.id} className="vjob" data-state={j.state}>
              <div className="hrow"><span className="chip sm acc"><i className="spin" />{j.label}</span><span className="spacer" />{j.canCancel && <button className="btn sm" onClick={() => onCancel(j.id)}>Cancel</button>}</div>
              <div className="muted small">{j.displayStep ?? j.state}{j.fraction !== null ? ` · ${Math.round(j.fraction * 100)}%` : ''}</div>
            </div>
          ))}
        </div>
      )}
      {unresolvedFailures(v.jobs).slice(0, 1).map((j) => <div key={j.id} className="jerr" role="alert">{j.label} failed: {j.friendlyError}</div>)}
      <ul className="rv-videos">
        {v.videos.map((x) => (
          <li key={x.renderArtifactId} data-testid={`video-${x.renderArtifactId}`} data-kind={x.kind} data-selected={v.selected?.renderArtifactId === x.renderArtifactId ? 'yes' : 'no'}>
            <button className="rv-vbtn" onClick={() => onPick(x.renderArtifactId)}>
              <span className={`chip sm ${x.kind === 'final' ? 'green' : 'amber'}`}>{x.label}</span>
              <span className="small">{x.round ? `Round ${x.round.number}` : 'Not reviewed yet'}{x.round?.closedAt ? ' · closed' : ''}</span>
              <span className="muted small">{whenShort(x.builtAt)}{x.revision !== null ? ` · r${x.revision}` : ''}{x.imported ? ' · imported' : ''}</span>
              <span className="muted small">{x.fresh ? 'Matches your saved text' : x.isCurrent ? 'Older than your edits' : 'An earlier video'}</span>
              <span className="muted small">{x.checks.state === 'running' ? 'Checks running…' : x.checks.state === 'done' ? `Checks: ${x.checks.passed ? 'no failures' : `${x.checks.fail} failing`}` : 'Checks not run'}</span>
            </button>
          </li>
        ))}
      </ul>
      {v.videos.length === 0 && <div className="muted small">Nothing has been rendered by this workspace for this episode yet.</div>}
      <div className="hrow"><button className="btn sm" onClick={() => onBuild('draft')} disabled={v.busy}>Draft…</button><button className="btn sm" onClick={() => onBuild('final')} disabled={v.busy}>Final…</button></div>
    </aside>
  );
}

// ---- the cover image that belongs to this exact video ---------------------------------------------------------------------------------
function CoverCard({v, sel, cover, apply}: {v: ReviewView; sel: VideoRow; cover: NonNullable<VideoRow['cover']>; apply: (r: ReviewReply, ok?: string) => boolean}) {
  const [busy, setBusy] = useState(false);
  const label = {none: 'No cover yet', running: 'Drawing the cover…', fresh: 'Matches this video', outdated: 'Out of date'}[cover.state];
  const tone = {none: '', running: 'acc', fresh: 'green', outdated: 'amber'}[cover.state];
  return (
    <aside className="rv-cover card" aria-label="Cover image" data-testid="cover-card" data-state={cover.state} data-render={sel.renderArtifactId}>
      <div className="hrow"><b>Cover image</b><span className={`chip sm ${tone}`} data-testid="cover-state">{label}</span><span className="muted small">for the {sel.kind} video beside it</span></div>
      <div className="rv-coverbody">
      {cover.url ? <img className={`rv-coverimg ${cover.state === 'outdated' ? 'old' : ''}`} src={`${cover.url}?v=${(cover.fileSha256 ?? '').slice(0, 12)}`} alt={`Cover for ${sel.label} video: ${cover.hook ?? ''}`} width={162} height={288} data-testid="cover-image" />
        : <div className="rv-coverimg empty" aria-hidden="true">{cover.state === 'running' ? <i className="spin" /> : 'No cover yet'}</div>}
      <div className="rv-coverinfo">
      <div className="small" data-testid="cover-hook">Hook: <b>{cover.hook ?? 'none'}</b></div>
      <div className="muted small" data-testid="cover-belongs">{cover.url ? <>Drawn from the opening of this exact video (SHA-256 <code title={cover.renderSha256}>{short(cover.renderSha256)}</code>) at {cover.frame !== null ? (cover.frame / 30).toFixed(2) : '?'} s, without captions · {cover.width} × {cover.height} PNG{cover.bytes ? ` · ${(cover.bytes / 1024).toFixed(0)} KB` : ''}.</> : <>It is drawn from the opening of this exact video, without captions, by the same engine that renders the video.</>}</div>
      {cover.state === 'outdated' && cover.why && <div className="inline warn" role="status" data-testid="cover-outdated">Out of date. {cover.why} Make the video again, then its cover.</div>}
      <div className="hrow">
        <button className="btn sm pri" disabled={busy || v.busy || cover.state === 'running' || cover.state === 'fresh'} onClick={() => { setBusy(true); void reviewCover(v.episodeId, sel.renderArtifactId).then((r) => { setBusy(false); apply(r, 'The cover is being drawn from this video.'); }); }} data-testid="make-cover">{cover.url ? 'Make the cover again' : 'Make the cover'}</button>
        {cover.downloadUrl && (cover.state === 'fresh'
          ? <a className="btn sm" href={cover.downloadUrl} download={cover.filename} data-testid="download-cover">Download cover</a>
          : <span className="btn sm off" aria-disabled="true" title="This cover does not match the video's current inputs, so it is not offered for download" data-testid="download-cover-off">Download cover</span>)}
      </div>
      <div className="muted small">It is not attached to a post for you: choose it as the cover when you upload. It is included in the export package.</div>
      </div>
      </div>
    </aside>
  );
}

// ---- the exact file, played, with what was played recorded ----------------------------------------------------------------------------
function Player({v, sel, apply, reload}: {v: ReviewView; sel: VideoRow; apply: (r: ReviewReply, ok?: string) => boolean; reload: () => Promise<void>}) {
  const video = useRef<HTMLVideoElement>(null);
  const [phone, setPhone] = useState(false);
  const [t, setT] = useState(0);
  const seg = useRef<{from: number; last: number} | null>(null);
  const roundId = sel.round?.id ?? null;
  const phoneRef = useRef(phone);
  phoneRef.current = phone;

  // the latest callbacks live in a ref, so that flush (and the listeners that use it) keep one identity while the page re-renders around them
  const latest = useRef({roundId, episodeId: v.episodeId, apply, reload});
  latest.current = {roundId, episodeId: v.episodeId, apply, reload};
  const flush = useCallback(() => {
    const s = seg.current;
    const el = video.current;
    seg.current = null;
    const {roundId: rid, episodeId, apply: ap, reload: re} = latest.current;
    if (!s || !el || rid === null) return;
    const to = Math.min(s.last, el.duration || s.last);
    if (to - s.from < 0.2) return;
    // reported in pieces of at most 15 s; the server refuses anything that could not have played in the time that passed
    for (let a = s.from; a < to - 1e-6; a += 14) void reviewPlayback(episodeId, rid, a, Math.min(to, a + 14), !el.muted && el.volume > 0, phoneRef.current).then((r) => { if (r.error) ap(r); else void re(); });
  }, []);
  useEffect(() => {
    const el = video.current;
    if (!el) return;
    const start = () => { if (el.playbackRate === 1) seg.current = {from: el.currentTime, last: el.currentTime}; };
    const tick = () => {
      setT(el.currentTime);
      const s = seg.current;
      if (!s) return;
      if (el.currentTime - s.last > 1 || el.currentTime < s.last - 0.05) { flush(); start(); return; } // a jump: the stretch before it is reported, a new one starts
      s.last = Math.max(s.last, el.currentTime);
      if (s.last - s.from >= 5) { const to = s.last; flush(); seg.current = {from: to, last: to}; }
    };
    const stop = () => flush();
    const rate = () => { if (el.playbackRate !== 1) { flush(); } else if (!el.paused) start(); };
    el.addEventListener('playing', start); el.addEventListener('timeupdate', tick); el.addEventListener('pause', stop); el.addEventListener('seeking', stop); el.addEventListener('ended', stop); el.addEventListener('ratechange', rate);
    return () => { flush(); el.removeEventListener('playing', start); el.removeEventListener('timeupdate', tick); el.removeEventListener('pause', stop); el.removeEventListener('seeking', stop); el.removeEventListener('ended', stop); el.removeEventListener('ratechange', rate); };
  }, [flush]);

  const cov = v.coverage;
  const width = phone ? 270 : 420;
  return (
    <section className="card rv-player" aria-label="Video" data-testid="review-player" data-kind={sel.kind}>
      <div className={`rv-banner ${sel.kind}`} data-testid="video-banner">
        <b>{sel.kind === 'final' ? 'FINAL · mastered' : 'DRAFT · not mastered · can never be approved'}</b>
        <span>this exact file: SHA-256 <code title={sel.fileSha256}>{short(sel.fileSha256)}</code> · {MB(sel.bytes)}{sel.durationSec !== null ? ` · ${mmss(sel.durationSec)}` : ''}</span>
      </div>
      <div className="hrow">
        <button className={`btn sm ${phone ? 'on' : ''}`} onClick={() => setPhone((x) => !x)} aria-pressed={phone} data-testid="phone-toggle">Phone size</button>
        <span className="muted small">{phone ? 'Shown about 270 px wide, as on a phone.' : 'Shown larger. Use Phone size to watch it as on a phone.'}</span>
        <span className="spacer" />
        {sel.round ? <span className="chip sm">Round {sel.round.number}</span> : null}
      </div>
      <div className="rv-videowrap" style={{width}}>
        <video ref={video} src={sel.url} controls playsInline preload="metadata" style={{width}} data-testid="review-video" />
      </div>
      {!sel.round ? (
        <div className="inline warn" data-testid="no-round">Nothing you play or tick is recorded until you start a review round on this video. <button className="btn sm" data-testid="open-round" onClick={() => void reviewRound(v.episodeId, sel.renderArtifactId).then((r) => apply(r, 'Round started on this exact file.'))}>Start a review round</button></div>
      ) : cov ? (
        <div className="rv-cov" data-testid="coverage" data-complete={cov.complete ? 'yes' : 'no'}>
          <div className="rv-bar" aria-hidden="true">{cov.durationSec > 0 && [...Array(60)].map((_, i) => { const a = (i / 60) * cov.durationSec, b = ((i + 1) / 60) * cov.durationSec; const gap = cov.unheard.some(([x, y]) => x < b && y > a && Math.min(y, b) - Math.max(x, a) > 0.35); return <i key={i} className={gap ? '' : 'on'} />; })}</div>
          <div className="small">Played with the sound on: <b data-testid="heard-sec">{cov.heardSec}</b> of {cov.durationSec} s{cov.complete ? ' · the whole file' : ` · ${cov.unheard.length} stretch${cov.unheard.length === 1 ? '' : 'es'} not yet played`} · at phone size with sound: {cov.phoneHeardSec} s · position {mmss(t)}</div>
          {!cov.complete && cov.unheard.length > 0 && <div className="muted small">Not yet played: {cov.unheard.slice(0, 4).map(([a, b]) => `${mmss(a)} to ${mmss(b)}`).join(', ')}{cov.unheard.length > 4 ? ', …' : ''}. Muted playback does not count.</div>}
        </div>
      ) : null}
      <NoteAt video={video} v={v} sel={sel} apply={apply} />
    </section>
  );
}

// ---- adding a note at the playhead ----------------------------------------------------------------------------------------------------
function NoteAt({video, v, sel, apply}: {video: React.RefObject<HTMLVideoElement | null>; v: ReviewView; sel: VideoRow; apply: (r: ReviewReply, ok?: string) => boolean}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [type, setType] = useState<Note['type']>('general');
  const [at, setAt] = useState(0);
  // the segment being spoken at the playhead, else the last one that began, else the first (the lead-in belongs to the opening line)
  const segAt = (t: number) => v.segmentTimes.find((s) => t >= s.start && t < s.end)?.id ?? [...v.segmentTimes].reverse().find((s) => t >= s.start)?.id ?? v.segmentTimes[0]?.id;
  const begin = () => { setAt(Math.round((video.current?.currentTime ?? 0) * 100) / 100); video.current?.pause(); setOpen(true); };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { const el = e.target as HTMLElement; if ((e.key === 'n' || e.key === 'N') && !e.metaKey && !e.ctrlKey && !/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) && sel.round) { e.preventDefault(); begin(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  if (!sel.round) return null;
  const save = async () => {
    if (!text.trim()) return;
    const r = await reviewNoteAdd(v.episodeId, {roundId: sel.round!.id, text, type, timeSec: at, segment: segAt(at), build: sel.buildId ?? undefined, seq: v.seq, render: sel.renderArtifactId});
    if (apply(r)) { setOpen(false); setText(''); }
  };
  return open ? (
    <div className="notecomposer" role="dialog" aria-label="Add note" data-testid="review-note-composer">
      <div className="nch"><b>Add note</b><span className="chip sm">{mmss(at)}{segAt(at) ? ` · segment ${segAt(at)}` : ''} · round {sel.round.number}, {sel.kind}</span></div>
      <textarea className="field" rows={3} value={text} autoFocus placeholder="What should change here?" aria-label="Note text" data-testid="review-note-text" onChange={(e) => setText(e.target.value)} />
      <div className="ncf">
        <label>Type <select value={type} onChange={(e) => setType(e.target.value as Note['type'])}>{NOTE_TYPES.map((t2) => <option key={t2} value={t2}>{t2}</option>)}</select></label>
        <span className="spacer" />
        <button className="btn sm" onClick={() => setOpen(false)}>Cancel</button>
        <button className="btn sm pri" disabled={!text.trim()} onClick={() => void save()} data-testid="review-note-save">Add note</button>
      </div>
    </div>
  ) : <div className="hrow"><button className="btn sm" onClick={begin} data-testid="review-note-add" title="Add a note at the playhead ( N )">+ Note at {mmss(video.current?.currentTime ?? 0)}</button><span className="muted small">The note keeps the round, this exact file, and the words and scene it is about.</span></div>;
}

// ---- notes: edit, resolve, reopen, and which ones need another look --------------------------------------------------------------------------
function Notes({v, sel, apply}: {v: ReviewView; sel: VideoRow; apply: (r: ReviewReply, ok?: string) => boolean}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const open = v.notes.filter((n) => n.note.status === 'open');
  const closed = v.notes.filter((n) => n.note.status !== 'open');
  const act = (noteId: string, body: Record<string, unknown>) => reviewNoteChange(v.episodeId, noteId, {...body, seq: v.seq, render: sel.renderArtifactId}).then((r) => apply(r));
  const row = (n: NoteView) => {
    const a = NOTE_STATE[n.assessment.state];
    const note = n.note;
    return (
      <li key={note.id} data-testid={`note-${note.id}`} data-status={note.status} data-state={n.assessment.state} data-this-video={n.onThisVideo ? 'yes' : 'no'}>
        <div className="hrow">
          <span className="chip sm">{note.type}</span>
          {note.timeSec !== undefined && <span className="muted small">{mmss(note.timeSec)}{note.anchor ? ` · ${note.anchor.segment}` : ''}</span>}
          <span className={`chip sm ${note.status === 'open' ? 'amber' : 'green'}`}>{note.status === 'wont-fix' ? "won't fix" : note.status}</span>
          {a.label && <span className={`chip sm ${a.cls}`} data-testid={`note-${note.id}-flag`}>{a.label}</span>}
          <span className="muted small">{n.against ?? 'written in the editor'}</span>
        </div>
        {editing === note.id ? (
          <div><textarea className="field" rows={2} value={draft} onChange={(e) => setDraft(e.target.value)} data-testid={`note-${note.id}-edit-text`} />
            <div className="hrow"><button className="btn sm pri" onClick={() => void act(note.id, {op: 'edit', text: draft}).then((ok) => { if (ok) setEditing(null); })} data-testid={`note-${note.id}-edit-save`}>Save</button><button className="btn sm" onClick={() => setEditing(null)}>Cancel</button></div></div>
        ) : <div>{note.text}</div>}
        {note.context && (
          <details className="more"><summary>What it was written about</summary>
            <div className="small">“{note.context.segmentText}”{note.context.speech ? <> spoken as “{note.context.speech}”</> : null}{note.context.sceneId ? <> · scene {note.context.sceneId}</> : null} <span className="muted">(kept exactly as it was when the note was written)</span></div>
          </details>
        )}
        {n.assessment.reasons.length > 0 && <div className={`small ${n.assessment.state === 'legacy' ? 'muted' : 'warnline'}`}>{n.assessment.reasons.join(' ')}</div>}
        <div className="hrow">
          {note.status === 'open' ? <>
            <button className="btn sm" onClick={() => void act(note.id, {op: 'resolve'})} data-testid={`note-${note.id}-resolve`}>Resolve</button>
            <button className="btn sm" onClick={() => void act(note.id, {op: 'wont-fix'})} data-testid={`note-${note.id}-wontfix`}>Won’t fix</button>
            <button className="btn sm" onClick={() => { setEditing(note.id); setDraft(note.text); }} data-testid={`note-${note.id}-edit`}>Edit</button>
          </> : <button className="btn sm" onClick={() => void act(note.id, {op: 'reopen'})} data-testid={`note-${note.id}-reopen`}>Reopen</button>}
          {n.assessment.state === 'reassess' && <button className="btn sm" onClick={() => void act(note.id, {op: 'reassess'})} data-testid={`note-${note.id}-reassess`} title="Confirms the note still applies to the changed content. The original context stays.">It still applies</button>}
          {(note.events?.length ?? 0) > 1 && <span className="muted small">{note.events!.length} events</span>}
        </div>
      </li>
    );
  };
  return (
    <section className="card" aria-label="Notes" data-testid="review-notes">
      <h3>Notes ({open.length} open)</h3>
      <p className="muted small">A note belongs to a round and to the exact video it was written against. When the words or the scene it is about change, it is flagged here; its original context stays, and nothing is rewritten.</p>
      {v.notes.length === 0 && <div className="muted small">No notes yet.</div>}
      {open.length > 0 && <ul className="notes">{open.map(row)}</ul>}
      {closed.length > 0 && <details className="more"><summary>{closed.length} resolved or dismissed</summary><ul className="notes">{closed.map(row)}</ul></details>}
    </section>
  );
}

// ---- the production checks ---------------------------------------------------------------------------------------------------------------------------
function Checks({v, sel, apply}: {v: ReviewView; sel: VideoRow; apply: (r: ReviewReply, ok?: string) => boolean}) {
  const r = v.report;
  const job = v.checksJob;
  const groups = r ? (Object.keys(SECTION) as CheckItem['section'][]).map((s) => ({s, items: r.items.filter((i) => i.section === s)})).filter((g) => g.items.length) : [];
  return (
    <section className="card" aria-label="Production checks" data-testid="review-checks">
      <h3>Production checks</h3>
      <p className="muted small">Each result says what kind it is: <b>Measured</b> (computed from the file or the data), <b>Heuristic warning</b> (a rule of thumb), <b>Only partly checked</b>, or <b>You judge</b> (only a person can). They run on this exact file.</p>
      <div className="hrow">
        <button className="btn sm pri" disabled={!!job || sel.checks.state === 'running'} onClick={() => void reviewChecks(v.episodeId, sel.renderArtifactId).then((x) => apply(x))} data-testid="run-checks">{r ? 'Run the checks again' : 'Run the checks'}</button>
        {job && <span className="small" data-testid="checks-step">{job.displayStep ?? job.state}{job.fraction !== null ? ` · ${Math.round(job.fraction * 100)}%` : ''}</span>}
        {r && !job && <span className={`chip sm ${r.passed ? 'green' : 'rose'}`} data-testid="checks-verdict">{r.passed ? 'No failures' : `${r.summary.fail} failing`}</span>}
      </div>
      {r && <div className="muted small" data-testid="checks-summary">{r.summary.pass} pass · {r.summary.warn} warning · {r.summary.fail} fail · {r.summary.unchecked} not examined by the app · {r.sampled.frames} frames measured in the browser</div>}
      {groups.map((g) => (
        <div key={g.s} className="rv-group">
          <h4>{SECTION[g.s]}</h4>
          <ul className="checks">{g.items.map((i) => (
            <li key={i.id} data-testid={`check-${i.id}`} data-status={i.status} data-kind={i.kind}>
              <div className="hrow"><span className={`chip sm ${STATUS[i.status].cls}`}>{STATUS[i.status].label}</span><span className="chip sm">{KIND[i.kind]}</span></div>
              <div className="small"><b>{i.title}</b></div>
              <div className="muted small">{i.detail}</div>
              {i.lines && <ul className="small">{i.lines.slice(0, 6).map((l) => <li key={l}>{l}</li>)}{i.lines.length > 6 ? <li>… {i.lines.length - 6} more</li> : null}</ul>}
            </li>
          ))}</ul>
        </div>
      ))}
      {v.captionDiffs.length > 0 && (
        <div className="rv-group" data-testid="caption-diffs">
          <h4>Caption and spoken words that differ</h4>
          <p className="muted small">Confirm each one only if the difference is intended. A confirmation belongs to exactly this wording: change either text and it must be confirmed again.</p>
          <ul className="checks">{v.captionDiffs.map((d) => (
            <li key={d.segment} data-testid={`diff-${d.segment}`} data-confirmed={d.confirmed ? 'yes' : 'no'}>
              <div className="small">Segment {d.segment}: only in the caption: <b>{d.captionOnly.join(' ') || '–'}</b>; only in the speech: <b>{d.spokenOnly.join(' ') || '–'}</b></div>
              <label className="inl"><input type="checkbox" checked={d.confirmed} onChange={(e) => void reviewConfirmDiff(v.episodeId, sel.renderArtifactId, d.segment, d.hash, e.target.checked).then((x) => apply(x, 'Saved. Run the checks again to include it.'))} data-testid={`diff-${d.segment}-confirm`} /> This difference is intended</label>
            </li>
          ))}</ul>
        </div>
      )}
      {r && <details className="more"><summary>What these checks cannot do</summary><ul className="small">{r.limits.map((l) => <li key={l}>{l}</li>)}</ul></details>}
    </section>
  );
}

// ---- confirmations, approval ------------------------------------------------------------------------------------------------------------------------------
function Approval({v, sel, apply}: {v: ReviewView; sel: VideoRow; apply: (r: ReviewReply, ok?: string) => boolean}) {
  const [confirming, setConfirming] = useState(false);
  const round = sel.round;
  const isFinalCurrent = sel.kind === 'final' && sel.isCurrent;
  const a = v.approval;
  return (
    <section className="card" aria-label="Confirmations and approval" data-testid="review-approval" data-approval={a.state}>
      <h3>Confirmations and approval</h3>
      {sel.kind === 'draft' && <div className="inline warn" data-testid="draft-not-approvable">This is a draft. It can be reviewed, but it can never be approved or exported. Make the final video and review that file.</div>}
      {sel.kind === 'final' && !round && <div className="muted small">Start a review round on this video to record confirmations.</div>}
      {round && (
        <>
          <p className="muted small">These are your own confirmations about <b>this file</b>. The app never ticks them. A tick records that you did it, not that you did it well.</p>
          <ul className="signoffs">{v.signoffs.map((s) => (
            <li key={s.item}><label className="inl"><input type="checkbox" checked={s.ticked} disabled={!!round.closedAt} onChange={(e) => void reviewSignoff(v.episodeId, round.id, s.item, e.target.checked, sel.renderArtifactId).then((r) => apply(r))} data-testid={`signoff-${s.item}`} /> {SIGNOFF[s.item]}</label>{s.at ? <span className="muted small"> ticked {when(s.at)}</span> : null}</li>
          ))}</ul>
        </>
      )}
      {isFinalCurrent && (
        <>
          {v.readiness.blockers.length > 0 ? (
            <div className="inline warn" data-testid="approve-blockers"><b>Still needed before approval:</b><ul>{v.readiness.blockers.map((b) => <li key={b}>{b}</li>)}</ul></div>
          ) : <div className="inline ok" data-testid="approve-ready">Everything approval needs has been recorded. Approving is your decision.</div>}
          {a.state !== 'valid' && !confirming && <button className="btn pri" disabled={v.readiness.blockers.length > 0 || !round} onClick={() => setConfirming(true)} data-testid="approve-open">Approve this final video…</button>}
          {confirming && (
            <div className="inline warn" data-testid="approve-confirm-box">
              Approving records this file’s SHA-256 (<code>{short(sel.fileSha256)}</code>) and the hash of every input that made it. Changing a caption, a font, the sound mix or anything else it depends on voids the approval. Notes do not.
              <div className="hrow"><button className="btn pri sm" onClick={() => void reviewApprove(v.episodeId, round!.id).then((r) => { if (apply(r, 'Approved. Export is now possible.')) setConfirming(false); })} data-testid="approve-confirm">Yes, approve this file</button><button className="btn sm" onClick={() => setConfirming(false)}>Not now</button></div>
            </div>
          )}
        </>
      )}
      {a.state !== 'none' && (
        <div className={`inline ${a.state === 'valid' ? 'ok' : 'bad'}`} data-testid="approval-state" role="status">
          {a.state === 'valid' ? <>Approved {a.approvedAt ? when(a.approvedAt) : ''} · file SHA-256 <code>{a.fileSha256 ? short(a.fileSha256) : ''}</code>{a.rested ? ` · round ${a.rested.roundNumber}` : ''}. Approval is computed: it is void as soon as an input it depended on differs.</> : <>Approval is void. What changed: {a.changed.join(', ')}. A new final video needs a new review and approval.</>}
          {a.rested && <div className="muted small">It rested on: checks suite {a.rested.checkVersion}; playback {a.rested.coverageComplete ? 'covered the whole file' : 'did not cover the whole file'}; the four confirmations ticked at {Object.values(a.rested.signoffTimes).filter(Boolean).length} recorded times.</div>}
        </div>
      )}
    </section>
  );
}

// ---- export ----------------------------------------------------------------------------------------------------------------------------------------------
function Export({v, apply}: {v: ReviewView; apply: (r: ReviewReply, ok?: string) => boolean}) {
  const [last, setLast] = useState<ReviewReply['result'] | null>(null);
  const x = v.exports;
  return (
    <section className="card" aria-label="Export" data-testid="review-export">
      <h3>Export</h3>
      <p className="muted small">Export copies the approved file exactly. It does not render, encode or master anything, and checks the file’s SHA-256 before and after. The package holds the video, captions (SRT and WebVTT), metadata, credits and checksums. It leaves out prompts, notes, logs and paths of this computer.</p>
      <button className="btn sm pri" disabled={!x.canExport} onClick={() => void reviewExport(v.episodeId).then((r) => { if (apply(r, 'Exported. The file was copied byte for byte and verified.')) setLast(r.result ?? null); })} data-testid="export-run">Export the approved video</button>
      {!x.canExport && x.why && <div className="muted small" data-testid="export-why">{x.why}</div>}
      {last && (
        <div className="inline ok" data-testid="export-result">
          {last.alreadyExported ? 'This package already existed and was verified.' : 'Exported.'} SHA-256 before: <code>{short(last.verified.before)}</code>, copy: <code>{short(last.verified.copy)}</code>, after: <code>{short(last.verified.after)}</code>. Folder (for you only): <code>{last.dir}</code>
        </div>
      )}
      {x.packages.length > 0 && <details className="more"><summary>{x.packages.length} package{x.packages.length === 1 ? '' : 's'} made</summary><ul className="small">{x.packages.map((p) => <li key={p.id}>{whenShort(p.exportedAt)} · {p.files.length} files · video <code>{short(p.fileSha256)}</code></li>)}</ul></details>}
    </section>
  );
}
