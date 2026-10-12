import { hashValue } from "./context.js";
import { orderedOperations, operationRefs } from "./schema.js";
import type { CatalogDraft, CatalogEvidence, CatalogOperation } from "./types.js";

/** Joining independent tasks never replaces another task's same-named operation or citation. */
export function combinePlanningResults(results:Array<{draft:CatalogDraft;evidence:CatalogEvidence[]}>,original:CatalogEvidence[]=[]):{draft:CatalogDraft;evidence:CatalogEvidence[]} {
  const evidence:CatalogEvidence[]=structuredClone(original);
  const operations:CatalogOperation[]=[];
  const unresolved=new Set<string>();
  const summaries:string[]=[];
  const signatures=new Map<string,CatalogOperation>();
  const signature=(item:CatalogEvidence)=>hashValue({url:item.url,quote:item.quote,contentHash:item.contentHash,capturedAt:item.capturedAt??null});
  const sources=new Map(evidence.map(item=>[signature(item),item.id]));
  const usedIds=new Set(evidence.map(item=>item.id));
  let nextId=evidence.length+1;
  for(const result of results){
    const citations=new Map<string,string>();
    for(const item of result.evidence){
      const key=signature(item);
      let id=sources.get(key);
      if(!id){while(usedIds.has(`E${nextId}`))nextId++;id=`E${nextId++}`;usedIds.add(id);evidence.push({...item,id});sources.set(key,id);}
      citations.set(item.id,id);
    }
    const prefix=hashValue(result.draft).slice(0,16);
    const references=new Map<string,string>();
    let ordered:CatalogOperation[];
    try{ordered=orderedOperations(result.draft);}catch{
      ordered=result.draft.operations;
      unresolved.add(`Dependencias pendientes de revisión en el lote ${prefix}.`);
    }
    for(const input of ordered){
      const operation=structuredClone(input);
      operation.key=`${prefix}_${input.key}`;
      for(const ref of operationRefs(operation))if("key" in ref)ref.key=references.get(ref.key)??`${prefix}_${ref.key}`;
      operation.evidenceIds=[...new Set(operation.evidenceIds.map(id=>citations.get(id)??id))];
      const {key:_,label:__,reason:___,evidenceIds:____,...semantic}=operation;
      const key=hashValue(semantic);
      const previous=signatures.get(key);
      if(previous){
        previous.evidenceIds=[...new Set([...previous.evidenceIds,...operation.evidenceIds])];
        references.set(input.key,previous.key);
      }else{signatures.set(key,operation);operations.push(operation);references.set(input.key,operation.key);}
    }
    if(result.draft.summary&&!summaries.includes(result.draft.summary))summaries.push(result.draft.summary);
    result.draft.unresolved.forEach(item=>unresolved.add(item));
  }
  // One task keeps its public operation keys for compatibility with existing callers.
  if(results.length===1){
    const originals=results[0]!.draft.operations;
    const names=new Map(originals.map(op=>[`${hashValue(results[0]!.draft).slice(0,16)}_${op.key}`,op.key]));
    for(const op of operations){op.key=names.get(op.key)??op.key;for(const ref of operationRefs(op))if("key" in ref)ref.key=names.get(ref.key)??ref.key;}
  }
  return {draft:{summary:summaries.join("\n"),operations,unresolved:[...unresolved]},evidence};
}
