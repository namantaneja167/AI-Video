import type React from 'react';
import {ContextWindowScene} from './scenes/ContextWindow';
import {DenseFixtureScene} from './scenes/DenseFixture';
import {Pip10xScene} from './scenes/Pip10xScene';
import {PipCardsScene} from './scenes/PipCards';
import type {SceneProps} from './types';

export type SceneDefinition = {
  type: string;
  component: React.FC<SceneProps>;
  /** The scene draws its own captions (the prototype does). */
  ownsCaptions?: boolean;
};

/** Pip-style scenes. Legacy (dark) scenes render through the existing EpisodeVideo path. */
export const SCENES: Record<string, SceneDefinition> = {
  'pip-scene-10x': {type: 'pip-scene-10x', component: Pip10xScene, ownsCaptions: true},
  'context-window': {type: 'context-window', component: ContextWindowScene},
  'pip-dense-fixture': {type: 'pip-dense-fixture', component: DenseFixtureScene},
  'pip-cards': {type: 'pip-cards', component: PipCardsScene},
};
