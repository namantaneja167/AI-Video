// What a scene needs from the pipeline, as plain data (no React): its cue rules. Node (the mix) and the browser (the
// scene) read the same rules, so an accent and the picture it belongs to cannot disagree about when a cue happens.
import type {CueSpec} from './cues';

/** The rules `scripts/pip_scene_timing.py` used to derive the prototype's cues, as data. */
export const PIP_10X_CUES: CueSpec = {
  card_in: {t: 0.05},
  claim: {segment: 's1', at: 'start', dt: -0.08},
  sub: {segment: 's1', at: {word: 'faster'}},
  bars: {segment: 's2', at: 'start'},
  notice: {segment: 's3', at: 'start', dt: -0.05},
  asterisk_pulse: {segment: 's3', at: {word: 'faster'}},
  point: {segment: 's3', at: {word: 'at'}, dt: -0.12},
  callout: {segment: 's4', at: 'start', dt: -0.05},
  callout_text: {segment: 's4', at: {word: 'tiny'}, dt: -0.05},
  point_release: {segment: 's4', at: 'start', dt: 0.95},
  contrast: {segment: 's5', at: 'start', dt: -0.05},
  lane_long: {segment: 's5', at: {word: 'long'}, dt: -0.05},
  palms: {segment: 's5', at: {word: 'different'}, dt: -0.18},
  contrast_out: {segment: 's6a', at: 'start', dt: 0.1},
  face_camera: {segment: 's6a', at: 'start'},
  resolve1: {segment: 's6b', at: 'start', dt: -0.05},
  resolve2: {segment: 's6b', at: 'end', dt: -0.42},
  voice_end: {segment: 's6b', at: 'end'},
};

/**
 * The AI context-window explainer. Segments are named by position within the scene (0 = "A model can only read so much at
 * once." ... 7 = "Some stop. Others drop older text."), so the same rules work in any episode that uses the scene.
 */
export const CONTEXT_WINDOW_CUES: CueSpec = {
  window_in: {segment: 0, at: 'start', dt: -0.08},
  label: {segment: 1, at: {word: 'context'}, dt: -0.05},
  prompt_in: {segment: 2, at: 'start', dt: -0.05},
  split: {segment: 2, at: {word: 'pieces'}, dt: -0.2},
  tokens_fly: {segment: 2, at: {word: 'called'}, dt: 0.1},
  history: {segment: 3, at: 'start', dt: 0.05},
  history_end: {segment: 3, at: 'end', dt: -0.1},
  reply_start: {segment: 4, at: 'start', dt: -0.05},
  reply_end: {segment: 4, at: 'end', dt: -0.05},
  input_word: {segment: 5, at: {word: 'input'}, dt: -0.05},
  output_word: {segment: 5, at: {word: 'output'}, dt: -0.1},
  share: {segment: 5, at: {word: 'share'}, dt: -0.05},
  share_end: {segment: 5, at: 'end'},
  fill_more: {segment: 6, at: 'start', dt: -0.05},
  full: {segment: 6, at: {word: 'fills'}, dt: 0.3},
  leave: {segment: 7, at: 'start', dt: -0.3},
  stop: {segment: 7, at: {word: 'stop'}, dt: -0.05},
  drop: {segment: 7, at: {word: 'Others'}, dt: -0.05},
  back: {segment: 7, at: 'end', dt: 0.3},
  settled: {segment: 7, at: 'end', dt: 1.2},
  voice_end: {segment: 7, at: 'end'},
};

/** Application-cache example: explicit invalidation, with persistent source and copied value. */
export const CACHE_JOURNEY_CUES: CueSpec = {
  intro: {segment: 0, at: 'start'},
  miss: {segment: 1, at: {word: 'Nothing'}},
  fetch: {segment: 2, at: {word: 'fetches'}},
  result: {segment: 2, at: {word: 'Twenty'}},
  store: {segment: 3, at: {word: 'copy'}},
  repeat: {segment: 4, at: 'start'},
  hit: {segment: 4, at: {word: 'hit'}},
  change: {segment: 5, at: {word: 'changes'}},
  stale: {segment: 6, at: 'start'},
  evict: {segment: 7, at: {word: 'invalidate'}},
  refresh: {segment: 7, at: {word: 'fetches'}},
  fresh: {segment: 7, at: {word: 'stores'}},
  resolve: {segment: 8, at: 'start'},
  voice_end: {segment: 8, at: 'end'},
};

/** Tokens explainer (AI Maxxing 01). Segments are named by position within the scene; words are matched on the narration. */
export const TOKEN_JOURNEY_CUES: CueSpec = {
  example_start: {segment: 0, at: {word: "You"}},
  intro: {segment: 0, at: 'start'},
  type: {segment: 0, at: {word: 'Remind'}},
  words: {segment: 0, at: {word: 'Eight'}},
  split: {segment: 1, at: {word: 'tokenizer'}},
  pieces: {segment: 1, at: {word: 'pieces'}},
  break: {segment: 2, at: {word: 'Remind'}},
  jio: {segment: 2, at: {word: 'Jio'}},
  numbers: {segment: 3, at: {word: 'ID'}},
  model: {segment: 3, at: {word: 'model'}},
  count: {segment: 4, at: {word: 'count'}},
  ten: {segment: 4, at: {word: 'ten'}},
  language: {segment: 5, at: 'start'},
  english: {segment: 5, at: {word: 'English'}},
  hindi: {segment: 5, at: {word: 'Hindi'}},
  other: {segment: 6, at: 'start'},
  check: {segment: 7, at: 'start'},
  resolve: {segment: 8, at: 'start'},
  voice_end: {segment: 8, at: 'end'},
};

/** Nine-line story scenes (prompt injection, rotating ticket): the start of each line, where the explanation begins and the ending. */
export const STORY_CUES: CueSpec = {
  ...Object.fromEntries(Array.from({length: 9}, (_, i) => ['s' + i, {segment: i, at: 'start' as const}])),
  explain: {segment: 1, at: 'start'}, resolve: {segment: 8, at: 'start'}, voice_end: {segment: 8, at: 'end'},
};

export const SCENE_CUES: Record<string, CueSpec> = {
  'pip-scene-10x': PIP_10X_CUES,
  'context-window': CONTEXT_WINDOW_CUES,
  'cache-journey': CACHE_JOURNEY_CUES,
  'token-journey': TOKEN_JOURNEY_CUES,
  'rotating-ticket': STORY_CUES,
  'prompt-injection': STORY_CUES,
};
