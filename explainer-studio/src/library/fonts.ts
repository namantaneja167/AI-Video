import {cancelRender, continueRender, delayRender, staticFile} from 'remotion';
import {useEffect, useState} from 'react';
import {MONO, SANS} from '../art/palette';
import manifest from '../../public/library/fonts/manifest.json';

export type FontSet = {sans: string; mono: string};
/** `system`: the prototype's stack (SF Pro first), the reference for comparisons. `bundled`: redistributable fonts from public/library/fonts. */
export const FONT_SETS: Record<'system' | 'bundled', FontSet> = {
  system: {sans: SANS, mono: MONO},
  bundled: {sans: `"Inter", ${SANS}`, mono: `"JetBrains Mono", ${MONO}`},
};
export const fontSetFor = (style: string): FontSet => (style === 'pip-paper-bundled' ? FONT_SETS.bundled : FONT_SETS.system);

let bundled: Promise<void> | null = null;
/** Loads the bundled faces once per page; the probe awaits the same promise so it never measures before they are in the document. */
export const loadBundledFonts = (): Promise<void> => (bundled ??= Promise.all(
  manifest.files.map(async (f) => {
    const face = new FontFace(f.family, `url(${staticFile(`library/fonts/${f.file}`)})`, {weight: f.weight});
    document.fonts.add(await face.load());
  }),
).then(() => undefined));

/** Loads the bundled fonts before the first frame; a font that fails to load fails the render. */
export function useBundledFonts(enabled: boolean): void {
  const [handle] = useState(() => (enabled ? delayRender('bundled fonts') : null));
  useEffect(() => {
    if (handle === null) return;
    loadBundledFonts().then(() => continueRender(handle), (e) => cancelRender(e));
  }, [handle]);
}
