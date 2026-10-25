import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
const out='reports/webs-oficiales-2026-10-18/revision-990/visual';mkdirSync(out,{recursive:true});
const browser=await chromium.launch({headless:true});const results=[];
try{
 for(const [device,width,height] of [['desktop',1440,1000],['mobile',390,844]]){
  const context=await browser.newContext({viewport:{width,height}});
  await context.route('**/*',route=>{const u=new URL(route.request().url());return u.hostname==='127.0.0.1'?route.continue():route.abort();});
  const page=await context.newPage();
  for(const [id,name] of [[206,'Rawayana'],[6012,'Corina Smith']]){
   const errors=[];page.on('pageerror',e=>errors.push(e.message));
   await page.goto(`http://127.0.0.1:3120/crv/artistas/${id}`,{waitUntil:'domcontentloaded',timeout:30000});
   const link=page.getByRole('link',{name:`Sitio web de ${name}`,exact:true});await link.waitFor({state:'visible',timeout:30000});
   assert.equal(await link.getAttribute('title'),'Web');assert.equal(await link.getAttribute('target'),'_blank');
   assert.ok(await link.evaluate(el=>el.closest('ul').lastElementChild.contains(el)),'Web debe ser el último enlace');
   await link.scrollIntoViewIfNeeded();await page.locator('.artist-profile__connections').screenshot({path:`${out}/${device}-${id}.png`});
   const overflow=await page.evaluate(()=>globalThis.document.documentElement.scrollWidth>globalThis.innerWidth+1);assert.equal(overflow,false,'Sin desbordamiento horizontal');
   assert.equal(errors.length,0,errors.join('\n'));results.push({device,artistId:id,name,url:await link.getAttribute('href'),lastLink:true,noHorizontalOverflow:true});
  }
  await context.close();
 }
 writeFileSync(`${out}/resultados.json`,JSON.stringify(results,null,2)+'\n');console.log(JSON.stringify(results));
}finally{await browser.close();}
