import React from 'react';
import {AbsoluteFill, Audio, staticFile, useCurrentFrame} from 'remotion';
import {P, SANS, MONO} from '../palette';
import {Backdrop, Header, Slab, Tag} from '../parts';
import {COLOR} from '../pip-layers/geometry';
import {PipFigure} from '../pip-layers/PipFigure';
import {clamp01, easeBack, easeInOut, easeOut, lerp} from '../../anim';
import {bodyTransform, perform, tipOf, toScreen, type Timing} from './rig';

/** Fictional production test: one 10x-faster scene. All times come from timing.json (derived from the real narration audio). */

const CARD = {x: 70, y: 250, w: 940, h: 620};
const HEAD = 46;
const ANCHOR = {ax: 440, ay: 1440, k: 0.68};
const AST = {x: 386, y: 146}; // asterisk centre, card-relative
const ASTS: [number, number] = [CARD.x + AST.x, CARD.y + AST.y];
const CALL = {w: 800, h: 250, cx: CARD.w / 2, cy: HEAD + 232}; // enlarged callout, card-relative
const CALLS: [number, number] = [CARD.x + CALL.cx, CARD.y + CALL.cy];
const FOOT = {x: 44, y: 470}; // footnote strip, card-relative
const ORANGE = COLOR.shell1;
const ORANGE_HI = '#F08B4C';

const pr = (t: number, start: number, dur: number, ease: (x: number) => number = easeOut) => ease(clamp01((t - start) / dur));
const band = (t: number, a: number, b: number, fade = 0.25) => pr(t, a, fade) * (1 - pr(t, b - fade, fade));

// ---------------------------------------------------------------- phrase captions
const MARK: Record<string, string> = {
  p1: 'Ten times faster.',
  p2: 'Sounds impressive.',
  p3: 'But faster *at what?*',
  p4: 'This test used *tiny prompts.*',
  p5a: 'A *long document*',
  p5b: 'is a different *workload.*',
  p6a: 'Before trusting the *headline,*',
  p6b: 'check what was *measured.*',
};

const Pill: React.FC<{text: string; opacity: number; lift: number}> = ({text, opacity, lift}) => {
  const plain = text.replace(/\*/g, '');
  const fs = Math.min(60, Math.floor(880 / (plain.length * 0.54)));
  const parts = text.split('*');
  return (
    <div style={{position: 'absolute', left: 0, right: 0, top: 1548, display: 'flex', justifyContent: 'center', opacity, transform: `translateY(${lift}px)`}}>
      <div style={{background: '#211F1C', borderRadius: 26, padding: '22px 42px 26px', boxShadow: '0 16px 30px -12px rgba(40,30,10,0.35), 0 2px 0 rgba(255,255,255,0.08) inset', fontFamily: SANS, fontWeight: 800, fontSize: fs, letterSpacing: '-0.01em', whiteSpace: 'nowrap'}}>
        {parts.map((s, i) => (i % 2 === 1 ? <span key={i} style={{color: ORANGE_HI}}>{s}</span> : <span key={i} style={{color: '#FFFFFF'}}>{s}</span>))}
      </div>
    </div>
  );
};

// ---------------------------------------------------------------- token lanes
const Token: React.FC<{x: number; y: number; w: number; label: string; color: string; ink: string; o: number}> = ({x, y, w, label, color, ink, o}) => (
  <div style={{position: 'absolute', left: x, top: y, width: w, height: 46, borderRadius: 12, background: color, opacity: o, boxShadow: '0 3px 0 rgba(60,40,20,0.16)', color: ink, fontFamily: MONO, fontWeight: 700, fontSize: 26, display: 'flex', alignItems: 'center', justifyContent: 'center', whiteSpace: 'nowrap'}}>{label}</div>
);
const tokW = (s: string) => 36 + 15 * s.length;

const SHORT = ['What', 'is', 'a', 'join', '?'];
const DOC = ['The', 'quarterly', 'review', 'covers', 'every', 'account', 'across', 'all', 'regions', 'and', 'explains', 'how', 'the', 'results', 'moved', 'over', 'time', 'for', 'each', 'team', 'in', 'detail', 'with', 'notes', 'on', 'every', 'change'];

