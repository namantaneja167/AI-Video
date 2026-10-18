import React from 'react';
import {Composition, staticFile, type CalculateMetadataFunction} from 'remotion';
import {EpisodeVideo, type EpisodeProps} from './Episode';
import {EpisodeSchema, TimelineSchema} from './schema';
import {FPS, H, W} from './theme';
import {JoinFrame} from './art/JoinFrame';
import {JoinMotion, MOTION_FRAMES} from './art/JoinMotion';
import {PresenterConcept} from './art/PresenterConcept';
import {PipBoard, BOARD_W, BOARD_H} from './art/pip/PipBoard';
import {PipSheet, SHEET_W as PIP_SHEET_W, SHEET_H as PIP_SHEET_H} from './art/pip2/PipSheet';
import {PipScene} from './art/pip2/PipScene';
import {PipExport} from './art/pip2/PipExport';
import {PipRecon, REF_W, REF_H} from './art/pip-layers/PipRecon';
import {PipLayersScene} from './art/pip-layers/PipLayersScene';
import {PipLayersSheet, SHEET_W as LAYERS_SHEET_W, SHEET_H as LAYERS_SHEET_H} from './art/pip-layers/PipLayersSheet';
import {PipLayersSheetWithNotes} from './art/pip-layers/notes';
import {PipScene10x} from './art/pip-scene/PipScene10x';
import type {Timing} from './art/pip-scene/rig';
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
    <Composition
      id="pip-scene-10x"
      component={PipScene10x}
      width={W}
      height={H}
      fps={FPS}
      durationInFrames={FPS * 16}
      defaultProps={{timing: null as Timing | null}}
      calculateMetadata={async ({props}) => {
        const res = await fetch(staticFile('scenes/pip-10x/timing.json'), {cache: 'no-store'});
        if (!res.ok) throw new Error('Missing public/scenes/pip-10x/timing.json. Run scripts/pip_scene_timing.py first.');
        const timing = (await res.json()) as Timing;
        return {durationInFrames: timing.frames, props: {...props, timing}};
      }}
    />
    <Composition id="art-join-frame-concept" component={JoinFrame} width={W} height={H} fps={FPS} durationInFrames={1} defaultProps={{assets: false}} />
    <Composition id="art-join-frame" component={JoinFrame} width={W} height={H} fps={FPS} durationInFrames={1} defaultProps={{assets: true}} />
    <Composition id="art-join-motion" component={JoinMotion} width={W} height={H} fps={FPS} durationInFrames={MOTION_FRAMES} />
    <Composition id="art-presenter-concept" component={PresenterConcept} width={W} height={H} fps={FPS} durationInFrames={1} defaultProps={{annotate: false}} />
    <Composition id="art-presenter-concept-annotated" component={PresenterConcept} width={W} height={H} fps={FPS} durationInFrames={1} defaultProps={{annotate: true}} />
    <Composition id="art-pip-sheet" component={PipSheet} width={PIP_SHEET_W} height={PIP_SHEET_H} fps={FPS} durationInFrames={1} />
    <Composition id="art-pip-scene" component={PipScene} width={W} height={H} fps={FPS} durationInFrames={1} />
    <Composition id="art-pip-layers-recon" component={PipRecon} width={REF_W} height={REF_H} fps={FPS} durationInFrames={1} defaultProps={{bg: true}} />
    <Composition id="art-pip-layers-scene" component={PipLayersScene} width={W} height={H} fps={FPS} durationInFrames={1} defaultProps={{view: 'skeptical' as const}} />
    <Composition id="art-pip-layers-sheet" component={PipLayersSheetWithNotes} width={LAYERS_SHEET_W} height={LAYERS_SHEET_H} fps={FPS} durationInFrames={1} />
    <Composition id="art-pip-export" component={PipExport} width={1200} height={1200} fps={FPS} durationInFrames={1} defaultProps={{expr: 'neutral' as const}} />
    <Composition id="art-pip-board" component={PipBoard} width={BOARD_W} height={BOARD_H} fps={FPS} durationInFrames={1} />
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
