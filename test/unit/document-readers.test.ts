import {describe,it,expect} from "vitest";
import {extractHtml,extractJson,needsRendering} from "../../src/verification/documents/html.js";
import {evaluateVerification} from "../../src/verification/evaluate.js";
import {contentHash} from "../../src/verification/documents/capture.js";
import {readBoundedResponse} from "../../src/verification/documents/reader.js";
import {getEnv,resetEnvCache} from "../../src/config/env.js";
describe("lectores de documentos sin recorte",()=>{
 it("conserva hechos finales, cabecera, JSON-LD y más de cincuenta enlaces con posiciones originales",()=>{
  const html=`<html><title>Disco Archivo</title><body><header><h1>Banda Archivo</h1><p>Fundada en 1989</p></header><nav>Menú Rock Pop</nav><article>${"Texto de archivo. ".repeat(5000)}<p>Último crédito: Ana Rivera, bajo, CD 2.</p>${Array.from({length:60},(_,index)=>`<a href="/release/${index}">Disco ${index}</a>`).join("")}<a href="/booklet.pdf">Libreto</a></article><script type="application/ld+json">{"@type":"MusicAlbum","name":"Disco Archivo","genre":["Rock","Pop"],"datePublished":"2001","recordLabel":{"name":"Sello Archivo"}}</script></body></html>`;
  const result=extractHtml(html,"https://archive.example/artist");
  expect(result.content).toContain("Último crédito: Ana Rivera");expect(result.content).toContain("Fundada en 1989");expect(result.content).toContain("/release/59");
  expect(result.content).toContain("JSON-LD 1 /recordLabel/name: Sello Archivo");expect(result.followLinks).toEqual(["https://archive.example/booklet.pdf"]);
  const quote="Último crédito: Ana Rivera, bajo, CD 2.";
  const offset=Buffer.byteLength(result.content.slice(0,result.content.indexOf(quote)),"utf8");
  expect(result.locations.some(location=>location.start<=offset&&location.end>=offset+Buffer.byteLength(quote,"utf8")&&location.selector.includes("p:nth-of-type"))).toBe(true);
  expect(result.locations.some(location=>location.context==="navigation")).toBe(true);
 });
 it("un JSON-LD inválido no elimina el HTML útil y deja lectura parcial explícita",()=>{
  const result=extractHtml('<title>Banda Archivo</title><body><p>Disco Archivo fue publicado en 2001.</p><script type="application/ld+json">{invalid</script></body>',"https://archive.example/");
  expect(result.content).toContain("publicado en 2001");expect(result.complete).toBe(false);expect(result.unreadParts).toEqual(["JSON-LD 1"]);
 });
 it("conserva punteros JSON y unicode en los rangos UTF-8",()=>{
  const result=extractJson(JSON.stringify({artista:"Jeremías",discos:[{título:"Música",año:2001}]}));
  expect(result.content).toContain("/discos/0/título: Música");
  for(const location of result.locations)expect(Buffer.from(result.content).subarray(location.start,location.end).toString("utf8")).not.toContain(": ");
 });
 it("detecta una página dinámica aunque ya traiga cabecera y parte de su contenido",()=>{
  const body=`<body><div id="root">${"Texto inicial. ".repeat(100)}</div><script src="/app.js"></script></body>`;
  expect(needsRendering(body,extractHtml(body,"https://archive.example/"))).toBe(true);
 });
 it("un índice JSON generado no respalda un año que no figura en los valores originales",()=>{
  const extraction=extractJson(JSON.stringify({name:"Banda Archivo",entry_2001:"Referencia sin año"}));
  const page={url:"https://archive.example/",title:"Banda Archivo",content:extraction.content,contentHash:contentHash(extraction.content),fetchedAt:"2026-10-12",document:{captureId:1,rawHash:"0".repeat(64),format:extraction.format,method:extraction.method,extractionVersion:extraction.version,complete:true,unreadParts:[],warnings:[],locations:extraction.locations,followLinks:[]}};
  const snapshot={kind:"artist" as const,id:1,name:"Banda Archivo",identity:["Banda Archivo"],units:[{key:"status.formed",area:"status" as const,label:"Formación",value:"2001",expected:["2001"],context:["Banda Archivo"],issue:null}],sourceUrls:[],albums:[],catalogAlbums:[]};
  const report=evaluateVerification(snapshot,[page],{findings:[{key:"status.formed",status:"confirmed",observed:"2001",reason:"Año",evidence:[{source:0,quote:"/entry_2001: Referencia sin año"}]}],discoveries:[]},true);
  expect(report.findings[0]?.status).toBe("unverified");expect(report.findings[0]?.coverage).toBe(0);
 });
 it("conserva el prefijo descargado al exceder tamaño y distingue un cuerpo truncado",async()=>{
  const before=process.env["CRV_RESEARCH_DOCUMENT_MAX_BYTES"];process.env["CRV_RESEARCH_DOCUMENT_MAX_BYTES"]="5";resetEnvCache();
  try{
   expect(getEnv().CRV_RESEARCH_DOCUMENT_MAX_BYTES).toBe(5);
   const result=await readBoundedResponse(new Response("abcdefgh"));expect(Buffer.from(result.bytes).toString()).toBe("abcde");expect(result.complete).toBe(false);
   const truncated=await readBoundedResponse(new Response("abcd",{headers:{"content-length":"5"}}));expect(truncated.complete).toBe(false);expect(truncated.reason).toContain("4 de 5");
  }finally{if(before===undefined)delete process.env["CRV_RESEARCH_DOCUMENT_MAX_BYTES"];else process.env["CRV_RESEARCH_DOCUMENT_MAX_BYTES"]=before;resetEnvCache();}
 });
});
