import React from 'react';
import {AbsoluteFill} from 'remotion';
import {P, SANS, MONO} from '../palette';
import {Header} from '../parts';
import {PipA} from './PipA';
import {PipB} from './PipB';
import {PipC} from './PipC';
import {C, type ExprName} from './shared';

export const BOARD_W = 2400;
export const BOARD_H = 1800;

const STUDIO = '#D8CFBA';
const COL_W = 700;
const COLS = [75, 825, 1575];

type Comp = React.FC<{expr: ExprName; uid: string; crop?: [number, number, number, number]; width?: number; height?: number; hands?: boolean; shadow?: boolean}>;

const CONCEPTS: {key: string; name: string; note: string; Comp: Comp; face: [number, number, number, number]}[] = [
  {
    key: 'A',
    name: 'LEAN',
    note: 'Tall leaning capsule under an off-axis charcoal cap that overhangs the body. Painted-on tall-oval eyes; the whole body tips into doubt.',
    Comp: PipA,
    face: [85, 100, 235, 235],
  },
  {
    key: 'B',
    name: 'PEBBLE',
    note: 'Low off-balance bean with a vertical side shell, charcoal face window, top button and lanyard loop. Lit eye shapes read at tiny sizes.',
    Comp: PipB,
    face: [103, 231, 260, 260],
  },
  {
    key: 'C',
    name: 'GOURD',
    note: 'Two-lobed capsule: big ivory head, charcoal body, orange waist seam. Cartoon eyes and a monocle ring for inspecting claims. Hovers.',
    Comp: PipC,
    face: [78, 105, 240, 240],
  },
];

const EXPRS: ExprName[] = ['curious', 'skeptical', 'surprised'];

const Tiny: React.FC<{children: React.ReactNode; style?: React.CSSProperties}> = ({children, style}) => (
  <div style={{fontFamily: MONO, fontSize: 19, fontWeight: 700, letterSpacing: '0.1em', color: P.ink2, ...style}}>{children}</div>
);

/** The same product panel for every concept: a launch claim with its fine print. Fictional product. */
const ProductPanel: React.FC = () => (
  <div style={{position: 'absolute', left: 300, top: 70, width: 370, height: 320, borderRadius: 24, background: P.white, border: `2px solid ${P.line}`, boxShadow: '0 18px 30px -14px rgba(74,58,30,0.2)', overflow: 'hidden', boxSizing: 'border-box'}}>
    <Header title="nimbus-one · launch" />
    <div style={{padding: '14px 24px 0', fontFamily: SANS}}>
      <div style={{fontFamily: MONO, fontSize: 16, fontWeight: 700, color: P.muted, letterSpacing: '0.12em'}}>AI ASSISTANT · V1</div>
      <div style={{display: 'flex', alignItems: 'flex-start', gap: 4, marginTop: 4}}>
        <div style={{fontSize: 92, fontWeight: 800, letterSpacing: '-0.05em', lineHeight: '96px'}}>10×</div>
        <div style={{fontSize: 52, fontWeight: 800, color: C.or, lineHeight: '60px'}}>*</div>
      </div>
      <div style={{fontSize: 22, fontWeight: 650, color: P.ink2, marginTop: -2}}>faster responses</div>
      <div style={{marginTop: 14, display: 'flex', flexDirection: 'column', gap: 8, fontFamily: MONO, fontSize: 15, fontWeight: 700, color: P.muted}}>
        <div style={{display: 'flex', alignItems: 'center', gap: 10}}>
          <div style={{width: 78}}>last gen</div>
          <div style={{width: 30, height: 14, borderRadius: 7, background: '#C9C0AD'}} />
        </div>
        <div style={{display: 'flex', alignItems: 'center', gap: 10}}>
          <div style={{width: 78, color: C.or}}>nimbus</div>
          <div style={{width: 230, height: 14, borderRadius: 7, background: C.or}} />
        </div>
      </div>
      <div style={{marginTop: 10, fontFamily: MONO, fontSize: 14, color: P.muted, borderTop: `2px dashed ${P.line}`, paddingTop: 8}}>*vs. batch size 1, 8-token prompts</div>
    </div>
  </div>
);

