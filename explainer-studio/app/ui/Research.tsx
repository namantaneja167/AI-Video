// Research: the sources an episode relies on and the claims its narration may make. Records only: a link is saved as
// written and is never opened, fetched or checked by the app; "checked" is something the author sets by hand.
import {useState} from 'react';
import type {BriefKind} from '../shared/handoff.ts';
import {CLAIM_HELP, CLAIM_KINDS, CLAIM_LABEL, ClaimSchema, SourceSchema, blankClaim, blankSource, nextId, researchWarnings, withClaim, withSource, withoutClaim, withoutSource, type Claim, type PlanDoc, type Source} from '../shared/plan.ts';
import type {ImportRow} from '../planning.ts';
import {Handoff, ProvenanceChip} from './Import';
import {when} from './labels';

export type Commit = (next: PlanDoc, label: string) => Promise<string | null>;

const issueText = (issues: {path: PropertyKey[]; message: string}[]) => issues.map((i) => `${i.path.join('.') || 'value'}: ${i.message}`).join('; ');

function SourceForm({initial, onSave, onCancel}: {initial: Source; onSave: (s: Source) => Promise<string | null>; onCancel: () => void}) {
  const [s, setS] = useState(initial);
  const [err, setErr] = useState<string | null>(null);
  const set = <K extends keyof Source>(k: K, v: Source[K]) => setS((x) => ({...x, [k]: v}));
  const save = async () => {
    const next = {...s, title: s.title.trim(), url: s.url?.trim() ? s.url.trim() : null};
    const v = SourceSchema.safeParse(next);
    if (!v.success) { setErr(issueText(v.error.issues)); return; }
    setErr(await onSave(v.data));
  };
  return (
    <form className="cardform" onSubmit={(e) => { e.preventDefault(); void save(); }} data-testid="source-form">
      <label>Title<input className="field" value={s.title} onChange={(e) => set('title', e.target.value)} data-testid="source-title" autoFocus /></label>
      <label>Link <span className="muted small">(saved as written; never opened or fetched)</span><input className="field" value={s.url ?? ''} placeholder="https://" onChange={(e) => set('url', e.target.value)} data-testid="source-url" /></label>
      <div className="two">
        <label>Publisher<input className="field" value={s.publisher} onChange={(e) => set('publisher', e.target.value)} /></label>
        <label>Published <span className="muted small">(YYYY, YYYY-MM or YYYY-MM-DD, if known)</span><input className="field" value={s.published} onChange={(e) => set('published', e.target.value)} data-testid="source-date" /></label>
      </div>
      <label>Note <span className="muted small">(what it covers; or where to find it if there is no link)</span><textarea className="field" rows={2} value={s.note} onChange={(e) => set('note', e.target.value)} /></label>
      {err && <div className="errs" role="alert" data-testid="form-error">{err}</div>}
      <div className="hrow"><button type="submit" className="btn sm pri" data-testid="source-save">Save source</button><button type="button" className="btn sm" onClick={onCancel}>Cancel</button></div>
    </form>
  );
}

function ClaimForm({initial, plan, onSave, onCancel}: {initial: Claim; plan: PlanDoc; onSave: (c: Claim) => Promise<string | null>; onCancel: () => void}) {
  const [c, setC] = useState(initial);
  const [err, setErr] = useState<string | null>(null);
  const set = <K extends keyof Claim>(k: K, v: Claim[K]) => setC((x) => ({...x, [k]: v}));
  const save = async () => {
    const v = ClaimSchema.safeParse({...c, text: c.text.trim()});
    if (!v.success) { setErr(issueText(v.error.issues)); return; }
    setErr(await onSave(v.data));
  };
  return (
    <form className="cardform" onSubmit={(e) => { e.preventDefault(); void save(); }} data-testid="claim-form">
      <label>The claim<textarea className="field" rows={2} value={c.text} onChange={(e) => set('text', e.target.value)} data-testid="claim-text" autoFocus /></label>
      <label>What kind of statement is it?
        <select className="field" value={c.kind} onChange={(e) => set('kind', e.target.value as Claim['kind'])} data-testid="claim-kind">{CLAIM_KINDS.map((k) => <option key={k} value={k}>{CLAIM_LABEL[k]}</option>)}</select>
        <span className="muted small">{CLAIM_HELP[c.kind]}</span>
      </label>
      {plan.sources.length > 0 && (
        <fieldset className="srcpick"><legend>Sources it rests on</legend>
          {plan.sources.map((s) => <label key={s.id}><input type="checkbox" checked={c.sourceIds.includes(s.id)} onChange={() => set('sourceIds', c.sourceIds.includes(s.id) ? c.sourceIds.filter((x) => x !== s.id) : [...c.sourceIds, s.id])} /> {s.id} · {s.title}</label>)}
        </fieldset>
      )}
      <label>Evidence <span className="muted small">(what in the source supports it)</span><textarea className="field" rows={2} value={c.evidence} onChange={(e) => set('evidence', e.target.value)} /></label>
      <label>Caveat <span className="muted small">(what limits it)</span><textarea className="field" rows={2} value={c.caveat} onChange={(e) => set('caveat', e.target.value)} /></label>
      {err && <div className="errs" role="alert" data-testid="form-error">{err}</div>}
      <div className="hrow"><button type="submit" className="btn sm pri" data-testid="claim-save">Save claim</button><button type="button" className="btn sm" onClick={onCancel}>Cancel</button></div>
    </form>
  );
}

