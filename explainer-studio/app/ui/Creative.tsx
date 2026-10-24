// The creative checkpoint of one episode: hook options, the exact takeaway, claim-to-source evidence and the five-second opening
// animatic, read from fields the plan already has (hook options are "hook..." proposed-wording claims; the takeaway is the claim
// "takeaway"). The checks are advisory and never block a build; what Studio cannot judge is listed separately as guidance.
import {useCallback, useEffect, useMemo, useState} from 'react';
import type {EpisodeV2} from '../../src/schema2.ts';
import {HOOK_CLAIM, TAKEAWAY_CLAIM, creativeReport, type Tone} from '../shared/creative.ts';
import {HOOK_MAX, withHook} from '../shared/opening.ts';
import {nextId, withClaim, type PlanDoc} from '../shared/plan.ts';
import {TAB_ID, getEpisode, saveEpisode, startAnimatic, type AnimaticInfo} from './api';

const TONE: Record<Tone, {label: string; cls: string}> = {pass: {label: 'Done', cls: 'green'}, warn: {label: 'Look at', cls: 'amber'}, fail: {label: 'Missing', cls: 'rose'}, todo: {label: 'To do', cls: ''}};

export function Creative({id, plan, hasEpisode, commit, refreshKey}: {id: string; plan: PlanDoc; hasEpisode: boolean; commit: (p: PlanDoc, label: string) => Promise<string | null>; refreshKey?: unknown}) {
  const [doc, setDoc] = useState<EpisodeV2 | null>(null);
  const [seq, setSeq] = useState(0);
  const [animatic, setAnimatic] = useState<AnimaticInfo | null>(null);
  const [option, setOption] = useState('');
  const [tk, setTk] = useState({text: '', evidence: '', caveat: '', sourceIds: [] as string[]});
  const [msg, setMsg] = useState<{tone: 'ok' | 'bad'; text: string} | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!hasEpisode) return;
    const e = await getEpisode(id);
    setDoc(e.doc); setSeq(e.seq); setAnimatic(e.animatic ?? null);
  }, [id, hasEpisode]);
  useEffect(() => { void load(); }, [load, refreshKey]);
  useEffect(() => {
    if (animatic?.state !== 'running') return;
    const t = setInterval(() => void load(), 2000);
    return () => clearInterval(t);
  }, [animatic?.state, load]);

  const report = useMemo(() => creativeReport(plan, doc, animatic), [plan, doc, animatic]);
  const stored = plan.claims.find((c) => c.id === TAKEAWAY_CLAIM);
  useEffect(() => { if (stored) setTk({text: stored.text, evidence: stored.evidence, caveat: stored.caveat, sourceIds: stored.sourceIds}); }, [stored?.text, stored?.evidence, stored?.caveat, stored?.sourceIds.join(',')]);

  const hookIds = plan.claims.filter((c) => HOOK_CLAIM.test(c.id) && c.kind === 'proposed-wording');
  const addOption = async () => {
    const text = option.trim();
    if (!text) return;
    const used = new Set(plan.claims.map((c) => c.id));
    let n = hookIds.length + 1; while (used.has(`hook${n}`)) n++;
    setBusy(true); setMsg(null);
    const err = await commit(withClaim(plan, {id: `hook${n}`, text, kind: 'proposed-wording', sourceIds: [], evidence: '', caveat: '', provenance: null}), `added hook option hook${n}`);
    setBusy(false);
    if (err) setMsg({tone: 'bad', text: err}); else setOption('');
  };
  const useHook = async (text: string) => {
    if (!doc) return;
    setBusy(true); setMsg(null);
    const latest = await getEpisode(id);
    const r = await saveEpisode(id, withHook(latest.doc, text), latest.seq, TAB_ID);
    setBusy(false);
    if (r.result.kind === 'ok') { await load(); setMsg({tone: 'ok', text: 'The hook was saved. Narration and timing are reused; the video and the animatic are out of date.'}); }
    else setMsg({tone: 'bad', text: r.result.kind === 'invalid' || r.result.kind === 'failed' ? r.result.message : 'It could not be saved.'});
  };
  const saveTakeaway = async () => {
    if (!tk.text.trim()) return;
    setBusy(true); setMsg(null);
    const err = await commit(withClaim(plan, {id: TAKEAWAY_CLAIM, text: tk.text.trim(), kind: 'proposed-wording', sourceIds: tk.sourceIds, evidence: tk.evidence.trim(), caveat: tk.caveat.trim(), provenance: stored?.provenance ?? null}), 'edited the takeaway');
    setBusy(false);
    setMsg(err ? {tone: 'bad', text: err} : {tone: 'ok', text: 'The takeaway was saved in the plan. It changes nothing in the video until the last scene is edited to match.'});
  };
  const draw = async () => {
    setBusy(true); setMsg(null);
    const r = await startAnimatic(id);
    setBusy(false);
    if (r.status === 202) { setAnimatic(r.json.animatic); setMsg({tone: 'ok', text: 'Drawing the five-second animatic in the background; it needs no narration.'}); }
    else setMsg({tone: 'bad', text: r.json.message ?? 'It could not be started.'});
  };

  const nextHook = `hook${hookIds.length + 1}`;
  return (
    <section className="card" aria-label="Creative checkpoint" data-testid="creative-card">
      <div className="chead"><h3>Creative checkpoint</h3>
        <span className="chip sm green" data-testid="creative-pass">{report.counts.pass} done</span>
        {report.counts.warn + report.counts.fail > 0 && <span className="chip sm amber" data-testid="creative-attention">{report.counts.warn + report.counts.fail} to look at</span>}
        {report.counts.todo > 0 && <span className="chip sm" data-testid="creative-todo">{report.counts.todo} to do</span>}
      </div>
      <p className="small muted">Hook options, the exact takeaway, the evidence behind each claim and a five-second animatic, before any narration is made. These checks are advisory: nothing here blocks a build. The only enforced rule is the episode's own: a hook is at most {HOOK_MAX} characters.</p>

      <h4>Hook options</h4>
      <ul className="rows ro" data-testid="hook-options">
        {report.hookOptions.map((h) => (
          <li key={h.id} data-testid={`hook-option-${h.id}`} data-chosen={h.chosen ? 'yes' : 'no'}>
            <code>{h.id}</code> <b>{h.text}</b> <span className="muted small">{h.chars} characters · {h.words} words{h.issues.length ? ` · ${h.issues.join('; ')}` : ''}</span>
            {h.chosen ? <span className="chip sm green">In the video</span> : hasEpisode && h.chars <= HOOK_MAX && <button className="btn sm" disabled={busy} onClick={() => void useHook(h.text)} data-testid={`use-${h.id}`}>Use this hook</button>}
          </li>
        ))}
        {!report.hookOptions.length && <li className="muted small">No options yet. Record at least three, then choose one.</li>}
      </ul>
      <div className="hrow"><input className="field" value={option} maxLength={120} onChange={(e) => setOption(e.target.value)} placeholder={`Another option (${nextHook})`} data-testid="hook-option-input" /><button className="btn sm" disabled={busy || !option.trim()} onClick={() => void addOption()} data-testid="hook-option-add">Add option</button></div>

      <h4>The exact takeaway</h4>
      <label>What the last scene says<input className="field" value={tk.text} maxLength={300} onChange={(e) => setTk({...tk, text: e.target.value})} data-testid="takeaway-text" /></label>
      <label>What it was assessed against<textarea className="field" rows={2} value={tk.evidence} onChange={(e) => setTk({...tk, evidence: e.target.value})} data-testid="takeaway-evidence" /></label>
      <label>Where it stops applying<textarea className="field" rows={2} value={tk.caveat} onChange={(e) => setTk({...tk, caveat: e.target.value})} data-testid="takeaway-caveat" /></label>
      {plan.sources.length > 0 && <div className="hrow small" data-testid="takeaway-sources">Sources: {plan.sources.map((s) => (
        <label key={s.id} className="inline"><input type="checkbox" checked={tk.sourceIds.includes(s.id)} onChange={(e) => setTk({...tk, sourceIds: e.target.checked ? [...tk.sourceIds, s.id] : tk.sourceIds.filter((x) => x !== s.id)})} /> <code>{s.id}</code> {s.title.slice(0, 40)}</label>
      ))}</div>}
      <div className="hrow"><button className="btn sm" disabled={busy || !tk.text.trim()} onClick={() => void saveTakeaway()} data-testid="takeaway-save">Save the takeaway</button></div>

      <h4>Five-second opening animatic</h4>
      <div className="hrow"><span className={`chip sm ${animatic?.state === 'fresh' ? 'green' : animatic?.state === 'outdated' ? 'amber' : ''}`} data-testid="animatic-state">{animatic?.state === 'fresh' ? 'Matches this version' : animatic?.state === 'outdated' ? 'Out of date' : animatic?.state === 'running' ? 'Drawing' : 'Not drawn'}</span>
        <span className="chip sm amber">Estimated clock · silent · not a build</span><span className="spacer" />
        <button className="btn sm" disabled={busy || !hasEpisode || animatic?.state === 'running'} onClick={() => void draw()} data-testid="animatic-draw">{animatic?.artifactId ? 'Draw it again' : 'Draw the animatic'}</button></div>
      {animatic?.artifactId && animatic.state !== 'running' && <video className="animatic" controls playsInline preload="metadata" src={`/media/animatic/${id}/opening.mp4?v=${animatic.artifactId}`} data-testid="animatic-video" style={{height: 420, width: 'auto', maxWidth: '100%', aspectRatio: '9 / 16', borderRadius: 12, background: '#000'}} />}
      {!hasEpisode && <p className="muted small">The animatic is drawn once the episode has a script and scenes.</p>}

      {msg && <div className={`plannote ${msg.tone === 'ok' ? 'ok' : 'warn'}`} role="status" data-testid="creative-msg" data-tone={msg.tone}>{msg.text}</div>}

      <h4>Checks Studio runs</h4>
      <ul className="rows ro" data-testid="creative-checks">
        {report.items.map((i) => <li key={i.id} data-testid={`check-${i.id}`} data-status={i.status}><span className={`chip sm ${TONE[i.status].cls}`}>{TONE[i.status].label}</span> <b>{i.title}</b> <span className="muted small">{i.detail}</span></li>)}
      </ul>
      <h4>Guidance Studio does not check</h4>
      <ul className="rows ro" data-testid="creative-guidance">{report.guidance.map((g, i) => <li key={i} className="small">{g}</li>)}</ul>
      <p className="muted small">Episode seq {seq}.</p>
    </section>
  );
}
