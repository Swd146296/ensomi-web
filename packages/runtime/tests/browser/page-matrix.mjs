/** Headed Chrome page test. Run from packages/runtime: node tests/browser/page-matrix.mjs [webgpu|wasm] [local|hf|folder]. */
import { playerChecks } from './player.mjs';
import { chromium } from 'playwright';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { unzipSync, strFromU8 } from 'fflate';
const runtime=resolve(import.meta.dirname,'../..'), repo=resolve(runtime,'../..'), modelRepo=resolve(repo,'../ensomi-model');
const out=join(runtime,'artifacts/browser-test'), bulk=join(out,'bulk');
const backend=process.argv[2]||'webgpu', source=process.argv[3]||'local', base=process.env.ENSOMI_TEST_URL||'http://127.0.0.1:8087';
const model=process.env.ENSOMI_MODEL_DIR||join(modelRepo,'artifacts/release-r2/bulk/hf/ensomi-r2');
const allSongs=[['catch-the-moment','576112','mp3',3.5],['adventure','2202551','ogg',4.5],['hesitation-snow','2486779','ogg',2.5],['saigetsu','1403084','mp3',3.5]];
const selectedSong=process.argv[4];const songs=selectedSong?allSongs.filter(s=>s[0]===selectedSong):allSongs;const reportSuffix=selectedSong?`-${selectedSong}`:'';
await mkdir(bulk,{recursive:true});await mkdir(join(out,'screenshots'),{recursive:true});
const report={backend,source,started:new Date().toISOString(),loads:[],runs:[],errors:[]};
const save=()=>writeFile(join(out,`page-${backend}-${source}${reportSuffix}.json`),JSON.stringify(report,null,2));
const browser=await chromium.launch({channel:'chrome',headless:false,args:['--disable-background-timer-throttling','--disable-renderer-backgrounding','--enable-precise-memory-info']});
report.chromeVersion=browser.version();
const browserCDP=await browser.newBrowserCDPSession();report.memory={rendererPeakKiB:0,gpuProcessPeakKiB:0,method:'Chrome SystemInfo process IDs; ps RSS every second, maximum renderer and GPU process; not GPU allocations'};
const memoryTimer=setInterval(async()=>{try{const {processInfo}=await browserCDP.send('SystemInfo.getProcessInfo');for(const p of processInfo.filter(p=>p.type==='renderer'||p.type==='GPU')){const rss=Number(execFileSync('ps',['-o','rss=','-p',String(p.id)],{encoding:'utf8'}).trim());const key=p.type==='GPU'?'gpuProcessPeakKiB':'rendererPeakKiB';report.memory[key]=Math.max(report.memory[key],rss);}}catch{}},1000);
const context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true});
await context.addInitScript(()=>{
  window.__test={events:[],sent:[],results:[],decodes:[],heapPeak:0};
  const NativeWorker=window.Worker;
  window.Worker=class extends NativeWorker{constructor(...args){super(...args);this.addEventListener('message',({data})=>{const t=performance.now(); if(data.type==='result'){window.__test.results.push(data.result);window.__test.events.push({type:'result',t});}else window.__test.events.push({...data,t});});}postMessage(data,...rest){window.__test.sent.push({type:data.type,t:performance.now(),request:data.request});return super.postMessage(data,...rest);}};
  const decode=OfflineAudioContext.prototype.decodeAudioData;
  OfflineAudioContext.prototype.decodeAudioData=async function(...args){const t=performance.now();const b=await decode.apply(this,args);window.__test.decodes.push({rate:b.sampleRate,length:b.length,channels:b.numberOfChannels,seconds:(performance.now()-t)/1000});return b;};
  setInterval(()=>{window.__test.heapPeak=Math.max(window.__test.heapPeak,performance.memory?.usedJSHeapSize||0);},250);
});
const page=await context.newPage();
page.on('console',m=>{if(m.type()==='error'||m.type()==='warning')report.errors.push({type:m.type(),text:m.text()});});
page.on('pageerror',e=>report.errors.push({type:'pageerror',text:e.message}));
async function load(warm){
 const url=new URL(base);if(source!=='hf')url.searchParams.set('model','/model/onnx/');if(backend==='wasm')url.searchParams.set('backend','wasm');
 await page.goto(url.href);await page.bringToFront();
 if(!report.environment)report.environment=await page.evaluate(async()=>{const a=await navigator.gpu?.requestAdapter();return{ua:navigator.userAgent,hardwareConcurrency:navigator.hardwareConcurrency,deviceMemory:navigator.deviceMemory,gpu:a?{vendor:a.info.vendor,architecture:a.info.architecture,device:a.info.device,description:a.info.description}:null};});
 if(source==='folder'){await page.locator('input[value="folder"]').check();await page.locator('#folder').setInputFiles(join(model,'onnx'));}
 const start=performance.now();await page.locator('#load').click();await page.waitForFunction(()=>__test.events.some(e=>['loaded','error'].includes(e.type)),null,{timeout:300000});
 const data=await page.evaluate(()=>({events:__test.events,heapPeak:__test.heapPeak,status:document.querySelector('#model-status').textContent,error:document.querySelector('#error').textContent}));
 const row={warm,wallSeconds:(performance.now()-start)/1000,...data};report.loads.push(row);await save();console.log('LOAD',backend,source,warm,row.wallSeconds,row.status);
 if(!data.events.some(e=>e.type==='loaded'))throw new Error(data.error);
}
function validate(chart){const errors=[],end=[-1,-1,-1,-1];let prev;for(const o of chart.objects){if(!Number.isInteger(o.lane)||o.lane<0||o.lane>3||!Number.isInteger(o.start_ms)||o.start_ms<0||o.start_ms>chart.duration_ms)errors.push(['head',o]);if(prev&&(o.start_ms<prev.start_ms||o.start_ms===prev.start_ms&&o.lane<=prev.lane))errors.push(['sort',o]);if(o.start_ms<end[o.lane])errors.push(['overlap',o]);if(o.end_ms!==undefined&&(!Number.isInteger(o.end_ms)||o.end_ms<=o.start_ms||o.end_ms>chart.duration_ms))errors.push(['hold',o]);end[o.lane]=o.end_ms??o.start_ms;prev=o;}return errors;}
async function generate(song,warm,section=false){
 const [slug,id,ext,star]=song;const audioPath=join(modelRepo,`dataset/0/${id}/audio.${ext}`);
 const decodeStart=performance.now();await page.locator('#song').setInputFiles(audioPath);
 await page.waitForFunction(()=>!document.querySelector('#song-status').textContent.includes('Decoding'),null,{timeout:30000});
 const decodeWallSeconds=(performance.now()-decodeStart)/1000;
 await page.locator('#star').fill(String(star));await page.locator('#seed').fill('0');await page.locator('#title').fill(slug);
 const index=await page.evaluate(()=>__test.results.length),eventStart=await page.evaluate(()=>__test.events.length),started=performance.now();
 await page.locator('#generate-button').click();
 await page.waitForFunction(({index,eventStart})=>__test.results.length>index||__test.events.slice(eventStart).some(e=>e.type==='error'),{index,eventStart},{timeout:600000});
 const wallSeconds=(performance.now()-started)/1000;
 const data=await page.evaluate(index=>{const r=__test.results[index];return {chart:r?.chart,receipt:r?.receipt,events:__test.events,decodes:__test.decodes,status:document.querySelector('#song-status').textContent,error:document.querySelector('#error').hidden?null:document.querySelector('#error').textContent,heapPeak:__test.heapPeak,table:[...document.querySelectorAll('#times tr')].map(x=>x.innerText)};},index);
 const label=`${backend}-${source}${reportSuffix}-${warm?'warm':'cold'}-${slug}${section?'-section':''}`;
 const row={song:slug,warm,section,star,decodeWallSeconds,wallSeconds,...data};
 if(data.chart){
  row.validation=validate(data.chart);row.chartSha256=createHash('sha256').update(JSON.stringify(data.chart)).digest('hex');row.detail=JSON.parse(data.receipt.receipt_json);
  for(const kind of ['osz','osu']){const wait=page.waitForEvent('download');await page.locator(`#get-${kind}`).click();const download=await wait;await download.saveAs(join(bulk,`${label}.${kind}`));}
  const archive=unzipSync(await readFile(join(bulk,`${label}.osz`)));const audioKey=Object.keys(archive).find(k=>k.startsWith('audio.'));
  row.archive={names:Object.keys(archive),audioExact:Buffer.from(archive[audioKey]).equals(await readFile(audioPath)),osuExact:strFromU8(archive['generated.osu'])===await readFile(join(bulk,`${label}.osu`),'utf8'),receiptExact:strFromU8(archive['receipt.json']).trim()===data.receipt.receipt_json};
  await writeFile(join(bulk,`${label}-chart.json`),JSON.stringify(data.chart));delete row.chart;delete row.receipt;
 }if(row.error||row.validation?.length||row.archive&&Object.values(row.archive).some(v=>v===false))process.exitCode=1;report.runs.push(row);await save();console.log('RUN',label,wallSeconds,row.detail?.seconds,row.error,row.validation?.length);
 await page.locator(data.chart?'#result':'#error').screenshot({path:join(out,`screenshots/${label}.png`)});
 return row;
}
try{
 await load(false);
 for(const song of songs)await generate(song,false);
 if(source==='local'&&!selectedSong){
  // Reject a five-second section before the generate message can be sent.
  await page.locator('#add-section').click();await page.locator('.start').fill('00:20');await page.locator('.end').fill('00:25');
  report.invalidSection=await page.evaluate(()=>({message:document.querySelector('#section-error').textContent,disabled:document.querySelector('#generate-button').disabled,sent:__test.sent.filter(x=>x.type==='generate').length}));
  await page.locator('#conditions').screenshot({path:join(out,`screenshots/${backend}-invalid-section.png`)});
  await page.locator('.end').fill('00:40');await page.locator('.kind').selectOption('jumpstream');await page.locator('.value').fill('0.7');
  await generate(songs[3],false,true);await page.locator('.remove').click();
 }
 if(source!=='folder'){await load(true);for(const song of songs.slice(0,2))await generate(song,true);}
 if(process.env.ENSOMI_PLAYER==='1') { report.player=await playerChecks(page,out); await writeFile(join(out,'player.json'),JSON.stringify(report.player,null,2)); }
 report.finished=new Date().toISOString();
}catch(e){process.exitCode=1;report.failure=String(e);console.error(e);}finally{clearInterval(memoryTimer);await save();await browser.close();}
