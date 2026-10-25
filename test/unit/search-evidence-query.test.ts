import { expect, it } from "vitest";
import { knowledgeFixture } from "../support/knowledge-fixture.js";
import { evaluateEvidenceQuery, evidenceQuerySchema, type EvidenceQuery } from "../../src/search/evidence-query.js";
function request():EvidenceQuery {
 const a=knowledgeFixture();return {version:"crv-evidence-query-v1",planOrigin:"authored_development_plan",unit:a.object,listeningCondition:null,comparisons:[],
 intention:{version:"crv-search-intention-v1",capabilities:["contextual"],interpretation:"identified",engine:"legacy",entities:[],pending:[],
 conditions:[{id:"fuzz",axis:null,facet:a.proposal.facet,value:a.assertion.value,sourceText:"guitarra fuzz",scope:"track",mode:"required",alternativeGroup:null,status:"recognized"}]}};
}
it("no arma una conjunción con propiedades de pistas distintas",()=>{
 const a=knowledgeFixture(),b=knowledgeFixture();b.id="other";b.object.id=2;b.assertion.value="clean";b.proposal.value="clean";
 const q=request();q.intention.conditions.push({...q.intention.conditions[0]!,id:"clean",value:"clean"});
 const result=evaluateEvidenceQuery(q,[a,b]);
 expect(result.status).toBe("unresolved");expect(result.conditions[1]!.supportingIds).toEqual([]);
 expect(result.conditions[1]!.evidence[0]!.reasons).toContain("different_unit_version_segment_or_listening_condition");
});
it("no mezcla versiones, segmentos o condiciones de escucha",()=>{
 for(const field of ["version","segment","listeningCondition"] as const){
  const a=knowledgeFixture();if(field==="listeningCondition")a.assertion.listeningCondition="headphones";else a.object[field]="other";
  expect(evaluateEvidenceQuery(request(),[a]).status).toBe("unresolved");
 }
});
it("una negación requiere cobertura completa y versión, el silencio no basta",()=>{
 const q=request();q.intention.conditions[0]!.mode="excluded";
 expect(evaluateEvidenceQuery(q,[]).status).toBe("unresolved");
 const a=knowledgeFixture();a.assertion.state="negated";a.assertion.coverage="partial";
 expect(evaluateEvidenceQuery(q,[a]).status).toBe("unresolved");
 a.assertion.coverage="complete";expect(evaluateEvidenceQuery(q,[a]).status).toBe("supported_as_attributed");
 a.object.version=null;q.unit.version=null;expect(evaluateEvidenceQuery(q,[a]).status).toBe("unresolved");
});
it("conserva desacuerdo descriptivo y no promedia valoraciones opuestas",()=>{
 const a=knowledgeFixture(),b=knowledgeFixture();b.id="second";b.observation.account="second";b.evidenceChain="second";
 a.assertion.appreciation="liked";b.assertion.appreciation="disliked";
 let result=evaluateEvidenceQuery(request(),[a,b]);expect(result.status).toBe("supported_as_attributed");expect(result.conditions[0]!.opposedAppreciations).toBe(true);
 b.assertion.state="negated";result=evaluateEvidenceQuery(request(),[a,b]);expect(result.status).toBe("conflicted");expect(result.conditions[0]!.counterevidenceIds).toEqual(["second"]);
});
it("retiene preferencias desconocidas sin volverlas requisitos o inventar soporte",()=>{
 const q=request();q.intention.conditions.push({...q.intention.conditions[0]!,id:"voice",value:"voice",mode:"preferred"});
 const result=evaluateEvidenceQuery(q,[knowledgeFixture()]);expect(result.status).toBe("supported_as_attributed");expect(result.conditions[1]!.state).toBe("unknown");
 q.intention.conditions=q.intention.conditions.slice(1);expect(evaluateEvidenceQuery(q,[]).status).toBe("preference_only");
});
it("aplica OR dentro de grupo y AND entre grupos, sin borrar alternativas pendientes",()=>{
 const q=request();q.intention.conditions[0]!.alternativeGroup="texture";
 q.intention.conditions.push({...q.intention.conditions[0]!,id:"clean",value:"clean"});
 let result=evaluateEvidenceQuery(q,[knowledgeFixture()]);expect(result.status).toBe("supported_as_attributed");expect(result.conditions[1]!.state).toBe("unknown");
 q.intention.conditions.push({...q.intention.conditions[0]!,id:"third",value:"third",alternativeGroup:null});
 result=evaluateEvidenceQuery(q,[knowledgeFixture()]);expect(result.status).toBe("unresolved");
});
it("una cláusula no reconocida o un fragmento pendiente no desaparecen",()=>{
 const q=request();q.intention.interpretation="partial";q.intention.conditions[0]!.status="unknown";
 expect(evaluateEvidenceQuery(q,[knowledgeFixture()]).status).toBe("unresolved");
 q.intention.conditions[0]!.status="recognized";q.intention.pending=[{text:"lo otro",reason:"sin resolver"}];
 const result=evaluateEvidenceQuery(q,[knowledgeFixture()]);expect(result.status).toBe("unresolved");expect(result.pending).toEqual(q.intention.pending);
});
it("rating, tags y definición de género no sustituyen una afirmación",()=>{
 const a=knowledgeFixture();a.layers.genreKnowledge=[{reference:"genre:fuzz",relation:"supports"}];a.layers.community=[{term:"fuzz",source:"https://example.com",level:"tag",measure:"100",capturedAt:"2026-10-17T00:00:00Z"}];a.layers.individualRating={value:5,minimum:0.5,maximum:5,object:"album"};a.assertion.state="hypothetical";
 const result=evaluateEvidenceQuery(request(),[a]);expect(result.status).toBe("unresolved");expect(result.communityAndGenreWitnessesAdded).toBe(0);expect(result.publicationAuthorized).toBe(false);
});
it("no convierte elogio, cita, ironía, corrección o retirada en atributo",()=>{
 for(const state of ["quoted","possible_irony","corrected","withdrawn","uncertain"] as const){const a=knowledgeFixture();a.assertion.state=state;expect(evaluateEvidenceQuery(request(),[a]).status).toBe("unresolved");}
 const a=knowledgeFixture();a.assertion.type="taste";expect(evaluateEvidenceQuery(request(),[a]).status).toBe("unresolved");
});
it("actividad requiere base específica y energía conserva su método",()=>{
 for(const axis of ["activity","energy"] as const){
  const a=knowledgeFixture();a.proposal.axis=axis;a.proposal.facet=null;
  const q=request();q.intention.conditions[0]!.axis=axis;q.intention.conditions[0]!.facet=null;
  expect(evaluateEvidenceQuery(q,[a]).status).toBe("unresolved");
  if(axis==="energy")a.analysis.methodVersion="perceived-energy-v1";else a.assertion.activityBasis="declared_use";
  expect(evaluateEvidenceQuery(q,[a]).status).toBe("supported_as_attributed");
 }
});
it("parecido exige referencia, aspecto y periodo precisos",()=>{
 const a=knowledgeFixture();a.comparison={reference:{kind:"artist",id:null,name:"Reference",resolution:"external",identityEvidence:["documented"],version:null,segment:null},aspect:"other",direction:"resembles",polarity:"affirmed",period:null};
 const q=request();q.intention.entities.push({kind:"artist",id:null,name:"Reference",role:"reference",resolution:"external"});q.comparisons=[{conditionId:"fuzz",referenceName:"Reference",aspect:"guitars",direction:"resembles",period:null}];
 expect(evaluateEvidenceQuery(q,[a]).status).toBe("unresolved");a.comparison.aspect="guitars";expect(evaluateEvidenceQuery(q,[a]).status).toBe("supported_as_attributed");
 a.comparison.reference.resolution="pending";expect(evaluateEvidenceQuery(q,[a]).status).toBe("unresolved");
});
it("rechaza IDs/grupos ambiguos, duplicados y objetivo distinto",()=>{
 const q=request();q.intention.conditions.push({...q.intention.conditions[0]!});expect(evidenceQuerySchema.safeParse(q).success).toBe(false);
 q.intention.conditions=q.intention.conditions.slice(0,1);q.intention.conditions[0]!.alternativeGroup="g";q.intention.conditions.push({...q.intention.conditions[0]!,id:"preferred",mode:"preferred"});expect(evidenceQuerySchema.safeParse(q).success).toBe(false);
 q.intention.conditions=q.intention.conditions.slice(0,1);q.intention.entities=[{role:"target",kind:"track",id:2,name:"Other",resolution:"resolved"}];expect(evaluateEvidenceQuery(q,[knowledgeFixture()]).status).toBe("unresolved");
 expect(()=>evaluateEvidenceQuery(request(),[knowledgeFixture(),knowledgeFixture()])).toThrow(/duplicada/);
});

it("no permite ocultar una referencia nombrada sin condición comparativa",()=>{
 const q=request();q.intention.entities.push({role:"reference",kind:"artist",id:null,name:"Reference",resolution:"external"});
 expect(evidenceQuerySchema.safeParse(q).success).toBe(false);
});

it("mantiene visible la dependencia de una afirmación atribuida",()=>{
 const a=knowledgeFixture();a.dependencies=[{reference:"unknown-reviewer",relation:"third_party"}];
 const result=evaluateEvidenceQuery(request(),[a]);
 expect(result.status).toBe("supported_as_attributed");
 expect(result.conditions[0]!.evidence[0]!.dependencies).toEqual(a.dependencies);
 expect(result.independence).toBe("undetermined");expect(result.publicationAuthorized).toBe(false);
});
