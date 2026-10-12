/** Test-only worker. Imports the production runtime unchanged; observes graph calls by wrapping its sessions and replays recorded draws through `options.replay`. */
import { loadModels, generateChart } from '@ensomi/runtime';
let models:any, activeGraph='initialization';const gpuWork:any={};
for(const [type,method] of [['GPUQueue','submit'],['GPUComputePassEncoder','dispatchWorkgroups']]){
 const prototype=(globalThis as any)[type]?.prototype;if(prototype){const original=prototype[method];prototype[method]=function(...args:any[]){const s=gpuWork[activeGraph]??={submit:0,dispatchWorkgroups:0};s[method]++;return original.apply(this,args);};}
}
const get=async(p:string)=>new Uint8Array(await (await fetch(p)).arrayBuffer());
const json=async(p:string)=>(await fetch(p)).json();
const out=(type:string,data:any)=>postMessage({type,...data});
const arrays:any={'<f4':[Float32Array,'float32'],'<i8':[BigInt64Array,'int64'],'|b1':[Uint8Array,'bool']};
const options=(backend:string,session:any)=>({backend,core:'/pkg/ensomi_generate_wasm_bg.wasm',wasm:{numThreads:1,wasmPaths:'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.23.2/dist/'},session,runtimeSource:(p:string)=>get('/assets/'+p)});
/** Replaces each session's `run` with `run(name, feeds, session)`; generateChart calls only `run`. */
function wrap(m:any,run:(name:string,feeds:any,session:any)=>Promise<any>){for(const [name,session] of Object.entries<any>(m.sessions))m.sessions[name]={run:(feeds:any)=>run(name,feeds,session),release:()=>session.release()};}
function diff(a:any,b:any){let max=0,sum=0,nonfinite=0;const values=[];for(let i=0;i<Math.min(a.length,b.length);i++){const d=Math.abs(Number(a[i])-Number(b[i]));if(!Number.isFinite(d)){if(!Object.is(Number(a[i]),Number(b[i])))nonfinite++;}else{max=Math.max(max,d);sum+=d;values.push(d);}}values.sort((a,b)=>a-b);return{length:a.length,expectedLength:b.length,max,median:values[values.length>>1],mean:sum/values.length,nonfinite};}
async function arr(song:string,spec:any){return new arrays[spec.dtype][0]((await get(`/ref/${song}/array/${spec.id}`)).buffer);}
onmessage=async({data})=>{try{
 if(data.type==='load'){
  const backend=data.backend;
  const ort=backend==='webgpu'?await import('onnxruntime-web/webgpu'):await import('onnxruntime-web/wasm');
  if(data.verbose)ort.env.logLevel='verbose';
  let current='';
  if(data.profile&&backend==='webgpu'){ort.env.webgpu.profiling={mode:'default',ondata:e=>out('gpu-kernel',{graph:current,...e})};}
  models=await loadModels(async p=>{if(p.endsWith('.onnx')){current=p;out('graph-loading',{graph:p});}return get('/model/onnx/'+p);},{ort,...options(backend,{executionProviders:backend==='webgpu'?['webgpu','wasm']:['wasm'],logSeverityLevel:data.verbose?0:2,logVerbosityLevel:data.verbose?4:0})});
  wrap(models,(name,feeds,session)=>{activeGraph=current=name;return session.run(feeds);});
  out('loaded',{backend});
 }
 if(data.type==='compare'){
  const cpu=await loadModels(p=>get('/model/onnx/'+p),{ort:models.ort,...options('wasm',{executionProviders:['wasm']})}),sessions={...models.sessions},stats:any={};
  wrap(models,async(name,feeds)=>{const a=await sessions[name].run(feeds),b=await cpu.sessions[name].run(feeds);const s=stats[name]??={calls:0,max:0,outputs:{}};s.calls++;for(const key of Object.keys(a)){const d=diff(a[key].data,b[key].data);s.max=Math.max(s.max,d.max);const o=s.outputs[key]??={max:0,values:0,nonfinite:0};o.max=Math.max(o.max,d.max);o.values+=d.length;o.nonfinite+=d.nonfinite;}return a;});
  let result,error;try{result=await generateChart(models,{samples:data.mel,channels:1,mel:data.mel,beatthis:data.beatthis},24000,{audio:{asset_id:data.song},star:3.5,seed:0});}catch(e){error=String(e);}
  models.sessions=sessions;await cpu.dispose();out('compare-result',{song:data.song,stats,error,gpuWork,chart:result?.chart});
 }
 if(data.type==='networks'){
  const song=data.song,reference=await json(`/ref/${song}/network`),results:any={};
  for(const call of reference){const feeds:any={};for(const [name,spec] of Object.entries<any>(call.inputs))feeds[name]=new models.ort.Tensor(arrays[spec.dtype][1],await arr(song,spec),spec.shape);
   const t=performance.now();out('graph-run',{graph:call.name});
   try{const result=await models.sessions[call.name].run(feeds);const outputs:any={};for(const [name,v] of Object.entries<any>(result))outputs[name]={dims:v.dims,difference:diff(v.data,await arr(song,call.outputs[name]))};results[call.name]={seconds:(performance.now()-t)/1000,outputs};}catch(e){results[call.name]={error:String(e)};}
  }out('networks-result',{results,gpuWork});
 }
 if(data.type==='replay'){
  // The core stops at the first draw whose name or chosen index differs from the recording; its message is the first divergence.
  const {song}=data,ref=await json(`/ref/${song}/compact`),replay=new models.core.ReplayDraws();
  for(const d of ref.draws)replay.add(d.name,d.kind,Float64Array.from(d.values),d.chosen);
  let result,error;let pcm:any=data.pcm??{samples:data.mel,channels:1,mel:data.mel,beatthis:data.beatthis},sampleRate=data.rate??24000;
  if(data.referencePCM){const meta=await json(`/ref/${song}/audio-meta`);pcm={samples:new Float64Array((await get(`/ref/${song}/array/0`)).buffer),channels:meta.channels,mel:new Float32Array((await get(`/ref/${song}/array/2`)).buffer)};sampleRate=meta.rate;}
  try{result=await generateChart(models,pcm,sampleRate,{audio:{asset_id:song},star:ref.star,seed:0},{replay});}catch(e){error=String(e);}
  const objects=result?.chart.objects;out('replay-result',{song,drawsConsumed:result?.replayConsumed,drawsExpected:ref.draws.length,objectsEqual:objects?JSON.stringify(objects)===JSON.stringify(ref.objects):false,objectCount:objects?.length,expectedObjects:ref.objects.length,firstObjectDifference:objects?.findIndex((o:any,i:number)=>JSON.stringify(o)!==JSON.stringify(ref.objects[i])),error,seconds:result?JSON.parse(result.receipt.receipt_json).seconds:undefined});
 }
}catch(error){out('error',{error:String(error),stack:(error as Error).stack});}};
