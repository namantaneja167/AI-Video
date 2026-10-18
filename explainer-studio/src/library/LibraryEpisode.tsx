import React from 'react';
import {AbsoluteFill, Audio, staticFile, useCurrentFrame, useVideoConfig} from 'remotion';
import {EpisodeVideo} from '../Episode';
import {fontSetFor, useBundledFonts} from './fonts';
import {PipCaption, activeCaption} from './PipCaption';
import {SCENES} from './registry';
import type {LibData} from './types';
import {P} from '../art/palette';

export type LibraryProps = {episode: string; variant: string; data: LibData | null};

/**
 * The studio's generic composition. Legacy-dark episodes render through the existing EpisodeVideo (unchanged);
 * Pip styles render registered scenes on the warm-paper palette with the pipeline's audio and the Pip caption pill.
 */
export const LibraryEpisode: React.FC<LibraryProps> = ({episode: id, variant, data}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const style = data?.episode.style ?? 'legacy-dark';
  useBundledFonts(style === 'pip-paper-bundled');
  if (!data) return <AbsoluteFill style={{background: P.cream}} />;
  if (style === 'legacy-dark') {
    // The recorded legacy episode shape is validated by the pipeline before queuing; this path is the unchanged v1 renderer.
    return <EpisodeVideo episode={id} variant={variant} data={data as unknown as React.ComponentProps<typeof EpisodeVideo>['data']} />;
  }
  const {episode, timeline} = data;
  const t = frame / fps;
  const tScene = timeline.scenes.find((s) => t >= s.start - 1e-6 && t < s.end) ?? timeline.scenes[timeline.scenes.length - 1];
  const scene = episode.scenes.find((s) => s.id === tScene.id)!;
  const def = SCENES[scene.type];
  if (!def) throw new Error(`No registered Pip scene of type ${scene.type}`);
  const fonts = fontSetFor(style);
  const segments = timeline.segments.filter((s) => scene.segments.includes(s.id));
  const caption = def.ownsCaptions ? null : activeCaption(timeline.captions.filter((c) => scene.segments.includes(c.segment)), t);
  const Scene = def.component;
  return (
    <AbsoluteFill style={{background: P.cream, overflow: 'hidden'}}>
      <Audio src={staticFile(`generated/${id}/${variant}/${timeline.audio}`)} />
      <Scene scene={scene} timeline={timeline} segments={segments} cues={timeline.cues?.[scene.id] ?? {}} t={t} fps={fps} fonts={fonts} sceneData={data.sceneData?.[scene.id]} audioSrc={`generated/${id}/${variant}/${timeline.audio}`} />
      {caption ? <PipCaption cap={caption.cap} opacity={caption.opacity} lift={caption.lift} fonts={fonts} /> : null}
    </AbsoluteFill>
  );
};
