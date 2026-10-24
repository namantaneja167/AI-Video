import React from 'react';
import {AbsoluteFill} from 'remotion';
import {P} from '../../art/palette';
import {Backdrop} from '../../art/parts';
import {clamp01, easeOut, easeInOut, lerp} from '../../anim';
import {PipPerformer} from '../pip/PipPerformer';
import type {NumKey, PipScore} from '../pip/score';
import {ChapterHeader, FullPageTakeaway} from '../chapters';
import type {SceneProps} from '../types';

const ORANGE='#E8772E', GREEN='#277565', RED='#B94F43', BLUE='#547A92';
const on=(t:number,a:number,d=0.35)=>easeOut(clamp01((t-a)/d));
const c=(cue:string,dt=0)=>({cue,dt});
const k=(...pairs:NumKey[])=>pairs;
const hold=(v:number):NumKey[]=>[[{t:0},v],[{dur:true},v]];
export const CACHE_SCORE:PipScore={
  look:{x:k([{t:0},0],[c('intro',0.4),0.35],[c('result'),0.1],[c('store'),0.5],[c('change'),0.5],[c('stale'),0.2],[c('resolve'),0]),y:k([{t:0},0],[c('intro',0.4),-0.5],[c('change'),-0.3],[c('resolve'),0])},
  wide:k([{t:0},1],[c('change'),1],[c('stale'),1.16],[c('evict'),1.04],[c('resolve'),1]),
  browL:k([{t:0},-4],[c('miss'),4],[c('store'),-8],[c('change'),-8],[c('stale'),6],[c('evict'),-3]),
  browR:k([{t:0},-6],[c('miss'),-14],[c('store'),-10],[c('change'),-10],[c('stale'),-22],[c('evict'),-5]),
  browLflat:hold(0),lidL:hold(0.03),lidR:hold(0.02),
  smile:k([{t:0},0.6],[c('miss'),0.15],[c('result'),0.6],[c('hit'),1],[c('change'),0.5],[c('stale'),-0.1],[c('fresh'),0.8],[c('resolve'),1]),
  smirk:k([{t:0},0],[c('hit'),0.35],[c('change'),0],[c('resolve'),0.2]),
  tilt:k([{t:0},0],[c('miss'),-3],[c('store'),2],[c('stale'),-4],[c('fresh'),0]),
  hop:k([{t:0},0],[c('hit'),0],[c('hit',0.14),-12],[c('hit',0.45),0],[c('stale'),0],[c('stale',0.12),-8],[c('stale',0.4),0]),
  nod:k([{t:0},0],[c('fresh',0.2),0],[c('fresh',0.35),7],[c('fresh',0.65),0]),squash:hold(1),
  blinks:[c('miss',0.6),c('store',0.6),c('hit',0.6),c('change',0.6),c('resolve',0.8)],autoBlink:{everySec:4.5,startSec:2.2},
  pointW:k([{t:0},0],[c('store',-0.18),0],[c('store'),1],[c('store',1),1],[c('store',1.4),0],[c('stale',-0.15),0],[c('stale'),1],[c('stale',1.3),1],[c('stale',1.65),0]),
  handL:[[{t:0},'restL'],[c('stale'),{x:235,y:675,rot:-90,shape:'spread'}],[c('evict'),'restL']],
  handR:[[{t:0},'restR'],[c('store',-0.25),'restR'],[c('store'),'tip'],[c('store',1),'tip'],[c('store',1.5),'restR'],[c('stale',-0.2),'restR'],[c('stale'),'tip'],[c('stale',1.3),'tip'],[c('stale',1.7),'restR']],
  idle:{bobPx:2,periodSec:4.2,tiltDeg:0.3},
};

/** Kept pure so the critical teaching claim (a hit does not query the DB, and a stale copy is not silently updated) is testable. */
export function cacheState(t:number,q:Record<string,number>){
  const has=(n:string)=>t>=q[n];
  return {
    step:has('evict')?4:has('change')?3:has('hit')?2:has('store')?1:0,
    source:has('change')?25:20,
    cache:has('fresh')?25:has('evict')?null:has('store')?20:null,
    app:has('fresh')?25:has('result')?20:null,
    databaseReads:has('refresh')?2:has('fetch')?1:0,
    stale:has('change')&&!has('evict'),
    phase:has('resolve')?'resolve':has('fresh')?'fresh':has('refresh')?'refresh':has('evict')?'evict':has('stale')?'stale':has('change')?'change':has('hit')?'hit':has('repeat')?'repeat':has('store')?'store':has('result')?'result':has('fetch')?'fetch':has('miss')?'miss':'intro',
  };
}

