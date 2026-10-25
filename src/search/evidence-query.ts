import { z } from "zod";
import { intentionSchema } from "./contracts.js";
import { annotationSchema, type KnowledgeAnnotation } from "./knowledge-contracts.js";

const text=z.string().trim().min(1);
export const evidenceQuerySchema=z.object({
  version:z.literal("crv-evidence-query-v1"),planOrigin:z.enum(["authored_development_plan","legacy_parser","laya_parser"]),intention:intentionSchema,
  unit:annotationSchema.shape.object,listeningCondition:text.nullable(),
  comparisons:z.array(z.object({conditionId:text,referenceName:text,aspect:z.enum(["voice","guitars","production","composition","atmosphere"]),direction:z.enum(["resembles","differs","more","less"]),period:text.nullable()}).strict()),
}).strict().superRefine((q,ctx)=>{
  const ids=q.intention.conditions.map(c=>c.id);
  if(ids.some(id=>!id.trim())||new Set(ids).size!==ids.length)ctx.addIssue({code:"custom",message:"Cada condición necesita ID único"});
  if(new Set(q.comparisons.map(c=>c.conditionId)).size!==q.comparisons.length)ctx.addIssue({code:"custom",message:"Comparación duplicada"});
  for(const b of q.comparisons)if(!ids.includes(b.conditionId)||!q.intention.entities.some(e=>e.role==="reference"&&e.name===b.referenceName))ctx.addIssue({code:"custom",message:"Comparación sin condición o referencia explícita"});
  for(const e of q.intention.entities.filter(e=>e.role==="reference"))if(!q.comparisons.some(b=>b.referenceName===e.name))ctx.addIssue({code:"custom",message:"Referencia de consulta sin condición de parecido"});
  const groups=new Map<string,Set<string>>();
  for(const c of q.intention.conditions)if(c.alternativeGroup!==null){
    if(!c.alternativeGroup.trim())ctx.addIssue({code:"custom",message:"Grupo OR vacío"});
    const modes=groups.get(c.alternativeGroup)??new Set<string>();modes.add(c.mode);groups.set(c.alternativeGroup,modes);
  }
  if([...groups.values()].some(m=>m.size!==1))ctx.addIssue({code:"custom",message:"Un grupo OR no mezcla requisitos, preferencias y exclusiones"});
});
export type EvidenceQuery=z.infer<typeof evidenceQuerySchema>;
type Condition=EvidenceQuery["intention"]["conditions"][number];
type State="supported"|"contradicted"|"conflicted"|"unknown";
function sameIdentity(a:KnowledgeAnnotation["object"],b:EvidenceQuery["unit"]){
  return a.kind===b.kind&&a.id===b.id&&a.name===b.name&&a.resolution===b.resolution
    && ["resolved","external"].includes(a.resolution);
}
function sameScope(a:KnowledgeAnnotation,q:EvidenceQuery){
  return sameIdentity(a.object,q.unit)&&a.object.version===q.unit.version&&a.object.segment===q.unit.segment&&a.assertion.listeningCondition===q.listeningCondition;
}
function conceptMatches(a:KnowledgeAnnotation,c:Condition){
  return a.assertion.value===c.value && (c.axis!==null?a.proposal?.axis===c.axis:
    a.proposal?.facet===c.facet||(!a.proposal&&`candidate:${a.assertion.aspect}`===c.facet));
}
function blockers(a:KnowledgeAnnotation,c:Condition,q:EvidenceQuery):string[]{
  const reasons:string[]=[];
  if(c.status!=="recognized")reasons.push("condition_unresolved");
  if(!sameScope(a,q))reasons.push("different_unit_version_segment_or_listening_condition");
  if(c.scope!==q.unit.kind&&!(c.scope==="listener"&&a.assertion.type==="experience"))reasons.push("condition_scope_mismatch");
  if(!a.proposal)reasons.push("evaluation_only_no_attribute");
  if(a.assertion.type==="taste")reasons.push("taste_is_not_attribute_evidence");
  if(!["affirmed","negated"].includes(a.assertion.state))reasons.push("assertion_state_not_support");
  if(c.axis==="activity"&&!["declared_use","explicit_recommendation"].includes(a.assertion.activityBasis??""))reasons.push("activity_requires_specific_evidence");
  if(c.axis==="energy"&&a.analysis.methodVersion!=="perceived-energy-v1")reasons.push("existing_energy_method_required");
  const binding=q.comparisons.find(b=>b.conditionId===c.id);
  if(a.comparison){
    if(!binding)reasons.push("comparison_requirement_missing");
    if(!["resolved","external"].includes(a.comparison.reference.resolution))reasons.push("comparison_reference_unresolved");
    if(a.comparison.aspect==="other")reasons.push("comparison_aspect_unresolved");
    if(binding){
      const reference=q.intention.entities.find(e=>e.role==="reference"&&e.name===binding.referenceName);
      if(!reference||a.comparison.reference.name!==reference.name||a.comparison.reference.id!==reference.id||a.comparison.reference.kind!==reference.kind)reasons.push("comparison_reference_mismatch");
      if(a.comparison.aspect!==binding.aspect||a.comparison.direction!==binding.direction||a.comparison.period!==binding.period)reasons.push("comparison_aspect_direction_or_period_mismatch");
    }
  }else if(binding)reasons.push("comparison_evidence_missing");
  return reasons;
}
function absenceBlockers(a:KnowledgeAnnotation,q:EvidenceQuery){
  return [...(a.assertion.coverage!=="complete"?["absence_without_complete_scope_coverage"]:[]),
    ...(q.unit.version===null?["absence_version_unresolved"]:[])];
}
/** An offline analytical check over attributed claims, not authorization, a
 * live catalog lookup, a parser, a prevalence estimate, or a published ranking.
 * Ratings, community tags and genre definitions never satisfy a condition. */
