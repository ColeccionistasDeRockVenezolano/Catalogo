import { describe, expect, it } from "vitest";
import { scoreEntity, summarize, type CorpusLabels } from "../../src/verification/corpus-metrics.js";
import type { ExtractedAssertion } from "../../src/verification/types.js";

const entity:CorpusLabels["entities"][number]={kind:"artist",id:1,name:"Banda Prueba",partition:"reserved",
  documents:[{id:"d10",file:"documents/d10.json",url:"https://a.example/1",sha256:"a".repeat(64),format:"html"},{id:"d11",file:"documents/d11.json",url:"https://b.example/2",sha256:"b".repeat(64),format:"pdf"}],
  positives:[
    {id:"p1",area:"status",documentId:"d10",match:["1989"],quote:"Se forman en 1989",critical:true,scope:"chronology",reviewed:false},
    {id:"p2",area:"tracks",documentId:"d11",match:["Clan Venérea","15"],quote:"15- Clan Venérea",critical:false,scope:"other",reviewed:false},
  ],
  negatives:[{id:"n1",type:"identity",match:["Banda Prueba Argentina"],reason:"Homónimo argentino",reviewed:false}]};
const assertion=(value:string,url:string,valid=true,extra:Partial<ExtractedAssertion>={}):ExtractedAssertion=>({id:value,kind:"discovery",key:null,area:"status",value,context:[],
  state:"supported",destination:"proposal",reason:"",findingKey:null,evidence:[{source:0,url,contentHash:"h",captureId:null,quote:value,valid,reason:null}],...extra});

describe("métricas del corpus documental",()=>{
  it("recupera un positivo solo con cita válida del mismo documento y todos sus términos",()=>{
    const score=scoreEntity(entity,[assertion("Formación en 1989","https://a.example/1"),assertion("Clan Venerea 15","https://a.example/1")]);
    expect(score).toMatchObject({positives:2,recovered:1,criticalPositives:1,criticalRecovered:1});
    expect(score.missed.map(m=>m.id)).toEqual(["p2"]);
    expect(score.byFormat).toMatchObject({html:{positives:1,recovered:1},pdf:{positives:1,recovered:0}});
  });
  it("acepta cualquiera de las alternativas de un término",()=>{
    const dated={...entity,positives:[{...entity.positives[0]!,match:["marzo 1989|1989-03"]}]};
    expect(scoreEntity(dated,[assertion("1989-03","https://a.example/1")]).recovered).toBe(1);
    expect(scoreEntity(dated,[assertion("Fundada en marzo de 1989","https://a.example/1")]).recovered).toBe(0);
  });
  it("una cita inválida o descartada no cuenta como documentada",()=>{
    expect(scoreEntity(entity,[assertion("1989","https://a.example/1",false)]).recovered).toBe(0);
    expect(scoreEntity(entity,[assertion("1989","https://a.example/1",true,{destination:"discarded"})]).recovered).toBe(0);
  });
  it("cuenta los negativos emitidos como documentados y no evalúa un denominador vacío",()=>{
    expect(scoreEntity(entity,[assertion("Banda Prueba (Argentina) 1990","https://b.example/2")]).negativeHits).toHaveLength(1);
    expect(summarize([])).toMatchObject({m03Recall:null,m03CriticalRecall:null,m02Traceability:null});
  });
});
