import { sourceProvenance } from "../evidence/provenance.js";
import {isDecorativeImageUrl} from "../ambiguity/page-images.js";
import {sourceMatchesIdentity} from "./source-identity.js";
import {extractionDispositions} from "./extraction-dispositions.js";
import {calendarAtoms} from "./date-proof.js";
import {visibleQuote,requiresPdfReread} from "./documents/visibility.js";
import {extractionKey} from "./documents/extraction-key.js";
import {formationYears} from "./temporal-proof.js";
import { createHash } from "node:crypto";
import { z } from "zod";
import type { WebPage } from "../ambiguity/web-search.js";
import { isDocumentarilyScored, VERIFICATION_AREAS, type VerificationArea, type VerificationEvidence, type VerificationFinding, type VerificationReport, type VerificationSnapshot, type VerificationUnit } from "./types.js";
import { RULES_VERSION, canonicalLink, trackTitleMatch, fold, words, contains, contextPresent, sourceStrength, sourceCeiling, usablePage, backed, positions, sameValue, releaseBacked, claimContext, albumName,matchesEvidence } from "./proof.js";
export { fold } from "./proof.js";
const sourceIndex=z.preprocess(value=>typeof value==="string"?(/^\d+$/u.test(value)?Number(value):-1):value,z.number().int().min(-1));
const evidenceSchema=z.object({source:sourceIndex,quote:z.string()});
export const verificationProposalSchema=z.object({
  findings:z.array(z.object({key:z.string(),status:z.enum(["confirmed","contradicted","unverified"]),observed:z.string().nullable(),reason:z.string(),evidence:z.array(evidenceSchema)})),
  discoveries:z.array(z.object({area:z.enum(["identity","members","discography","missingAlbums","tracks","socials","genres","status","biography","images","labels"]),value:z.string().min(1),context:z.string(),reason:z.string(),evidence:z.array(evidenceSchema)})).default([]),
});
export type VerificationProposal=z.infer<typeof verificationProposalSchema>;
export function snapshotHash(snapshot:VerificationSnapshot):string {return createHash("sha256").update(JSON.stringify(snapshot)).digest("hex");}
const pageContextCache=new WeakMap<WebPage,{text:string;contexts:Map<string,boolean>}>();
function pageContextMatches(page:WebPage,value:string,identity=false):boolean{
  const text=`${page.title} ${page.content}`;
  let cached=pageContextCache.get(page);
  if(!cached||cached.text!==text){cached={text,contexts:new Map()};pageContextCache.set(page,cached);}
  const key=`${identity?"identity":"context"}:${value}`;
  const old=cached.contexts.get(key);
  if(old!==undefined)return old;
  const result=identity?contains(text,value):contextPresent(text,value);
  cached.contexts.set(key,result);return result;
}
function citations(raw:VerificationProposal["findings"][number]["evidence"],pages:WebPage[],snapshot:VerificationSnapshot,context:string[]):VerificationEvidence[] {
  const found:VerificationEvidence[]=[];
  for(const item of raw) {
    const page=pages[item.source];
    if(page&&requiresPdfReread(page.document))continue;
    if(item.quote.length<8||item.quote.length>1800||!page||!usablePage(page)||!sourceMatchesIdentity(snapshot,page,pages)||!fold(page.content).includes(fold(item.quote)))continue;
    if(!snapshot.identity.some(name=>pageContextMatches(page,name,true))||!context.filter(Boolean).every(value=>pageContextMatches(page,value)))continue;
    if(found.some(e=>e.url===page.url&&fold(e.quote)===fold(item.quote)))continue;
    const offset=page.content.indexOf(item.quote);
    if(page.document&&offset<0)continue;
    const start=offset>=0?Buffer.byteLength(page.content.slice(0,offset),"utf8"):-1,end=start+Buffer.byteLength(item.quote,"utf8");
    const locations=page.document?.locations.filter(location=>location.start<end&&location.end>start)??[];
    if(page.document&&offset>=0&&!locations.length)continue;
    if(locations.length&&locations.every(location=>location.context==="navigation"||location.selector.includes("uncorroborated")))continue;
    found.push({contentHash:page.contentHash,...(page.document?{extractionHash:extractionKey(page.document),captureId:page.document.captureId,locations,requiresOriginalReview:locations.some(location=>location.selector.includes("ocr"))||requiresPdfReread(page.document)||(offset<0&&page.document.method.includes("ocr"))}:{}),url:page.url,title:page.title,quote:item.quote,origin:page.origin??"page",fetchedAt:page.fetchedAt,...sourceProvenance(page)});
  }
  return found;
}
function evidenceForAtom(unit:VerificationUnit,e:VerificationEvidence,page:WebPage,atom:string):boolean {
  if(!releaseBacked(unit,e,page)||!claimContext(unit,e,page))return false;
  if(unit.key==="status.formed"){
    const quote=page.document?visibleQuote(page.content,page.document.locations,e.quote):e.quote;
    if(!formationYears(quote).includes(Number(atom)))return false;
  }
  if(unit.key.endsWith(".order")) {
    const [disc,number]=(unit.value??"").split(".").map(Number);
    return positions(unit,e,page).some(p=>p.disc===disc&&p.number===number);
  }
  if(unit.area==="images") return e.origin==="page" && e.quote.includes(atom);
  if(unit.area==="socials"&&unit.value) {
    try {const target=canonicalLink(unit.value);const candidate=e.quote.match(/https?:\/\/[^\s<>"»]+/gu)??[];return candidate.some(url=>{try{return canonicalLink(url)===target;}catch{return false;}});}catch{return false;}
  }
  if(unit.area==="tracks"&&!unit.key.endsWith(".order")&&/produced by|producer|production|mixed by|mastered by|productor|produccion/iu.test(e.quote)&&!positions(unit,e,page).length)return false;
  if(e.locations?.length){
    const start=page.content.indexOf(e.quote),first=start>=0?Buffer.byteLength(page.content.slice(0,start),"utf8"):0,last=first+Buffer.byteLength(e.quote,"utf8");
    const bytes=Buffer.from(page.content,"utf8");
    const original=e.locations.filter(location=>!location.selector.includes("image-resources")&&!location.selector.includes("uncorroborated")).map(location=>bytes.subarray(Math.max(first,location.start),Math.min(last,location.end)).toString("utf8")).join(" ");
    if(!backed(original,atom)&&!(unit.area==="tracks"&&trackTitleMatch(original,atom)))return false;
  }
  return backed(e.quote,atom)||(unit.area==="tracks"&&trackTitleMatch(e.quote,atom));
}
function atoms(unit:VerificationUnit):string[] {
  if(unit.value&&/(?:birth|death|status\.life|releaseDate)/u.test(unit.key)){
    const dates=calendarAtoms(unit.value);if(dates)return dates;
  }
  if(unit.expected.length)return unit.expected;
  if(unit.area==="biography"&&unit.value) {
    // Comprueba todas las partes de una afirmación, no solo el nombre de la ficha.
    return [...new Set(words(unit.value).split(" ").filter(t=>t.length>=4||/^\d{4}$/u.test(t)))];
  }
  return unit.value?[unit.value]:[];
}
function proof(unit:VerificationUnit,evidence:VerificationEvidence[],pages:WebPage[]):{coverage:number;evidence:VerificationEvidence[]} {
  const required=atoms(unit);if(!required.length)return {coverage:0,evidence:[]};
  const useful=new Set<VerificationEvidence>();
  const sums=required.map(atom=>{
    const support=evidence.filter(e=>{const page=pages.find(p=>matchesEvidence(p,e));return Boolean(page&&evidenceForAtom(unit,e,page,atom));});
    support.forEach(e=>useful.add(e));return sourceStrength(support,pages);
  });
  // La cobertura completa exige respaldo de todos los componentes del dato.
  const complete=evidence.filter(e=>{const page=pages.find(p=>matchesEvidence(p,e));return page&&required.every(atom=>evidenceForAtom(unit,e,page,atom));});
  const coverage=Math.min(sums.reduce((n,v)=>n+v,0)/required.length,sourceStrength(complete,pages)||1);
  return {coverage,evidence:[...useful]};
}
function opposing(unit:VerificationUnit,evidence:VerificationEvidence[],observed:string,pages:WebPage[]):VerificationEvidence[] {
  if(sameValue(unit,observed))return [];
  return evidence.filter(e=>{
    const page=pages.find(p=>matchesEvidence(p,e));if(!page||e.origin!=="page"||e.requiresOriginalReview||sourceCeiling(e.url,e.origin)<.75)return false;
    const visible=page.document?visibleQuote(page.content,page.document.locations,e.quote):e.quote;
    if(!contains(visible,observed)&&!unit.key.endsWith(".order"))return false;
    if(unit.key.endsWith(".order")) {
      const raw=observed.match(/^(?:(\d+)\.)?0*(\d+)$/u);if(!raw)return false;
      return positions(unit,e,page).some(p=>p.number===Number(raw[2])&&(!raw[1]||p.disc===Number(raw[1]))&&(p.disc!==Number(unit.value?.split(".")[0])||p.number!==Number(unit.value?.split(".")[1])));
    }
    if(unit.expected.length===1&&/^\d{4}$/u.test(unit.value??"")&&/^\d{4}$/u.test(observed))return contains(visible,observed)&&!contains(visible,unit.value!);
    // Tipos o nombres distintos no bastan para afirmar incompatibilidad.
    return contains(visible,observed)&&/incorrect|err[oó]neo|no corresponde|no es|instead of|not the|erroneous/iu.test(visible);
  });
}
export function evaluateVerification(snapshot:VerificationSnapshot,pages:WebPage[],proposal:VerificationProposal={findings:[],discoveries:[]},researched=false,limitations:string[]=[]):VerificationReport {
  const findings:VerificationFinding[]=snapshot.units.map(unit=>{
    const options=proposal.findings.filter(item=>item.key===unit.key).map(item=>({item,evidence:citations(item.evidence,pages,snapshot,unit.context)}));
    const all=options.flatMap(o=>o.evidence).filter(e=>unit.area!=="images"||e.origin==="page");
    const support=proof(unit,all,pages);
    const best=options.find(o=>o.item.status==="confirmed")??options[0];
    const observed=best?.item.observed??null;
    const production=unit.area==="tracks"&&!unit.key.endsWith(".order")&&/\btracks?\b/iu.test(unit.value??"")?all.filter(e=>/produced by|mixed by|mastered by|producido por/iu.test(e.quote)&&contains(e.quote,unit.value??"")):[];
    if(production.length)return {...unit,status:"contradicted",observed:"Crédito de producción",explanation:"La fuente identifica este texto como crédito de producción, no como pista del lanzamiento.",coverage:0,evidence:production};
    if(unit.issue)return {...unit,status:"contradicted",observed:null,explanation:unit.issue,coverage:0,evidence:all};
    if(unit.value===null&&unit.key!=="discography.search")return {...unit,status:"missing",observed:all.some(e=>observed&&(unit.area==="images" ? /^https?:\/\//u.test(observed)&&e.quote.includes(observed) : contains(e.quote,observed)))?observed:null,explanation:all.some(e=>observed&&(unit.area==="images" ? /^https?:\/\//u.test(observed)&&e.quote.includes(observed) : contains(e.quote,observed)))&&observed?`Dato ausente en la ficha. Propuesta por revisar: ${observed}.`:"No registrado. Su ausencia no demuestra que la ficha sea incorrecta.",coverage:0,evidence:all};
    // El número observado pertenece al título citado, incluso si la IA marcó confirmed.
    const numbered=unit.key.endsWith(".order")?all.flatMap(e=>{const page=pages.find(p=>matchesEvidence(p,e));if(!page||!claimContext(unit,e,page))return [];const found=positions(unit,e,page);return found.filter(p=>!sameValue(unit,`${p.disc}.${p.number}`)).map(p=>({item:{status:"contradicted" as const,observed:`${p.disc}.${p.number}`},evidence:[e]}));}):[];
    const opposition=[...options,...numbered].flatMap(o=>o.item.status==="contradicted"&&o.item.observed?opposing(unit,o.evidence,o.item.observed,pages):[]);
    const disputed=opposition.length>0&&support.coverage>0;
    if(opposition.length&&!disputed)return {...unit,status:"contradicted",observed:[...options,...numbered].find(o=>o.item.status==="contradicted"&&o.item.observed&&!sameValue(unit,o.item.observed))?.item.observed??null,explanation:"La fuente documenta un valor diferente para el mismo dato. Revisa la edición y la procedencia antes de corregirlo.",coverage:0,evidence:opposition};
    const coverage=disputed?Math.min(support.coverage,.5):support.coverage;
    const status=coverage===1?"confirmed":coverage>0?"partial":"unverified";
    return {...unit,status,conflicted:disputed,observed:coverage>0?unit.value:null,coverage,evidence:disputed?[...support.evidence,...opposition]:support.evidence.length?support.evidence:all,
      explanation:disputed?"Hay respaldo del valor registrado y una discrepancia entre fuentes; no se declara incorrecta la ficha.":coverage===1?"La cita respalda el dato completo para esta ficha. No se exige una segunda fuente para confirmar la coincidencia.":coverage>0?"La evidencia respalda solo parte de la afirmación o procede de un resumen del buscador. Consulta las citas.":"No se obtuvo evidencia suficiente para este dato, contexto y edición. No se presume que sea falso."};
  });
  const suggestions:VerificationFinding[]=[];const seen=new Set<string>();
  for(const item of proposal.discoveries) {
    const evidence=citations(item.evidence,pages,snapshot,item.context?[item.context]:[]);
    if(!evidence.length||!evidence.some(e=>{
      const page=pages.find(page=>matchesEvidence(page,e)),quote=page?.document?visibleQuote(page.content,page.document.locations,e.quote):e.quote;
      return item.area==="images" ? e.origin==="page" && !isDecorativeImageUrl(item.value) && quote.includes(item.value) && /^https?:\/\//u.test(item.value) : contains(quote,item.value);
    }))continue;
    // Un fragmento de una biografía o el rol de una persona ya registrada no es otra ausencia.
    if(snapshot.units.some(u=>u.area===item.area&&(!item.context||u.context.some(c=>words(c)===words(item.context))||(u.context.length===0&&words(snapshot.name)===words(item.context)))&&u.value&&(contains(u.value,item.value)||contains(item.value,u.value))))continue;
    if((item.area==="discography"||item.area==="missingAlbums")&&snapshot.catalogAlbums.some(a=>contains(item.value,a.title)||albumName(item.value)===albumName(a.title)))continue;
    const matching=findings.find(f=>f.status==="missing"&&f.area===item.area&&(f.key==="status.ended"&&words(item.value)==="activo"));
    if(matching){matching.observed=item.value;matching.evidence=evidence;matching.explanation="Estado propuesto por las fuentes; falta registrarlo y comprobar su vigencia.";continue;}
    const signature=`${item.area==="missingAlbums"?"discography":item.area}:${words(item.context)}`;
    const sameDiscoveryValue=(value:string)=>{
      if(item.area==="images")return value===item.value;
      if(item.area==="socials"&&/^https?:\/\//u.test(item.value)&&/^https?:\/\//u.test(value)){
        try{return canonicalLink(value)===canonicalLink(item.value);}catch{return value===item.value;}
      }
      return contains(item.value,value)||contains(value,item.value);
    };
    const duplicate=suggestions.find(s=>s.area===item.area&&words(s.context.join(" "))===words(item.context)&&sameDiscoveryValue(s.observed??""));
    if(duplicate){duplicate.evidence.push(...evidence.filter(e=>!duplicate.evidence.some(old=>old.url===e.url&&old.quote===e.quote)));continue;}
    const key=`${signature}:${item.area==="images"||item.area==="socials"?item.value:words(item.value)}`;if(seen.has(key))continue;seen.add(key);
    suggestions.push({key:`suggested.${suggestions.length}`,area:item.area,label:`Dato por revisar · ${VERIFICATION_AREAS[item.area].label}`,value:null,expected:[],context:item.context?[item.context]:[],issue:null,status:"unverified",observed:item.value,explanation:item.area==="images" ? `Recurso visual documentado; revisa identidad, edición y calidad antes de incorporarlo. ${item.reason}` : "La fuente menciona este dato. Comprueba si es nuevo, correcto y pertinente antes de incorporarlo. No modifica el denominador del puntaje.",coverage:0,evidence});
  }
  const scan=findings.find(f=>f.key==="discography.search");
  if(scan){
    const inventory=proposal.findings.filter(f=>f.key===scan.key).flatMap(f=>citations(f.evidence,pages,snapshot,scan.context));
    const strengths=snapshot.catalogAlbums.map(a=>sourceStrength(inventory.filter(e=>contains(e.quote,a.title)),pages));
    const covered=strengths.filter(v=>v>0);
    scan.coverage=snapshot.catalogAlbums.length?strengths.reduce((n,v)=>n+v,0)/snapshot.catalogAlbums.length:0;
    scan.status=scan.coverage===1?"confirmed":scan.coverage>0?"partial":"unverified";scan.evidence=inventory;
    scan.explanation=`Se cotejaron ${covered.length} de ${snapshot.catalogAlbums.length} títulos registrados con inventarios citados. Esto no demuestra que la discografía sea exhaustiva.`;
  }
  // Ausencia de evidencia y campos vacíos no son desaciertos documentados.
  const eligible=isDocumentarilyScored;
  const keys=[...new Set(findings.map(f=>f.area))];
  const scored=keys.filter(key=>findings.some(f=>f.area===key&&eligible(f)));
  const weight=scored.reduce((n,k)=>n+VERIFICATION_AREAS[k].weight,0);
  const areas=keys.map(key=>{const items=findings.filter(f=>f.area===key),evaluated=items.filter(eligible),maximum=evaluated.length?VERIFICATION_AREAS[key].weight/weight*100:0;return {key,label:VERIFICATION_AREAS[key].label,maximum,points:evaluated.length?evaluated.reduce((n,f)=>n+f.coverage,0)/evaluated.length*maximum:0,confirmed:items.filter(f=>f.status==="confirmed").length,partial:items.filter(f=>f.status==="partial").length,missing:items.filter(f=>f.status==="missing").length,contradicted:items.filter(f=>f.status==="contradicted").length,unverified:items.filter(f=>f.status==="unverified").length};});
  return {version:1,rulesVersion:RULES_VERSION,extractions:extractionDispositions(snapshot,pages,proposal,findings,suggestions),snapshotHash:snapshotHash(snapshot),kind:snapshot.kind,entityId:snapshot.id,name:snapshot.name,createdAt:new Date().toISOString(),researched,stale:false,score:researched&&scored.length?Math.round(areas.reduce((n,a)=>n+a.points,0)*10)/10:null,areas,findings,suggestions,issues:findings.filter(f=>f.issue).map(f=>f.issue!),
    limitations:[...new Set(["El puntaje mide coincidencia documental entre los datos que se pudieron contrastar; no probabilidad de verdad ni exhaustividad de la ficha.","Sin verificar, pendientes, faltantes, propuestas e incoherencias internas sin evidencia externa quedan fuera del cálculo. Sin datos contrastados no hay puntaje.","Una cita completa de una página leída aporta 100 %. Una coincidencia parcial aporta según su cobertura; un resumen del buscador aporta hasta 25 %. La corroboración independiente no es requisito para una coincidencia completa. El OCR requiere revisión del original y aporta como máximo 50 %.","Los pesos de las áreas se redistribuyen entre las áreas con datos contrastados. No encontrar un dato no demuestra que sea falso.",...limitations])],sources:pages.filter(usablePage).map(page=>({url:page.url,title:page.title,origin:page.origin??"page",fetchedAt:page.fetchedAt,contentHash:page.contentHash,...(page.document?{document:{extractionHash:extractionKey(page.document),captureId:page.document.captureId,rawHash:page.document.rawHash,format:page.document.format,method:page.document.method,extractionVersion:page.document.extractionVersion,complete:page.document.complete,unreadParts:page.document.unreadParts,warnings:page.document.warnings}}:{}),...sourceProvenance(page)}))};
}
export function areaLabel(area:VerificationArea):string{return VERIFICATION_AREAS[area].label;}
