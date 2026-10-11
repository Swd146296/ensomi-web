import {readFile,writeFile} from 'node:fs/promises';
const root=new URL('../../artifacts/browser-test/',import.meta.url),pages=JSON.parse(await readFile(new URL('mobile-contrast.json',root),'utf8'));
const urls=[...new Set(pages[0].links.map(l=>l.href).filter(x=>x.startsWith('http')))];
const results=await Promise.all(urls.map(async url=>{try{const r=await fetch(url,{signal:AbortSignal.timeout(30000)});const body=await r.text();return {url,status:r.status,finalUrl:r.url,ok:r.ok,title:body.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]};}catch(e){return{url,error:String(e)};}}));
await writeFile(new URL('links.json',root),JSON.stringify(results,null,2));console.log(results);
