import {createHash} from "node:crypto";
import {badRequest} from "../api/http-errors.js";
import type {ResearchState} from "./research.js";
import type {VerificationReport} from "./types.js";
import {extractionKey} from "./documents/extraction-key.js";

const hash=(content:string)=>createHash("sha256").update(content).digest("hex");

/** Old search failures sometimes stored an empty marker with the snippet's hash.
 * Only uncited, empty search markers may be removed. The original stays intact.
 */
export function normalizePreservedState(input:ResearchState,report:Pick<VerificationReport,"sources"|"findings"|"suggestions">):ResearchState{
 const state=structuredClone(input),referenced=new Set<number>();
 for(const claim of [...state.proposal.findings,...state.proposal.discoveries]){
  for(const citation of claim.evidence){
   if(state.pages[citation.source])referenced.add(citation.source);
  }
 }
 const remap=new Map<number,number>(),removed:Array<{index:number;url:string;contentHash:string}>=[];
 const pages:ResearchState["pages"]=[];
 for(const [index,page] of state.pages.entries()){
  if(hash(page.content)!==page.contentHash){
   const reportReference=[...report.findings,...report.suggestions??[]].some(finding=>finding.evidence.some(citation=>citation.url===page.url&&(!citation.contentHash||citation.contentHash===page.contentHash)));
   if(page.content!==""||page.origin!=="search_snippet"||referenced.has(index)||reportReference)
    throw badRequest(`La copia preservada de ${page.url} no coincide con su hash; no se reprocesa una versión alterada.`);
   removed.push({index,url:page.url,contentHash:page.contentHash});continue;
  }
  remap.set(index,pages.length);pages.push(page);
 }
 for(const source of report.sources){
  if(!pages.some(page=>page.url===source.url&&page.contentHash===source.contentHash&&
   (page.capturedAt??null)===(source.capturedAt??null)&&
   (page.acquisitionMethod??(page.origin==="search_snippet"?"search_snippet":"unknown"))===(source.acquisitionMethod??(source.origin==="search_snippet"?"search_snippet":"unknown"))&&
   (!source.document?.extractionHash||page.document&&extractionKey(page.document)===source.document.extractionHash)))
   throw badRequest(`No se conserva una copia exacta de ${source.url} para esta versión.`);
 }
 for(const claim of [...state.proposal.findings,...state.proposal.discoveries]){
  for(const citation of claim.evidence)citation.source=remap.get(citation.source)??citation.source;
 }
 state.pages=pages;
 if(removed.length){
  state.normalizations=[...state.normalizations??[],...removed.map(marker=>({...marker,reason:"legacy_empty_uncited_search_marker" as const}))];
  state.limitations.push(`Se omitieron ${removed.length} marcadores históricos de búsqueda vacíos, sin citas ni hechos asociados y con hash inconsistente; se conserva su registro y la copia original.`);
 }
 return state;
}
