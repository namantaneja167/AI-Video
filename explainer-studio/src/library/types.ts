import type {FontSet} from './fonts';

export type Word = {text: string; start: number; end: number};
export type TlSegment = {id: string; start: number; end: number; words: Word[]};
export type TlCaption = {segment: string; text: string; words: Word[]; emphasis?: [number, number][]};
export type Timeline = {
  version: number;
  durationSec: number;
  audio: string;
  segments: TlSegment[];
  captions: TlCaption[];
  scenes: {id: string; type: string; start: number; end: number}[];
  cues?: Record<string, Record<string, number>>;
  mouth?: number[];
};
export type EpisodeScene = {id: string; type: string; params: Record<string, unknown>; layout?: {template?: string; captionZone?: string; mascot?: {mode?: string; position?: string; scale?: number}}; segments: string[]};
export type LibData = {
  episode: {id: string; style?: string; scenes: EpisodeScene[]};
  timeline: Timeline;
  /** Scene-specific data that does not come from the pipeline (e.g. the original prototype timing), keyed by scene id. */
  sceneData?: Record<string, unknown>;
};

export type SceneProps = {
  scene: EpisodeScene;
  timeline: Timeline;
  segments: TlSegment[];
  cues: Record<string, number>;
  /** Seconds on the episode clock. */
  t: number;
  fps: number;
  fonts: FontSet;
  sceneData?: unknown;
  audioSrc: string;
};
