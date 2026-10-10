import { retainVerificationEvidence } from "../../src/verification/research-state.js";
import { describe,expect,it } from "vitest";
import { evaluateVerification, type VerificationProposal } from "../../src/verification/evaluate.js";
import type { VerificationSnapshot } from "../../src/verification/types.js";
import type { WebPage } from "../../src/ambiguity/web-search.js";
import { verificationProposalSchema } from "../../src/verification/evaluate.js";
import { type ResearchState, researchVerification } from "../../src/verification/research.js";
import { DeepSeekGateway, MemoryDeepSeekRunStore, MockDeepSeekTransport } from "../../src/ai/gateway.js";

const snapshot:VerificationSnapshot={kind:"artist",id:1,name:"Banda Prueba",identity:["Banda Prueba"],sourceUrls:[],catalogAlbums:[{id:1,title:"Disco Uno",artist:"Banda Prueba",year:2001}],albums:[{id:1,title:"Disco Uno",artist:"Banda Prueba",year:2001}],units:[
  {key:"identity.name",area:"identity",label:"Nombre",value:"Banda Prueba",expected:["Banda Prueba"],context:[],issue:null},
  {key:"album.year",area:"discography",label:"Año de Disco Uno",value:"2001",expected:["2001"],context:["Disco Uno"],issue:null},
  {key:"bio.empty",area:"biography",label:"Biografía",value:null,expected:[],context:[],issue:null},
]};
const page=(url:string,content:string,origin:WebPage["origin"]="page"):WebPage=>({url,title:"Banda Prueba",content,contentHash:url,fetchedAt:"2026-10-07T12:00:00Z",origin});
const first=page("https://official.example/banda","Banda Prueba publicó Disco Uno en 2001. 1. Canción Uno. 2. Canción Dos.");
const second=page("https://archive.example/banda","Disco Uno — Banda Prueba — lanzamiento de 2001.");
const proposal:VerificationProposal={findings:[
  {key:"identity.name",status:"confirmed",observed:"Banda Prueba",reason:"Nombre documentado",evidence:[{source:0,quote:"Banda Prueba publicó Disco Uno en 2001."},{source:1,quote:"Disco Uno — Banda Prueba — lanzamiento de 2001."}]},
  {key:"album.year",status:"confirmed",observed:"2001",reason:"Año documentado",evidence:[{source:0,quote:"Banda Prueba publicó Disco Uno en 2001."},{source:1,quote:"Disco Uno — Banda Prueba — lanzamiento de 2001."}]},
],discoveries:[]};

