import {researchNeedsResume} from "../../src/verification/research-state.js";
import {RULES_VERSION} from "../../src/verification/proof.js";
import {describe,it,expect} from "vitest";
import {load} from "cheerio";
import {fullSourceChunks,researchVerification,type ResearchState} from "../../src/verification/research.js";
import {pageImageResources} from "../../src/ambiguity/page-images.js";
import {DeepSeekGateway,MemoryDeepSeekRunStore,MockDeepSeekTransport} from "../../src/ai/gateway.js";
import type {WebPage} from "../../src/ambiguity/web-search.js";
import type {VerificationSnapshot} from "../../src/verification/types.js";
const snapshot:VerificationSnapshot={kind:"artist",id:1,name:"Jeremías",identity:["Jeremías"],units:[],albums:[],catalogAlbums:[],sourceUrls:[]};
const page=(id:number,content:string):WebPage=>({url:`https://official.example/source/${id}`,title:"Jeremías",content,contentHash:`hash${id}`,fetchedAt:"2026-10-10"});
const gateway=(transport:MockDeepSeekTransport)=>new DeepSeekGateway({baseUrl:"https://example.com",models:{fast:"mock",reasoning:"mock",vision:"mock"},maxTokens:4096,timeoutMs:1000},transport,new MemoryDeepSeekRunStore());
describe("lectura integral de fuentes",()=>{
  it("recorre las fuentes que quedan fuera de los primeros doce y sus datos finales",async()=>{
    const pages=Array.from({length:13},(_,i)=>page(i,i===12?`Jeremías ${"texto ".repeat(4000)} Alias documentado: Jere.`:`Jeremías fuente ${i}.`));
    const transport=new MockDeepSeekTransport(...Array.from({length:5},()=>({findings:[],discoveries:[]})));
    const resume:ResearchState={rulesVersion:5,pages,proposal:{findings:[],discoveries:[]},pendingKeys:[],limitations:[],attempts:0};
    let state:ResearchState|undefined;
    const report=await researchVerification(snapshot,{search:async()=>[],page:async()=>null},gateway(transport),undefined,{resume,onState:async s=>{state=s;}});
    const inputs=transport.requests.map(r=>JSON.parse(r.user.slice(r.user.indexOf("{"))) as {pages:Array<{content:string;source:number}>});
    const contents=inputs.flatMap(i=>i.pages);
    expect(new Set(contents.map(c=>c.source)).size).toBe(13);
    expect(contents.some(c=>c.content.includes("Alias documentado: Jere."))).toBe(true);
    expect(report.evaluation).toMatchObject({complete:true,sourceChunks:{total:15,processed:15}});
    const retry=new MockDeepSeekTransport();
    await researchVerification(snapshot,{search:async()=>[],page:async()=>null},gateway(retry),undefined,{resume:state!});
    expect(retry.requests).toHaveLength(0);
  });
  it("guarda fallos como fragmentos pendientes y los reintenta sin repetir búsquedas",async()=>{
    const resume:ResearchState={rulesVersion:5,pages:[page(1,"Jeremías y sus discos.")],proposal:{findings:[],discoveries:[]},pendingKeys:[],limitations:[],attempts:0};
    let state:ResearchState|undefined;
    const failed=await researchVerification(snapshot,{search:async()=>[],page:async()=>null},gateway(new MockDeepSeekTransport()),undefined,{resume,onState:async s=>{state=s;}});
    expect(failed.evaluation?.complete).toBe(false);expect(failed.limitations.join(" ")).toContain("Lectura integral pendiente:");
    const report=await researchVerification(snapshot,{search:async()=>{throw Error("No buscar");},page:async()=>null},gateway(new MockDeepSeekTransport({findings:[],discoveries:[]})),undefined,{resume:state!});
    expect(report.evaluation?.complete).toBe(true);expect(report.limitations.join(" ")).not.toContain("Lectura integral pendiente:");
  });
  it("divide una fuente cuando la respuesta completa falla y conserva la cobertura del fragmento original",async()=>{
    const source=page(1,`Jeremías ${"texto ".repeat(1100)} Alias documentado: Jere.`);
    const transport=new MockDeepSeekTransport("respuesta truncada","respuesta truncada",{findings:[],discoveries:[]},{findings:[],discoveries:[]});
    let state:ResearchState|undefined;
    const report=await researchVerification(snapshot,{search:async()=>[],page:async()=>null},gateway(transport),undefined,{resume:{rulesVersion:6,pages:[source],proposal:{findings:[],discoveries:[]},pendingKeys:[],limitations:[],attempts:0},onState:async s=>{state=s;}});
    expect(report.evaluation).toMatchObject({complete:true,sourceChunks:{total:1,processed:1}});
    expect(state?.inspectedChunks).toHaveLength(3);
    expect(transport.requests).toHaveLength(4);
    expect(transport.requests.at(-1)?.user).toContain("Alias documentado: Jere.");
  });
  it("abre los enlaces de discos del índice y extrae portadas y pistas de esas páginas",async()=>{
    const index=page(1,"Jeremías discografía. Enlaces de la página: Enlace: Disco Uno https://official.example/jeremias/album/uno Recursos visuales de la página: Sin imágenes documentadas.");
    const album={...page(2,"Jeremías Disco Uno 1. Canción. Recursos visuales de la página: Imagen: Disco Uno | URL: https://official.example/cover.jpg"),url:"https://official.example/jeremias/album/uno"};
    const visited:string[]=[];
    const transport=new MockDeepSeekTransport({findings:[],discoveries:[{area:"images",value:"https://official.example/cover.jpg",context:"Disco Uno",reason:"Portada; calidad pendiente",evidence:[{source:1,quote:"Imagen: Disco Uno | URL: https://official.example/cover.jpg"}]}]});
    const report=await researchVerification({...snapshot,sourceUrls:[index.url]},{search:async()=>[],page:async url=>{visited.push(url);return url===index.url?index:album;}},gateway(transport));
    expect(visited).toContain(album.url);
    expect(report.suggestions?.some(s=>s.area==="images"&&s.observed=== "https://official.example/cover.jpg")).toBe(true);
  });
  it("conserva originales enlazados y metadatos de imagen sin un cupo de treinta",()=>{
    const html=load(`<a href="/original.jpg"><img src="/thumb.jpg" width="100" height="100" alt="Jeremías"></a><script type="application/ld+json">{"@type":"ImageObject","contentUrl":"/portrait.jpg","caption":"Jeremías retrato","width":1200,"height":1600}</script>${Array.from({length:35},(_,i)=>`<img src="/cover${i}.jpg" alt="Disco ${i}">`).join("")}`);
    const text=pageImageResources(html,"https://official.example");
    expect(text).toContain("/original.jpg");expect(text).toContain("/portrait.jpg");expect(text).toContain("1200 × 1600");expect(text).toContain("/cover34.jpg");expect(text).not.toContain("/thumb.jpg");
    expect(fullSourceChunks(page(1,text)).join(" ")).toContain("/cover34.jpg");
  });
});

