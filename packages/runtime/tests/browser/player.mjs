/** Measures the actual production canvas via draw calls and the audio element clock. */
export async function playerChecks(page,out){
 const result={};
 await page.locator('#result').scrollIntoViewIfNeeded();await page.bringToFront();
 await page.evaluate(()=>{
  const audio=document.querySelector('#audio'),canvas=document.querySelector('#lanes');window.__player={samples:[],capture:false,last:0,firstDraw:null};
  const rr=CanvasRenderingContext2D.prototype.roundRect;
  CanvasRenderingContext2D.prototype.roundRect=function(x,y,w,h,...r){if(this.canvas===canvas&&h===14&&this.fillStyle==='#eaa0b7'&&!__player.firstDraw)__player.firstDraw={x,y};return rr.call(this,x,y,w,h,...r);};
  const raf=window.requestAnimationFrame;window.requestAnimationFrame=callback=>raf(time=>{
   __player.firstDraw=null;const before=audio.currentTime*1000,start=performance.now();callback(time);const after=audio.currentTime*1000;
   if(__player.capture&&__player.firstDraw){
    const chart=__test.results.at(-1).chart,draw=__player.firstDraw,judge=canvas.clientHeight*.82,laneW=Math.min(80,(canvas.clientWidth-32)/4),x0=(canvas.clientWidth-4*laneW)/2,lane=Math.round((draw.x-x0-4)/laneW);
    const speed=Number(document.querySelector('#speeds [aria-pressed="true"]').textContent),offset=(draw.y+7-judge)/(speed/1000);
    let best=null;for(const o of chart.objects){if(o.lane!==lane||o.end_ms!==undefined)continue;const drawn=o.start_ms+offset;if(!best||Math.abs(drawn-before)<Math.abs(best.drawn-before))best={drawn,head:o.start_ms};}
    __player.samples.push({frame:time,cpuMs:performance.now()-start,audio:after,drawn:best.drawn,driftBefore:best.drawn-before,driftAfter:best.drawn-after,rate:audio.playbackRate,clock:document.querySelector('#clock').textContent});
   }
  });
 });
 function summary(samples){const pct=(v,q)=>{v=[...v].sort((a,b)=>a-b);return v[Math.min(v.length-1,Math.floor(v.length*q))]};const intervals=samples.slice(1).map((s,i)=>s.frame-samples[i].frame),drifts=samples.map(s=>Math.abs(s.driftAfter));return{samples:samples.length,wallSeconds:(samples.at(-1).frame-samples[0].frame)/1000,fps:1000*(samples.length-1)/(samples.at(-1).frame-samples[0].frame),intervalMedian:pct(intervals,.5),intervalP95:pct(intervals,.95),intervalMax:Math.max(...intervals),drawTimeMedian:pct(samples.map(s=>s.cpuMs),.5),drawTimeP95:pct(samples.map(s=>s.cpuMs),.95),maxDriftMs:Math.max(...drifts),medianDriftMs:pct(drifts,.5),overOneMedianFrame:drifts.filter(x=>x>pct(intervals,.5)).length,first:samples[0],last:samples.at(-1)};}
 result.playback={};
 for(const [rate,duration] of [[1,60],[.5,60],[1.5,60]]){
  await page.locator('#rates button').getByText(`${rate}×`,{exact:true}).click();
  await page.evaluate(()=>{const a=document.querySelector('#audio');a.pause();a.currentTime=30;__player.capture=false;__player.samples=[];});
  await page.waitForTimeout(250);await page.locator('#play').click();await page.waitForTimeout(300);
  await page.evaluate(()=>{__player.samples=[];__player.capture=true;});
  await page.waitForTimeout(duration*1000);
  const samples=await page.evaluate(()=>{__player.capture=false;document.querySelector('#audio').pause();return __player.samples;});
  result.playback[rate]=summary(samples);
  const {writeFile}=await import('node:fs/promises');await writeFile(`${out}/bulk/player-${rate}-frames.json`,JSON.stringify(samples));
 }
 await page.locator('#rates button').getByText('1×',{exact:true}).click();
 const current=()=>page.evaluate(()=>document.querySelector('#audio').currentTime*1000);
 const reset=async()=>{await page.evaluate(()=>{const a=document.querySelector('#audio');a.pause();a.currentTime=60;});await page.waitForTimeout(100);};
 const check=async(name,expected,fn)=>{await reset();await fn();await page.waitForTimeout(120);const actual=await current();result[name]={expectedMs:expected,actualMs:actual,errorMs:actual-expected,clock:await page.locator('#clock').textContent()};};
 // Expected times follow the visual speed selected on the page.
 const speed=await page.evaluate(()=>Number(document.querySelector('#speeds [aria-pressed="true"]').textContent));
 const rect=await page.locator('#lanes').boundingBox(),ov=await page.locator('#overview').boundingBox();
 await check('right',65000,async()=>{await page.locator('#lanes').focus();await page.keyboard.press('ArrowRight');});
 await check('left',55000,async()=>{await page.locator('#lanes').focus();await page.keyboard.press('ArrowLeft');});
 await check('up',60000+40/speed*1000,async()=>{await page.locator('#lanes').focus();await page.keyboard.press('ArrowUp');});
 await check('down',60000-40/speed*1000,async()=>{await page.locator('#lanes').focus();await page.keyboard.press('ArrowDown');});
 await check('click',60000+240/speed*1000,async()=>page.mouse.click(rect.x+100,rect.y+rect.height*.82-240));
 await check('drag',60000+120/speed*1000,async()=>{await page.mouse.move(rect.x+100,rect.y+300);await page.mouse.down();await page.mouse.move(rect.x+100,rect.y+180,{steps:10});await page.mouse.up();});
 await page.evaluate(()=>{window.__wheelEvents=[];document.querySelector('#lanes').addEventListener('wheel',e=>__wheelEvents.push({deltaY:e.deltaY,deltaMode:e.deltaMode}),{capture:true});});
 await check('wheel',60000-120/speed*1000,async()=>{await page.mouse.move(rect.x+100,rect.y+300);await page.mouse.wheel(0,120);});
 result.wheel.events=await page.evaluate(()=>window.__wheelEvents);result.wheel.expectedFromDeliveredEventsMs=60000-result.wheel.events.reduce((a,e)=>a+e.deltaY,0)/speed*1000;result.wheel.errorFromDeliveredEventsMs=result.wheel.actualMs-result.wheel.expectedFromDeliveredEventsMs;
 const duration=await page.evaluate(()=>__test.results.at(-1).chart.duration_ms);
 await check('overview',duration*.5,async()=>page.mouse.click(ov.x+ov.width*.5,ov.y+ov.height*.5));
 await check('restart',0,async()=>page.locator('#restart').click());
 await page.locator('#lanes').focus();await page.keyboard.press('Space');await page.waitForTimeout(250);result.spacePlays=await page.evaluate(()=>!document.querySelector('#audio').paused);await page.keyboard.press('Space');result.spacePauses=await page.evaluate(()=>document.querySelector('#audio').paused);
 await page.locator('#result').screenshot({path:`${out}/screenshots/player-adventure.png`});
 return result;
}
