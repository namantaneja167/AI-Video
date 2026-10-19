// Caption emphasis: a segment's word ranges mapped onto the caption phrases of a timeline. Pure (no imports), so Node and the
// browser use the same mapping.
export type EmphasisRange = {from: number; to: number};

/** For each caption (in order), the emphasis ranges relative to that phrase's own words, or undefined when none. */
export function emphasisPerCaption(
  captions: {segment: string; words: unknown[]}[],
  segments: {id: string; emphasis?: EmphasisRange[]}[],
): ([number, number][] | undefined)[] {
  const used: Record<string, number> = {};
  return captions.map((cap) => {
    const o = used[cap.segment] ?? 0;
    const n = cap.words.length;
    used[cap.segment] = o + n;
    const ranges = (segments.find((s) => s.id === cap.segment)?.emphasis ?? [])
      .filter((r) => r.to > o && r.from < o + n)
      .map((r) => [Math.max(r.from, o) - o, Math.min(r.to, o + n) - o] as [number, number]);
    return ranges.length ? ranges : undefined;
  });
}