const Lane: React.FC<{t: number; y: number; x0: number; x1: number; words: string[]; start: number; speed: number; color: string; ink: string; gap?: number}> = ({t, y, x0, x1, words, start, speed, color, ink, gap = 12}) => {
  // one continuous train of tokens: each token trails the one before it by a fixed gap, so they never overlap;
  // the leading (rightmost) token is the last word, so the visible text reads left to right
  const lead = (t - start) * speed;
  let off = 0;
  const items = [...words].reverse().map((w) => {
    const o = off;
    off += tokW(w) + gap;
    return {w, o};
  });
  return (
    <div style={{position: 'absolute', left: x0, top: y, width: x1 - x0, height: 46, overflow: 'hidden'}}>
      {t < start
        ? null
        : items.map(({w, o}, i) => {
            const x = lead - o - tokW(w);
            if (x > x1 - x0 || x + tokW(w) < 0) return null;
            return <Token key={i} x={x} y={0} w={tokW(w)} label={w} color={color} ink={ink} o={1} />;
          })}
    </div>
  );
};

export const PipScene10x: React.FC<{timing: Timing | null}> = ({timing}) => {
  const frame = useCurrentFrame();
  if (!timing) return <AbsoluteFill style={{background: P.cream}} />;
  const T = timing;
  const t = frame / T.fps;
  const c = T.cues;
  const D = T.durationSec;

  // pointing target: the asterisk, then the enlarged callout
  const target = (tt: number): [number, number] => {
    const u = easeInOut(clamp01((tt - c.callout) / 0.5));
    return [lerp(ASTS[0], CALLS[0], u), lerp(ASTS[1], CALLS[1], u)];
  };
  const pose = perform(t, T, ANCHOR, target);
  const tip = toScreen(pose.body, tipOf(pose.spec.hands[1].pose));

  // ---- card entrance and layer visibility
  const cardIn = pr(t, c.card_in, 0.5, easeBack);
  const cardO = pr(t, c.card_in, 0.3);
  const claim = pr(t, c.claim, 0.4, easeBack);
  const sub = pr(t, c.sub, 0.3);
  const bars = pr(t, c.bars, 0.7, easeInOut);
  const calloutP = pr(t, c.callout, 0.55, easeBack);
  const claimLayer = 1 - pr(t, c.callout, 0.4) * 0.86;
  const claimGone = 1 - pr(t, c.contrast, 0.3);
  const aVis = claimGone * claimLayer;
  const notice = c.notice;
  const astPop = 0.55 + 0.45 * pr(t, c.claim + 0.05, 0.3) + 0.5 * pr(t, c.asterisk_pulse - 0.05, 0.25, easeBack) * (1 - pr(t, c.point_release, 0.5));
  const astLit = pr(t, c.asterisk_pulse - 0.05, 0.2);
  const footLit = pr(t, c.point + 0.15, 0.3);

  // ---- callout -> contrast -> headline chip -> resolve
  const calloutOut = pr(t, c.contrast, 0.4, easeInOut);
  const calloutScale = lerp(0.34, 1, calloutP) * lerp(1, 0.55, calloutOut);
  const calloutX = lerp(FOOT.x + 190, CALL.cx, calloutP) * (1 - calloutOut) + 190 * calloutOut;
  const calloutY = lerp(FOOT.y + 22, CALL.cy, calloutP) * (1 - calloutOut) + (HEAD + 96) * calloutOut;
  const calloutO = pr(t, c.callout, 0.2) * (1 - calloutOut);
  const marker = pr(t, c.callout_text, 0.35, easeInOut);
  const lanes = pr(t, c.contrast + 0.3, 0.3) * (1 - pr(t, c.contrast_out, 0.35));
  const chip = pr(t, c.contrast_out + 0.1, 0.4, easeBack) * (1 - pr(t, c.resolve1 - 0.05, 0.3));
  const r1 = pr(t, c.resolve1, 0.4, easeBack);
  const r2 = pr(t, c.resolve2, 0.4, easeBack);
  const underline = pr(t, c.resolve1 + 0.15, 0.5, easeInOut);

  // ---- captions
  const ph = T.phrases.find((p) => t >= p.start - 0.04 && t < p.end + (p.id === 'p6b' ? 0.5 : 0.08));
  const capIn = ph ? pr(t, ph.start - 0.04, 0.14, easeBack) : 0;
  const capOut = ph ? 1 - pr(t, ph.end + (ph.id === 'p6b' ? 0.2 : -0.05), 0.2) : 1;

  const noteO = pr(t, c.voice_end + 0.5, 0.5);
  const hop = pose.body.by;
  const shK = 1 + hop * 0.004;
  const shY = ANCHOR.ay + 48 * ANCHOR.k;

  const lane2y = [HEAD + 240, HEAD + 300, HEAD + 360];

  return (
    <AbsoluteFill style={{fontFamily: SANS, color: P.ink, overflow: 'hidden', background: P.cream}}>
      <Backdrop drift={0} />
      <Audio src={staticFile(`scenes/pip-10x/${T.audio}`)} />

      <div style={{position: 'absolute', left: 0, right: 0, top: 96, display: 'flex', justifyContent: 'center', opacity: cardO}}>
        <Tag size={26} amber={1}>FICTIONAL PRODUCTION TEST</Tag>
      </div>

      <div style={{position: 'absolute', inset: 0, opacity: cardO, transform: `translateY(${(1 - cardIn) * 46}px)`}}>
        <Slab x={CARD.x} y={CARD.y} w={CARD.w} h={CARD.h} thickness={12} radius={30}>
          <Header title="nimbus-one · launch (fictional)" />

          {/* claim layer */}
          <div style={{position: 'absolute', inset: 0, opacity: aVis, filter: aVis < 0.97 ? `blur(${(1 - aVis) * 3}px)` : undefined}}>
            <div style={{position: 'absolute', left: 44, top: 62, fontFamily: MONO, fontSize: 24, fontWeight: 700, color: P.muted, letterSpacing: '0.12em'}}>AI ASSISTANT · V1</div>
            <div style={{position: 'absolute', left: 44, top: 82, fontSize: 200, fontWeight: 800, letterSpacing: '-0.05em', lineHeight: '190px', opacity: claim, transform: `scale(${lerp(0.82, 1, claim)})`, transformOrigin: '0% 60%'}}>10×</div>
            <div style={{position: 'absolute', left: AST.x, top: AST.y, transform: `translate(-50%,-50%) scale(${astPop})`, fontSize: 118, fontWeight: 800, color: mixHex('#E8B79C', ORANGE, astLit), lineHeight: '120px', opacity: claim}}>*</div>
            <div style={{position: 'absolute', left: 44, top: 282, fontSize: 44, fontWeight: 700, color: P.ink2, opacity: sub, transform: `translateY(${(1 - sub) * 10}px)`}}>faster responses</div>
            <div style={{position: 'absolute', left: 44, top: 352, display: 'flex', flexDirection: 'column', gap: 14, opacity: sub}}>
              <div style={{display: 'flex', alignItems: 'center', gap: 20}}>
                <div style={{width: 170, fontFamily: MONO, fontSize: 28, fontWeight: 700, color: P.muted}}>last gen</div>
                <div style={{height: 28, width: 56 * bars, borderRadius: 14, background: '#C9C0AD'}} />
              </div>
              <div style={{display: 'flex', alignItems: 'center', gap: 20}}>
                <div style={{width: 170, fontFamily: MONO, fontSize: 28, fontWeight: 700, color: ORANGE}}>nimbus</div>
                <div style={{height: 28, width: 560 * bars, borderRadius: 14, background: ORANGE}} />
              </div>
            </div>
            <div style={{position: 'absolute', left: 44, top: FOOT.y, right: 44, borderTop: `3px dashed ${footLit > 0.5 ? ORANGE_HI : P.line}`, paddingTop: 16, fontFamily: MONO, fontSize: 30, fontWeight: 700, color: footLit > 0.5 ? ORANGE : P.muted, opacity: claim, transform: `scale(${1 + 0.05 * Math.sin(Math.PI * footLit)})`, transformOrigin: '0 50%'}}>*tested on short prompts</div>
          </div>

          {/* callout: the benchmark condition, enlarged from the footnote */}
          <div style={{position: 'absolute', left: calloutX, top: calloutY, width: CALL.w, height: CALL.h, marginLeft: -CALL.w / 2, marginTop: -CALL.h / 2, opacity: calloutO, transform: `scale(${calloutScale})`, transformOrigin: '50% 50%'}}>
            <div style={{position: 'absolute', inset: 0, borderRadius: 26, background: '#FFF8EF', border: `3px solid ${ORANGE_HI}`, boxShadow: '0 18px 30px -14px rgba(120,60,20,0.3)'}} />
            <div style={{position: 'absolute', left: 36, top: 26, fontFamily: MONO, fontSize: 28, fontWeight: 700, color: P.muted, letterSpacing: '0.1em'}}>BENCHMARK CONDITION</div>
            <div style={{position: 'absolute', left: 36, right: 36, top: 66, fontSize: 98, fontWeight: 800, letterSpacing: '-0.03em', lineHeight: '120px', whiteSpace: 'nowrap'}}>
              <span style={{position: 'relative'}}>
                <span style={{position: 'absolute', left: -8, right: -8, top: 62, height: 44, borderRadius: 10, background: 'rgba(240,139,76,0.34)', transformOrigin: '0 50%', transform: `scaleX(${marker})`}} />
                <span style={{position: 'relative', color: ORANGE}}>*</span>
                <span style={{position: 'relative'}}>Short prompts.</span>
              </span>
            </div>
            <div style={{position: 'absolute', left: 38, top: 196, display: 'flex', gap: 10}}>
              {SHORT.map((w, i) => (
                <div key={i} style={{opacity: pr(t, c.callout_text + 0.15 + i * 0.09, 0.2), transform: `translateY(${(1 - pr(t, c.callout_text + 0.15 + i * 0.09, 0.2, easeBack)) * 12}px)`}}>
                  <div style={{height: 34, width: tokW(w) - 8, borderRadius: 9, background: ORANGE, color: '#fff', fontFamily: MONO, fontWeight: 700, fontSize: 19, display: 'flex', alignItems: 'center', justifyContent: 'center'}}>{w}</div>
                </div>
              ))}
            </div>
          </div>

          {/* contrast lanes */}
          <div style={{position: 'absolute', inset: 0, opacity: lanes}}>
            <div style={{position: 'absolute', left: 44, top: HEAD + 72, fontFamily: MONO, fontSize: 28, fontWeight: 700, color: ORANGE, letterSpacing: '0.06em'}}>short prompt</div>
            <Lane t={t} y={HEAD + 114} x0={44} x1={740} words={SHORT} start={c.contrast + 0.35} speed={430} color={ORANGE} ink="#fff" />
            <div style={{position: 'absolute', left: 44, top: HEAD + 196, fontFamily: MONO, fontSize: 28, fontWeight: 700, color: P.ink2, letterSpacing: '0.06em', opacity: pr(t, c.lane_long - 0.1, 0.25)}}>long document</div>
            <div style={{position: 'absolute', left: 44, top: HEAD + 238, width: 150, height: 232, borderRadius: 14, background: '#fff', border: `3px solid ${P.line}`, boxShadow: '0 8px 16px -8px rgba(74,58,30,0.22)', opacity: pr(t, c.lane_long - 0.1, 0.3), transform: `translateY(${(1 - pr(t, c.lane_long - 0.1, 0.3)) * 14}px)`}}>
              {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
                <div key={i} style={{position: 'absolute', left: 18, top: 22 + i * 26, width: i % 3 === 2 ? 70 : 112, height: 10, borderRadius: 5, background: '#D9D2C3'}} />
              ))}
            </div>
            {lane2y.map((yy, r) => (
              <Lane key={r} t={t} y={yy} x0={214} x1={740} words={[...DOC.slice(r * 7), ...DOC.slice(0, r * 7), ...DOC]} start={c.lane_long + 0.1 + r * 0.14} speed={400} color={P.ink2} ink="#F5F2EA" />
            ))}
            <div style={{position: 'absolute', left: 760, top: HEAD + 76, width: 138, height: 410, borderRadius: 22, background: '#F2EEE4', border: `3px solid ${P.line}`, boxShadow: '0 10px 18px -10px rgba(74,58,30,0.25)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12}}>
              <div style={{width: 62, height: 62, borderRadius: 16, border: `5px solid ${P.muted}`, position: 'relative'}}>
                <div style={{position: 'absolute', left: 14, top: 14, width: 24, height: 24, borderRadius: 6, background: P.muted}} />
              </div>
              <div style={{fontFamily: MONO, fontSize: 25, fontWeight: 700, color: P.muted}}>model</div>
            </div>
          </div>

          {/* "the headline" chip */}
          <div style={{position: 'absolute', left: CARD.w / 2, top: HEAD + 250, transform: `translate(-50%,-50%) scale(${lerp(0.8, 1, chip)})`, opacity: chip, textAlign: 'center'}}>
            <div style={{fontFamily: MONO, fontSize: 28, fontWeight: 700, color: P.muted, letterSpacing: '0.12em', marginBottom: 6}}>THE HEADLINE</div>
            <div style={{fontSize: 190, fontWeight: 800, letterSpacing: '-0.05em', lineHeight: '180px'}}>10×<span style={{color: ORANGE, fontSize: 104, verticalAlign: 'top', lineHeight: '120px'}}>*</span></div>
          </div>

          {/* resolve */}
          <div style={{position: 'absolute', left: 0, right: 0, top: HEAD + 62, textAlign: 'center'}}>
            <div style={{fontSize: 84, fontWeight: 800, letterSpacing: '-0.03em', lineHeight: '100px', opacity: r1, transform: `translateY(${(1 - r1) * 22}px)`, whiteSpace: 'nowrap'}}>Check the</div>
            <div style={{display: 'inline-block', position: 'relative', fontSize: 132, fontWeight: 800, letterSpacing: '-0.04em', lineHeight: '150px', opacity: r1, transform: `translateY(${(1 - r1) * 22}px)`, whiteSpace: 'nowrap'}}>
              <span style={{position: 'relative'}}>
                <span style={{position: 'absolute', left: -10, right: -10, top: 82, height: 54, borderRadius: 12, background: 'rgba(240,139,76,0.38)', transformOrigin: '0 50%', transform: `scaleX(${underline})`}} />
                <span style={{position: 'relative'}}>workload</span>
              </span>
              <span style={{position: 'relative', color: ORANGE}}>—</span>
            </div>
            <div style={{fontSize: 64, fontWeight: 700, letterSpacing: '-0.02em', lineHeight: '86px', color: P.ink2, opacity: r2, transform: `translateY(${(1 - r2) * 18}px)`, whiteSpace: 'nowrap', marginTop: 14}}>
              not just the <span style={{color: P.muted}}>headline.</span>
            </div>
          </div>
        </Slab>
      </div>

      {/* Pip: floor shadow, then the layered figure under the body transform */}
      <svg width={1080} height={1920} viewBox="0 0 1080 1920" style={{position: 'absolute', left: 0, top: 0}}>
        <defs>
          <filter id="floorsh" x="-30%" y="-200%" width="160%" height="500%">
            <feGaussianBlur stdDeviation="9" />
          </filter>
        </defs>
        <ellipse cx={ANCHOR.ax + 6} cy={shY} rx={345 * ANCHOR.k * 0.92 * shK} ry={34 * ANCHOR.k} fill="#5b5e66" opacity={0.42} filter="url(#floorsh)" />
        {pose.pointW > 0.4 && t < c.callout - 0.05 ? (
          <line x1={tip[0]} y1={tip[1] - 8} x2={ASTS[0]} y2={ASTS[1] + 70} stroke={ORANGE_HI} strokeWidth={5} strokeLinecap="round" strokeDasharray="2 14" opacity={0.55 * pr(t, c.point + 0.2, 0.2) * (1 - pr(t, c.callout - 0.25, 0.2))} />
        ) : null}
        <g transform={bodyTransform(pose.body)}>
          <PipFigure uid="s10" spec={pose.spec} />
        </g>
        {[0, 0.28].map((d, i) => {
          const u = clamp01((t - (c.asterisk_pulse - 0.02 + d)) / 0.75);
          return u > 0 && u < 1 ? <circle key={i} cx={ASTS[0]} cy={ASTS[1]} r={26 + 62 * easeOut(u)} fill="none" stroke={ORANGE} strokeWidth={6 * (1 - u)} opacity={0.8 * (1 - u)} /> : null;
        })}
      </svg>

      {ph ? <Pill text={MARK[ph.id] ?? ph.text} opacity={capIn * capOut} lift={(1 - capIn) * 14} /> : null}

      <div style={{position: 'absolute', left: 0, right: 0, top: 1700, textAlign: 'center', fontFamily: MONO, fontSize: 26, fontWeight: 600, color: P.muted, opacity: noteO}}>
        Fictional production test · invented product, no real benchmark
      </div>
    </AbsoluteFill>
  );
};

function mixHex(a: string, b: string, k: number): string {
  const h = (c: string) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
  const [r1, g1, b1] = h(a);
  const [r2, g2, b2] = h(b);
  const u = clamp01(k);
  return `rgb(${Math.round(lerp(r1, r2, u))},${Math.round(lerp(g1, g2, u))},${Math.round(lerp(b1, b2, u))})`;
}
