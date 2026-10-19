// The Voice stage: the narration blocks of an episode, their takes (audition, select, re-roll), generating on the job runner, splitting and
// merging blocks, the voice-only listening sample, and the audio engine as it really is. Everything shown comes from one reading of the server
// (the saved episode, the dependency hashes, the job table and the model host), so the page cannot say two different things. It asks for nothing
// the saved episode does not already have: text is edited in the script editor, and generating only ever uses saved text.
import {useCallback, useEffect, useRef, useState, type SyntheticEvent} from 'react';
import type {JobView} from '../jobs.ts';
import {fmtSec} from '../shared/costs.ts';
import {rangeLabel, type BlockPreview, type BlockRow, type TakeRow, type VoiceView} from '../shared/voice.ts';
import {cancelJob, getVoice, retryJob, voiceBlocks, voiceCancel, voiceGenerate, voiceSample, voiceSelect, type BlockOpBody, type VoiceFailure} from './api';
import {Notice, Rail, Stepper, type StageNote} from './Chrome';
import {whenShort} from './labels';

type Msg = {tone: 'warn' | 'bad' | 'info'; text: string};
const clock = (ms: number): string => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}`;
const newRequestId = () => `req-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const STATUS: Record<BlockRow['status'], {label: string; cls: string}> = {fresh: {label: 'Up to date', cls: 'green'}, stale: {label: 'Out of date', cls: 'amber'}, none: {label: 'No take yet', cls: ''}, missing: {label: 'File missing', cls: 'rose'}};
const ENGINE_LABEL: Record<VoiceView['engine']['activity'], string> = {stopped: 'Not running', idle: 'Idle', loading: 'Loading', generating: 'Generating', aligning: 'Aligning', releasing: 'Releasing', stopping: 'Stopping', 'working-elsewhere': 'Busy with other work'};
const JOB_STATE: Record<string, {label: string; cls: string}> = {
  queued: {label: 'Waiting', cls: ''}, preparing: {label: 'Starting', cls: 'acc'}, running: {label: 'Running', cls: 'acc'}, cancelling: {label: 'Stopping', cls: 'amber'},
  succeeded: {label: 'Done', cls: 'green'}, outdated: {label: 'Done for earlier wording', cls: 'amber'}, failed: {label: 'Failed', cls: 'rose'}, cancelled: {label: 'Cancelled', cls: ''},
};
const MB = (b: number | null) => (b === null ? null : `${Math.round(b / 2 ** 20)} MB`);

function estimateText(e: BlockRow['estimate']): string {
  if (!e.measured) return 'Not measured';
  const lo = Math.round(e.minSec), hi = Math.round(e.maxSec);
  return lo === hi ? `about ${fmtSec(lo)}` : `about ${fmtSec(lo)} to ${fmtSec(hi)}`;
}

function useNow(active: boolean): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { if (!active) return; const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, [active]);
  return now;
}

function JobLine({job, now, fetchedAt, onCancel, onRetry, testid}: {job: JobView; now: number; fetchedAt: number; onCancel: (id: number) => void; onRetry: (id: number) => void; testid: string}) {
  const st = JOB_STATE[job.state] ?? {label: job.state, cls: ''};
  const live = job.state === 'running' || job.state === 'preparing';
  const elapsed = job.elapsedMs === null ? null : job.elapsedMs + (live ? Math.max(0, now - fetchedAt) : 0);
  const d = job.detail as {audioSeconds?: number} | null;
  if (job.state === 'succeeded') return <div className="muted small" data-testid={testid} data-state={job.state}>{job.cacheHit ? 'Latest job: reused a saved take; nothing was generated.' : `Latest job: generated in ${elapsed === null ? '?' : clock(elapsed)}${job.seed !== null ? ` (seed ${job.seed})` : ''}.`}</div>;
  return (
    <div className="vjob" data-testid={testid} data-state={job.state}>
      <div className="hrow">
        <span className={`chip sm ${st.cls}`}>{live && <i className="spin" />}{st.label}</span>
        <span className="small" data-testid={`${testid}-step`}>{job.displayStep ?? 'working'}</span>
        {elapsed !== null && (live || job.state === 'cancelling') && <span className="muted small" data-testid={`${testid}-elapsed`}>{clock(elapsed)} so far{job.fraction === null ? ' · total time unknown' : ''}</span>}
        {d?.audioSeconds ? <span className="muted small">{d.audioSeconds.toFixed(1)} s of speech so far</span> : null}
        <span className="spacer" />
        {job.canCancel && <button className="btn sm" onClick={() => onCancel(job.id)} data-testid={`${testid}-cancel`}>Cancel</button>}
        {job.canRetry && <button className="btn sm" onClick={() => onRetry(job.id)} data-testid={`${testid}-retry`}>Retry</button>}
      </div>
      {job.friendlyError && <div className="jerr" role="alert">{job.friendlyError}</div>}
      {job.note && <div className="muted small">{job.note}</div>}
      <div className="muted small">Uses the text saved in revision r{job.revision ?? '?'}{job.seed !== null ? ` · seed ${job.seed}` : ''}.</div>
    </div>
  );
}

