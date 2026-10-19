import type {EpisodeV2} from '../../src/schema2.ts';
import type {DocDiff} from '../shared/compare.ts';
import {layoutLabel, mmss, sceneTypeLabel} from './labels';
import type {Timeline} from './api';

const changed = (d: DocDiff | null, id: string) => {
  const s = d?.segments[id];
  return !!s && (s.spoken || s.text || s.captions || s.emphasis || s.added);
};
const why = (d: DocDiff | null, id: string): string => {
  const s = d?.segments[id];
  if (!s) return '';
  if (s.spoken) return 'Spoken text changed since the build';
  if (s.text || s.captions) return 'Caption text changed since the build';
  if (s.emphasis) return 'Emphasis changed since the build';
  return '';
};

export function Outline({doc, timeline, diff, selected, onSelect, collapsed, onToggle}: {
  doc: EpisodeV2; timeline: Timeline | null; diff: DocDiff | null; selected: string; onSelect: (id: string) => void; collapsed: boolean; onToggle: () => void;
}) {
  const startOf = (id: string) => timeline?.segments.find((s) => s.id === id)?.start;
  return (
    <aside className={`pane outline ${collapsed ? 'slim' : ''}`} aria-label="Outline">
      <div className="ph">
        {!collapsed && <span>Outline</span>}
        <button className="btn sm icon r" onClick={onToggle} aria-label={collapsed ? 'Expand outline' : 'Collapse outline'} aria-expanded={!collapsed} title={collapsed ? 'Expand outline' : 'Collapse outline'}>{collapsed ? '›' : '‹'}</button>
      </div>
      <div className="olist">
        {doc.scenes.map((sc, i) => {
          const n = sc.segments.filter((id) => changed(diff, id)).length;
          const first = startOf(sc.segments[0]);
          const isSel = sc.segments.includes(selected);
          if (collapsed) {
            return (
              <button key={sc.id} className={`sn ${isSel ? 'sel' : ''}`} onClick={() => onSelect(sc.segments[0])} aria-label={`Scene ${i + 1}, ${sceneTypeLabel(sc.type, sc.id)}${n ? `, ${n} changed` : ''}`} title={`Scene ${i + 1}: ${sceneTypeLabel(sc.type, sc.id)}`}>
                {i + 1}{n > 0 && <i className="pin" />}
              </button>
            );
          }
          return (
            <div key={sc.id} className="scene">
              <div className={`sc ${isSel ? 'sel' : ''}`}>
                <b>{i + 1} · {sceneTypeLabel(sc.type, sc.id)}</b>
                <div className="meta">
                  <span>{first !== undefined ? mmss(first) : 'not built'}</span><span>·</span><span>{layoutLabel(sc.layout.template)}</span>
                  {n > 0 ? <span className="chip amber sm" data-testid="scene-badge">{n} changed</span> : timeline ? <span className="chip green sm">as built</span> : null}
                </div>
              </div>
              <div className="segs" role="listbox" aria-label={`Segments in scene ${i + 1}`}>
                {sc.segments.map((id) => {
                  const seg = doc.narration.segments.find((s) => s.id === id)!;
                  const ch = changed(diff, id);
                  return (
                    <button key={id} role="option" aria-selected={selected === id} className={`seg ${selected === id ? 'sel' : ''}`} onClick={() => onSelect(id)} data-segment={id} data-changed={ch ? 'true' : 'false'}>
                      <span className="id">{id}</span>
                      <span className="tx">{seg.text}</span>
                      <span className="mk" title={why(diff, id)} aria-label={why(diff, id) || undefined}>{ch ? <i className="pin" /> : null}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </aside>
  );
}
