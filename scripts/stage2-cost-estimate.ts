import { readFile } from "node:fs/promises";
import { parse } from "dotenv";
// Estimación sin red ni modelo del costo de reprocesar copias preservadas (solo lectura).
const env=parse(await readFile(".env"));
const url=new URL(env["DATABASE_URL"]!);url.searchParams.set("options","-c default_transaction_read_only=on");
process.env["DATABASE_URL"]=url.href;
const {closeDb}=await import("../src/db/client.js");
const {loadVerificationSnapshot}=await import("../src/verification/snapshot.js");
const {preservedReportState}=await import("../src/verification/history.js");
const {fullSourceChunks}=await import("../src/verification/research.js");
const {readingPlan}=await import("../src/verification/evaluation-plan.js");
const {sourceMatchesIdentity}=await import("../src/verification/source-identity.js");
const {requiresPdfReread}=await import("../src/verification/documents/visibility.js");
const cases=JSON.parse(process.argv[2]??"[]") as Array<[number,number]>;
try{
 for(const [id,version] of cases){
  const snapshot=await loadVerificationSnapshot("artist",id);
  const state=await preservedReportState("artist",id,version);
  const eligible=state.pages.map((page,source)=>({page,source})).filter(({page})=>sourceMatchesIdentity(snapshot,page,state.pages)&&!requiresPdfReread(page.document));
  const chunks=eligible.flatMap(({page,source})=>fullSourceChunks(page).map((content,part)=>({source,page,content,key:`${page.url}:${page.contentHash}:${part}`})));
  const chars=chunks.reduce((n,c)=>n+c.content.length,0);
  const plan=readingPlan(snapshot,snapshot.units,chunks);
  const calls=plan.calls.length;
  // Fragmentos (~3,2 caracteres/token) + instrucciones (~2.500) + unidades y datos registrados de cada llamada; salida ≈1.500 tokens.
  const tokensIn=plan.calls.reduce((n,c)=>n+c.chunks.reduce((m,k)=>m+k.content.length,0)/3.2+2500+JSON.stringify(c.units.map(({area:_a,issue:_i,...u})=>u)).length/3.2+(c.extract?JSON.stringify(c.known.map(u=>({area:u.area,value:u.value,context:u.context}))).length/3.2+JSON.stringify(snapshot.catalogAlbums).length/3.2:0),0);
  const tokensOut=calls*1500;
  console.log(JSON.stringify({id,name:snapshot.name,units:snapshot.units.length,pages:state.pages.length,eligible:eligible.length,chunks:chunks.length,chars,unsupportedUnits:plan.unsupported.length,calls,extractCalls:plan.calls.filter(c=>c.extract).length,approxTokensIn:Math.round(tokensIn),approxTokensOut:tokensOut,approxUsd:+(tokensIn/1e6*0.3+tokensOut/1e6*1.2).toFixed(2)}));
 }
}finally{await closeDb();}
