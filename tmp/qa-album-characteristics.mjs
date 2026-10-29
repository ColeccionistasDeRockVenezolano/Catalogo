import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {chromium} from 'playwright';
const base='http://127.0.0.1:3120/crv';
const out='reports/caracteristicas-discos';
const browser=await chromium.launch({headless:true});
const checks=[];
try {
 for(const width of [1440,390]) {
  const context=await browser.newContext({viewport:{width,height:1000},reducedMotion:'reduce'});
  const page=await context.newPage();
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route(/https:\/\/(?:www\.youtube(?:-nocookie)?\.com|open\.spotify\.com|widget\.deezer\.com)\//,r=>r.abort());
  await page.goto(`${base}/discos?tipo=acoustic`,{waitUntil:'domcontentloaded'});
  await page.locator('.grid-cards .entity-card').first().waitFor();
  await page.getByRole('button',{name:/^Tipo de disco/}).click();
  for(const label of ['Acústico','Instrumental','Remix','Deluxe','Remasterizado','Reedición','Edición especial','Edición limitada','Otra edición']) await page.getByRole('button',{name:new RegExp(`^${label}\\b`)}).waitFor();
  assert.equal(await page.getByRole('button',{name:/^Acústico\b/}).getAttribute('aria-pressed'),'true');
  await page.screenshot({path:`${out}/filtros-${width}.png`});
  await page.getByRole('button',{name:/^Deluxe\b/}).click();
  await page.waitForURL('**/discos?tipo=deluxe');
  await page.waitForFunction(()=>[...document.querySelectorAll('.grid-cards .entity-card')].length===6);
  assert.equal(await page.getByRole('button',{name:/^Deluxe\b/}).getAttribute('aria-pressed'),'true');
  assert.equal(await page.locator('.grid-cards .entity-card').count(),6);
  checks.push({width,view:'filters',categoriesVisible:true,deluxeResults:6,overflow:await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)});
  for(const [id,key,label] of [[561,'acoustic','Acústico'],[13717,'deluxe','Deluxe'],[852,'remastered','Remasterizado']]) {
   await page.goto(`${base}/discos/${id}`,{waitUntil:'domcontentloaded'});
   const badge=page.locator(`.entity-hero__meta a[href$="tipo=${key}"]`).first();
   await badge.waitFor();assert.equal(await badge.textContent(),label);
   if(key!=='acoustic') {
    await page.getByRole('heading',{name:/Versiones/}).waitFor();
    assert.equal(await page.locator('.version-list .version-row').count(),1);
    await page.locator('.version-list').scrollIntoViewIfNeeded();
    await page.screenshot({path:`${out}/edicion-${id}-${width}.png`});
    assert(await page.locator(`.version-list a[href$="tipo=${key}"]`).isVisible());
   }
   checks.push({width,view:`album-${id}`,badge:label,overflow:await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)});
  }
  assert.deepEqual(errors,[]);
  assert(checks.filter(c=>c.width===width).every(c=>!c.overflow));
  await context.close();
 }
 writeFileSync(`${out}/navegador.json`,JSON.stringify({checkedAt:new Date().toISOString(),checks,errors:[]},null,2)+'\n');
 console.log(JSON.stringify(checks));
} finally {await browser.close()}
