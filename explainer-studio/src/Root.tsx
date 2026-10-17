import React from 'react';
import {Composition, staticFile, type CalculateMetadataFunction} from 'remotion';
import {EpisodeVideo, type EpisodeProps} from './Episode';
import {EpisodeSchema, TimelineSchema} from './schema';
import {FPS, H, W} from './theme';
import {JoinFrame} from './art/JoinFrame';
import {JoinMotion, MOTION_FRAMES} from './art/JoinMotion';
import {ContactSheet, SHEET_H, SHEET_W} from './art/ContactSheet';
import manifest from './generated/manifest.json';

const load = async (episode: string, variant: string): Promise<EpisodeProps['data']> => {
  const get = async (name: string) => {
    const res = await fetch(staticFile(`generated/${episode}/${variant}/${name}`), {cache: 'no-store'});
    if (!res.ok) throw new Error(`Missing ${name} for ${episode}/${variant}. Run ./studio narrate first.`);
    return res.json();
  };
  const [ep, tl] = await Promise.all([get('episode.json'), get('timeline.json')]);
  return {episode: EpisodeSchema.parse(ep), timeline: TimelineSchema.parse(tl)};
};

const calculateMetadata: CalculateMetadataFunction<EpisodeProps> = async ({props}) => {
  const data = await load(props.episode, props.variant);
  return {durationInFrames: Math.ceil(data!.timeline.durationSec * FPS), props: {...props, data}};
};

export const RemotionRoot: React.FC = () => (
  <>
    <Composition id="art-join-frame-concept" component={JoinFrame} width={W} height={H} fps={FPS} durationInFrames={1} defaultProps={{assets: false}} />
    <Composition id="art-join-frame" component={JoinFrame} width={W} height={H} fps={FPS} durationInFrames={1} defaultProps={{assets: true}} />
    <Composition id="art-join-motion" component={JoinMotion} width={W} height={H} fps={FPS} durationInFrames={MOTION_FRAMES} />
    <Composition id="art-contact-sheet" component={ContactSheet} width={SHEET_W} height={SHEET_H} fps={FPS} durationInFrames={1} />
    {(manifest.compositions as {episode: string; variant: string}[]).map((c) => (
      <Composition
        key={`${c.episode}--${c.variant}`}
        id={`${c.episode}--${c.variant}`}
        component={EpisodeVideo}
        width={W}
        height={H}
        fps={FPS}
        durationInFrames={FPS * 10}
        defaultProps={{episode: c.episode, variant: c.variant, data: null} satisfies EpisodeProps}
        calculateMetadata={calculateMetadata}
      />
    ))}
  </>
);
