// QA del panel privado con fichas reales; las respuestas de investigación se
// simulan en el navegador y no escriben datos ni inician búsquedas.
import { readFile } from "node:fs/promises";
import { chromium,expect } from "@playwright/test";
import { getAlbumDetail } from "../../../src/api/repositories/albums.js";
import { getArtistDetail } from "../../../src/api/repositories/artists.js";
import { getPersonDetail } from "../../../src/api/repositories/persons.js";
import { loadVerificationSnapshot } from "../../../src/verification/snapshot.js";
import { evaluateVerification } from "../../../src/verification/evaluate.js";
import { getIndividualVerification } from "../../../src/verification/store.js";
import { closeDb,getPool } from "../../../src/db/client.js";
import type { VerificationKind } from "../../../src/verification/types.js";
const base=process.env["CRV_QA_WEB_URL"]??"http://127.0.0.1:5199";
const browser=await chromium.launch();
try{
  const album=await getAlbumDetail(1235);if(!album)throw new Error("Falta el disco de prueba.");
  const artist=await getArtistDetail(album.artist.id);if(!artist)throw new Error("Falta el artista.");
  const personId=Number((await getPool().query("SELECT person_id FROM public.artist_members WHERE artist_id=$1 ORDER BY id LIMIT 1",[artist.id])).rows[0]?.person_id??40356);
  const person=await getPersonDetail(personId);if(!person)throw new Error("Falta la persona.");
  const realReport=JSON.parse(await readFile("/tmp/crv-report58-v3.json","utf8"));
  const caramelos=await getArtistDetail(58);if(!caramelos)throw new Error("Falta Caramelos");
  const fixtures=[{kind:"artist" as VerificationKind,record:caramelos,path:"artistas",api:"artists"},{kind:"album" as VerificationKind,record:album,path:"discos",api:"albums"},{kind:"artist" as VerificationKind,record:artist,path:"artistas",api:"artists"},{kind:"person" as VerificationKind,record:person,path:"personas",api:"persons"}];
  for(const width of [1280,400])for(const fixture of fixtures){
    const snapshot=await loadVerificationSnapshot(fixture.kind,fixture.record.id);
    const initial=evaluateVerification(snapshot,[]);
    const saved=fixture.kind==="album"?await getIndividualVerification("album",fixture.record.id):null;
    const researched=fixture.kind==="artist"&&fixture.record.id===58?realReport:saved?.researched&&!saved.stale?saved:evaluateVerification(snapshot,[],undefined,true);
    let started=false;let admin=true;let calls=0;
    const page=await browser.newPage({viewport:{width,height:1000}});const errors:string[]=[];page.on("pageerror",error=>errors.push(error.message));
    await page.route("http://127.0.0.1:8080/**",async route=>{
      const pathname=new URL(route.request().url()).pathname;
      let body:unknown={data:[],pagination:{total:0,limit:20,offset:0}};
      if(pathname.endsWith("/auth/me"))body=admin?{user:{username:"qa",name:"QA",role:"admin"},csrf:"qa"}:{user:null,csrf:null};
      else if(pathname===`/${fixture.api}/${fixture.record.id}`)body=fixture.record;
      else if(pathname.includes("/entity-verification/")){
        calls++;
        if((pathname.endsWith("/active-job")||pathname.endsWith("/latest-job")))body=null;
        else if(pathname.endsWith("/jobs")){started=true;body={id:1,kind:fixture.kind,entityId:fixture.record.id,status:"queued",error:null,requestedAt:new Date().toISOString(),finishedAt:null};}
        else if(pathname.includes("/jobs/"))body={id:1,kind:fixture.kind,entityId:fixture.record.id,status:"done",error:null,requestedAt:new Date().toISOString(),finishedAt:new Date().toISOString()};
        else body=started?researched:initial;
      }else if(pathname.endsWith("/summary"))body={categories:[],running:false,totals:{open:0},autofix:{today:{applied:0},alerts:[]},album:0,artist:0};
      else if(pathname.endsWith("/identity-research"))body=[];
      else if(pathname.endsWith("/text-rewrites"))body={pending:[]};
      await route.fulfill({status:200,contentType:"application/json",body:JSON.stringify(body)});
    });
    await page.goto(`${base}/${fixture.path}/${fixture.record.id}`);
    const panel=page.getByRole("region",{name:"Fiabilidad de la ficha"});await expect(panel).toBeVisible();
    await panel.getByRole("button",{name:"Ver informe y datos pendientes",exact:true}).click();
    await expect(panel.getByRole("img",{name:"Pendiente: pendiente",exact:true})).toBeVisible();
    await panel.getByRole("button",{name:"Verificar esta ficha con fuentes",exact:true}).click();
    await expect(panel.getByText(researched.score===null?"—":`${new Intl.NumberFormat("es-VE",{maximumFractionDigits:1}).format(researched.score)}%`,{exact:true})).toBeVisible({timeout:15000});
    await panel.scrollIntoViewIfNeeded();
    if(fixture.record.id===58&&fixture.kind==="artist"){const box=await panel.boundingBox();if(box)await page.evaluate(y=>window.scrollTo(0,Math.max(0,y-75)),box.y+await page.evaluate(()=>scrollY));await page.screenshot({path:`/tmp/crv-caramelos-summary-${width}.png`});}
    await expect(panel.getByText("El puntaje considera solo coincidencias y discrepancias documentadas.",{exact:false})).toBeVisible();
    const detailButton=panel.getByRole("button",{name:"Ver datos evaluados y todas las evidencias",exact:true});await detailButton.click();
    await expect(panel.getByRole("button",{name:"Ocultar datos evaluados",exact:true})).toHaveAttribute("aria-expanded","true");
    await expect(panel.locator(".verification-browser__finding")).toHaveCount(0);
    const firstArea=panel.locator(".verification-browser__areas > details").first();await firstArea.locator(":scope > summary").click();
    await expect(firstArea.locator(".verification-browser__finding").first()).toBeVisible();
    await firstArea.locator(".verification-browser__finding > summary").first().click();
    await expect(firstArea.locator("dl").first()).toBeVisible();
    if(fixture.record.id===58&&fixture.kind==="artist"){
      await firstArea.locator(":scope > summary").click();
      const tracks=panel.locator(".verification-browser__areas > details").filter({hasText:"Pistas y orden por álbum"});await tracks.locator(":scope > summary").click();
      await expect(tracks.locator(".verification-browser__finding")).toHaveCount(20);
      const before=await tracks.locator(".verification-browser__finding > summary").first().innerText();
      await tracks.getByRole("button",{name:"Siguiente",exact:true}).click();
      expect(await tracks.locator(".verification-browser__finding > summary").first().innerText()).not.toBe(before);
      await panel.getByLabel("Buscar en los datos",{exact:true}).fill("Grandmaster");
      await expect(panel.locator(".verification-browser > p[role=status]")).toBeVisible();
      await panel.getByLabel("Buscar en los datos",{exact:true}).fill("");
    }
    if(fixture.record.id===58&&fixture.kind==="artist"){
      for(const [query,expected] of [["spotify","Comprobado · 100 %"],["Pop rock","Comprobado · 100 %"],["Electrónica","Sin verificar · Fuera del puntaje"]]){
        await panel.getByLabel("Buscar en los datos",{exact:true}).fill(query!);
        const area=panel.locator(".verification-browser__areas > details").first();await area.locator(":scope > summary").click();
        await expect(area.locator(".verification-browser__finding > summary").first()).toContainText(expected!);
      }
      await panel.getByLabel("Buscar en los datos",{exact:true}).fill("");
    }
    const sources=panel.locator("details.verification-browser__group").filter({has:page.locator("summary > strong",{hasText:"Fuentes de la investigación"})});
    await sources.locator(":scope > summary").click();expect(await sources.locator(".verification-browser__source").count()).toBeLessThanOrEqual(20);

    await panel.scrollIntoViewIfNeeded();
    await page.screenshot({path:`/tmp/crv-individual-${fixture.kind}-${fixture.record.id}-${width}.png`});
    if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw new Error(`${fixture.kind}: desbordamiento ${width}`);
    if(errors.length)throw new Error(errors.join("\n"));
    admin=false;calls=0;await page.reload();await expect(page.getByRole("heading",{level:1})).toBeVisible();
    await expect(page.getByRole("region",{name:"Fiabilidad de la ficha"})).toHaveCount(0);expect(calls).toBe(0);
    console.log(`${fixture.kind} ${width}px: informe, puntaje, detalles, trabajo completado y privacidad verificados`);
    await page.close();
  }
}finally{await browser.close();await closeDb();}
