/** Splits unmodified worker loading into file reads, ORT module import, and graph initialization.
 * Instrumentation is built only into artifacts/browser-test/bulk; product files are never written.
 */
import { chromium } from 'playwright';
import { build } from 'esbuild';
import { readFile,writeFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createServer } from 'node:http';
import {resolve,join,extname} from 'node:path';
const runtime=resolve(import.meta.dirname,'../..'),repo=resolve(runtime,'../..'),model=resolve(repo,'../ensomi-model/artifacts/release-r2/bulk/hf/ensomi-r2'),out=join(runtime,'artifacts/browser-test'),bundle=join(out,'bulk/loading-worker.js');
await build({entryPoints:[join(repo,'site/worker.ts')],bundle:true,format:'esm',target:'es2022',outfile:bundle,plugins:[{name:'measure-production-load',setup(b){b.onLoad({filter:/\/src\/models\.ts$/},async({path})=>{
 let s=await readFile(path,'utf8');
 s=s.replace("const read = typeof source === 'string' ? urlSource(source) : source;",`const rawRead = typeof source === 'string' ? urlSource(source) : source; const read = async (path:string) => { const start=performance.now();const bytes=await rawRead(path);postMessage({type:'test-read',path,bytes:bytes.length,seconds:(performance.now()-start)/1000});return bytes;};`);
 s=s.replace('const ort = options.ort ??', 'const importStart=performance.now();const ort = options.ort ??');
 s=s.replace('if (options.wasm)', "postMessage({type:'test-import',seconds:(performance.now()-importStart)/1000});\n    if (options.wasm)");
 s=s.replace('sessions[name] = await ort.InferenceSession.create(await read(graph.file),', 'const bytes=await read(graph.file);const start=performance.now();sessions[name] = await ort.InferenceSession.create(bytes,');
 s=s.replace("['wasm'] });", "['wasm'] });postMessage({type:'test-init',name,seconds:(performance.now()-start)/1000});");
 return {contents:s,loader:'ts'};
 });}}]});
const server=createServer((req,res)=>{const p=new URL(req.url,'http://localhost').pathname,file=p==='/worker.js'?bundle:p.startsWith('/model/')?join(model,p.slice(7)):join(repo,'public',p==='/'?'index.html':p);res.setHeader('Content-Type',({'.js':'text/javascript','.html':'text/html','.css':'text/css','.json':'application/json','.png':'image/png','.svg':'image/svg+xml'})[extname(file)]||'application/octet-stream');createReadStream(file).on('error',()=>res.writeHead(404).end()).pipe(res);}).listen(0,'127.0.0.1');
await new Promise(r=>server.once('listening',r));const origin=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({channel:'chrome',headless:false}),results=[];
try{for(const source of ['local','hf'])for(const backend of ['webgpu','wasm']){
 const context=await browser.newContext({viewport:{width:1440,height:1000}});await context.addInitScript(()=>{window.events=[];const W=Worker;window.Worker=class extends W{constructor(...args){super(...args);this.addEventListener('message',({data})=>events.push({...data,t:performance.now()}));}};});const page=await context.newPage();
 for(const warm of [false,true]){
  const url=new URL(origin);if(source==='local')url.searchParams.set('model','/model/onnx/');if(backend==='wasm')url.searchParams.set('backend','wasm');await page.goto(url.href);await page.locator('#load').click();await page.waitForFunction(()=>events.some(e=>e.type==='loaded'||e.type==='error'),null,{timeout:300000});
  const ev=await page.evaluate(()=>events);const loaded=ev.find(e=>e.type==='loaded'),reads=ev.filter(e=>e.type==='test-read'),inits=ev.filter(e=>e.type==='test-init');const row={source,backend,warm,loadSeconds:loaded?.seconds,readSeconds:reads.reduce((a,b)=>a+b.seconds,0),initSeconds:inits.reduce((a,b)=>a+b.seconds,0),importSeconds:ev.find(e=>e.type==='test-import')?.seconds,bytes:reads.reduce((a,b)=>a+b.bytes,0),reads,inits,files:ev.filter(e=>e.type==='file'),error:ev.find(e=>e.type==='error'),chromeVersion:browser.version()};row.resources=await page.workers()[0].evaluate(()=>performance.getEntriesByType('resource').map(e=>e.toJSON()));results.push(row);console.log(JSON.stringify({...row,reads:undefined,inits:undefined,files:undefined,resources:undefined}));await writeFile(join(out,'load-benchmark.json'),JSON.stringify(results,null,2));
 }await context.close();
}}finally{await browser.close();server.close();}
