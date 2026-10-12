import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { DeepSeekGateway, MemoryDeepSeekRunStore, MockDeepSeekTransport } from "../../src/ai/gateway.js";
import { researchVerification, type ResearchState } from "../../src/verification/research.js";
import { researchNeedsResume,retainVerificationEvidence } from "../../src/verification/research-state.js";
import { mergeResearchProposal } from "../../src/verification/research-ledger.js";
import type { VerificationSnapshot } from "../../src/verification/types.js";
const snapshot:VerificationSnapshot={kind:"artist",id:1,name:"Banda Prueba",identity:["Banda Prueba"],units:[],albums:[],catalogAlbums:[],sourceUrls:["https://fuente.example/banda"]};
const content="Banda Prueba publicó el Disco Uno en 2001.";
const page={url:snapshot.sourceUrls[0]!,title:snapshot.name,content,contentHash:createHash("sha256").update(content).digest("hex"),fetchedAt:"2026-10-10T12:00:00Z",capturedAt:"2026-10-10T12:00:00Z",readAt:"2026-10-12T10:00:00Z",acquisitionMethod:"http" as const};
const gateway=(transport:MockDeepSeekTransport)=>new DeepSeekGateway({baseUrl:"https://example.com",models:{fast:"mock",reasoning:"mock",vision:"mock"},maxTokens:4096,timeoutMs:1000},transport,new MemoryDeepSeekRunStore());
const response={findings:[],discoveries:[{area:"discography" as const,value:"Disco Uno",context:"Banda Prueba",reason:"Documentado",evidence:[{source:0,quote:content}]}]};
describe("investigación persistente por tareas",()=>{
  it("conserva descubrimientos y contradicciones al refrescar una fuente sin reasignar su cita a la versión nueva",async()=>{
    const unit={key:"status.formed",area:"status" as const,label:"Formación",value:"2001",expected:["2001"],context:[snapshot.name],issue:null};
    const old:ResearchState={rulesVersion:6,pages:[page],proposal:{...response,findings:[{key:unit.key,status:"confirmed",observed:"2001",reason:"Captura anterior",evidence:[{source:0,quote:content}]}]},pendingKeys:[],limitations:[],attempts:0};
    const changed={...page,content:"Banda Prueba se formó en 2002.",contentHash:"changed",capturedAt:"2026-10-12T12:00:00Z"};
    let state:ResearchState|undefined;
    await researchVerification({...snapshot,units:[unit]},{search:async()=>[],page:async()=>changed},gateway(new MockDeepSeekTransport({findings:[{key:unit.key,status:"contradicted",observed:"2002",reason:"Otra fecha",evidence:[{source:1,quote:changed.content}]}],discoveries:[]},{findings:[],discoveries:[]},{findings:[],discoveries:[]})),undefined,{baseline:old,onState:async s=>{state=s;}});
    expect(state?.pages).toEqual([page,changed]);
    expect(state?.proposal.discoveries).toEqual(response.discoveries);
    expect(state?.proposal.findings.map(f=>f.observed)).toEqual(["2001","2002"]);
    expect(state?.proposal.findings[0]?.evidence[0]?.source).toBe(0);
    expect(old.pages).toEqual([page]);
    const target:ResearchState={...old,pages:[changed],proposal:{findings:[],discoveries:[]},limitations:[]};
    retainVerificationEvidence(snapshot,old,target);retainVerificationEvidence(snapshot,old,target);
    expect(target.pages).toEqual([changed,page]);expect(target.proposal.discoveries).toHaveLength(1);
    expect(target.proposal.discoveries[0]?.evidence).toEqual([{source:1,quote:content}]);
  });
  it("preserva adquisición antes de pausar y reanuda sin repetir las búsquedas terminadas",async()=>{
    let searches=0,downloads=0,state:ResearchState|undefined;
    const broker={search:async()=>{searches++;return [];},page:async()=>{downloads++;return page;}};
    const paused=await researchVerification(snapshot,broker,gateway(new MockDeepSeekTransport()),undefined,{control:async()=>downloads?"paused":"continue",onState:async s=>{state=s;}});
    expect(paused.research?.stopReason).toBe("paused");expect(paused.evaluation?.complete).toBe(false);
    expect(state?.pages).toEqual([page]);expect(researchNeedsResume(snapshot,state!)).toBe(true);
    const count=searches;
    const finished=await researchVerification(snapshot,broker,gateway(new MockDeepSeekTransport(response)),undefined,{resume:state!});
    expect(searches).toBe(count);expect(downloads).toBe(1);
    expect(finished.research?.tasks.every(t=>t.status==="completed")).toBe(true);
    expect(finished.research?.sources[0]).toMatchObject({status:"completely_read",capturedAt:page.capturedAt,chunks:{total:1,processed:1}});
    expect(finished.evaluation?.complete).toBe(true);expect(finished.suggestions?.[0]?.observed).toBe("Disco Uno");
  });
  it("reintenta solo la fuente fallida y no presenta un informe completo mientras siga inaccesible",async()=>{
    let state:ResearchState|undefined,first=0,second=0;
    const other="https://fuente.example/otra";
    const broker={search:async()=>[],page:async(url:string)=>{if(url===page.url){first++;return page;}second++;throw Error("HTTP 503");}};
    const snap={...snapshot,sourceUrls:[page.url,other]};
    const partial=await researchVerification(snap,broker,gateway(new MockDeepSeekTransport(response)),undefined,{onState:async s=>{state=s;}});
    expect(partial.evaluation?.complete).toBe(false);expect(partial.research?.sources.find(s=>s.url===other)).toMatchObject({status:"failed",reason:"HTTP 503"});
    expect(researchNeedsResume(snap,state!)).toBe(true);
    const done=await researchVerification(snap,{...broker,page:async(url:string)=>{if(url===page.url){first++;return page;}second++;return {...page,url};}},gateway(new MockDeepSeekTransport({findings:[],discoveries:[]})),undefined,{resume:state!});
    expect(first).toBe(1);expect(second).toBe(2);expect(done.evaluation?.complete).toBe(true);
    expect(done.suggestions?.[0]?.evidence).toHaveLength(1);
    expect(done.limitations.join(" ")).not.toContain("HTTP 503");
  });
  it("conserva el checkpoint al alcanzar presupuesto sin consumir una llamada adicional",async()=>{
    let state:ResearchState|undefined;
    const transport=new MockDeepSeekTransport(response);
    const partial=await researchVerification(snapshot,{search:async()=>[],page:async()=>page},gateway(transport),undefined,{budget:{maxCalls:0},onState:async s=>{state=s;}});
    expect(transport.requests).toHaveLength(0);expect(partial.research?.stopReason).toBe("budget");expect(state?.pages).toHaveLength(1);
    const finished=await researchVerification(snapshot,{search:async()=>{throw Error("No buscar");},page:async()=>null},gateway(transport),undefined,{resume:state!,budget:{maxCalls:1}});
    expect(finished.evaluation?.complete).toBe(true);expect(finished.research?.consumption).toMatchObject({calls:1,tokensIn:1,tokensOut:1});
  });
  it("contrasta un campo con una fuente situada después de las primeras doce",async()=>{
    const sources=Array.from({length:13},(_,index)=>({...page,url:`https://source.example/${index}`,content:`Banda Prueba ${"texto ".repeat(2500)} ${index===12?"Banda Prueba, año 2001.":"Fuente sin año documentado."}`}));
    const unit={key:"status.formed",area:"status" as const,label:"Formación",value:"2001",expected:["2001"],context:["Banda Prueba"],issue:null};
    const responses=Array.from({length:40},()=>({findings:[{key:unit.key,status:"unverified",observed:null,reason:"Sin respaldo",evidence:[]}],discoveries:[]}));
    const transport=new MockDeepSeekTransport(...responses);
    const resume:ResearchState={rulesVersion:6,pages:sources,proposal:{findings:[],discoveries:[]},pendingKeys:[unit.key],limitations:[],attempts:0};
    await researchVerification({...snapshot,units:[unit]}, {search:async()=>[],page:async()=>null},gateway(transport),undefined,{resume});
    const inputs=transport.requests.map(request=>JSON.parse(request.user.replace(/^INPUT JSON:\n/u,"")) as {units:Array<{key:string}>;pages:Array<{source:number;content:string}>});
    const evaluated=inputs.filter(input=>input.units.some(item=>item.key===unit.key));
    expect(evaluated.some(input=>input.pages.some(item=>item.source===12&&item.content.includes("año 2001")))).toBe(true);
    expect(new Set(evaluated.flatMap(input=>input.pages.map(item=>item.source))).size).toBe(13);
  });
  it("no declara completa una investigación sin fuentes ni unidades de contraste",async()=>{
    const report=await researchVerification({...snapshot,sourceUrls:[]},{search:async()=>[],page:async()=>null},gateway(new MockDeepSeekTransport()));
    expect(report.evaluation?.complete).toBe(false);expect(report.score).toBeNull();
    expect(report.limitations.join(" ")).toContain("No se obtuvieron fuentes legibles");
  });
  it("busca todas las identidades conocidas sin limitar la cuarta variante",async()=>{
    const queries:string[]=[];
    await researchVerification({...snapshot,sourceUrls:[],identity:[snapshot.name,"Alias Uno","Alias Dos","Alias Tres","Alias Cuatro"]},{search:async query=>{queries.push(query);return [];},page:async()=>null},gateway(new MockDeepSeekTransport()));
    expect(queries.some(query=>query.startsWith('"Alias Cuatro"'))).toBe(true);
  });
  it("conserva recursos distintos cuya ruta difiere en mayúsculas",async()=>{
    const images=["https://source.example/Cover.jpg","https://source.example/cover.jpg"];
    const proposal={findings:[],discoveries:images.map(value=>({area:"images" as const,value,context:"Banda Prueba",reason:"Retrato",evidence:[{source:0,quote:`Banda Prueba Imagen: retrato | URL: ${value}`}]}))};
    const merged={findings:[],discoveries:[]};mergeResearchProposal(merged,proposal);expect(merged.discoveries).toHaveLength(2);
    const {evaluateVerification}=await import("../../src/verification/evaluate.js");
    const report=evaluateVerification(snapshot,[{...page,content:proposal.discoveries.map(item=>item.evidence[0]!.quote).join(" · ")}],merged,true);
    expect(report.suggestions?.map(item=>item.observed)).toEqual(images);
  });
  it("agrupa valores equivalentes conservando todas las citas y las contradicciones",()=>{
    const proposal={findings:[],discoveries:[]};
    mergeResearchProposal(proposal,response);
    mergeResearchProposal(proposal,{findings:[],discoveries:[{...response.discoveries[0]!,value:"DISCO ÚNO",evidence:[{source:1,quote:"Otra fuente documenta Disco Uno en 2002."}]}]});
    mergeResearchProposal(proposal,{findings:[],discoveries:[{...response.discoveries[0]!,value:"Disco Dos"}]});
    expect(proposal.discoveries).toHaveLength(2);expect(proposal.discoveries[0]).toHaveProperty("evidence",[{source:0,quote:content},{source:1,quote:"Otra fuente documenta Disco Uno en 2002."}]);
  });
});