function pauseAudio(e: SyntheticEvent<HTMLAudioElement>) { document.querySelectorAll('audio').forEach((a) => { if (a !== e.currentTarget) a.pause(); }); }

function TakeItem({block, t, busy, onUse}: {block: BlockRow; t: TakeRow; busy: boolean; onUse: () => void}) {
  return (
    <li className="take" data-testid={`take-${block.id}-${t.number}`} data-selected={t.selected ? 'yes' : 'no'} data-compatible={t.compatible ? 'yes' : 'no'}>
      <div className="hrow">
        <b>Take {t.number}</b>
        <span className="muted small">{t.imported ? 'imported with the episode' : `seed ${t.seed ?? '?'}`}{t.durationSec !== null ? ` · ${t.durationSec.toFixed(1)} s` : ''}{t.genSec !== null ? ` · took ${t.genSec.toFixed(1)} s` : ''} · {whenShort(t.createdAt)}</span>
        {t.selected && <span className="chip sm green" data-testid={`take-${block.id}-${t.number}-selected`}>Selected</span>}
        {!t.compatible && <span className="chip sm amber" title={t.why ?? ''}>Earlier wording</span>}
        <span className="spacer" />
        {t.compatible && !t.selected && <button className="btn sm" disabled={busy} onClick={onUse} data-testid={`take-${block.id}-${t.number}-use`}>Use this take</button>}
      </div>
      <audio controls preload="none" src={t.url} onPlay={pauseAudio} aria-label={`Take ${t.number} of block ${block.id}`} data-testid={`take-${block.id}-${t.number}-audio`} />
      {!t.compatible && <div className="muted small" data-testid={`take-${block.id}-${t.number}-why`}>{t.why} It stays saved and cannot be selected for the current lines.</div>}
    </li>
  );
}

