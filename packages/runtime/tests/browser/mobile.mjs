import { chromium, devices } from 'playwright';
import {writeFile,mkdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
const out=resolve(import.meta.dirname,'../../artifacts/browser-test'),base=process.env.ENSOMI_TEST_URL||'http://127.0.0.1:8087';
const browser=await chromium.launch({channel:'chrome',headless:!process.env.ENSOMI_HEADED});const results=[];
for(const [name,profile,width] of [['iphone-13',devices['iPhone 13'],390],['pixel-7',devices['Pixel 7'],393],['phone-360',devices['Pixel 7'],360],['phone-430',devices['iPhone 13'],430],['desktop',{},1440]]){
 const context=await browser.newContext({...profile,viewport:{width,height:name==='desktop'?1000:844}}),page=await context.newPage();await page.goto(base);await page.locator('img').first().waitFor();await page.evaluate(()=>Promise.all([...document.images].map(i=>{i.loading='eager';return i.decode().catch(()=>{});})));
 const data=await page.evaluate(()=>{
  const visible=e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&getComputedStyle(e).visibility!=='hidden';};
  const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d');canvas.width=canvas.height=1;
  function rgba(css){ctx.clearRect(0,0,1,1);ctx.fillStyle=css;ctx.fillRect(0,0,1,1);return [...ctx.getImageData(0,0,1,1).data].map((v,i)=>i===3?v/255:v);}
  const blend=(a,b)=>a.slice(0,3).map((x,i)=>x*a[3]+b[i]*(1-a[3])).concat(1);
  const lum=c=>c.slice(0,3).map(x=>x/255).map(x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4).reduce((v,x,i)=>v+x*[.2126,.7152,.0722][i],0);
  const ratio=(a,b)=>(Math.max(lum(a),lum(b))+.05)/(Math.min(lum(a),lum(b))+.05);
  const text=[];
  for(const e of document.querySelectorAll('body *')){
   if(!visible(e)||e.matches(':disabled')||e.closest('[disabled]'))continue;
   const direct=[...e.childNodes].filter(n=>n.nodeType===3).map(n=>n.textContent.trim()).join(' ').trim();if(!direct&&!e.matches('input[type=text],select'))continue;
   const s=getComputedStyle(e),chain=[];let el=e;while(el){chain.unshift(el);el=el.parentElement;}let bgs=[[255,255,255,1]],gradient=false;
   for(const node of chain){const cs=getComputedStyle(node),bg=rgba(cs.backgroundColor);bgs=bgs.map(b=>blend(bg,b));if(cs.backgroundImage.startsWith('linear-gradient')){gradient=true;const colors=cs.backgroundImage.match(/rgba?\([^)]+\)/g);if(colors)bgs=colors.flatMap(c=>bgs.map(b=>blend(rgba(c),b)));}}
   const fg=rgba(s.color),contrast=Math.min(...bgs.map(b=>ratio(blend(fg,b),b))),size=parseFloat(s.fontSize),weight=Number(s.fontWeight),required=size>=24||size>=18.6667&&weight>=700?3:4.5;
   text.push({tag:e.tagName,id:e.id,class:e.className,text:(direct||e.value||e.getAttribute('placeholder')||'').slice(0,100),color:s.color,backgrounds:bgs,gradient,size,weight,contrast,required,pass:contrast>=required});
  }
  return{viewport:innerWidth,scrollWidth:document.documentElement.scrollWidth,bodyWidth:document.body.scrollWidth,note:[...document.querySelectorAll('.desktop-note')].filter(visible).map(e=>e.textContent.trim()),toolVisible:visible(document.querySelector('.tool')),hero:document.querySelector('h1').innerText,images:[...document.images].map(i=>({src:i.getAttribute('src'),ok:i.complete&&i.naturalWidth>0,alt:i.alt,width:i.clientWidth})),links:[...document.querySelectorAll('a')].filter(visible).map(a=>({text:a.innerText.trim(),href:a.getAttribute('href')})),overflows:[...document.querySelectorAll('body *')].filter(visible).filter(e=>{const r=e.getBoundingClientRect();return r.right>innerWidth+1||r.left< -1;}).map(e=>({tag:e.tagName,class:e.className,id:e.id})),horizontalScrollers:[...document.querySelectorAll('body *')].filter(visible).filter(e=>e.scrollWidth>e.clientWidth+1&&['auto','scroll'].includes(getComputedStyle(e).overflowX)).map(e=>({tag:e.tagName,id:e.id,clientWidth:e.clientWidth,scrollWidth:e.scrollWidth,text:e.textContent.slice(0,80)})),contrast:text};
 });
 const screenshot=`screenshots/${name}.png`;await page.screenshot({path:join(out,screenshot),fullPage:true});await page.locator('.hero').screenshot({path:join(out,`screenshots/${name}-hero.png`)});await page.locator('pre').screenshot({path:join(out,`screenshots/${name}-code.png`)});await page.locator('.gallery').screenshot({path:join(out,`screenshots/${name}-previews.png`)});results.push({name,profile:name.startsWith('iphone')?'iPhone 13':name.startsWith('pixel')?'Pixel 7':name,...data,screenshot});await context.close();
}
await writeFile(join(out,'mobile-contrast.json'),JSON.stringify(results,null,2));await browser.close();console.log(results.map(r=>({name:r.name,width:r.viewport,scroll:r.scrollWidth,overflow:r.overflows,contrastMin:Math.min(...r.contrast.map(x=>x.contrast)),failures:r.contrast.filter(x=>!x.pass)})));
