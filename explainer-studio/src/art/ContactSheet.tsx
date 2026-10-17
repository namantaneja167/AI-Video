import React from 'react';
import {AbsoluteFill, Img, staticFile} from 'remotion';
import {P, SANS, MONO} from './palette';
import {Clay, ClayFilters, Lucide, GlyphMask, type ClayName} from './Asset';

export const SHEET_W = 2460;
export const SHEET_H = 1330;

const Label: React.FC<{children: React.ReactNode; sub?: string}> = ({children, sub}) => (
  <div style={{marginBottom: 14}}>
    <div style={{fontFamily: MONO, fontSize: 22, fontWeight: 800, letterSpacing: '0.12em', color: P.ink}}>{children}</div>
    {sub ? <div style={{fontFamily: SANS, fontSize: 19, color: P.muted, marginTop: 4}}>{sub}</div> : null}
  </div>
);

const Tile: React.FC<{children: React.ReactNode; caption: string; note?: string; w?: number}> = ({children, caption, note, w = 190}) => (
  <div style={{width: w, textAlign: 'center'}}>
    <div style={{height: 150, display: 'flex', alignItems: 'center', justifyContent: 'center', background: P.white, border: `2px solid ${P.line}`, borderRadius: 18, boxShadow: '0 8px 16px -8px rgba(74,58,30,0.25)'}}>{children}</div>
    <div style={{fontFamily: MONO, fontSize: 18, fontWeight: 700, marginTop: 8, color: P.ink2}}>{caption}</div>
    {note ? <div style={{fontFamily: SANS, fontSize: 16, color: P.muted}}>{note}</div> : null}
  </div>
);

const Swatch: React.FC<{c: string; name: string; role: string}> = ({c, name, role}) => (
  <div style={{display: 'flex', alignItems: 'center', gap: 12}}>
    <div style={{width: 46, height: 46, borderRadius: 12, background: c, border: `2px solid ${P.line}`}} />
    <div>
      <div style={{fontFamily: MONO, fontSize: 18, fontWeight: 700}}>{name}</div>
      <div style={{fontFamily: SANS, fontSize: 16, color: P.muted}}>{role}</div>
    </div>
  </div>
);

const Frame: React.FC<{src: string; title: string}> = ({src, title}) => (
  <div>
    <Label>{title}</Label>
    <div style={{width: 540, height: 960, borderRadius: 22, overflow: 'hidden', border: `3px solid ${P.line}`, boxShadow: '0 24px 40px -14px rgba(74,58,30,0.35)'}}>
      <Img src={staticFile(src)} style={{width: 540, height: 960, display: 'block'}} />
    </div>
  </div>
);

const CLAY: {name: ClayName; tint: 'none' | 'amber' | 'rose'; use: string}[] = [
  {name: 'rupee', tint: 'none', use: 'used · coin on order'},
  {name: 'key', tint: 'amber', use: 'used · join key'},
  {name: 'copy', tint: 'rose', use: 'used · copied amount'},
  {name: 'clock', tint: 'none', use: 'used · history'},
  {name: 'bag', tint: 'none', use: 'reserve · totals'},
  {name: 'tick', tint: 'none', use: 'reserve · fixed state'},
];
const LUCIDE = ['receipt-indian-rupee', 'history', 'table-2', 'git-merge', 'key-round', 'copy', 'arrow-down', 'equal', 'split', 'layers', 'circle-check'];
const LUCIDE_USED = new Set(['git-merge']);

export const ContactSheet: React.FC = () => (
  <AbsoluteFill style={{background: P.cream, padding: '40px 48px', flexDirection: 'row', gap: 44, fontFamily: SANS, color: P.ink}}>
    <ClayFilters />
    <Frame src="_review/frame_concept.png" title="A · CONCEPT (flat vector only)" />
    <Frame src="_review/frame_assets.png" title="B · WITH CURATED ASSETS" />
    <div style={{width: 1180, display: 'flex', flexDirection: 'column', gap: 26}}>
      <div>
        <Label sub="Matte clay material · dynamic angle · 500 px · alpha keyed from the CC0 white render · tinted by a duotone filter">3DICONS V1 · CC0 · ONE COLLECTION</Label>
        <div style={{display: 'flex', gap: 18, flexWrap: 'wrap'}}>
          {CLAY.map((c) => (
            <Tile key={c.name} caption={c.name} note={c.use} w={170}>
              <Clay name={c.name} size={116} tint={c.tint} />
            </Tile>
          ))}
        </div>
      </div>
      <div>
        <Label sub="Editable line icons, recoloured in code · ISC (a few Feather-derived icons also MIT)">LUCIDE 1.59 · TECHNICAL SYMBOLS</Label>
        <div style={{display: 'flex', gap: 14, flexWrap: 'wrap'}}>
          {LUCIDE.map((n) => (
            <Tile key={n} caption={n.length > 14 ? n.slice(0, 13) + '…' : n} note={LUCIDE_USED.has(n) ? 'used' : 'reserve'} w={104}>
              <Lucide name={n} color={LUCIDE_USED.has(n) ? P.amber.solid : P.ink2} size={46} />
            </Tile>
          ))}
        </div>
      </div>
      <div style={{display: 'flex', gap: 40}}>
        <div>
          <Label sub="CC0 package, but marks stay the owners’ trademarks">SIMPLE ICONS 16.35</Label>
          <Tile caption="postgresql" note="reserved · SQL scenes" w={190}>
            <GlyphMask src="assets/simple-icons/postgresql.svg" color={P.ink2} size={72} />
          </Tile>
        </div>
        <div style={{flex: 1}}>
          <Label sub="One meaning per colour">PALETTE ROLES</Label>
          <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14}}>
            <Swatch c={P.cream} name="paper" role="background + dot grid" />
            <Swatch c={P.ink} name="ink" role="amounts, labels, captions" />
            <Swatch c={P.amber.solid} name="amber" role="the join key (order 101)" />
            <Swatch c={P.rose.solid} name="rose" role="a copied amount" />
          </div>
        </div>
      </div>
      <div style={{background: P.white, border: `2px solid ${P.line}`, borderRadius: 18, padding: '18px 24px', fontSize: 20, lineHeight: 1.45, color: P.ink2}}>
        <b>Not used:</b> 3dicons <i>color</i> (glossy red/blue/chrome fights the warm-paper palette). The <i>gradient</i> and <i>premium</i> styles were not evaluated, and the
        premium licence is unconfirmed. No brand screenshots (no launch is being explained). <b>No attribution is legally required</b> by CC0 or Simple Icons; Lucide’s ISC notice ships in
        <span style={{fontFamily: MONO}}> public/assets/licenses</span>.
      </div>
    </div>
  </AbsoluteFill>
);
