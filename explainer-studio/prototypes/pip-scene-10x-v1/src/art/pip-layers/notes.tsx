import React from 'react';
import {AbsoluteFill} from 'remotion';
import {PipLayersSheet} from './PipLayersSheet';

// Differences between the target and the layered reconstruction, written from measurements (silhouette IoU, feature positions)
// and from inspecting the rendered crops. Kept beside the sheet so the claims stay in sync with the render.
export const NOTES = [
  'Hands are still the largest gap. Mine are fused mittens with a clear thumb V and a crisp shadow edge, but only one big finger lobe; the target has three distinct rounded finger lobes with soft creases. Cuffs match in colour and cylinder form but are plainer.',
  'Material: the target has real ambient occlusion, contact shadows and subtle subsurface warmth. Mine is gradients plus blurred shapes, so form looks flatter, especially under the chin line and along the seam.',
  'Seam: the target is a crisp bevel with a lit lip. Mine is a dark line with a highlight, so it reads as inlaid rather than raised.',
  'Small views: the target re-renders the body in a new 3D angle for each expression. I reuse the hero shell at ~0.38 scale, so the face moves but the body angle does not change.',
  'The skeptical glove and the surprised glove are approximations of different hand poses (pointing, spread); the target\u2019s finger shapes are more varied.',
  'Not reproduced: the surprised "burst" lines are simple strokes, and there is no depth-of-field or soft environment light.',
  'Measured match: hero silhouette IoU 0.90, small views 0.83\u20130.89, eyes/brows/mouth within 1\u20134 px, ivory and shell colours within ~15 RGB levels.',
];

export const PipLayersSheetWithNotes: React.FC = () => (
  <AbsoluteFill>
    <PipLayersSheet notes={NOTES} />
  </AbsoluteFill>
);
