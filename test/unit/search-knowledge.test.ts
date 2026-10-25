import { evaluateAnnotations, type AnnotationReview } from "../../src/search/knowledge-evaluation.js";
import { describe, it, expect } from "vitest";
import { annotationSchema, analyzePattern, assignmentBlockers } from "../../src/search/knowledge-contracts.js";
import { extractReviews, selectReviews, type ExtractedReview } from "../../src/search/review-protocol.js";
import { feedBatchSchema, feedKey } from "../../src/search/knowledge-feed.js";
import { knowledgeFixture } from "../support/knowledge-fixture.js";

describe("conocimiento musical: evidencia y alcance",()=>{
  it("separa gusto, afirmación, puntuaciones y tres capas; no publica recurrencia",()=>{
    const rows=[1,2,3].map(i=>{const a=knowledgeFixture();a.id=String(i);a.observation.account=`account-${i}`;a.observation.reviewId=String(i);a.evidenceChain=`chain-${i}`;return a;});
    rows[1]!.assertion.appreciation="liked"; rows[2]!.assertion.appreciation="disliked";
    const result=analyzePattern(rows);
    expect(result.states).toContain("provisional_recurrence");expect(result.states).toContain("relevant_disagreement");expect(result.publicationAuthorized).toBe(false);
    rows[2]!.evidenceChain="chain-1";expect(analyzePattern(rows).states).not.toContain("provisional_recurrence");
  });
  it("no cuenta afirmaciones como testigos, ni silencio como ausencia",()=>{
    const a=knowledgeFixture();expect(analyzePattern([a,{...a,id:"other-claim"}]).distinctAccounts).toBe(1);
    a.assertion.state="negated";a.assertion.coverage="partial";
    expect(analyzePattern([a]).states).not.toContain("scoped_explicit_absence");expect(assignmentBlockers(a)).toContain("absence_without_scope_coverage");
  });
  it("rechaza mezcla de pistas/versiones/condiciones y no deriva actividad desde emoción",()=>{
    const a=knowledgeFixture(), b=knowledgeFixture();b.object.id=2;expect(()=>analyzePattern([a,b])).toThrow(/mismo objeto/);
    a.proposal.axis="activity";a.proposal.facet=null;a.assertion.activityBasis="style_inference";
    expect(assignmentBlockers(a)).toContain("activity_without_specific_evidence");
    a.proposal.axis="energy";expect(assignmentBlockers(a)).toContain("energy_method_required");
  });
  it("excluye shoutbox, identidades resueltas sin prueba y escalas inválidas",()=>{
    const a=knowledgeFixture();a.observation.resourceId="R16";expect(annotationSchema.safeParse(a).success).toBe(false);
    a.observation.resourceId="R05";a.object.identityEvidence=[];expect(annotationSchema.safeParse(a).success).toBe(false);
    a.object.identityEvidence=["link"];a.layers.individualRating={value:6,minimum:0,maximum:5,object:"album"};expect(annotationSchema.safeParse(a).success).toBe(false);
  });
  it("mantiene referencia externa por aspecto sin crear un artista",()=>{
    const a=knowledgeFixture();a.comparison={reference:{kind:"artist",id:null,name:"30 Seconds to Mars",resolution:"external",identityEvidence:["documented reference"],version:null,segment:null},aspect:"voice",direction:"resembles",polarity:"negated",period:null};
    expect(annotationSchema.parse(a).comparison?.reference.id).toBeNull();
    a.comparison.reference.resolution="pending";expect(assignmentBlockers(a)).toContain("comparison_reference_unresolved");
  });
  it("clave idempotente por fuente/objeto/huella/versiones y lote coherente",()=>{
    const a=knowledgeFixture();const b=feedBatchSchema.parse({resourceId:"R05",sourceObject:"album-1",captureHash:a.observation.captureHash,extractorVersion:"test-v1",schemaVersion:a.version,annotations:[a]});
    expect(feedKey(b)).toBe(feedKey(structuredClone(b)));expect(feedKey({...b,extractorVersion:"v2"})).not.toBe(feedKey(b));
    b.annotations[0]!.observation.captureHash="b".repeat(64);expect(feedBatchSchema.safeParse(b).success).toBe(false);
  });
});

