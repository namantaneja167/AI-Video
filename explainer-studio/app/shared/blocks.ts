// Splitting and merging narration blocks. A block is the unit of generation: consecutive segments narrated in one pass, so a segment
// is never cut in the middle and the order of the segments never changes. Pure: each edit returns a new document or the reason it
// is refused. What it does to saved takes is worked out from the dependency hashes by the voice service, not here.
import type {EpisodeV2} from '../../src/schema2.ts';

type Block = EpisodeV2['narration']['blocks'][number];

/** Past this many spoken words a block is long for one generation (the engine stops at 600 tokens, about 48 s of speech). */
export const BLOCK_WORDS_WARN = 60;
export const BLOCK_WORDS_MAX = 100;

export const spokenWords = (doc: EpisodeV2, segmentIds: string[]): number => {
  const seg = new Map(doc.narration.segments.map((s) => [s.id, s]));
  return segmentIds.reduce((n, id) => n + (seg.get(id) ? (seg.get(id)!.speech ?? seg.get(id)!.text).split(/\s+/).filter(Boolean).length : 0), 0);
};

export type BlockOp = {op: 'split'; block: string; after: string} | {op: 'merge'; block: string};
export type BlockEdit =
  | {ok: true; doc: EpisodeV2; label: string; before: Block[]; after: Block[]; warnings: string[]}
  | {ok: false; reason: string};

const freshId = (blocks: Block[]): string => {
  const used = new Set(blocks.map((b) => b.id));
  let n = Math.max(0, ...blocks.map((b) => Number(/^b(\d+)$/.exec(b.id)?.[1] ?? 0))) + 1;
  while (used.has(`b${n}`)) n++;
  return `b${n}`;
};
const strip = (b: Block): Block => { const {gapAfterSec, ...rest} = b; return gapAfterSec === undefined ? rest : {...rest, gapAfterSec}; };

export function editBlocks(doc: EpisodeV2, edit: BlockOp): BlockEdit {
  const blocks = doc.narration.blocks;
  const i = blocks.findIndex((b) => b.id === edit.block);
  if (i < 0) return {ok: false, reason: `There is no block "${edit.block}".`};
  const b = blocks[i];

  if (edit.op === 'split') {
    const at = b.segments.indexOf(edit.after);
    if (at < 0) return {ok: false, reason: `Segment ${edit.after} is not in block ${b.id}.`};
    if (at === b.segments.length - 1) return {ok: false, reason: `${edit.after} is the last segment of ${b.id}, so there is nothing after it to split off. A segment is never cut in the middle.`};
    const id = freshId(blocks);
    const first: Block = {id: b.id, segments: b.segments.slice(0, at + 1)};
    // the explicit silence after the block belongs to its end, so it goes with the second part
    const second: Block = {id, segments: b.segments.slice(at + 1), ...(b.gapAfterSec !== undefined ? {gapAfterSec: b.gapAfterSec} : {})};
    const next = [...blocks.slice(0, i), first, second, ...blocks.slice(i + 1)];
    return {ok: true, doc: {...doc, narration: {...doc.narration, blocks: next}}, label: `Split block ${b.id} after ${edit.after} (new block ${id})`, before: [b], after: [first, second], warnings: []};
  }

  const nextBlock = blocks[i + 1];
  if (!nextBlock) return {ok: false, reason: `${b.id} is the last block, so there is no block after it to join.`};
  const seg = new Map(doc.narration.segments.map((s) => [s.id, s]));
  const joint = b.segments[b.segments.length - 1];
  const pause = seg.get(joint)?.pauseAfter;
  if (pause !== undefined && pause > 0) return {ok: false, reason: `${joint} has a pause of ${pause} s after it. Inside one block that pause cannot be applied (a block is one continuous recording), so remove the pause in the script editor first, or keep these as two blocks.`};
  const segments = [...b.segments, ...nextBlock.segments];
  const words = spokenWords(doc, segments);
  if (words > BLOCK_WORDS_MAX) return {ok: false, reason: `Joined, ${b.id} and ${nextBlock.id} would be ${words} words. The voice engine stops after about 48 s of speech (600 tokens), which is roughly ${BLOCK_WORDS_MAX} words, so blocks are kept under that.`};
  const merged: Block = {id: b.id, segments, ...(nextBlock.gapAfterSec !== undefined ? {gapAfterSec: nextBlock.gapAfterSec} : {})};
  const next = [...blocks.slice(0, i), strip(merged), ...blocks.slice(i + 2)];
  return {
    ok: true, doc: {...doc, narration: {...doc.narration, blocks: next}}, label: `Joined blocks ${b.id} and ${nextBlock.id} into ${b.id}`, before: [b, nextBlock], after: [merged],
    warnings: words > BLOCK_WORDS_WARN ? [`${words} words is long for one generation: it takes longer, and a long block is harder to re-roll for one flawed sentence.`] : [],
  };
}
