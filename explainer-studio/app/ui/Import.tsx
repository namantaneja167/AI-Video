// Taking a ChatGPT answer back in. The handoff panel writes a brief the author copies by hand; the dialog reads what they
// paste or open, shows it as Proposed, and changes nothing until they accept it. Every request goes to this app's own
// server; nothing here contacts any other service. Imported text is shown as plain text and is never acted on.
import {useEffect, useMemo, useRef, useState} from 'react';
import {BRIEF_LABEL, type BriefKind} from '../shared/handoff.ts';
import {defaultSelection, planImport, type Selection} from '../shared/importing.ts';
import {SHAPE_LABEL, addRowAfter, mergeUp, removeRow, setRowText, splitAt, type ParseError, type ProposedSegment} from '../shared/packet.ts';
import {CLAIM_LABEL} from '../shared/plan.ts';
import {sceneTypeInfo} from '../shared/storyboard.ts';
import type {ImportRow} from '../planning.ts';
import {acceptImport, getImportPayload, rejectImport, submitImport, type ImportPayload} from './api';
import {whenShort} from './labels';
import {useModal} from './useModal';

const short = (h: string) => h.slice(0, 12);

export function ProvenanceChip({p}: {p: {importId: number; sha256: string; at: number; source: string} | null}) {
  if (!p) return <span className="chip sm" title="Written by you in this app">Yours</span>;
  return <span className="chip sm acc" title={`Imported from ${p.source} on ${whenShort(p.at)}. Content hash ${p.sha256}`} data-testid="provenance">Import #{p.importId} · {p.source} · {whenShort(p.at)} · {short(p.sha256)}</span>;
}

