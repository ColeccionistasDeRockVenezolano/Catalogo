import assert from "node:assert/strict";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";
import { readResourceFieldReview, projectResourceFieldReview, resourceFieldStatus } from "../../../src/search/resource-field-review.js";
const base=process.env.CRV_WEB_URL??"http://127.0.0.1:5188";
const out=process.env.CRV_QA_OUT??"reports/unified-search-stage2/browser";
const genreFilter=process.env.CRV_QA_GENRE_FILTER??"ambient",genreLabel=process.env.CRV_QA_GENRE_LABEL??"Ambient";
await mkdir(out,{recursive:true});
const read=async name=>JSON.parse(await readFile(`reports/unified-search-stage2/${name}.json`,"utf8"));
const [map,vocabulary,study,registry,mappings]=await Promise.all([read("genre-map"),read("vocabulary"),read("study"),readFile("docs/unified-search/resources.json","utf8").then(JSON.parse),read("mappings")]);
const knowledge={available:true,genres:{version:map.version,sourceStatus:map.databaseStatus,total:map.genres.length,described:map.genres.filter(g=>g.description).length,existingDescriptions:map.coverage.existingDescriptions,documentedProposals:map.coverage.documentedProposals,rows:map.genres.map(g=>({...g,status:g.descriptionStatus}))},
 mappings:{version:mappings.version,coverage:mappings.coverage,rows:mappings.mappings.map(m=>({...m.mapping,sourceConceptKind:m.sourceConceptKind,definitionReferences:m.definitionReferences}))},
 vocabulary:{version:vocabulary.version,coverage:vocabulary.coverage,concepts:vocabulary.concepts.map(c=>({...c,label:c.labelEs,aliases:c.aliasesEs,definition:c.definitionEs})),facets:vocabulary.facets.map(f=>({...f,aliases:f.aliasesEs}))},
 study:{version:study.version,pages:study.manifest.length,releases:study.releases.length,multiPageEligible:study.releases.filter(r=>r.multiPageEligible).length,reserved:study.releases.filter(r=>r.role==="reserved_unopened").length},
 feed:{available:true,jobs:["new_source","changed_capture","reprocessed_capture"].map((inputChange,index)=>({id:index+1,resourceId:"R04",inputChange,state:"review",cursor:10,total:10,attempts:0,errorCode:null,updatedAt:"2026-10-17T12:00:00Z"})),counts:[{status:"open",count:10}],cases:[{id:1,status:"open",annotationId:"E2-K01",aspect:"structure.development"}]}};
