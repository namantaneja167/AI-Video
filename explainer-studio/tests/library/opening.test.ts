import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {test} from 'node:test';
import {EpisodeSchemaV2} from '../../src/schema2.ts';
import {COMPONENT_NAMES, computeExpected} from '../../core/deps.ts';
const raw=JSON.parse(readFileSync(join(import.meta.dirname,'../../samples/caching/episode.json'),'utf8'));
test('the first Pip scene preserves its approved hook through episode validation',()=>{
 const doc=structuredClone(raw); doc.scenes[0].openingHook='Faster apps do less work';
 const parsed=EpisodeSchemaV2.parse(doc);
 assert.equal((parsed.scenes[0] as any).openingHook,doc.scenes[0].openingHook);
 const bad=structuredClone(doc);bad.scenes[0].openingHook=' ';
 assert.equal(EpisodeSchemaV2.safeParse(bad).success,false);
});
test('an opening hook edit invalidates video but reuses takes, timing and audio',()=>{
 const before=structuredClone(raw);delete before.scenes[0].openingHook;
 const a=EpisodeSchemaV2.parse(before);const b=structuredClone(before);b.scenes[0].openingHook='Faster apps do less work';
 const cfg=Object.fromEntries(COMPONENT_NAMES.map(k=>[k,'recorded'])) as any;
 const up={takes:{b1:'one',b2:'two',b3:'three',b4:'four'},timing:'timing',mix:{draft:'draft',final:'final'}};
 const x=computeExpected(a,cfg,up),y=computeExpected(EpisodeSchemaV2.parse(b),cfg,up);
 assert.deepEqual(x.take,y.take);assert.equal(x.timing,y.timing);assert.deepEqual(x.mix,y.mix);assert.notEqual(x.render.final.hash,y.render.final.hash);
});
