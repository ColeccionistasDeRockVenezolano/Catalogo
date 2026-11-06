import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const browser=await chromium.launch();
try {
 const page=await browser.newPage();page.setDefaultTimeout(15000);
 const errors=[];page.on('console',m=>{if(m.type()==='error'&&m.text().includes('Content Security Policy')&&m.text().includes('googletagmanager'))errors.push(m.text());});
 if(process.env.GTM_CHECK_LOCAL) await page.route('https://coleccionistasderockvenezolano.com/**',async r=>{
   const u=new URL(r.request().url());await r.fulfill({response:await r.fetch({url:'http://127.0.0.1:3197'+u.pathname+u.search})});
 });
 let requests=0;page.on('request',r=>{if(r.url().includes('/gtm.js?id=GTM-KJ8VKCCX'))requests++;});
 await page.goto('https://coleccionistasderockvenezolano.com/',{waitUntil:'domcontentloaded'});
 await page.locator('#crv-hotjar-accept').waitFor({state:'visible'});assert.equal(requests,0);
 const loaded=page.waitForResponse(r=>r.url().includes('/gtm.js?id=GTM-KJ8VKCCX'));
 await page.locator('#crv-hotjar-accept').click();assert.equal((await loaded).status(),200);
 assert.equal(await page.evaluate(()=>window.dataLayer.filter(x=>x.event==='gtm.js').length),1);
 await page.locator('#crv-hotjar-settings').click();await page.locator('#crv-hotjar-accept').click();assert.equal(requests,1);
 await page.goto('https://coleccionistasderockvenezolano.com/colaborar',{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>!!document.getElementById('crv-gtm'));assert.equal(await page.locator('form[data-hj-suppress]').count(),1);
 await page.locator('#crv-hotjar-settings').click();await page.locator('#crv-hotjar-reject').click();await page.waitForFunction(()=>localStorage.getItem('crv-analytics-consent-v2')==='no'&&!document.getElementById('crv-gtm'));
 const count=requests;await page.goto('https://coleccionistasderockvenezolano.com/login',{waitUntil:'domcontentloaded'});assert.equal(await page.locator('#crv-gtm').count(),0);assert.equal(requests,count);assert.deepEqual(errors,[]);
 console.log('PASS GTM: HTTP 200 después del consentimiento, inicio único, persistencia, rechazo y login excluido; CSP correcta');
} finally {await browser.close();}
