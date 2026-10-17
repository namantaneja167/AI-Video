import React from 'react';
import {useCurrentFrame} from 'remotion';
import {C, FONT, MONO, STAGE} from '../theme';
import {cue, easeBack, lerp, prog, type SceneProps} from '../anim';
import type {KpiMismatchParamsT} from '../schema';

const num = (s: string) => Number(s.replace(/[^0-9.]/g, ''));

export const KpiMismatch: React.FC<SceneProps<KpiMismatchParamsT>> = ({params, cues}) => {
  const f = useCurrentFrame();
  const {pipelineChecks, dashboard, expected} = params;
  const tChecks = cue(cues, 'checks');
  const tDash = cue(cues, 'dashboard');
  const tExp = cue(cues, 'expected');
  const tBad = cue(cues, 'mismatch');

  const a = num(dashboard.value);
  const b = num(expected.value);
  const ratio = b > 0 ? a / b : 0;
  const maxV = Math.max(a, b);
  const barW = 880;

  const panel = (extra: React.CSSProperties): React.CSSProperties => ({
    position: 'absolute',
    borderRadius: 26,
    background: C.panel,
    border: `1.5px solid ${C.line}`,
    boxShadow: '0 18px 44px rgba(0,0,0,0.4)',
    ...extra,
  });

  const bad = prog(f, tBad, 10);
  const pipeIn = prog(f, tChecks, 14);

  return (
    <div style={{position: 'absolute', left: 0, top: 0, width: 1080, height: 1920, fontFamily: FONT, color: C.text}}>
      {/* pipeline run */}
      <div style={panel({left: STAGE.x, top: 210, width: STAGE.w, height: 300, opacity: pipeIn, transform: `translateY(${lerp(24, 0, pipeIn)}px)`})}>
        <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '26px 36px 8px'}}>
          <div style={{fontSize: 30, fontWeight: 700}}>Pipeline run</div>
          <div style={{fontSize: 24, fontWeight: 700, color: C.good, padding: '6px 18px', border: `1.5px solid ${C.good}`, borderRadius: 999}}>SUCCEEDED</div>
        </div>
        {pipelineChecks.map((label, i) => {
          const p = prog(f, tChecks + 8 + i * 9, 10);
          return (
            <div key={label} style={{display: 'flex', alignItems: 'center', gap: 18, padding: '9px 36px', opacity: p, transform: `translateX(${lerp(-24, 0, p)}px)`, fontSize: 28}}>
              <div style={{width: 34, height: 34, borderRadius: 17, background: C.good, color: '#06210f', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 900, fontSize: 22}}>✓</div>
              <div style={{color: C.text}}>{label}</div>
              <div style={{marginLeft: 'auto', fontFamily: MONO, fontSize: 22, color: C.good}}>passed</div>
            </div>
          );
        })}
      </div>

      {/* KPI cards */}
      {[
        {k: 'dash', t: tDash, x: STAGE.x, d: dashboard, wrong: true},
        {k: 'exp', t: tExp, x: STAGE.x + 490, d: expected, wrong: false},
      ].map(({k, t, x, d, wrong}) => {
        const p = prog(f, t, 16, easeBack);
        const color = wrong ? (bad > 0.5 ? C.bad : C.text) : C.good;
        return (
          <div
            key={k}
            style={panel({
              left: x,
              top: 570,
              width: 470,
              height: 270,
              opacity: Math.min(1, p * 2),
              transform: `translateY(${lerp(40, 0, p)}px) scale(${lerp(0.94, 1, p)})`,
              borderColor: wrong && bad > 0.5 ? C.bad : C.line,
            })}
          >
            <div style={{padding: '28px 32px', fontSize: 25, color: C.muted, fontWeight: 600}}>{d.label}</div>
            <div style={{padding: '0 32px', fontSize: 110, fontWeight: 800, letterSpacing: -2, color, fontFamily: FONT}}>{d.value}</div>
          </div>
        );
      })}

      {/* comparison bars: same scale, so the gap is visible */}
      <div style={panel({left: STAGE.x, top: 890, width: STAGE.w, height: 210, opacity: Math.min(prog(f, tDash, 14), 1)})}>
        {[
          {label: 'Dashboard', v: a, t: tDash, color: bad > 0.5 ? C.bad : C.accent},
          {label: 'Finance', v: b, t: tExp, color: C.good},
        ].map((row, i) => (
          <div key={row.label} style={{position: 'absolute', left: 40, top: 34 + i * 82, width: barW}}>
            <div style={{fontSize: 22, color: C.muted, marginBottom: 6}}>{row.label}</div>
            <div style={{height: 30, width: barW, background: '#0b1220', borderRadius: 15, overflow: 'hidden'}}>
              <div style={{height: '100%', width: (row.v / maxV) * barW * prog(f, row.t + 4, 26), background: row.color, borderRadius: 15}} />
            </div>
          </div>
        ))}
        {ratio > 1 ? (
          <div style={{position: 'absolute', right: 40, top: 10, fontSize: 30, fontWeight: 800, color: C.bad, opacity: bad, fontFamily: MONO}}>
            {Number.isInteger(ratio) ? ratio : ratio.toFixed(1)}× too high
          </div>
        ) : null}
      </div>
    </div>
  );
};
