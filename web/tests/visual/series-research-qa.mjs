// Colecciones documentadas y continuidad de entregas sin número, en la publicación real.
import assert from 'node:assert/strict';import {writeFile,mkdir} from 'node:fs/promises';import {chromium,expect} from '@playwright/test';
const root=process.env.CRV_QA_OUT;if(!root)throw new Error('Indica staging SSD');await mkdir(root,{recursive:true});
const base=process.env.CRV_WEB_URL??'https://mini-server.tail5815b0.ts.net/crv';
const browser=await chromium.launch();const results=[];
try{for(const width of [1280,390]){
 const context=await browser.newContext({viewport:{width,height:900},reducedMotion:'reduce'});const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',route=>['GET','HEAD','OPTIONS'].includes(route.request().method())?route.continue():route.abort());
 await page.goto(`${base}/series/157`);await expect(page.getByRole('heading',{name:'Lo Mejor de Mango',exact:true})).toBeVisible({timeout:20000});
 await expect(page.locator('.series-volume').first().locator('.series-volume__title')).toHaveText('Lo Mejor De Mango');
 await expect(page.locator('.series-volume').nth(1).locator('.series-volume__label')).toHaveText('Vol. 2');
 await page.goto(`${base}/discos/7094`);const nav=page.getByRole('navigation',{name:'Volúmenes de Lo Mejor de Mango',exact:true});await expect(nav).toBeVisible({timeout:20000});
 await expect(nav.locator('.series-neighbor--previous')).toHaveCount(0);await nav.locator('.series-neighbor--next').click();await expect(page).toHaveURL(/discos\/8117/);await expect(nav.locator('.series-neighbor--previous')).toBeVisible({timeout:20000});
 await page.goto(`${base}/series/145`);await expect(page.locator('.series-volume')).toHaveCount(7,{timeout:20000});await expect(page.locator('.series-volume__label')).toHaveText(['Vol. 1','Vol. 2','Vol. 3','Vol. 4','Vol. 5','Vol. 6','Vol. 7']);
 await page.goto(`${base}/discos/583`);await expect(page.getByRole('navigation',{name:'Volúmenes de Fundación Nuevas Bandas',exact:true})).toBeVisible({timeout:20000});await expect(page.getByRole('navigation',{name:'Volúmenes de Venezuela Pop & Rock',exact:true})).toBeVisible();
 await page.goto(`${base}/series?q=Raptor`);await expect(page.locator('.series-card')).toHaveCount(1,{timeout:20000});await expect(page.locator('.series-card').getByText('2 compilados',{exact:false})).toBeVisible();await page.screenshot({path:`${root}/raptor-${width}.png`});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.deepEqual(errors,[]);results.push({width,chronological:true,neighbors:true,numbered:true,multipleMemberships:true,grouped:true,errors});await context.close();
}}finally{await browser.close();}
await writeFile(`${root}/research-browser.json`,JSON.stringify(results,null,2));console.log(JSON.stringify(results));
