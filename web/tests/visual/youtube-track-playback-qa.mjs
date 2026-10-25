import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';
const base=process.env.CRV_WEB_URL??'http://127.0.0.1:3120/crv';
const audit=JSON.parse(await readFile('reports/youtube-track-playback-2026-10-15.json','utf8'));
const albums=audit.albums.filter(a=>a.restored.length);
const fixture=await readFile('web/tests/visual/album-player-qa.mjs','utf8');
const iframeApi=fixture.match(/const iframeApi = `([\s\S]*?)`;/u)[1];
const output='docs/ui-qa/youtube-track-playback-2026-10-15';await mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true}); const results=[];
try{
 for(const viewport of [{width:1440,height:1000},{width:390,height:844}]){
  const context=await browser.newContext({viewport,reducedMotion:'reduce',hasTouch:viewport.width<600});
  const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('https://www.youtube.com/iframe_api',r=>r.fulfill({contentType:'text/javascript',body:iframeApi}));
  await page.route('https://www.youtube-nocookie.com/embed/**',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><title>Prueba de órdenes de reproducción</title><body style="background:#111;color:white">Prueba de reproducción</body>'}));
  for(const album of albums){
   await page.goto(`${base}/discos/${album.id}`);
   await page.getByRole('heading',{name:album.title,exact:true}).waitFor();
   let checked=0;
   for(const track of album.restored){
    const row=page.locator(`#pista-${track.id}`);await row.waitFor();
    const total=track.startSeconds;const expected=total>=3600?`${Math.floor(total/3600)}:${String(Math.floor(total%3600/60)).padStart(2,'0')}:${String(total%60).padStart(2,'0')}`:`${Math.floor(total/60)}:${String(total%60).padStart(2,'0')}`;
    assert.equal((await row.locator('.track-youtube-time').textContent()).trim(),expected);
    const button=row.locator('.track-youtube-play');assert.equal(await button.count(),1);
    await page.evaluate(()=>{window.__youtubeCalls=[];});
    await button.click();
    await page.waitForFunction(()=>window.__youtubeInstances?.length===1);
    await page.evaluate(()=>{const p=window.__youtubeInstances[0];p.events.onReady({target:p});});
    await page.waitForFunction(seconds=>window.__youtubeCalls.some(c=>c[0]==='seekTo'&&c[1]===seconds),track.startSeconds);
    const frame=page.locator('iframe[src*="youtube-nocookie.com/embed/"]');assert.equal(await frame.count(),1);
    assert((await frame.getAttribute('src')).includes(track.videoId));
    checked++;
   }
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
   results.push({width:viewport.width,albumId:album.id,artist:album.artist,title:album.title,verifiedButtonsAndSeeks:checked});
  }
  assert.deepEqual(errors,[]);await context.close();
 }
 const result={base,results,totalButtonsAndSeeks:results.reduce((n,r)=>n+r.verifiedButtonsAndSeeks,0),playerApi:'simulada para verificar cada orden seek/play; metadatos y API del catálogo reales'};
 await writeFile(`${output}/browser-qa.json`,JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));
}finally{await browser.close();}