type XY=[number,number];
/** A packet travels once, then rests nowhere: no ambient traffic implying unspoken work. */
const Packet:React.FC<{t:number;start:number;duration:number;points:XY[];label:string;color:string}> = ({t,start,duration,points,label,color})=>{
 if(t<start||t>start+duration)return null;
 const u=easeInOut(clamp01((t-start)/duration));
 const lens=points.slice(1).map((p,i)=>Math.hypot(p[0]-points[i][0],p[1]-points[i][1]));
 let dist=u*lens.reduce((a,b)=>a+b,0),i=0;
 while(i<lens.length-1&&dist>lens[i]){dist-=lens[i];i++;}
 const v=dist/lens[i],x=lerp(points[i][0],points[i+1][0],v),y=lerp(points[i][1],points[i+1][1],v);
 return <g transform={`translate(${x},${y})`}><rect x={-53} y={-30} width={106} height={60} rx={19} fill={color} stroke={P.cream} strokeWidth={5}/><text textAnchor="middle" y={12} fontSize={34} fontWeight={800} fill="white">{label}</text></g>;
};

/** The first lookup starts on the word "first" of the second narration line. It is read from the narration, not a stored cue, so timing that was made before the cue existed stays valid. */
export function lookupStart(segments:SceneProps['segments']):number{
 const at=segments[1]?.words.find(w=>w.text.toLowerCase()==='first')?.start;
 if(!Number.isFinite(at))throw new Error('cache-journey needs the word "first" in its second narration line');
 return at as number;
}
const STAGES=['MISS','STORE','HIT','STALE','REFRESH'] as const;
const HEADINGS:Record<string,string>={intro:'SAME REQUEST.',miss:'CACHE MISS',fetch:'CACHE MISS',result:'CACHE MISS',store:'STORE',repeat:'LOOKUP AGAIN',hit:'CACHE HIT',change:'STALE COPY',stale:'STALE COPY',evict:'INVALIDATE',refresh:'REFRESH',fresh:'FRESH COPY',resolve:'Reuse it.\nKeep it fresh.'};

