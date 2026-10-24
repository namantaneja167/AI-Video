// The Pip Explains opening of one episode: its hook (the first scene's openingHook), a preview of the shared opening, and the quiet
// opening chime. The hook is saved through the normal episode save (a revision, with the sequence check) and checked by the episode's own
// schema; the descriptive title is a separate field that this never touches. Nothing here starts any work.
import {Player} from '@remotion/player';
import {useCallback, useEffect, useMemo, useState} from 'react';
import {LibraryEpisode} from '../../src/library/LibraryEpisode';
import type {EpisodeV2} from '../../src/schema2.ts';
import {FPS, H, W} from '../../src/theme';
import {estimatedPreview} from '../shared/estimate.ts';
import {HOOK_MAX, hookAdvice, hookProblems, openingPreviewDoc, withHook} from '../shared/opening.ts';
import {TAB_ID, getEpisode, getOpening, saveEpisode, setOpeningSignature, type OpeningInfo} from './api';

const OPENING_FRAMES = 90; // 3 s: the hook, Pip's entrance and the banner settling into the header

export function OpeningHook({id, refreshKey, onChanged}: {id: string; refreshKey?: unknown; onChanged?: () => void}) {
  const [doc, setDoc] = useState<EpisodeV2 | null>(null);
  const [seq, setSeq] = useState(0);
  const [info, setInfo] = useState<OpeningInfo | null>(null);
  const [text, setText] = useState('');
  const [saved, setSaved] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{tone: 'ok' | 'bad'; text: string} | null>(null);

  const load = useCallback(async () => {
    const [e, o] = await Promise.all([getEpisode(id), getOpening(id)]);
    if (e.doc) { setDoc(e.doc); setSeq(e.seq); const h = e.doc.scenes[0]?.openingHook ?? ''; setSaved(h); setText((t) => (t === '' || t === saved ? h : t)); }
    setInfo(o);
  }, [id, saved]);
  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [id, refreshKey]);

  const problems = useMemo(() => (doc ? hookProblems(doc, text) : []), [doc, text]);
  const advice = useMemo(() => hookAdvice(text), [text]);
  const preview = useMemo(() => {
    if (!doc || !text.trim() || problems.length) return null;
    try { return estimatedPreview(openingPreviewDoc(doc, text)); } catch { return null; }
  }, [doc, text, problems.length]);

  if (!doc || !info) return <section className="card" data-testid="opening-loading"><p className="muted">Opening the opening…</p></section>;
  if (!info.pipStyle) return <section className="card" data-testid="opening-legacy"><h3>Opening hook</h3><p className="muted small">The Pip Explains opening belongs to Pip-style episodes; this episode uses the dark legacy style and is left as it is.</p></section>;

  const dirty = text.trim() !== saved;
  const save = async (next: string | null) => {
    setBusy(true); setMsg(null);
    const latest = await getEpisode(id);
    const r = await saveEpisode(id, withHook(latest.doc, next), latest.seq, TAB_ID);
    setBusy(false);
    if (r.result.kind === 'ok') {
      await load();
      onChanged?.();
      setText(next ?? '');
      setMsg({tone: 'ok', text: next === null ? 'The opening hook was removed. The narration, timing and audio are unchanged; the video needs a rebuild.' : 'Saved. The narration, timing and audio are reused; only the video (and its cover) need to be made again.'});
    } else if (r.result.kind === 'conflict') { setDoc(r.result.current.doc as EpisodeV2); setSeq(r.result.current.seq); setMsg({tone: 'bad', text: 'The episode was saved somewhere else at the same moment, so nothing was saved. The current version is loaded; save again to apply your hook to it.'}); }
    else setMsg({tone: 'bad', text: r.result.kind === 'invalid' || r.result.kind === 'failed' ? r.result.message : 'It could not be saved.'});
  };
  const signature = async (on: boolean) => {
    setBusy(true); setMsg(null);
    const r = await setOpeningSignature(id, on);
    setBusy(false);
    if (r.status === 200) { setInfo(await getOpening(id)); onChanged?.(); setMsg({tone: 'ok', text: on ? 'The opening chime is recorded for this episode, once. The audio mix and the video need to be made again.' : 'The opening chime was removed from this episode. The audio mix and the video need to be made again.'}); }
    else setMsg({tone: 'bad', text: r.json.message ?? 'The sound setting could not be changed.'});
  };

  const sig = info.signature.count;
  return (
    <section className="card" aria-label="Opening hook" data-testid="opening-card" data-saved={saved ? 'yes' : 'no'}>
      <div className="chead"><h3>Opening hook</h3>
        {info.brand === 'pip-explains' && !saved && <span className="chip sm amber" data-testid="hook-required">Required before this episode can be built</span>}
        {saved && <span className="chip sm green" data-testid="hook-saved">Saved</span>}
      </div>
      <p className="small muted">The Pip Explains opening shows the banner, this hook and Pip's entrance, then settles into the header. It plays over the opening narration. It is a short, specific headline that the episode actually backs up. Up to {HOOK_MAX} characters; 4 to 8 words works best.</p>
      <div className="small" data-testid="opening-title">Episode title (descriptive, kept separate): <b>{doc.title}</b></div>
      <label>Hook
        <input className="field" maxLength={HOOK_MAX + 20} value={text} onChange={(e) => { setText(e.target.value); setMsg(null); }} placeholder="For example: Faster apps do less work" data-testid="hook-input" aria-describedby="hook-count" />
      </label>
      <div className="small muted" id="hook-count" data-testid="hook-count">{text.trim().length} of {HOOK_MAX} characters · {advice.words} word{advice.words === 1 ? '' : 's'}{advice.note ? ` · ${advice.note}` : ''}</div>
      {problems.length > 0 && <div className="errs" role="alert" data-testid="hook-problems">{problems.map((m, i) => <div key={i}>{m}</div>)}</div>}
      {msg && <div className={`plannote ${msg.tone === 'ok' ? 'ok' : 'warn'}`} role="status" data-testid="hook-msg" data-tone={msg.tone}>{msg.text}</div>}
      <div className="hrow">
        <button className="btn sm pri" disabled={busy || !dirty || !text.trim() || problems.length > 0} onClick={() => void save(text.trim())} data-testid="hook-save">Save hook</button>
        {saved && <button className="btn sm" disabled={busy} onClick={() => void save(null)} data-testid="hook-remove">Remove the hook</button>}
        {!dirty && saved && <span className="muted small">Saved</span>}
      </div>

      <div className="opening-preview" data-testid="opening-preview">
        <div className="chead"><b>Opening preview</b><span className="chip sm amber">Estimated timing · no audio · not a build</span></div>
        {preview
          ? <div className="scr small-player"><Player component={LibraryEpisode as never} inputProps={{episode: doc.id, variant: 'estimate', data: preview.data} as never} durationInFrames={OPENING_FRAMES} fps={FPS} compositionWidth={W} compositionHeight={H} initialFrame={20} style={{width: 216, height: 384}} controls loop
              errorFallback={({error}) => <div className="player-error">The preview could not draw this frame: {error.message}</div>} /></div>
          : <p className="muted small" data-testid="opening-preview-empty">{text.trim() ? 'The preview returns when the hook is valid.' : 'Type a hook to see the shared opening.'}</p>}
        <p className="muted small">The first three seconds of the real composition on a guessed clock. The finished video's opening is drawn from its recorded timing, and the Review step shows its cover.</p>
      </div>

      <div className="hrow" data-testid="signature-row" data-count={sig}>
        <b>Opening chime</b>
        <span className={`chip sm ${sig === 1 ? 'green' : sig === 0 ? '' : 'rose'}`} data-testid="signature-state">{sig === 1 ? 'On, once' : sig === 0 ? 'Off' : `Recorded ${sig} times`}</span>
        <span className="muted small">A quiet synthesized chime at {info.signatureSpec.t} s, {info.signatureSpec.gainDb} dB, under the narration.</span>
        <span className="spacer" />
        {sig !== 1 && <button className="btn sm" disabled={busy} onClick={() => void signature(true)} data-testid="signature-on">{sig === 0 ? 'Add the chime' : 'Keep one chime'}</button>}
        {sig >= 1 && <button className="btn sm" disabled={busy} onClick={() => void signature(false)} data-testid="signature-off">Remove the chime</button>}
      </div>
      <p className="muted small">Changing the hook or the chime makes the video out of date; narration takes and timing are reused. The sound is recorded for this episode only. Seq {seq}.</p>
    </section>
  );
}