export const PipBoard: React.FC = () => (
  <AbsoluteFill style={{background: '#E9E2D2', fontFamily: SANS, color: P.ink}}>
    <div style={{position: 'absolute', left: 75, top: 44}}>
      <div style={{fontFamily: MONO, fontSize: 30, fontWeight: 800, letterSpacing: '0.12em'}}>PIP · AI CAPSULE MASCOT · THREE CONCEPTS</div>
      <div style={{fontFamily: MONO, fontSize: 21, color: P.ink2, marginTop: 8}}>Same expression table · same scene · same scale · same palette. Static vector, authored in code. Not animated or rigged.</div>
    </div>
    <div style={{position: 'absolute', right: 75, top: 52, display: 'flex', gap: 22, alignItems: 'center', fontFamily: MONO, fontSize: 18, fontWeight: 700}}>
      {[
        ['ivory', C.iv],
        ['burnt orange', C.or],
        ['charcoal', C.ch],
      ].map(([n, c]) => (
        <div key={n} style={{display: 'flex', alignItems: 'center', gap: 10}}>
          <div style={{width: 34, height: 34, borderRadius: 10, background: c, border: '2px solid rgba(0,0,0,0.15)'}} />
          {n}
        </div>
      ))}
    </div>

    {CONCEPTS.map((c, i) => {
      const x = COLS[i];
      const Full = c.Comp;
      return (
        <div key={c.key}>
          {/* header */}
          <div style={{position: 'absolute', left: x, top: 150, width: COL_W}}>
            <div style={{display: 'flex', alignItems: 'baseline', gap: 16}}>
              <div style={{fontSize: 64, fontWeight: 800, color: C.or, lineHeight: 1}}>{c.key}</div>
              <div style={{fontFamily: MONO, fontSize: 34, fontWeight: 800, letterSpacing: '0.1em'}}>{c.name}</div>
            </div>
            <div style={{fontSize: 21, lineHeight: 1.35, color: P.ink2, marginTop: 10, height: 86}}>{c.note}</div>
          </div>

          {/* full body */}
          <div style={{position: 'absolute', left: x, top: 290, width: COL_W, height: 600, borderRadius: 28, background: STUDIO, overflow: 'hidden'}}>
            <div style={{position: 'absolute', left: 150, top: 0}}>
              <Full expr="neutral" uid={`${c.key}-full`} />
            </div>
            <Tiny style={{position: 'absolute', left: 22, top: 18}}>FULL BODY · NEUTRAL</Tiny>
            <div style={{position: 'absolute', right: 24, top: 18, width: 120, height: 180, filter: 'brightness(0)', opacity: 0.85}}>
              <Full expr="neutral" uid={`${c.key}-sil`} width={120} height={180} hands={false} shadow={false} />
            </div>
            <Tiny style={{position: 'absolute', right: 24, top: 204, width: 120, textAlign: 'center', fontSize: 15}}>SILHOUETTE</Tiny>
          </div>

          {/* expressions */}
          {EXPRS.map((ex, k) => (
            <div key={ex} style={{position: 'absolute', left: x + k * 240, top: 910, width: 220}}>
              <div style={{width: 220, height: 220, borderRadius: 22, background: STUDIO, overflow: 'hidden'}}>
                <Full expr={ex} uid={`${c.key}-${ex}`} crop={c.face} width={220} height={220} hands={false} shadow={false} />
              </div>
              <Tiny style={{marginTop: 8, textAlign: 'center'}}>{ex.toUpperCase()}</Tiny>
            </div>
          ))}

          {/* in scene */}
          <div style={{position: 'absolute', left: x, top: 1190, width: COL_W, height: 470, borderRadius: 28, background: P.cream, overflow: 'hidden', border: `2px solid ${P.line}`, boxSizing: 'border-box'}}>
            <div style={{position: 'absolute', inset: 0, backgroundImage: `radial-gradient(circle, ${P.dot} 2.2px, transparent 2.6px)`, backgroundSize: '40px 40px', opacity: 0.7}} />
            <div style={{position: 'absolute', left: 0, right: 0, top: 420, bottom: 0, background: P.floor}} />
            <ProductPanel />
            <div style={{position: 'absolute', left: 20, top: 70}}>
              <Full expr="skeptical" uid={`${c.key}-scene`} width={248} height={372} />
            </div>
            <Tiny style={{position: 'absolute', left: 22, top: 18}}>IN SCENE · SKEPTICAL · 0.62×</Tiny>
          </div>
        </div>
      );
    })}
  </AbsoluteFill>
);
