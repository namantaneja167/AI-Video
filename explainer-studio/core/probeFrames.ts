// Which frames the layout probe looks at: where scenes begin and settle, where their cues fire (cards appear, Pip acts), the middle of
// the captions, and a regular grid. Thinned evenly to a cap so a long video does not mean hundreds of browser frames.
export type ProbeTimeline = {
  durationSec: number;
  scenes: {id: string; start: number; end: number}[];
  cues?: Record<string, Record<string, number>>;
  captions?: {words: {start: number; end: number}[]}[];
};

export function probeFrames(tl: ProbeTimeline, fps = 30, max = 48): number[] {
  const total = Math.max(1, Math.ceil(tl.durationSec * fps));
  const want: number[] = [];
  for (const s of tl.scenes) { want.push(s.start + 0.9, (s.start + s.end) / 2, s.end - 0.35); }
  for (const [scene, cues] of Object.entries(tl.cues ?? {})) {
    const range = tl.scenes.find((s) => s.id === scene);
    for (const t of Object.values(cues)) want.push(range ? Math.min(range.end - 0.2, Math.max(range.start, t + 0.9)) : t + 0.9);
  }
  const caps = tl.captions ?? [];
  caps.forEach((c, i) => { if (c.words.length && (caps.length <= 24 || i % 2 === 0)) want.push((c.words[0].start + c.words[c.words.length - 1].end) / 2); });
  for (let t = 1; t < tl.durationSec; t += 2.5) want.push(t);
  const sorted = want.filter((t) => Number.isFinite(t)).map((t) => Math.min(tl.durationSec - 0.1, Math.max(0.1, t))).sort((a, b) => a - b);
  const kept: number[] = [];
  for (const t of sorted) if (!kept.length || t - kept[kept.length - 1] >= 0.3) kept.push(t);
  const thinned = kept.length <= max ? kept : Array.from({length: max}, (_, i) => kept[Math.round((i * (kept.length - 1)) / (max - 1))]);
  return [...new Set(thinned.map((t) => Math.min(total - 1, Math.round(t * fps))))];
}