export function Voice({id, workspace, onList, onEditor, onPlan, onReview, planned}: {id: string; workspace: string; onList: () => void; onEditor: () => void; onPlan: (tab: 'brief' | 'research' | 'storyboard' | 'scenes') => void; onReview?: () => void; planned: boolean}) {
  const [view, setView] = useState<VoiceView | null>(null);
  const [fetchedAt, setFetchedAt] = useState(Date.now());
  const [fatal, setFatal] = useState<string | null>(null);
  const [note, setNote] = useState<Msg | null>(null);
  const [edit, setEdit] = useState<{op: BlockOpBody; preview: BlockPreview} | null>(null);
  const [working, setWorking] = useState(false);
  const loadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await getVoice(id);
      if (r.status === 200) { setView(r.json); setFetchedAt(Date.now()); } else setFatal(r.json.message ?? 'The Voice screen could not be opened.');
    } catch { /* the server is unreachable: what is shown stays, and the next event refreshes it */ }
  }, [id]);
  const soon = useCallback(() => { if (loadTimer.current) clearTimeout(loadTimer.current); loadTimer.current = setTimeout(() => void load(), 120); }, [load]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const es = new EventSource('/api/events');
    let first = true;
    es.addEventListener('hello', () => { if (!first) soon(); first = false; });
    for (const ev of ['jobs', 'voice', 'committed']) es.addEventListener(ev, () => soon());
    return () => es.close();
  }, [soon]);
  const busy = !!view?.busy;
  useEffect(() => { if (!busy) return; const t = setInterval(() => void load(), 1500); return () => clearInterval(t); }, [busy, load]);
  const now = useNow(busy);

  if (fatal) return <div className="boot" role="alert"><h2>Explainer Studio</h2><p>{fatal}</p><button className="btn" onClick={onList}>All episodes</button></div>;
  if (!view) return <div className="boot" role="status">Opening the voice stage…</div>;

  const fail = (r: {status: number; json: VoiceFailure}, fallback: string) => {
    const base = r.json.message ?? fallback;
    setNote({tone: r.status === 409 ? 'warn' : 'bad', text: r.json.blockers?.length ? `${base} ${r.json.blockers.join(' ')}` : base});
    if (r.status === 409) soon();
  };
  const generate = async (blocks?: string[], reroll = false) => {
    setWorking(true); setNote(null);
    const r = await voiceGenerate(id, view.seq, newRequestId(), {blocks, reroll});
    setWorking(false);
    if (r.status !== 202) { fail(r, 'Narration could not be started.'); return; }
    const parts = [r.json.queued.length && `${r.json.queued.length} block${r.json.queued.length === 1 ? '' : 's'} queued`, r.json.reused.length && `${r.json.reused.map((x) => `${x.block} reused saved take ${x.takeNumber}`).join(', ')}`].filter(Boolean);
    setNote({tone: 'info', text: `${parts.join('; ')}. Nothing else was started.`});
    if (r.json.view) { setView(r.json.view); setFetchedAt(Date.now()); }
  };
  const use = async (block: string, t: TakeRow) => {
    setWorking(true); setNote(null);
    const r = await voiceSelect(id, block, t.artifactId, view.seq);
    setWorking(false);
    if (r.status !== 200) { fail(r, 'The take could not be selected.'); return; }
    if (r.json.view) { setView(r.json.view); setFetchedAt(Date.now()); }
    const behind = r.json.outOfDate ?? [];
    setNote({tone: 'info', text: r.json.changed ? `Take ${t.number} of ${block} is selected. Nothing was regenerated.${behind.length ? ` Out of date now because the audio changed: ${behind.join(', ').replace('timing', 'timing').replace(/mix:/g, 'mix ').replace(/render:/g, 'video ')}. Rebuild refreshes them.` : ''}` : 'That take was already selected.'});
  };
  const preview = async (op: BlockOpBody) => {
    setWorking(true); setNote(null);
    const r = await voiceBlocks(id, view.seq, op, true);
    setWorking(false);
    if (r.status !== 200 || !r.json.preview) { fail(r, 'That change cannot be made.'); return; }
    setEdit({op, preview: r.json.preview});
  };
  const applyEdit = async () => {
    if (!edit) return;
    setWorking(true);
    const r = await voiceBlocks(id, view.seq, edit.op, false);
    setWorking(false);
    if (r.status !== 200) { setEdit(null); fail(r, 'The blocks were not changed.'); return; }
    setEdit(null);
    if (r.json.view) { setView(r.json.view); setFetchedAt(Date.now()); }
    setNote({tone: 'info', text: `${r.json.label}. It is saved as a revision, so it can be undone from History. Earlier takes are kept.`});
  };
  const makeSample = async () => {
    setWorking(true); setNote(null);
    const r = await voiceSample(id, view.seq, newRequestId());
    setWorking(false);
    if (r.status !== 202) { fail(r, 'The sample could not be started.'); return; }
    if (r.json.view) { setView(r.json.view); setFetchedAt(Date.now()); }
  };
  const cancelAll = async () => { const r = await voiceCancel(id); if (r.json.view) { setView(r.json.view); setFetchedAt(Date.now()); } setNote({tone: 'info', text: 'Cancelled. Anything already finished is kept.'}); };

  const needed = view.blocks.filter((b) => b.status !== 'fresh');
  const eng = view.engine;
  const all = view.blocks.every((b) => b.status === 'fresh');
  const notes: Record<number, StageNote> = {5: all ? {label: 'up to date', tone: 'ok'} : view.blocks.every((b) => b.status === 'none') ? {label: 'not made', tone: 'none'} : {label: `${needed.length} to do`, tone: 'warn'}};
  const total = view.totalEstimate;
  const go: Partial<Record<number, () => void>> = {3: onEditor, ...(onReview ? {7: onReview} : {}), ...(planned ? {1: () => onPlan('brief'), 2: () => onPlan('research'), 4: () => onPlan('storyboard'), 6: () => onPlan('scenes')} : {})};

  return (
    <div className="app">
      <Rail onEpisodes={onList} />
      <div className="main plain" data-screen="voice">
        <header className="top">
          <div className="titles"><span className="crumb">{workspace} · voice</span><h1 className="ttl" title={view.title} data-testid="voice-title">{view.title}</h1></div>
          <span className="spacer" />
          <span className={`chip ${eng.activity === 'idle' || eng.activity === 'stopped' ? '' : 'acc'}`} data-testid="engine-chip" data-activity={eng.activity}>Engine: {ENGINE_LABEL[eng.activity]}</span>
          <button className="btn sm" onClick={onEditor} data-testid="open-editor">Script editor</button>
          <button className="btn sm" onClick={onList}>All episodes</button>
        </header>
        <Stepper notes={notes} current={5} go={go} />
        <div className="notices">
          {note && <Notice tone={note.tone} actions={<button className="btn sm" onClick={() => setNote(null)}>OK</button>}><span data-testid="voice-note">{note.text}</span></Notice>}
          {view.blockers.length > 0 && <Notice tone="bad"><span data-testid="voice-blockers"><b>Narration cannot be generated yet.</b> {view.blockers.join(' ')}</span></Notice>}
        </div>
        <main className="page" aria-label="Voice" data-seq={view.seq} data-busy={busy ? 'yes' : 'no'} data-testid="voice-screen">
          <div className="research voicepage">
            <section className="card" data-testid="voice-summary">
              <div className="chead"><h3>Pip's voice</h3><span className="muted small">{view.voice.engine === 'qwen3-tts' ? `Approved reference ${view.voice.profile}${view.voice.referenceShort ? ` (${view.voice.referenceShort})` : ''}` : view.voice.profile}{view.voice.model ? ` · ${view.voice.model}` : ''}</span></div>
              <p className="small muted">Narration uses the approved Pip voice and reference exactly as recorded; this screen never changes either. A take is only ever added: nothing is overwritten, and every take stays saved.</p>
              <div className="hrow">
                <button className="btn sm pri" disabled={busy || working || !needed.length || view.blockers.length > 0} onClick={() => void generate()} data-testid="generate-all">
                  {needed.length ? `Generate ${needed.length} block${needed.length === 1 ? '' : 's'} that need${needed.length === 1 ? 's' : ''} narration` : 'Every block has narration'}
                </button>
                {busy && <button className="btn sm" onClick={() => void cancelAll()} data-testid="cancel-all">Cancel</button>}
                {total && (
                  <span className="small" data-testid="estimate-total">
                    {total.unmeasured === total.needed ? 'Time: not measured yet.' : `Estimate: ${total.minSec === total.maxSec ? `about ${fmtSec(total.minSec)}` : `about ${fmtSec(total.minSec)} to ${fmtSec(total.maxSec)}`} of generation${total.unmeasured ? `, not counting ${total.unmeasured} block${total.unmeasured === 1 ? '' : 's'} with no basis` : ''}.`}
                    {view.loadEstimate ? ` ${view.loadEstimate.sec !== null ? `Plus about ${fmtSec(Math.round(view.loadEstimate.sec))} to load the voice model.` : 'Plus loading the voice model, which is not measured yet.'}` : ''}
                  </span>
                )}
              </div>
              {total && <div className="muted small" data-testid="estimate-basis">Estimates come from takes this workspace has already made (generation seconds per spoken word) and are shown as a range; they are not promises. {view.blocks.find((b) => b.estimate.measured && b.estimate.note)?.estimate && (view.blocks.find((b) => b.estimate.measured && b.estimate.note)!.estimate as {note?: string}).note}</div>}
              <div className="muted small">{view.downstream.sentence}</div>
            </section>

            <section className="card" aria-label="Audio engine" data-testid="engine-state" data-activity={eng.activity} data-loaded={eng.loaded ?? 'none'} data-worker={eng.worker}>
              <div className="chead"><h3>Audio engine</h3><span className={`chip sm ${eng.activity === 'idle' || eng.activity === 'stopped' ? '' : 'acc'}`}>{ENGINE_LABEL[eng.activity]}</span></div>
              <p className="small" data-testid="engine-summary">{eng.summary}</p>
              <dl className="facts small">
                <dt>Worker</dt><dd>{eng.worker === 'running' ? `running (process ${eng.pid})${eng.rssBytes !== null ? `, resident memory (RSS) ${MB(eng.rssBytes)}; RSS is not the total memory the model uses` : ''}` : 'not running'}</dd>
                <dt>Model in memory</dt><dd>{eng.loaded ? (eng.loaded === 'tts' ? 'the voice model' : eng.loaded) : 'none'}</dd>
                {eng.job && <><dt>Working on</dt><dd>job #{eng.job.id}, {eng.job.kind}{eng.job.subject ? ` ${eng.job.subject}` : ''} ({eng.job.state})</dd></>}
                {eng.idleStopInMs !== null && <><dt>Idle</dt><dd>the worker is stopped and its memory released in about {Math.ceil(eng.idleStopInMs / 1000)} s</dd></>}
                {eng.lastHandover && <><dt>Last release</dt><dd>{eng.lastHandover.outcome} ({eng.lastHandover.reason}){eng.lastHandover.rssBeforeBytes !== null && eng.lastHandover.rssAfterBytes !== null ? `, RSS ${MB(eng.lastHandover.rssBeforeBytes)} to ${MB(eng.lastHandover.rssAfterBytes)}` : ''}</dd></>}
              </dl>
              <div className="muted small">Heavy work runs one job at a time. Before a video render the audio model is released and the release is confirmed.</div>
            </section>

            {edit && (
              <section className="card editpanel" aria-label="Change the blocks" data-testid="edit-preview">
                <div className="chead"><h3>{edit.op.op === 'split' ? `Split block ${edit.op.block} after ${edit.op.after}` : `Join block ${edit.op.block} with the next block`}</h3></div>
                <ul className="snotes" data-testid="edit-lines">{edit.preview.lines.map((l, i) => <li key={i}>{l}</li>)}</ul>
                {edit.preview.warnings.map((w, i) => <div key={i} className="warnline">{w}</div>)}
                <div className="hrow"><button className="btn sm pri" onClick={() => void applyEdit()} disabled={working} data-testid="edit-apply">Make this change</button><button className="btn sm" onClick={() => setEdit(null)} data-testid="edit-cancel">Cancel</button><span className="muted small">Saved as a revision of the episode; nothing is deleted.</span></div>
              </section>
            )}

            <section aria-label="Narration blocks" data-testid="blocks">
              <h3>Narration blocks <span className="muted small">{view.blocks.length}</span></h3>
              {view.blocks.map((b, bi) => {
                const st = STATUS[b.status];
                const next = view.blocks[bi + 1];
                return (
                  <article key={b.id} className="card" data-testid={`block-${b.id}`} data-status={b.status}>
                    <div className="chead">
                      <b>Block {b.id}</b>
                      <span className="muted small">{rangeLabel(b.segments.map((s) => s.id))} · {b.words} words{b.durationSec !== null ? ` · ${b.durationSec.toFixed(1)} s` : ''}</span>
                      <span className={`chip sm ${st.cls}`} data-testid={`block-${b.id}-status`}>{st.label}</span>
                      <span className="spacer" />
                      {b.status !== 'fresh' && <span className="muted small" data-testid={`block-${b.id}-estimate`}>{estimateText(b.estimate)}</span>}
                    </div>
                    <ol className="rows ro vsegs">
                      {b.segments.map((s, si) => (
                        <li key={s.id} data-testid={`seg-${s.id}`}><code>{s.id}</code><span>{s.text}{s.pauseAfter ? <span className="muted small"> · pause {s.pauseAfter} s</span> : null}</span>
                          {si < b.segments.length - 1 ? <button className="linkish small" disabled={busy || working} onClick={() => void preview({op: 'split', block: b.id, after: s.id})} data-testid={`split-${b.id}-${s.id}`}>Split here</button> : <span />}
                        </li>
                      ))}
                    </ol>
                    {b.reasons.length > 0 && b.status !== 'fresh' && b.status !== 'none' && <div className="small muted">{b.reasons.join(' · ')}</div>}
                    {b.job && <JobLine job={b.job} now={now} fetchedAt={fetchedAt} onCancel={(jid) => void cancelJob(jid).then(soon)} onRetry={(jid) => void retryJob(jid).then((r) => { if (r.status !== 200) setNote({tone: 'warn', text: r.json.message ?? 'It could not be retried.'}); soon(); })} testid={`block-${b.id}-job`} />}
                    {b.takes.length > 0 && <ul className="takes" aria-label={`Takes of block ${b.id}`}>{b.takes.map((t) => <TakeItem key={t.artifactId} block={b} t={t} busy={busy || working} onUse={() => void use(b.id, t)} />)}</ul>}
                    <div className="hrow">
                      {b.status !== 'fresh' && b.reusableTakeId !== null
                        ? <button className="btn sm pri" disabled={busy || working || view.blockers.length > 0} onClick={() => void generate([b.id])} data-testid={`block-${b.id}-generate`}>Use the saved take for these lines</button>
                        : b.status !== 'fresh' && <button className="btn sm pri" disabled={busy || working || view.blockers.length > 0} onClick={() => void generate([b.id])} data-testid={`block-${b.id}-generate`}>Generate</button>}
                      {b.takes.some((t) => t.compatible) && <button className="btn sm" disabled={busy || working || view.blockers.length > 0} onClick={() => void generate([b.id], true)} data-testid={`block-${b.id}-reroll`} title="Makes a new take with a new seed. The take you have stays selected until you choose the new one.">Re-roll</button>}
                      {b.status === 'fresh' && b.takes.some((t) => t.compatible) && <span className="muted small" data-testid={`block-${b.id}-reroll-estimate`}>{estimateText(b.estimate)}{b.estimate.measured && view.loadEstimate ? (view.loadEstimate.sec !== null ? `, plus about ${fmtSec(Math.round(view.loadEstimate.sec))} to load the voice model` : ', plus loading the voice model (not measured)') : ''}</span>}
                      <span className="spacer" />
                      {next && <button className="linkish" disabled={busy || working} onClick={() => void preview({op: 'merge', block: b.id})} data-testid={`merge-${b.id}`}>Join with {next.id}</button>}
                    </div>
                  </article>
                );
              })}
            </section>

            <section className="card" aria-label="Listening sample" data-testid="sample-panel" data-fresh={view.sample.fresh ? 'yes' : 'no'}>
              <div className="chead"><h3>Listening sample</h3>{view.sample.url && <span className={`chip sm ${view.sample.fresh ? 'green' : 'amber'}`}>{view.sample.fresh ? 'Matches the selected takes' : 'Out of date'}</span>}</div>
              <p className="small muted">The selected takes joined as they would be heard, with the episode's lead-in and gaps. It has no sound accents and no loudness mastering, so it is for judging whether the voice is consistent and the seams between blocks sound right. It is not a build.</p>
              {view.sample.job && !['succeeded'].includes(view.sample.job.state) && view.sample.job.state !== 'cancelled' && <JobLine job={view.sample.job} now={now} fetchedAt={fetchedAt} onCancel={(jid) => void cancelJob(jid).then(soon)} onRetry={(jid) => void retryJob(jid).then(soon)} testid="sample-job" />}
              <div className="hrow">
                <button className="btn sm" disabled={busy || working || !view.sample.available || view.sample.fresh} onClick={() => void makeSample()} data-testid="sample-make">{view.sample.url ? 'Make the sample again' : 'Make a listening sample'}</button>
                {!view.sample.available && <span className="muted small" data-testid="sample-reason">{view.sample.reason}</span>}
                {view.sample.fresh && <span className="muted small">Already matches the selected takes.</span>}
              </div>
              {view.sample.url && <audio controls preload="none" src={view.sample.url} onPlay={pauseAudio} aria-label="Listening sample" data-testid="sample-audio" />}
              {view.sample.url && <div className="muted small">{view.sample.durationSec !== null ? `${view.sample.durationSec.toFixed(1)} s · ` : ''}{view.sample.builtAt ? `made ${whenShort(view.sample.builtAt)}` : ''}</div>}
            </section>
          </div>
        </main>
      </div>
    </div>
  );
}
