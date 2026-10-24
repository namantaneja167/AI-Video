// The prompt-injection scene with optional presentation treatments. No `params.treatment` renders the baseline scene exactly as before;
// a treatment replaces the baseline only inside the shared passage (s2 to s4) and the baseline plays everywhere else.
import React from 'react';
import type {SceneProps} from '../types';
import {InterfaceProof} from './injection/Interface';
import {InvestigationProof} from './injection/Investigation';
import {MechanismProof} from './injection/Mechanism';
import {passageWindow} from './injection/passage';
import {PromptInjection} from './PromptInjection';

const TREATMENTS: Record<string, React.FC<SceneProps>> = {interface: InterfaceProof, investigation: InvestigationProof, mechanism: MechanismProof};

export const PromptInjectionScene: React.FC<SceneProps> = (p) => {
  const name = (p.scene.params as {treatment?: string}).treatment;
  const Treatment = name ? TREATMENTS[name] : undefined;
  if (!Treatment) return <PromptInjection {...p} />;
  const w = passageWindow(p.segments);
  return p.t >= w.from - 1e-6 && p.t <= w.to + 1e-6 ? <Treatment {...p} /> : <PromptInjection {...p} />;
};
