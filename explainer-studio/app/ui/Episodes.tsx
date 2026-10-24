// All episodes in the workspace: the one that was imported from files, and drafts started here. A draft keeps its brief,
// research, script and storyboard in the project database; opening one never starts any work.
import {useState} from 'react';
import {createPlan, linkPlan, type LibraryItem} from './api';
import {whenShort} from './labels';
import {Rail} from './Chrome';
import {useModal} from './useModal';

function NewEpisode({onCreated, onCancel}: {onCreated: (id: string) => void; onCancel: () => void}) {
  const [f, setF] = useState({title: '', audience: '', objective: '', duration: ''});
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const ref = useModal(onCancel);
  const submit = async () => {
    const n = f.duration.trim() === '' ? null : Number(f.duration);
    if (!f.title.trim()) { setErr('Give the episode a title.'); return; }
    if (n !== null && !(Number.isFinite(n) && n >= 0.25 && n <= 30)) { setErr('The approximate length is in minutes, between 0.25 and 30.'); return; }
    setBusy(true);
    const r = await createPlan({title: f.title, audience: f.audience, objective: f.objective, durationMin: n, brand: 'pip-explains'});
    setBusy(false);
    if (r.status === 201) onCreated(r.json.plan.id); else setErr(r.json.issues?.map((i) => `${i.path}: ${i.message}`).join('; ') ?? r.json.message ?? 'It could not be created.');
  };
  return (
    <div className="scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <div className="dialog" role="dialog" aria-modal="true" aria-label="New episode" data-testid="new-episode-dialog" ref={ref}>
        <div className="dhead"><div><h2>New episode</h2><p className="muted small">A draft with a brief. It has no script yet, and nothing is built or run.</p></div><button className="btn sm" onClick={onCancel}>Cancel</button></div>
        <form className="cardform" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
          <label>Title<input className="field" value={f.title} onChange={(e) => setF({...f, title: e.target.value})} autoFocus data-testid="new-title" /></label>
          <label>Who is it for?<input className="field" value={f.audience} onChange={(e) => setF({...f, audience: e.target.value})} data-testid="new-audience" /></label>
          <label>What should the viewer understand by the end?<textarea className="field" rows={2} value={f.objective} onChange={(e) => setF({...f, objective: e.target.value})} data-testid="new-objective" /></label>
          <label>Approximate length, in minutes <span className="muted small">(optional)</span><input className="field num" inputMode="decimal" value={f.duration} onChange={(e) => setF({...f, duration: e.target.value})} data-testid="new-duration" /></label>
          {err && <div className="errs" role="alert" data-testid="new-error">{err}</div>}
          <div className="hrow"><button type="submit" className="btn sm pri" disabled={busy} data-testid="new-create">Create draft</button></div>
        </form>
      </div>
    </div>
  );
}

/** An episode made without a planning document gets one, written down from what the episode already holds. Nothing else changes. */
function LinkNotes({id, onLinked}: {id: string; onLinked: () => void}) {
  const [open, setOpen] = useState(false);
  const [audience, setAudience] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (!open) return <button className="btn sm" onClick={() => setOpen(true)} data-testid={`link-plan-${id}`}>Connect planning notes…</button>;
  const go = async () => {
    setBusy(true); setErr(null);
    const r = await linkPlan(id, {audience: audience.trim() || undefined, brand: true});
    setBusy(false);
    if (r.status === 201) onLinked(); else setErr(r.json.message ?? 'It could not be connected.');
  };
  return (
    <div className="plannote" data-testid={`link-plan-form-${id}`}>
      <p className="small">This episode was made without a brief, research or storyboard. Connecting creates them from what the episode already holds: its title, learning objective, sources and scenes. <b>The episode, its narration takes, builds and history are not changed, and nothing is rebuilt</b> (planning notes are not part of what a build depends on). Nothing is researched or invented: you fill in the audience, claims and intentions afterwards.</p>
      <label className="small">Who is it for? <span className="muted">(optional)</span><input className="field" value={audience} onChange={(e) => setAudience(e.target.value)} data-testid={`link-audience-${id}`} /></label>
      {err && <div className="errs" role="alert">{err}</div>}
      <div className="hrow"><button className="btn sm pri" disabled={busy} onClick={() => void go()} data-testid={`link-plan-go-${id}`}>Connect</button><button className="btn sm" disabled={busy} onClick={() => setOpen(false)}>Cancel</button></div>
    </div>
  );
}

