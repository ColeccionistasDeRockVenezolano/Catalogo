// Archivo de artista: escritorio/móvil, lectura y reclasificación sin tocar el catálogo.
import assert from 'node:assert/strict';import {mkdir,writeFile} from 'node:fs/promises';
import {chromium,expect} from '@playwright/test';
const base=process.env.CRV_WEB_URL??'http://localhost:5173',out=process.env.CRV_QA_OUT;
if(!out)throw new Error('Define CRV_QA_OUT en el staging SSD.');await mkdir(out,{recursive:true});
const seed=await(await fetch('http://127.0.0.1:8080/artists/1525')).json();const browser=await chromium.launch({headless:true});const report=[];
try{for(const width of [1440,390]){
 const page=await browser.newPage({viewport:{width,height:950}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 let documents=[{id:1,category:'interview',title:'Entrevista de archivo: historia, integrantes y primeros conciertos',content:'Pregunta: ¿Cómo se formó la banda?\nRespuesta: La agrupación comenzó en Caracas.\n\n'+('El documento conserva la historia y sus protagonistas. '.repeat(24)),sourceUrl:'https://example.org/entrevista',archiveUrl:'https://web.archive.org/web/20040101/https://example.org/entrevista',dateText:'Octubre de 2004',location:'Caracas',tags:['archivo-wayback-2026-10-22','entrevista']},{id:2,category:'news',title:'Anuncio histórico de concierto',content:'Anuncio conservado; no se presenta como actuación confirmada.',sourceUrl:null,archiveUrl:null,dateText:null,location:null,tags:['archivo-wayback-2026-10-22']}];let writes=0;
 await page.route('**/auth/me',r=>r.fulfill({json:{user:{username:'archive.qa',name:'QA archivo',role:'admin'},csrf:'archive-qa-csrf'}}));
 await page.route('http://127.0.0.1:8080/**',async route=>{const req=route.request(),path=new URL(req.url()).pathname;
  if(path==='/auth/me')return route.fulfill({json:{user:{username:'archive.qa',name:'QA archivo',role:'admin'},csrf:'archive-qa-csrf'}});
  if(path==='/artists/1525'&&req.method()==='GET')return route.fulfill({json:{...seed,name:'Archivo de prueba',channelVideo:null,documents}});
  if(path==='/artists/1525/documents'&&req.method()==='PATCH'){const body=req.postDataJSON();assert.equal(req.headers()['x-crv-csrf'],'archive-qa-csrf');writes++;documents=documents.map(d=>body.ids.includes(d.id)?{...d,category:body.category}:d);return route.fulfill({json:{runId:90001,updated:body.ids.length}});}
  if(path==='/curation/images/jobs')return route.fulfill({json:[]});
  if(path.startsWith('/entity-verification/'))return route.fulfill({json:null});
  if(path.endsWith('/text-rewrites'))return route.fulfill({json:{pending:[]}});
  if(['/claims','/audit','/changes'].includes(path))return route.fulfill({json:{data:[],pagination:{total:0,limit:10,offset:0}}});
  return route.continue();
 });
 await page.goto(base+'/artistas/1525?tab=otros');const section=page.getByRole('region',{name:'Entrevistas y otros documentos'});await expect(section).toBeVisible();
 await section.getByRole('button',{name:/^Entrevistas/}).click();await expect(section.getByRole('heading',{name:/Entrevista de archivo/})).toBeVisible();await expect(section.getByRole('heading',{name:'Anuncio histórico de concierto'})).toHaveCount(0);
 await section.getByRole('button',{name:/^Leer documento:/}).click();const reader=page.getByRole('dialog',{name:'Archivo del artista'});await expect(reader.getByText('Pregunta: ¿Cómo se formó la banda?',{exact:false})).toBeVisible();
 await page.evaluate(()=>document.fonts.ready);await page.screenshot({path:`${out}/otros-${width}.png`,fullPage:true,animations:'disabled'});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true,'Sin desbordamiento horizontal');
 await reader.getByRole('button',{name:'Cerrar',exact:true}).click();await section.getByRole('button',{name:'Organizar documentos',exact:true}).click();
 await section.getByRole('checkbox',{name:/Seleccionar Entrevista de archivo/}).check();await section.getByLabel('Mover documentos a',{exact:true}).selectOption('article');await section.getByRole('button',{name:'Mover seleccionados',exact:true}).click();
 await expect(section.getByText('1 seleccionados',{exact:true})).toHaveCount(0);await section.getByRole('button',{name:/^Todos/}).click();await expect(section.getByRole('button',{name:/^Artículos/})).toBeVisible();assert.equal(writes,1);assert.deepEqual(errors,[]);
 report.push({width,read:true,filters:true,bulkReclassification:true,overflow:false,pageErrors:errors});await page.close();
}
await writeFile(`${out}/resultado.json`,JSON.stringify(report,null,2));console.log(report);
}finally{await browser.close();}
