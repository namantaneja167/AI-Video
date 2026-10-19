// Plain-language change summaries between two episode documents, for the revision list. Pure.
import type {EpisodeV2} from '../../src/schema2.ts';
import {compareToBuild} from './compare.ts';

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const ids = (xs: string[]) => xs.join(', ');

/** What changed from `prev` to `doc`, in sentences. An empty list means nothing the author edits differs. */
export function summarizeChange(prev: EpisodeV2 | null, doc: EpisodeV2): string[] {
  if (!prev) return [`Starts with ${doc.narration.segments.length} segments in ${doc.scenes.length} scene${doc.scenes.length === 1 ? '' : 's'}`];
  const out: string[] = [];
  const d = compareToBuild(prev, doc);
  const segs = Object.values(d.segments);
  const spoken = segs.filter((s) => s.spoken && !s.added).map((s) => s.id);
  const caption = segs.filter((s) => (s.text || s.captions) && !s.spoken && !s.added).map((s) => s.id);
  const emphasis = segs.filter((s) => s.emphasis).map((s) => s.id);
  const prevSeg = new Map(prev.narration.segments.map((s) => [s.id, s]));
  const pause = doc.narration.segments.filter((s) => prevSeg.has(s.id) && prevSeg.get(s.id)!.pauseAfter !== s.pauseAfter).map((s) => s.id);
  const added = segs.filter((s) => s.added).map((s) => s.id);
  if (spoken.length) out.push(`Spoken text changed in ${ids(spoken)}`);
  if (caption.length) out.push(`Caption text changed in ${ids(caption)}`);
  if (emphasis.length) out.push(`Emphasis changed in ${ids(emphasis)}`);
  if (pause.length) out.push(`Pause changed after ${ids(pause)}`);
  if (added.length) out.push(`Added ${ids(added)}`);
  if (d.removed.length) out.push(`Removed ${ids(d.removed)}`);
  if (!same(prev.scenes, doc.scenes)) {
    const before = new Map(prev.scenes.map((x) => [x.id, x]));
    const after = new Map(doc.scenes.map((x) => [x.id, x]));
    const added = [...after.keys()].filter((k) => !before.has(k));
    const removed = [...before.keys()].filter((k) => !after.has(k));
    const changed = [...after.keys()].filter((k) => before.has(k) && !same(before.get(k), after.get(k)));
    out.push(`Scenes: ${[added.length && `added ${ids(added)}`, removed.length && `removed ${ids(removed)}`, changed.length && `changed ${ids(changed)}`].filter(Boolean).join('; ')}`);
  }
  if (prev.style !== doc.style || !same(prev.chapters, doc.chapters) || !same(prev.beats, doc.beats)) out.push('Scene settings changed');
  if (!same(prev.voice, doc.voice) || !same(prev.pacing, doc.pacing)) out.push('Voice or pacing changed');
  if (!same(prev.narration.blocks, doc.narration.blocks)) out.push(`Narration blocks are now ${doc.narration.blocks.map((b) => `${b.id} (${b.segments.length === 1 ? b.segments[0] : `${b.segments[0]} to ${b.segments[b.segments.length - 1]}`})`).join(', ')}`);
  if (prev.title !== doc.title || prev.learningObjective !== doc.learningObjective) out.push('Title or objective changed');
  if (!same(prev.sources, doc.sources)) out.push('Sources changed');
  if (!same(prev.reviewNotes, doc.reviewNotes)) {
    const added = doc.reviewNotes.length - prev.reviewNotes.length;
    out.push(added > 0 && same(prev.reviewNotes, doc.reviewNotes.slice(0, prev.reviewNotes.length)) ? `${added === 1 ? 'Note' : `${added} notes`} added` : 'Notes changed');
  }
  return out;
}

const KIND: Record<string, string> = {
  adopt: 'Imported episode', auto: 'Checkpoint', job: 'Rebuild started', restore: 'Restore', import: 'Imported file edit', create: 'Episode created', 'script-import': 'Script imported', 'scenes-apply': 'Scenes applied', 'scenes-before': 'Before scenes were applied', 'blocks-edit': 'Narration blocks changed', approval: 'Approval', milestone: 'Milestone', final: 'Final',
};
/** A short name for what created a revision. */
export const revisionKindLabel = (kind: string, label: string | null): string => (kind === 'restore' && label ? label.replace(/^restored/, 'Restored') : KIND[kind] ?? kind);

/** A one-line version of the summary for compact lists. */
export const shortSummary = (lines: string[], max = 2): string => (lines.length <= max ? lines.join('; ') : `${lines.slice(0, max).join('; ')}; and ${lines.length - max} more`) || 'No change to the text';
