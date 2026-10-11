/** Optional RSS sampler for dedicated Chrome processes named on the command line. */
import {execFileSync} from 'node:child_process';
import {writeFile} from 'node:fs/promises';
const pids=process.argv.slice(2).map(Number),rows=[];let peaks={};
while(true){let lines;try{lines=execFileSync('ps',['-o','pid=,rss=','-p',pids.join(',')],{encoding:'utf8'}).trim();}catch{break;}if(!lines)break;const row=lines.split('\n').map(s=>s.trim().split(/\s+/).map(Number));rows.push({t:Date.now(),processes:row});for(const [pid,rss] of row)peaks[pid]=Math.max(peaks[pid]||0,rss);await writeFile(new URL(`../../artifacts/browser-test/${process.env.ENSOMI_MEMORY_NAME||'memory'}.json`,import.meta.url),JSON.stringify({unit:'KiB RSS, sampled every second; includes process allocations, not isolated model GPU memory',peaks,samples:rows},null,2));await new Promise(r=>setTimeout(r,1000));}
