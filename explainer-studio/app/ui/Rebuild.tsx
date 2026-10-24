import {useModal} from './useModal';
import {fmtEstimate, fmtSec} from '../shared/costs.ts';
import type {Plan, PlanStep} from '../shared/plan-types.ts';

const ACTION: Record<PlanStep['action'], {label: string; cls: string}> = {
  run: {label: 'Will run', cls: 'amber'},
  reuse: {label: 'Reuse saved result', cls: 'green'},
  current: {label: 'Already up to date', cls: ''},
};

export type PlanState = {open: boolean; plan: Plan | null; loading: boolean; message: string | null; starting: boolean; /** Known before the plan arrives, so the dialog says the right thing while it loads. */ mode?: 'draft' | 'final'};

export function PlanDialog({state, onStart, onClose, onOpenSegment}: {state: PlanState; onStart: () => void; onClose: () => void; onOpenSegment: (id: string) => void}) {
  const ref = useModal(onClose);
  const plan = state.plan;
  const runs = plan?.steps.filter((s) => s.action === 'run') ?? [];
  const reuse = plan?.steps.filter((s) => s.action === 'reuse') ?? [];
  const blocked = (plan?.blockers.length ?? 0) > 0;
  const t = plan?.total;
  const draft = (plan?.mode ?? state.mode ?? 'final') === 'draft';
  const canStart = !!plan && !blocked && !plan.nothingToDo && !plan.active && !state.starting && !state.loading;
  return (
    <div className="scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="dialog" role="dialog" aria-modal="true"  aria-label={draft ? 'Make a draft video' : 'Rebuild this episode'} tabIndex={-1} ref={ref} data-testid="plan-dialog">
        <div className="dhead">
          <div><h2>{draft ? 'Make a draft video' : 'Rebuild this episode'}</h2><p className="muted">{draft ? 'Makes a draft video for review from your saved text' : 'Makes the final video from your saved text'}{plan ? ` (saved version ${plan.seq})` : ''}. {draft ? 'Its audio is the unmastered mix: a draft can be reviewed, but it can never be approved or exported. ' : ''}You can keep editing while it runs.</p></div>
          <button className="btn sm" onClick={onClose}>Close</button>
        </div>
        {state.loading && <p className="muted" role="status">Working out what needs to run…</p>}
        {state.message && <div className="inline bad" role="alert" data-testid="plan-message">{state.message}</div>}
        {plan?.active && <div className="inline warn" role="status">A rebuild is already in progress ({plan.active.description}). Wait for it or cancel it from Jobs.</div>}
        {plan && blocked && (
          <div className="inline bad" role="alert" data-testid="plan-blockers">
            <b>This episode cannot be rebuilt yet. Nothing was started.</b>
            <ul>{plan.blockers.map((b) => (
              <li key={b.message}>{b.message}{b.segments?.map((id) => <button key={id} className="linkish" onClick={() => onOpenSegment(id)}>Open {id}</button>)}</li>
            ))}</ul>
          </div>
        )}
        {plan && !blocked && plan.nothingToDo && <div className="inline ok" role="status">Everything is already up to date. There is nothing to rebuild.</div>}
        {plan && (
          <table className="plan-table" data-testid="plan-table">
            <thead><tr><th>Step</th><th>What happens</th><th>Time</th></tr></thead>
            <tbody>{plan.steps.map((s) => (
              <tr key={s.key} data-action={s.action} data-step={s.key}>
                <td><b>{s.label}</b></td>
                <td><span className={`chip sm ${ACTION[s.action].cls}`}>{ACTION[s.action].label}</span>{s.why.length > 0 && <div className="why">{s.why.join('. ')}</div>}</td>
                <td className="time">{s.action === 'run' && s.estimate ? fmtEstimate(s.estimate) : s.action === 'reuse' ? 'No new work' : '–'}</td>
              </tr>
            ))}</tbody>
          </table>
        )}
        {plan && !plan.nothingToDo && t && (
          <p className="total" data-testid="plan-total">
            {runs.length === 0
              ? <>Nothing needs to run. {reuse.length} saved result{reuse.length === 1 ? '' : 's'} will be selected, which takes no measurable time.</>
              : <>
                {runs.length} step{runs.length === 1 ? '' : 's'} will run{reuse.length ? `, ${reuse.length} reused` : ''}.{' '}
                {t.known ? <>Measured steps add up to about {fmtSec(t.minSec)}{t.maxSec !== t.minSec ? ` to ${fmtSec(t.maxSec)}` : ''} (estimate)</> : <>Estimated time: Not measured</>}
                {t.unknown ? `; ${t.unknown} step${t.unknown === 1 ? ' is' : 's are'} Not measured, so the total is incomplete.` : '.'}
              </>}
          </p>
        )}
        {plan && plan.notes.length > 0 && <details className="more"><summary>More about this rebuild</summary><ul>{plan.notes.map((n) => <li key={n}>{n}</li>)}</ul></details>}
        <div className="dfoot">
          <span className="muted small">Estimates come only from durations measured in earlier runs. Heavy steps run one at a time, across every open project on this computer.</span>
          <span className="acts"><button className="btn" onClick={onClose}>Not now</button><button className="btn pri" disabled={!canStart} onClick={onStart} data-testid="plan-start">{state.starting ? 'Starting…' : draft ? 'Start draft' : 'Start rebuild'}</button></span>
        </div>
      </div>
    </div>
  );
}
