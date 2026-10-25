import { describe,expect,it } from "vitest";
import { planningBatches } from "../../src/curation/ai/context-batches.js";
import { combinePlanningResults } from "../../src/curation/ai/research-results.js";
import { orderedOperations,draftSchema } from "../../src/curation/ai/schema.js";
import type { CatalogDraft,CatalogEvidence } from "../../src/curation/ai/types.js";
const citation=(id:number):CatalogEvidence=>({id:`E${id}`,url:`https://source.example/${id}`,quote:`Banda Prueba: hecho ${id}. ${"contenido ".repeat(90)}`,origin:"page",fetchedAt:"2026-10-10",contentHash:`hash${id}`,label:"Fuente"});
const base={root:{kind:"artist",id:1,label:"Banda Prueba"},instruction:"Revisar todos los datos",current:{row:{name:"Banda Prueba"},relations:{}},relatedEntities:[],narrativeOriginals:{current:{biography:"Biografía original"}},entityFields:{},evidence:[]};
const operation={key:"alias",label:"Añadir alias",reason:"Documentado",evidenceIds:["E1"],enabled:true,op:"add_alias" as const,target:{kind:"artist" as const,id:1},alias:"Banda",aliasType:"other",isPrimary:false};
describe("contexto de planificación por tareas",()=>{
  it("mantiene un borrador válido al reunir muchas rondas sin perder sus fuentes",()=>{
    const results=Array.from({length:15},(_,index)=>({draft:{summary:`Lote ${index}: ${"Resumen ".repeat(150)}`,unresolved:[],operations:[{...operation,evidenceIds:[`E${index+1}`]}]},evidence:[citation(index+1)]}));
    const result=combinePlanningResults(results);
    expect(()=>draftSchema.parse(result.draft)).not.toThrow();
    expect(result.evidence).toHaveLength(15);
    expect(result.draft.operations).toHaveLength(1);
    expect(result.draft.operations[0]!.evidenceIds).toHaveLength(8);
  });
  it("combina claves largas y prefijos numéricos manteniendo claves válidas y todas las dependencias",()=>{
    const long="artist_with_a_long_valid_creation_key";
    const fields={label:"Alta",reason:"Documentado",evidenceIds:["E1"],enabled:true};
    const draft:CatalogDraft={summary:"Alta",unresolved:[],operations:[
      {...fields,key:long,op:"create_entity",kind:"artist",values:{name:"Banda"}},
      {...fields,key:"album_with_long_valid_creation_key",op:"create_entity",kind:"album",parent:{kind:"artist",key:long},values:{title:"Disco"}},
    ]};
    const result=combinePlanningResults([{draft,evidence:[citation(1)],taskKey:"0123456789abcdef"}]);
    expect(()=>draftSchema.parse(result.draft)).not.toThrow();
    expect(()=>orderedOperations(result.draft)).not.toThrow();
    expect(result.draft.operations.every(op=>op.key.length<=40&&/^[a-zA-Z]/u.test(op.key))).toBe(true);
  });
  it("visita todos los pendientes y conserva el cien por ciento de las citas fuera de los límites anteriores",()=>{
    const evidence=Array.from({length:430},(_,index)=>citation(index+1));
    const pending=evidence.map((item,index)=>({key:`finding.${index}`,area:"identity",observed:`Valor ${index}`,evidenceIds:[item.id]}));
    const batches=planningBatches({...base,report:{pending}},evidence,10000);
    expect(batches.length).toBeGreaterThan(1);
    expect(batches.every(batch=>JSON.stringify(batch.context).length<=10000)).toBe(true);
    expect(batches.flatMap(batch=>batch.findingKeys)).toEqual(pending.map(unit=>unit.key));
    expect(new Set(batches.flatMap(batch=>batch.evidence.map(item=>item.id))).size).toBe(430);
    for(const batch of batches){
      const ids=new Set(batch.evidence.map(item=>item.id));
      for(const item of (batch.context["report"] as {pending:Array<{evidenceIds:string[]}>}).pending)expect(item.evidenceIds.every(id=>ids.has(id))).toBe(true);
    }
  });
  it("divide las citas de un mismo hallazgo sin perder ninguna ni dejar referencias colgantes",()=>{
    const evidence=Array.from({length:25},(_,index)=>citation(index+1));
    const unit={key:"many.citations",area:"identity",observed:"Alias documentado",evidenceIds:evidence.map(item=>item.id)};
    const batches=planningBatches({...base,report:{pending:[unit]}},evidence,5000);
    expect(batches.length).toBeGreaterThan(1);
    expect(batches.every(batch=>JSON.stringify(batch.context).length<=5000)).toBe(true);
    expect(batches.flatMap(batch=>batch.evidence)).toEqual(evidence);
    for(const batch of batches){
      const pending=(batch.context["report"] as {pending:Array<{evidenceIds:string[]}>}).pending;
      expect(pending[0]?.evidenceIds).toEqual(batch.evidence.map(item=>item.id));
    }
  });
  it("conserva evidencia adicional aunque no exista informe de verificación",()=>{
    const evidence=Array.from({length:100},(_,index)=>citation(index+1));
    const batches=planningBatches(base,evidence,8000);
    expect(batches.flatMap(batch=>batch.evidence)).toEqual(evidence);
    expect(batches.every(batch=>JSON.stringify(batch.context).length<=8000)).toBe(true);
  });
  it("no deja que claves de dos lotes sobrescriban operaciones o citas distintas",()=>{
    const one={...citation(1),quote:"Banda Prueba alias Banda"};
    const two={...citation(1),url:"https://source.example/other",quote:"Banda Prueba alias Otro"};
    const draft:CatalogDraft={summary:"Alias",unresolved:[],operations:[operation]};
    const result=combinePlanningResults([{draft,evidence:[one]},{draft:{...draft,operations:[{...operation,alias:"Otro"}]},evidence:[two]}]);
    expect(result.draft.operations).toHaveLength(2);
    expect(new Set(result.draft.operations.map(op=>op.key)).size).toBe(2);
    expect(result.evidence).toHaveLength(2);
    const ids=result.draft.operations.map(op=>op.evidenceIds[0]);expect(new Set(ids).size).toBe(2);
    expect(ids.map(id=>result.evidence.find(item=>item.id===id)?.quote)).toEqual([one.quote,two.quote]);
  });
  it("agrupa operaciones equivalentes y conserva el respaldo de los dos lotes",()=>{
    const result=combinePlanningResults([{draft:{summary:"",unresolved:[],operations:[operation]},evidence:[citation(1)]},{draft:{summary:"",unresolved:[],operations:[{...operation,evidenceIds:["E2"]}]},evidence:[citation(2)]}]);
    expect(result.draft.operations).toHaveLength(1);expect(result.draft.operations[0]?.evidenceIds).toEqual(["E1","E2"]);
  });
  it("mantiene dependencias de entidades nuevas al combinar lotes con claves iguales",()=>{
    const draft:CatalogDraft={summary:"Alta",unresolved:[],operations:[
      {...operation,key:"artist",op:"create_entity",kind:"artist",values:{name:"Banda"}},
      {...operation,key:"album",op:"create_entity",kind:"album",parent:{kind:"artist",key:"artist"},values:{title:"Disco"}},
    ]};
    const second:CatalogDraft={...draft,operations:[{...draft.operations[0]!,values:{name:"Otra Banda"}} as CatalogDraft["operations"][number],{...draft.operations[1]!,values:{title:"Otro disco"}} as CatalogDraft["operations"][number]]};
    const result=combinePlanningResults([{draft,evidence:[citation(1)]},{draft:second,evidence:[citation(1)]}]);
    expect(()=>orderedOperations(result.draft)).not.toThrow();expect(result.draft.operations).toHaveLength(4);
  });
  it("envía la taxonomía completa solo a las tareas de géneros; las demás reciben los términos que citan",()=>{
    const taxonomy={columns:["slug","name","level","parentSlug"],rows:[["rock","Rock","genre",null],["ska","Ska","genre",null],["ska-punk","Ska punk","subgenre","ska"],["jazz","Jazz","genre",null],["salsa","Salsa","genre",null]]};
    const quote:CatalogEvidence={...citation(1),quote:"Banda Prueba mezcla ska punk con letras de protesta."};
    const unit=(area:string)=>({key:`k.${area}`,area,label:area,value:null,observed:"x",status:"unverified",context:[],explanation:"",evidenceIds:["E1"]});
    const context=(area:string)=>({...base,taxonomy,currentGenres:[{slug:"rock"}],report:{pending:[unit(area)]}});
    const [other]=planningBatches(context("members"),[quote],30000);
    expect((other!.context["taxonomy"] as {rows:string[][]}).rows.map(row=>row[0])).toEqual(["rock","ska","ska-punk"]);
    const [genres]=planningBatches(context("genres"),[quote],30000);
    expect((genres!.context["taxonomy"] as {rows:string[][]}).rows).toHaveLength(5);
  });
});
