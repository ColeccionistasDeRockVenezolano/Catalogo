// Plan 20/20 · etapa 2: clasifica por qué se pierde cada positivo de una medición del corpus (reglas actuales, sin modelo).
// Uso: npx tsx scripts/stage2-corpus-misses.ts <development-d1|reserved-r1|…>
import { readFile } from "node:fs/promises";
const R=process.cwd();
const {closeDb}=await import(R+"/src/db/client.js");
const {loadVerificationSnapshot}=await import(R+"/src/verification/snapshot.js");
const {assessCitation}=await import(R+"/src/verification/extraction-dispositions.js");
const {sourceMatchesIdentity}=await import(R+"/src/verification/source-identity.js");
const {words,fold}=await import(R+"/src/verification/proof.js");
const dir=R+"/reports/plan-20-de-20/etapa-2/corpus-measure/corpus-v1/"+(process.argv[2]??"development-d1");
const L=JSON.parse(await readFile(R+"/reports/plan-20-de-20/corpus-v1/labels.json","utf8"));
const part=dir.includes("reserved")?"reserved":"development";
const has=(t:string,m:string)=>m.split("|").some(alt=>` ${words(t)} `.includes(` ${words(alt)} `));
const all=(t:string,ms:string[])=>ms.every(m=>has(t,m));
const cats:Record<string,number>={};const examples:Record<string,string[]>={};
for(const e of L.entities.filter((x:any)=>x.partition===part)){
  const saved=JSON.parse(await readFile(`${dir}/${e.kind}-${e.id}.json`,"utf8"));
  const pages=await Promise.all(e.documents.map(async(d:any)=>JSON.parse(await readFile(R+"/reports/plan-20-de-20/corpus-v1/"+d.file,"utf8"))));
  const snap=await loadVerificationSnapshot(e.kind,e.id);
  const urlOf=new Map(e.documents.map((d:any)=>[d.id,d.url]));
  for(const p of e.positives){
    const url=urlOf.get(p.documentId);const pi=pages.findIndex((x:any)=>x.url===url);const page=pages[pi];
    const items=saved.extractions.map((it:any)=>({...it,evidence:it.evidence.map((c:any)=>assessCitation(snap,pages,c,it.value))}));
    const text=(it:any)=>[it.value??"",...it.context,it.key??""].join(" ");
    const ok=items.some((it:any)=>it.state!=="invalid"&&it.destination!=="discarded"&&it.evidence.some((c:any)=>c.valid&&c.url===url)&&all(text(it),p.match));
    if(ok)continue;
    let cat:string;
    const idOk=page?sourceMatchesIdentity(snap,page,pages):false;
    const quoteIn=page?fold(page.content).includes(fold(p.quote??"")):false;
    const mentioned=items.filter((it:any)=>all(text(it),p.match));
    const fromDoc=mentioned.filter((it:any)=>it.evidence.some((c:any)=>c.url===url));
    if(!idOk)cat="identidad de la fuente rechazada";
    else if(!fromDoc.length&&mentioned.length)cat="extraído pero citado de otra fuente";
    else if(!fromDoc.length)cat="no extraído (el modelo no lo emitió)";
    else if(fromDoc.some((it:any)=>it.evidence.some((c:any)=>c.url===url&&c.reason==="El fragmento no aparece literalmente en la copia de la fuente.")))cat="cita no literal";
    else if(fromDoc.some((it:any)=>it.evidence.some((c:any)=>c.url===url&&!c.valid)))cat="cita inválida (capa interna/PDF)";
    else cat="extraído con cita válida pero descartado";
    if(!quoteIn)cat+=" [la cita etiquetada no está literal]";
    cats[cat]=(cats[cat]??0)+1;(examples[cat]??=[]).push(`${p.id}${p.critical?"*":""} ${e.name}: ${p.match.join(" + ")}`);
  }
}
console.log(JSON.stringify(cats,null,1));
for(const [k,v] of Object.entries(examples))console.log("\n##",k,"\n"+v.slice(0,60).join("\n"));
await closeDb();