describe("protocolo reproducible de reseñas",()=>{
  it("recupera autor/fecha y spans anidados sin notas de pista en el texto",()=>{
    const html='<div id="review_shell_std_12"><div class="review_user"><a class="user">Reseñista</a></div><div class="review_date" content="2026-10-16"><a href="/music-review/test/12">fecha</a></div><div class="review_rating" content="4"></div><div class="review_body"><div itemprop="description">Guitarras <span>fuzz <em>al frente</em></span>.</div><div id="review_track_rating_12"><div class="rendered_text">NOTA DE PISTA</div></div></div></div>';
    const rows=extractReviews({html,source:"fixture",capturedAt:"2026-10-16T12:00:00Z",release:"album",page:1});
    expect(rows).toHaveLength(1);expect(rows[0]!.account).toBe("Reseñista");expect(rows[0]!.visibleDate).toBe("2026-10-16");
    expect(rows[0]!.text).toBe("Guitarras fuzz al frente.");expect(rows[0]!.locator).toContain("review_shell_std_12");expect(rows[0]!.rating).toBe(4);
  });
  const row=(id:number,page:number,rating:number|null):ExtractedReview=>({id:String(id),page,rating,release:"album",text:`text-${id}`,textHash:`hash-${id}`,account:`a-${id}`,visibleDate:null,url:null,captureHash:"a".repeat(64),capturedAt:"2026-10-16T12:00:00Z",source:"local",locator:"review",extractorVersion:"test",flags:[],trackRatings:[]});
  it("lee todas hasta veinte, y extremos por página más estrato sin nota",()=>{
    const rows=Array.from({length:22},(_,i)=>row(i+1,i<11?1:2,i%5));rows.push(row(23,1,null));
    const s=selectReviews(rows);expect(s.selected.some(r=>r.id==="23")).toBe(true);expect(s.selected.filter(r=>r.page===2)).toHaveLength(2);expect(s.multiPageEligible).toBe(true);expect(s.populationPrevalenceAllowed).toBe(false);
    expect(selectReviews(rows.slice(0,20)).selected).toHaveLength(20);
  });
  it("capturas repetidas no amplían muestra; conserva revisiones y duplicados",()=>{
    const a=row(1,1,2), b={...a,capturedAt:"2026-10-17T12:00:00Z",textHash:"revised"};
    const c={...b,id:"2",account:"other"};const s=selectReviews([a,b,c]);
    expect(s.uniqueReviewIds).toBe(2);expect(s.revisions).toHaveLength(1);expect(s.duplicates).toEqual([["1","2"]]);expect(s.multiPageEligible).toBe(false);
  });
});


it("el acuerdo tiene denominadores y no llama independiente a una segunda lectura propia",()=>{
  const first:AnnotationReview={id:"1",reviewer:"Codex",pass:"without_scores_tags",object:"track:1",aspect:"timbre",assertionState:"affirmed",appreciation:"liked",support:"supported",alternative:"Otra técnica",translation:null,reason:"Cita directa"};
  const second={...first,support:"partial" as const};
  const result=evaluateAnnotations([first],[second]);
  expect(result.independent).toBe(false);expect(result.sameAnalyst).toBe(true);
  expect(result.agreement["support"]).toEqual({agree:0,compared:1});
  expect(result.supportPrecision).toEqual({supported:0,assessable:1});expect(result.disagreements).toHaveLength(1);
  expect(result.publicationAuthorized).toBe(false);
});

it("no infla soporte con IDs ajenos ni confunde variaciones del nombre con otro analista",()=>{
  const first:AnnotationReview={id:"1",reviewer:"Codex",pass:"without_scores_tags",object:"album:1",aspect:"voice",assertionState:"affirmed",appreciation:"descriptive",support:"supported",alternative:"Alcance parcial",translation:null,reason:"Fragmento directo"};
  const second={...first,reviewer:"  CODEX  ",support:"uncertain" as const};
  const result=evaluateAnnotations([first,{...first,id:"2"}],[second]);
  expect(result.sameAnalyst).toBe(true);expect(result.differentNamedReviewers).toBe(false);
  expect(result.missing).toEqual(["2"]);expect(result.agreement["object"]).toEqual({agree:1,compared:1});
  expect(result.supportPrecision).toEqual({supported:0,assessable:0});
  expect(()=>evaluateAnnotations([first],[second,{...first,id:"unrelated"}])).toThrow(/ajena a la muestra/);
});

it("conserva testimonios dependientes sin usarlos para alcanzar recurrencia",()=>{
 for(const relation of ["quotes","duplicate","revision","joint_review","third_party","unverified"] as const){
  const rows=[1,2,3].map(i=>{const a=knowledgeFixture();a.id=String(i);a.observation.account=`account-${i}`;a.observation.reviewId=String(i);a.evidenceChain=`chain-${i}`;return a;});
  rows[2]!.dependencies=[{reference:"unresolved-source",relation}];
  const result=analyzePattern(rows);
  expect(result.states).not.toContain("provisional_recurrence");expect(result.witnesses).toHaveLength(3);
  expect(result.dependentWitnesses).toEqual(["3"]);expect(result.recurrenceEligibleAccounts).toBe(2);
  expect(result.independence).toBe("undetermined");
 }
});
