// The Scenes step: the scenes the episode actually holds, with validated controls for the registered scene types, and a
// composition preview drawn on an ESTIMATED clock (no audio, guessed times: it is never a build). Free-form prose from the
// storyboard stays a planning note; Pip does only the actions listed here. Saving goes through the normal episode save
// (a revision, with the sequence check). Nothing here starts any work.
import {Player} from '@remotion/player';
import {useCallback, useEffect, useMemo, useState} from 'react';
import {LibraryEpisode} from '../../src/library/LibraryEpisode';
import {PIP_ACTIONS, PIP_ACTION_INFO, PipCardsParams, type PipAction} from '../../src/library/params.ts';
import {PIP_CARDS_LAYOUTS} from '../../src/library/scenes/pipCardsGeometry.ts';
import type {EpisodeV2} from '../../src/schema2.ts';
import {SceneSchemaV2} from '../../src/schema2.ts';
import {FPS, H, W} from '../../src/theme';
import {spokenOf} from '../shared/compare.ts';
import {estimatedPreview} from '../shared/estimate.ts';
import type {Plan} from '../shared/plan-types.ts';
import type {PlanDoc} from '../shared/plan.ts';
import {KIND_LABEL, STATE_LABEL, checkSceneInput, isPlaceholderEpisode, sceneTypeInfo, type SceneState} from '../shared/storyboard.ts';
import {TAB_ID, getEpisode, getPlan, saveEpisode} from './api';

type Scene = EpisodeV2['scenes'][number];
type Seg = EpisodeV2['narration']['segments'][number];
type Draft = {scene: Scene; base: string};
type At = {segment: number; word?: string | number; edge?: 'start' | 'end'};
type P = {title?: string; cards: {heading: string; body: string; at?: At}[]; actions: {do: PipAction; at: At; card?: number}[]; idle: boolean};

