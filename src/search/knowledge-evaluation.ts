import { z } from "zod";
const label=z.string().trim().min(1);
export const annotationReviewSchema=z.object({
  id:label,reviewer:label,pass:z.enum(["without_scores_tags","with_context"]),
  object:label,aspect:label,assertionState:label,
  appreciation:z.enum(["liked","disliked","mixed","descriptive"]),
  support:z.enum(["supported","partial","unsupported","uncertain"]),
  alternative:label,translation:z.string().nullable(),reason:label,
}).strict();
export type AnnotationReview=z.infer<typeof annotationReviewSchema>;
const reviewerIdentity=(name:string)=>name.normalize("NFC").replace(/\s+/gu," ").trim().toLocaleLowerCase("es");
/** Agreement and support precision have explicit denominators. A repeat by the
 * same analyst is useful error checking, never independent musical validation. */
export function evaluateAnnotations(first:AnnotationReview[],second:AnnotationReview[]) {
  const baseline=first.map(r=>annotationReviewSchema.parse(r)), reviews=second.map(r=>annotationReviewSchema.parse(r));
  const ids=new Set<string>();
  for(const r of [...baseline]) {if(ids.has(r.id))throw new Error("ID duplicado en primera anotación");ids.add(r.id);}
  ids.clear();for(const r of reviews){if(ids.has(r.id))throw new Error("ID duplicado en segunda anotación");ids.add(r.id);}
  const baselineIds=new Set(baseline.map(r=>r.id));
  // Unrelated supported rows must never inflate precision for this study.
  for(const r of reviews)if(!baselineIds.has(r.id))throw new Error(`Segunda anotación ajena a la muestra: ${r.id}`);
  const pairs=baseline.flatMap(a=>{const b=reviews.find(r=>r.id===a.id);return b?[{a,b}]:[];});
  const fields=["object","aspect","assertionState","appreciation","support"] as const;
  const agreement=Object.fromEntries(fields.map(f=>[f,{agree:pairs.filter(({a,b})=>a[f]===b[f]).length,compared:pairs.length}]));
  const assessable=reviews.filter(r=>r.support!=="uncertain");
  const sameReviewer=({a,b}:{a:AnnotationReview;b:AnnotationReview})=>reviewerIdentity(a.reviewer)===reviewerIdentity(b.reviewer);
  const sameAnalyst=pairs.some(sameReviewer);
  return {independent:false as const,
    differentNamedReviewers:pairs.length>0 && pairs.every(pair=>!sameReviewer(pair)),
    independenceStatus:sameAnalyst?"same_analyst":"requires_provenance_review",
    sameAnalyst,compared:pairs.length,
    missing:baseline.filter(a=>!ids.has(a.id)).map(a=>a.id),agreement,
    supportPrecision:{supported:assessable.filter(r=>r.support==="supported").length,assessable:assessable.length},
    disagreements:pairs.filter(({a,b})=>fields.some(f=>a[f]!==b[f])).map(({a,b})=>({id:a.id,first:a,second:b,adjudication:"required"})),
    publicationAuthorized:false as const};
}
