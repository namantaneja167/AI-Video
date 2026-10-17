import React from 'react';
import {AbsoluteFill, Audio, staticFile, useCurrentFrame, useVideoConfig} from 'remotion';
import {Background} from './components/Background';
import {Chapters} from './components/Chapters';
import {Captions} from './components/Captions';
import {Presenter} from './components/Presenter';
import {C, BAND} from './theme';
import {prog, sceneCues} from './anim';
import type {Episode, Timeline} from './schema';
import {KpiMismatch} from './scenes/KpiMismatch';
import {TablesLab} from './scenes/TablesLab';
import {Cards} from './scenes/Cards';

export type EpisodeProps = {
  episode: string;
  variant: string;
  data: {episode: Episode; timeline: Timeline} | null;
};

export const EpisodeVideo: React.FC<EpisodeProps> = ({episode: id, variant, data}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  if (!data) return <AbsoluteFill style={{background: C.bg}} />;
  const {episode, timeline} = data;
  const t = frame / fps;

  const sceneIdx = Math.max(0, timeline.scenes.findIndex((s) => t >= s.start - 1e-6 && t < s.end));
  const tScene = timeline.scenes[sceneIdx] ?? timeline.scenes[timeline.scenes.length - 1];
  const scene = episode.scenes.find((s) => s.id === tScene.id)!;
  const startFrame = Math.round(tScene.start * fps);
  const endFrame = Math.round(tScene.end * fps);
  const cues = sceneCues(timeline, tScene.id, fps);
  const first = sceneIdx === 0;
  const last = sceneIdx === timeline.scenes.length - 1;
  const sceneOpacity = (first ? 1 : prog(frame, startFrame, 8)) * (last ? 1 : 1 - prog(frame, endFrame - 6, 6));

  // Expression: last event at or before now, blended from the previous one.
  const exprEvents = timeline.events.filter((e) => e.expression);
  const idx = exprEvents.reduce((acc, e, i) => (e.time <= t ? i : acc), -1);
  const expression = idx >= 0 ? exprEvents[idx].expression! : 'neutral';
  const prevExpression = idx > 0 ? exprEvents[idx - 1].expression! : 'neutral';
  const expressionSince = idx >= 0 ? t - exprEvents[idx].time : 10;

  // Mouth flaps only while a word is being spoken.
  const word = timeline.segments.flatMap((s) => s.words).find((w) => t >= w.start && t < w.end);
  const mouth = word ? 0.3 + 0.7 * Math.abs(Math.sin((t - word.start) * Math.PI * 5)) : 0;

  const common = {cues, startFrame, endFrame};
  return (
    <AbsoluteFill style={{background: C.bg, overflow: 'hidden'}}>
      <Background />
      <Audio src={staticFile(`generated/${id}/${variant}/${timeline.audio}`)} />
      <div style={{position: 'absolute', inset: 0, opacity: sceneOpacity}}>
        {scene.type === 'kpi-mismatch' && <KpiMismatch params={scene.params} {...common} />}
        {scene.type === 'tables-lab' && <TablesLab params={scene.params} {...common} />}
        {scene.type === 'cards' && <Cards params={scene.params} {...common} />}
      </div>
      <Chapters chapters={timeline.chapters} t={t} />
      <div style={{position: 'absolute', left: 50, top: BAND.y - 10}}>
        <Presenter t={t} expression={expression} prevExpression={prevExpression} expressionSince={expressionSince} mouth={mouth} width={200} />
      </div>
      <Captions timeline={timeline} t={t} />
    </AbsoluteFill>
  );
};
