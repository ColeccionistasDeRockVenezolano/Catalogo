import { describe,expect,it } from "vitest";
import { DeepSeekGateway,MemoryDeepSeekRunStore, type DeepSeekTransportRequest } from "../../src/ai/gateway.js";
import { compareCatalog,comparisonPageExcerpt,evaluateJoint,normalizePair,pairKey,researchComparison } from "../../src/verification/comparison.js";
import { evaluateVerification } from "../../src/verification/evaluate.js";
import type { ComparisonSide } from "../../src/verification/comparison-types.js";
import type { VerificationSnapshot } from "../../src/verification/types.js";
import type { WebPage } from "../../src/ambiguity/web-search.js";
const page=(url:string,content:string,origin:WebPage["origin"]="page"):WebPage=>({url,title:"Fuente de prueba",content,origin,contentHash:url,fetchedAt:"2026-10-07T12:00:00Z"});
function side(kind:ComparisonSide["kind"],id:number,name:string,artistType:string|null=null):ComparisonSide {
 const snapshot:VerificationSnapshot={kind,id,name,identity:[name],sourceUrls:[],albums:[],catalogAlbums:[],units:[{key:"identity.name",area:"identity",label:"Nombre",value:name,expected:[name],context:[],issue:null}]};
 return {kind,id,name,artistType,facts:{},hash:String(id),snapshot,verification:evaluateVerification(snapshot,[])};
}
const left=side("artist",1,"Voz QA","solo_artist"),right=side("person",2,"Pedro QA");
const first=page("https://oficial.example/qa","Voz QA es el alias y nombre artístico de Pedro QA, bajista venezolano.");
const second=page("https://archivo.example/qa","Pedro QA utiliza Voz QA como alias en sus lanzamientos.");
const claim={conclusion:"same_identity" as const,explanation:"Alias explícito",evidence:[{source:0,quote:first.content}]};
describe("comparación cruzada de fichas",()=>{
 it("normaliza la pareja en ambos sentidos y rechaza una ficha consigo misma o tipos incompatibles",()=>{
  expect(pairKey(left,right)).toBe(pairKey(right,left));expect(normalizePair(right,left)[0]).toEqual(left);
  expect(()=>normalizePair(left,left)).toThrow("distinta");expect(()=>normalizePair(left,side("album",1,"Disco"))).toThrow("álbumes");
 });
 it("un nombre igual solo aporta 4 puntos y los datos ausentes no llenan áreas",()=>{
  const a=side("person",1,"Pedro QA"),b=side("person",2,"Pedro QA");const rows=compareCatalog(a,b);
  expect(rows.reduce((n,r)=>n+r.maximum,0)).toBe(40);expect(rows.reduce((n,r)=>n+r.points,0)).toBe(4);
  expect(rows.filter(r=>r.status==="missing").every(r=>r.points===0)).toBe(true);expect(evaluateJoint(a,b,[]).score).toBeNull();
 });
 it("verifica títulos por posición, duraciones, sello y alcance de créditos y escala una coincidencia parcial",()=>{
  const a=side("album",1,"Disco QA"),b=side("album",2,"Disco QA");
  for(const s of [a,b]){s.snapshot.albums=[{id:s.id,title:s.name,artist:"Banda QA",year:2001}];s.snapshot.identity.push("Banda QA");s.snapshot.units.push({key:`track.${s.id}`,area:"tracks",label:"Disco QA · 1.1",value:"Intro",expected:["Intro"],context:[],issue:null});}
  b.snapshot.units.push({key:"track.3",area:"tracks",label:"Disco QA · 1.2",value:"Final",expected:["Final"],context:[],issue:null});
  a.facts["durations"]=["1.1: 80 s"];b.facts["durations"]=["1.1: 90 s"];
  const rows=compareCatalog(a,b);expect(rows.find(r=>r.key==="tracks")).toMatchObject({coverage:.5,points:5});
  expect(rows.find(r=>r.key==="durations")?.status).toBe("different");expect(rows.reduce((n,r)=>n+r.maximum,0)).toBe(40);
 });
 it("una cita literal conjunta da más peso que un nombre y distingue fuentes independientes de copias",()=>{
  expect(evaluateJoint(left,right,[first],claim,true)).toMatchObject({webPoints:45,score:45,conclusion:"same_identity"});
  const two={...claim,evidence:[...claim.evidence,{source:1,quote:second.content}]};
  expect(evaluateJoint(left,right,[first,second],two,true).webPoints).toBe(60);
  expect(evaluateJoint(left,right,[{...first,origin:"search_snippet"}],claim,true).webPoints).toBe(15);
  expect(evaluateJoint(left,right,[first,{...first,url:second.url}],{...claim,evidence:[...claim.evidence,{source:1,quote:first.content}]},true).webPoints).toBe(45);
 });
 it("rechaza citas inventadas y fuentes que solo mencionan a una ficha o al artista de un álbum",()=>{
  expect(evaluateJoint(left,right,[first],{...claim,evidence:[{source:0,quote:"Una frase inventada sobre Voz QA y Pedro QA."}]},true).webPoints).toBe(0);
  const individual=page(first.url,"Voz QA es un artista. La página también incluye información acerca de Pedro QA.");
  expect(evaluateJoint(left,right,[individual],{...claim,evidence:[{source:0,quote:"Voz QA es un artista."}]},true).evidence).toHaveLength(0);
  const a=side("album",1,"Disco Uno"),b=side("album",2,"Disco Dos");for(const s of [a,b]){s.snapshot.identity.push("Banda QA");s.snapshot.albums=[{id:s.id,title:s.name,artist:"Banda QA",year:2000}];}
  const p=page(first.url,"Banda QA publicó varios lanzamientos en 2000.");expect(evaluateJoint(a,b,[p],{...claim,evidence:[{source:0,quote:p.content}]},true).evidence).toHaveLength(0);
 });
 it("resuelve referencias numéricas y URLs exactas sin aceptar una fuente inventada",()=>{
  expect(evaluateJoint(left,right,[first],{...claim,evidence:[{source:"0",quote:first.content}]},true).webPoints).toBe(45);
  expect(evaluateJoint(left,right,[first],{...claim,evidence:[{source:`${first.url} (índice 123)`,quote:first.content}]},true).webPoints).toBe(45);
  expect(evaluateJoint(left,right,[first],{...claim,evidence:[{source:"https://inventado.example/qa (índice 0)",quote:first.content}]},true).evidence).toHaveLength(0);
 });
 it("una banda y su integrante son relacionados y no reciben puntos documentales de identidad",()=>{
  const band={...left,artistType:"band"};
  const report=evaluateJoint(band,right,[first],claim,true);expect(report.conclusion).toBe("related");expect(report.webPoints).toBe(0);
  expect(evaluateJoint(left,right,[first],{...claim,conclusion:"distinct"},true)).toMatchObject({conclusion:"distinct",webPoints:0});
 });
 it("investiga ambos lados y evalúa su evidencia conjuntamente con los datos cruzados",async()=>{
  const l={...left,snapshot:{...left.snapshot,sourceUrls:[first.url]}},r={...right,snapshot:{...right.snapshot,sourceUrls:[first.url]}};
  const requests: DeepSeekTransportRequest[] = [];
  const transport = { async complete(request: DeepSeekTransportRequest) {
    requests.push(request);
    const input = JSON.parse(request.user.slice(request.user.indexOf("\n") + 1)) as { comparison?: unknown; units?: Array<{ key: string }> };
    const response = input.comparison ? claim : {
      findings: (input.units ?? []).map(u => ({ key: u.key, status: "unverified", observed: null, reason: "Sin respaldo", evidence: [] })), discoveries: [],
    };
    return { content: JSON.stringify(response), model: request.model, tokensIn: 1, tokensOut: 1 };
  } };
  const gateway=new DeepSeekGateway({baseUrl:"https://example.com",models:{fast:"mock",reasoning:"mock",vision:"mock"},maxTokens:4096,timeoutMs:1000},transport,new MemoryDeepSeekRunStore());
  const report=await researchComparison(l,r,"QA",{search:async()=>[],page:async()=>first},gateway,false);
  expect(requests.filter(r=>JSON.parse(r.user.slice(r.user.indexOf("\n") + 1)).comparison)).toHaveLength(1);
  expect(report.left.verification.evaluation?.complete).toBe(true);expect(report.right.verification.evaluation?.complete).toBe(true);
  expect(report.left.verification.researched).toBe(true);expect(report.right.verification.researched).toBe(true);expect(report.conclusion).toBe("same_identity");
 });
 it("conserva datos relevantes al final de una página larga con citas y tildes originales",()=>{
  const quote="Pedro QA publicó Voz QA en 2001.";const p=page(first.url,"Cabecera. "+"contenido anterior ".repeat(1800)+quote);
  const excerpt=comparisonPageExcerpt(p,["voz qa","pedro qa"]);expect(excerpt).toContain(quote);expect(excerpt.length).toBeLessThan(24001);
 });
 it("fallos de búsqueda conjunta dejan ambas investigaciones visibles sin fingir identidad",async()=>{
  const report=await researchComparison(left,right,"QA",{search:async()=>{throw new Error("Sin buscador");},page:async()=>null},undefined,false);
  expect(report.researched).toBe(true);expect(report.conclusion).toBe("inconclusive");expect(report.webPoints).toBe(0);expect(report.left.verification.limitations.some(v=>v.includes("búsqueda"))).toBe(true);
 });
});
