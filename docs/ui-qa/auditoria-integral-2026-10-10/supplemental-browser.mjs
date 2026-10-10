import { chromium } from '../../../web/node_modules/playwright/index.mjs';
import {readFile,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const out=fileURLToPath(new URL('.',import.meta.url));
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
const axe=await readFile(out+'axe-4.10.3.min.js','utf8');
const results=[], interactions=[];
const origin='http://127.0.0.1:3120/crv';
async function metrics(page){return page.evaluate(()=>{
const visible=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none'};
const controls=[...document.querySelectorAll('a[href],button,input,select,textarea,summary')].filter(visible);
return {text:document.body.innerText,headings:[...document.querySelectorAll('h1,h2,h3')].filter(visible).map(e=>e.innerText),width:innerWidth,docWidth:document.documentElement.scrollWidth,height:document.documentElement.scrollHeight,controls:controls.length,firstControls:controls.filter(e=>{const r=e.getBoundingClientRect();return r.top<innerHeight&&r.bottom>0}).length,overflow:[...document.querySelectorAll('main *')].filter(visible).filter(e=>{const r=e.getBoundingClientRect();return r.right>innerWidth+1||r.left< -1}).slice(0,12).map(e=>({tag:e.tagName,class:e.className,text:e.innerText?.slice(0,150)})),images:[...document.images].map(e=>({src:e.currentSrc,complete:e.complete,w:e.naturalWidth,h:e.naturalHeight})),brokenEnabledButtons:[...document.querySelectorAll('.img-pick__candidate,.img-tile')].filter(e=>e.innerText.includes('No carga')).map(e=>({text:e.innerText,buttons:[...e.querySelectorAll('button')].map(b=>({text:b.innerText,disabled:b.disabled}))}))};
})}
async function capture(page,route,width,name){
await page.evaluate(axe);
const a=await page.evaluate(async()=>{const r=await axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa']}});return r.violations.map(v=>({id:v.id,impact:v.impact,nodes:v.nodes.map(n=>({target:n.target,failure:n.failureSummary}))}))});
const slug=name??route.replace(/[^a-z0-9]+/gi,'-').replace(/^-|-$/g,'');
await page.screenshot({path:out+`/supplement-${slug}-${width}.png`});
const m=await metrics(page);results.push({route,...m,accessibility:a});console.log(JSON.stringify({route,width,controls:m.controls,overflow:m.docWidth>width,axe:a.length}));
await writeFile(out+'supplemental-evidence.json',JSON.stringify({method:'Production UI with isolated current read-only API; writes blocked. No human user study.',results,interactions},null,2));
}
try{
for(const width of [1440,390]){
const context=await browser.newContext({viewport:{width,height:1000},bypassCSP:true});
await context.route('**/crv/api/**',async route=>{const req=route.request(),u=new URL(req.url()),path=u.pathname.split('/crv/api')[1];if(path==='/auth/me')return route.fulfill({json:{user:{username:'auditoria',name:'Auditoría',role:'admin'},csrf:'audit-read-only'}});if(req.method()!=='GET')return route.fulfill({status:403,json:{error:{code:'audit_read_only',message:'La auditoría impide escrituras.'}}});return route.fulfill(await globalThis.auditInject(path+u.search));});
const routes=['/artistas/1681','/artistas/1212','/curaduria/ia?kind=artist&id=1681','/curaduria/ia?kind=artist&id=1212','/curaduria/ia?kind=artist&id=58','/discos/211','/discos/140','/curaduria','/curaduria/duplicados','/curaduria/imagenes?tipo=fotos'];
for(const route of routes){const page=await context.newPage();try{
await page.goto(origin+route,{waitUntil:'domcontentloaded',timeout:60000});
await page.waitForTimeout(2000);
if(route==='/curaduria')await page.locator('.ccat-grid').waitFor({timeout:60000});
if(route.includes('/ia'))await page.locator('.ai-plan').waitFor({timeout:60000});
if(route==='/curaduria/duplicados')await page.getByRole('heading',{name:'Posibles duplicados'}).waitFor({timeout:60000});
await page.waitForTimeout(1000);
await capture(page,route,width);
if(route==='/artistas/1212'){
const edit=page.getByRole('button',{name:'Editar',exact:true});await edit.focus();await edit.click();await page.getByRole('dialog').waitFor();
const before=await page.evaluate(()=>({active:document.activeElement?.outerHTML,dialogs:document.querySelectorAll('[role="dialog"]').length}));
for(let i=0;i<30;i++)await page.keyboard.press('Tab');
const trapped=await page.evaluate(()=>Boolean(document.activeElement?.closest('[role="dialog"]')));
await page.keyboard.press('Escape');
interactions.push({width,task:'Edit dialog keyboard',before,trappedAfter30Tabs:trapped,focusReturned:await edit.evaluate(e=>e===document.activeElement)});
const tabs=page.getByRole('tab');if(await tabs.count()){await tabs.first().focus();await page.keyboard.press('ArrowRight');interactions.push({width,task:'Tabs keyboard',selected:await page.getByRole('tab',{selected:true}).innerText()});}
}
if(route.includes('/ia?kind=artist&id=58')){
const history=page.locator('.ai-history-panel');await history.locator('summary').click();await history.locator('select').selectOption('11');
await page.locator('.ai-summary-detail').filter({hasText:'Resumen de la revisión'}).locator('summary').click();
interactions.push({width,task:'Saved Caramelos plan11',text:await page.locator('.ai-plan').innerText()});await capture(page,route+'#plan11',width,'caramelos-plan11');
}
if(route.includes('/imagenes')){
const total=await page.evaluate(()=>document.documentElement.scrollHeight);for(let y=0;y<total;y+=800){await page.evaluate(y=>scrollTo(0,y),y);await page.waitForTimeout(200)}await page.waitForTimeout(1500);
interactions.push({width,task:'Photo gallery fully loaded',...await metrics(page)});
}
}catch(e){interactions.push({width,route,error:e.message});console.log(JSON.stringify({width,route,error:e.message}));}finally{await page.close()}}
if(width===1440){
const page=await context.newPage();await page.goto(origin+'/curaduria/ia?kind=track&id=1');await page.waitForTimeout(2500);
const link=page.getByRole('link',{name:'Ver ficha',exact:true});interactions.push({task:'Track open ficha',href:await link.getAttribute('href')});await link.click();await page.waitForTimeout(500);interactions.push({task:'Track open ficha result',url:page.url(),text:await page.locator('main').innerText()});await page.close();
}
await context.close();
}
const context=await browser.newContext({viewport:{width:320,height:1000},bypassCSP:true});
for(const route of ['/artistas/58','/artistas/6912','/personas/15368']){const page=await context.newPage();await page.goto(origin+route);await page.waitForTimeout(2000);await capture(page,route,320);await page.close()}
const page=await context.newPage();await page.goto(origin+'/');await page.waitForTimeout(1500);
const input=page.getByRole('combobox');
for(const name of ['Jeremías','Apache','La Banana Voladora','Caramelos de Cianuro']){
if(await input.count())await input.fill(name);else await page.locator('input').first().fill(name);
await page.waitForTimeout(1800);interactions.push({task:'Search',query:name,text:await page.locator('main').innerText()});
}
await page.close();await context.close();
}finally{await writeFile(out+'supplemental-evidence.json',JSON.stringify({method:'Production UI; private GET routes injected read-only; no live writes or paid AI calls. Expert evaluation, no human user study.',results,interactions},null,2));await browser.close()}
