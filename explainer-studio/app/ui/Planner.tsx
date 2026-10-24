// The planning workspace of one episode: Idea (brief), Research, Script and Storyboard. It edits the plan, which lives next
// to the episode in the project database, never inside it. Nothing here starts any work.
import {useCallback, useEffect, useMemo, useState} from 'react';
import {briefFor} from '../shared/handoff.ts';
import {validatePlan, type PlanDoc} from '../shared/plan.ts';
import {SHAPE_LABEL} from '../shared/packet.ts';
import {TAB_ID, getPlanPayload, getPlanRevisions, restorePlanRevision, savePlanDoc, type PlanPayload, type PlanRevisionRow} from './api';
import {Notice, Rail, Stepper, type StageNote} from './Chrome';
import {Handoff, ImportDialog, ProvenanceChip} from './Import';
import {OpeningHook} from './OpeningHook';
import {Creative} from './Creative';
import {when, whenShort} from './labels';
import {Research} from './Research';
import {Scenes} from './Scenes';
import {Storyboard} from './Storyboard';

export type PlanTab = 'brief' | 'research' | 'script' | 'storyboard' | 'scenes';
export const TAB_STAGE: Record<PlanTab, number> = {brief: 1, research: 2, script: 3, storyboard: 4, scenes: 6};
export const isPlanTab = (t: string | null): t is PlanTab => t === 'brief' || t === 'research' || t === 'script' || t === 'storyboard' || t === 'scenes';

type Msg = {tone: 'warn' | 'bad' | 'info'; text: string};

function BriefForm({plan, onSave, episodeExists}: {plan: PlanDoc; onSave: (p: PlanDoc) => Promise<string | null>; episodeExists: boolean}) {
  const [d, setD] = useState({title: plan.title, audience: plan.audience, objective: plan.objective, durationMin: plan.durationMin === null ? '' : String(plan.durationMin), notes: plan.notes});
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { setD({title: plan.title, audience: plan.audience, objective: plan.objective, durationMin: plan.durationMin === null ? '' : String(plan.durationMin), notes: plan.notes}); }, [plan]);
  const dirty = d.title !== plan.title || d.audience !== plan.audience || d.objective !== plan.objective || d.notes !== plan.notes || d.durationMin !== (plan.durationMin === null ? '' : String(plan.durationMin));
  const save = async () => {
    const n = d.durationMin.trim() === '' ? null : Number(d.durationMin);
    if (n !== null && !Number.isFinite(n)) { setErr('durationMin: must be a number of minutes'); return; }
    setErr(await onSave({...plan, title: d.title.trim(), audience: d.audience.trim(), objective: d.objective.trim(), durationMin: n, notes: d.notes}));
  };
  return (
    <form className="cardform brief" onSubmit={(e) => { e.preventDefault(); void save(); }} data-testid="brief-form">
      <label>Title<input className="field" value={d.title} onChange={(e) => setD({...d, title: e.target.value})} data-testid="brief-title" /></label>
      <label>Who is it for?<input className="field" value={d.audience} onChange={(e) => setD({...d, audience: e.target.value})} data-testid="brief-audience" /></label>
      <label>What should the viewer understand by the end?<textarea className="field" rows={2} value={d.objective} onChange={(e) => setD({...d, objective: e.target.value})} data-testid="brief-objective" /></label>
      <label>Approximate length, in minutes<input className="field num" inputMode="decimal" value={d.durationMin} onChange={(e) => setD({...d, durationMin: e.target.value})} data-testid="brief-duration" /></label>
      <label>Notes for yourself, and for the briefs you copy into ChatGPT<textarea className="field" rows={3} value={d.notes} onChange={(e) => setD({...d, notes: e.target.value})} data-testid="brief-notes" /></label>
      {episodeExists && <p className="muted small">The title and objective were copied into the episode when its script was accepted. Changing them here does not change the episode.</p>}
      {err && <div className="errs" role="alert" data-testid="form-error">{err}</div>}
      <div className="hrow"><button type="submit" className="btn sm pri" disabled={!dirty} data-testid="brief-save">Save brief</button>{!dirty && <span className="muted small">Saved</span>}</div>
    </form>
  );
}

