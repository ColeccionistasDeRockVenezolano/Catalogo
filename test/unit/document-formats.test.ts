import {mkdtemp,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {beforeAll,afterAll,describe,it,expect} from "vitest";
import {chromium} from "playwright";
import {extractPdf} from "../../src/verification/documents/pdf.js";
import {extractImage} from "../../src/verification/documents/ocr.js";
import {renderDocument} from "../../src/verification/documents/render.js";
import {resetEnvCache} from "../../src/config/env.js";
import type {DocumentExtraction} from "../../src/verification/documents/types.js";
const previous={data:process.env["DATA_DIR"],language:process.env["CRV_RESEARCH_OCR_LANGUAGES"],pages:process.env["CRV_RESEARCH_DOCUMENT_MAX_PAGES"]};
let expectedCdBox:{x:number;y:number;width:number;height:number}|null;
let directory:string,nativePdf:Uint8Array,scanPdf:Uint8Array,scan:Uint8Array;
beforeAll(async()=>{
 directory=await mkdtemp(join(tmpdir(),"crv-document-formats-"));process.env["DATA_DIR"]=directory;process.env["CRV_RESEARCH_OCR_LANGUAGES"]="eng";resetEnvCache();
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1400,height:1100}});
  await page.setContent('<style>body{font:32px Arial;background:white;color:black;padding:50px}section{break-after:page}</style><section><h1>BANDA ARCHIVO</h1><p>DISCO UNO - 2001</p><p>CD 1</p><p>01 PRIMERO</p></section><section><h1>BANDA ARCHIVO</h1><p>DVD 2</p><p>01 EN VIVO</p></section>');
  nativePdf=await page.pdf({format:"A4",printBackground:true});
  await page.setContent('<style>body{font:38px Arial;background:white;color:black;padding:50px}</style><h1>BANDA ARCHIVO</h1><p>DISCO UNO - 2001</p><p>CD 1</p><p>01 PRIMERO</p><p>CREDITO: ANA RIVERA</p>');
  expectedCdBox=await page.getByText("CD 1",{exact:true}).boundingBox();
  scan=await page.screenshot();
  await page.setContent(`<style>body{margin:0}img{width:100%;height:auto}</style><img src="data:image/png;base64,${Buffer.from(scan).toString("base64")}">`);
  scanPdf=await page.pdf({format:"A4",printBackground:true});
 }finally{await browser.close();}
},120000);
afterAll(async()=>{
 for(const [key,value] of [["DATA_DIR",previous.data],["CRV_RESEARCH_OCR_LANGUAGES",previous.language],["CRV_RESEARCH_DOCUMENT_MAX_PAGES",previous.pages]] as const){if(value===undefined)delete process.env[key];else process.env[key]=value;}
 resetEnvCache();await rm(directory,{recursive:true,force:true});
});
describe("formatos reales con motores de lectura",()=>{
 it("PDF nativo: preserva CD/DVD, páginas y posición de cada palabra",async()=>{
  const result=await extractPdf(nativePdf);
  expect(result.complete).toBe(true);expect(result.content).toContain("CD 1");expect(result.content).toContain("DVD 2");
  expect(result.locations.some(location=>location.page===2&&location.bbox?.unit==="pt")).toBe(true);
 });
 it("interrumpe un PDF entre páginas y reanuda conservando el primer soporte sin duplicarlo",async()=>{
  let state:DocumentExtraction|undefined;
  const partial=await extractPdf(nativePdf,{continue:async()=>!state?.processedPages?.includes(1),checkpoint:async value=>{state=value;}});
  expect(partial.complete).toBe(false);expect(partial.processedPages).toEqual([1]);expect(partial.unreadParts).toContain("Página 2: Lectura pausada por el trabajo");
  const resumed=await extractPdf(nativePdf,{resume:partial});
  expect(resumed.complete).toBe(true);expect(resumed.content.match(/Página PDF 1/gu)).toHaveLength(1);expect(resumed.content).toContain("DVD 2");
 });
 it("OCR de imagen: recupera nombres, edición, año, posición y crédito con coordenadas",async()=>{
  const result=await extractImage(scan);
  expect(result.complete).toBe(true);
  for(const fact of ["BANDA ARCHIVO","2001","CD 1","01 PRIMERO","ANA RIVERA"])expect(result.content).toContain(fact);
  expect(result.locations.some(location=>location.bbox?.unit==="px"&&location.confidence!==undefined)).toBe(true);
  const cd=result.locations.find(location=>Buffer.from(result.content).subarray(location.start,location.end).toString().trim()==="CD");
  expect(cd?.bbox?.y).toBeGreaterThanOrEqual(expectedCdBox!.y);expect(cd?.bbox?.y).toBeLessThan(expectedCdBox!.y+expectedCdBox!.height);
 },120000);
 it("PDF escaneado: aplica OCR a la página y conserva las coordenadas en puntos del PDF",async()=>{
  const result=await extractPdf(scanPdf);
  expect(result.complete).toBe(true);expect(result.method).toContain("ocr");expect(result.content).toContain("2001");expect(result.content).toContain("ANA RIVERA");
  expect(result.locations.some(location=>location.page===1&&location.selector==="pdf:ocr-word"&&location.bbox?.unit==="pt")).toBe(true);
 },120000);
 it("renderiza datos tardíos sin autorizar peticiones a servicios internos",async()=>{
  const requested:string[]=[];
  const result=await renderDocument("https://93.184.216.34/dynamic",'<title>Banda Archivo</title><div id="root">Cargando</div><script src="/app.js"></script>',async url=>{
   requested.push(url);
   return new Response('setTimeout(()=>document.querySelector("#root").textContent="Banda Archivo publicó Disco Uno en 2001.",100);fetch("http://127.0.0.1/secret").catch(()=>{});',{headers:{"content-type":"application/javascript"}});
  });
  expect(result.html).toContain("Disco Uno en 2001");expect(requested).toEqual(["https://93.184.216.34/app.js"]);expect(result.complete).toBe(false);expect(result.warnings.join(" ")).toContain("127.0.0.1");
 });
});