export const CacheJourneyScene:React.FC<SceneProps>=({scene,timeline,segments,cues:q,t,fps,fonts})=>{
 for(const n of ['intro','miss','fetch','result','store','repeat','hit','change','stale','evict','refresh','fresh','resolve'])if(!Number.isFinite(q[n]))throw new Error(`cache-journey needs cue ${n}`);
 const s=cacheState(t,q);
 const lookupAt=lookupStart(segments);
 const hit=t>=q.hit&&t<q.change, busy=(t>=q.fetch&&t<q.store)||(t>=q.refresh&&t<q.fresh);
 const phase=s.phase;
 const small:React.CSSProperties={fontFamily:fonts.mono,fontSize:36,fontWeight:700,letterSpacing:'0.03em'};
 const color=s.stale?RED:hit||t>=q.fresh?GREEN:ORANGE;
 const stage=t>=q.resolve?'THE TAKEAWAY':t>=q.fresh?'Ready to reuse the new price':t>=q.refresh?'Fetch from the source again':t>=q.evict?'Remove the outdated copy':s.stale?'The source changed. The copy did not.':hit?'Return the copy. Skip the database.':t>=q.repeat?'Same product. Same lookup.':t>=q.store?'Save the result for next time':t>=q.miss?'No saved answer yet':'A shorter route the second time.';
 const dbOpacity=t>=q.fetch?(hit?0.24:1):0.18;
 const panel=(x:number,y:number,w:number,h:number,label:string,accent:string,children:React.ReactNode)=><g transform={`translate(${x} ${y})`}>
  <rect x={5} y={9} width={w} height={h} rx={32} fill="#D9D0BF" opacity={0.35}/><rect width={w} height={h} rx={32} fill="#FFFDF8" stroke={accent} strokeWidth={4}/>
  <text x={28} y={52} fontSize={34} fontWeight={800} fontFamily={fonts.mono} fill={accent}>{label}</text>{children}</g>;
 const price=(x:number,y:number,v:number|null,c:string)=><text x={x} y={y} textAnchor="middle" fontSize={92} fontWeight={850} fontFamily={fonts.mono} letterSpacing="-0.06em" fill={c}>{v===null?'—':`$${v}`}</text>;
 const burst=hit?1+Math.sin(clamp01((t-q.hit)/0.6)*Math.PI)*0.025:1;
 const status=t>=q.resolve?'Reuse the result.\nRefresh the copy.':t>=q.fresh?'Fresh copy saved':t>=q.evict?'Old copy removed':s.stale?'Still the old price':hit?'Same answer.\nLess waiting.':t>=q.store?'Ready for next time':t>=q.fetch?'One database lookup':'Same headphones.\nSame price.';
 const segMap=Object.fromEntries(segments.map(g=>[g.id,g]));
 return <AbsoluteFill style={{fontFamily:fonts.sans}}>
  <Backdrop drift={0}/>
  {!scene.openingHook ? <div style={{position:'absolute',top:108,left:80,right:80,display:'flex',alignItems:'center',justifyContent:'space-between'}}>
   <span style={{...small,color:ORANGE}}>PIP EXPLAINS / 001</span><span style={{...small,color:P.muted}}>CACHING</span>
  </div> : null}
  <ChapterHeader title={HEADINGS[phase]} supporting={stage} stages={STAGES} active={s.step} fonts={fonts}/>
  <svg width={1080} height={1920} viewBox="0 0 1080 1920" style={{position:'absolute',left:0,top:0}}>
   {/* Stable spatial model; inactive routes recede instead of adding more labels. */}
   <path d="M390 620 H610" fill="none" stroke={t>=q.repeat?GREEN:ORANGE} strokeWidth={8} opacity={t>=lookupAt?0.85:0.22}/>
   <path d="M610 760 H390" fill="none" stroke={t>=q.store?GREEN:P.line} strokeWidth={8} opacity={t>=q.store?0.85:0.25}/>
   <g opacity={dbOpacity}>
    <path d="M790 890 V1050" fill="none" stroke={busy?ORANGE:P.line} strokeWidth={8} strokeDasharray={busy?'':'10 12'}/>
    <path d="M610 1160 H235 V900" fill="none" stroke={busy?ORANGE:P.line} strokeWidth={8} strokeDasharray={busy?'':'10 12'}/>
    {panel(610,1050,360,230,'DATABASE',s.stale?RED:ORANGE,<>{price(180,174,s.source,s.stale?RED:P.ink)}</>)}
   </g>
   {panel(80,540,310,360,'YOUR APP',BLUE,<>
    <g transform="translate(109 94)" fill="none" stroke={BLUE} strokeWidth={8} strokeLinecap="round"><path d="M0 57 V36 a48 48 0 0 1 96 0 V57"/><rect x={-8} y={46} width={23} height={43} rx={10}/><rect x={81} y={46} width={23} height={43} rx={10}/></g>
    <text x={155} y={230} textAnchor="middle" fontSize={32} fontWeight={650} fill={P.ink2}>Headphones</text>{price(155,320,s.app,s.stale?RED:P.ink)}
   </>)}
   <g transform={`translate(790 720) scale(${burst}) translate(-790 -720)`}>
    {panel(610,540,360,350,'CACHE',s.stale?RED:GREEN,<>
     <text x={180} y={108} textAnchor="middle" fontSize={29} fontWeight={650} fill={P.muted}>saved copy</text>
     <rect x={30} y={132} width={300} height={156} rx={24} fill={s.stale?'#FBE8E2':s.cache===null?'#F0ECE3':'#E6F0E9'} stroke={s.stale?RED:GREEN} strokeWidth={s.cache===null?1:2} strokeDasharray={s.cache===null?'9 9':''}/>
     {price(180,242,s.cache,s.stale?RED:GREEN)}
     <text x={180} y={324} textAnchor="middle" fontSize={29} fontWeight={750} fill={s.stale?RED:P.muted}>{s.cache===null?'empty':s.stale?'outdated':'ready to reuse'}</text>
    </>)}
   </g>
   {hit?<g transform="translate(90 1035)"><rect width={425} height={130} rx={26} fill="#E6F0E9"/><path d="M32 60 l19 19 32-37" fill="none" stroke={GREEN} strokeWidth={9} strokeLinecap="round"/><text x={108} y={55} fontSize={31} fontWeight={800} fill={GREEN}>DATABASE SKIPPED</text><text x={108} y={99} fontSize={30} fill={GREEN}>1 read · unchanged</text></g>:null}
   {s.stale?<g transform="translate(100 1025)"><rect width={420} height={145} rx={26} fill="#FBE8E2"/><text x={210} y={57} textAnchor="middle" fontSize={31} fontWeight={750} fill={RED}>THE PRICES DISAGREE</text><text x={210} y={113} textAnchor="middle" fontSize={52} fontWeight={850} fontFamily={fonts.mono} fill={RED}>$20 ≠ $25</text></g>:null}
   {!hit&&!s.stale&&t>=q.fetch?<g transform="translate(80 1015)"><text x={20} y={40} fontSize={30} fontWeight={650} fill={P.muted}>DATABASE LOOKUPS</text><text x={20} y={111} fontSize={65} fontWeight={850} fill={color}>{s.databaseReads}</text></g>:null}
   <Packet t={t} start={lookupAt} duration={0.8} points={[[390,620],[610,620]]} label="GET" color={ORANGE}/>
   <Packet t={t} start={q.fetch} duration={0.9} points={[[790,890],[790,1050]]} label="GET" color={ORANGE}/>
   <Packet t={t} start={q.result-0.65} duration={0.65} points={[[610,1160],[235,1160],[235,900]]} label="$20" color={ORANGE}/>
   <Packet t={t} start={q.store-0.65} duration={0.65} points={[[390,620],[610,620]]} label="$20" color={GREEN}/>
   <Packet t={t} start={q.repeat+0.15} duration={0.75} points={[[390,620],[610,620]]} label="GET" color={GREEN}/>
   <Packet t={t} start={q.hit-0.7} duration={0.7} points={[[610,760],[390,760]]} label="$20" color={GREEN}/>
   <Packet t={t} start={q.refresh} duration={0.35} points={[[790,890],[790,1050]]} label="GET" color={ORANGE}/>
   <Packet t={t} start={q.fresh-0.3} duration={0.3} points={[[610,1160],[235,1160],[235,900]]} label="$25" color={GREEN}/>
   <Packet t={t} start={q.fresh} duration={0.55} points={[[390,620],[610,620]]} label="$25" color={GREEN}/>
   {t>=q.evict&&t<q.evict+0.65?<g opacity={1-clamp01((t-q.evict)/0.65)} transform={`translate(790 ${730-(t-q.evict)*130})`}><text fontSize={110} fill={RED} textAnchor="middle">×</text></g>:null}
  </svg>
  <PipPerformer uid="cache-pip" t={t} fps={fps} durationSec={timeline.durationSec} score={CACHE_SCORE} cues={q} segments={segMap} mouth={timeline.mouth??[]} anchor={{ax:270,ay:1490,k:0.44}} target={()=>[790,720]}/>
  <div style={{position:'absolute',left:510,right:80,top:1360,fontSize:43,lineHeight:1.15,whiteSpace:'pre-line',letterSpacing:'-0.035em',fontWeight:850,color:color}}>{status}</div>
  <div style={{position:'absolute',left:80,right:80,top:1750,color:P.muted,fontSize:25,lineHeight:1.4,textAlign:'center'}}>Illustrative app cache · explicit invalidation<br/>Actual speed depends on the workload.</div>
  <FullPageTakeaway t={t} start={q.resolve} fonts={fonts} label="KEY TAKEAWAY" counter="5 / 5" lead="Reuse the work." emphasis="Keep it fresh." emphasisColor={GREEN}
   points={[{label:'REUSE',text:'Return the saved result.',color:ORANGE},{label:'REFRESH',text:'Invalidate, then fetch a fresh copy.',color:GREEN}]}
   note={'This example uses explicit invalidation.\nChoose a freshness policy for your workload.'}
   mascot={<PipPerformer uid="cache-takeaway-pip" t={t} fps={fps} durationSec={timeline.durationSec} score={CACHE_SCORE} cues={q} segments={segMap} mouth={timeline.mouth??[]} anchor={{ax:540,ay:1465,k:0.38}} target={()=>[540,600]}/>}/>
 </AbsoluteFill>;
};
