import {createHash} from "node:crypto";
import type {WebPage} from "../ambiguity/web-search.js";
import {sourceMatchesIdentity} from "./source-identity.js";
import {words,canonicalLink,contains,quotedIn,insideInstruction} from "./proof.js";
import {visibleQuote,requiresPdfReread} from "./documents/visibility.js";
import {extractionKey} from "./documents/extraction-key.js";
import type {VerificationProposal} from "./evaluate.js";
import type {ExtractedAssertion,VerificationSnapshot,VerificationFinding} from "./types.js";

function equal(a:string,b:string):boolean{
 if(/^https?:\/\//u.test(a)&&/^https?:\/\//u.test(b)){try{return canonicalLink(a)===canonicalLink(b);}catch{return a===b;}}
 return words(a)===words(b);
}
/**
 * A biography sentence or a record that the source only announces what a band will do (a tour, a festival, a record) does not document that it
 * happened. Future forms are read with or without accents, since fanzines are typed in capitals and OCR drops them.
 */
const PLAN=/\b(?:se (?:estan |estaban )?prepar\p{L}* para|planea\p{L}*|esperan?|esperaban|tienen? (?:previsto|pensado|planeado)|piensan|proyectan|proxim[oa]s? (?:gira|disco|album|grabacion|presentacion|concierto)|posibles? (?:edicion|gira|lanzamiento)|dentro de poco|proximamente|en breve|\p{L}{4,}(?:aran|eran|iran)|\p{L}{3,}(?:ara|era|ira)(?= (?:a|en|por|el|la|los|las) (?:mediados|finales|principios|fines|comienzos|partir)))\b/u;
const fold=(text:string)=>text.normalize("NFD").replace(/\p{M}/gu,"").toLowerCase().replace(/\s+/gu," ");
export const announcesOnly=(quotes:string[])=>quotes.length>0&&quotes.every(quote=>PLAN.test(fold(quote))||/\p{L}{3,}(?:ará|erá|irá|arán|erán|irán)\b/u.test(quote.toLowerCase()));
/** An identity document number (cédula, passport, RIF, social security) printed next to its label: personal data, never a fact for the record. */
const PERSONAL_ID=/(?:cedula|\bc\.? ?i\b\.?|pasaporte|passport|\brif\b|seguro social|social security|\bss ?#)[^\n]{0,40}?\d[\d. -]{4,}\d/u;
// A saved assertion already carries the mark that replaced the number.
export const personalId=(text:string)=>PERSONAL_ID.test(fold(text))||text.includes("[dato personal omitido]");
const redact=(text:string)=>text.replace(/\d[\d. -]{4,}\d/gu,"[dato personal omitido]");
/** A brand that endorses a musician ("artista de Buffet Crampon", "endorsed by") is a sponsor, not a record label. */
const SPONSOR=/\b(?:artista|embajador[a]?|ambassador|endorser|endorsee|patrocinad[oa]s?|sponsored|endorsed|artist)\b(?: \S+){0,2} (?:de|of|by|for)\b|\bpatrocin|\bsponsor/u;
const RECORD_LABEL=/\b(?:sello|label|records|disquera|discografic\p{L}*|discos|music|entertainment)\b/u;
const MONTHS=new Set("ene enero feb febrero mar marzo abr abril may mayo jun junio jul julio ago agosto sep sept septiembre oct octubre nov noviembre dic diciembre jan january february march apr april june july aug august september october november dec december".split(" "));
/** A minitec (DJ party sound system) named in the source: neither a band, a former name nor a release of the record. */
const MINITECA=/\bminitecas?\s+(?:llamad[ao]s?|denominad[ao]s?|conocid[ao]s? como|de nombre)\s+[«“"]?([A-ZÁÉÍÓÚÑ][\p{L}']*(?:\s+(?:de |del |la |el )?[A-ZÁÉÍÓÚÑ][\p{L}']*){0,3})/gu;
/** Releases a page links to (".../album/tierra-de-nadie"), other than the page itself, by the words of their address. */
function linkedReleases(page:WebPage):Set<string>{
 const own=(()=>{try{return new URL(page.url).pathname.replace(/\/$/u,"");}catch{return "";}})();
 return new Set([...page.content.matchAll(/https?:\/\/[^\s·"'<>]+\/(?:album|track|release|disco)\/([a-z0-9-]+)/giu)].filter(match=>{try{return new URL(match[0]).pathname.replace(/\/$/u,"")!==own;}catch{return false;}}).map(match=>words(match[1]!.replace(/-/gu," "))));
}
/**
 * Deterministic checks for kinds of error the model repeats although the instructions forbid them: a sponsor as a label,
 * another release linked from an album's page and a minitec as part of the band.
 * Returns why the assertion is not a fact of this record, or null.
 */
export function contextOnly(snapshot:VerificationSnapshot,pages:WebPage[],item:{area:string|null;value:string|null;evidence:ExtractedAssertion["evidence"]}):string|null{
 const quotes=item.evidence.filter(citation=>citation.valid).map(citation=>citation.quote);
 if(!quotes.length||item.value===null)return null;
 const value=item.value,subject=snapshot.identity.map(words);
 if(item.area==="labels"&&quotes.every(quote=>SPONSOR.test(fold(quote))&&!RECORD_LABEL.test(fold(quote))))return "La marca patrocina o respalda al músico; no es un sello discográfico.";
 if(snapshot.kind==="album"&&(item.area==="discography"||item.area==="missingAlbums")&&!` ${words(value)} `.includes(` ${words(snapshot.name)} `)){
  const title=words(value).split(" ").filter(token=>token&&!MONTHS.has(token)&&!/^(?:19|20)\d\d$/u.test(token)).join(" ");
  if(title&&item.evidence.filter(citation=>citation.valid).every(citation=>{const page=pages[citation.source];return !!page&&linkedReleases(page).has(title);}))return "Otro lanzamiento enlazado desde la página del disco; no es un dato de este disco.";
 }
 const minitecas=[...new Set(pages.flatMap(page=>[...page.content.replace(/\s+/gu," ").matchAll(MINITECA)].map(match=>words(match[1]!))))].filter(name=>name.length>=4&&!subject.includes(name));
 if(minitecas.some(name=>` ${words(value)} `.includes(` ${name} `)))return "Nombra una miniteca de fiestas; no es banda, nombre anterior ni lanzamiento de la ficha.";
 return null;
}
/** Disposition of one citation: literal in a preserved copy, attributed to this identity and visible where the value is read. */
export function assessCitation(snapshot:VerificationSnapshot,pages:WebPage[],citation:{source:number;quote:string},value:string|null):ExtractedAssertion["evidence"][number]{
 const page=pages[citation.source];
 const literal=!!page&&quotedIn(page.content,citation.quote);
 const injected=literal&&insideInstruction(page!.content,citation.quote);
 const identity=literal&&!injected&&sourceMatchesIdentity(snapshot,page!,pages);
 const visible=page?.document?visibleQuote(page.content,page.document.locations,citation.quote):citation.quote;
 const corroborated=!requiresPdfReread(page?.document)&&!(value&&contains(citation.quote,value)&&!contains(visible,value));
 return {source:citation.source,url:page?.url??null,contentHash:page?.contentHash??null,captureId:page?.document?.captureId??null,...(page?.document?{extractionHash:extractionKey(page.document)}:{}),quote:citation.quote,valid:identity&&corroborated,
  reason:!page?"La extracción referencia una fuente inexistente.":!literal?"El fragmento no aparece literalmente en la copia de la fuente.":injected?"La cita está dentro de un texto dirigido a la IA; no es un dato de la fuente.":!identity?"La identidad de la fuente sigue pendiente.":!corroborated?"El valor procede de una capa interna que no está corroborada en su posición visible.":null};
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
  const evidence=item.evidence.map(citation=>assessCitation(snapshot,pages,citation,value));
  const existing=seen.get(id);
  if(existing){for(const citation of evidence)if(!existing.evidence.some(old=>old.source===citation.source&&old.quote===citation.quote))existing.evidence.push(citation);continue;}
  const assertion:ExtractedAssertion={id,kind,key,area,value,context,state:"uncertain",destination:"pending",reason:item.reason||"Falta comprobar el dato y su ámbito.",findingKey:null,evidence};
  if(item.evidence.length&&!evidence.some(citation=>citation.url&&quotedIn(pages[citation.source]?.content??"",citation.quote))){
   assertion.state="invalid";assertion.destination="discarded";assertion.reason="Ninguna cita coincide con una fuente preservada; se conserva la extracción rechazada para revisión.";
  }else if(!evidence.some(citation=>citation.valid)){
   assertion.reason="Falta una cita literal atribuida a esta identidad; la extracción permanece pendiente.";
  }else{
   const finding=key?findings.find(finding=>finding.key===key):undefined;
   const suggestion=suggestions.find(finding=>finding.area===area&&finding.observed!==null&&value!==null&&equal(finding.observed,value)&&(!context.length||finding.context.some(name=>context.some(other=>equal(name,other)))));
   const registered=value!==null&&area!==null?snapshot.units.find(unit=>unit.area===area&&unit.value!==null&&equal(unit.value,value)&&(!context.length||unit.context.some(name=>context.some(other=>equal(name,other)))||!unit.context.length&&context.some(name=>equal(name,snapshot.name)))):undefined;
   const valueBacked=value!==null&&evidence.some(citation=>citation.valid&&contains(citation.quote,value));
   if((area==="biography"||area==="discography"||area==="missingAlbums")&&announcesOnly(evidence.filter(citation=>citation.valid).map(citation=>citation.quote))){
    assertion.state="uncertain";assertion.destination="discarded";assertion.reason="La cita anuncia un plan; no documenta que ocurriera. Se conserva para revisión.";
   }else if(finding?.status==="contradicted"||finding?.conflicted){
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
 for(const assertion of result){
  if(assertion.destination==="discarded"||assertion.state==="invalid")continue;
  const reason=contextOnly(snapshot,pages,assertion);
  if(reason){assertion.state="uncertain";assertion.destination="discarded";assertion.findingKey=null;assertion.reason=`${reason} Se conserva para revisión.`;}
 }
 // Last, once duplicates have merged their citations: the number is masked in the kept record too,
 // so the report never copies it out of the source.
 for(const assertion of result)if(personalId(assertion.value??"")||assertion.evidence.some(citation=>personalId(citation.quote))){
  assertion.state="invalid";assertion.destination="discarded";assertion.findingKey=null;assertion.reason="Contiene el número de un documento de identidad; es un dato personal y no se extrae.";
  if(assertion.value!==null)assertion.value=redact(assertion.value);
  for(const citation of assertion.evidence){citation.quote=redact(citation.quote);citation.valid=false;}
 }
 return result;
}
