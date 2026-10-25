import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';

const base = process.env.CRV_WEB_URL ?? 'http://127.0.0.1:3120/crv';
const out = process.env.CRV_AV_CAPTURE_DIR ?? '.impeccable/review/av-home-cards';
await mkdir(out, { recursive: true });
const source = await readFile('web/tests/visual/album-player-qa.mjs', 'utf8');
const iframeApi = source.match(/const iframeApi = `([\s\S]*?)`;/u)[1];
const browser = await chromium.launch({ headless: true });
const results = [];
try {
 for (const [name, viewport] of [['desktop',{width:1440,height:1000}],['mobile',{width:390,height:844}]]) {
  const context = await browser.newContext({viewport,reducedMotion:'reduce',hasTouch:name==='mobile'});
  const page = await context.newPage();
  const errors=[]; page.on('pageerror',e=>errors.push(e.message));
  await page.route('https://www.youtube.com/iframe_api',r=>r.fulfill({contentType:'text/javascript',body:iframeApi}));
  await page.route('https://www.youtube-nocookie.com/embed/**',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><title>Prueba de reproducción</title><body style="background:#111;color:white">Prueba del reproductor</body>'}));
  await page.goto(`${base}/artistas/55?tab=audiovisuales`);
  await page.getByRole('heading',{name:'Candy66',exact:true}).waitFor();
  const tab=page.getByRole('tab',{name:/Audiovisuales/u});
  assert.equal(await tab.getAttribute('aria-selected'),'true');
  const section=page.getByRole('region',{name:'Audiovisuales de Candy66'});
  await section.waitFor();
  assert.equal(await section.locator('.home-video__open').count(),4);
  assert.equal(await section.locator('.home-video__play').count(),4);
  const radius=await section.locator('.home-video__thumb').first().evaluate(el=>getComputedStyle(el).borderRadius);
  assert.equal(radius,'14px');
  assert.equal(await section.locator('.audiovisuals__item').count(),4);
  await section.getByRole('button',{name:/Videoclip/u}).click();
  assert.equal(await section.locator('.audiovisuals__item').count(),3);
  await section.getByRole('button',{name:/Todos/u}).click();
  await page.evaluate(async()=>{await document.fonts.ready; await Promise.all([...document.images].map(i=>i.decode().catch(()=>{}))); window.scrollTo(0,0);});
  await page.screenshot({path:`${out}/${name}.png`,fullPage:true});
  await section.evaluate(el=>window.scrollTo(0,window.scrollY+el.getBoundingClientRect().top-125));
  await page.screenshot({path:`${out}/${name}-audiovisuales.png`});
  await section.locator('.home-video__open').first().click();
  await page.waitForFunction(()=>window.__youtubeInstances?.length===1);
  await page.evaluate(()=>{const p=window.__youtubeInstances[0];p.events.onReady({target:p});});
  const chapters=section.locator('.audiovisuals__chapters').first();
  await section.getByText('Capítulos y canciones (9)',{exact:true}).click();
  const chapter=chapters.getByRole('button').nth(1);
  const expected=await chapter.locator('span').textContent();
  const seconds=expected.split(':').reduce((n,p)=>n*60+Number(p),0);
  await chapter.click();
  await page.waitForFunction(()=>window.__youtubeInstances?.length===1);
  await page.evaluate(()=>{const p=window.__youtubeInstances[0];p.events.onReady({target:p});});
  await page.waitForFunction(s=>window.__youtubeCalls.some(c=>c[0]==='seekTo'&&c[1]===s),seconds);
  assert.equal(await page.locator('iframe[src*="youtube-nocookie.com/embed/"]').count(),1);
  await tab.focus(); await page.keyboard.press('ArrowLeft');
  assert.equal(await page.getByRole('tab',{name:/Discografía/u}).getAttribute('aria-selected'),'true');
  assert.equal(await page.locator('iframe[src*="youtube-nocookie.com/embed/"]').count(),1,'conserva el reproductor compartido al cambiar de pestaña');
  await page.keyboard.press('ArrowRight');
  assert.equal(await tab.getAttribute('aria-selected'),'true');
  assert.equal(await page.locator('iframe[src*="youtube-nocookie.com/embed/"]').count(),1);
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1);
  assert.equal(overflow,false);
  assert.deepEqual(errors,[]);
  await page.goto(`${base}/artistas/102?tab=audiovisuales`);
  const gasSection=page.getByRole('region',{name:'Audiovisuales de Gasolina'});
  await gasSection.getByRole('button',{name:'Reproducir Blues Criollo',exact:true}).waitFor();
  await page.evaluate(async()=>{await document.fonts.ready;await Promise.all([...document.images].map(i=>i.decode().catch(()=>{})));window.scrollTo(0,0);});
  await page.screenshot({path:`${out}/${name}-gasolina-full.png`,fullPage:true});
  await gasSection.evaluate(el=>window.scrollTo(0,window.scrollY+el.getBoundingClientRect().top-125));
  await page.screenshot({path:`${out}/${name}-gasolina.png`});
  results.push({name,viewport,sharedHomeCard:true,gasolinaDocumentaryVisible:true,filters:true,chapterSeekSeconds:seconds,sharedPlayer:true,keyboardTabs:true,noOverflow:true,noPageErrors:true});
  await context.close();
 }
 const page=await browser.newPage();
 for(const [id,expected] of [[259,'Tiempo Nos Queda'],[266,'Detrás De La Puerta'],[2946,'Live Sessions At ViveConCancha'],[109,'Smells Like Teen Spirit']]) {
  const artist=await (await page.request.get(`${base}/api/artists/${id}`)).json();
  assert(artist.audiovisuals.some(v=>v.title===expected));
  assert(!artist.discography.some(a=>a.title===expected));
 }
 const gas=await(await page.request.get(`${base}/api/artists/102`)).json();
 assert(gas.discography.some(a=>a.albumId===5122));
 assert(gas.audiovisuals.some(a=>a.title==='Blues Criollo'&&a.kind==='documentary'));
 assert.equal((await(await page.request.get(`${base}/api/albums/5122`)).json()).tracklist.length,5);
 await page.goto(`${base}/artistas/266?tab=audiovisuales`);
 await page.getByText('Video no disponible',{exact:true}).waitFor();
 assert.equal(await page.getByRole('region',{name:/Audiovisuales de/u}).getByRole('button',{name:/Reproducir/u}).count(),0);
 for(const id of [1,2,3,4]){
  const candidate=await(await page.request.get(`${base}/api/artists/${id}`)).json();
  if(candidate.id&&!candidate.audiovisuals.length){await page.goto(`${base}/artistas/${id}?tab=audiovisuales`);await page.getByText('Sin audiovisuales registrados.',{exact:true}).waitFor();break;}
 }
 await page.goto(`${base}/`);
 const homeCard=page.locator('.home-video').first();await homeCard.locator('.home-video__open').waitFor();
 await homeCard.scrollIntoViewIfNeeded();
 assert.equal(await homeCard.locator('.home-video__play').evaluate(el=>getComputedStyle(el).width),'54px');
 const output={base,results,migratedAlbums:true,gasolinePreserved:true,unverifiedAndEmptyStates:true,playerApi:'simulada; disponibilidad y datos reales del catálogo'};
 await writeFile(`${out}/audiovisuales-qa.json`,JSON.stringify(output,null,2)+'\n');
 console.log(JSON.stringify(output,null,2));
}finally{await browser.close();}
