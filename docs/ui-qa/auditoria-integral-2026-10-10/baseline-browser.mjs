import { chromium } from '../../../web/node_modules/playwright/index.mjs';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../../../',import.meta.url)).replace(/\/$/,'');
const out=root+'/docs/ui-qa/auditoria-integral-2026-10-10';
await mkdir(out,{recursive:true});
const api='http://127.0.0.1:3120/crv/api';
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
const results=[];
const routes=['/','/artistas','/discos','/personas','/organizaciones','/artistas/6912','/artistas/58','/personas/15368','/discos/27681','/discos/57','/organizaciones/1','/curaduria','/curaduria/ia?kind=artist&id=6912','/curaduria/imagenes?tipo=fotos','/curaduria/imagenes','/curaduria/duplicados','/curaduria/categoria/fichas_repetidas','/curaduria/correcciones','/curaduria/autocorreccion','/historial'];
const axe=await readFile(out+'/axe-4.10.3.min.js','utf8');
async function metrics(page){return await page.evaluate(()=>{
 const visible=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none';};
 const controls=[...document.querySelectorAll('a[href],button,input,select,textarea,summary,[role="combobox"]')].filter(visible);
 const box=e=>{const r=e.getBoundingClientRect();return {text:(e.innerText||e.getAttribute('aria-label')||e.getAttribute('title')||'').trim().slice(0,110),width:Math.round(r.width),height:Math.round(r.height),x:Math.round(r.x),y:Math.round(r.y)};};
 return {title:document.title,headings:[...document.querySelectorAll('h1,h2,h3')].filter(visible).map(e=>({level:e.tagName,text:e.innerText})),text:document.body.innerText,docWidth:document.documentElement.scrollWidth,viewport:innerWidth,docHeight:document.documentElement.scrollHeight,controls:controls.length,firstViewportControls:controls.filter(e=>{const r=e.getBoundingClientRect();return r.bottom>0&&r.top<innerHeight;}).map(box),smallTargets:controls.filter(e=>{const r=e.getBoundingClientRect();return r.width<24||r.height<24;}).map(box).slice(0,60),touchUnder44:controls.filter(e=>{const r=e.getBoundingClientRect();return r.width<44||r.height<44;}).length,namelessButtons:[...document.querySelectorAll('button')].filter(visible).filter(e=>!e.innerText.trim()&&!e.getAttribute('aria-label')&&!e.getAttribute('title')).length,images:[...document.images].filter(visible).map(e=>({src:e.currentSrc,width:e.naturalWidth,height:e.naturalHeight,complete:e.complete,alt:e.getAttribute('alt')})),navigation:performance.getEntriesByType('navigation').map(e=>({response:e.responseEnd,domContent:e.domContentLoadedEventEnd,load:e.loadEventEnd})),resources:performance.getEntriesByType('resource').filter(e=>/\.(js|css)(\?|$)/.test(e.name)).map(e=>({url:e.name,bytes:e.transferSize,duration:e.duration})),overflowElements:[...document.querySelectorAll('main *')].filter(visible).filter(e=>{const r=e.getBoundingClientRect();return r.right>innerWidth+1||r.left< -1;}).slice(0,10).map(e=>({tag:e.tagName,class:e.className,...box(e)}))};
 });}
try {
 for(const role of ['public','admin'])for(const width of [1440,390]){
  const context=await browser.newContext({viewport:{width,height:1000},bypassCSP:true});
  await context.route('**/crv/api/**',async route=>{
   const req=route.request(),url=new URL(req.url());
   const path=url.pathname.slice(url.pathname.indexOf('/crv/api')+8);
   if(path==='/auth/me'&&role==='admin')return route.fulfill({json:{user:{username:'auditoria',name:'Auditoría',role:'admin'},csrf:'audit-read-only'}});
   if(!['GET','HEAD','OPTIONS'].includes(req.method()))return route.fulfill({status:403,json:{error:{code:'audit_read_only',message:'La auditoría impide escrituras.'}}});
   if(role==='admin'&&globalThis.auditInject){const result=await globalThis.auditInject(path+url.search);return route.fulfill(result);}
   const response=await context.request.get(api+path+url.search,{timeout:60000});
   return route.fulfill({response});
  });
  for(const route of routes.filter(r=>role==='admin'||!r.startsWith('/curaduria')&&!r.startsWith('/historial'))){
   const page=await context.newPage(),errors=[],failures=[];
   page.on('pageerror',e=>errors.push(e.message));
   page.on('response',r=>{if(r.status()>=400)failures.push({status:r.status(),url:r.url()});});
   const start=Date.now();
   try{
    await page.goto('http://127.0.0.1:3120/crv'+route,{waitUntil:'domcontentloaded',timeout:60000});
    await page.waitForTimeout(2500);
    const m=await metrics(page);
    const slug=route.replace(/[^a-z0-9]+/gi,'-').replace(/^-|-$/g,'')||'inicio';
    await page.screenshot({path:out+`/${role}-${slug}-${width}.png`});
    await page.evaluate(axe);
    const accessibility=await page.evaluate(async()=>{const r=await axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa']}});return {violations:r.violations.map(v=>({id:v.id,impact:v.impact,description:v.description,help:v.help,helpUrl:v.helpUrl,nodes:v.nodes.map(n=>({html:n.html,target:n.target,failureSummary:n.failureSummary}))})),incomplete:r.incomplete.map(v=>({id:v.id,nodes:v.nodes.length})),passes:r.passes.length};});
    results.push({role,width,route,observedMs:Date.now()-start,errors,failures,accessibility,...m});
    if(role==='admin'&&route==='/artistas/6912'){
      const button=page.getByRole('button',{name:'Ver informe y datos pendientes',exact:true});
      if(await button.count())await button.click();
      await page.locator('.entity-verification').scrollIntoViewIfNeeded();
      await page.screenshot({path:out+`/admin-jeremias-informe-${width}.png`});
      results.push({role,width,route:route+'#informe',errors,failures,...await metrics(page)});
    }
    if(role==='admin'&&route==='/curaduria/imagenes?tipo=fotos'){
      const tile=page.locator('.img-pick').filter({hasText:'Jeremías'}).first();
      if(await tile.count()){await tile.scrollIntoViewIfNeeded();await page.waitForTimeout(1800);await page.screenshot({path:out+`/admin-jeremias-fotos-${width}.png`});results.push({role,width,route:route+'#jeremias',errors,failures,...await metrics(page)});}
    }
    console.log(JSON.stringify({role,width,route,widthOverflow:m.docWidth>width,controls:m.controls,firstViewportControls:m.firstViewportControls.length,errors,apiFailures:failures.filter(f=>f.url.includes('/api/'))}));
   }catch(e){results.push({role,width,route,error:e.message,errors,failures});console.log(JSON.stringify({role,width,route,error:e.message}));}
   await page.close();
    await writeFile(out+'/browser-evidence.json',JSON.stringify({date:new Date().toISOString(),method:'Published production bundle. Public GET API is production. Admin /auth/me simulated; admin API uses current real Fastify routes via inject, real PostgreSQL with default_transaction_read_only=on and startup job recovery suppressed. All browser catalog mutations blocked. Axe 4.10.3 WCAG A/AA audit.',results},null,2));
  }
  await context.close();
 }
}finally{await browser.close();}
