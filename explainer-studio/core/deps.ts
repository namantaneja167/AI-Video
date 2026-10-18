// Dependency hashes: what each artifact was built from. Pure functions of the episode document, recorded
// components (fonts, code, settings...) and the blob hashes of upstream outputs.
//
//   take (per block) -> timing -> render
//        \-------------> mix  ----^
//
// A mix is built from audio and its own settings, not from caption text, so a caption-only edit does not
// force a remix. Upstream blob hashes are included so that swapping a take, or regenerating timing, stales
// everything built on the old output even when the text is unchanged.
import type {EpisodeV2} from '../src/schema2.ts';
import {hashJson} from './hash.ts';

export const COMPONENT_NAMES = [
  'voiceRuntime', // engine + model snapshot + engine version + reference hash + sampling policy
  'aligner', // aligner model id and version (or "estimated")
  'manualTiming', // author corrections to word timing
  'timelineLogic', // hash of pipeline/timeline.py and the cue rules
  'soundEvents', 'soundAssets', 'mixParams', 'masteringParams',
  'theme', 'assets', 'fonts', 'code', 'versions', 'renderSettings',
] as const;
export type ComponentName = (typeof COMPONENT_NAMES)[number];
export const UNSET = 'unset';
export type ComponentHashes = Record<ComponentName, string>;

/** Components that a final render must have recorded before it can be approved. */
export const APPROVAL_COMPONENTS: ComponentName[] = ['voiceRuntime', 'theme', 'assets', 'fonts', 'code', 'versions', 'renderSettings', 'masteringParams'];

export type UpstreamBlobs = {
  takes: Record<string, string | null>;
  timing: string | null;
  mix: {draft: string | null; final: string | null};
};

export const RENDER_PARTS = ['content', 'theme', 'timing', 'mix', 'assets', 'fonts', 'code', 'versions', 'settings'] as const;
export type RenderParts = Record<(typeof RENDER_PARTS)[number], string>;
export type RenderKind = 'draft' | 'final';

export type Expected = {
  take: Record<string, string>;
  timing: string;
  mix: Record<RenderKind, string>;
  render: Record<RenderKind, {hash: string; parts: RenderParts}>;
};

const spoken = (s: EpisodeV2['narration']['segments'][number]): string => s.speech ?? s.text;

/** The part of the document a render consumes. Titles, sources, notes and previews are not in it. */
export function renderContent(doc: EpisodeV2): unknown {
  return {
    segments: doc.narration.segments.map((s) => ({id: s.id, text: s.text, captions: s.captions ?? null})),
    scenes: doc.scenes,
    beats: doc.beats,
    chapters: doc.chapters,
  };
}

export function computeExpected(doc: EpisodeV2, c: ComponentHashes, up: UpstreamBlobs): Expected {
  const seg = new Map(doc.narration.segments.map((s) => [s.id, s]));

  const take: Record<string, string> = {};
  for (const b of doc.narration.blocks) {
    take[b.id] = hashJson({
      kind: 'take',
      voice: doc.voice,
      runtime: c.voiceRuntime,
      segments: b.segments.map((id) => ({id, spoken: spoken(seg.get(id)!)})),
    });
  }
  const takes = doc.narration.blocks.map((b) => ({block: b.id, expected: take[b.id], blob: up.takes[b.id] ?? null}));

  const timing = hashJson({
    kind: 'timing',
    takes,
    pacing: doc.pacing,
    gaps: doc.narration.blocks.map((b) => b.gapAfterSec ?? null),
    segments: doc.narration.segments.map((s) => ({id: s.id, spoken: spoken(s), text: s.text, captions: s.captions ?? null, pauseAfter: s.pauseAfter ?? null})),
    aligner: c.aligner,
    manual: c.manualTiming,
    logic: c.timelineLogic,
  });

  const mixBase = {
    kind: 'mix',
    takes,
    pacing: doc.pacing,
    gaps: doc.narration.blocks.map((b) => b.gapAfterSec ?? null),
    events: c.soundEvents,
    assets: c.soundAssets,
    params: c.mixParams,
  };
  const mix = {draft: hashJson({...mixBase, mode: 'draft'}), final: hashJson({...mixBase, mode: 'final', mastering: c.masteringParams})};

  const content = hashJson(renderContent(doc));
  const render = {} as Expected['render'];
  for (const kind of ['draft', 'final'] as const) {
    const parts: RenderParts = {
      content,
      theme: c.theme,
      timing: hashJson({expected: timing, blob: up.timing}),
      mix: hashJson({expected: mix[kind], blob: up.mix[kind]}),
      assets: c.assets,
      fonts: c.fonts,
      code: c.code,
      versions: c.versions,
      settings: hashJson({settings: c.renderSettings, mastered: kind === 'final'}),
    };
    render[kind] = {hash: hashJson({kind: 'render', mode: kind, parts}), parts};
  }
  return {take, timing, mix, render};
}
