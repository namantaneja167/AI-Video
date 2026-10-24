// Produce the caching episode through the application's real project store, job service, snapshots and workers.
// Safe to resume: completed takes and artifacts remain in the project's database; no human approvals are recorded.
import {chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createProject, configureProject, isProject, openProjectAt, ROOT} from '../app/workspace.ts';
import {JobService} from '../app/jobs.ts';
import {createEpisode, getEpisodeInfo, listEpisodes, saveEpisode} from '../core/episodes.ts';
import {recordEpisodeSound} from '../core/soundSettings.ts';
import {ProductionSlot} from '../core/slot.ts';
import {blobPath} from '../core/blobs.ts';
import {statusReport} from '../core/artifacts.ts';
import {sha256File} from '../core/hash.ts';

const projectRoot=join(ROOT,'projects/caching-episode');
const out=join(ROOT,'out/caching-v2'); mkdirSync(out,{recursive:true});
const deliver=(src:string,dst:string)=>{if(existsSync(dst))chmodSync(dst,0o644);copyFileSync(src,dst);};
if(!isProject(projectRoot)) createProject(projectRoot,'Pip: why caching makes apps faster');
const {project:p}=openProjectAt(projectRoot);
configureProject(p);
const doc=JSON.parse(readFileSync(join(ROOT,'samples/caching/episode.json'),'utf8'));
if(!listEpisodes(p).includes(doc.id)) createEpisode(p,doc,{label:'Caching episode: original script and custom mechanism scene'});
else saveEpisode(p,doc.id,doc,{baseSeq:getEpisodeInfo(p,doc.id).seq});
recordEpisodeSound(p,doc.id,{soundEvents:[
  {t:0.12,accent:'chime',gainDb:-21},
  {scene:'cache-world',cue:'miss',accent:'tick',gainDb:-15},
  {scene:'cache-world',cue:'store',accent:'pop',gainDb:-14},
  {scene:'cache-world',cue:'hit',accent:'ding',gainDb:-15},
  {scene:'cache-world',cue:'stale',accent:'thump',gainDb:-17},
  {scene:'cache-world',cue:'evict',accent:'swish',gainDb:-19},
  {scene:'cache-world',cue:'fresh',accent:'chime',gainDb:-17},
],mixParams:{voiceGainDb:0,accentBusDb:-12,accentDuck:0.7}});
const slot=new ProductionSlot();
const jobs=new JobService({project:p,env:{root:ROOT,qwenPython:join(ROOT,'.venv-qwen/bin/python'),python:join(ROOT,'.venv/bin/python'),renderConcurrency:2},workerPython:join(ROOT,'.venv-qwen/bin/python'),slot:{slot,project:'Caching episode',projectRoot}});
const protectedFiles=[join(ROOT,'reference/pip-voice/approved-v1/approved.json'),join(ROOT,'out/phase4/slice2/context-window_slice2_rebuilt.mp4')];
const protectedBefore=Object.fromEntries(protectedFiles.map(f=>[f,sha256File(f).hash]));
const ticker=setInterval(()=>{
 const rows=jobs.list(doc.id,40);
 const j=rows.find(j=>['preparing','running'].includes(j.state))??rows.find(j=>j.state==='queued');
 console.log(new Date().toISOString(),j?`${j.label}: ${j.state} | ${j.displayStep??''} | ${j.fraction===null?'':Math.round(j.fraction*100)+'%'}`:'idle');
},10000);
const cur=(kind:string,subject:string)=>p.db.prepare('SELECT a.id,a.blob_hash,a.meta_json FROM current c JOIN artifacts a ON c.artifact_id=a.id WHERE c.episode_id=? AND c.kind=? AND c.subject=?').get(doc.id,kind,subject) as {id:number;blob_hash:string;meta_json:string};
try{
 const plan=jobs.plan(doc.id,'final'); console.log('PLAN',JSON.stringify(plan));
 if(plan.blockers.length)throw Error(JSON.stringify(plan.blockers));
 if(!plan.nothingToDo){
  const rb=jobs.startRebuild(doc.id,{seq:getEpisodeInfo(p,doc.id).seq,requestId:`caching-${Date.now()}`,mode:'final'});
  console.log('REBUILD',JSON.stringify(rb));
  for(;;){
   const r=jobs.rebuilds(doc.id).find(r=>r.id===rb.rebuildId);
   if(r?.state==='complete')break;
   if(r&&['failed','cancelled','stopped','paused'].includes(r.state))throw Error(JSON.stringify(r));
   await new Promise(r=>setTimeout(r,1000));
  }
 }
 for(const [kind,subject,name] of [['render','final','why-caching-is-faster.mp4'],['mix','final','mastered-mix.wav'],['timing','timeline','timeline.json']])deliver(blobPath(p,cur(kind,subject).blob_hash),join(out,name));
 mkdirSync(join(out,'takes'),{recursive:true});
 for(const b of doc.narration.blocks)deliver(blobPath(p,cur('take',b.id).blob_hash),join(out,'takes',`${b.id}.wav`));
 const report={episode:doc.id,project:projectRoot,status:statusReport(p,doc.id),jobs:jobs.list(doc.id),mp4:sha256File(join(out,'why-caching-is-faster.mp4')),protectedUnchanged:protectedFiles.every(f=>sha256File(f).hash===protectedBefore[f]),review:'Awaiting the author. No sign-offs, approval or export recorded.'};
 writeFileSync(join(out,'production-report.json'),JSON.stringify(report,null,2));
 execFileSync('ffmpeg',['-v','error','-i',join(out,'why-caching-is-faster.mp4'),'-ss','0.666667','-frames:v','1','-y',join(out,'faster-apps-do-less-work-cover.png')]);
 console.log('VIDEO READY',join(out,'why-caching-is-faster.mp4'));
 // Measure the actual delivery files. With accents, boundary-energy tests are explicitly not a speech verification.
 const measurement=execFileSync(join(ROOT,'.venv-qwen/bin/python'),[join(ROOT,'scripts/phase2_measure.py'),join(out,'why-caching-is-faster.mp4'),join(out,'mastered-mix.wav'),join(out,'timeline.json'),join(out,'measurements.json'),'-16','-1.5'],{encoding:'utf8',env:{...process.env,MIX_HAS_ACCENTS:'1'}});
 console.log(measurement);
}catch(e){console.error(e);process.exitCode=1;}finally{clearInterval(ticker);await jobs.shutdown();slot.releaseAll();p.close();}
