// Read-only timeline of the last build. Clicking seeks the preview; nothing here edits the episode.
import {useEffect, useRef, useState, type KeyboardEvent, type PointerEvent} from 'react';
import type {Note} from '../../src/schema2.ts';
import type {DocDiff} from '../shared/compare.ts';
import {FPS} from '../../src/theme';
import type {Timeline as Tl} from './api';
import {mmss, sceneTypeLabel} from './labels';
import {useFrame, type Playhead} from './playhead';

export const TL_MIN = 120;
export const TL_MAX = 420;
export const TL_DEFAULT = 224;
const LABEL_W = 118;

export function Timeline({tl, diff, live, selected, onSelect, ph, onSeek, height, onHeight, notes}: {
  tl: Tl; diff: DocDiff | null; live: string[]; selected: string; onSelect: (id: string) => void; ph: Playhead; onSeek: (frame: number) => void;
  height: number; onHeight: (h: number, commit: boolean) => void; notes: Note[];
}) {
  const frame = useFrame(ph);
  const lanes = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(600);
  useEffect(() => {
    const el = lanes.current!;
    const m = () => setW(el.clientWidth);
    m();
    const ro = new ResizeObserver(m);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const dur = tl.durationSec;
  const x = (sec: number) => (sec / dur) * w;
  const ticks: number[] = [];
  const step = dur > 60 ? 10 : 5;
  for (let t = 0; t <= dur; t += step) ticks.push(t);
  const seek = (e: PointerEvent) => {
    const r = lanes.current!.getBoundingClientRect();
    onSeek(Math.round(Math.max(0, Math.min(dur, ((e.clientX - r.left) / r.width) * dur)) * FPS));
  };
  const drag = useRef<{y: number; h: number} | null>(null);
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowUp') { e.preventDefault(); onHeight(Math.min(TL_MAX, height + 24), true); }
    if (e.key === 'ArrowDown') { e.preventDefault(); onHeight(Math.max(TL_MIN, height - 24), true); }
    if (e.key === 'Home') { e.preventDefault(); onHeight(TL_DEFAULT, true); }
  };
  const sd = (id: string) => diff?.segments[id];
  const emphWords = tl.captions.flatMap((c) => (c.emphasis ?? []).map(([a, b]) => ({seg: c.segment, start: c.words[a].start, end: c.words[b - 1].end, text: c.words.slice(a, b).map((x) => x.text).join(' ')})));
  return (
    <section className="tl" style={{height}} aria-label="Timeline of the last build (read only)">
      <div
        className="grip" role="separator" aria-orientation="horizontal" aria-label="Resize timeline (arrow keys; Home resets)" aria-valuemin={TL_MIN} aria-valuemax={TL_MAX} aria-valuenow={height} tabIndex={0}
        onKeyDown={onKey} onDoubleClick={() => onHeight(TL_DEFAULT, true)}
        onPointerDown={(e) => { drag.current = {y: e.clientY, h: height}; (e.target as HTMLElement).setPointerCapture(e.pointerId); }}
        onPointerMove={(e) => { if (drag.current) onHeight(Math.max(TL_MIN, Math.min(TL_MAX, drag.current.h - (e.clientY - drag.current.y))), false); }}
        onPointerUp={(e) => { if (drag.current) { onHeight(Math.max(TL_MIN, Math.min(TL_MAX, drag.current.h - (e.clientY - drag.current.y))), true); drag.current = null; } }}
      ><span>Timeline of the last build · read only · drag to resize, double-click to reset</span></div>
      <div className="tlbody">
        <div className="labs" style={{width: LABEL_W}}>
          <div className="lab ruler-l" />
          <div className="lab">Scenes</div><div className="lab">Narration</div><div className="lab">Captions</div><div className="lab">Emphasis</div>
        </div>
        <div className="lanes-wrap">
          <div className="lanes" ref={lanes} onPointerDown={seek} data-testid="lanes">
            <div className="ruler">{ticks.map((t) => <span key={t} style={{left: x(t)}}>{Math.floor(t / 60)}:{String(t % 60).padStart(2, '0')}<i /></span>)}
              {notes.filter((n) => n.timeSec !== undefined).map((n) => (
                <button key={n.id} className="notepin" data-testid="note-marker" style={{left: x(n.timeSec!)}} aria-label={`Note at ${mmss(n.timeSec!)}: ${n.text}`} title={`${mmss(n.timeSec!)} · ${n.text}`}
                  onPointerDown={(e) => e.stopPropagation()} onClick={() => onSeek(Math.round(n.timeSec! * FPS))} />
              ))}
            </div>
            <div className="lane">{tl.scenes.map((s, i) => <div key={s.id} className="b scene" style={{left: x(s.start), width: Math.max(2, x(s.end - s.start))}}>{i + 1} · {sceneTypeLabel(s.type)}</div>)}</div>
            <div className="lane">
              {tl.segments.map((s) => (
                <button key={s.id} className={`b nar ${selected === s.id ? 'sel' : ''} ${sd(s.id)?.spoken ? 'stale' : ''}`} style={{left: x(s.start), width: Math.max(4, x(s.end - s.start) - 1)}}
                  onPointerDown={(e) => e.stopPropagation()} onClick={() => onSelect(s.id)} aria-label={`Segment ${s.id}, ${mmss(s.start)} to ${mmss(s.end)}${sd(s.id)?.spoken ? ', narration built for earlier words' : ''}`} title={sd(s.id)?.spoken ? 'Narration was built for earlier words' : s.id}>{s.id}</button>
              ))}
            </div>
            <div className="lane">
              {tl.captions.map((c, i) => (
                <div key={i} className={`b cap ${sd(c.segment)?.text || sd(c.segment)?.captions ? 'stale' : ''}`} style={{left: x(c.words[0].start), width: Math.max(3, x(c.words[c.words.length - 1].end - c.words[0].start) - 1)}} title={c.text} />
              ))}
            </div>
            <div className="lane">
              {emphWords.map((e, i) => <div key={i} className={`b emph ${live.includes(e.seg) ? 'live' : ''}`} style={{left: x(e.start), width: Math.max(3, x(e.end - e.start))}} title={`${e.text}${live.includes(e.seg) ? ' (your edit, shown live)' : ''}`} />)}
            </div>
            <div className="playhead" style={{left: x(frame / FPS)}} aria-hidden="true" />
          </div>
        </div>
      </div>
    </section>
  );
}
