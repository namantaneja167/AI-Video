import type {ReactNode} from 'react';
import type {SaveState} from '../shared/autosave.ts';

const Icon = ({d}: {d: string}) => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>
);
const RAIL: {label: string; d: string; on?: boolean; href?: string; title?: string}[] = [
  {label: 'Episodes', d: 'M4 5h16M4 12h16M4 19h10', on: true},
  {label: 'Ideas', d: 'M9 18h6M10 21h4M12 3a6 6 0 0 0-4 10.5c.7.7 1 1.5 1 2.5h6c0-1 .3-1.8 1-2.5A6 6 0 0 0 12 3z'},
  {label: 'Library', d: 'M5 4h4v16H5zM11 4h4v16h-4zM17 6l3 .8-3.5 13.2-3-.8z'},
  {label: 'Jobs', d: 'M12 6v6l4 2M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z'},
  {label: 'Settings', href: '/?view=settings', title: 'This project: backup, restore and what this computer has', d: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19 12l2-1-2-4-2 .5-1.5-1L15 4h-4l-.5 2.5-1.5 1L7 7l-2 4 2 1v2l-2 1 2 4 2-.5 1.5 1L11 20h4l.5-2.5 1.5-1 2 .5 2-4-2-1z'},
];

/** Left rail. Only Episodes exists in this version; the others are shown as unavailable, not as controls. */
export function Rail({onEpisodes, onList}: {onEpisodes?: () => void; onList?: boolean}) {
  return (
    <nav className="rail" aria-label="Workspace">
      <div className="logo" aria-hidden="true">E</div>
      {RAIL.map((r) => (r.href
        ? <a key={r.label} className="it on btn-rail" href={r.href} title={r.title} data-testid={`rail-${r.label.toLowerCase()}`}><Icon d={r.d} /><span>{r.label}</span></a>
        : r.on
        ? <button key={r.label} className={`it on btn-rail ${onList ? 'here' : ''}`} aria-current={onList ? 'page' : undefined} title="All episodes" onClick={onEpisodes} data-testid="rail-episodes"><Icon d={r.d} /><span>{r.label}</span></button>
        : <div key={r.label} className="it off" aria-disabled="true" title={`${r.label}: not available in this version`}><Icon d={r.d} /><span>{r.label}</span></div>))}
    </nav>
  );
}

const STAGES = ['Idea', 'Research', 'Script', 'Storyboard', 'Voice', 'Scenes', 'Review', 'Render', 'Export'];
export type StageNote = {label: string; tone: 'ok' | 'warn' | 'none'};

/** The nine-stage journey. Idea, Research, Script and Storyboard work where the episode has a planning document; Voice and Render show their measured state read-only. */
export function Stepper({notes, current = 3, go}: {notes: Record<number, StageNote>; current?: number; go?: Partial<Record<number, () => void>>}) {
  return (
    <ol className="steps" aria-label="Episode journey">
      {STAGES.map((name, i) => {
        const n = i + 1;
        const cur = n === current;
        const note = notes[n];
        const link = go?.[n] ?? (n === 8 || n === 9 ? go?.[7] : undefined); // Render and Export are done inside Review
        const inner = (
          <>
            <span className="n">{n}</span>
            <span className="nm">{name}{note ? <small className={note.tone}>{note.label}</small> : cur ? <small>{n === 3 ? 'editing' : 'here'}</small> : link ? <small>{n === 8 || n === 9 ? 'in Review' : 'open'}</small> : <small>later</small>}</span>
          </>
        );
        const live = cur || !!link;
        return (
          <li key={name} className={`step ${cur ? 'cur' : live ? 'live' : 'off'}`} aria-current={cur ? 'step' : undefined} aria-disabled={live ? undefined : true} title={cur ? 'You are here' : link ? `Go to ${name}` : `${name}: not available${go ? ' for this episode' : ''} in this version`}>
            {link && !cur ? <button className="stepbtn" onClick={link} data-testid={`stage-${n}`}>{inner}</button> : inner}
          </li>
        );
      })}
    </ol>
  );
}

export function SaveChip({state, savedAt, onRetry}: {state: SaveState; savedAt: number | null; onRetry: () => void}) {
  const t = savedAt ? new Date(savedAt).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit', second: '2-digit'}) : '';
  switch (state.kind) {
    case 'saved': return <span className="chip green" role="status" data-save="saved" title={savedAt ? `Saved in the workspace at ${t}` : 'Nothing has changed since the last saved version'}><i className="dot" />Saved</span>;
    case 'unsaved': return <span className="chip amber" role="status" data-save="unsaved"><i className="dot amber" />Unsaved edits</span>;
    case 'saving': return <span className="chip acc" role="status" data-save="saving"><i className="spin" />Saving…</span>;
    case 'failed': return <span className="chip rose" role="status" data-save="failed"><i className="dot rose" />Not saved<button className="linkish" onClick={onRetry}>Retry</button></span>;
    case 'invalid': return <span className="chip rose" role="status" data-save="invalid"><i className="dot rose" />Can’t save yet</span>;
    case 'conflict': return <span className="chip rose" role="status" data-save="conflict"><i className="dot rose" />Newer version exists</span>;
  }
}

export function Notice({tone, children, actions}: {tone: 'warn' | 'bad' | 'info'; children: ReactNode; actions?: ReactNode}) {
  return <div className={`notice ${tone}`} role={tone === 'bad' ? 'alert' : 'status'}><span className="tx">{children}</span><span className="acts">{actions}</span></div>;
}