describe("identidad antes de reutilizar imágenes",()=>{
  it("excluye la portada de un homónimo y conserva la del cantante identificado",async()=>{
    const snap={...snapshot,units:[{key:"identity.realName",area:"identity" as const,label:"Nombre real",value:"Carlos Eduardo López Ávila",expected:["Carlos Eduardo López Ávila"],context:[],issue:null}],catalogAlbums:[{id:10,title:"Ese que va por ahí",artist:"Jeremías",year:2006}]};
    const wrong=page(1,"Jeremías Adriel Martínez publicó Pan, todo en un punto. Imagen: Pan | URL: https://official.example/wrong.jpg");
    const right=page(2,"Jeremías, Carlos Eduardo López Ávila, cantante. Imagen: Jeremías | URL: https://official.example/right.jpg");
    const {evaluateVerification}=await import("../../src/verification/evaluate.js");
    const report=evaluateVerification(snap,[wrong,right],{findings:[],discoveries:[
      {area:"images",value:"https://official.example/wrong.jpg",context:"Jeremías",reason:"Retrato",evidence:[{source:0,quote:wrong.content}]},
      {area:"images",value:"https://official.example/right.jpg",context:"Jeremías",reason:"Retrato",evidence:[{source:1,quote:right.content}]},
    ]},true);
    expect(report.suggestions?.map(s=>s.observed)).toEqual(["https://official.example/right.jpg"]);
    const transport=new MockDeepSeekTransport({findings:[{key:"identity.realName",status:"confirmed",observed:"Carlos Eduardo López Ávila",reason:"Documentado",evidence:[{source:1,quote:right.content}]}],discoveries:[]},{findings:[],discoveries:[]});
    const researched=await researchVerification(snap,{search:async()=>[],page:async()=>null},gateway(transport),undefined,{resume:{rulesVersion:6,pages:[wrong,right],proposal:{findings:[],discoveries:[]},pendingKeys:["identity.realName"],limitations:[],attempts:0}});
    expect(transport.requests.every(r=>!r.user.includes("wrong.jpg"))).toBe(true);
    expect(researched.limitations.join(" ")).toContain("Identidad pendiente:");
    const completed:ResearchState={rulesVersion:RULES_VERSION,pages:[wrong,right],proposal:{findings:[],discoveries:[]},pendingKeys:[],limitations:[],attempts:0,inspectedChunks:[`${right.url}:${right.contentHash}:0`]};
    expect(researchNeedsResume(snap,completed)).toBe(false);
    expect(researchNeedsResume(snap,{...completed,inspectedChunks:[]})).toBe(true);
    expect(researchNeedsResume(snap,{...completed,pendingKeys:["identity.realName"]})).toBe(true);
    expect(researchNeedsResume(snap,{...completed,pages:[],pendingKeys:["identity.realName"]})).toBe(false);

  });
});
