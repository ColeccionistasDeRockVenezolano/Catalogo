import {chromium} from '../../../web/node_modules/playwright/index.mjs';
import {writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const out=fileURLToPath(new URL('.',import.meta.url));
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});const results=[];const origin='http://127.0.0.1:3120/crv';
try{
const context=await browser.newContext({viewport:{width:1440,height:1000}});
let breakArtist=false;
await context.route('**/crv/api/**',async route=>{const r=route.request(),u=new URL(r.url()),p=u.pathname.split('/crv/api')[1];if(p==='/auth/me')return route.fulfill({json:{user:{username:'auditoria',name:'Auditoría',role:'admin'},csrf:'audit-read-only'}});if(r.method()!=='GET')return route.fulfill({status:403,json:{error:{code:'audit_read_only',message:'Escritura bloqueada por auditoría'}}});if(breakArtist&&p==='/artists/6912')return route.fulfill({status:500,json:{error:{code:'internal',message:'Fallo controlado de auditoría'}}});return route.fulfill(await globalThis.auditInject(p+u.search));});
const page=await context.newPage();
await page.goto(origin+'/organizaciones/3');await page.waitForTimeout(2000);results.push({task:'Existing organization Polydor',text:await page.locator('main').innerText()});await page.screenshot({path:out+'focused-organizacion-1440.png'});
breakArtist=true;await page.goto(origin+'/artistas/6912');await page.waitForTimeout(1500);results.push({task:'Injected500 recoverability',text:await page.locator('main').innerText()});breakArtist=false;const retry=page.getByRole('button',{name:/intentar|reintentar/i});if(await retry.count())await retry.first().click();await page.waitForTimeout(1500);results.push({task:'Injected500 retry',text:(await page.locator('main').innerText()).slice(0,500)});
await page.goto(origin+'/curaduria/imagenes?tipo=fotos');await page.waitForTimeout(2000);
const tiles=page.locator('.img-tile');for(let i=0;i<await tiles.count();i++){const t=tiles.nth(i);await t.scrollIntoViewIfNeeded();await page.waitForTimeout(180);if((await t.innerText()).includes('No carga'))results.push({task:'Broken image choice',text:await t.innerText(),useEnabled:await t.getByRole('button',{name:'Usar esta'}).isEnabled().catch(()=>false)});if(await t.locator('img[src*="mzstatic"]').count()){await page.waitForTimeout(600);results.push({task:'Apple asset in artist-photo queue',text:await t.innerText(),url:await t.locator('img').getAttribute('src')});await t.screenshot({path:out+`/focused-artist-photo-apple-${i}.png`})}}
results.push({task:'Current prototype GET',result:await globalThis.auditInject('/discovery/metrics/prototype')});
await page.close();await context.close();
}finally{await writeFile(out+'focused-browser-evidence.json',JSON.stringify({method:'Production frontend with read-only current injected API. One controlled500 fixture; retry uses real GET. No writes.',results},null,2));await browser.close()}
