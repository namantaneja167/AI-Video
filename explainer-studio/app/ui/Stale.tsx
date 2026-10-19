import {useEffect, useRef} from 'react';
import {fmtEstimate, fmtSec, totalEstimate, type NotBuilt, type StaleItem} from '../shared/costs.ts';

export type StaleView = {
  lines: string[];
  /** null while edits are unsaved: the list comes from the saved version, so it is not guessed. */
  items: {stale: StaleItem[]; notBuilt: NotBuilt[]} | null;
  saveKind: string;
};

export function StalePopover({view, onClose, onRebuild}: {view: StaleView; onClose: () => void; onRebuild?: () => void}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const t = view.items ? totalEstimate(view.items.stale) : null;
  return (
    <div className="popover" role="dialog" aria-label="What is out of date" tabIndex={-1} ref={ref} data-testid="stale-popover">
      <div className="pophead"><b>What is out of date</b><button className="btn sm" onClick={onClose}>Close</button></div>
      <h4>Changed since the last build</h4>
      {view.lines.length ? <ul>{view.lines.map((l) => <li key={l}>{l}</li>)}</ul> : <p className="muted">Nothing. The episode is as it was built.</p>}
      <h4>Outputs to rebuild</h4>
      {!view.items && <p className="muted">This list is worked out from the saved version, so it appears once your edits are saved ({view.saveKind === 'saving' ? 'saving now' : 'not saved yet'}).</p>}
      {view.items && view.items.stale.length === 0 && <p className="muted">Nothing built is out of date.</p>}
      {view.items && view.items.stale.length > 0 && (
        <table className="stale-table">
          <thead><tr><th>Output</th><th>Why</th><th>Cost to rebuild</th></tr></thead>
          <tbody>{view.items.stale.map((s) => (
            <tr key={s.key} data-testid="stale-row"><td>{s.label}</td><td>{s.why.join('; ')}</td><td>{fmtEstimate(s.estimate)}</td></tr>
          ))}</tbody>
        </table>
      )}
      {t && view.items && view.items.stale.length > 0 && (
        <p className="total" data-testid="stale-total">
          {t.known ? <>Measured items add up to about {fmtSec(t.minSec)}{t.maxSec !== t.minSec ? ` to ${fmtSec(t.maxSec)}` : ''} (estimate)</> : <>No cost is measured for these</>}
          {t.unknown ? `; ${t.unknown} not measured, so the total is not complete.` : '.'}
        </p>
      )}
      {view.items && view.items.notBuilt.length > 0 && <p className="muted">Never built here: {view.items.notBuilt.map((n) => n.label).join(', ')}. Cost to build: Not measured.</p>}
      <p className="muted small">Estimates come only from durations measured in earlier runs. Nothing starts until you choose Rebuild and confirm.</p>
      {onRebuild && <p><button className="btn pri sm" onClick={onRebuild} data-testid="popover-rebuild">Rebuild…</button></p>}
    </div>
  );
}
