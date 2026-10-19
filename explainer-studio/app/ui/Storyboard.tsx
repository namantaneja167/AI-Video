// Storyboard: which narration goes into which planned scene, and what each scene would show. This is a plan. Each scene is
// reported as ready (its type exists and its parameters are valid), incomplete (content or cue words missing), custom (to be
// implemented) or unsupported (not a type this app has). Nothing here builds a video. Putting the planned scenes into the episode
// is a separate, previewed step (the apply panel below), and never starts any work.
import {useState} from 'react';
import type {BriefKind} from '../shared/handoff.ts';
import {SbSceneSchema, blankScene, withScene, withoutScene, type PlanDoc, type SbScene} from '../shared/plan.ts';
import {KIND_LABEL, SCENE_TYPES, STATE_LABEL, episodeSceneFor, sceneTypeInfo, type SceneState, type StoryboardCheck} from '../shared/storyboard.ts';
import type {ImportRow} from '../planning.ts';
import {applyScenes, getApplyPreview, type ApplyPreview, type EpisodeBrief} from './api';
import {Handoff, ProvenanceChip} from './Import';
import {when} from './labels';
import type {Commit} from './Research';

function SceneForm({initial, episode, onSave, onCancel}: {initial: SbScene; episode: EpisodeBrief; onSave: (s: SbScene) => Promise<string | null>; onCancel: () => void}) {
  const [s, setS] = useState(initial);
  const [pip, setPip] = useState(initial.pip.join('\n'));
  const [params, setParams] = useState(initial.params ? JSON.stringify(initial.params, null, 2) : '');
  const [err, setErr] = useState<string | null>(null);
  const known = SCENE_TYPES.some((t) => t.id === s.sceneType);
  const save = async () => {
    let parsed: Record<string, unknown> | null = null;
    if (params.trim()) {
      try { const j = JSON.parse(params); if (typeof j !== 'object' || j === null || Array.isArray(j)) throw new Error('must be a JSON object'); parsed = j; } catch (e) { setErr(`Parameters are not valid JSON: ${(e as Error).message}`); return; }
      if (sceneTypeInfo(s.sceneType) && sceneTypeInfo(s.sceneType)!.reuse !== 'custom') {
        const r = episodeSceneFor({...s, segmentIds: s.segmentIds.length ? s.segmentIds : ['x'], params: parsed});
        if (!r.ok) { setErr(`Parameters do not fit this scene type: ${r.problems.slice(0, 4).join('; ')}`); return; }
      } else { setErr('Parameters can only be given for a scene type this app has.'); return; }
    }
    const v = SbSceneSchema.safeParse({...s, params: parsed, pip: pip.split('\n').map((l) => l.trim()).filter(Boolean)});
    if (!v.success) { setErr(v.error.issues.map((i) => `${i.path.join('.') || 'value'}: ${i.message}`).join('; ')); return; }
    setErr(await onSave(v.data));
  };
  return (
    <form className="cardform" onSubmit={(e) => { e.preventDefault(); void save(); }} data-testid="scene-form">
      <fieldset className="srcpick"><legend>Narration in this scene</legend>
        {episode.segments.map((g) => <label key={g.id} title={g.text}><input type="checkbox" checked={s.segmentIds.includes(g.id)} onChange={() => setS((x) => ({...x, segmentIds: x.segmentIds.includes(g.id) ? x.segmentIds.filter((i) => i !== g.id) : episode.segments.map((y) => y.id).filter((i) => i === g.id || x.segmentIds.includes(i))}))} data-testid={`pick-seg-${g.id}`} /> {g.id} · {g.text.length > 70 ? `${g.text.slice(0, 70)}…` : g.text}</label>)}
      </fieldset>
      <label>Scene type
        <select className="field" value={s.sceneType} onChange={(e) => setS((x) => ({...x, sceneType: e.target.value}))} data-testid="scene-type">
          {SCENE_TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          {!known && <option value={s.sceneType}>{s.sceneType} (not a scene type this app has)</option>}
        </select>
        <span className="muted small">{sceneTypeInfo(s.sceneType)?.summary ?? 'This app has no scene type with that name.'}</span>
      </label>
      <label>Intention <span className="muted small">(what the viewer should understand or feel)</span><textarea className="field" rows={2} value={s.intention} onChange={(e) => setS((x) => ({...x, intention: e.target.value}))} data-testid="scene-intention" /></label>
      <label>What is shown, and how it changes <span className="muted small">(a planning note; it draws nothing)</span><textarea className="field" rows={2} value={s.mechanism} onChange={(e) => setS((x) => ({...x, mechanism: e.target.value}))} data-testid="scene-mechanism" /></label>
      <label>What Pip does <span className="muted small">(a planning note, one idea per line. It does not animate Pip: supported actions are set in the Scenes step)</span><textarea className="field" rows={3} value={pip} onChange={(e) => setPip(e.target.value)} data-testid="scene-pip" /></label>
      <label>Parameters <span className="muted small">(optional JSON: what this scene type shows; checked against the type, empty means none yet)</span><textarea className="field mono" rows={4} value={params} onChange={(e) => setParams(e.target.value)} data-testid="scene-params" /></label>
      {err && <div className="errs" role="alert" data-testid="form-error">{err}</div>}
      <div className="hrow"><button type="submit" className="btn sm pri" data-testid="scene-save">Save scene</button><button type="button" className="btn sm" onClick={onCancel}>Cancel</button></div>
    </form>
  );
}

const TONE: Record<SceneState, string> = {ready: 'green', incomplete: 'amber', custom: 'amber', unsupported: 'rose'};
const CHANGE_LABEL = {new: 'New', changed: 'Changed', same: 'Unchanged', removed: 'Removed'} as const;

/** Put the planned scenes into the episode: preview first, then one explicit step. Narration is never touched. */
function ApplyPanel({plan, episode, ready, onApplied, onScenes}: {plan: PlanDoc; episode: EpisodeBrief; ready: boolean; onApplied: (n: number) => void; onScenes: () => void}) {
  const [pre, setPre] = useState<ApplyPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [yes, setYes] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [errs, setErrs] = useState<string[]>([]);
  const look = async () => {
    setBusy(true); setErr(null); setErrs([]); setYes(false);
    const r = await getApplyPreview(plan.id);
    setBusy(false);
    if (r.status === 200) setPre(r.json); else { setPre(null); setErr(r.json.message ?? 'The preview could not be made.'); setErrs(r.json.problems ?? []); }
  };
  const apply = async () => {
    if (!pre) return;
    setBusy(true); setErr(null); setErrs([]);
    const r = await applyScenes(plan.id, pre.planSeq, pre.episodeSeq, yes);
    setBusy(false);
    if (r.status === 200) { setPre(null); onApplied(r.json.scenes ?? 0); return; }
    if (r.status === 409) { setPre(null); setErr('The plan or the episode was changed somewhere else after this preview, so nothing was applied. Preview again to see what would change now.'); return; }
    setErr(r.json.message ?? 'It could not be applied.'); setErrs(r.json.problems ?? []);
  };
  const a = pre?.application;
  return (
    <section className="card applybox" aria-label="Put the scenes into the episode" data-testid="apply-panel">
      <div className="chead"><h3>Put these scenes into the episode</h3>{plan.applied && <span className="chip sm green" data-testid="applied-chip" title={when(plan.applied.at)}>Applied {when(plan.applied.at)}</span>}</div>
      <p className="small muted">{ready ? 'Every planned scene is ready. Preview what would change in the episode, then apply.' : 'Only a complete, valid storyboard can be applied: every scene ready, and every narration line in exactly one scene, in order. Previewing lists what is missing.'} Applying changes the episode's scenes only: the narration, its takes and its timing are not touched, and it starts no work.</p>
      <div className="hrow"><button className="btn sm" onClick={() => void look()} disabled={busy} data-testid="apply-preview">Preview what would change</button>
        {plan.applied && <button className="linkish" onClick={onScenes} data-testid="open-scenes">Open the Scenes step</button>}</div>
      {err && <div className="errs" role="alert" data-testid="apply-error">{err}{errs.length > 0 && <ul>{errs.map((m, i) => <li key={i}>{m}</li>)}</ul>}</div>}
      {a && (
        <div className="applyprev" data-testid="apply-result" data-ok={a.scenes ? 'yes' : 'no'}>
          {a.problems.length > 0 && <div className="errs" data-testid="apply-problems"><b>Cannot be applied yet</b><ul>{a.problems.map((m, i) => <li key={i}>{m}</li>)}</ul></div>}
          {a.changes.length > 0 && <ul className="changes" data-testid="apply-changes">{a.changes.map((c) => (
            <li key={c.id} data-change={c.change}><span className={`chip sm ${c.change === 'same' ? '' : c.change === 'removed' ? 'rose' : 'amber'}`}>{CHANGE_LABEL[c.change]}</span> <code>{c.id}</code> {c.after ?? c.before}{c.change === 'changed' && c.before ? <div className="small muted">before: {c.before}</div> : null}</li>
          ))}</ul>}
          {a.scenes && a.confirm.length > 0 && (
            <label className="confirmrow" data-testid="apply-confirm-row"><input type="checkbox" checked={yes} onChange={(e) => setYes(e.target.checked)} data-testid="apply-confirm" /> <span>{a.confirm.join(' ')}</span></label>
          )}
          {a.scenes && <div className="hrow"><button className="btn sm pri" onClick={() => void apply()} disabled={busy || (a.replaces && !yes)} data-testid="apply-go">Apply {a.scenes.length} scene{a.scenes.length === 1 ? '' : 's'} to the episode</button>
            <button className="btn sm" onClick={() => setPre(null)}>Cancel</button></div>}
        </div>
      )}
      {episode.standIn && !pre && !plan.applied && <p className="small muted">Until scenes are applied the episode has only its stand-in scene, and production is refused.</p>}
    </section>
  );
}

export function Storyboard({plan, episode, check, commit, brief, pending, onImport, onReview, onScript, onApplied, onScenes}: {plan: PlanDoc; episode: EpisodeBrief | null; check: StoryboardCheck; commit: Commit; brief: string; pending: ImportRow[]; onImport: () => void; onReview: (n: number) => void; onScript: () => void; onApplied: (n: number) => void; onScenes: () => void}) {
  const [edit, setEdit] = useState<string | null>(null);
  const kind: BriefKind = 'storyboard';
  if (!episode) {
    return (
      <div className="research">
        <section className="card" data-testid="storyboard-needs-script">
          <h3>The storyboard is written against the script</h3>
          <p>Each scene is made of narration lines, so there is nothing to plan until a script has been accepted.</p>
          <div className="hrow"><button className="btn sm pri" onClick={onScript} data-testid="go-script">Go to the script</button></div>
        </section>
      </div>
    );
  }
  const byId = new Map(check.scenes.map((c) => [c.id, c]));
  return (
    <div className="research">
      <div className={`plannote ${check.producible ? 'ok' : 'warn'}`} role="status" data-testid="storyboard-summary">
        <b>{check.producible ? 'Every planned scene is ready.' : 'Not every planned scene is ready yet.'}</b>{' '}
        {check.summary}{check.unassigned.length && plan.storyboard.length ? ` Narration in no scene: ${check.unassigned.join(', ')}.` : ''}
        <div className="small">A scene is ready when its type exists and its parameters are valid; add parameters with Edit, or in an import. Incomplete scenes can become ready; custom ones need a developer; an unsupported type needs another choice. This is a plan: nothing is built from it. The Pip and "what is shown" lines are planning notes: they animate nothing until they are set as actions in the Scenes step.</div>
      </div>
      {episode.standIn && <p className="muted small" data-testid="standin-note">The episode itself holds one stand-in scene covering all {episode.segments.length} lines, so that its script can be edited and saved. It is not part of the plan below and is never rendered.</p>}
      <ApplyPanel plan={plan} episode={episode} ready={check.producible} onApplied={onApplied} onScenes={onScenes} />
      <Handoff kind={kind} text={brief} pending={pending.filter((p) => p.state === 'proposed')} onImport={onImport} onReview={onReview} />

      <section aria-label="Planned scenes" data-testid="scenes">
        <div className="shead"><h3>Planned scenes <span className="muted small">{plan.storyboard.length}</span></h3><button className="btn sm" onClick={() => setEdit('new')} data-testid="add-scene">Add a scene</button></div>
        {edit === 'new' && <SceneForm initial={blankScene(plan)} episode={episode} onCancel={() => setEdit(null)} onSave={async (s) => { const e = await commit(withScene(plan, s), `added scene ${s.id}`); if (!e) setEdit(null); return e; }} />}
        {plan.storyboard.length === 0 && edit !== 'new' && <p className="muted">Nothing planned yet. Add scenes by hand, or ask ChatGPT for a storyboard above.</p>}
        {check.unassigned.length > 0 && plan.storyboard.length > 0 && <div className="warnline" data-testid="unassigned">Narration in no scene: {check.unassigned.join(', ')}</div>}
        {plan.storyboard.map((s, i) => {
          const c = byId.get(s.id)!;
          return (
            <article key={s.id} className="card" data-testid={`scene-${s.id}`} data-kind={c.kind} data-state={c.state}>
              {edit === s.id
                ? <SceneForm initial={s} episode={episode} onCancel={() => setEdit(null)} onSave={async (x) => { const e = await commit(withScene(plan, x), `edited scene ${x.id}`); if (!e) setEdit(null); return e; }} />
                : (
                  <>
                    <div className="chead"><b>Scene {i + 1}</b><span className="ctitle">{c.typeLabel}</span><span className={`chip sm ${TONE[c.state]}`} data-testid="scene-kind" title={KIND_LABEL[c.kind]}>{STATE_LABEL[c.state]}</span><ProvenanceChip p={s.provenance} /></div>
                    <ul className="segchips">{s.segmentIds.map((id) => { const g = episode.segments.find((x) => x.id === id); return <li key={id} className={g ? '' : 'missing'} title={g?.text ?? 'Not in the script'}>{id}{g ? '' : ' (not in the script)'}</li>; })}</ul>
                    {s.intention && <div className="small"><b>Intention:</b> {s.intention}</div>}
                    {s.mechanism && <div className="small" data-testid="note-shows"><b>Shows (planning note):</b> {s.mechanism}</div>}
                    {s.pip.length > 0 && <div className="small" data-testid="note-pip"><b>Pip (planning note):</b> {s.pip.join(' · ')}</div>}
                    <ul className="blockers" data-testid="scene-blockers">{c.blockers.map((b, k) => <li key={k}>{b}</li>)}</ul>
                    {c.notes.length > 0 && <ul className="snotes">{c.notes.map((n, k) => <li key={k}>{n}</li>)}</ul>}
                    <div className="hrow"><span className="spacer" /><button className="linkish" onClick={() => setEdit(s.id)}>Edit</button><button className="linkish" onClick={() => void commit(withoutScene(plan, s.id), `removed scene ${s.id}`)} data-testid={`remove-${s.id}`}>Remove</button></div>
                  </>
                )}
            </article>
          );
        })}
      </section>
    </div>
  );
}