const fieldReview=projectResourceFieldReview(await readResourceFieldReview(process.cwd()));
const fieldRows=new Map(fieldReview.resources.map(row=>[row.id,row.fields]));
const administration={periodDays:30,generatedAt:"2026-10-17T12:00:00Z",dailyCycle:{date:"2026-10-17",timeZone:"America/Caracas"},summary:{},sampling:{maximumExamplesPerEditorialDay:500},combinations:[],latencies:[],quality:{},limitations:[],queries:[],legacy:{rows:[]},suggestions:{decisions:[],funnel:[]},flags:{},resources:{checkedAt:registry.checkedAt,fieldReviewStatus:"verified",fieldReview:{version:fieldReview.version,revision:fieldReview.revision,coverage:fieldReview.coverage,analyst:fieldReview.analyst,publicationAuthorized:false},rows:registry.resources.map(({id,resource,availability,status,nextTask,stagePriority})=>({id,resource,availability,status:status==="withdrawn"?status:resourceFieldStatus(fieldRows.get(id)),nextTask,stagePriority,fields:fieldRows.get(id)}))}};
const browser=await chromium.launch({headless:true}),report={fixture:"Corpus inventory real; job/review IDs synthetic. API separately verified in disposable PostgreSQL.",errors:[],sizes:[]};
try {
 for(const [name,width,height] of [["desktop",1440,1000],["mobile",390,844]]) {
  const context=await browser.newContext({viewport:{width,height},reducedMotion:"reduce"});const page=await context.newPage();
  page.on("pageerror",e=>report.errors.push(e.message));
  await page.route("**/auth/me",route=>route.fulfill({json:{user:{username:"qa",name:"QA",role:"admin"},csrf:"qa"}}));
  await page.route("**/search/administration",route=>route.fulfill({json:administration}));
  await page.route("**/search/administration/knowledge",route=>route.fulfill({json:knowledge}));
  let revision=0,decision=null;
  const reviewFixture=()=>({reviewId:1,unitKey:"a".repeat(64),revision,status:decision?.status??"open",object:{kind:"track",id:1,name:"Pista de ensayo",version:"studio"},
    assertion:{aspect:"timbre",value:"fuzz",state:"affirmed"},observation:{source:"https://example.com/review",quote:"Guitarras fuzz",locator:"review"},
    analysis:{interpretation:"Percepción de timbre",alternative:"Otra técnica de distorsión",uncertainty:"Equipo desconocido"},blockers:decision?[]:["editorial_decision_required"],decision,interpretations:[]});
  await page.route("**/search/administration/knowledge/reviews/1",route=>route.fulfill({json:reviewFixture()}));
  await page.route("**/search/administration/knowledge/reviews/1/decision",route=>{
    const body=route.request().postDataJSON();assert.equal(body.expectedRevision,revision);assert.equal(body.unitKey,"a".repeat(64));
    if(body.status==="approved"){assert.equal(body.publicQuote,"Guitarras fuzz");assert.equal(body.criterion.version,"timbre-v1");}
    else{assert.equal(body.publicQuote,null);assert.equal(body.criterion,null);}
    revision++;decision={...body,actor:"QA",revision};return route.fulfill({json:{runId:99,result:{revision,status:body.status}}});
  });
  await page.goto(`${base}/administrar/buscador?seccion=Conocimiento`);
  await page.getByRole("heading",{name:"Mapa de géneros y estilos"}).waitFor();
  assert.equal(await page.locator("tbody tr").count(),20);
  await page.getByRole("button",{name:"Siguiente",exact:true}).click();
  await page.getByText("21–40 de 282",{exact:true}).waitFor();
  await page.getByLabel("Filtrar géneros y conceptos").fill("rock");
  await page.getByRole("status").filter({hasText:/1–20 de/}).waitFor();
  await page.getByLabel("Filtrar géneros y conceptos").fill("zzzz-sin-coincidencias");
  assert.equal(await page.locator("tbody tr").count(),0);
  await page.getByLabel("Filtrar géneros y conceptos").fill(genreFilter);
  const ambient=page.locator("tbody tr").filter({has:page.getByRole("cell",{name:genreLabel,exact:true})});
  await ambient.getByText("Ver rasgos, alcance y fuentes",{exact:true}).click();
  assert.ok(await ambient.locator("a[href^='https://']").count()>0);
  assert.ok((await ambient.innerText()).includes("Propuesta"));
  await page.screenshot({path:`${out}/${name}-genre-sources.png`});
  if(process.env.CRV_QA_GENRE_KIND)assert.ok((await ambient.innerText()).includes(process.env.CRV_QA_GENRE_KIND));
  if(process.env.CRV_QA_SECOND_GENRE_FILTER){
    await page.getByLabel("Filtrar géneros y conceptos").fill(process.env.CRV_QA_SECOND_GENRE_FILTER);
    const regional=page.locator("tbody tr").filter({has:page.getByRole("cell",{name:process.env.CRV_QA_SECOND_GENRE_LABEL,exact:true})});
    await regional.getByText("Ver rasgos, alcance y fuentes",{exact:true}).click();
    assert.ok((await regional.innerText()).includes(process.env.CRV_QA_SECOND_GENRE_KIND??"Tradición regional"));
    assert.ok(await regional.locator(`a[href^='${process.env.CRV_QA_SECOND_GENRE_SOURCE??"https://ich.unesco.org/"}']`).count()>0);
    await page.screenshot({path:`${out}/${name}-regional-sources.png`});
  }
  await page.getByLabel("Filtrar géneros y conceptos").fill("Field Recording");
  const field=page.getByRole("region",{name:"Correspondencias RYM"}).locator("details");
  await field.locator("summary").click();
  assert.ok((await field.innerText()).includes("Sin destino"));
  await page.screenshot({path:`${out}/${name}-mapping.png`});
  await page.getByLabel("Filtrar géneros y conceptos").fill("coger");
  const intimacy=page.locator("details").filter({has:page.locator("summary").filter({hasText:"Intimidad"})});
  await intimacy.locator("summary").click();
  await intimacy.getByText("Criterio de uso:",{exact:true}).waitFor();
  assert.ok((await intimacy.innerText()).includes("Expresiones que necesitan contexto"));
  assert.ok((await intimacy.innerText()).includes("Sin aprobación editorial"));
  await intimacy.scrollIntoViewIfNeeded();
  await page.screenshot({path:`${out}/${name}-semantic-review.png`});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.getByLabel("Filtrar géneros y conceptos").fill("");
  await page.screenshot({path:`${out}/${name}-knowledge.png`});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.getByRole("button",{name:"Alimentación",exact:true}).click();
  await page.getByRole("heading",{name:"Lotes de conocimiento"}).waitFor();
  await page.getByRole("link",{name:"Revisar E2-K01"}).waitFor();
  for(const label of ["Fuente nueva","Captura cambiada","Nueva extracción de la misma captura"])await page.getByRole("cell").filter({hasText:label}).waitFor();
  const resourceTable=page.getByRole("table",{name:"Recursos y campos"}),resourceReadings=[];
  for(const id of ["R03","R16","R39"]){
    const opener=resourceTable.getByRole("button",{name:`Ver campos de ${id}`,exact:true});
    if(id==="R03"){await opener.focus();await opener.press("Enter");}else await opener.click();
    const detail=page.getByRole("region",{name:`Campos de ${id}`,exact:true});
    await detail.waitFor();
    assert.equal(await opener.getAttribute("aria-expanded"),"true");
    assert.equal(await detail.evaluate(el=>el===document.activeElement),true);
    if(width===390)assert.ok(await detail.evaluate(el=>el.getBoundingClientRect().width)>300);
    const reading=await detail.evaluate(el=>{
      const paragraph=el.querySelector("p"),style=getComputedStyle(paragraph);
      const rgba=value=>{const n=value.match(/[\d.]+/g)?.map(Number)??[0,0,0,0];return [n[0],n[1],n[2],n[3]??1];};
      const layers=[];for(let node=paragraph;node;node=node.parentElement)layers.push(rgba(getComputedStyle(node).backgroundColor));
      let background=[255,255,255];for(const [r,g,b,a] of layers.reverse())background=[r,g,b].map((v,i)=>v*a+background[i]*(1-a));
      const color=rgba(style.color),foreground=color.slice(0,3).map((v,i)=>v*color[3]+background[i]*(1-color[3]));
      const luminance=rgb=>rgb.map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;}).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0);
      const a=luminance(foreground),b=luminance(background);
      return {width:el.getBoundingClientRect().width,fontSize:parseFloat(style.fontSize),lineHeight:parseFloat(style.lineHeight),contrast:(Math.max(a,b)+.05)/(Math.min(a,b)+.05)};
    });
    assert.ok(reading.contrast>=4.5);assert.ok(reading.fontSize>=14);assert.ok(reading.lineHeight>=reading.fontSize*1.4);
    assert.ok(await opener.evaluate(el=>el.getBoundingClientRect().height)>=44);
    resourceReadings.push({id,...reading});
    const text=await detail.innerText();
    if(id==="R03"){assert.ok(text.includes("Extracción parcial"));assert.ok(text.includes("Reseñas contadas en discografía"));assert.ok(text.includes("Diferido"));}
    if(id==="R16"){assert.ok(text.includes("Excluido"));assert.ok(!text.includes("Extracción parcial"));}
    if(id==="R39"){assert.ok(text.includes("Laya recibe texto"));assert.ok(!text.includes("/mnt/"));}
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    await detail.evaluate(el=>el.scrollIntoView({block:"start"}));
    await page.screenshot({path:`${out}/${name}-fields-${id}.png`});
    await detail.getByRole("button",{name:`Cerrar campos de ${id}`,exact:true}).click();
    assert.equal(await opener.getAttribute("aria-expanded"),"false");
    assert.equal(await opener.evaluate(el=>el===document.activeElement),true);
  }
  assert.ok(!(await page.locator("body").innerText()).includes("/mnt/1tb"));
  await page.getByRole("cell").filter({hasText:"Nueva extracción de la misma captura"}).evaluate(el=>el.scrollIntoView({block:"center"}));
  await page.screenshot({path:`${out}/${name}-feeding.png`});
  await page.getByRole("link",{name:"Revisar E2-K01"}).click();
  await page.getByRole("heading",{name:"Revisar afirmación #1"}).waitFor();
  await page.getByLabel("Decisión",{exact:true}).selectOption("approved");
  await page.getByLabel("Motivo",{exact:true}).fill("Objeto y soporte revisados");
  await page.getByLabel("Versión del criterio").fill("timbre-v1");
  await page.getByLabel("Soporte del criterio en este objeto").fill("Descripción atribuida del timbre en la pista");
  await page.getByLabel("Fragmento exacto para publicar").fill("Guitarras fuzz");
  await page.getByRole("button",{name:"Guardar decisión",exact:true}).click();
  await page.getByText("Decisión guardada. Revisión 1.",{exact:true}).waitFor();
  await page.getByLabel("Decisión",{exact:true}).selectOption("withdrawn");
  await page.getByLabel("Motivo",{exact:true}).fill("Retirar hasta resolver nueva evidencia");
  await page.getByRole("button",{name:"Guardar decisión",exact:true}).click();
  await page.getByText("Decisión guardada. Revisión 2.",{exact:true}).waitFor();
  await page.screenshot({path:`${out}/${name}-review.png`});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.getByRole("button",{name:"Volver al conocimiento",exact:true}).click();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  // The endpoint failing must offer retry without hiding the existing resource registry.
  await page.route("**/search/administration/knowledge",route=>route.fulfill({status:503,json:{error:{message:"Lectura temporalmente indisponible"}}}));
  await page.getByRole("button",{name:"Alimentación",exact:true}).click();
  await page.getByRole("button",{name:"Conocimiento",exact:true}).click();
  await page.getByText("Lectura temporalmente indisponible").waitFor();
  const stale={...administration,resources:{...administration.resources,fieldReviewStatus:"needs_review",fieldReview:null,rows:administration.resources.rows.map(row=>({...row,fields:null,status:row.status==="withdrawn"?row.status:"field_review_required"}))}};
  await page.route("**/search/administration",route=>route.fulfill({json:stale}));
  await page.getByRole("button",{name:"Alimentación",exact:true}).click();
  await page.getByRole("button",{name:"Actualizar lecturas",exact:true}).click();
  const staleNotice=page.getByText("La revisión de campos necesita revalidación porque cambió o falta evidencia. Sus disposiciones no se muestran como verificadas.",{exact:true});
  await staleNotice.waitFor();assert.equal(await page.getByRole("button",{name:"Ver campos de R03",exact:true}).count(),0);
  await staleNotice.scrollIntoViewIfNeeded();await page.screenshot({path:`${out}/${name}-fields-needs-review.png`});
  report.sizes.push({name,width,overflow:false,pagination:true,filter:true,reviewLink:true,error:true,editorialForm:true,semanticReview:true,inputChanges:true,resourceFields:true,staleReviewHandled:true,resourceReadings});await context.close();
 }
 assert.deepEqual(report.errors,[]);
} finally {await browser.close();await writeFile(`${out}/report.json`,JSON.stringify(report,null,2)+"\n");}
console.log(JSON.stringify(report));
