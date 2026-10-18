// Inputs this build cannot apply. They are rejected before any model is loaded rather than recorded in a hash and ignored.
import type {EpisodeV2} from '../src/schema2.ts';
import {ACCENT_BUS_RANGE, accentProblems} from '../src/library/accents.ts';

const empty = (v: unknown): boolean => v === undefined || v === null || (Array.isArray(v) && v.length === 0) || (typeof v === 'object' && !Array.isArray(v) && Object.keys(v as object).length === 0);

export const MIX_PARAM_KEYS = ['voiceGainDb', 'accentBusDb', 'accentDuck', 'mixScriptSha256'];

/** Reasons this episode and these settings cannot be produced by this build. Empty means they can. */
export function unsupportedInputs(doc: EpisodeV2, values: Record<string, unknown>): string[] {
  const out: string[] = [];
  if (!empty(values.manualTiming)) out.push('Manual timing corrections are set, but this build does not apply them (planned with the timing editor). Clear the manual timing setting.');

  const last = new Set(doc.narration.blocks.map((b) => b.segments[b.segments.length - 1]));
  const inside = doc.narration.segments.filter((s) => s.pauseAfter !== undefined && s.pauseAfter > 0 && !last.has(s.id)).map((s) => s.id);
  if (inside.length) out.push(`Segment pause(s) inside a narration block (${inside.join(', ')}) cannot be applied: a block is one continuous recording. Start a new block after that segment, or remove the pause.`);

  if (!empty(values.soundEvents)) out.push(...accentProblems(values.soundEvents));
  if (!empty(values.soundAssets)) out.push('Sound assets are set, but this build has no asset library: only the built-in synthesized accents are supported. Clear the sound assets.');

  const mp = values.mixParams;
  if (!empty(mp)) {
    if (typeof mp !== 'object' || Array.isArray(mp)) out.push('Mix parameters must be an object.');
    else {
      const extra = Object.keys(mp as object).filter((k) => !MIX_PARAM_KEYS.includes(k));
      if (extra.length) out.push(`Mix parameter(s) ${extra.join(', ')} are not supported; applied: voiceGainDb, accentBusDb, accentDuck.`);
      const g = (mp as Record<string, unknown>).voiceGainDb;
      if (g !== undefined && !(typeof g === 'number' && g >= -24 && g <= 12)) out.push('voiceGainDb must be a number from -24 to 12.');
      for (const [k, [lo, hi]] of Object.entries(ACCENT_BUS_RANGE)) {
        const v = (mp as Record<string, unknown>)[k];
        if (v !== undefined && !(typeof v === 'number' && v >= lo && v <= hi)) out.push(`${k} must be a number from ${lo} to ${hi}.`);
      }
    }
  }
  return out;
}

export const RENDER_SETTING_KEYS = ['width', 'height', 'fps', 'codec', 'crf', 'audio'];
/** The render worker draws a fixed 1080 x 1920, 30 fps, h264 + aac composition; settings that ask for anything else would be ignored. */
export function renderSettingsProblems(v: unknown): string[] {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return ['render settings are not recorded'];
  const s = v as Record<string, unknown>;
  const out: string[] = [];
  const extra = Object.keys(s).filter((k) => !RENDER_SETTING_KEYS.includes(k));
  if (extra.length) out.push(`render setting(s) ${extra.join(', ')} are not supported`);
  for (const [k, want] of [['width', 1080], ['height', 1920], ['fps', 30], ['codec', 'h264'], ['audio', 'aac']] as const) if (s[k] !== undefined && s[k] !== want) out.push(`render setting ${k}=${String(s[k])} is not supported (this build renders ${want})`);
  if (typeof s.crf !== 'number' || !(s.crf >= 0 && s.crf <= 51)) out.push('render setting crf must be a number from 0 to 51');
  return out;
}
