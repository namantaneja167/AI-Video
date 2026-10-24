import type React from 'react';
import {ContextWindowScene} from './scenes/ContextWindow';
import {DenseFixtureScene} from './scenes/DenseFixture';
import {Pip10xScene} from './scenes/Pip10xScene';
import {PipCardsScene} from './scenes/PipCards';
import {CacheJourneyScene} from './scenes/CacheJourney';
import {TokenJourneyScene} from './scenes/TokenJourney';
import {RotatingTicket} from './scenes/RotatingTicket';
import {PromptInjectionScene} from './scenes/PromptInjectionTreatments';
import {TicketMotion} from './scenes/TicketMotion';
import type {SceneProps} from './types';

export type SceneDefinition = {
  type: string;
  component: React.FC<SceneProps>;
  /** The scene draws its own captions (the prototype does). */
  ownsCaptions?: boolean;
};

/** Pip-style scenes. Legacy (dark) scenes render through the existing EpisodeVideo path. */
export const SCENES: Record<string, SceneDefinition> = {
  'cache-journey': {type: 'cache-journey', component: CacheJourneyScene},
  'token-journey': {type: 'token-journey', component: TokenJourneyScene},
  'rotating-ticket': {type: 'rotating-ticket', component: RotatingTicket},
  'prompt-injection': {type: 'prompt-injection', component: PromptInjectionScene},
  'ticket-motion': {type: 'ticket-motion', component: TicketMotion},
  'pip-scene-10x': {type: 'pip-scene-10x', component: Pip10xScene, ownsCaptions: true},
  'context-window': {type: 'context-window', component: ContextWindowScene},
  'pip-dense-fixture': {type: 'pip-dense-fixture', component: DenseFixtureScene},
  'pip-cards': {type: 'pip-cards', component: PipCardsScene},
};
