/** Test-only worker. Imports production runtime unchanged; exercises its public trace/random hooks. */
import { loadModels } from '../../src/models.js';
import { generateChart } from '../../src/generate.js';
import { arrayFromBytes, tensorType } from '../../src/binary.js';
import { argmax, f32, round } from '../../src/math.js';
import { decodeAudio } from '../../src/decode_audio.js';
let models:any, activeGraph='initialization';const gpuWork:any={};
for(const [type,method] of [['GPUQueue','submit'],['GPUComputePassEncoder','dispatchWorkgroups']]){
 const prototype=(globalThis as any)[type]?.prototype;if(prototype){const original=prototype[method];prototype[method]=function(...args:any[]){const s=gpuWork[activeGraph]??={submit:0,dispatchWorkgroups:0};s[method]++;return original.apply(this,args);};}
}
const get=async(p:string)=>new Uint8Array(await (await fetch(p)).arrayBuffer());
const json=async(p:string)=>(await fetch(p)).json();
const out=(type:string,data:any)=>postMessage({type,...data});
function diff(a:any,b:any){let max=0,sum=0,nonfinite=0;const values=[];for(let i=0;i<Math.min(a.length,b.length);i++){const d=Math.abs(Number(a[i])-Number(b[i]));if(!Number.isFinite(d)){if(!Object.is(Number(a[i]),Number(b[i])))nonfinite++;}else{max=Math.max(max,d);sum+=d;values.push(d);}}values.sort((a,b)=>a-b);return{length:a.length,expectedLength:b.length,max,median:values[values.length>>1],mean:sum/values.length,nonfinite};}
async function arr(song:string,spec:any){return arrayFromBytes(await get(`/ref/${song}/array/${spec.id}`),spec.dtype);}
onmessage=async({data})=>{try{
 if(data.type==='load'){
  const backend=data.backend;
  const ort=backend==='webgpu'?await import('onnxruntime-web/webgpu'):await import('onnxruntime-web/wasm');
  if(data.verbose)ort.env.logLevel='verbose';
  let current='';const sessions:any=[];
  if(data.profile&&backend==='webgpu'){ort.env.webgpu.profiling={mode:'default',ondata:e=>out('gpu-kernel',{graph:current,...e})};}

  models=await loadModels(async p=>{if(p.endsWith('.onnx')){current=p;out('graph-loading',{graph:p});}return get('/model/onnx/'+p);},{ort,backend,wasm:{numThreads:1,wasmPaths:'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.23.2/dist/'},session:{executionProviders:backend==='webgpu'?['webgpu','wasm']:['wasm'],logSeverityLevel:data.verbose?0:2,logVerbosityLevel:data.verbose?4:0},runtimeSource:p=>get('/assets/'+p)});
  const original=models.run.bind(models);models.run=async(name:any,feeds:any)=>{activeGraph=current=name;return original(name,feeds);};
  out('loaded',{backend});
 }
 if(data.type==='compare'){
  const cpu=await loadModels(p=>get('/model/onnx/'+p),{ort:models.ort,backend:'wasm',wasm:{numThreads:1},session:{executionProviders:['wasm']},runtimeSource:p=>get('/assets/'+p)});
  const original=models.run.bind(models),stats:any={};models.run=async(name:any,feeds:any)=>{const a=await original(name,feeds),b=await cpu.run(name,feeds);const s=stats[name]??={calls:0,max:0,outputs:{}};s.calls++;for(const key of Object.keys(a)){const d=diff(a[key].data,b[key].data);s.max=Math.max(s.max,d.max);const o=s.outputs[key]??={max:0,values:0,nonfinite:0};o.max=Math.max(o.max,d.max);o.values+=d.length;o.nonfinite+=d.nonfinite;}return a;};
  let result,error;try{result=await generateChart(models,{samples:data.mel,channels:1,mel:data.mel,beatthis:data.beatthis},24000,{audio:{asset_id:data.song},star:3.5,seed:0});}catch(e){error=String(e);}
  models.run=original;await cpu.dispose();out('compare-result',{song:data.song,stats,error,gpuWork,chart:result?.chart});
 }
 if(data.type==='networks'){
  const song=data.song,reference=await json(`/ref/${song}/network`),results:any={};
  for(const call of reference){const feeds:any={};for(const [name,spec] of Object.entries<any>(call.inputs))feeds[name]=new models.ort.Tensor(tensorType(spec.dtype),await arr(song,spec),spec.shape);
   const t=performance.now();out('graph-run',{graph:call.name});
   try{const result=await models.run(call.name,feeds);const outputs:any={};for(const [name,v] of Object.entries<any>(result))outputs[name]={dims:v.dims,difference:diff(v.data,await arr(song,call.outputs[name]))};results[call.name]={seconds:(performance.now()-t)/1000,outputs};}catch(e){results[call.name]={error:String(e)};}
  }out('networks-result',{results,gpuWork});
 }
 if(data.type==='replay'){
  const {song}=data;let {mel,beatthis}=data;const ref=await json(`/ref/${song}/compact`);let position=0,choiceDifferences:any[]=[],traces:any={};
  const random={algorithm:'python-recorded-draws',reset(){},async draw(name:string,kind:string){const d=ref.draws[position++];if(!d||d.name!==name||d.kind!==kind)throw Error(JSON.stringify({stage:'draw-sequence',position:position-1,requested:name,kind,expected:d?.name,expectedKind:d?.kind}));return d;},check(d:any,scores:any){const choice=argmax(scores);if(choice!==d.chosen)choiceDifferences.push({position:position-1,name:d.name,expected:d.chosen,actual:choice,margin:scores[choice]-scores[d.chosen]});return choice;},async multinomial(p:Float32Array,name:string){const d=await this.draw(name,'exponential');return this.check(d,p.map((v,i)=>f32(v/d.values[i])));},async gumbel(logits:any,name:string){const d=await this.draw(name,'uniform');return this.check(d,Array.from(logits,(v:any,i)=>v-Math.log(-Math.log(Math.max(d.values[i],2.2250738585072014e-308)))));},async orientation(name:string){const d=await this.draw(name,'orientation');return d.values[0];}};
  let result,error;let pcm:any={samples:mel,channels:1,mel,beatthis},sampleRate=24000;
  if(data.referencePCM){const meta=await json(`/ref/${song}/audio-meta`);mel=new Float32Array((await get(`/ref/${song}/array/2`)).buffer);pcm={samples:new Float64Array((await get(`/ref/${song}/array/0`)).buffer),channels:meta.channels,mel};sampleRate=meta.rate;}
  try{result=await generateChart(models,pcm,sampleRate,{audio:{asset_id:song},star:ref.star,seed:0},{random,trace:async(name,values)=>{
   if(name==='listener'){
    const g=values.grid,b0=Math.floor(g.beat(0)),nb=Math.max(Math.ceil(g.beat(values.song_ms))-b0,1),positions=models.manifest.constants['audio_rows.figures'].POSITIONS,actual=[];
    for(let b=0;b<nb;b++)for(let p=0;p<24;p++)actual.push(g.time(b0+b+positions[p]/48));
    traces.grid={...diff(actual,ref.gridPositions),actualFirst:actual.slice(0,24),referenceFirst:ref.gridPositions.slice(0,24),wholeMsMismatches:actual.filter((x,i)=>round(x)!==round(ref.gridPositions[i])).length,segments:values.segments,referenceSegments:ref.segments};
    traces.frontend={melLength:mel.length,beatthisLength:beatthis?.length,songMs:values.song_ms,pythonSongMs:ref.songMs,pythonMelLength:ref.melLength,beatLogits:diff(values.beat_logits,ref.beatLogits),downbeatLogits:diff(values.downbeat_logits,ref.downbeatLogits)};
    out('grid-result',{song,...traces});
   }
   if(name==='system/rows'){traces.heads={...diff(values.headMs,ref.headMs),equal:values.headMs.every((v,i)=>v===ref.headMs[i])&&values.headMs.length===ref.headMs.length};}
  }});}catch(e){error=String(e);}
  const objects=result?.chart.objects;out('replay-result',{song,traces,drawsConsumed:position,drawsExpected:ref.draws.length,choiceDifferences,objectsEqual:objects?JSON.stringify(objects)===JSON.stringify(ref.objects):false,objectCount:objects?.length,expectedObjects:ref.objects.length,firstObjectDifference:objects?.findIndex((o,i)=>JSON.stringify(o)!==JSON.stringify(ref.objects[i])),error,seconds:result?JSON.parse(result.receipt.receipt_json).seconds:undefined});
 }
}catch(error){out('error',{error:String(error),stack:(error as Error).stack});}};
