import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';

const base = process.env.CRV_WEB_URL ?? 'http://127.0.0.1:5174';
const out = process.env.CRV_HOME_QA_DIR ?? '/tmp/crv-home-followup';
await mkdir(out, {recursive:true});
const browser = await chromium.launch({headless:true});
const results = [];
try {
  if (process.env.CRV_HOME_QA_MODE !== "motion") await Promise.all([{name:'desktop',width:1440,height:1000},{name:'mobile',width:390,height:844}].map(async view => {
    const page = await browser.newPage({viewport:view, reducedMotion:'reduce'});
    const errors=[]; page.on('pageerror',err=>errors.push(err.message));
    let embedRequests=0; page.on('request',req=>{if (/youtube-nocookie.com\/embed\//.test(req.url())) embedRequests++;});
    await page.goto(base);
    await page.locator('#home-anniversaries .entity-card__artist').first().waitFor({state:'attached'});
    await page.locator('#home-anniversaries').scrollIntoViewIfNeeded();
    const card = page.locator('#home-anniversaries .entity-card').first();
    assert.match(await card.locator('.entity-card__art').getAttribute('href'), /\/discos\/\d+$/);
    assert.match(await card.locator('.entity-card__artist').getAttribute('href'), /\/artistas\/\d+$/);
    assert.match(await card.locator('.entity-card__year').getAttribute('href'), /\/discos\?decada=/);
    assert.match(await card.locator('.entity-card__album-type').getAttribute('href'), /\/discos\?tipo=/);
    assert.match(await card.locator('.entity-card__genre').first().getAttribute('href'), /\/discos\?genero=/);
    assert.equal(await page.locator('a a').count(),0);
    await page.locator('#home-anniversaries').scrollIntoViewIfNeeded();
    await page.screenshot({path:`${out}/${view.name}-cards.png`});
    await page.locator('#home-decades').scrollIntoViewIfNeeded();
    await page.screenshot({path:`${out}/${view.name}-decades.png`});
    const chart=await page.locator('.home-decades').evaluate(node=>({ overflow:document.documentElement.scrollWidth-document.documentElement.clientWidth, bars:[...node.querySelectorAll('.home-decades__bar')].map(bar=>({h:bar.getBoundingClientRect().height,w:bar.getBoundingClientRect().width,background:getComputedStyle(bar).backgroundImage})) }));
    assert.equal(chart.overflow,0);assert.ok(chart.bars.every(bar=>bar.h>=2&&bar.w>0&&bar.background==='none'));
    await page.locator('.home-video__open').first().click();
    const iframe=page.locator('.catalog-video-player iframe'); await iframe.waitFor();
    await page.waitForTimeout(1500);
    assert.equal(await page.getByRole('dialog').count(),0);
    assert.equal(await page.locator('.catalog-video-player--floating').count(),0);
    await page.screenshot({path:`${out}/${view.name}-inline.png`});
    const identity=await iframe.elementHandle();
    const frame=await identity.contentFrame();
    let playback;
    try {
      await frame.waitForFunction(()=>{const v=document.querySelector('video');return v&&v.currentTime>0&&!v.paused;},{},{timeout:30000});
      playback=await frame.evaluate(()=>{const v=document.querySelector('video');return {time:v.currentTime,paused:v.paused};});
    } catch { playback={externalUnavailable:true}; }
    await page.getByRole('button',{name:'Video flotante',exact:true}).click();
    await page.screenshot({path:`${out}/${view.name}-floating.png`});
    assert.equal(await page.locator('.catalog-video-player--floating iframe').count(),1);
    assert.ok(await identity.evaluate(node=>node===document.querySelector('.catalog-video-player iframe')));
    const beforeRequests=embedRequests;
    await page.locator('.main-nav').getByRole('link',{name:'Artistas',exact:true}).click();
    await page.locator('.grid-cards .entity-card').first().waitFor();
    assert.ok(await identity.evaluate(node=>node===document.querySelector('.catalog-video-player iframe')));
    assert.equal(embedRequests,beforeRequests,'navegar no recarga el iframe');
    await page.getByRole('button',{name:'Volver al video en la página'}).click();
    await page.waitForFunction(()=>document.querySelector('.catalog-video-slot--active'));
    await page.waitForTimeout(400);
    const box=await page.locator('.catalog-video-player').boundingBox();
    assert.ok(box.y>=0&&box.y<view.height);
    assert.ok(await identity.evaluate(node=>node===document.querySelector('.catalog-video-player iframe')));
    await page.getByRole('button',{name:'Cerrar video',exact:true}).click();
    assert.equal(await iframe.count(),0);
    await page.locator('#home-anniversaries .entity-card__title').first().click();
    await page.locator('.entity-hero__meta a[href*="genero="]').first().waitFor();
    assert.equal(await page.locator('a a').count(),0);
    await page.locator('.entity-hero__meta a[href*="decada="]').first().click();
    await page.locator('.grid-cards .entity-card').first().waitFor();
    assert.match(page.url(), /decada=/);
    assert.deepEqual(errors,[]);
    results.push({view:view.name,chart,playback,embedRequests,persistent:true,errors});await page.close();
  }));
  if (process.env.CRV_HOME_QA_MODE !== 'visual') {
    const page=await browser.newPage({viewport:{width:1440,height:1000}});
    await page.goto(base); await page.locator('#home-anniversaries .home-rail__item').first().waitFor();
    const section=page.locator('#home-anniversaries'),rail=section.locator('.home-rail');
    await section.scrollIntoViewIfNeeded();await section.locator('h2').hover();
    await page.waitForTimeout(8000);
    assert.ok(await rail.evaluate(node=>node.scrollLeft>0),'el hover no pausa el avance');
    const years=await section.locator('h2').innerText();
    await rail.evaluate(node=>node.scrollTo({left:node.scrollWidth,behavior:'instant'}));
    await section.locator('h2').hover();
    await page.waitForFunction(old=>document.querySelector('#home-anniversaries h2').textContent!==old,years,{timeout:8500});
    assert.ok(await rail.evaluate(node=>node.scrollLeft)<=4);
    results.push({motion:{hoverDoesNotPause:true,changesGroupAfterOneCycle:true}});await page.close();
  }
  await writeFile(`${out}/checks.json`,JSON.stringify(results,null,2));console.log(JSON.stringify(results,null,2));
} finally {await browser.close();}
