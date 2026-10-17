import React from 'react';
import {AbsoluteFill} from 'remotion';
import {Pip, type ExprName} from './Pip';

/** Character alone on a transparent background, for use as a reference. No scene, no ground shadow. */
export const PipExport: React.FC<{expr: ExprName}> = ({expr}) => (
  <AbsoluteFill>
    <Pip expr={expr} uid="export" crop={[-40, 100, 480, 480]} width={1200} height={1200} shadow={false} />
  </AbsoluteFill>
);
