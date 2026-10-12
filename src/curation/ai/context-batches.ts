import { createHash } from "node:crypto";
import type { CatalogEvidence } from "./types.js";

interface FindingContext {
  key:string;
  area:string;
  context?:string[];
  evidenceIds:string[];
  [field:string]:unknown;
}
interface ReportContext {
  pending:FindingContext[];
  [field:string]:unknown;
}
export interface PlanningBatch {
  key:string;
  findingKeys:string[];
  context:Record<string,unknown>;
  evidence:CatalogEvidence[];
}

/** Task contexts retain complete findings and citations, with only the neighbourhood they need. */
export function planningBatches(context:Record<string,unknown>,evidence:CatalogEvidence[],maxChars:number):PlanningBatch[] {
  const report=context["report"] as ReportContext|null;
  const units=report?.pending??[];
  const base={...context,report:null,evidence:[]};
  const batches:PlanningBatch[]=[];
  const used=new Set<string>();
  const render=(pending:FindingContext[],citations:CatalogEvidence[]):PlanningBatch=>{
    const citationIds=new Set(citations.map(item=>item.id));
    const needsNarrative=pending.some(unit=>unit.area==="biography")||(!pending.length&&/biograf|narrativ|text|descrip/iu.test(String(context["instruction"])));
    const current=context["current"] as Record<string,unknown>|undefined;
    const row=current?.["row"] as Record<string,unknown>|undefined;
    const task:Record<string,unknown>={...base,
      // Full narrative remains in the inventory, loaded only by narrative tasks.
      narrativeOriginals:needsNarrative?context["narrativeOriginals"]:{availableByCatalogLookup:true},
      current:{row,selectedEntity:current?.["selectedEntity"],selectedMembership:current?.["selectedMembership"],relations:{availableByCatalogLookup:true}},
      relatedEntities:context["relatedEntities"],findings:[],claims:[],
      report:report?{...report,pending:pending.map(unit=>({...unit,evidenceIds:unit.evidenceIds.filter(id=>citationIds.has(id))})),omitted:0}:null,evidence:citations,
    };
    // Neighbour labels are read tools, not documentary evidence. The full graph
    // stays in the catalog and can be fetched by kind/id without another search.
    if(JSON.stringify(task).length>maxChars)task["relatedEntities"]=[];
    const key=createHash("sha256").update(JSON.stringify(task)).digest("hex");
    return {key,findingKeys:pending.map(unit=>unit.key),context:task,evidence:citations};
  };
  const evidenceFor=(pending:FindingContext[])=>{
    const ids=new Set(pending.flatMap(unit=>unit.evidenceIds));
    return evidence.filter(item=>ids.has(item.id));
  };
  let pending:FindingContext[]=[];
  for(const unit of units){
    const next=[...pending,unit];
    const candidate=render(next,evidenceFor(next));
    if(pending.length&&JSON.stringify(candidate.context).length>maxChars){
      const batch=render(pending,evidenceFor(pending));batches.push(batch);batch.evidence.forEach(item=>used.add(item.id));pending=[unit];
    }else pending=next;
  }
  if(pending.length){const batch=render(pending,evidenceFor(pending));batches.push(batch);batch.evidence.forEach(item=>used.add(item.id));}
  // Claim citations without a review item are still visited, even for an empty report.
  let citations:CatalogEvidence[]=[];
  for(const item of evidence.filter(item=>!used.has(item.id))){
    const next=[...citations,item];
    if(citations.length&&JSON.stringify(render([],next).context).length>maxChars){batches.push(render([],citations));citations=[item];}
    else citations=next;
  }
  if(citations.length)batches.push(render([],citations));
  if(!batches.length)batches.push(render([],[]));
  const expanded:PlanningBatch[]=[];
  for(const batch of batches){
    if(JSON.stringify(batch.context).length<=maxChars||batch.findingKeys.length!==1||batch.evidence.length<2){expanded.push(batch);continue;}
    const unit=units.find(unit=>unit.key===batch.findingKeys[0])!;
    let group:CatalogEvidence[]=[];
    for(const citation of batch.evidence){
      if(group.length&&JSON.stringify(render([unit],[...group,citation]).context).length>maxChars){expanded.push(render([unit],group));group=[citation];}
      else group.push(citation);
    }
    if(group.length)expanded.push(render([unit],group));
  }
  return expanded;
}