export function Episodes({items, workspace, notice, onEditor, onPlan, onCreated}: {items: LibraryItem[]; workspace: string; notice?: string; onEditor: (id: string) => void; onPlan: (id: string) => void; onCreated: (id: string) => void}) {
  const [creating, setCreating] = useState(false);
  return (
    <div className="app">
      <Rail onList />
      <div className="main plain" data-screen="episodes">
        <header className="top">
          <div className="titles"><span className="crumb">{workspace}</span><h1 className="ttl">Episodes</h1></div>
          <span className="spacer" />
          <button className="btn pri" onClick={() => setCreating(true)} data-testid="new-episode">New episode</button>
        </header>
        <div className="notices">{notice && <div className="plannote warn" role="status" data-testid="route-notice">{notice}</div>}</div>
        <main className="page" aria-label="Episodes" data-testid="episode-list">
          {items.length === 0 && (
            <section className="card" data-testid="empty-project">
              <h3>This project has no episodes yet</h3>
              <p>An episode is one short video, made in steps: Idea, Research, Script, Storyboard, Scenes, Voice, then Review. Each step shows what it needs before anything runs, and nothing is built until you ask for it.</p>
              <p className="small muted">Start with a title and who it is for. You can paste the research, script and storyboard from ChatGPT one step at a time; the app only reads what you paste.</p>
              <div className="hrow"><button className="btn sm pri" onClick={() => setCreating(true)} data-testid="empty-new-episode">Start the first episode</button></div>
            </section>
          )}
          <ul className="eplist">
            {items.map((it) => (
              <li key={it.id} className="card" data-testid={`episode-${it.id}`} data-has-plan={it.hasPlan ? 'true' : 'false'} data-has-episode={it.hasEpisode ? 'true' : 'false'}>
                <div className="chead"><span className="ctitle">{it.title}</span><code className="small muted">{it.id}</code>
                  {it.hasPlan ? <span className={`chip sm ${it.hasEpisode ? 'green' : 'amber'}`}>{it.hasEpisode ? `${it.segments} segments` : 'Draft: no script yet'}</span> : <span className="chip sm">{it.built ? 'Built episode' : 'Episode'}</span>}
                </div>
                {it.objective && <div className="small">{it.objective}</div>}
                <div className="small muted">
                  {it.hasPlan ? [it.audience && `For ${it.audience}`, it.durationMin ? `about ${it.durationMin} min` : '', `${it.sources} source${it.sources === 1 ? '' : 's'}`, `${it.claims} claim${it.claims === 1 ? '' : 's'}`, `${it.scenes} planned scene${it.scenes === 1 ? '' : 's'}`].filter(Boolean).join(' · ') : 'Imported from files; it has no planning document.'}
                  {it.updatedAt ? ` · changed ${whenShort(it.updatedAt)}` : ''}
                </div>
                {it.hasPlan && it.hasEpisode && <div className="small warnline">Not producible yet: its scenes have not been made.</div>}
                <div className="hrow">
                  {it.hasPlan && <button className="btn sm" onClick={() => onPlan(it.id)} data-testid={`open-plan-${it.id}`}>Open plan</button>}
                  {it.hasEpisode && <button className="btn sm" onClick={() => onEditor(it.id)} data-testid={`open-editor-${it.id}`}>Open script editor</button>}
                  {!it.hasPlan && it.hasEpisode && <LinkNotes id={it.id} onLinked={() => onPlan(it.id)} />}
                </div>
              </li>
            ))}
          </ul>
        </main>
        {creating && <NewEpisode onCancel={() => setCreating(false)} onCreated={(id) => { setCreating(false); onCreated(id); }} />}
      </div>
    </div>
  );
}
