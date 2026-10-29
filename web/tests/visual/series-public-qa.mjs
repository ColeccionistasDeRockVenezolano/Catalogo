import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
const out=process.env.CRV_QA_OUT;if(!out)throw new Error('Indica staging SSD');
const base=process.env.CRV_WEB_URL??'https://mini-server.tail5815b0.ts.net/crv';
expect.configure({timeout:20000});
const browser=await chromium.launch();const results=[];
try{
 for(const width of [1280,390,320]){
  const context=await browser.newContext({viewport:{width,height:900}});const page=await context.newPage();const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',r=>['GET','HEAD','OPTIONS'].includes(r.request().method())?r.continue():r.abort());
  await page.goto(`${base}/series?q=VenezuelaDemo`);
  await expect(page.locator('.series-card')).toHaveCount(1,{timeout:20000});const card=page.locator('.series-card');
  const image=card.locator('img');await expect.poll(()=>image.evaluate(n=>n.complete&&n.naturalWidth>0)).toBe(true);
  await page.screenshot({path:`${out}/public-${width}.png`});
  const first=await image.getAttribute('src');await page.mouse.move(0,0);
  await expect.poll(()=>card.locator('img').getAttribute('src'),{timeout:8000}).not.toBe(first);
  await page.getByRole('button',{name:'Pausar carátulas'}).click();
  await card.getByRole('link',{name:'VenezuelaDemo',exact:true}).click();await expect(page.locator('.series-volume')).toHaveCount(34);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.goto(`${base}/discos?vista=series&q=Metalkinesia`);await expect(page.locator('.series-card')).toHaveCount(1,{timeout:20000});
  await expect(page.locator('.series-card').getByText('15 compilados',{exact:false})).toBeVisible();
  await page.goto(`${base}/series?q=ninguna-serie-con-este-nombre-12345`);await expect(page.getByText('Ninguna serie coincide con estos filtros',{exact:true})).toBeVisible();
  await page.goto(`${base}/series?q=De%20Colecci%C3%B3n`);await expect(page.locator('.series-card').first()).toBeVisible();
  const absent=page.locator('.series-card').filter({hasText:'Ilan Chester'});await expect(absent.locator('img')).toHaveCount(0);
  await expect(absent.getByText('Sin carátula',{exact:true})).toBeVisible();
  assert.deepEqual(errors,[]);results.push({width,published:true,rotation:true,collection:true,discsFilter:true,empty:true,missingCover:true,errors});await context.close();
 }
}finally{await browser.close();}
await writeFile(`${out}/public-browser-results.json`,JSON.stringify(results,null,2));console.log(JSON.stringify(results));