export function Planner({id, tab, workspace, onTab, onList, onEditor, onVoice, onReview}: {id: string; tab: PlanTab; workspace: string; onTab: (t: PlanTab) => void; onList: () => void; onEditor: () => void; onVoice: () => void; onReview?: () => void}) {
  const [data, setData] = useState<PlanPayload | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);
  const [notice, setNotice] = useState<Msg | null>(null);
  const [dlg, setDlg] = useState<{importId: number | null} | null>(null);
  const [revs, setRevs] = useState<PlanRevisionRow[] | null>(null);
  const [revsOpen, setRevsOpen] = useState(false);

  const load = useCallback(async () => {
    const r = await getPlanPayload(id);
    if (r.status === 200) setData(r.json); else setFatal(r.json.message ?? 'This plan could not be opened.');
  }, [id]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const es = new EventSource('/api/events');
    let first = true;
    es.addEventListener('hello', () => { if (!first) void load(); first = false; });
    es.addEventListener('plan', (ev) => { const d = JSON.parse((ev as MessageEvent).data) as {planId: string; tab: string}; if (d.planId === id && d.tab !== TAB_ID) void load(); });
    es.addEventListener('committed', (ev) => { const d = JSON.parse((ev as MessageEvent).data) as {episodeId: string; tab: string}; if (d.episodeId === id && d.tab !== TAB_ID) void load(); });
    return () => es.close();
  }, [id, load]);
  useEffect(() => { if (revsOpen) void getPlanRevisions(id).then(setRevs); }, [revsOpen, id, data?.seq]);

  const commit = useCallback(async (next: PlanDoc, label: string): Promise<string | null> => {
    if (!data) return 'The plan has not loaded yet.';
    const v = validatePlan(next);
    if (!v.ok) return v.issues.map((i) => `${i.path}: ${i.message}`).join('; ');
    const r = await savePlanDoc(id, next, data.seq, label);
    if (r.status === 200) { setData(r.json); setNotice(null); return null; }
    if (r.status === 409) { if (r.json.current) setData(r.json.current); setNotice({tone: 'bad', text: 'This plan was changed somewhere else, so nothing was saved. The current version is shown; make your change again.'}); return 'Not saved: the plan changed elsewhere.'; }
    return r.json.message ?? 'It could not be saved.';
  }, [data, id]);

  const brief = useMemo(() => (data ? {research: briefFor('research', data.plan), script: briefFor('script', data.plan), storyboard: briefFor('storyboard', data.plan, data.episode?.segments ?? [])} : null), [data]);

  if (fatal) return <div className="boot" role="alert"><h2>Explainer Studio</h2><p>{fatal}</p><button className="btn" onClick={onList}>All episodes</button></div>;
  if (!data || !brief) return <div className="boot" role="status">Opening the plan…</div>;
  const {plan, episode, imports, check} = data;
  const pending = imports.filter((i) => i.state === 'proposed');
  const notes: Record<number, StageNote> = {
    1: plan.objective.trim() && plan.audience.trim() ? {label: 'brief set', tone: 'ok'} : {label: 'brief incomplete', tone: 'warn'},
    2: plan.sources.length + plan.claims.length ? {label: `${plan.sources.length} sources · ${plan.claims.length} claims`, tone: 'ok'} : {label: 'nothing yet', tone: 'none'},
    3: episode ? {label: `${episode.segments.length} segments`, tone: 'ok'} : {label: 'no script yet', tone: 'warn'},
    4: plan.storyboard.length ? {label: `${plan.storyboard.length} planned`, tone: check.producible ? 'ok' : 'warn'} : {label: 'not planned', tone: 'none'},
    6: !episode ? {label: 'no script yet', tone: 'none'} : episode.standIn ? {label: 'not applied', tone: 'warn'} : {label: 'applied', tone: 'ok'},
  };
  const go = {1: () => onTab('brief'), 2: () => onTab('research'), 3: () => onTab('script'), 4: () => onTab('storyboard'), 6: () => onTab('scenes'), ...(episode ? {5: onVoice, ...(onReview ? {7: onReview} : {})} : {})};
  const openImport = (importId: number | null = null) => setDlg({importId});

  return (
    <div className="app">
      <Rail onEpisodes={onList} />
      <div className="main plain" data-screen="plan">
        <header className="top">
          <div className="titles"><span className="crumb">{workspace} · planning</span><h1 className="ttl" title={plan.title} data-testid="plan-title">{plan.title}</h1></div>
          <span className="spacer" />
          <span className={`chip ${episode ? 'green' : 'amber'}`} data-testid="plan-state">{episode ? 'Has a script' : 'Draft: no script yet'}</span>
          {episode && <button className="btn sm" onClick={onEditor} data-testid="open-editor">Script editor</button>}
          <button className="btn sm" onClick={onList} data-testid="all-episodes">All episodes</button>
        </header>
        <Stepper notes={notes} current={TAB_STAGE[tab]} go={go} />
        <div className="notices">
          {notice && <Notice tone={notice.tone} actions={<button className="btn sm" onClick={() => setNotice(null)}>OK</button>}><span data-testid="plan-notice">{notice.text}</span></Notice>}
        </div>
        <main className="page" aria-label={`${tab} step`} data-tab={tab} data-seq={data.seq}>
          {tab === 'brief' && (
            <div className="research">
              <section><h3>The idea</h3><BriefForm plan={plan} episodeExists={!!episode} onSave={(p) => commit(p, 'edited the brief')} /></section>
              <section data-testid="imports-list"><h3>Imports <span className="muted small">{imports.length}</span></h3>
                {imports.length === 0 ? <p className="muted">Nothing has been imported. The Research, Script and Storyboard steps each have a brief to copy into ChatGPT and a way to bring its answer back.</p> : (
                  <ul className="implist">{imports.map((i) => (
                    <li key={i.id} data-testid={`import-row-${i.id}`}>
                      <span className={`chip sm ${i.state === 'accepted' ? 'green' : i.state === 'proposed' ? 'amber' : ''}`}>{i.state === 'proposed' ? 'Proposed' : i.state === 'accepted' ? 'Accepted' : 'Not accepted'}</span>
                      #{i.id} · {SHAPE_LABEL[i.shape]} · {i.sourceName ?? (i.via === 'file' ? 'file' : 'pasted text')} · {whenShort(i.createdAt)} · <span title={i.sha256}>sha256 {i.sha256.slice(0, 12)}</span>
                      <button className="linkish" onClick={() => openImport(i.id)} data-testid={`view-import-${i.id}`}>{i.state === 'proposed' ? 'Review' : 'View'}</button>
                    </li>
                  ))}</ul>
                )}
              </section>
              <section><h3>History of this plan</h3>
                <details open={revsOpen} onToggle={(e) => setRevsOpen((e.currentTarget as HTMLDetailsElement).open)}><summary data-testid="plan-history">Show every saved version</summary>
                  {revs && <ul className="implist">{revs.map((r) => (
                    <li key={r.number} data-testid={`plan-rev-${r.number}`}>
                      <b>{r.number}</b> · {r.kind === 'import' ? 'Import accepted' : r.kind === 'restore' ? 'Restored' : r.kind === 'create' ? 'Started' : 'Edited'} · {r.summary} · {when(r.createdAt)}{r.label ? ` · ${r.label}` : ''}
                      {r.isCurrent ? <span className="chip sm green">current</span> : <button className="linkish" onClick={() => void restorePlanRevision(id, r.number, data.seq).then((x) => { if (x.status === 200) { setData(x.json); setNotice({tone: 'info', text: `Restored version ${r.number} of the plan, saved as a new version. The episode itself was not touched.`}); } else setNotice({tone: 'bad', text: x.json.message ?? 'It could not be restored.'}); })} data-testid={`restore-plan-${r.number}`}>Restore this version</button>}
                    </li>
                  ))}</ul>}
                </details>
              </section>
            </div>
          )}
          {tab === 'research' && <Research plan={plan} commit={commit} brief={brief.research} pending={imports} onImport={() => openImport()} onReview={(n) => openImport(n)} />}
          {tab === 'script' && (
            <div className="research">
              {!episode ? (
                <section className="card" data-testid="script-empty"><h3>No script yet</h3><p>Accepting a script creates the episode from it. Until then nothing exists to build, and no work is started. The brief below asks ChatGPT for narration; you can also paste a script you wrote.</p></section>
              ) : (
                <section className="card" data-testid="script-accepted">
                  <div className="chead"><h3>Accepted script</h3><span className="chip sm green">{episode.segments.length} segments</span><ProvenanceChip p={plan.script.provenance} /></div>
                  <ol className="rows ro">{episode.segments.map((s) => <li key={s.id} data-testid={`accepted-${s.id}`}><code>{s.id}</code> {s.text}</li>)}</ol>
                  <div className="hrow"><button className="btn sm pri" onClick={onEditor} data-testid="open-editor-2">Open the script editor</button><span className="muted small">Edit words, pauses and emphasis there. Replacing the whole script with a new import asks you first and keeps this version in History.</span></div>
                </section>
              )}
              {episode && <OpeningHook id={id} refreshKey={episode.seq} />}
              <Creative id={id} plan={plan} hasEpisode={!!episode} commit={commit} refreshKey={episode?.seq} />
              <Handoff kind="script" text={brief.script} pending={pending} onImport={() => openImport()} onReview={(n) => openImport(n)} />
            </div>
          )}
          {tab === 'storyboard' && <Storyboard plan={plan} episode={episode} check={check} commit={commit} brief={brief.storyboard} pending={imports} onImport={() => openImport()} onReview={(n) => openImport(n)} onScript={() => onTab('script')} onApplied={(n) => { setNotice({tone: 'info', text: `Applied ${n} scene${n === 1 ? '' : 's'} to the episode. The narration was not touched, and nothing was started. Open the Scenes step to adjust them.`}); void load(); }} onScenes={() => onTab('scenes')} />}
          {tab === 'scenes' && <Scenes plan={plan} episodeSeq={episode?.seq ?? null} hasEpisode={!!episode} onStoryboard={() => onTab('storyboard')} onScript={() => onTab('script')} />}
        </main>
        {dlg && <ImportDialog planId={id} importId={dlg.importId} onClose={() => { setDlg(null); void load(); }} onChanged={() => void load()} onDone={(summary) => { setNotice({tone: 'info', text: `Accepted. ${summary.join('. ')}.`}); void load(); }} />}
      </div>
    </div>
  );
}
