// Fichas reales y resultados simulados únicamente en el navegador; sin escribir catálogo.
import { chromium,expect } from "@playwright/test";
import { getAlbumDetail } from "../../../src/api/repositories/albums.js";
import { getArtistDetail } from "../../../src/api/repositories/artists.js";
import { getPersonDetail } from "../../../src/api/repositories/persons.js";
import { closeDb,getPool } from "../../../src/db/client.js";
import { loadComparisonSide,evaluateJoint,normalizePair } from "../../../src/verification/comparison.js";
import { evaluateVerification } from "../../../src/verification/evaluate.js";
import type { EntityRef } from "../../../src/verification/comparison-types.js";
const base=process.env["CRV_QA_WEB_URL"]??"http://127.0.0.1:5199";
const paths={album:"discos",artist:"artistas",person:"personas"};
const apis={album:"albums",artist:"artists",person:"persons"};
const browser=await chromium.launch();
try {
 const album=await getAlbumDetail(1235);if(!album)throw new Error("Falta álbum QA");
 const artist=await getArtistDetail(album.artist.id);if(!artist)throw new Error("Falta artista QA");
 const personId=Number((await getPool().query("SELECT person_id FROM public.artist_members WHERE artist_id=$1 ORDER BY id LIMIT 1",[artist.id])).rows[0]?.person_id??40356);
 const person=await getPersonDetail(personId);if(!person)throw new Error("Falta persona QA");
 const otherId=Number((await getPool().query("SELECT id FROM public.albums WHERE artist_id=$1 AND id<>$2 ORDER BY id LIMIT 1",[artist.id,album.id])).rows[0]?.id);
 const other=await getAlbumDetail(otherId);if(!other)throw new Error("Falta segundo álbum QA");
 const fixtures=[{source:{kind:"artist",id:artist.id} as EntityRef,record:artist,target:{kind:"person",id:person.id} as EntityRef,targetName:person.name},
 {source:{kind:"person",id:person.id} as EntityRef,record:person,target:{kind:"artist",id:artist.id} as EntityRef,targetName:artist.name},
 {source:{kind:"album",id:album.id} as EntityRef,record:album,target:{kind:"album",id:other.id} as EntityRef,targetName:other.title}];
 for(const width of [1280,400])for(const f of fixtures){
  const refs=normalizePair(f.source,f.target),sides=await Promise.all(refs.map(loadComparisonSide));
  const initial=evaluateJoint(sides[0]!,sides[1]!,[]);
  const verified=sides.map(side=>{
    const unit=side.snapshot.units[0]!;const content=`Fuente simulada para QA: ${unit.expected.join(" · ")} son los datos de esta ficha de prueba.`;
    const source={url:`https://example.invalid/qa-${side.kind}-${side.id}`,title:"Fuente simulada para QA",content,contentHash:"qa",fetchedAt:new Date().toISOString()};
    return {...side,verification:evaluateVerification(side.snapshot,[source],{findings:[{key:unit.key,status:"confirmed",observed:unit.value,reason:"Cita simulada para comprobar el cableado de las evidencias en QA",evidence:[{source:0,quote:content}]}],discoveries:[]},true)};
  });
  const quote=`Fuente simulada para QA: ${sides[0]!.name} y ${sides[1]!.name} son fichas relacionadas en un proyecto musical, con miembro o lanzamiento documentado de ${album.artist.name}.`;
  const researched=evaluateJoint(verified[0]!,verified[1]!,[{url:"https://example.invalid/joint",title:"Fuente conjunta simulada para QA",content:quote,contentHash:"qa",fetchedAt:new Date().toISOString()}],{conclusion:"related",explanation:"Resultado simulado para QA: las dos fichas están relacionadas, se conservan separadas.",evidence:[{source:0,quote}]},true);

  let admin=true,started=false,completed=false,stale=false,fail=false;let calls=0,searches=0;
  const history=()=>started?[{target:f.target,name:f.targetName,createdAt:new Date().toISOString(),jobId:1,status:completed?"done":"running"}]:[];
  const page=await browser.newPage({viewport:{width,height:1000}});const errors:string[]=[];page.on("pageerror",e=>errors.push(e.message));
  await page.route("http://127.0.0.1:8080/**",async route=>{
   const url=new URL(route.request().url()),p=url.pathname;
   let body:unknown={data:[],pagination:{total:0,limit:20,offset:0}};const status=200;
   if(p==="/auth/me")body=admin?{user:{username:"qa",name:"QA",role:"admin"},csrf:"qa"}:{user:null,csrf:null};
   else if(p===`/${apis[f.source.kind]}/${f.source.id}`)body=f.record;
   else if(p.startsWith("/entity-verification/compare")){
    calls++;
    if(p.includes("/history/"))body=history();
    else if(p.endsWith("/active-job"))body=started&&!completed?{id:1,left:refs[0],right:refs[1],status:"running",error:null,requestedAt:new Date().toISOString(),finishedAt:null}:null;
    else if(p.endsWith("/jobs")&&route.request().method()==="POST"){expect(route.request().postDataJSON()).toEqual({left:f.source,right:f.target});started=true;completed=false;body={id:1,left:refs[0],right:refs[1],status:"queued",error:null,requestedAt:new Date().toISOString(),finishedAt:null};}
    else if(p.includes("/jobs/")){completed=true;body={id:1,left:refs[0],right:refs[1],status:fail?"failed":"done",error:fail?"Fallo de prueba; vuelve a investigar":null,requestedAt:new Date().toISOString(),finishedAt:new Date().toISOString()};}
    else body=started?stale?{...researched,stale:true,score:null}:researched:initial;
   }else if(p.startsWith("/entity-verification/")){
    calls++;body=(p.endsWith("/active-job")||p.endsWith("/latest-job"))?null:evaluateVerification(sides.find(s=>s.kind===f.source.kind&&s.id===f.source.id)!.snapshot,[],undefined,completed);
   }else if(p==="/search"){
    searches++;expect(url.searchParams.get("types")).toBe(f.target.kind);
    body={album:[],artist:[],person:[],track:[],organization:[],[f.target.kind]:[{type:f.target.kind,id:f.target.id,label:f.targetName,context:"Venezuela · fixture QA",albumId:null},...(f.source.kind===f.target.kind?[{type:f.source.kind,id:f.source.id,label:"La ficha abierta",context:null,albumId:null}]:[])]};
   }else if(p.endsWith("/summary"))body={categories:[],running:false,totals:{open:0},autofix:{today:{applied:0},alerts:[]},album:0,artist:0};
   else if(p.endsWith("/identity-research"))body=[];else if(p.endsWith("/text-rewrites"))body={pending:[]};
   await route.fulfill({status,contentType:"application/json",body:JSON.stringify(body)});
  });
  await page.goto(`${base}/${paths[f.source.kind]}/${f.source.id}`);
  const panel=page.getByRole("region",{name:"Fiabilidad de la ficha"});await expect(panel).toBeVisible();
  await panel.getByRole("button",{name:"Comparar con otra ficha",exact:true}).click();
  const search=panel.getByRole("searchbox",{name:`Buscar ${f.target.kind==="person"?"persona":f.target.kind==="artist"?"artista":"álbum"}`});await search.fill(f.targetName.slice(0,8));
  const results=panel.getByRole("list",{name:"Resultados para comparar"});await expect(results.getByRole("button")).toHaveCount(1);await panel.scrollIntoViewIfNeeded();
  const searchBox=await panel.boundingBox();if(searchBox)await page.evaluate(y=>window.scrollTo(0,Math.max(0,y-80)),searchBox.y+await page.evaluate(()=>scrollY));
  await page.screenshot({path:`/tmp/crv-comparison-${f.source.kind}-${width}-search.png`});
  await results.getByRole("button").click();
  const result=panel.getByRole("region",{name:"Resultado de comparación"});await expect(result).toBeVisible();
  await result.getByRole("button",{name:"Investigar ambas fichas y comparar",exact:true}).click();
  await expect(result.getByText(`${new Intl.NumberFormat("es-VE",{maximumFractionDigits:1}).format(researched.score??0)}/100 de correspondencia`,{exact:true})).toBeVisible({timeout:15000});
  await result.getByRole("button",{name:"Ver datos comparados e investigaciones de ambas fichas",exact:true}).click();
  await expect(result.locator(".entity-comparison__rows > details")).toHaveCount(researched.rows.length);
  await expect(result.locator(".entity-comparison__research")).toHaveCount(2);
  await expect(result.locator(".verification-browser__finding")).toHaveCount(0);
  const side=result.locator(".entity-comparison__research").first();await side.locator(":scope > summary").click();
  const area=side.locator(".verification-browser__areas > details").first();await area.locator(":scope > summary").click();
  await expect(area.locator(".verification-browser__finding").first()).toBeVisible();await area.locator(".verification-browser__finding > summary").first().click();
  await expect(area.locator(".entity-verification__evidence a").first()).toBeVisible();
  await result.locator(".entity-comparison__rows > details").first().locator(":scope > summary").click();
  const leftHeading=await result.locator(".entity-comparison__rows > details").first().locator(".entity-comparison__sides > div > strong").first().textContent();expect(leftHeading).toContain("name" in f.record?f.record.name:f.record.title);
  await expect(result.locator(".entity-comparison__evidence a")).toHaveCount(researched.evidence.length);
  await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:`/tmp/crv-comparison-${f.source.kind}-${width}.png`});
  const focus=async(locator:ReturnType<typeof page.locator>,suffix:string)=>{
   const box=await locator.boundingBox();if(box)await page.evaluate(y=>window.scrollTo(0,Math.max(0,y-80)),box.y+await page.evaluate(()=>scrollY));
   await page.screenshot({path:`/tmp/crv-comparison-${f.source.kind}-${width}-${suffix}.png`});
  };
  await focus(result,"result");
  await focus(result.locator(".entity-comparison__research").nth(0),"research-left");
  await focus(result.locator(".entity-comparison__research").nth(1),"research-right");
  expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
  // Recupera la comparación guardada al volver y muestra la versión antigua sin puntaje.
  stale=true;await page.reload();await expect(panel.getByRole("button",{name:"Ocultar comparación",exact:true})).toBeVisible();await expect(search).toHaveValue(f.targetName.slice(0,8));
  await panel.locator(".entity-comparison__history summary").click();await panel.locator(".entity-comparison__history").getByRole("button").click();await expect(result.getByText("Informe desactualizado",{exact:true})).toBeVisible();
  fail=true;await result.getByRole("button",{name:"Volver a investigar y comparar",exact:true}).click();await expect(result.getByRole("alert")).toContainText("Fallo de prueba");await expect(result.getByRole("button",{name:"Volver a investigar y comparar",exact:true})).toBeEnabled();
  expect(searches).toBeGreaterThan(0);expect(errors).toEqual([]);
  admin=false;calls=0;await page.reload();await expect(page.getByRole("heading",{level:1})).toBeVisible();await expect(panel).toHaveCount(0);expect(calls).toBe(0);
  console.log(`${f.source.kind} ${width}px: búsqueda, selección, comparación, dos investigaciones, historial, vigencia, fallo y privacidad OK`);
  await page.close();
 }
}finally{await browser.close();await closeDb();}
