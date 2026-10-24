import React from 'react';
import {AbsoluteFill} from 'remotion';
import {Backdrop} from '../../art/parts';
import {P} from '../../art/palette';
import {clamp01,easeInOut,lerp} from '../../anim';
import {ChapterHeader,FullPageTakeaway} from '../chapters';
import {PipPerformer} from '../pip/PipPerformer';
import {IDLE_SCORE} from '../pip/scores/idle';
import type {PipScore} from '../pip/score';
import type {SceneProps} from '../types';
import qr from './ticketQr.json';
const O='#E8772E',B='#547A92',G='#277565',R='#B94F43';
const go=(t:number,at:number,d=.7)=>easeInOut(clamp01((t-at)/d));
const SCORE:PipScore={...IDLE_SCORE,
 look:{x:[[{t:0},.3],[{cue:'s2'},.8],[{cue:'s3'},-.1],[{cue:'s4'},.8],[{cue:'s5'},.5],[{cue:'resolve'},0]],y:[[{t:0},-.5],[{cue:'s4'},-.1],[{cue:'resolve'},0]]},
 smile:[[{t:0},.65],[{cue:'s3'},.2],[{cue:'s4'},0],[{cue:'s5'},.8],[{cue:'resolve'},.85]],
 browL:[[{t:0},-7],[{cue:'s3'},-15],[{cue:'s4'},8],[{cue:'s5'},-6]],browR:[[{t:0},-8],[{cue:'s4'},-16],[{cue:'s5'},-6]],
 tilt:[[{t:0},-2],[{cue:'s2'},-5],[{cue:'s4'},5],[{cue:'s5'},0]],
 pointW:[[{t:0},0],[{cue:'s3'},1],[{cue:'s4',dt:.8},0]],handR:[[{t:0},'restR'],[{cue:'s3'},'tip'],[{cue:'s4',dt:.8},'restR']],
 nod:[[{t:0},0],[{cue:'s5'},0],[{cue:'s5',dt:.3},6],[{cue:'s5',dt:.7},0]],
};
const Mascot:React.FC<{p:SceneProps;end?:boolean}>=({p,end})=><PipPerformer uid={'ticket-'+(end?'end':'body')} t={p.t} fps={p.fps} durationSec={p.timeline.durationSec} score={SCORE} cues={p.cues} segments={Object.fromEntries(p.segments.map(s=>[s.id,s]))} mouth={p.timeline.mouth??[]} anchor={{ax:210,ay:1480,k:.34}} target={()=>[760,1060]}/>;
const Mono:React.FC<{children:React.ReactNode;color?:string;size?:number}>=({children,color=P.ink2,size=25})=><div style={{fontFamily:'JetBrains Mono',fontWeight:750,fontSize:size,letterSpacing:1,color}}>{children}</div>;
const Qr:React.FC<{index:number;color?:string}>=({index,color=P.ink})=>{const data=qr[index];return <svg viewBox={`0 0 ${data.size} ${data.size}`} width="100%" height="100%" shapeRendering="crispEdges" style={{background:'white'}}>{data.rows.flatMap((row,y)=>[...row].map((v,x)=>v==='1'?<rect key={x+'-'+y} x={x} y={y} width={1} height={1} fill={color}/>:null))}</svg>;};
const panel={borderRadius:28,border:`2px solid ${P.line}`,background:'#FFFDF8',boxShadow:'0 16px 30px rgba(60,40,20,.06)'};
/** Persistent live pass and a frozen copy; the validator checks time-bound values, not image provenance. */
export const RotatingTicket:React.FC<SceneProps>=p=>{
 const {t,cues:q}=p;
 const s=Math.max(1,...[1,2,3,4,5,6,7].filter(i=>t>=q['s'+i]));
 const copied=go(t,q.s2+.4,.9),rotated=go(t,q.s3+.65,.8),oldScan=go(t,q.s4+.65,1.15),liveScan=go(t,q.s5+.25,1.1);
 const rejected=go(t,q.s4+2,.4)*(1-go(t,q.s5,.4)),accepted=go(t,q.s5+1.6,.4);
 const titles=['SAME TICKET.','FREEZE A COPY.','TIME MOVES ON.','THE OLD CODE.','THE LIVE CODE.','CHECK THE VALUE.','KNOW YOUR TICKET.'];
 const support=['The ticket remains valid. Its code can change.','A screenshot captures this moment.','The pass updates. The picture stays frozen.','The reader checks an allowed time window.','Current code passes the time check.','It reads code data, not screenshot identity.','Some tickets use a static barcode instead.'];
 const active=s===1?0:s===2?1:s===3?2:s===4?3:4;
 const current=rotated>.5?1:0;
 const shotX=lerp(95,585,copied),shotY=lerp(570,590,copied);
 const scanProgress=liveScan>0?liveScan:oldScan;
 const scanningLive=liveScan>0;
 const movingX=lerp(scanningLive?295:785,730,scanProgress),movingY=lerp(1060,1320,scanProgress)-Math.sin(scanProgress*Math.PI)*80;
 return <AbsoluteFill style={{fontFamily:p.fonts.sans,color:P.ink}}>
  <Backdrop drift={0}/>
  <ChapterHeader title={titles[s-1]} supporting={support[s-1]} stages={['LIVE','COPY','ROTATE','SCAN','USE']} active={active} fonts={p.fonts}/>
  <div style={{position:'absolute',left:95,top:555,width:400,height:645,...panel,borderColor:G,transform:`translateY(${Math.sin(t*1.7)*2}px)`}}>
   <div style={{height:55,borderRadius:'26px 26px 0 0',background:'#E4EEE8',padding:'20px 24px',boxSizing:'border-box'}}><Mono color={G} size={22}>LIVE PASS</Mono></div>
   <div style={{padding:'24px 26px'}}><div style={{fontSize:39,fontWeight:850}}>PIP LIVE</div><div style={{fontSize:25,color:P.ink2,marginTop:7}}>Example event · Entry pass</div></div>
   <div style={{position:'absolute',left:55,top:183,width:290,height:290,transform:`scale(${1+Math.sin(rotated*Math.PI)*.05})`}}><Qr index={current}/></div>
   <div style={{position:'absolute',left:30,right:30,top:490,textAlign:'center'}}><Mono color={G} size={25}>CODE WINDOW {current===0?'A':'B'}</Mono><div style={{height:9,background:'#DCE7E1',marginTop:17,borderRadius:10,overflow:'hidden'}}><div style={{height:'100%',width:`${rotated<1?100*(1-rotated):100}%`,background:G}}/></div><div style={{fontSize:28,fontWeight:750,color:G,marginTop:18}}>Ticket still valid ✓</div></div>
  </div>

  <div style={{position:'absolute',left:shotX,top:shotY,width:400,height:610,...panel,borderColor:rotated>.5?R:B,opacity:copied,transform:`rotate(${lerp(-5,2,copied)}deg)`}}>
   <div style={{height:55,borderRadius:'26px 26px 0 0',background:'#E9EBEE',padding:'20px 24px',boxSizing:'border-box'}}><Mono color={B} size={22}>SAVED SCREENSHOT</Mono></div>
   <div style={{padding:'24px 26px'}}><div style={{fontSize:39,fontWeight:850}}>PIP LIVE</div><div style={{fontSize:25,color:P.ink2,marginTop:7}}>Same pass · Frozen image</div></div>
   <div style={{position:'absolute',left:55,top:183,width:290,height:290}}><Qr index={0}/></div>
   <div style={{position:'absolute',left:25,right:25,top:490,textAlign:'center'}}><Mono color={rotated>.5?R:B} size={25}>CODE WINDOW A</Mono><div style={{fontSize:28,fontWeight:750,color:rotated>.5?R:B,marginTop:20}}>{rotated>.5?'Still the old code':'Same code, same moment'}</div></div>
  </div>
  <div style={{position:'absolute',left:480,top:790,width:120,height:120,borderRadius:70,background:rotated>.5?O:'#FFFDF8',border:`3px solid ${O}`,display:'grid',placeItems:'center',opacity:go(t,q.s3,.3),transform:`scale(${.85+.15*rotated})`}}><svg viewBox="0 0 100 100" width="84" height="84"><circle cx={50} cy={50} r={34} stroke={rotated>.5?'white':O} strokeWidth={4} fill="none"/><path d="M50 25V50L68 62" fill="none" stroke={rotated>.5?'white':O} strokeWidth={5} strokeLinecap="round"/></svg></div>
  <div style={{position:'absolute',left:460,right:80,top:1270,height:230,...panel,borderColor:rejected>.1?R:accepted>.1?G:B,padding:'23px 28px',boxSizing:'border-box',opacity:go(t,q.s4,.6)}}>
   <Mono color={B}>GATE READER</Mono>
   <div style={{fontSize:30,fontWeight:750,marginTop:14}}>Allowed window: <span style={{color:G}}>B</span></div>
   <div style={{fontSize:36,fontWeight:850,marginTop:18,color:rejected>.1?R:accepted>.1?G:P.ink2}}>{rejected>.1?'A: OUTSIDE WINDOW':accepted>.1?'B: TIME CHECK PASSED':'CHECKING CODE…'}</div>
   <div style={{fontSize:23,color:P.muted,marginTop:12}}>Other ticket checks still apply.</div>
  </div>
  <svg width="1080" height="1920" style={{position:'absolute',pointerEvents:'none'}}>
   <path d={scanningLive?'M295 1180Q300 1260 730 1270':'M785 1200Q890 1240 730 1270'} fill="none" stroke={scanningLive?G:R} strokeWidth={5} strokeDasharray="10 12" opacity={(oldScan>0?.5:0)*(1-go(t,q.s6,.5))}/>
   {scanProgress>0&&scanProgress<1?<g transform={`translate(${movingX},${movingY})`}><rect x={-80} y={-35} width={160} height={70} rx={18} fill={scanningLive?G:R}/><text textAnchor="middle" y={11} fill="white" fontFamily={p.fonts.mono} fontWeight={800} fontSize={30}>CODE {scanningLive?'B':'A'}</text></g>:null}
  </svg>
  <Mascot p={p}/>
  <div style={{position:'absolute',left:80,right:80,top:1750,textAlign:'center',fontSize:23,lineHeight:1.35,color:P.muted}}>Fictional pass. Time compressed; acceptance windows vary.<br/>Only applies to supported rotating-code tickets.</div>
  <FullPageTakeaway t={t} start={q.resolve} fonts={p.fonts} label="KEY TAKEAWAY" counter="STEP 5 / 5" lead="Open the live pass." emphasis="Before you queue." emphasisColor={G} points={[{label:'A PICTURE STAYS FROZEN',text:'It cannot refresh an expired code.',color:R},{label:'FOLLOW THE ISSUER',text:'Use the live ticket when required.',color:G}]} note="Static-code tickets work differently. Follow your issuer’s instructions." mascot={<Mascot p={p} end/>}/>
 </AbsoluteFill>;
};
