import { chromium,expect } from "@playwright/test";
import { getAlbumDetail } from "../../../src/api/repositories/albums.js";
import { loadVerificationSnapshot } from "../../../src/verification/snapshot.js";
import { evaluateVerification } from "../../../src/verification/evaluate.js";
import { closeDb } from "../../../src/db/client.js";
const browser=await chromium.launch();
try {
 const album=await getAlbumDetail(1235);if(!album)throw new Error("Falta álbum QA");
 const report=evaluateVerification(await loadVerificationSnapshot("album",album.id),[]);
 const page=await browser.newPage({viewport:{width:400,height:1000}});
 await page.route("http://127.0.0.1:8080/**",async route=>{
  const p=new URL(route.request().url()).pathname;let body:unknown={data:[],pagination:{total:0,limit:20,offset:0}};
  if(p==="/auth/me")body={user:{username:"qa",name:"QA",role:"admin"},csrf:"qa"};
  else if(p===`/albums/${album.id}`)body=album;
  else if(p.includes("/compare/history/"))body=[];
  else if(p.startsWith("/entity-verification/"))body=p.endsWith("active-job")?null:report;
  else if(p==="/search"){await new Promise(resolve=>setTimeout(resolve,600));body={album:[],artist:[],person:[],track:[],organization:[]};}
  else if(p.endsWith("/summary"))body={categories:[],running:false,totals:{open:0},autofix:{today:{applied:0},alerts:[]},album:0,artist:0};
  else if(p.endsWith("/text-rewrites"))body={pending:[]};
  await route.fulfill({status:200,contentType:"application/json",body:JSON.stringify(body)});
 });
 await page.goto("http://127.0.0.1:5199/discos/1235");const panel=page.getByRole("region",{name:"Fiabilidad de la ficha"});
 await panel.getByRole("button",{name:"Comparar con otra ficha",exact:true}).click();
 await panel.getByRole("searchbox",{name:"Buscar álbum"}).fill("Sin resultados QA");
 await expect(panel.getByText("Buscando fichas…",{exact:true})).toBeVisible();
 expect(await panel.getByText("No se encontraron otras fichas. Prueba otro nombre o alias.",{exact:true}).count()).toBe(0);
 await page.waitForTimeout(100);expect(await panel.getByText("No se encontraron otras fichas. Prueba otro nombre o alias.",{exact:true}).count()).toBe(0);
 await panel.scrollIntoViewIfNeeded();await page.screenshot({path:"/tmp/crv-comparison-debounce-fixed.png"});
 await expect(panel.getByText("No se encontraron otras fichas. Prueba otro nombre o alias.",{exact:true})).toBeVisible();
 await expect(panel.getByText("Buscando fichas…",{exact:true})).toHaveCount(0);
 console.log("Debounce y consulta pendiente: sin falso vacío; respuesta vacía real: estado correcto.");
}finally{await browser.close();await closeDb();}
