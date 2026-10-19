// Review notes: the composer that N opens at the playhead, and the list shown for a segment. A note is part of the episode document
// (reviewNotes), saved through the normal autosave; it changes no narration, timing, mix or render.
import {useEffect, useRef, useState} from 'react';
import type {Note} from '../../src/schema2.ts';
import {mmss} from './labels';

const TYPE_LABEL: Record<Note['type'], string> = {voice: 'Voice', visual: 'Visual', copy: 'Copy', timing: 'Timing', factual: 'Factual', general: 'General'};
// A Record over every note type: adding a type to the schema is a compile error here until it has a label.
const NOTE_TYPES = Object.keys(TYPE_LABEL) as Note['type'][];
export const noteTypeLabel = (t: Note['type']) => TYPE_LABEL[t];

export type NoteTarget = {timeSec: number | undefined; segment: string | undefined};

export function NoteComposer({target, onAdd, onCancel}: {target: NoteTarget; onAdd: (text: string, type: Note['type']) => void; onCancel: () => void}) {
  const [text, setText] = useState('');
  const [type, setType] = useState<Note['type']>('general');
  const area = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { area.current?.focus(); }, []);
  const submit = () => { if (text.trim()) onAdd(text, type); };
  return (
    <div className="notecomposer" role="dialog" aria-label="Add note" data-testid="note-composer"
      onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); onCancel(); } }}>
      <div className="nch">
        <b>Add note</b>
        <span className="chip sm" data-testid="note-target">{target.timeSec !== undefined ? mmss(target.timeSec) : 'no time'}{target.segment ? ` · ${target.segment}` : ''}</span>
      </div>
      <textarea ref={area} id="f-note" className="field" rows={3} value={text} placeholder="What should change here?" aria-label="Note text"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } }} />
      <div className="ncf">
        <label>Type <select value={type} onChange={(e) => setType(e.target.value as Note['type'])} aria-label="Note type">{NOTE_TYPES.map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}</select></label>
        <span className="muted small">Enter adds, Shift+Enter is a new line, Esc cancels</span>
        <span className="spacer" />
        <button className="btn sm" onClick={onCancel}>Cancel</button>
        <button className="btn sm pri" onClick={submit} disabled={!text.trim()} data-testid="note-add">Add</button>
      </div>
    </div>
  );
}

export function NotesList({notes}: {notes: Note[]}) {
  if (!notes.length) return null;
  return (
    <div className="sec" data-testid="notes-list">
      <h5>Notes ({notes.length})</h5>
      <ul className="notes">
        {notes.map((n) => (
          <li key={n.id} data-note={n.id}>
            <span className="chip sm">{noteTypeLabel(n.type)}</span>
            {n.timeSec !== undefined && <span className="muted small"> {mmss(n.timeSec)}</span>}
            <div>{n.text}</div>
          </li>
        ))}
      </ul>
    </div>
  );
}
