import type {EpisodeV2, Note} from '../../src/schema2.ts';
import {wordsOf, spokenOf, type DocDiff} from '../shared/compare.ts';
import {emphasisSet} from '../shared/edit.ts';
import type {Status} from '../../core/artifacts.ts';
import type {Build, EpisodePayload} from './api';
import {NotesList} from './Notes';
import {layoutLabel, sceneTypeLabel, styleLabel, voiceLabel, when} from './labels';

type Seg = EpisodeV2['narration']['segments'][number];
export type InspectorProps = {
  doc: EpisodeV2; segment: Seg; diff: DocDiff | null; build: Build | null; status: Status; payload: Pick<EpisodePayload, 'seq' | 'docHash'>;
  collapsed: boolean; onToggle: () => void;
  onText: (v: string) => void; onSpeech: (v: string) => void; onPause: (v: number | undefined) => void; onToggleWord: (i: number) => void;
  onOpenStale: () => void;
  /** Notes anchored to this segment. */
  notes: Note[];
};

export function Inspector(p: InspectorProps) {
  const {segment: s, diff} = p;
  const sd = diff?.segments[s.id];
  const words = wordsOf(s.text);
  const on = emphasisSet(s);
  const scene = p.doc.scenes.find((x) => x.segments.includes(s.id))!;
  const block = p.doc.narration.blocks.find((b) => b.segments.includes(s.id));
  const different = !!sd && (sd.spoken || sd.text || sd.captions || sd.emphasis);
  return (
    <aside className={`pane insp ${p.collapsed ? 'slim' : ''}`} aria-label="Inspector">
      <div className="ph">
        <button className="btn sm icon" onClick={p.onToggle} aria-label={p.collapsed ? 'Expand inspector' : 'Collapse inspector'} aria-expanded={!p.collapsed} title={p.collapsed ? 'Expand inspector' : 'Collapse inspector'}>{p.collapsed ? '‹' : '›'}</button>
        {p.collapsed ? <span className="vert">{s.id}</span> : <span>Segment {s.id}</span>}
        {!p.collapsed && block && <span className="chip sm">Block {block.id}</span>}
      </div>
      {!p.collapsed && (
        <div className="ibody">
          <div className="sec">
            <h5><label htmlFor="f-text">Words shown (captions)</label></h5>
            <textarea id="f-text" className="field" rows={3} value={s.text} onChange={(e) => p.onText(e.target.value.replace(/\n/g, ' '))} spellCheck />
            {sd?.text && <div className="hint warn">Changed since the build. The preview still shows the built words.</div>}
          </div>
          <div className="sec">
            <h5><label htmlFor="f-speech">Spoken as</label><span className="r">{s.speech ? 'differs from the shown words' : 'same as the shown words'}</span></h5>
            <textarea id="f-speech" className="field" rows={2} value={s.speech ?? ''} placeholder={`Same as the shown words: ${s.text}`} onChange={(e) => p.onSpeech(e.target.value.replace(/\n/g, ' '))} />
            {sd?.spoken && <div className="hint warn">Narration was built for different words ({block ? `block ${block.id}` : 'this block'}). The audio in the preview is the built narration.</div>}
          </div>
          <div className="sec">
            <h5>Emphasis<span className="r">click words to emphasise them</span></h5>
            <div className="words" role="group" aria-label="Emphasised words">
              {words.map((w, i) => <button key={i} className={`w ${on.has(i) ? 'on' : ''}`} aria-pressed={on.has(i)} onClick={() => p.onToggleWord(i)}>{w}</button>)}
            </div>
            <div className="hint">Emphasis is styling in the captions; the spoken text is never marked up.{sd?.emphasis && !sd.text && !sd.spoken ? ' Your change is shown live in the preview.' : ''}</div>
          </div>
          <div className="sec">
            <h5><label htmlFor="f-pause">Pause after</label><span className="r">seconds, 0 to 5</span></h5>
            <input id="f-pause" className="field num" type="number" min={0} max={5} step={0.1} value={s.pauseAfter ?? ''} placeholder="default" onChange={(e) => { const v = e.target.value; p.onPause(v === '' ? undefined : Math.min(5, Math.max(0, Number(v)))); }} />
            {s.pauseAfter !== undefined && <div className="hint warn">A pause change applies to the next build.</div>}
          </div>
          <div className="sec">
            <h5>This segment</h5>
            <dl className="facts">
              <dt>Scene</dt><dd>{sceneTypeLabel(scene.type, scene.id)}, {layoutLabel(scene.layout.template)}</dd>
              <dt>Spoken text</dt><dd>{spokenOf(s)}</dd>
              <dt>Caption phrases</dt><dd>{s.captions?.length ? s.captions.join(' | ') : 'Chosen when timing is built'}</dd>
              <dt>Against the build</dt><dd>{!p.build ? 'Nothing built yet' : different ? <button className="linkish" onClick={p.onOpenStale}>Changed. What is out of date?</button> : 'As built'}</dd>
            </dl>
          </div>
          <details className="diag">
            <summary>Technical details</summary>
            <dl className="facts mono">
              <dt>Saved version</dt><dd>{p.payload.seq}</dd>
              <dt>Document hash</dt><dd>{p.payload.docHash.slice(0, 12)}</dd>
              <dt>Voice</dt><dd>{voiceLabel(p.doc.voice)}</dd>
              <dt>Style</dt><dd>{styleLabel(p.doc.style)}</dd>
              <dt>Build</dt><dd>{p.build ? `timing #${p.build.timingArtifactId}, workspace revision ${p.build.revision ?? '?'}, ${when(p.build.builtAt)}` : 'none'}</dd>
              <dt>Narration</dt><dd>{Object.entries(p.status.takes).map(([k, v]) => `${k}: ${v.status}`).join(', ')}</dd>
              <dt>Timing</dt><dd>{p.status.timing.status}</dd>
              <dt>Mix</dt><dd>draft {p.status.mix.draft.status}, final {p.status.mix.final.status}</dd>
              <dt>Render</dt><dd>draft {p.status.render.draft.status}, final {p.status.render.final.status}</dd>
              {p.build?.imported && <><dt>Origin</dt><dd>{p.build.imported.note}</dd></>}
            </dl>
          </details>
          <NotesList notes={p.notes} />
        </div>
      )}
    </aside>
  );
}