/** The text to copy into ChatGPT, and the way back. */
export function Handoff({kind, text, pending, onImport, onReview}: {kind: BriefKind; text: string; pending: ImportRow[]; onImport: () => void; onReview: (n: number) => void}) {
  const [copied, setCopied] = useState<'yes' | 'blocked' | null>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  const copy = async () => {
    try { await navigator.clipboard.writeText(text); setCopied('yes'); } catch { area.current?.select(); setCopied('blocked'); }
  };
  return (
    <section className="handoff" aria-label={`${BRIEF_LABEL[kind]} brief for ChatGPT`} data-testid={`handoff-${kind}`}>
      <h3>Ask ChatGPT for the {BRIEF_LABEL[kind].toLowerCase()}</h3>
      <p className="muted small">This writes text and nothing else: nothing is sent anywhere. Copy it, paste it into ChatGPT in your own browser, then bring the answer back with Import.</p>
      <textarea ref={area} className="field mono" readOnly rows={7} value={text} aria-label={`${BRIEF_LABEL[kind]} brief`} data-testid="brief-text" onFocus={(e) => e.currentTarget.select()} />
      <div className="hrow">
        <button className="btn sm" onClick={() => void copy()} data-testid="copy-brief">Copy brief</button>
        <button className="btn sm pri" onClick={onImport} data-testid="open-import">Import a ChatGPT answer…</button>
        <span className="muted small" role="status">{copied === 'yes' ? 'Copied.' : copied === 'blocked' ? 'The browser did not allow copying; the text is selected, so press Cmd+C.' : ''}</span>
      </div>
      {pending.length > 0 && (
        <div className="pending" data-testid="pending-imports">
          <b>Waiting for your decision</b>
          <ul>{pending.map((i) => <li key={i.id}>#{i.id} · {SHAPE_LABEL[i.shape]} · {i.sourceName ?? (i.via === 'file' ? 'file' : 'pasted text')} · {whenShort(i.createdAt)} <button className="linkish" onClick={() => onReview(i.id)} data-testid={`review-import-${i.id}`}>Review</button></li>)}</ul>
        </div>
      )}
    </section>
  );
}

type Props = {planId: string; importId: number | null; onClose: () => void; onDone: (summary: string[]) => void; onChanged: () => void};

export function ImportDialog({planId, importId, onClose, onDone, onChanged}: Props) {
  const [text, setText] = useState('');
  const [via, setVia] = useState<'paste' | 'file'>('paste');
  const [fileName, setFileName] = useState<string | null>(null);
  const [errors, setErrors] = useState<ParseError[] | null>(null);
  const [data, setData] = useState<ImportPayload | null>(null);
  const [busy, setBusy] = useState(importId !== null);
  const [message, setMessage] = useState<string | null>(null);
  const [sel, setSel] = useState<Selection | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const cells = useRef<(HTMLTextAreaElement | null)[]>([]);

  const load = async (n: number, keep = false) => {
    setBusy(true);
    const r = await getImportPayload(planId, n);
    setBusy(false);
    if (r.status !== 200) { setMessage(r.json.message ?? 'That import could not be opened.'); return; }
    setData(r.json);
    if (!keep) { setSel(defaultSelection(r.json.import.proposal)); setConfirmed(false); }
  };
  useEffect(() => { if (importId !== null) void load(importId); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const readFile = async (f: File | undefined) => {
    if (!f) return;
    setText(await f.text());
    setFileName(f.name);
    setVia('file');
    setErrors(null);
  };
  const check = async () => {
    setBusy(true); setMessage(null); setErrors(null);
    const r = await submitImport(planId, text, via, fileName ?? undefined);
    setBusy(false);
    if (r.status === 201) { setData(r.json); setSel(defaultSelection(r.json.import.proposal)); setConfirmed(false); onChanged(); }
    else if (r.status === 422) setErrors(r.json.errors ?? [{path: '(input)', message: r.json.message ?? 'This could not be read.'}]);
    else setMessage(r.json.message ?? 'The import could not be checked.');
  };

  const imp = data?.import ?? null;
  const proposed = imp?.state === 'proposed';
  const selection: Selection | null = sel && {...sel, confirmReplace: confirmed};
  const planned = useMemo(() => (data && imp && selection ? planImport({plan: data.plan, episode: data.episode, proposal: imp.proposal, selection, meta: {importId: imp.id, sha256: imp.sha256, at: imp.createdAt, source: imp.sourceName ?? (imp.via === 'file' ? 'file' : 'pasted text')}}) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data, sel, confirmed]);
  const preview = planned?.preview ?? null;

  const accept = async () => {
    if (!data || !imp || !selection) return;
    setBusy(true); setMessage(null);
    const r = await acceptImport(planId, imp.id, selection, data.planSeq, data.episode?.seq ?? null);
    setBusy(false);
    if (r.status === 200) { onDone(r.json.summary ?? []); onClose(); return; }
    if (r.status === 409 && r.json.error === 'conflict') { setMessage('This was changed somewhere else since you opened it. Nothing was accepted. The current state is shown; check it and accept again.'); await load(imp.id, true); onChanged(); return; }
    setMessage(r.json.message ?? 'It could not be accepted.');
  };
  const reject = async () => {
    if (!imp) return;
    setBusy(true);
    const r = await rejectImport(planId, imp.id);
    setBusy(false);
    if (r.status === 200) { onChanged(); onClose(); } else setMessage(r.json.message ?? 'It could not be rejected.');
  };

  const modalRef = useModal(onClose);
  const setRows = (rows: ProposedSegment[] | null) => setSel((s) => s && {...s, script: rows});
  const toggle = (key: 'sources' | 'claims', i: number) => setSel((s) => s && {...s, [key]: s[key].includes(i) ? s[key].filter((x) => x !== i) : [...s[key], i].sort((a, b) => a - b)});

  return (
    <div className="scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="dialog wide" role="dialog" aria-modal="true" aria-label="Import a ChatGPT answer" data-testid="import-dialog" ref={modalRef}>
        <div className="dhead">
          <div><h2>{imp ? `Import #${imp.id}` : 'Import a ChatGPT answer'}</h2><p className="muted small">{imp ? 'Nothing is part of the episode until you accept it. Text from ChatGPT is only ever read as data: any instruction inside it is not followed.' : 'Paste the answer, or open a saved file. It is read on this computer; nothing is fetched, opened or sent anywhere.'}</p></div>
          <button className="btn sm" onClick={onClose} data-testid="import-close">Close</button>
        </div>

        {!imp && (
          <div className="impin">
            <textarea className="field mono" rows={11} value={text} onChange={(e) => { setText(e.target.value); setVia('paste'); setFileName(null); setErrors(null); }} placeholder="Paste JSON, Markdown with a JSON block, or a plain script" aria-label="Pasted ChatGPT answer" data-testid="import-text" />
            <div className="hrow">
              <label className="btn sm">Open a file…<input type="file" hidden accept=".json,.md,.markdown,.txt,text/plain,application/json,text/markdown" onChange={(e) => void readFile(e.target.files?.[0])} data-testid="import-file" /></label>
              {fileName && <span className="chip sm">{fileName}</span>}
              <span className="spacer" />
              <button className="btn sm pri" disabled={busy || !text.trim()} onClick={() => void check()} data-testid="import-check">Check it</button>
            </div>
            {errors && (
              <div className="errs" role="alert" data-testid="import-errors">
                <b>Nothing was imported.</b> {errors.length === 1 ? 'There is one problem:' : `There are ${errors.length} problems:`}
                <ul>{errors.map((e, i) => <li key={i}><code>{e.path}</code> {e.message}</li>)}</ul>
                <span className="muted small">Fix the answer (or ask ChatGPT to correct exactly these lines) and check it again. Your pasted text is still here.</span>
              </div>
            )}
          </div>
        )}
        {message && <div className="errs" role="alert" data-testid="import-message">{message}</div>}

        {imp && sel && preview && data && (
          <div className="impre">
            <div className="hrow wrap">
              <span className={`chip ${proposed ? 'amber' : imp.state === 'accepted' ? 'green' : ''}`} data-testid="import-state">{proposed ? 'Proposed' : imp.state === 'accepted' ? 'Accepted' : 'Not accepted'}</span>
              <span className="chip sm">{SHAPE_LABEL[imp.shape]}</span>
              <span className="chip sm" title={imp.sha256}>sha256 {short(imp.sha256)}</span>
              <span className="chip sm">{imp.sourceName ?? (imp.via === 'file' ? 'file' : 'pasted text')} · {whenShort(imp.createdAt)}</span>
            </div>
            {imp.proposal.notes.length > 0 && <ul className="pnotes">{imp.proposal.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>}
            {imp.result && <p className="muted small" data-testid="import-result">{imp.result.summary.join('. ')}.</p>}

            {imp.proposal.sources.length > 0 && (
              <section className="imp-sec" data-testid="sec-sources"><h3>Sources <span className="muted small">{imp.proposal.sources.length}</span></h3>
                <ul>{imp.proposal.sources.map((s, i) => {
                  const pv = preview.sources.find((x) => x.index === i);
                  return (
                    <li key={i}><label><input type="checkbox" disabled={!proposed} checked={sel.sources.includes(i)} onChange={() => toggle('sources', i)} data-testid={`pick-source-${i}`} /> <b>{s.title}</b></label>
                      <div className="small muted">{[s.publisher, s.published, s.url].filter(Boolean).join(' · ') || 'no link or date given'}{s.url ? ' · link recorded only: not fetched, not verified' : ''}</div>
                      {s.note && <div className="small">{s.note}</div>}
                      {pv?.action === 'already-recorded' && <div className="small warnline">Already recorded as {pv.matches}; it will not be added again.</div>}
                    </li>
                  );
                })}</ul>
              </section>
            )}

            {imp.proposal.claims.length > 0 && (
              <section className="imp-sec" data-testid="sec-claims"><h3>Claims <span className="muted small">{imp.proposal.claims.length}</span></h3>
                <ul>{imp.proposal.claims.map((c, i) => {
                  const pv = preview.claims.find((x) => x.index === i);
                  return (
                    <li key={i}><label><input type="checkbox" disabled={!proposed} checked={sel.claims.includes(i)} onChange={() => toggle('claims', i)} data-testid={`pick-claim-${i}`} /> <span className={`chip sm ${c.kind === 'fact' ? 'green' : c.kind === 'assumption' ? 'amber' : ''}`}>{CLAIM_LABEL[c.kind]}</span> {c.text}</label>
                      {c.evidence && <div className="small muted">Evidence: {c.evidence}</div>}
                      {c.caveat && <div className="small muted">Caveat: {c.caveat}</div>}
                      {pv && pv.lostLinks.length > 0 && <div className="small warnline">It points at source{pv.lostLinks.length === 1 ? '' : 's'} {pv.lostLinks.map((n) => n + 1).join(', ')} of this import, which you did not select, so that link is dropped.</div>}
                    </li>
                  );
                })}</ul>
              </section>
            )}

            {imp.proposal.script && (
              <section className="imp-sec" data-testid="sec-script"><h3>Script <span className="muted small">{sel.script ? `${sel.script.length} segments` : 'not accepted'}</span></h3>
                {proposed && <label className="small"><input type="checkbox" checked={!!sel.script} onChange={(e) => setRows(e.target.checked ? imp.proposal.script!.map((r) => ({...r})) : null)} data-testid="pick-script" /> Accept this script{data.episode ? ' in place of the current one' : ' and create the episode from it'}</label>}
                {sel.script && (
                  <ol className="rows" data-testid="script-rows">
                    {sel.script.map((r, i) => {
                      const spare = data.episode ? data.episode.doc.narration.segments[i] : undefined;
                      const change = !data.episode ? null : spare && spare.text === r.text.trim() ? 'same' : spare ? 'changed' : 'new';
                      return (
                        <li key={i} data-testid={`seg-row-${i}`}>
                          <textarea ref={(el) => { cells.current[i] = el; }} className="field" rows={2} value={r.text} disabled={!proposed} aria-label={`Segment ${i + 1}`} onChange={(e) => setRows(setRowText(sel.script!, i, e.target.value))} />
                          <div className="rowtools">
                            {r.flags?.map((f) => <span key={f} className="chip sm amber">{f === 'long' ? 'long: consider splitting' : 'short'}</span>)}
                            {change && <span className={`chip sm ${change === 'same' ? 'green' : 'amber'}`}>{change === 'same' ? 'same as now' : change === 'changed' ? 'differs from now' : 'new'}</span>}
                            {proposed && <>
                              <button className="linkish" disabled={i === 0} onClick={() => setRows(mergeUp(sel.script!, i))} data-testid={`merge-${i}`}>Join with the one above</button>
                              <button className="linkish" onClick={() => setRows(splitAt(sel.script!, i, cells.current[i]?.selectionStart ?? 0))} data-testid={`split-${i}`}>Split at the cursor</button>
                              <button className="linkish" onClick={() => setRows(addRowAfter(sel.script!, i))}>Add below</button>
                              <button className="linkish" onClick={() => setRows(removeRow(sel.script!, i))} data-testid={`remove-${i}`}>Remove</button>
                            </>}
                          </div>
                        </li>
                      );
                    })}
                  </ol>
                )}
                {preview.script.rows.filter((x) => x.change === 'removed').length > 0 && <div className="small warnline">Lines that would be removed: {preview.script.rows.filter((x) => x.change === 'removed').map((x) => `${x.id} “${x.before}”`).join(' · ')}</div>}
                {preview.script.mode === 'blocked' && <div className="errs">{preview.script.blocked}</div>}
              </section>
            )}

            {imp.proposal.storyboard && (
              <section className="imp-sec" data-testid="sec-storyboard"><h3>Storyboard <span className="muted small">{imp.proposal.storyboard.length} planned scenes</span></h3>
                {proposed && <label className="small"><input type="checkbox" checked={sel.storyboard} onChange={(e) => setSel((s) => s && {...s, storyboard: e.target.checked})} data-testid="pick-storyboard" /> Accept this storyboard{data.plan.storyboard.length ? ` (replaces the ${data.plan.storyboard.length} planned scene${data.plan.storyboard.length === 1 ? '' : 's'} now in the plan)` : ''}</label>}
                <ol className="rows">{imp.proposal.storyboard.map((s, i) => {
                  const info = sceneTypeInfo(s.sceneType);
                  return (
                    <li key={i}><b>Scene {i + 1}</b> · segment{s.segments.length === 1 ? '' : 's'} {s.segments.join(', ')} · <span className={`chip sm ${info && info.reuse === 'data-driven' ? 'green' : 'amber'}`}>{info?.label ?? `${s.sceneType} (not a scene type this app has)`}</span>{s.params ? <span className="chip sm green" title="Checked against the scene type when the text was read">parameters given and valid</span> : <span className="chip sm">no parameters</span>}
                      {s.intention && <div className="small">Intention: {s.intention}</div>}
                      {s.mechanism && <div className="small">Shows: {s.mechanism}</div>}
                      {s.pip.length > 0 && <div className="small">Pip: {s.pip.join(' · ')}</div>}
                    </li>
                  );
                })}</ol>
                <p className="muted small">A storyboard is a plan. Nothing is built from it automatically; the Storyboard step shows for each scene whether it is ready, incomplete, custom or of an unsupported type.</p>
              </section>
            )}

            {proposed && preview.confirm.length > 0 && (
              <div className="confirm" data-testid="confirm-box">
                {preview.confirm.map((c, i) => <div key={i}>{c}</div>)}
                <label><input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} data-testid="confirm-replace" /> I have seen what is replaced and want to go ahead.</label>
              </div>
            )}
            {proposed && preview.problems.length > 0 && <div className="errs" role="alert" data-testid="import-problems"><ul>{preview.problems.map((p, i) => <li key={i}>{p}</li>)}</ul></div>}

            <details className="orig"><summary>Original text, exactly as imported</summary><pre data-testid="import-original">{imp.content}</pre></details>

            {proposed && (
              <div className="hrow end">
                <button className="btn sm" onClick={() => void reject()} disabled={busy} data-testid="import-reject">Reject this import</button>
                <button className="btn sm" onClick={onClose} data-testid="import-later">Decide later</button>
                <button className="btn sm pri" onClick={() => void accept()} disabled={busy || preview.problems.length > 0 || (preview.confirm.length > 0 && !confirmed)} data-testid="import-accept">Accept what is selected</button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
