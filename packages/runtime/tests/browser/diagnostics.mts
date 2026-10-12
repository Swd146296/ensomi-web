import { chromium } from 'playwright';
import { build } from 'esbuild';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createReadStream, statSync } from 'node:fs';
import { resolve,join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Recording, chartFromDecisions, parseOsu } from '../../../../../ensomi-runtime/js/checks/recording.mjs';
// The npm package's directory: its decodeAudio, Wasm core (pkg/) and resampler tables (served as /assets/).
const pkg=fileURLToPath(new URL('..',import.meta.resolve('@ensomi/runtime')));
const runtime=resolve(import.meta.dirname,'../..'),modelRepo=resolve(runtime,'../../../ensomi-model'),out=join(runtime,'artifacts/browser-test'),bulk=join(out,'bulk');
await mkdir(bulk,{recursive:true});
const backend=process.argv[2]||'wasm',mode=process.argv[3]||'replay';
await build({entryPoints:[join(import.meta.dirname,'diagnostics.ts')],bundle:true,format:'esm',target:'es2022',outfile:join(bulk,'diagnostics.js')});
await build({entryPoints:[join(pkg,'src/decode_audio.js')],bundle:true,format:'esm',target:'es2022',outfile:join(bulk,'decode.js')});
// The page's decoding for exact timing (native rate, the core resamples), for the native mode.
await build({entryPoints:[join(runtime,'../../site/audio.ts')],bundle:true,format:'esm',target:'es2022',outfile:join(bulk,'audio.js')});
const recordings=new Map();async function rec(song:string){if(!recordings.has(song))recordings.set(song,await Recording.open(join(modelRepo,'artifacts/runtime-ref/bulk',song)));return recordings.get(song);}
/** The chart the release's recorded pass-1 decisions make, as ensomi-runtime's js/checks/replay.mjs builds it. */
async function firstArrangement(r:any){
 const head=Array.from((await r.event('system/rows')).head_ms,Number),audio=r.index.events.find((e:any)=>e.name==='audio').arrays,actions=[],gaps=[];
 for(let k=0;k<=head.length;k++){const chosen=await r.event(`r2_pass_1/${k}/chosen`);actions.push(Array.from(chosen.codes,Number));gaps.push(Array.from(chosen.releases,Number));}
 return chartFromDecisions(head,1000*r.shape(audio.pcm)[0]/Number((await r.get(audio.sample_rate))[0]),actions,gaps);
}
const server=createServer(async(req,res)=>{try{const p=new URL(req.url!,'http://localhost').pathname;let file;
 if(p==='/'){res.setHeader('Content-Type','text/html');res.end('<title>Ensomi browser diagnostics</title><h1>Ensomi runtime browser diagnostics</h1>');return;}
 if(p==='/diagnostics.js'||p==='/decode.js'||p==='/audio.js')file=join(bulk,p.slice(1));
 else if(p.startsWith('/model/'))file=join(modelRepo,'artifacts/release-r2/bulk/hf/ensomi-r2',p.slice(7));
 else if(p.startsWith('/assets/'))file=join(pkg,'resampler',p.slice(8));
 else if(p.startsWith('/pkg/'))file=join(pkg,p.slice(1));
 else if(p.startsWith('/song/')){const summary=JSON.parse(await readFile(join(modelRepo,'artifacts/runtime-ref',p.slice(6),'summary.json'),'utf8'));file=join(modelRepo,summary.audio);}
 else if(p.startsWith('/ref/')){
  const [, ,song,kind,id]=p.split('/'),r=await rec(song);res.setHeader('Content-Type','application/json');
  if(kind==='audio-meta'){res.end(JSON.stringify({rate:Number((await r.get(1))[0]),frames:r.index.arrays[0].shape[0],channels:r.index.arrays[0].shape[1]??1,melFrames:r.index.arrays[2].shape[0]}));return;}
  if(kind==='native'||kind==='mel'){
   const spec=r.index.arrays[kind==='native'?0:2],rate=kind==='native'?Number((await r.get(1))[0]):24000,channels=kind==='native'?(spec.shape[1]??1):1,bytes=kind==='native'?8:4,offset=Number(id)*rate*channels*bytes,count=Math.min(2*rate*channels*bytes,spec.nbytes-offset);res.setHeader('Content-Type','application/octet-stream');createReadStream(join(modelRepo,'artifacts/runtime-ref/bulk',song,'arrays.bin'),{start:spec.byte_offset+offset,end:spec.byte_offset+offset+count-1}).pipe(res);return;
  }
  if(kind==='array'){const spec=r.index.arrays[Number(id)];res.setHeader('Content-Type','application/octet-stream');createReadStream(join(modelRepo,'artifacts/runtime-ref/bulk',song,'arrays.bin'),{start:spec.byte_offset,end:spec.byte_offset+spec.nbytes-1}).pipe(res);return;}
  if(kind==='network'){const seen=new Set(),calls=r.index.graphs.filter(c=>{if(seen.has(c.name))return false;seen.add(c.name);return true;});res.end(JSON.stringify(calls.map(c=>({...c,inputs:Object.fromEntries(Object.entries(c.inputs).map(([n,id])=>[n,{id,...r.index.arrays[id]}])),outputs:Object.fromEntries(Object.entries(c.outputs).map(([n,id])=>[n,{id,...r.index.arrays[id]}]))}))));return;}
  if(kind==='compact'){
   // The runtime arranges once. Where the release arranged a second time, its pass-2 draws are left out and the reference is its first arrangement.
   const summary=JSON.parse(await readFile(join(modelRepo,'artifacts/runtime-ref',song,'summary.json'),'utf8')),pass2=(d:any)=>d.name.startsWith('r2_pass_2/'),releasePasses=r.index.draws.some(pass2)?2:1;
   const draws=[];for(const d of r.index.draws)if(!pass2(d))draws.push({...d,values:Array.from(await r.get(d.values),Number)});
   const compact={star:summary.settings.star,releasePasses,draws,objects:releasePasses===2?await firstArrangement(r):parseOsu(await readFile(join(modelRepo,'artifacts/runtime-ref/bulk',song,'reference/generated.osu'),'utf8'))};res.end(JSON.stringify(compact));return;}
 }
 if(!file){res.writeHead(404).end();return;}res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.json')?'application/json':file.endsWith('.wasm')?'application/wasm':'application/octet-stream');createReadStream(file).pipe(res);
}catch(e){res.writeHead(500).end(String(e));}}).listen(0,'127.0.0.1');
await new Promise(r=>server.once('listening',r));const origin=`http://127.0.0.1:${(server.address() as any).port}`;
const browser=await chromium.launch({channel:'chrome',headless:!process.env.ENSOMI_HEADED,args:['--disable-background-timer-throttling','--disable-renderer-backgrounding']});
const page=await browser.newPage({viewport:{width:1200,height:800}}),logs:any[]=[],results:any[]=[];
page.on('console',m=>logs.push({type:m.type(),text:m.text()}));
await page.goto(origin);
await page.evaluate(()=>{(window as any).events=[];(window as any).w=new Worker('/diagnostics.js',{type:'module'});(window as any).w.onmessage=({data})=>(window as any).events.push(data);});
async function command(data:any,done:string){const start=await page.evaluate(()=>((window as any).events.length));await page.evaluate(d=>(window as any).w.postMessage(d),data);await page.waitForFunction(({start,done})=>(window as any).events.slice(start).some((e:any)=>e.type===done||e.type==='error'),{start,done},{timeout:600000});const events=await page.evaluate(start=>(window as any).events.slice(start),start);const result=events.find((e:any)=>e.type===done||e.type==='error');results.push(result);console.log(done,JSON.stringify(result).slice(0,3000));await writeFile(join(out,`diagnostics-${backend}-${mode}.json`),JSON.stringify(results,null,2));await writeFile(join(bulk,`diagnostics-${backend}-${mode}-events.json`),JSON.stringify(await page.evaluate(()=>(window as any).events)));await writeFile(join(bulk,`diagnostics-${backend}-${mode}-console.json`),JSON.stringify(logs,null,2));return result;}
try{
 if(mode!=='pcm')await command({type:'load',backend,verbose:mode==='networks',profile:mode==='networks'},'loaded');
 if(mode==='networks')await command({type:'networks',song:'catch-the-moment'},'networks-result');
 else for(const song of mode==='compare'?['catch-the-moment']:['hesitation-snow','saigetsu','catch-the-moment','adventure']){
  await page.evaluate(song=>(window as any).song=song,song);
  if(mode==='native')await page.evaluate(async(song)=>{const {decodeSong}=await import('/audio.js');const bytes=await(await fetch('/song/'+song)).arrayBuffer();(window as any).decoded=await decodeSong(bytes);(window as any).song=song;},song);
  else if(mode!=='control')await page.evaluate(async(song)=>{const {decodeAudio}=await import('/decode.js');const bytes=await(await fetch('/song/'+song)).arrayBuffer();const decoded=await decodeAudio(bytes);(window as any).decoded=decoded;(window as any).song=song;},song);
  if(mode==='pcm'){
   const pcm=await page.evaluate(async(song)=>{
    const meta=await(await fetch('/ref/'+song+'/audio-meta')).json(),bytes=await(await fetch('/song/'+song)).arrayBuffer();const native=await new OfflineAudioContext(1,1,meta.rate).decodeAudioData(bytes),mel=(window as any).decoded.pcm.mel;
    const a=new Float32Array(native.length);for(let ch=0;ch<native.numberOfChannels;ch++){const b=native.getChannelData(ch);for(let i=0;i<a.length;i++)a[i]+=b[i]/native.numberOfChannels;}
    const windows=[];for(const kind of ['native','mel'])for(const sec of [0,30,60,100]){
     const data=await(await fetch('/ref/'+song+'/'+kind+'/'+sec)).arrayBuffer(),r=kind==='native'?new Float64Array(data):new Float32Array(data),channels=kind==='native'?meta.channels:1,rate=kind==='native'?meta.rate:24000,w=kind==='native'?a:mel,offset=sec*rate,n=Math.min(r.length/channels,w.length-offset);
     const ref=new Float32Array(n);for(let i=0;i<n;i++)for(let ch=0;ch<channels;ch++)ref[i]+=r[i*channels+ch]/channels;
     let max=0,maxIndex=0,sq=0,energy=0;for(let i=0;i<n;i++){const d=w[offset+i]-ref[i];if(Math.abs(d)>max){max=Math.abs(d);maxIndex=i;}sq+=d*d;energy+=ref[i]*ref[i];}
     let bestLag=0,best=Infinity;for(let lag=-1200;lag<=1200;lag++){let sum=0,count=0;for(let i=1200;i<n-1200;i+=64){const d=w[offset+i+lag]-ref[i];sum+=d*d;count++;}if(sum/count<best){best=sum/count;bestLag=lag;}}
     windows.push({kind,sec,n,max,maxAtMs:1000*(offset+maxIndex)/rate,maxValues:{browser:w[offset+maxIndex],reference:ref[maxIndex],referenceChannels:Array.from(r.slice(maxIndex*channels,(maxIndex+1)*channels)),browserChannels:kind==='native'?Array.from({length:native.numberOfChannels},(_,ch)=>native.getChannelData(ch)[offset+maxIndex]):undefined},rms:Math.sqrt(sq/n),relativeRms:Math.sqrt(sq/energy),bestLagSamples:bestLag,bestLagMs:1000*bestLag/rate,bestLagRms:Math.sqrt(best)});
    }
    return {song,meta,browserNativeFrames:native.length,browserNativeChannels:native.numberOfChannels,browserMelFrames:mel.length,browserBeatFrames:(window as any).decoded.pcm.beatthis.length,nativeLengthDifferenceMs:(native.length-meta.frames)/meta.rate*1000,melLengthDifferenceMs:(mel.length-meta.melFrames)/24,windows};
   },song);results.push(pcm);console.log(song,JSON.stringify(pcm));await writeFile(join(out,`diagnostics-${backend}-${mode}.json`),JSON.stringify(results,null,2));continue;
  }
  const start=await page.evaluate(()=>(window as any).events.length);
  await page.evaluate(mode=>{const {mel,beatthis}=(window as any).decoded?.pcm??{},native=mode==='native'?(window as any).decoded:{};(window as any).w.postMessage({type:mode==='control'||mode==='native'?'replay':mode,referencePCM:mode==='control',song:(window as any).song,mel,beatthis,...native});},mode);
  await page.waitForFunction(start=>(window as any).events.slice(start).some((e:any)=>['replay-result','compare-result','error'].includes(e.type)),start,{timeout:600000});
  const r=await page.evaluate(start=>(window as any).events.slice(start).filter((e:any)=>['replay-result','compare-result','error'].includes(e.type)),start);results.push(...r);console.log(song,JSON.stringify(r).slice(0,4000));await writeFile(join(out,`diagnostics-${backend}-${mode}.json`),JSON.stringify(results,null,2));
 }
}finally{await writeFile(join(bulk,`diagnostics-${backend}-${mode}-console.json`),JSON.stringify(logs,null,2));await browser.close();server.close();for(const r of recordings.values())await r.close();}