export function evaluateEvidenceQuery(input:unknown,source:unknown[]){
  const q=evidenceQuerySchema.parse(input),annotations=source.map(a=>annotationSchema.parse(a));
  if(new Set(annotations.map(a=>`${a.study}:${a.id}`)).size!==annotations.length)throw new Error("Anotación duplicada en el lote de consulta");
  const entityProblems=q.intention.entities.filter(e=>!["resolved","external"].includes(e.resolution)).map(e=>`entity_unresolved:${e.role}:${e.name}`);
  for(const target of q.intention.entities.filter(e=>e.role==="target"))if(target.kind!==q.unit.kind||target.id!==q.unit.id||target.name!==q.unit.name)entityProblems.push(`target_mismatch:${target.name}`);
  if(!["resolved","external"].includes(q.unit.resolution))entityProblems.push("unit_identity_unresolved");
  const conditions=q.intention.conditions.map(c=>{
    const relevant=annotations.filter(a=>conceptMatches(a,c));
    const evidence=relevant.map(a=>{
      const reasons=blockers(a,c,q);
      const polarity=a.comparison?.polarity??(a.assertion.state==="negated"?"negated":"affirmed");
      const agrees=c.mode==="excluded"?polarity==="negated":polarity==="affirmed";
      // Negated evidence cannot satisfy an exclusion or establish whole-unit
      // contradiction unless its own complete scope and version are documented.
      if(polarity==="negated")reasons.push(...absenceBlockers(a,q));
      return {id:a.id,study:a.study,object:a.object,source:a.observation.source,locator:a.observation.locator,quote:a.observation.quote,
        assertionState:a.assertion.state,appreciation:a.assertion.appreciation,reviewId:a.observation.reviewId,account:a.observation.account,evidenceChain:a.evidenceChain,dependencies:a.dependencies,
        role:reasons.length?"unusable":agrees?"support":"counterevidence",reasons};
    });
    const supporting=evidence.filter(e=>e.role==="support"),counter=evidence.filter(e=>e.role==="counterevidence");
    const state:State=supporting.length?(counter.length?"conflicted":"supported"):counter.length?"contradicted":"unknown";
    const preferences=new Set(supporting.map(e=>e.appreciation));
    return {id:c.id,axis:c.axis,facet:c.facet,value:c.value,sourceText:c.sourceText,mode:c.mode,scope:c.scope,alternativeGroup:c.alternativeGroup,recognition:c.status,state,evidence,
      supportingIds:supporting.map(e=>e.id),counterevidenceIds:counter.map(e=>e.id),
      opposedAppreciations:preferences.has("liked")&&preferences.has("disliked"),
      distinctSupportingAccounts:new Set(supporting.map(e=>e.account).filter(Boolean)).size,
      evidenceChains:new Set(supporting.map(e=>e.evidenceChain)).size,
      uncertainty:[...(q.unit.version===null?["version_unknown_attributed_only"]:[]),...(state==="unknown"?["no_adequate_evidence_for_this_condition"]:[])]};
  });
  const groupMap=new Map<string,typeof conditions>();
  for(const c of conditions){const key=c.alternativeGroup===null?`condition:${c.id}`:`or:${c.alternativeGroup}`;groupMap.set(key,[...(groupMap.get(key)??[]),c]);}
  const groups=[...groupMap].map(([id,rows])=>{
    const state:State=rows.some(r=>r.state==="supported")?"supported":rows.every(r=>r.state==="contradicted")?"contradicted":rows.some(r=>r.state==="conflicted")?"conflicted":"unknown";
    return {id,operator:rows[0]!.alternativeGroup===null?"SINGLE":"OR",mode:rows[0]!.mode,conditionIds:rows.map(c=>c.id),state};
  });
  const hard=groups.filter(g=>g.mode!=="preferred"),unresolved=entityProblems.length>0||q.intention.pending.length>0
    ||["ambiguous","unrecognized","out_of_scope","unavailable"].includes(q.intention.interpretation);
  const status=unresolved?"unresolved":hard.some(g=>g.state==="contradicted")?"not_supported":hard.some(g=>g.state==="conflicted")?"conflicted":hard.some(g=>g.state==="unknown")?"unresolved":
    hard.length?"supported_as_attributed":conditions.length?"preference_only":"direct_lookup";
  return {version:q.version,planOrigin:q.planOrigin,unit:q.unit,listeningCondition:q.listeningCondition,intention:q.intention,status,conditions,groups,
    entityProblems,pending:q.intention.pending,combination:"AND_between_groups_OR_within_named_group",publicationAuthorized:false,
    liveIdentityChecked:false,independence:"undetermined",communityAndGenreWitnessesAdded:0,
    limitation:"Resultado de desarrollo sobre afirmaciones atribuidas. No acredita etiquetas, ausencia universal, consenso ni resultados del buscador público."};
}
