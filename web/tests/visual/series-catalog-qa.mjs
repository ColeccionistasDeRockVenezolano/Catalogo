// Verificación repetible contra el catálogo real: sólo lecturas.
import assert from 'node:assert/strict';
import { writeFile, mkdir } from 'node:fs/promises';
import { chromium, expect } from '@playwright/test';
const base=process.env.CRV_WEB_URL??'http://127.0.0.1:5173';
const api=process.env.CRV_API_URL??'http://127.0.0.1:8082';
const out=process.env.CRV_QA_OUT;if(!out)throw new Error('Define CRV_QA_OUT en staging SSD');
await mkdir(out,{recursive:true});
const browser=await chromium.launch();const results=[];
try{
 for(const width of [1280,390,320]){
  const context=await browser.newContext({viewport:{width,height:900},reducedMotion:'reduce'});const page=await context.newPage();const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',async route=>{
   if(!['GET','HEAD','OPTIONS'].includes(route.request().method()))return route.abort();
   const url=new URL(route.request().url());
   if(url.origin==='http://127.0.0.1:8080')return route.fulfill({response:await route.fetch({url:`${api}${url.pathname}${url.search}`})});
   return route.continue();
  });
  await page.goto(`${base}/discos?q=VenezuelaDemo`);
  await expect(page.locator('.entity-card')).toHaveCount(30);
  await page.getByRole('link',{name:'Series',exact:true}).click();
  await expect(page).toHaveURL(/vista=series/);
  await expect(page.locator('.series-card')).toHaveCount(1);
  const card=page.locator('.series-card');
  await expect(card.getByText('34 compilados')).toBeVisible();
  await expect(page.getByRole('button',{name:'Activar carátulas'})).toBeVisible();
  const img=card.locator('img');await expect.poll(()=>img.evaluate(n=>n.complete&&n.naturalWidth>0)).toBe(true);
  const first=await img.getAttribute('src');
  await page.screenshot({path:`${out}/catalog-${width}.png`});
  await page.getByRole('button',{name:'Activar carátulas'}).click();
  await page.mouse.move(0,0);
  await expect.poll(()=>card.locator('img').getAttribute('src'),{timeout:8000}).not.toBe(first);
  await page.getByRole('button',{name:'Pausar carátulas'}).click();
  await card.getByRole('link',{name:'VenezuelaDemo',exact:true}).click();
  await expect(page.getByRole('heading',{name:'VenezuelaDemo',exact:true})).toBeVisible();
  await expect(page.locator('.series-volume')).toHaveCount(34);
  await page.getByRole('link',{name:'Todas las series de compilados'}).click();
  await expect(page.getByRole('heading',{name:'Series de compilados'})).toBeVisible();
  await expect(page.locator('.series-card').first()).toBeVisible();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  assert.deepEqual(errors,[]);results.push({width,grouped:true,rotation:true,reducedMotion:true,seriesPage:true,index:true,errors});await context.close();
 }
}finally{await browser.close();}
await writeFile(`${out}/browser-results.json`,JSON.stringify(results,null,2));console.log(JSON.stringify(results));
