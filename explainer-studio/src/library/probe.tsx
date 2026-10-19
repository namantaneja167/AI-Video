// The browser probe: measures the elements a scene has marked (data-probe attributes) in the same browser engine that renders
// the video, and prints the result as one console line for the check worker to read. It only runs when the composition is given
// probe input; a normal render and the preview never mount it and the attributes change nothing visible.
//
// Marks:  data-probe="text|box|zone"  data-probe-id  data-essential="0" (secondary text)  data-parent=<id of the containing box>
//         data-may-overlap-mascot="1"  data-zone="caption"
import React, {useEffect, useState} from 'react';
import {continueRender, delayRender} from 'remotion';
import {loadBundledFonts} from './fonts';
import {PROBE_LOG, type ProbeElement, type ProbeFont, type ProbeSample} from './probeTypes';

const GENERIC = new Set(['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'ui-sans-serif', 'ui-serif', 'ui-monospace', 'ui-rounded', 'emoji', 'math', 'fangsong']);
const SYSTEM = new Set(['system-ui', '-apple-system', 'blinkmacsystemfont']);

const families = (stack: string): string[] => stack.split(',').map((f) => f.trim().replace(/^["']|["']$/g, '')).filter(Boolean);

/** A named family is usable when text set in it measures differently from the bare generic fallbacks (the standard width test). */
function usable(family: string): boolean {
  const ctx = document.createElement('canvas').getContext('2d');
  if (!ctx) return true;
  const probe = 'mmmmmmmmmmlli wWi 0123456789';
  const w = (f: string) => { ctx.font = `72px ${f}`; return ctx.measureText(probe).width; };
  return w(`"${family}", monospace`) !== w('monospace') || w(`"${family}", serif`) !== w('serif');
}

export function resolveStack(stack: string): ProbeFont {
  const list = families(stack);
  let resolved: string | null = null;
  for (const f of list) {
    if (GENERIC.has(f.toLowerCase())) break;
    if (SYSTEM.has(f.toLowerCase())) { resolved = 'system-ui'; break; }
    if (usable(f)) { resolved = f; break; }
  }
  return {stack, first: list[0] ?? '', resolved};
}

const round = (n: number) => Math.round(n * 10) / 10;

/** A transform that is not the identity: the element is part-way through an entrance (or is moved on purpose). */
function isMoving(transform: string): boolean {
  const m = /^matrix\(([^)]+)\)$/.exec(transform);
  if (!m) return transform !== 'none' && transform !== '';
  const [a, b, c, d, e, f] = m[1].split(',').map(Number);
  return !(Math.abs(a - 1) < 1e-3 && Math.abs(d - 1) < 1e-3 && Math.abs(b) < 1e-3 && Math.abs(c) < 1e-3 && Math.abs(e) < 0.5 && Math.abs(f) < 0.5);
}

function opacityOf(el: Element): number {
  let o = 1;
  for (let e: Element | null = el; e; e = e.parentElement) o *= Number(getComputedStyle(e).opacity);
  return o;
}

export function collectProbe(root: ParentNode, frame: number, t: number, scene: string): ProbeSample {
  const nodes = [...root.querySelectorAll<HTMLElement>('[data-probe]')];
  const byId = new Map(nodes.map((n) => [n.dataset.probeId ?? '', n]));
  const elements: ProbeElement[] = [];
  const stacks = new Set<string>();
  for (const n of nodes) {
    const kind = n.dataset.probe as ProbeElement['kind'];
    const r = n.getBoundingClientRect();
    const rect = {x: round(r.left), y: round(r.top), w: round(r.width), h: round(r.height)};
    const el: ProbeElement = {id: n.dataset.probeId ?? '', kind, essential: n.dataset.essential !== '0', rect, opacity: Math.round(opacityOf(n) * 100) / 100};
    if (isMoving(getComputedStyle(n).transform)) el.moving = true;
    if (n.dataset.zone === 'caption') el.zone = 'caption';
    if (n.dataset.mayOverlapMascot === '1') el.mayOverlapMascot = true;
    if (n.dataset.parent) el.parent = n.dataset.parent;
    if (kind === 'text') {
      const cs = getComputedStyle(n);
      el.fontPx = round(parseFloat(cs.fontSize));
      el.stack = cs.fontFamily;
      stacks.add(cs.fontFamily);
      el.text = (n.textContent ?? '').slice(0, 80);
      const box = n.dataset.parent ? byId.get(n.dataset.parent) : undefined;
      const b = box?.getBoundingClientRect();
      el.clipped = {
        x: n.scrollWidth > n.clientWidth + 1 || (!!b && (r.right > b.right + 1 || r.left < b.left - 1)),
        y: n.scrollHeight > n.clientHeight + 1 || (!!b && (r.bottom > b.bottom + 1 || r.top < b.top - 1)),
      };
    }
    elements.push(el);
  }
  const faces = [...document.fonts].map((f) => ({family: f.family.replace(/^["']|["']$/g, ''), weight: f.weight, status: f.status}));
  return {frame, t, scene, elements, fonts: [...stacks].map(resolveStack), faces};
}

/** Mounted by the composition only when it is given probe input. Holds the frame until fonts are ready, measures, prints. */
export const ProbeReporter: React.FC<{frame: number; t: number; scene: string; bundledFonts?: boolean}> = ({frame, t, scene, bundledFonts}) => {
  const [handle] = useState(() => delayRender('studio probe'));
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        // the bundled faces are added to the document only after they have loaded, so fonts.ready alone can resolve before they exist
        if (bundledFonts) await loadBundledFonts().catch(() => undefined);
        // fonts.ready can resolve before a face has started to load when the machine is busy, which would measure text in a fallback font:
        // every declared face is loaded (or its failure is recorded as 'error') before anything is measured
        await Promise.all([...document.fonts].map((f) => f.load().catch(() => undefined)));
        await document.fonts.ready;
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        if (live) console.log(`${PROBE_LOG} ${JSON.stringify(collectProbe(document.body, frame, t, scene))}`);
      } finally { continueRender(handle); }
    })();
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
};
