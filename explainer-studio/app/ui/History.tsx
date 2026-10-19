import {useState} from 'react';
import type {BuildSummary, RevisionDetail, RevisionRow} from './api';
import {when, whenShort} from './labels';

export type HistoryProps = {
  revisions: RevisionRow[] | null;
  builds: BuildSummary[];
  /** Why restoring is not possible right now (unsaved edits, conflict, ...), or null. */
  restoreBlocked: string | null;
  loadDetail: (n: number) => Promise<RevisionDetail>;
  onRestore: (n: number) => Promise<string | null>;
  onPreviewBuild: (id: string | null) => void;
  onClose: () => void;
  message: string | null;
};

function RevisionItem({r, props}: {r: RevisionRow; props: HistoryProps}) {
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<RevisionDetail | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const toggle = async () => {
    const next = !open;
    setOpen(next);
    if (next && !detail) setDetail(await props.loadDetail(r.number));
  };
  return (
    <li className={`rev ${r.isCurrent ? 'cur' : ''}`} data-revision={r.number} data-testid="revision-row">
      <div className="rvh">
        <b>r{r.number}</b><span className="muted small">{whenShort(r.createdAt)}</span><span className="chip sm">{r.kindLabel}</span>
        {r.isCurrent && <span className="chip sm green">Current text</span>}
        {r.builds.length > 0 && <span className="chip sm acc" title={`Outputs built from this revision: ${r.builds.join(', ')}`}>Has a build</span>}
      </div>
      <div className="rvs">{r.short}</div>
      <div className="rva">
        <button className="linkish small" onClick={toggle} aria-expanded={open}>{open ? 'Hide' : 'Inspect'}</button>
        {!r.isCurrent && <button className="linkish small" disabled={!!props.restoreBlocked} title={props.restoreBlocked ?? undefined} onClick={() => setConfirm(true)}>Restore…</button>}
      </div>
      {open && (
        <div className="rvd">
          {!detail && <span className="muted small">Loading…</span>}
          {detail && (
            <>
              <div className="muted small">{when(detail.createdAt)}{detail.label && detail.kind !== 'restore' ? ` · ${detail.label}` : ''}</div>
              <ul className="lines">{detail.summary.length ? detail.summary.map((l) => <li key={l}>{l}</li>) : <li>No change to the text</li>}</ul>
              {!r.isCurrent && detail.ifRestored.length > 0 && <div className="small"><b>If restored:</b> {detail.ifRestored.join('; ')}.</div>}
              <ol className="segtext">{detail.segments.map((s) => <li key={s.id}><span className="mono">{s.id}</span> {s.text}{s.speech ? <em> (spoken: {s.speech})</em> : null}</li>)}</ol>
            </>
          )}
        </div>
      )}
      {confirm && (
        <div className="confirm" role="alertdialog" aria-label={`Restore revision r${r.number}`}>
          <b>Restore r{r.number}?</b>
          <span>Its text becomes the current text, saved as a new revision. Later revisions, builds and takes are kept. Nothing is rebuilt until you choose Rebuild.</span>
          {err && <span className="jerr">{err}</span>}
          <span className="acts">
            <button className="btn sm" onClick={() => { setConfirm(false); setErr(null); }}>Cancel</button>
            <button className="btn sm pri" disabled={busy} data-testid="restore-confirm" onClick={async () => { setBusy(true); const m = await props.onRestore(r.number); setBusy(false); if (m) setErr(m); else setConfirm(false); }}>Restore</button>
          </span>
        </div>
      )}
    </li>
  );
}

export function HistoryPanel(props: HistoryProps) {
  const [tab, setTab] = useState<'revisions' | 'builds'>('revisions');
  return (
    <aside className="drawer" aria-label="History" data-testid="history-panel">
      <div className="dh"><b>History</b><span className="seg-tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'revisions'} className={tab === 'revisions' ? 'on' : ''} onClick={() => setTab('revisions')}>Revisions</button>
        <button role="tab" aria-selected={tab === 'builds'} className={tab === 'builds' ? 'on' : ''} onClick={() => setTab('builds')}>Builds</button>
      </span><span className="spacer" /><button className="btn sm" onClick={props.onClose}>Close</button></div>
      {props.message && <div className="inline ok" role="status">{props.message}</div>}
      {props.restoreBlocked && tab === 'revisions' && <div className="inline warn">{props.restoreBlocked}</div>}
      <div className="dbody">
        {tab === 'revisions' && (props.revisions === null ? <p className="muted pad">Loading…</p> : <ul className="revlist">{props.revisions.map((r) => <RevisionItem key={r.number} r={r} props={props} />)}</ul>)}
        {tab === 'builds' && (
          <ul className="revlist">
            {props.builds.length === 0 && <li className="pad muted">Nothing has been built yet.</li>}
            {props.builds.map((b) => (
              <li key={b.id} className={`rev ${b.shown ? 'cur' : ''}`} data-build={b.id} data-testid="build-row">
                <div className="rvh">
                  <b>Build r{b.revision ?? '?'}</b><span className="muted small">{whenShort(b.builtAt)}</span>
                  {b.isLatest && <span className="chip sm green">Current build</span>}
                  {b.shown && <span className="chip sm acc">Shown</span>}
                  {b.imported && <span className="chip sm" title={b.imported.note}>Imported sample</span>}
                  {b.hasFinalVideo ? <span className="chip sm">Final video</span> : <span className="chip sm">No final video</span>}
                  {b.outdatedFlag && <span className="chip sm amber" title="It finished after the text had already changed">Made from older text</span>}
                </div>
                <div className="rva">{!b.shown && <button className="linkish small" onClick={() => props.onPreviewBuild(b.isLatest ? null : b.id)}>Preview this build</button>}</div>
              </li>
            ))}
            <li className="pad muted small">Each build keeps its own timeline, audio and video. A rebuild that fails or is cancelled never replaces an earlier build.</li>
          </ul>
        )}
      </div>
    </aside>
  );
}
