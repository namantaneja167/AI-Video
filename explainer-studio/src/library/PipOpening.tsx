import React from 'react';
import {AbsoluteFill} from 'remotion';
import {P} from '../art/palette';
import {Backdrop} from '../art/parts';
import {clamp01, easeInOut, easeOut, lerp} from '../anim';
import {PipPerformer} from './pip/PipPerformer';
import type {NumKey, PipScore} from './pip/score';
import type {FontSet} from './fonts';

// The opening shares the episode clock: it never adds a bumper or moves any narration/cues.
const END=2.25;
export const openingReveal=(t:number, end=END)=>easeInOut(clamp01((t-(end-0.3))/0.3));
const hold=(n:number):NumKey[]=>[[{t:0},n],[{t:3},n]];
const SCORE:PipScore={
 look:{x:hold(0),y:[[{t:0},-0.2],[{t:0.6},0],[{t:3},0]]},
 wide:hold(1.04),browL:hold(-8),browR:hold(-10),browLflat:hold(0),lidL:hold(0),lidR:hold(0),smile:hold(0.9),smirk:hold(0.15),
 tilt:[[{t:0},-5],[{t:0.5},2,'out'],[{t:1},0],[{t:3},0]],
 hop:[[{t:0},120],[{t:0.55},0,'out'],[{t:3},0]],nod:hold(0),squash:[[{t:0},0.94],[{t:0.45},1.02,'out'],[{t:0.7},1],[{t:3},1]],
 blinks:[{t:1.4}],pointW:hold(0),handL:[[{t:0},'restL'],[{t:3},'restL']],
 handR:[[{t:0},'restR'],[{t:0.3},{x:860,y:640,rot:35,shape:'spread'},'out'],[{t:0.65},{x:860,y:640,rot:58,shape:'spread'}],[{t:0.9},{x:860,y:640,rot:36,shape:'spread'}],[{t:1.3},'restR'],[{t:3},'restR']],
};

/** Shared channel opening: curiosity hook + original Pip, then a compact header. Old episodes opt in explicitly. */
export const PipOpening:React.FC<{hook:string;seriesLabel?:string;overlap?:boolean;settleAt?:number;t:number;fps:number;fonts:FontSet;mouth:number[]}>=({hook,seriesLabel,overlap,settleAt=END,t,fps,fonts,mouth})=>{
 const START=Math.max(0,settleAt-0.55);
 const u=easeInOut(clamp01((t-START)/(settleAt-START))),intro=1-easeOut(clamp01((t-START)/(overlap?0.3:0.2))),arrive=easeOut(clamp01(t/0.45));
 const words=hook.split(/\s+/),split=Math.max(1,words.length-2);
 const size=hook.length>44?80:hook.length>31?96:110;
 return <>
  {intro>0?<AbsoluteFill style={{opacity:intro,pointerEvents:'none'}}>
   {overlap?null:<Backdrop drift={0}/>}
   <div style={{position:'absolute',left:80,right:80,top:385,transform:`translateY(${(1-arrive)*20}px)`,fontFamily:fonts.sans,fontSize:size,fontWeight:850,lineHeight:1.05,letterSpacing:'-0.045em',color:P.ink,overflowWrap:'anywhere'}}>
    <div>{words.slice(0,split).join(' ')}</div>
    <div style={{color:'#D65C1B',marginTop:10}}>{words.slice(split).join(' ')}</div>
    <div style={{marginTop:28,width:120+680*arrive,height:10,borderRadius:10,background:'#E8772E'}}/>
   </div>
   <PipPerformer uid="channel-opening" t={t} fps={fps} durationSec={3} score={SCORE} cues={{}} segments={{}} mouth={mouth} anchor={overlap?{ax:540,ay:1500,k:0.55}:{ax:540,ay:1450,k:0.67}} target={()=>[540,700]}/>
  </AbsoluteFill>:null}
  <div style={{position:'absolute',left:80,top:lerp(235,103,u),padding:`${lerp(14,9,u)}px ${lerp(26,20,u)}px`,borderRadius:16,background:'#E8772E',color:P.ink,fontFamily:fonts.mono,fontWeight:800,fontSize:lerp(42,28,u),letterSpacing:'0.03em',boxShadow:'0 5px 0 rgba(120,65,20,0.13)',pointerEvents:'none'}}>PIP EXPLAINS</div>
  {seriesLabel ? <div style={{position:'absolute',left:80,right:80,top:lerp(330,200,u),fontFamily:fonts.mono,fontSize:lerp(32,26,u),lineHeight:1.2,fontWeight:750,letterSpacing:'0.045em',color:P.ink2,pointerEvents:'none'}}>{seriesLabel}</div> : null}
  {u>0?<div style={{position:'absolute',left:400,right:80,top:110,opacity:u,fontFamily:fonts.sans,fontWeight:750,fontSize:34,lineHeight:1.2,letterSpacing:'-0.02em',color:P.ink,overflowWrap:'anywhere',pointerEvents:'none'}}>{hook}</div>:null}
 </>;
};