const TONE: Record<SceneState, string> = {ready: 'green', incomplete: 'amber', custom: 'amber', unsupported: 'rose'};
const LAYOUT_LABEL: Record<string, string> = {'content-led': 'Content-led', 'card-over-pip': 'Card over Pip', 'dense-pip': 'Dense Pip'};
const short = (t: string, n = 46) => (t.length > n ? `${t.slice(0, n)}…` : t);
/** The same JSON whatever the order the keys were written in, so a scene can be compared with the server's copy of it. */
const canon = (v: unknown): string => JSON.stringify(v, (_k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : 1))) : x));
const clean = (w: string) => w.replace(/[^\p{L}\p{N}'-]/gu, '');
const looseParams = (s: Scene): P => {
  const p = (s.params ?? {}) as Partial<P>;
  return {...(p.title !== undefined ? {title: p.title} : {}), cards: Array.isArray(p.cards) ? p.cards.map((c) => ({heading: c?.heading ?? '', body: c?.body ?? '', ...(c?.at ? {at: c.at} : {})})) : [], actions: Array.isArray(p.actions) ? p.actions : [], idle: p.idle ?? true};
};

/** Where something happens: a line of the scene, and the start, the end or one spoken word of it. */
function AtControl({at, lines, segs, onChange, testid}: {at: At; lines: string[]; segs: Map<string, Seg>; onChange: (a: At) => void; testid: string}) {
  const line = Math.min(at.segment, Math.max(0, lines.length - 1));
  const seg = segs.get(lines[line]);
  const words = useMemo(() => [...new Set((seg ? spokenOf(seg as never) : '').split(/\s+/).map(clean).filter(Boolean))], [seg]);
  const mode = at.word !== undefined ? 'word' : at.edge === 'end' ? 'end' : 'start';
  return (
    <span className="atctl">
      <select className="field" aria-label="Line of the scene" value={line} onChange={(e) => onChange({...at, segment: Number(e.target.value), ...(at.word !== undefined ? {word: undefined} : {})})} data-testid={`${testid}-line`}>
        {lines.map((id, i) => <option key={id} value={i}>Line {i + 1} · {short(segs.get(id)?.text ?? id, 34)}</option>)}
      </select>
      <select className="field" aria-label="Moment in the line" value={mode} onChange={(e) => {
        const m = e.target.value;
        const base = {segment: line};
        onChange(m === 'word' ? {...base, word: words[0] ?? ''} : {...base, edge: m as 'start' | 'end'});
      }} data-testid={`${testid}-mode`}>
        <option value="start">at the start</option><option value="end">at the end</option><option value="word">on the word…</option>
      </select>
      {mode === 'word' && (
        <select className="field" aria-label="The spoken word" value={String(at.word ?? '')} onChange={(e) => onChange({segment: line, word: e.target.value})} data-testid={`${testid}-word`}>
          {at.word !== undefined && !words.includes(String(at.word)) && <option value={String(at.word)}>{String(at.word)} (not in this line)</option>}
          {words.map((w) => <option key={w} value={w}>{w}</option>)}
        </select>
      )}
    </span>
  );
}

/** Fields for the Pip cards scene. Every control writes one parameter of the scene; the checks below them are the real ones. */
function PipCardsForm({scene, lines, segs, onChange}: {scene: Scene; lines: string[]; segs: Map<string, Seg>; onChange: (s: Scene) => void}) {
  const p = looseParams(scene);
  const set = (fn: (q: P) => P) => { const q = fn(structuredClone(p)); onChange({...scene, params: {...(q.title ? {title: q.title} : {}), cards: q.cards, actions: q.actions, idle: q.idle}} as Scene); };
  const layout = (scene.layout ?? {}) as {template?: string; captionZone?: string; mascot?: {mode?: string}};
  const setLayout = (patch: Record<string, unknown>) => onChange({...scene, layout: {...(scene.layout as object), ...patch}} as Scene);
  return (
    <div className="pcform" data-testid="pipcards-form">
      <label>Title <span className="muted small">(optional, up to 60 characters)</span>
        <input className="field" maxLength={60} value={p.title ?? ''} onChange={(e) => set((q) => ({...q, title: e.target.value || undefined}))} data-testid="pc-title" /></label>

      <fieldset className="srcpick"><legend>Cards <span className="muted small">(1 to 4)</span></legend>
        {p.cards.map((c, i) => (
          <div className="pcrow" key={i} data-testid={`pc-card-${i}`}>
            <b>Card {i + 1}</b>
            <input className="field" placeholder="Heading" maxLength={36} value={c.heading} aria-label={`Card ${i + 1} heading`} onChange={(e) => set((q) => { q.cards[i].heading = e.target.value; return q; })} data-testid={`pc-card-${i}-heading`} />
            <textarea className="field" rows={2} placeholder="Text (optional, up to 110 characters)" maxLength={110} value={c.body} aria-label={`Card ${i + 1} text`} onChange={(e) => set((q) => { q.cards[i].body = e.target.value; return q; })} data-testid={`pc-card-${i}-body`} />
            <label className="inl"><input type="checkbox" checked={!!c.at} onChange={(e) => set((q) => { if (e.target.checked) q.cards[i].at = {segment: Math.min(i, lines.length - 1), edge: 'start'}; else delete q.cards[i].at; return q; })} data-testid={`pc-card-${i}-timed`} /> Appears at a chosen moment <span className="muted small">(otherwise with line {Math.min(i, lines.length - 1) + 1})</span></label>
            {c.at && <AtControl at={c.at} lines={lines} segs={segs} onChange={(a) => set((q) => { q.cards[i].at = a; return q; })} testid={`pc-card-${i}-at`} />}
            {p.cards.length > 1 && <button type="button" className="linkish" onClick={() => set((q) => ({...q, cards: q.cards.filter((_, k) => k !== i), actions: q.actions.filter((a) => a.card === undefined || a.card !== i).map((a) => (a.card !== undefined && a.card > i ? {...a, card: a.card - 1} : a))}))} data-testid={`pc-card-${i}-remove`}>Remove card {i + 1}</button>}
          </div>
        ))}
        {p.cards.length < 4 && <button type="button" className="btn sm" onClick={() => set((q) => ({...q, cards: [...q.cards, {heading: '', body: ''}]}))} data-testid="pc-add-card">Add a card</button>}
      </fieldset>

      <fieldset className="srcpick"><legend>What Pip does <span className="muted small">(only these actions animate Pip; up to 8)</span></legend>
        {p.actions.length === 0 && <span className="muted small">No actions: Pip only breathes and sways{p.idle ? '' : ' (idle motion is off, so he stands still)'}.</span>}
        {p.actions.map((a, i) => (
          <div className="pcrow" key={i} data-testid={`pc-action-${i}`}>
            <b>Action {i + 1}</b>
            <select className="field" aria-label={`Action ${i + 1}`} value={a.do} onChange={(e) => set((q) => { const d = e.target.value as PipAction; q.actions[i].do = d; if (PIP_ACTION_INFO[d].needsCard) q.actions[i].card ??= 0; else delete q.actions[i].card; return q; })} data-testid={`pc-action-${i}-do`}>
              {PIP_ACTIONS.map((d) => <option key={d} value={d}>{PIP_ACTION_INFO[d].label}</option>)}
            </select>
            {PIP_ACTION_INFO[a.do]?.needsCard && (
              <select className="field" aria-label={`Card for action ${i + 1}`} value={a.card ?? 0} onChange={(e) => set((q) => { q.actions[i].card = Number(e.target.value); return q; })} data-testid={`pc-action-${i}-card`}>
                {p.cards.map((c, k) => <option key={k} value={k}>Card {k + 1}{c.heading ? ` · ${short(c.heading, 20)}` : ''}</option>)}
              </select>
            )}
            <AtControl at={a.at} lines={lines} segs={segs} onChange={(x) => set((q) => { q.actions[i].at = x; return q; })} testid={`pc-action-${i}-at`} />
            <span className="muted small">{PIP_ACTION_INFO[a.do]?.help}</span>
            <button type="button" className="linkish" onClick={() => set((q) => ({...q, actions: q.actions.filter((_, k) => k !== i)}))} data-testid={`pc-action-${i}-remove`}>Remove</button>
          </div>
        ))}
        {p.actions.length < 8 && <button type="button" className="btn sm" onClick={() => set((q) => ({...q, actions: [...q.actions, {do: 'nod', at: {segment: 0, edge: 'start'}}]}))} data-testid="pc-add-action">Add an action</button>}
        <label className="inl"><input type="checkbox" checked={p.idle} onChange={(e) => set((q) => ({...q, idle: e.target.checked}))} data-testid="pc-idle" /> Pip breathes and sways while nothing else happens</label>
      </fieldset>

      <fieldset className="srcpick"><legend>Layout</legend>
        <label>Template
          <select className="field" value={layout.template ?? 'content-led'} onChange={(e) => setLayout({template: e.target.value})} data-testid="pc-template">
            {PIP_CARDS_LAYOUTS.map((t) => <option key={t} value={t}>{LAYOUT_LABEL[t]}</option>)}
          </select></label>
        <label>Captions
          <select className="field" value={layout.captionZone ?? 'bottom'} onChange={(e) => setLayout({captionZone: e.target.value})} data-testid="pc-captions">
            <option value="bottom">Shown at the bottom</option><option value="off">Not shown in this scene</option>
          </select></label>
        <label className="inl"><input type="checkbox" checked={layout.mascot?.mode !== 'hidden'} onChange={(e) => setLayout({mascot: {...(scene.layout as {mascot?: object})?.mascot, mode: e.target.checked ? 'docked' : 'hidden'}})} data-testid="pc-pip-shown" /> Show Pip{layout.mascot?.mode === 'hidden' && p.actions.length > 0 ? ' (hidden: his actions show nothing)' : ''}</label>
      </fieldset>
    </div>
  );
}

/** The scene's parameters as raw JSON: the advanced way in, checked against the scene's own schema before it is taken. */
function Advanced({scene, onChange}: {scene: Scene; onChange: (s: Scene) => void}) {
  const text = JSON.stringify(scene.params ?? null, null, 2);
  const [t, setT] = useState(text);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { setT(text); setErr(null); }, [text]);
  const use = () => {
    let j: unknown;
    try { j = JSON.parse(t); } catch (e) { setErr(`Not valid JSON: ${(e as Error).message}`); return; }
    const r = SceneSchemaV2.safeParse({...scene, params: j});
    if (!r.success) { setErr(r.error.issues.slice(0, 4).map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')); return; }
    setErr(null); onChange(r.data);
  };
  return (
    <details className="adv"><summary data-testid="adv-toggle">Advanced: the scene's parameters as JSON</summary>
      <textarea className="field mono" rows={8} value={t} onChange={(e) => setT(e.target.value)} aria-label="Scene parameters (JSON)" data-testid="adv-json" />
      {err && <div className="errs" role="alert" data-testid="adv-error">{err}</div>}
      <div className="hrow"><button type="button" className="btn sm" onClick={use} data-testid="adv-use">Use this JSON</button><span className="muted small">It is checked against the scene type before it is taken; saving it is a separate step.</span></div>
    </details>
  );
}

function SceneCard({index, scene, draft, doc, plan, busy, onDraft, onSave, onDiscard}: {index: number; scene: Scene; draft: Draft | undefined; doc: EpisodeV2; plan: PlanDoc; busy: boolean; onDraft: (s: Scene) => void; onSave: () => void; onDiscard: () => void}) {
  const view = draft?.scene ?? scene;
  const segs = useMemo(() => new Map(doc.narration.segments.map((s) => [s.id, s])), [doc]);
  const check = useMemo(() => checkSceneInput({id: view.id, sceneType: view.type, segmentIds: view.segments, params: view.params as Record<string, unknown>, layout: view.layout}, segs, doc.style), [view, segs, doc.style]);
  const info = sceneTypeInfo(view.type);
  const planned = plan.storyboard.find((s) => s.id === view.id);
  return (
    <article className="card" data-testid={`escene-${view.id}`} data-state={check.state} data-kind={check.kind} data-dirty={draft ? 'yes' : 'no'}>
      <div className="chead">
        <b>Scene {index + 1}</b><span className="ctitle">{check.typeLabel}</span>
        <span className={`chip sm ${TONE[check.state]}`} data-testid="escene-state" title={STATE_LABEL[check.state]}>{STATE_LABEL[check.state]}</span>
        <span className={`chip sm ${check.kind === 'reusable' ? 'green' : check.kind === 'own-content' ? 'amber' : 'rose'}`} data-testid="escene-kind">{KIND_LABEL[check.kind]}</span>
        {draft && <span className="chip sm acc" data-testid="escene-unsaved">Unsaved changes</span>}
      </div>
      <ul className="segchips">{view.segments.map((id) => <li key={id} title={segs.get(id)?.text}>{id}</li>)}</ul>
      <div className="small muted">{info?.summary}</div>
      {view.type === 'pip-cards'
        ? <PipCardsForm scene={view} lines={view.segments} segs={segs} onChange={onDraft} />
        : <p className="small muted" data-testid="no-controls">This scene type has no field controls here: its content and look belong to the scene itself. {info?.reuse === 'own-content-only' ? 'It was built for one specific piece of narration. ' : ''}Its parameters can still be changed as JSON below.</p>}
      <ul className="blockers" data-testid="escene-problems">{check.blockers.map((b, k) => <li key={k}>{b}</li>)}</ul>
      {check.notes.length > 0 && <ul className="snotes">{check.notes.map((n, k) => <li key={k}>{n}</li>)}</ul>}
      {check.state === 'ready' && <div className="okline small" data-testid="escene-ok">Valid: the parameters, the cue words and the layout all check out.</div>}
      {planned && (planned.mechanism || planned.pip.length > 0 || planned.intention) && (
        <div className="plannotes" data-testid="planning-notes">
          <b>Planning notes from the storyboard</b> <span className="muted small">not connected to the animation: they draw nothing and move nobody. Pip does only what is listed under "What Pip does".</span>
          {planned.intention && <div className="small"><i>Intention:</i> {planned.intention}</div>}
          {planned.mechanism && <div className="small"><i>What is shown:</i> {planned.mechanism}</div>}
          {planned.pip.length > 0 && <div className="small"><i>Pip:</i> {planned.pip.join(' · ')}</div>}
        </div>
      )}
      <Advanced scene={view} onChange={onDraft} />
      <div className="hrow"><button className="btn sm pri" onClick={onSave} disabled={!draft || busy} data-testid={`escene-save-${view.id}`}>Save this scene</button>
        <button className="btn sm" onClick={onDiscard} disabled={!draft || busy} data-testid={`escene-discard-${view.id}`}>Discard changes</button>
        {!draft && <span className="muted small">Saved</span>}</div>
    </article>
  );
}

const ACTION_WORD: Record<string, string> = {run: 'would be rebuilt', reuse: 'would reuse a saved one', current: 'up to date'};

/** What a rebuild would do now, straight from the rebuild planner, plus what stands in the way of producing this episode. */
function Production({plan}: {plan: Plan | null | 'none'}) {
  if (plan === null) return <p className="muted small">Checking what a rebuild would do…</p>;
  if (plan === 'none') return <p className="muted small" data-testid="no-production">Rebuilds are not available in this session, so there is no production check to show.</p>;
  return (
    <div className="prod" data-testid="production-check" data-blockers={plan.blockers.length}>
      {plan.blockers.length === 0
        ? <div className="okline small" data-testid="preflight-ok">Production preflight: nothing stands in the way. This only checks the inputs; no narration or video has been made by this step.</div>
        : <div className="errs" data-testid="preflight-blockers"><b>Production preflight: not ready</b><ul>{plan.blockers.map((b, i) => <li key={i}>{b.message}</li>)}</ul></div>}
      <ul className="snotes" data-testid="rebuild-steps">{plan.steps.map((s) => <li key={s.key} data-action={s.action}>{s.label}: {ACTION_WORD[s.action] ?? s.action}</li>)}</ul>
      {plan.notes.filter((n) => /sound events/.test(n)).map((n, i) => <p key={i} className="muted small">{n}</p>)}
    </div>
  );
}

export function Scenes({plan, episodeSeq, hasEpisode, onStoryboard, onScript}: {plan: PlanDoc; episodeSeq: number | null; hasEpisode: boolean; onStoryboard: () => void; onScript: () => void}) {
  const id = plan.id;
  const [doc, setDoc] = useState<EpisodeV2 | null>(null);
  const [seq, setSeq] = useState(0);
  const [built, setBuilt] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [msg, setMsg] = useState<{tone: 'ok' | 'bad'; text: string} | null>(null);
  const [busy, setBusy] = useState(false);
  const [prod, setProd] = useState<Plan | null | 'none'>(null);

  const refreshProd = useCallback(async () => {
    const r = await getPlan(id).catch(() => null);
    setProd(r && r.status === 200 ? r.json : 'none');
  }, [id]);
  const load = useCallback(async () => {
    const r = await getEpisode(id);
    if (r.doc) { setDoc(r.doc); setSeq(r.seq); setBuilt(!!r.build); }
    void refreshProd();
  }, [id, refreshProd]);
  useEffect(() => { if (hasEpisode) void load(); }, [hasEpisode, load, episodeSeq]);

  const draftSceneIds = Object.keys(drafts);
  const est = useMemo((): {invalid?: string[]; error?: string; pv?: ReturnType<typeof estimatedPreview>} | null => {
    if (!doc || isPlaceholderEpisode(doc)) return null;
    const scenes = doc.scenes.map((s) => drafts[s.id]?.scene ?? s);
    // a scene whose parameters are not valid is never handed to the drawing code
    const invalid = scenes.filter((s) => !SceneSchemaV2.safeParse(s).success).map((s) => s.id);
    if (invalid.length) return {invalid};
    try { return {pv: estimatedPreview({...doc, scenes})}; } catch (e) { return {error: (e as Error).message}; }
  }, [doc, drafts]);

  if (!hasEpisode) {
    return <div className="research"><section className="card" data-testid="scenes-needs-script"><h3>Scenes are put against the script</h3><p>There is no episode yet. Accept a script first.</p><div className="hrow"><button className="btn sm pri" onClick={onScript}>Go to the script</button></div></section></div>;
  }
  if (!doc) return <div className="boot" role="status">Opening the scenes…</div>;
  if (isPlaceholderEpisode(doc)) {
    return (
      <div className="research">
        <section className="card" data-testid="scenes-standin"><h3>No scenes applied yet</h3>
          <p>The episode holds only its stand-in scene, so that its script can be edited and saved. The storyboard plans the real scenes; applying an accepted, complete storyboard puts them here, where their content and layout can be adjusted.</p>
          <div className="hrow"><button className="btn sm pri" onClick={onStoryboard} data-testid="go-storyboard">Go to the storyboard</button></div>
        </section>
        <Production plan={prod} />
      </div>
    );
  }

  const setDraft = (sc: Scene, base: Scene) => setDrafts((d) => ({...d, [sc.id]: {scene: sc, base: d[sc.id]?.base ?? canon(base)}}));
  const discard = (sid: string) => setDrafts((d) => { const {[sid]: _gone, ...rest} = d; return rest; });
  const save = async (sid: string) => {
    const dr = drafts[sid];
    if (!dr || !doc) return;
    setBusy(true); setMsg(null);
    // always merge into the newest version of the episode this tab knows, and refuse if this very scene changed under the draft
    const latest = await getEpisode(id);
    const cur = latest.doc.scenes.find((s) => s.id === sid);
    if (!cur || canon(cur) !== dr.base) {
      setDoc(latest.doc); setSeq(latest.seq);
      setBusy(false);
      setMsg({tone: 'bad', text: `Scene ${sid} was changed somewhere else after you started editing it, so nothing was saved. Your unsaved changes are still here; discard them to see the current version.`});
      return;
    }
    const next: EpisodeV2 = {...latest.doc, scenes: latest.doc.scenes.map((s) => (s.id === sid ? dr.scene : s))};
    const r = await saveEpisode(id, next, latest.seq, TAB_ID);
    setBusy(false);
    if (r.result.kind === 'ok') { discard(sid); await load(); setMsg({tone: 'ok', text: `Saved scene ${sid}. Only the outputs that depend on it are out of date; the list below says which.`}); return; }
    if (r.result.kind === 'conflict') { setDoc(r.result.current.doc as EpisodeV2); setSeq(r.result.current.seq); setMsg({tone: 'bad', text: 'The episode was saved somewhere else at the same moment, so nothing was saved. The current version is loaded; your unsaved changes are still here. Save again to apply them to it.'}); return; }
    setMsg({tone: 'bad', text: r.result.kind === 'invalid' || r.result.kind === 'failed' ? r.result.message : 'It could not be saved.'});
  };
  const sceneProblems = est?.pv?.problems ?? [];
  const setTypeface = async (style: 'pip-paper-bundled' | 'pip-paper') => {
    setBusy(true); setMsg(null);
    const latest = await getEpisode(id);
    const r = await saveEpisode(id, {...latest.doc, style}, latest.seq, TAB_ID);
    setBusy(false);
    if (r.result.kind === 'ok') { await load(); setMsg({tone: 'ok', text: style === 'pip-paper-bundled' ? 'Typeface set to the bundled fonts. The narration is unchanged; the video needs a rebuild.' : 'Typeface set to the system font stack (the prototype comparison). The narration is unchanged; the video needs a rebuild.'}); return; }
    if (r.result.kind === 'conflict') { setDoc(r.result.current.doc as EpisodeV2); setSeq(r.result.current.seq); setMsg({tone: 'bad', text: 'The episode was saved somewhere else at the same moment, so nothing was changed. Try again.'}); return; }
    setMsg({tone: 'bad', text: r.result.kind === 'invalid' || r.result.kind === 'failed' ? r.result.message : 'It could not be saved.'});
  };

  return (
    <div className="research scenesstep" data-testid="scenes-step" data-seq={seq}>
      <div className="plannote ok" data-testid="scenes-intro">
        <b>{doc.scenes.length} scene{doc.scenes.length === 1 ? '' : 's'} in this episode.</b> Each change is saved only when you press Save for that scene. A save is recorded like any other episode edit: History keeps versions at intervals, and always keeps one from before a storyboard is applied over scene work.
        <div className="small">Which scenes are reusable, which are tied to particular content and which need a developer is shown on each scene. The storyboard's own wording for Pip is kept as a planning note and never moves him.</div>
      </div>
      {msg && <div className={`plannote ${msg.tone === 'ok' ? 'ok' : 'warn'}`} role="status" data-testid="scenes-msg" data-tone={msg.tone}>{msg.text}</div>}

      {(doc.style === 'pip-paper' || doc.style === 'pip-paper-bundled') && (
        <section aria-label="Typeface" className="card" data-testid="typeface-card" data-style={doc.style}>
          <div className="chead"><h3>Typeface</h3><span className={`chip sm ${doc.style === 'pip-paper-bundled' ? 'green' : 'amber'}`} data-testid="typeface-chip">{doc.style === 'pip-paper-bundled' ? 'Bundled fonts (Inter, JetBrains Mono)' : 'System fonts (prototype comparison)'}</span></div>
          <p className="small muted">{doc.style === 'pip-paper-bundled' ? 'The video is drawn with the fonts that ship with the app (SIL OFL 1.1), so it looks the same on any machine. This is the setting for normal production.' : 'The video uses the system font stack (SF Pro where installed, otherwise another font), as the original prototype did. It differs from machine to machine, so use it only to compare with the prototype.'}{doc.scenes.some((s) => s.type === 'pip-scene-10x') ? ' The frozen prototype scene in this episode always draws its own system fonts.' : ''}</p>
          <div className="hrow">
            {doc.style === 'pip-paper-bundled'
              ? <button className="btn sm" disabled={busy} onClick={() => void setTypeface('pip-paper')} data-testid="typeface-system">Use the system fonts (prototype comparison)</button>
              : <button className="btn sm pri" disabled={busy} onClick={() => void setTypeface('pip-paper-bundled')} data-testid="typeface-bundled">Use the bundled fonts</button>}
          </div>
        </section>
      )}

      <section aria-label="Composition preview" className="card" data-testid="composition-preview">
        <div className="chead"><h3>Composition preview</h3><span className="chip sm amber" data-testid="preview-label">Estimated timing · no audio · not a build</span></div>
        <p className="small muted">{built ? 'This episode has a build, but this preview does not use it: ' : ''}The times are guessed from word counts, so the real timing will differ. Use it to check layout, wording and the order of cues, with your unsaved changes included. It never uses narration or a build, so it is not the finished video; the Review step shows that.</p>
        {est?.error && <div className="errs" role="alert" data-testid="preview-error">The preview could not be made: {est.error}</div>}
        {est?.invalid && <div className="plannote warn" data-testid="preview-paused">The preview is paused: {est.invalid.length === 1 ? 'scene' : 'scenes'} {est.invalid.join(', ')} {est.invalid.length === 1 ? 'has' : 'have'} parameters that are not valid yet (the problems are listed on the scene). It returns when they are.</div>}
        {sceneProblems.length > 0 && <div className="errs" data-testid="preview-problems"><ul>{sceneProblems.map((m, i) => <li key={i}>{m}</li>)}</ul></div>}
        {est?.pv && (
          <div className="scr small-player" data-testid="composition-player">
            <Player component={LibraryEpisode as never} inputProps={{episode: doc.id, variant: 'estimate', data: est.pv.data} as never}
              durationInFrames={Math.max(1, Math.ceil(est.pv.durationSec * FPS))} fps={FPS} compositionWidth={W} compositionHeight={H}
              style={{width: 270, height: 480}} controls
              errorFallback={({error}) => <div className="player-error">The preview could not draw this frame: {error.message}</div>} />
            <div className="small muted">About {Math.round(est.pv.durationSec)} s on the estimated clock.</div>
          </div>
        )}
      </section>

      {doc.scenes.map((s, i) => (
        <SceneCard key={s.id} index={i} scene={s} draft={drafts[s.id]} doc={doc} plan={plan} busy={busy} onDraft={(x) => setDraft(x, s)} onSave={() => void save(s.id)} onDiscard={() => discard(s.id)} />
      ))}

      <section className="card" aria-label="Production check" data-testid="production-section">
        <div className="chead"><h3>Is it ready to produce?</h3>{draftSceneIds.length > 0 && <span className="chip sm acc">Unsaved scene changes are not included</span>}</div>
        <Production plan={prod} />
      </section>
    </div>
  );
}
