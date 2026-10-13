import {createHash} from "node:crypto";
import type {WebPage} from "../ambiguity/web-search.js";
import {sourceMatchesIdentity} from "./source-identity.js";
import {words,canonicalLink,contains} from "./proof.js";
import {visibleQuote,requiresPdfReread} from "./documents/visibility.js";
import {extractionKey} from "./documents/extraction-key.js";
import type {VerificationProposal} from "./evaluate.js";
import type {ExtractedAssertion,VerificationSnapshot,VerificationFinding} from "./types.js";

function equal(a:string,b:string):boolean{
 if(/^https?:\/\//u.test(a)&&/^https?:\/\//u.test(b)){try{return canonicalLink(a)===canonicalLink(b);}catch{return a===b;}}
 return words(a)===words(b);
}
/** Every extracted assertion remains addressable, including rejected citations
 * and values that have no compatible writer yet. This does not measure recall.
 */
export function extractionDispositions(snapshot:VerificationSnapshot,pages:WebPage[],proposal:VerificationProposal,findings:VerificationFinding[],suggestions:VerificationFinding[]):ExtractedAssertion[]{
 const result:ExtractedAssertion[]=[],seen=new Map<string,ExtractedAssertion>();
 const raw=[...proposal.findings.map(item=>({kind:"finding" as const,item})),...proposal.discoveries.map(item=>({kind:"discovery" as const,item}))];
 for(const {kind,item} of raw){
  const key="key" in item?item.key:null,unit=key?snapshot.units.find(unit=>unit.key===key):undefined;
  const value="value" in item?item.value:item.observed,area="area" in item?item.area:unit?.area??null;
  const context="context" in item?(item.context?[item.context]:[]):unit?.context??[];
  const id=createHash("sha256").update(JSON.stringify([kind,key,area,value,context])).digest("hex");
  const evidence=item.evidence.map(citation=>{
   const page=pages[citation.source];
   const literal=!!page&&citation.quote.trim().length>0&&page.content.includes(citation.quote);
   const identity=literal&&sourceMatchesIdentity(snapshot,page!,pages);
   const visible=page?.document?visibleQuote(page.content,page.document.locations,citation.quote):citation.quote;
   const corroborated=!requiresPdfReread(page?.document)&&!(value&&contains(citation.quote,value)&&!contains(visible,value));
   return {source:citation.source,url:page?.url??null,contentHash:page?.contentHash??null,captureId:page?.document?.captureId??null,...(page?.document?{extractionHash:extractionKey(page.document)}:{}),quote:citation.quote,valid:identity&&corroborated,
    reason:!page?"La extracción referencia una fuente inexistente.":!literal?"El fragmento no aparece literalmente en la copia de la fuente.":!identity?"La identidad de la fuente sigue pendiente.":!corroborated?"El valor procede de una capa interna que no está corroborada en su posición visible.":null};
  });
  const existing=seen.get(id);
  if(existing){for(const citation of evidence)if(!existing.evidence.some(old=>old.source===citation.source&&old.quote===citation.quote))existing.evidence.push(citation);continue;}
  const assertion:ExtractedAssertion={id,kind,key,area,value,context,state:"uncertain",destination:"pending",reason:item.reason||"Falta comprobar el dato y su ámbito.",findingKey:null,evidence};
  if(item.evidence.length&&!evidence.some(citation=>citation.url&&pages[citation.source]?.content.includes(citation.quote)&&citation.quote.trim())){
   assertion.state="invalid";assertion.destination="discarded";assertion.reason="Ninguna cita coincide con una fuente preservada; se conserva la extracción rechazada para revisión.";
  }else if(!evidence.some(citation=>citation.valid)){
   assertion.reason="Falta una cita literal atribuida a esta identidad; la extracción permanece pendiente.";
  }else{
   const finding=key?findings.find(finding=>finding.key===key):undefined;
   const suggestion=suggestions.find(finding=>finding.area===area&&finding.observed!==null&&value!==null&&equal(finding.observed,value)&&(!context.length||finding.context.some(name=>context.some(other=>equal(name,other)))));
   const registered=value!==null&&area!==null?snapshot.units.find(unit=>unit.area===area&&unit.value!==null&&equal(unit.value,value)&&(!context.length||unit.context.some(name=>context.some(other=>equal(name,other)))||!unit.context.length&&context.some(name=>equal(name,snapshot.name)))):undefined;
   const valueBacked=value!==null&&evidence.some(citation=>citation.valid&&contains(citation.quote,value));
   if(finding?.status==="contradicted"||finding?.conflicted){
    assertion.state="contradicted";assertion.destination="conflict";assertion.findingKey=finding.key;assertion.reason=finding.explanation;
   }else if(registered){
    assertion.state=valueBacked?"supported":"uncertain";assertion.destination="already_present";assertion.findingKey=registered.key;assertion.reason=valueBacked?"El mismo valor y ámbito ya figuran en la ficha; se conservan sus citas adicionales.":"El valor ya está registrado; su respaldo específico sigue pendiente y no se declara comprobado.";
   }else if(suggestion||finding?.observed&&finding.evidence.length){
    assertion.state="supported";assertion.destination="proposal";assertion.findingKey=(suggestion??finding)!.key;assertion.reason="El dato está disponible en el hallazgo citado para preparar y revisar su propuesta.";
   }else{
    assertion.reason="Se conserva el dato con su fuente; falta resolver su ámbito, respaldo específico o un campo/operación compatible.";
   }
  }
  seen.set(id,assertion);result.push(assertion);
 }
 return result;
}
