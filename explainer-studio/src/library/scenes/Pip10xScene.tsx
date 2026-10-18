import React from 'react';
import {PipScene10x} from '../../art/pip-scene/PipScene10x';
import type {Timing} from '../../art/pip-scene/rig';
import {pipTimingFromTimeline} from '../pipTiming';
import type {SceneProps} from '../types';

/**
 * The frozen prototype scene, unchanged, as a registered custom scene. Its timing comes from the pipeline timeline,
 * or, for the "original timing" reproduction, from the prototype's own timing file passed as scene data.
 */
export const Pip10xScene: React.FC<SceneProps> = ({timeline, cues, fps, sceneData}) => {
  const original = (sceneData as {timing?: Timing} | undefined)?.timing;
  const timing = original ?? pipTimingFromTimeline(timeline, cues, {fps, audio: '../../library/silence.wav', leadSec: timeline.segments[0].start, tailSec: 0});
  return <PipScene10x timing={timing} />;
};