export function Research({plan, commit, brief, pending, onImport, onReview}: {plan: PlanDoc; commit: Commit; brief: string; pending: ImportRow[]; onImport: () => void; onReview: (n: number) => void}) {
  const [edit, setEdit] = useState<{kind: 'source' | 'claim'; id: string} | null>(null);
  const warnings = researchWarnings(plan);
  const kind: BriefKind = 'research';
  return (
    <div className="research">
      <Handoff kind={kind} text={brief} pending={pending.filter((p) => p.state === 'proposed')} onImport={onImport} onReview={onReview} />
      {warnings.length > 0 && (
        <ul className="warnings" aria-label="Things to look at" data-testid="research-warnings">{warnings.map((w, i) => <li key={i} className={w.tone}>{w.text}</li>)}</ul>
      )}

      <section aria-label="Sources" data-testid="sources">
        <div className="shead"><h3>Sources <span className="muted small">{plan.sources.length}</span></h3><button className="btn sm" onClick={() => setEdit({kind: 'source', id: 'new'})} data-testid="add-source">Add a source</button></div>
        <p className="muted small">A link is only a record of where something is. The app does not open it, fetch it or check that it is real or says what is claimed: that is for you.</p>
        {edit?.kind === 'source' && edit.id === 'new' && <SourceForm initial={blankSource(plan)} onCancel={() => setEdit(null)} onSave={async (s) => { const e = await commit(withSource(plan, s), `added source ${s.id}`); if (!e) setEdit(null); return e; }} />}
        {plan.sources.length === 0 && edit?.id !== 'new' && <p className="muted" data-testid="no-sources">No sources yet. Add one by hand, or ask ChatGPT for research above.</p>}
        {plan.sources.map((s) => (
          <article key={s.id} className="card" data-testid={`source-${s.id}`}>
            {edit?.kind === 'source' && edit.id === s.id
              ? <SourceForm initial={s} onCancel={() => setEdit(null)} onSave={async (x) => { const e = await commit(withSource(plan, x), `edited source ${x.id}`); if (!e) setEdit(null); return e; }} />
              : (
                <>
                  <div className="chead"><b>{s.id}</b><span className="ctitle">{s.title}</span><ProvenanceChip p={s.provenance} /></div>
                  <div className="small muted">{[s.publisher, s.published ? `published ${s.published}` : 'publication date not recorded'].filter(Boolean).join(' · ')}</div>
                  {s.url ? <div className="small"><code className="urltext">{s.url}</code> <span className="chip sm" data-testid="link-state">Link recorded · not fetched · not verified</span></div> : <div className="small muted">No link recorded.</div>}
                  {s.note && <div className="small">{s.note}</div>}
                  <div className="hrow">
                    {s.checked ? <span className="chip sm green" data-testid="checked-chip">Checked by you · {when(s.checked.at)}</span> : <span className="chip sm amber">Not checked</span>}
                    <button className="linkish" onClick={() => void commit(withSource(plan, {...s, checked: s.checked ? null : {at: Date.now(), note: ''}}), s.checked ? `unmarked ${s.id}` : `marked ${s.id} as checked`)} data-testid={`check-${s.id}`}>{s.checked ? 'Unmark' : 'I checked this source myself'}</button>
                    <span className="spacer" />
                    <button className="linkish" onClick={() => setEdit({kind: 'source', id: s.id})}>Edit</button>
                    <button className="linkish" onClick={() => void commit(withoutSource(plan, s.id), `removed source ${s.id}`)} data-testid={`remove-${s.id}`}>Remove</button>
                  </div>
                </>
              )}
          </article>
        ))}
      </section>

      <section aria-label="Claims" data-testid="claims">
        <div className="shead"><h3>Claims <span className="muted small">{plan.claims.length}</span></h3><button className="btn sm" onClick={() => setEdit({kind: 'claim', id: 'new'})} data-testid="add-claim">Add a claim</button></div>
        {edit?.kind === 'claim' && edit.id === 'new' && <ClaimForm plan={plan} initial={blankClaim(plan)} onCancel={() => setEdit(null)} onSave={async (c) => { const e = await commit(withClaim(plan, c), `added claim ${c.id}`); if (!e) setEdit(null); return e; }} />}
        {plan.claims.length === 0 && edit?.id !== 'new' && <p className="muted" data-testid="no-claims">No claims yet.</p>}
        {plan.claims.map((c) => (
          <article key={c.id} className="card" data-testid={`claim-${c.id}`}>
            {edit?.kind === 'claim' && edit.id === c.id
              ? <ClaimForm plan={plan} initial={c} onCancel={() => setEdit(null)} onSave={async (x) => { const e = await commit(withClaim(plan, x), `edited claim ${x.id}`); if (!e) setEdit(null); return e; }} />
              : (
                <>
                  <div className="chead"><b>{c.id}</b><span className={`chip sm ${c.kind === 'fact' ? 'green' : c.kind === 'assumption' ? 'amber' : ''}`} data-testid="claim-kind-chip">{CLAIM_LABEL[c.kind]}</span><ProvenanceChip p={c.provenance} /></div>
                  <div className="ctext">{c.text}</div>
                  <div className="small muted">{c.sourceIds.length ? `Rests on ${c.sourceIds.join(', ')}` : 'No source'}</div>
                  {c.evidence && <div className="small"><b>Evidence:</b> {c.evidence}</div>}
                  {c.caveat && <div className="small"><b>Caveat:</b> {c.caveat}</div>}
                  <div className="hrow"><span className="spacer" /><button className="linkish" onClick={() => setEdit({kind: 'claim', id: c.id})}>Edit</button><button className="linkish" onClick={() => void commit(withoutClaim(plan, c.id), `removed claim ${c.id}`)} data-testid={`remove-${c.id}`}>Remove</button></div>
                </>
              )}
          </article>
        ))}
      </section>
    </div>
  );
}

export const nextSourceId = (p: PlanDoc) => nextId('src', p.sources);
