import { describe, it, expect } from "vitest";
import { DeepSeekGateway, MemoryDeepSeekRunStore, MockDeepSeekTransport } from "../../src/ai/gateway.js";
import { planProvidedEvidence } from "../../src/curation/ai/provided-evidence.js";
import type { CatalogEvidence } from "../../src/curation/ai/types.js";
const evidence: CatalogEvidence = { id:"OS1",url:"https://band.example/history",quote:"Banda Venezuela formada en 1984 por Fernando.",contentHash:"fixture",fetchedAt:"2026-10-13T20:00:00Z",origin:"page",label:"Fundación" };
const context = { root:{kind:"artist",id:266,label:"Banda Venezuela"},narrativeOriginals:{current:{biography:"Historia ya registrada."}} };
const reply = (operations:unknown[]) => ({summary:"Propuestas",operations,unresolved:[],resolvedUnresolved:[],lookups:[]});
const op = (key:string,values:Record<string,unknown>,id=266,evidenceIds=["OS1"]) => ({key,label:key,reason:"Dato documentado",op:"replace_fields",target:{kind:"artist",id},values,evidenceIds,enabled:true});
describe("planificación desde evidencia ya recorrida",()=>{
  it("reutiliza una persona ya ligada al proyecto y deja otra identidad ambigua sin duplicar",async()=>{
    const create=(key:string,name:string)=>({key,label:name,reason:"Fuente",op:"create_entity",kind:"person",values:{name},evidenceIds:["OS1"],enabled:true});
    const member=(key:string,person:string)=>({key,label:key,reason:"Fuente",op:"create_relation",kind:"artist_membership",endpoints:{artistId:{kind:"artist",id:266},personId:{kind:"person",key:person}},values:{role:"Guitarra"},evidenceIds:["OS1"],enabled:true});
    const transport=new MockDeepSeekTransport(reply([create("known","Fernando"),member("member","known"),create("ambiguous","Luis"),member("pending","ambiguous")]),reply([]));
    const gateway=new DeepSeekGateway({baseUrl:"https://mock.invalid",models:{fast:"mock",reasoning:"mock",vision:"mock"},maxTokens:4000,timeoutMs:1000},transport,new MemoryDeepSeekRunStore());
    const result=await planProvidedEvidence({...context,catalogCandidates:[{kind:"person",id:42,name:"Fernando"},{kind:"person",id:43,name:"Luis"}],catalogIdentityProfiles:[{id:42,memberships:[],rootCredits:[{albumId:1}]},{id:43,memberships:[],rootCredits:[]}]},[evidence],"Enriquecer",gateway,async()=>{});
    expect(result.draft.operations).toHaveLength(1);
    expect(result.draft.operations[0]).toMatchObject({op:"create_relation",endpoints:{personId:{kind:"person",id:42}}});
    expect(result.draft.unresolved).toHaveLength(2);
  });
  it("no elige arbitrariamente entre biografías incompatibles",async()=>{
    const transport=new MockDeepSeekTransport(reply([]),reply([op("bio1",{biography:"Primera versión."}),op("bio2",{biography:"Segunda versión."})]));
    const gateway=new DeepSeekGateway({baseUrl:"https://mock.invalid",models:{fast:"mock",reasoning:"mock",vision:"mock"},maxTokens:4000,timeoutMs:1000},transport,new MemoryDeepSeekRunStore());
    const result=await planProvidedEvidence(context,[evidence],"Enriquecer",gateway,async()=>{});
    expect(result.draft.operations).toEqual([]);
    expect(result.draft.unresolved).toHaveLength(2);
  });
  it("separa los datos estructurados de la síntesis y conserva la biografía original como contexto",async()=>{
    const transport=new MockDeepSeekTransport(reply([op("year",{formedYear:1984})]),reply([op("bio",{biography:"Historia ya registrada. Banda Venezuela se formó en 1984."})]));
    const gateway=new DeepSeekGateway({baseUrl:"https://mock.invalid",models:{fast:"mock",reasoning:"mock",vision:"mock"},maxTokens:4000,timeoutMs:1000},transport,new MemoryDeepSeekRunStore());
    const result=await planProvidedEvidence(context,[evidence],"Enriquecer",gateway,async()=>{});
    expect(result.draft.operations).toHaveLength(2);
    expect(result.evidence).toEqual([evidence]);
    expect(transport.requests).toHaveLength(2);
    expect(transport.requests[1]!.user).toContain("Historia ya registrada.");
    expect(transport.requests.every(request=>request.user.includes('"forcePlan":true'))).toBe(true);
  });
  it("mantiene pendientes las referencias inventadas y las biografías de otra ficha",async()=>{
    const transport=new MockDeepSeekTransport(reply([op("invented",{formedYear:1984},266,["E999"])]),reply([op("foreignbio",{biography:"Otra historia."},42)]));
    const gateway=new DeepSeekGateway({baseUrl:"https://mock.invalid",models:{fast:"mock",reasoning:"mock",vision:"mock"},maxTokens:4000,timeoutMs:1000},transport,new MemoryDeepSeekRunStore());
    const result=await planProvidedEvidence(context,[evidence],"Enriquecer",gateway,async()=>{});
    expect(result.draft.operations).toEqual([]);
    expect(result.draft.unresolved).toHaveLength(2);
  });
  it("visita todas las citas en grupos y las vuelve a reunir para la biografía",async()=>{
    const citations=Array.from({length:4},(_,index)=>({...evidence,id:`OS${index+1}`,quote:`${"Texto documentado. ".repeat(700)}final-${index}`}));
    const transport=new MockDeepSeekTransport(...Array.from({length:5},()=>reply([])));
    const gateway=new DeepSeekGateway({baseUrl:"https://mock.invalid",models:{fast:"mock",reasoning:"mock",vision:"mock"},maxTokens:4000,timeoutMs:1000},transport,new MemoryDeepSeekRunStore());
    await planProvidedEvidence(context,citations,"Enriquecer",gateway,async()=>{});
    for(let index=0;index<4;index++)expect(transport.requests.slice(0,-1).some(request=>request.user.includes(`final-${index}`))).toBe(true);
    for(let index=0;index<4;index++)expect(transport.requests.at(-1)!.user).toContain(`final-${index}`);
  });
});
