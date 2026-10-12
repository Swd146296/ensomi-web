import {playerChecks} from './player.mjs';
import {chromium} from 'playwright';import {readFile,writeFile} from 'node:fs/promises';import {resolve,join} from 'node:path';
const out=resolve(import.meta.dirname,'../../artifacts/browser-test'),matrix=JSON.parse(await readFile(join(out,'page-wasm-local.json'),'utf8')),run=matrix.runs.find(r=>r.song==='adventure');
const fixture={loaded:matrix.loads[0].events.find(e=>e.type==='loaded'),result:{chart:JSON.parse(await readFile(join(out,'bulk/wasm-local-cold-adventure-chart.json'),'utf8')),receipt:{model_name:'Ensomi R2',model_version:'r2-1.0',seed:0,star:4.5,receipt_json:JSON.stringify(run.detail)},osu:await readFile(join(out,'bulk/wasm-local-cold-adventure.osu'),'utf8'),osz:[]}};
const browser=await chromium.launch({channel:'chrome',headless:!process.env.ENSOMI_HEADED}),page=await browser.newPage({viewport:{width:1440,height:1000}});
await page.addInitScript(fixture=>{window.__test={results:[fixture.result]};window.Worker=class{onmessage;postMessage(data){setTimeout(()=>this.onmessage({data:data.type==='load'?fixture.loaded:{type:'result',result:{...fixture.result,osz:new Uint8Array()}}}),0);}};},fixture);
await page.goto('http://127.0.0.1:8087/');await page.locator('#load').click();
await page.locator('#song').setInputFiles(resolve(import.meta.dirname,'../../../../../ensomi-model/dataset/0/2202551/audio.ogg'));
await page.locator('#generate-button').click();await page.locator('#result').waitFor();await page.locator('#lanes').scrollIntoViewIfNeeded();
await page.evaluate(()=>{window.wheels=[];document.querySelector('#lanes').addEventListener('wheel',e=>wheels.push({dy:e.deltaY,dx:e.deltaX,mode:e.deltaMode,t:performance.now(),audio:document.querySelector('#audio').currentTime}),{capture:true});});
if(process.env.ENSOMI_PLAYER==='1'){const r=await playerChecks(page,out);await writeFile(join(out,'player-extended.json'),JSON.stringify(r,null,2));await browser.close();process.exit(0);}
const results=[];const rect=await page.locator('#lanes').boundingBox();
for(const kind of ['playwright-120','dom-120','playwright-minus120']){
 await page.evaluate(()=>{document.querySelector('#audio').currentTime=60;wheels=[];});await page.waitForTimeout(100);
 if(kind==='dom-120')await page.locator('#lanes').dispatchEvent('wheel',{deltaY:120,deltaMode:0});else{await page.mouse.move(rect.x+100,rect.y+300);await page.mouse.wheel(0,kind.includes('minus')?-120:120);}
 await page.waitForTimeout(250);results.push({kind,...await page.evaluate(()=>({events:wheels,timeMs:document.querySelector('#audio').currentTime*1000,clock:document.querySelector('#clock').textContent}))});
}
await writeFile(join(out,'wheel.json'),JSON.stringify(results,null,2));console.log(results);await browser.close();