describe("fiabilidad individual proporcional y basada en citas",()=>{
  it("datos ausentes quedan fuera del cálculo; no inventa un puntaje sin investigación",()=>{
    const local=evaluateVerification(snapshot,[]);expect(local.score).toBeNull();expect(local.findings[2]?.status).toBe("missing");
    const researched=evaluateVerification(snapshot,[first,second],proposal,true);
    expect(researched.findings[0]?.coverage).toBe(1);expect(researched.findings[2]?.coverage).toBe(0);
    expect(researched.score).toBe(100);expect(researched.areas.reduce((n,a)=>n+a.maximum,0)).toBe(100);
  });
  it("una página completa confirma el dato; los resúmenes conservan cobertura limitada",()=>{
    const single={...proposal,findings:proposal.findings.map(f=>({...f,evidence:[f.evidence[0]!]}))};
    expect(evaluateVerification(snapshot,[first],single,true).findings[0]?.coverage).toBe(1);
    const duplicated={...proposal,findings:proposal.findings.map(f=>({...f,evidence:[f.evidence[0]!,{...f.evidence[0]!,source:1}]}))};
    expect(evaluateVerification(snapshot,[first,{...first,url:second.url}],duplicated,true).findings[0]?.coverage).toBe(1);
    expect(evaluateVerification(snapshot,[{...first,origin:"search_snippet"}],single,true).findings[0]?.coverage).toBe(.25);
  });
  it("rechaza citas inventadas, ajenas al contexto o que no prueban el valor",()=>{
    const fabricated={...proposal,findings:proposal.findings.map(f=>({...f,evidence:[{source:0,quote:"La banda publicó un disco en 1999."}]}))};
    expect(evaluateVerification(snapshot,[first],fabricated,true).score).toBeNull();
    const wrong=page(first.url,"Banda Prueba publicó Disco Dos en 2001.");
    const out={...proposal,findings:[{...proposal.findings[1]!,evidence:[{source:0,quote:wrong.content}]}]};
    expect(evaluateVerification(snapshot,[wrong],out,true).findings[1]?.coverage).toBe(0);
    const noYear={...proposal,findings:[{...proposal.findings[1]!,evidence:[{source:0,quote:"Banda Prueba publicó Disco Uno"}]}]};
    expect(evaluateVerification(snapshot,[first],noYear,true).findings[1]?.status).toBe("unverified");
  });
  it("documenta discos faltantes, deduplica descubrimientos y no vuelve a proponer discos presentes",()=>{
    const source=page(first.url,"Banda Prueba: Disco Uno y Disco Dos son discos publicados.");
    const discovery={area:"missingAlbums" as const,value:"Disco Dos",context:"Banda Prueba",reason:"No está en el catálogo",evidence:[{source:0,quote:source.content}]};
    const report=evaluateVerification(snapshot,[source],{findings:[],discoveries:[discovery,discovery,{...discovery,value:"Disco Uno"}]},true);
    const discoveries=report.suggestions??[];expect(discoveries).toHaveLength(1);expect(discoveries[0]).toMatchObject({status:"unverified",observed:"Disco Dos",coverage:0});
    expect(discoveries[0]?.evidence[0]?.url).toBe(first.url);
    const complete={...snapshot,catalogAlbums:[...snapshot.catalogAlbums,{id:2,title:"Disco Dos",artist:"Banda Prueba",year:2002}]};
    expect(evaluateVerification(complete,[source],{findings:[],discoveries:[discovery]},true).suggestions?.length).toBe(0);
    expect(report.findings).toHaveLength(snapshot.units.length);
    expect(report.score).toBe(evaluateVerification(snapshot,[source],undefined,true).score);
  });
  it("compara el número de pista con su título; un número ajeno no confirma el orden",()=>{
    const unit={...snapshot.units[0]!,key:"track.1.order",area:"tracks" as const,value:"1.2",expected:["Canción Uno","2"],context:["Disco Uno"]};
    const snap={...snapshot,units:[unit]};
    const claim={key:unit.key,status:"confirmed" as const,observed:"1.2",reason:"Orden",evidence:[{source:0,quote:first.content}]};
    expect(evaluateVerification(snap,[first],{findings:[claim],discoveries:[]},true).findings[0]?.coverage).toBe(0);
    unit.value="1.1";unit.expected[1]="1";
    expect(evaluateVerification(snap,[first],{findings:[claim],discoveries:[]},true).findings[0]?.coverage).toBe(1);
  });
  it("una contradicción comprobada o incoherencia interna no recibe puntos",()=>{
    const source=page(first.url,"Banda Prueba publicó Disco Uno en 2002.");
    const report=evaluateVerification(snapshot,[source],{findings:[{...proposal.findings[1]!,status:"contradicted",observed:"2002",evidence:[{source:0,quote:source.content}]}],discoveries:[]},true);
    expect(report.findings[1]).toMatchObject({status:"contradicted",coverage:0,observed:"2002"});
    expect(evaluateVerification({...snapshot,units:[{...snapshot.units[0]!,issue:"Periodo invertido"}]},[],undefined,true).findings[0]?.status).toBe("contradicted");
  });
  it("evalúa todos los datos en lotes, también más allá de los primeros 40",async()=>{
    const units=Array.from({length:49},(_,n)=>({...snapshot.units[0]!,key:`identity.${n}`}));
    const transport=new MockDeepSeekTransport(...Array.from({length:7},(_,batch)=>({findings:units.slice(batch*8,batch*8+8).map(u=>({key:u.key,status:"unverified",observed:null,reason:"Sin respaldo suficiente",evidence:[]})),discoveries:[]})),{findings:[],discoveries:[]});
    const gateway=new DeepSeekGateway({baseUrl:"https://example.com",models:{fast:"mock",reasoning:"mock",vision:"mock"},maxTokens:4096,timeoutMs:1000},transport,new MemoryDeepSeekRunStore());
    const report=await researchVerification({...snapshot,units,sourceUrls:[first.url]},{search:async()=>[],page:async()=>first},gateway);
    expect(report.findings).toHaveLength(49);expect(transport.requests).toHaveLength(8);
    expect(transport.requests[6]?.user).toContain("identity.48");
  });
  it("una cita demasiado corta no descarta el resto del lote",()=>{
    const withShort={...proposal,findings:proposal.findings.map(item=>({...item,evidence:[...item.evidence,{source:0,quote:"2001"}]}))};
    expect(evaluateVerification(snapshot,[first,second],withShort,true).score).toBe(100);
  });
  it("una búsqueda fallida conserva el informe con datos pendientes y su limitación",async()=>{
    const report=await researchVerification(snapshot,{search:async()=>{throw new Error("buscador caído");},page:async()=>null});
    expect(report.researched).toBe(true);expect(report.score).toBeNull();expect(report.findings[0]?.status).toBe("unverified");expect(report.limitations.some(l=>l.includes("No se pudo completar"))).toBe(true);
  });
  it("publica avance por etapas y guarda todos los lotes en checkpoints proporcionales",async()=>{
    const units=Array.from({length:49},(_,n)=>({...snapshot.units[0]!,key:`identity.${n}`}));
    const transport=new MockDeepSeekTransport(...Array.from({length:7},(_,batch)=>({findings:units.slice(batch*8,batch*8+8).map(u=>({key:u.key,status:"unverified",observed:null,reason:"Sin respaldo suficiente",evidence:[]})),discoveries:[]})),{findings:[],discoveries:[]});
    const gateway=new DeepSeekGateway({baseUrl:"https://example.com",models:{fast:"mock",reasoning:"mock",vision:"mock"},maxTokens:4096,timeoutMs:1000},transport,new MemoryDeepSeekRunStore());
    const updates:Array<{phase:string;completed:number;total:number;evaluated:number;checkpoint?:boolean}>=[];
    await researchVerification({...snapshot,units,sourceUrls:[first.url]},{search:async()=>[],page:async()=>first},gateway,async(progress,checkpoint)=>{
      updates.push({...progress,...(checkpoint?{checkpoint:checkpoint.inProgress??false}:{})});
      if(checkpoint?.inProgress){expect(checkpoint.findings).toHaveLength(49);expect(checkpoint.score).toBeNull();}
    });
    const collecting=updates.filter(u=>u.phase==="collecting");
    expect(collecting[0]?.completed).toBe(0);expect(collecting.at(-1)?.completed).toBe(collecting.at(-1)?.total);
    const batches=updates.filter(u=>u.checkpoint===true);
    expect(batches).toHaveLength(8);expect(batches.at(-1)?.evaluated).toBe(49);
    expect(updates.at(-1)).toMatchObject({phase:"saving",completed:50,total:50,checkpoint:false});
  });
  it("normaliza 01–09 y conserva el DVD como segundo soporte sin falsas contradicciones",()=>{
    const source=page("https://archive.example/edicion","Banda Prueba Disco Uno Tracks CD 01- Canción Uno 02- Canción Dos DVD 10- Oscar D’ León 11- Grandmaster 12- L.A. Viaje 2");
    source.title="Banda Prueba Disco Uno (CD Info)";
    for(const [title,disc,position] of [["Canción Uno",1,1],["Canción Dos",1,2],["Oscar D’ León",2,10],["Grandmaster",2,11],["L.A. Viaje 2",2,12]] as const){
      const unit={...snapshot.units[0]!,key:"track.1.order",area:"tracks" as const,value:`${disc}.${position}`,expected:[title,String(position)],context:["Disco Uno"]};
      const report=evaluateVerification({...snapshot,units:[unit]},[source],{findings:[{key:unit.key,status:"contradicted",observed:unit.value,reason:"Orden incorrecto",evidence:[{source:0,quote:source.content}]}],discoveries:[]},true);
      expect(report.findings[0]).toMatchObject({status:"confirmed",coverage:1,observed:unit.value});
    }
    const wrong={...snapshot.units[0]!,key:"track.2.order",area:"tracks" as const,value:"1.10",expected:["Oscar D’ León","10"],context:["Disco Uno"]};
    expect(evaluateVerification({...snapshot,units:[wrong]},[source],{findings:[{key:wrong.key,status:"confirmed",observed:wrong.value,reason:"",evidence:[{source:0,quote:source.content}]}],discoveries:[]},true).score).toBe(0);
  });
  it("una pista en un álbum no confirma un lanzamiento independiente ni una cita ajena corrobora el título",()=>{
    const source=page("https://archive.example/album","Banda Prueba Harakiri City 02 Sin Avisar 1996");
    const unrelated=page("https://other.example/bio","Banda Prueba ha publicado El Martillo y Cloroformo.");
    const unit={...snapshot.units[0]!,key:"album.2.title",area:"discography" as const,value:"Sin Avisar",expected:["Sin Avisar","Banda Prueba"]};
    const claim={key:unit.key,status:"confirmed" as const,observed:unit.value,reason:"",evidence:[{source:0,quote:source.content},{source:1,quote:unrelated.content}]};
    expect(evaluateVerification({...snapshot,units:[unit]},[source,unrelated],{findings:[claim],discoveries:[]},true).findings[0]?.coverage).toBe(0);
    const actual=page("https://official.example/single","Banda Prueba publicó el sencillo Sin Avisar en 1996.");
    expect(evaluateVerification({...snapshot,units:[unit]},[actual,unrelated],{findings:[{...claim,evidence:[{source:0,quote:actual.content},{source:1,quote:unrelated.content}]}],discoveries:[]},true).findings[0]?.coverage).toBe(1);
  });
  it("agrupa plataformas y versiones idiomáticas y excluye páginas bloqueadas",()=>{
    const left=page("https://www.deezer.com/album/1","Banda Prueba publicó Disco Uno en 2001.");
    const right=page("https://music.apple.com/album/2","Disco Uno — Banda Prueba — lanzamiento de 2001.");
    expect(evaluateVerification(snapshot,[left,right],proposal,true).findings[1]?.coverage).toBe(1);
    expect(evaluateVerification(snapshot,[{...left,title:"Client Challenge"}],proposal,true).sources).toHaveLength(0);
  });
  it("acepta índices numéricos serializados sin perder el lote",()=>{
    expect(verificationProposalSchema.parse({findings:[{...proposal.findings[0],evidence:[{source:"0",quote:first.content}]}]}).findings[0]?.evidence[0]?.source).toBe(0);
  });
  it("una referencia al propio catálogo no descarta los demás datos ni se acepta como cita externa",()=>{
    const parsed=verificationProposalSchema.parse({findings:[{...proposal.findings[0],evidence:[{source:"catalogAlbums",quote:first.content}]},proposal.findings[1]]});
    expect(parsed.findings).toHaveLength(2);
    expect(evaluateVerification(snapshot,[first,second],parsed,true).findings[0]?.coverage).toBe(0);
    expect(evaluateVerification(snapshot,[first,second],parsed,true).findings[1]?.coverage).toBe(1);
  });
  it("reintenta omisiones y retoma solo los datos pendientes conservando las citas",async()=>{
    const units=snapshot.units.slice(0,2);
    const transport=new MockDeepSeekTransport({findings:[proposal.findings[0]],discoveries:[]},{findings:[],discoveries:[]},{findings:[],discoveries:[]});
    const gateway=new DeepSeekGateway({baseUrl:"https://example.com",models:{fast:"mock",reasoning:"mock",vision:"mock"},maxTokens:4096,timeoutMs:1000},transport,new MemoryDeepSeekRunStore());
    let stored:ResearchState|undefined;
    const report=await researchVerification({...snapshot,units,sourceUrls:[first.url]},{search:async()=>[],page:async()=>first},gateway,undefined,{onState:async state=>{stored=state;}});
    expect(report.evaluation).toMatchObject({processed:1,pendingKeys:["album.year"],complete:false});
    expect(transport.requests).toHaveLength(3);
    const retry=new MockDeepSeekTransport({findings:[{...proposal.findings[1],evidence:[proposal.findings[1]!.evidence[0]]}],discoveries:[]});
    const retryGateway=new DeepSeekGateway({baseUrl:"https://example.com",models:{fast:"mock",reasoning:"mock",vision:"mock"},maxTokens:4096,timeoutMs:1000},retry,new MemoryDeepSeekRunStore());
    const finished=await researchVerification({...snapshot,units},{search:async()=>{throw new Error("No debe repetir búsquedas");},page:async()=>null},retryGateway,undefined,{resume:stored!});
    expect(finished.evaluation).toMatchObject({processed:2,pendingKeys:[],complete:true});
    expect(finished.findings.every(f=>f.coverage===1)).toBe(true);
    expect(retry.requests[0]?.user).toContain('"key":"album.year"');
    expect(finished.limitations.some(l=>l.startsWith("Lote "))).toBe(false);
  });

  it("excluye desconocidos y ausencias sin diluir las coincidencias; una discrepancia documentada sí reduce el puntaje",()=>{
    const unknown={...snapshot.units[0]!,key:"genre.unknown",area:"genres" as const,value:"Electrónica",expected:["Electrónica"]};
    const report=evaluateVerification({...snapshot,units:[...snapshot.units,unknown]},[first],{...proposal,findings:[{...proposal.findings[0]!,evidence:[proposal.findings[0]!.evidence[0]!]}]},true);
    expect(report.score).toBe(100);expect(report.areas.find(a=>a.key==="genres")?.maximum).toBe(0);
    const bad=page(second.url,"Banda Prueba publicó Disco Uno en 2002.");
    const disputed=evaluateVerification(snapshot,[first,bad],{findings:[{...proposal.findings[0]!,evidence:[proposal.findings[0]!.evidence[0]!]},{...proposal.findings[1]!,status:"contradicted",observed:"2002",evidence:[{source:1,quote:bad.content}]}],discoveries:[]},true);
    expect(disputed.score).toBe(50);
    expect(evaluateVerification(snapshot,[],undefined,true).score).toBeNull();
  });
  it("confirma géneros concatenados, traducciones y tildes con una sola página",()=>{
    for(const [value,quote] of [["Rock","Género(s) Rock"],["Pop rock","Soft rockPop Rock"],["Rock alternativo","una banda de rock alternativo originaria de Caracas"],["Rock alternativo","an alternative rock band"],["Electrónica","Género: Electronica"]]){
      const unit={...snapshot.units[0]!,key:"genre.test",area:"genres" as const,value:value!,expected:[value!]};
      const source=page(first.url,`Banda Prueba: ${quote}`);
      const result=evaluateVerification({...snapshot,units:[unit]},[source],{findings:[{key:unit.key,status:"confirmed",observed:value!,reason:"",evidence:[{source:0,quote:source.content}]}],discoveries:[]},true);
      expect(result.findings[0]).toMatchObject({status:"confirmed",coverage:1});expect(result.score).toBe(100);
    }
  });
  it("un enlace con seguimiento es el mismo recurso; parámetros de identidad diferentes no lo son",()=>{
    const value="https://open.spotify.com/artist/34OLInsXImlQpjzmQw9Wd3";
    const unit={...snapshot.units[0]!,key:"platform.spotify",area:"socials" as const,value,expected:[value]};
    const source=page(first.url,`Banda Prueba Spotify ${value}?si=vnJ2ibMVTm-igzrITP-IEw`);
    const claim={key:unit.key,status:"confirmed" as const,observed:value,reason:"",evidence:[{source:0,quote:source.content}]};
    expect(evaluateVerification({...snapshot,units:[unit]},[source],{findings:[claim],discoveries:[]},true).findings[0]).toMatchObject({status:"confirmed",coverage:1});
    const other={...unit,value:"https://catalog.example/artist?id=1",expected:["https://catalog.example/artist?id=1"]};
    const otherPage=page(first.url,"Banda Prueba https://catalog.example/artist?id=2");
    expect(evaluateVerification({...snapshot,units:[other]},[otherPage],{findings:[{...claim,key:other.key,evidence:[{source:0,quote:otherPage.content}]}],discoveries:[]},true).score).toBeNull();
  });
  it("un rol completo recibe 100 %; un rol compuesto parcialmente citado conserva cobertura parcial",()=>{
    const source=page(first.url,"Banda Prueba Drums: Alfonso Tosta. Lead Vocals: Asier Cazalis.");
    const unit={...snapshot.units[0]!,key:"member.1.role",area:"members" as const,value:"Drums",expected:["Drums"],context:["Alfonso Tosta"]};
    const claim={key:unit.key,status:"confirmed" as const,observed:unit.value,reason:"",evidence:[{source:0,quote:source.content}]};
    expect(evaluateVerification({...snapshot,units:[unit]},[source],{findings:[claim],discoveries:[]},true).findings[0]?.coverage).toBe(1);
    const compound={...unit,value:"Lead Vocals & Guitar",expected:["Lead Vocals","Guitar"],context:["Asier Cazalis"]};
    expect(evaluateVerification({...snapshot,units:[compound]},[source],{findings:[claim],discoveries:[]},true).findings[0]).toMatchObject({status:"partial",coverage:.5});
  });

  it("no confunde el formato CD/DVD de la cabecera con el inicio del DVD",()=>{
    const source=page(first.url,"Banda Prueba Disco Uno Independent Rock 2009 (CD/DVD) Tracks 01- Canción Uno 02- Canción Dos DVD 01- Capítulo Uno");source.title="Banda Prueba Disco Uno (CD Info)";
    const unit={...snapshot.units[0]!,key:"track.1.order",area:"tracks" as const,value:"1.1",expected:["Canción Uno","1"],context:["Disco Uno"]};
    const claim={key:unit.key,status:"confirmed" as const,observed:unit.value,reason:"",evidence:[{source:0,quote:"01- Canción Uno"}]};
    expect(evaluateVerification({...snapshot,units:[unit]},[source],{findings:[claim],discoveries:[]},true).findings[0]?.coverage).toBe(1);
  });
  it("conserva el encabezado de álbum inmediatamente anterior a la cita",()=>{
    const source=page(first.url,"Banda Prueba LAS PATICAS DE LA ABUELA Tracks 04- Nadando a Través De La Galaxia");
    const unit={...snapshot.units[0]!,key:"track.1",area:"tracks" as const,value:"Nadando a Través De La Galaxia",expected:["Nadando a Través De La Galaxia"],context:["Banda Prueba","Las Paticas De La Abuela"]};
    const claim={key:unit.key,status:"confirmed" as const,observed:unit.value,reason:"",evidence:[{source:0,quote:"Tracks 04- Nadando a Través De La Galaxia"}]};
    expect(evaluateVerification({...snapshot,units:[unit]},[source],{findings:[claim],discoveries:[]},true).findings[0]?.coverage).toBe(1);
  });

  it("recupera separadores perdidos entre canciones y admite puntuación antes del título",()=>{
    const source=page(first.url,"Banda Prueba Disco Uno 1. El Mar2. Sanitarios3. Las Notas4. ¡Cuídalo!");source.title="Banda Prueba Disco Uno";
    for(const [value,position] of [["Las Notas",3],["¡Cuídalo!",4]] as const){
      const title={...snapshot.units[0]!,key:"track.1",area:"tracks" as const,value,expected:[value],context:["Disco Uno"]};
      const order={...title,key:"track.1.order",value:`1.${position}`,expected:[value,String(position)]};
      const findings=[title,order].map(u=>({key:u.key,status:"confirmed" as const,observed:u.value,reason:"",evidence:[{source:0,quote:source.content}]}));
      expect(evaluateVerification({...snapshot,units:[title,order]},[source],{findings,discoveries:[]},true).findings.every(f=>f.coverage===1)).toBe(true);
    }
  });
  it("un listado explícito de álbumes sí documenta el lanzamiento",()=>{
    const source=page(first.url,"Banda Prueba: entre sus álbumes más destacados figuran Disco Uno (2001) y Disco Dos (2002).");
    const unit={...snapshot.units[0]!,key:"album.1.title",area:"discography" as const,value:"Disco Uno",expected:["Disco Uno","Banda Prueba"]};
    expect(evaluateVerification({...snapshot,units:[unit]},[source],{findings:[{key:unit.key,status:"confirmed",observed:unit.value,reason:"",evidence:[{source:0,quote:source.content}]}],discoveries:[]},true).findings[0]?.coverage).toBe(1);
  });

  it("una canción homónima en otro álbum no contradice el orden de un sencillo",()=>{
    const unit={...snapshot.units[0]!,key:"track.1.order",area:"tracks" as const,value:"1.1",expected:["Canción Uno","1"],context:["Banda Prueba","Canción Uno"]};
    const source=page("https://www.deezer.com/artist/1","Disco Uno 01 Intro Banda Prueba Disco Uno 02 Canción Uno Banda Prueba Disco Uno");
    expect(evaluateVerification({...snapshot,units:[unit]},[source],{findings:[{key:unit.key,status:"confirmed",observed:unit.value,reason:"",evidence:[{source:0,quote:source.content}]}],discoveries:[]},true).findings[0]?.status).toBe("unverified");
  });
  it("detecta un orden distinto documentado aunque la propuesta de IA lo marque confirmado",()=>{
    const unit={...snapshot.units[0]!,key:"track.1.order",area:"tracks" as const,value:"1.1",expected:["Canción Uno","1"],context:["Disco Uno"]};
    const source=page(first.url,"Banda Prueba Disco Uno 02- Canción Uno");
    expect(evaluateVerification({...snapshot,units:[unit]},[source],{findings:[{key:unit.key,status:"confirmed",observed:unit.value,reason:"",evidence:[{source:0,quote:source.content}]}],discoveries:[]},true).findings[0]).toMatchObject({status:"contradicted",coverage:0,observed:"1.2"});
  });

  it("un crédito de producción introducido como pista es una discrepancia documentada",()=>{
    const value="Joe Blaney, Dan Monti & Ghian Wright (tracks 1, 5, 6, 9)";
    const unit={...snapshot.units[0]!,key:"track.1",area:"tracks" as const,value,expected:[value],context:["Disco Uno"]};
    const source=page(first.url,`Banda Prueba Disco Uno Produced by ${value}`);
    expect(evaluateVerification({...snapshot,units:[unit]},[source],{findings:[{key:unit.key,status:"unverified",observed:null,reason:"Crédito",evidence:[{source:0,quote:source.content}]}],discoveries:[]},true).findings[0]).toMatchObject({status:"contradicted",coverage:0,observed:"Crédito de producción"});
  });

  it("conserva citas anteriores válidas y remapea sus fuentes; no conserva citas retiradas de una página actualizada",()=>{
    const old:ResearchState={rulesVersion:3,pages:[first],proposal:{...proposal,findings:[{...proposal.findings[0]!,evidence:[proposal.findings[0]!.evidence[0]!]}]},pendingKeys:[],limitations:[],attempts:1};
    const latest:ResearchState={...old,pages:[second],proposal:{findings:[],discoveries:[]},limitations:[]};
    expect(retainVerificationEvidence(snapshot,old,latest)).toBe(1);
    expect(latest.proposal.findings[0]?.evidence[0]?.source).toBe(1);
    expect(evaluateVerification(snapshot,latest.pages,latest.proposal,true).findings[0]?.coverage).toBe(1);
    expect(retainVerificationEvidence(snapshot,old,latest)).toBe(0);
    const changed={...latest,pages:[{...first,content:"Banda Prueba cambió los datos de esta página."}],proposal:{findings:[],discoveries:[]}};
    expect(retainVerificationEvidence(snapshot,old,changed)).toBe(0);
  });

  it("normaliza el orden global de las caras A y B sin inventar una discrepancia",()=>{
    const source=page(first.url,"Banda Prueba Disco Uno Side A 01- Primero 02- Segundo 03- Tercero Side B 01- Cuarto 02- Quinto");source.title="Banda Prueba Disco Uno (LP Info)";
    const unit={...snapshot.units[0]!,key:"track.1.order",area:"tracks" as const,value:"1.4",expected:["Cuarto","4"],context:["Disco Uno"]};
    expect(evaluateVerification({...snapshot,units:[unit]},[source],{findings:[{key:unit.key,status:"confirmed",observed:unit.value,reason:"",evidence:[{source:0,quote:"Side B 01- Cuarto 02- Quinto"}]}],discoveries:[]},true).findings[0]).toMatchObject({status:"confirmed",coverage:1});
  });

  it("normaliza espacios en títulos compuestos conservando números de versiones",()=>{
    const source=page(first.url,"Banda Prueba Disco Uno 01- Mr. Baby Sister 02- Canción");source.title="Banda Prueba Disco Uno";
    const unit={...snapshot.units[0]!,key:"track.1",area:"tracks" as const,value:"Mr. Babysister",expected:["Mr. Babysister"],context:["Disco Uno"]};
    const claim={key:unit.key,status:"confirmed" as const,observed:unit.value,reason:"",evidence:[{source:0,quote:source.content}]};
    expect(evaluateVerification({...snapshot,units:[unit]},[source],{findings:[claim],discoveries:[]},true).findings[0]?.coverage).toBe(1);
    expect(evaluateVerification({...snapshot,units:[{...unit,value:"Canción 2",expected:["Canción 2"]}]},[source],{findings:[claim],discoveries:[]},true).findings[0]?.status).toBe("unverified");
  });

  it("busca portadas, fotos, géneros por disco, sellos, alias y cronología personal",async()=>{
    const queries:string[]=[];
    await researchVerification({...snapshot,kind:"person"},{search:async query=>{queries.push(query);return [];},page:async()=>null});
    expect(queries.some(q=>q.includes("foto artista perfil alta resolución"))).toBe(true);
    expect(queries.some(q=>q.includes('"Disco Uno"')&&q.includes("portada cover artwork"))).toBe(true);
    expect(queries.some(q=>q.includes('"Disco Uno"')&&q.includes("géneros genre sello label"))).toBe(true);
    expect(queries.some(q=>q.includes("nacimiento fallecimiento"))).toBe(true);
    expect(queries.some(q=>q.includes("alias AKA"))).toBe(true);
    expect(queries.some(q=>q.includes("tracklist credits"))).toBe(true);
  });
  it("conserva géneros y sellos iguales documentados para discos distintos",()=>{
    const existing={...snapshot.units[0]!,key:"album.1.genre.rock",area:"genres" as const,value:"Rock",expected:["Rock"],context:["Banda Prueba","Disco Uno"]};
    const source=page(first.url,"Banda Prueba Disco Dos Género Rock Sello Independiente");
    const discoveries=[{area:"genres" as const,value:"Rock",context:"Disco Dos",reason:"Género del disco",evidence:[{source:0,quote:source.content}]},{area:"labels" as const,value:"Rock",context:"Disco Dos",reason:"Sello",evidence:[{source:0,quote:source.content}]}];
    const report=evaluateVerification({...snapshot,units:[existing]},[source],{findings:[],discoveries},true);
    expect(report.suggestions).toHaveLength(2);
    expect(report.suggestions?.map(s=>s.area)).toEqual(["genres","labels"]);
  });
  it("exige URL literal de imagen y página leída, y conserva las limitaciones de calidad",()=>{
    const url="https://media.example/disco.jpg";
    const source=page(first.url,`Banda Prueba Disco Uno Imagen: Portada Disco Uno | URL: ${url} | Dimensiones declaradas: 1600 × 1600 px`);
    const discovery={area:"images" as const,value:url,context:"Disco Uno",reason:"1600 px declarados; nitidez pendiente de revisión",evidence:[{source:0,quote:source.content}]};
    const report=evaluateVerification(snapshot,[source],{findings:[],discoveries:[discovery]},true);
    expect(report.suggestions?.[0]).toMatchObject({area:"images",observed:url});
    expect(report.suggestions?.[0]?.explanation).toContain("nitidez pendiente");
    expect(evaluateVerification(snapshot,[{...source,origin:"search_snippet"}],{findings:[],discoveries:[discovery]},true).suggestions).toEqual([]);
    expect(evaluateVerification(snapshot,[source],{findings:[],discoveries:[{...discovery,value:"https://media.example/inventada.jpg"}]},true).suggestions).toEqual([]);
  });

});
