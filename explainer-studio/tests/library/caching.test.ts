import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {test} from 'node:test';
import {EpisodeSchemaV2} from '../../src/schema2.ts';
import {SCENE_CUES} from '../../src/library/sceneSpecs.ts';
import {resolveCues} from '../../src/library/cues.ts';
const raw = JSON.parse(readFileSync(join(import.meta.dirname, '../../samples/caching/episode.json'), 'utf8'));
test('caching episode uses a validated mechanism scene with the approved voice', () => {
  const r = EpisodeSchemaV2.safeParse(raw);
  assert.ok(r.success, JSON.stringify(r.success ? [] : r.error.issues));
  assert.equal(r.data.voice.engine, 'qwen3-tts');
  assert.equal(r.data.scenes[0].type, 'cache-journey');
  assert.equal(EpisodeSchemaV2.safeParse({...raw, scenes:[{...raw.scenes[0],params:{inventedPolicy:true}}]}).success,false);
});
test('cache miss, hit, stale copy and refresh are timed on the real script in causal order', () => {
  const spec = SCENE_CUES['cache-journey'];
  assert.ok(spec, 'a caching scene needs explicit cue rules');
  let t=0.5;
  const segments=raw.narration.segments.map((s:any)=>{const start=t; const words=s.text.split(/\s+/).map((text:string)=>{const start=t; t+=0.32; return {text,start,end:t};}); t+=0.2; return {id:s.id,start,end:t-0.2,words};});
  const c=resolveCues(spec,segments);
  const order=['intro','miss','fetch','result','store','repeat','hit','change','stale','evict','refresh','fresh','resolve'];
  order.forEach((n,i)=>{assert.ok(Number.isFinite(c[n]),n); if(i)assert.ok(c[n]>=c[order[i-1]],n);});
  assert.throws(()=>resolveCues(spec,segments.slice(0,7)),/no segment/);
});

test('a cache hit avoids a second database read; a source change leaves the copy stale until invalidated', async()=>{
  const {loadBundled}=await import('./bundle.ts');
  const {cacheState, CACHE_SCORE, performScore}=await loadBundled(join(import.meta.dirname,'entries/cache-entry.ts'));
  const names=['intro','miss','fetch','result','store','repeat','hit','change','stale','evict','refresh','fresh','resolve','voice_end'];
  const q=Object.fromEntries(names.map((n,i)=>[n,1+i*3]));
  assert.equal(cacheState(q.hit+0.1,q).databaseReads,1);
  assert.equal(cacheState(q.hit+0.1,q).cache,20);
  assert.deepEqual([cacheState(q.stale+0.1,q).source,cacheState(q.stale+0.1,q).cache],[25,20]);
  assert.equal(cacheState(q.evict+0.1,q).cache,null);
  assert.equal(cacheState(q.evict+0.1,q).step,4,'invalidation starts the refresh stage');
  assert.equal(cacheState(q.fresh+0.1,q).step,4,'a fresh copy cannot still highlight stale');
  assert.equal(cacheState(q.refresh+0.1,q).databaseReads,2);
  assert.deepEqual([cacheState(q.fresh+0.1,q).source,cacheState(q.fresh+0.1,q).cache,cacheState(q.fresh+0.1,q).app],[25,25,25]);
  for(let f=0;f<43*30;f++){
    const p=performScore(f/30,CACHE_SCORE,{cues:q,segments:{},mouth:[],fps:30,durationSec:43,anchor:{ax:255,ay:1490,k:0.4},target:()=>[760,650]});
    assert.ok(Number.isFinite(p.body.ax)&&Number.isFinite(p.body.tilt));
  }
});

test('the first lookup starts on the word "first" of the second line, and is refused when that word is missing', async()=>{
  const {loadBundled}=await import('./bundle.ts');
  const {lookupStart}=await loadBundled(join(import.meta.dirname,'entries/cache-entry.ts'));
  const seg=(words:string[])=>({id:'s',start:0,end:9,words:words.map((text,i)=>({text,start:5+i*0.08,end:5.08+i*0.08}))});
  assert.equal(lookupStart([seg(['Same']),seg(['The','First','request'])]),5.08);
  assert.throws(()=>lookupStart([seg(['Same']),seg(['A','request'])]),/first/);
  assert.throws(()=>lookupStart([seg(['Same'])]),/first/);
});
