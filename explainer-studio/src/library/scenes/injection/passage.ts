// The passage the three presentation proofs share: "It opens a shop page ... the shop has hijacked your task" (segments s2 to s4 of the
// prompt-injection episode). Cues are resolved here from the recorded word times, so no timing is changed or re-measured.
import {resolveCues, type CueSegment, type CueSpec} from '../../cues.ts';

export const PASSAGE_CUES: CueSpec = {
  open: {segment: 's2', at: 'start'}, alongside: {segment: 's2', at: {word: 'Alongside'}}, someone: {segment: 's2', at: {word: 'someone'}},
  planted: {segment: 's2', at: {word: 'planted'}}, instruction: {segment: 's2', at: {word: 'instruction'}},
  ignore: {segment: 's3', at: 'start'}, budget: {segment: 's3', at: {word: 'budget'}}, recommend: {segment: 's3', at: {word: 'Recommend'}}, product: {segment: 's3', at: {word: 'product'}}, quote_end: {segment: 's3', at: 'end'},
  if: {segment: 's4', at: 'start'}, treats: {segment: 's4', at: {word: 'treats'}}, command: {segment: 's4', at: {word: 'command'}}, shop: {segment: 's4', at: {word: 'shop'}}, hijacked: {segment: 's4', at: {word: 'hijacked'}}, end: {segment: 's4', at: 'end'},
};
/** Seconds before the first word and after the last word that belong to the passage. */
export const WINDOW_LEAD = 0.32, WINDOW_TAIL = 0.3;
export const passageCues = (segments: CueSegment[]): Record<string, number> => resolveCues(PASSAGE_CUES, segments);
export const passageWindow = (segments: CueSegment[]): {from: number; to: number} => {
  const c = passageCues(segments);
  return {from: Math.round((c.open - WINDOW_LEAD) * 100) / 100, to: Math.round((c.end + WINDOW_TAIL) * 100) / 100};
};
/** The treatments a prompt-injection scene can opt in to with `params.treatment`; absent means the baseline scene. */
/** `-r2` are the revised versions after the editorial review; the first three stay as they were. */
export const INJECTION_TREATMENTS = ['interface', 'investigation', 'mechanism', 'interface-r2', 'investigation-r2', 'mechanism-r2'] as const;
export type InjectionTreatment = (typeof INJECTION_TREATMENTS)[number];
