import React from 'react';
import {AbsoluteFill} from 'remotion';
import {P} from '../art/palette';
import {Backdrop} from '../art/parts';
import {clamp01, easeOut} from '../anim';
import type {FontSet} from './fonts';

/** Reference positions at 1080 x 1920 from docs/studio/pip-brand-standards.md: title y=255, supporting sentence y=365, strip y=435. */
export type StageStripProps = {stages: readonly string[]; active: number; fonts: FontSet; top?: number};

/** Every stage label stays visible; the active one is charcoal on cream and the rest are muted paper grey. */
export const StageStrip: React.FC<StageStripProps> = ({stages, active, fonts, top = 435}) => (
  <div style={{position: 'absolute', left: 80, right: 80, top, display: 'flex', gap: 12}}>
    {stages.map((label, i) => (
      <div key={label} style={{flex: 1, height: 60, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 11, background: i === active ? P.ink : '#EAE5DA', color: i === active ? '#FFFDF8' : '#999488', fontFamily: fonts.mono, fontSize: 28, fontWeight: 800}}>{label}</div>
    ))}
  </div>
);

export type ChapterHeaderProps = StageStripProps & {title: string; supporting: string};

/** Large chapter title, one supporting sentence and the full labelled stage strip. The topic decides the words and which stage is active. */
export const ChapterHeader: React.FC<ChapterHeaderProps> = ({title, supporting, stages, active, fonts}) => (
  <>
    <div style={{position: 'absolute', left: 80, top: 365, maxWidth: 920, fontSize: 34, fontWeight: 650, color: P.ink2}}>{supporting}</div>
    <StageStrip stages={stages} active={active} fonts={fonts} />
    <div style={{position: 'absolute', left: 80, right: 80, top: 255, fontSize: 76, lineHeight: 1.08, letterSpacing: '-0.045em', fontWeight: 850, whiteSpace: 'pre-line', color: P.ink}}>{title}</div>
  </>
);

export type TakeawayPoint = {label: string; text: string; color: string};
export type FullPageTakeawayProps = {
  t: number;
  /** Second at which the takeaway replaces the working diagram. */
  start: number;
  fonts: FontSet;
  /** Small mono label above the headline. */
  label: string;
  /** Short progress counter shown top right, for example "5 / 5"; omit for none. */
  counter?: string;
  /** First line in ink, second line in `emphasisColor`. */
  lead: string;
  emphasis: string;
  emphasisColor: string;
  /** At most two short supporting points. */
  points: readonly [TakeawayPoint] | readonly [TakeawayPoint, TakeawayPoint];
  /** Scope note that states the example's limits. */
  note: string;
  /** The mascot, placed by the topic's own scene so its performance stays unchanged. */
  mascot?: React.ReactNode;
};

/** One large takeaway that replaces the busy diagram. The shared brand header and captions are drawn by the episode above this layer. */
export const FullPageTakeaway: React.FC<FullPageTakeawayProps> = ({t, start, fonts, label, counter, lead, emphasis, emphasisColor, points, note, mascot}) => {
  if (t < start) return null;
  return (
    <AbsoluteFill style={{opacity: easeOut(clamp01((t - start) / 0.35))}}>
      <Backdrop drift={0} />
      <div style={{position: 'absolute', left: 80, top: 235, fontFamily: fonts.mono, fontSize: 29, fontWeight: 750, letterSpacing: '0.06em', color: emphasisColor}}>{label}</div>
      {counter ? <div style={{position: 'absolute', right: 80, top: 215, width: 190, fontFamily: fonts.mono, fontSize: 24, fontWeight: 750, color: P.ink2, textAlign: 'right'}}>{counter}<div style={{height: 7, borderRadius: 8, background: '#E8772E', marginTop: 12}} /></div> : null}
      <div style={{position: 'absolute', left: 80, right: 80, top: 365, fontSize: 106, lineHeight: 1.07, fontWeight: 850, letterSpacing: '-0.05em', color: P.ink}}>{lead}<br /><span style={{color: emphasisColor}}>{emphasis}</span></div>
      <div style={{position: 'absolute', left: 80, right: 80, top: 735, display: 'flex', flexDirection: 'column', gap: 30}}>
        {points.map((p) => (
          <div key={p.label} style={{padding: '34px 38px', borderRadius: 28, background: '#FFFDF8', border: `2px solid ${P.line}`, borderLeft: `9px solid ${p.color}`}}>
            <div style={{fontFamily: fonts.mono, fontSize: 27, fontWeight: 750, color: p.color, marginBottom: 13}}>{p.label}</div>
            <div style={{fontSize: 43, lineHeight: 1.18, fontWeight: 750, color: P.ink}}>{p.text}</div>
          </div>
        ))}
      </div>
      {mascot}
      <div style={{position: 'absolute', left: 80, right: 80, top: 1750, color: P.muted, fontSize: 25, lineHeight: 1.4, textAlign: 'center', whiteSpace: 'pre-line'}}>{note}</div>
    </AbsoluteFill>
  );
};

export type ChapterTagProps = {stages: readonly string[]; active: number; fonts: FontSet; top?: number; opacity?: number};

/** A compact current-chapter label for shots that need the frame: the active stage and one dot per stage. The full StageStrip stays the default navigation. */
export const ChapterTag: React.FC<ChapterTagProps> = ({stages, active, fonts, top = 244, opacity = 1}) => (
  <div style={{position: 'absolute', left: 80, top, display: 'flex', alignItems: 'center', gap: 16, opacity, pointerEvents: 'none'}}>
    <div style={{padding: '8px 18px', borderRadius: 11, background: P.ink, color: '#FFFDF8', fontFamily: fonts.mono, fontSize: 25, fontWeight: 800, letterSpacing: '0.04em'}}>{String(active + 1).padStart(2, '0')} · {stages[active]}</div>
    <div style={{display: 'flex', gap: 8}}>{stages.map((s, i) => <span key={s} style={{width: i === active ? 26 : 12, height: 12, borderRadius: 8, background: i === active ? '#E8772E' : '#D9D3C6'}} />)}</div>
  </div>
);
