import { readFile } from "node:fs/promises";
import path from "node:path";
import { projectRoot } from "../config/project-root.js";
import { knowledgeFeedStatus } from "./knowledge-feed.js";
import type { buildReviewedVocabulary } from "./semantic-review.js";
import type { buildGenreKnowledgeMap } from "./genre-map.js";
import type { reviewGenreMappings } from "./genre-mapping-review.js";

type GenreMap = ReturnType<typeof buildGenreKnowledgeMap>;
type MappingReview = Awaited<ReturnType<typeof reviewGenreMappings>>;
type SemanticDetails=ReturnType<typeof buildReviewedVocabulary>["concepts"][number]["semanticReview"];
interface Vocabulary { version:string; coverage?:ReturnType<typeof buildReviewedVocabulary>["coverage"]; concepts:Array<{id:string;labelEs:string;aliasesEs:string[];definitionEs:string;disposition:string;reason:string;semanticReview?:SemanticDetails}>; facets:Array<{id:string;aliasesEs:string[];definition:string;disposition:string;reason:string;semanticReview?:SemanticDetails}> }
const projectSemanticReview=(r:SemanticDetails|undefined)=>r?{version:r.version,reviewer:r.reviewer,status:r.status,definition:r.definition,target:r.target,scope:r.scope,falseFriends:r.falseFriends,assignmentCriterion:r.assignmentCriterion,aliasRules:r.aliasRules,motivation:r.motivation,annotationRefs:r.annotationRefs,editorialApproved:false,entityAssignmentsAuthorized:false}:null;
interface Study {version:string;generatedAt:string;manifest:unknown[];releases:Array<{role:string;multiPageEligible:boolean;validReviews:number;annotationStatus:string}>;independentEvaluation:{status:string}}
/** Deliberate projection: no archive paths, full reviews, source_object, input,
 * SQL errors, arbitrary annotation payloads or individual account data. */
export async function knowledgeAdministration() {
  const directory = path.join(projectRoot(import.meta.url), "reports/unified-search-stage2");
  const read = async <T>(file:string):Promise<T|null> => {
    try { return JSON.parse(await readFile(path.join(directory,file),"utf8")) as T; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
  };
  const [map,vocabulary,study,feed,mappings] = await Promise.all([read<GenreMap>("genre-map.json"),read<Vocabulary>("vocabulary.json"),read<Study>("study.json"),knowledgeFeedStatus(),read<MappingReview>("mappings.json")]);
  return { available: !!map && !!vocabulary && !!study,
    genres: map ? { version:map.version, sourceStatus:map.databaseStatus, total:map.genres.length, described:map.genres.filter(g=>g.description).length,
      existingDescriptions:map.coverage?.existingDescriptions??map.genres.filter(g=>g.descriptionStatus==="existing_preserved").length,
      documentedProposals:map.coverage?.documentedProposals??map.genres.filter(g=>g.descriptionStatus==="documented_proposal").length,
      excluded:map.genres.filter(g=>g.descriptionStatus==="excluded_by_decision").length,
      rows: map.genres.map(g=>({id:g.id,slug:String(g["slug"]),name:String(g["name"]),description:g.description??null,status:g.descriptionStatus,
        proposedDefinition:g.proposedDefinition??null,scope:g.scope??null,characteristics:g.characteristics??[],missingAspects:g.missingAspects??[],
        categoryKind:g.categoryKind??null,profileLimits:g.profileLimits??null,exclusion:g.exclusion??null,
        sources:(g.sources??[]).map(s=>({id:s.id,url:s.url,locator:s.locator,attribution:s.attribution}))})) } : null,
    mappings: mappings?.coverage && mappings.mappings.every(m=>m.mapping) ? {version:mappings.version,coverage:mappings.coverage,
      rows:mappings.mappings.map(m=>({originalTerm:m.mapping.originalTerm,originalLevel:m.mapping.originalLevel,source:m.mapping.source,
        targetSlug:m.mapping.targetSlug,relation:m.mapping.relation,rationale:m.mapping.rationale,aliasWarning:m.mapping.aliasWarning,
        sourceConceptKind:m.sourceConceptKind,definitionReferences:m.definitionReferences,status:m.mapping.status}))} : null,
    vocabulary: vocabulary ? { version:vocabulary.version, coverage:vocabulary.coverage??null, concepts:vocabulary.concepts.map(c=>({id:c.id,label:c.labelEs,aliases:c.aliasesEs,definition:c.definitionEs,disposition:c.disposition,reason:c.reason,semanticReview:projectSemanticReview(c.semanticReview)})),
      facets:vocabulary.facets.map(f=>({id:f.id,aliases:f.aliasesEs,definition:f.definition,disposition:f.disposition,reason:f.reason,semanticReview:projectSemanticReview(f.semanticReview)})) } : null,
    study: study ? { version:study.version, generatedAt:study.generatedAt, pages:study.manifest.length, releases:study.releases.length,
      reserved:study.releases.filter(r=>r.role==="reserved_unopened").length, multiPageEligible:study.releases.filter(r=>r.multiPageEligible).length,
      validReviews:study.releases.reduce((n,r)=>n+r.validReviews,0), independentEvaluation:study.independentEvaluation.status } : null,
    feed,
    publication: "Solo propuestas; revisión y mecanismos editoriales existentes requeridos",
  };
}
export type KnowledgeAdministration = Awaited<ReturnType<typeof knowledgeAdministration>>;
