// The preview: the real Remotion Player running the real library composition on the LAST BUILD (its scene, timeline and
// saved audio). It never plays new spoken text against old audio as if they matched; see app/shared/compare.ts.
import {Player, type PlayerRef} from '@remotion/player';
import {memo, useEffect, useLayoutEffect, useRef, useState, type RefObject} from 'react';
import {LibraryEpisode} from '../../src/library/LibraryEpisode';
import {FPS, H, W} from '../../src/theme';
import type {Build, Timeline} from './api';
import {mmss} from './labels';
import {useFrame, usePlaying, type Playhead} from './playhead';

type Data = {episode: {id: string; style: string; scenes: unknown[]}; timeline: Timeline};

const PlayerView = memo(function PlayerView({id, variant, data, playerRef, ph, w, h, onReady}: {id: string; variant: string; data: Data; playerRef: RefObject<PlayerRef | null>; ph: Playhead; w: number; h: number; onReady?: () => void}) {
  useEffect(() => {
    const p = playerRef.current;
    if (!p) return;
    const sync = () => ph.set(p.getCurrentFrame(), p.isPlaying());
    p.addEventListener('frameupdate', sync);
    p.addEventListener('play', sync);
    p.addEventListener('pause', sync);
    p.addEventListener('ended', sync);
    sync();
    onReady?.();
    return () => { p.removeEventListener('frameupdate', sync); p.removeEventListener('play', sync); p.removeEventListener('pause', sync); p.removeEventListener('ended', sync); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playerRef, ph]);
  return (
    <Player
      key={variant}
      ref={playerRef}
      component={LibraryEpisode as never}
      inputProps={{episode: id, variant, data} as never}
      durationInFrames={Math.max(1, Math.ceil(data.timeline.durationSec * FPS))}
      fps={FPS} compositionWidth={W} compositionHeight={H}
      style={{width: w, height: h}} controls={false} clickToPlay={false}
      errorFallback={({error}) => <div className="player-error">The preview could not draw this frame: {error.message}</div>}
    />
  );
});

export type PreviewProps = {
  id: string; build: Build; data: Data; playerRef: RefObject<PlayerRef | null>; ph: Playhead;
  /** Sentences about how the edits differ from what is shown. */
  lines: string[];
  onOpenStale: () => void;
  staleCount: number;
  buildLabel: string;
  buildTitle: string;
  /** How the shown build relates to the saved text, and whether it is the newest build. */
  freshness: {tone: 'green' | 'amber'; text: string; title: string};
  isLatest: boolean;
  onShowLatest: () => void;
  hasVideo: boolean;
  onAddNote: () => void;
  onPlayVideo: () => void;
  segmentAt: (frame: number) => string | null;
  onPrev: () => void;
  onNext: () => void;
  onReady?: () => void;
};

export function Preview(p: PreviewProps) {
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({w: 0, h: 0});
  useLayoutEffect(() => {
    const el = box.current!;
    const measure = () => setSize({w: el.clientWidth, h: el.clientHeight});
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const avail = Math.max(120, Math.min(size.h - 20, (size.w - 20) * (H / W)));
  const frame = useFrame(p.ph);
  const playing = usePlaying(p.ph);
  const total = Math.max(1, Math.ceil(p.data.timeline.durationSec * FPS));
  const seg = p.segmentAt(frame);
  const a_ = p.build.audio;
  return (
    <section className="center" aria-label="Preview">
      <div className="ctb">
        <span className="seg-tabs" role="tablist"><span className="on" role="tab" aria-selected="true">Preview</span></span>
        <span className="chip" title={p.buildTitle} data-testid="build-label">{p.buildLabel}</span>
        <span className={`chip ${p.freshness.tone}`} title={p.freshness.title} data-testid="build-freshness">{p.freshness.text}</span>
        {p.hasVideo ? <button className="btn sm" onClick={p.onPlayVideo} data-testid="play-video">Play video</button> : <span className="chip" title="This build has no rendered video yet. A rebuild makes one.">No video for this build</span>}
        {!p.isLatest && <button className="chip acc btn-chip" onClick={p.onShowLatest} data-testid="show-latest">Earlier build · show the current one</button>}
        {!a_ ? <span className="chip">No audio built</span> : <span className="chip green" title="The audio and the timeline in the preview were built from the same takes">Audio matches build</span>}
      </div>
      {p.lines.length > 0 && (
        <div className="banner amber" role="status" data-testid="preview-banner">
          <div className="bl"><b>This preview is the last build, not your edits.</b>{p.lines.map((l) => <div key={l}>{l}</div>)}</div>
          <button className="btn sm" onClick={p.onOpenStale}>{p.staleCount ? `What’s out of date (${p.staleCount})` : 'What’s out of date'}</button>
        </div>
      )}
      <div className="stagewrap" ref={box}>
        <div className="phone" style={{width: avail * (W / H) + 16, height: avail + 16}}>
          <div className="scr" data-testid="player">
            {size.h > 0 && <PlayerView key={p.build.id} id={p.id} variant={p.build.id} data={p.data} playerRef={p.playerRef} ph={p.ph} w={avail * (W / H)} h={avail} onReady={p.onReady} />}
          </div>
        </div>
      </div>
      <div className="transport">
        <button className="btn sm icon" onClick={p.onPrev} aria-label="Previous segment" title="Previous segment ( [ )">‹</button>
        <button className="btn pri sm play" onClick={() => p.playerRef.current?.toggle()} aria-label={playing ? 'Pause' : 'Play'} title="Play or pause (Space)">{playing ? 'Pause' : 'Play'}</button>
        <button className="btn sm icon" onClick={p.onNext} aria-label="Next segment" title="Next segment ( ] )">›</button>
        <button className="btn sm" onClick={p.onAddNote} data-testid="add-note" aria-label="Add note" title="Add a note at the playhead ( N )">+ Note</button>
        <span className="tc" data-testid="timecode" data-frame={frame}>{mmss(frame / FPS)} / {mmss(p.data.timeline.durationSec)}</span>
        <input className="scrub" type="range" min={0} max={total - 1} value={Math.min(frame, total - 1)} aria-label="Position in the preview" onChange={(e) => p.playerRef.current?.seekTo(Number(e.target.value))} />
        <span className="chip" data-testid="playing-segment">{seg ? `Segment ${seg}` : 'Lead-in'}</span>
      </div>
    </section>
  );
}
