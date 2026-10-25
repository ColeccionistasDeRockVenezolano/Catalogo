import { hashValue } from "./context.js";
import { orderedOperations, operationRefs } from "./schema.js";
import type { CatalogDraft, CatalogEvidence, CatalogOperation } from "./types.js";

function scopedOperationKey(prefix:string,key:string):string {
  const full=`t${prefix.replace(/[^a-zA-Z0-9_-]/gu,"_")}_${key}`;
  return full.length<=40?full:`${full.slice(0,27)}_${hashValue(full).slice(0,12)}`;
}

/** Joining independent tasks never replaces another task's same-named operation or citation. */
export function combinePlanningResults(results:Array<{draft:CatalogDraft;evidence:CatalogEvidence[];taskKey?:string}>,original:CatalogEvidence[]=[]):{draft:CatalogDraft;evidence:CatalogEvidence[]} {
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
    const prefix=(result.taskKey??hashValue(result.draft)).slice(0,16);
    const references=new Map<string,string>();
    let ordered:CatalogOperation[];
    try{ordered=orderedOperations(result.draft);}catch{
      ordered=result.draft.operations;
      unresolved.add(`Dependencias pendientes de revisión en el lote ${prefix}.`);
    }
    for(const input of ordered){
      const operation=structuredClone(input);
      operation.key=scopedOperationKey(prefix,input.key);
      for(const ref of operationRefs(operation))if("key" in ref)ref.key=references.get(ref.key)??scopedOperationKey(prefix,ref.key);
      operation.evidenceIds=[...new Set(operation.evidenceIds.map(id=>citations.get(id)??id))];
      const {key:_,label:__,reason:___,evidenceIds:____,...semantic}=operation;
      const key=hashValue(semantic);
      const previous=signatures.get(key);
      if(previous){
        // The full source set stays in evidence; the public operation contract accepts eight direct citations.
        previous.evidenceIds=[...new Set([...previous.evidenceIds,...operation.evidenceIds])].slice(0,8);
        references.set(input.key,previous.key);
      }else{signatures.set(key,operation);operations.push(operation);references.set(input.key,operation.key);}
    }
    if(result.draft.summary&&!summaries.includes(result.draft.summary))summaries.push(result.draft.summary);
    result.draft.unresolved.forEach(item=>unresolved.add(item));
  }
  // One task keeps its public operation keys for compatibility with existing callers.
  if(results.length===1&&!results[0]!.taskKey){
    const originals=results[0]!.draft.operations;
    const names=new Map(originals.map(op=>[scopedOperationKey((results[0]!.taskKey??hashValue(results[0]!.draft)).slice(0,16),op.key),op.key]));
    for(const op of operations){op.key=names.get(op.key)??op.key;for(const ref of operationRefs(op))if("key" in ref)ref.key=names.get(ref.key)??ref.key;}
  }
  const joined=summaries.join("\n");
  const summary=joined.length<=1500?joined:`${joined.slice(0,1460)}\n[Resumen de ${results.length} lotes; ver operaciones.]`;
  return {draft:{summary:summary.slice(0,1500),operations,unresolved:[...unresolved]},evidence};
}
