import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { genreMappingSchema } from "./taxonomy-knowledge.js";
import { hashText } from "./review-protocol.js";

export const mappingReviewFileSchema=z.object({
  version:z.string().min(1),analyst:z.string().min(1),policy:z.literal("analytical_proposals_preserve_human_assignments"),
  terms:z.array(z.object({originalTerm:z.string().min(1),targetSlug:z.string().nullable(),relation:z.enum(["equivalence","specialization","partial","pending"]),
    sourceConceptKind:z.enum(["style","technique","aesthetic","format","unresolved"]),rationale:z.string().min(1),definitionReferences:z.array(z.string().url()),active:z.literal(false)}).strict()),
}).strict().superRefine((f,ctx)=>{if(new Set(f.terms.map(t=>t.originalTerm)).size!==f.terms.length)ctx.addIssue({code:"custom",message:"Término duplicado"});});
export interface LegacyGenreMapping {album:string;sourceGenre:string;sourceLevel:"primary"|"secondary";crvSlug:string|null;match:string|null;warning:string|null}
export interface PilotGenreRelease {sampleAlbumId:string;href:string;metadata:{file:string;sha256:string}}
export async function reviewGenreMappings(root:string,legacy:LegacyGenreMapping[],releases:PilotGenreRelease[],activeSlugs:Set<string>) {
  const review=mappingReviewFileSchema.parse(JSON.parse(await readFile(path.join(root,"docs/unified-search/stage2/mapping-review.json"),"utf8")));
  const terms=new Map(review.terms.map(t=>[t.originalTerm,t]));
  for(const term of terms.keys())if(!legacy.some(row=>row.sourceGenre===term))throw new Error(`Revisión sin antecedente: ${term}`);
  const sourceHashes=new Map<string,string>();
  for(const release of releases){
    const actual=hashText(await readFile(path.join(root,release.metadata.file)));
    if(actual!==release.metadata.sha256)throw new Error(`Captura del piloto cambió: ${release.sampleAlbumId}; conservar el corte y revisar antes de remapear`);
    sourceHashes.set(release.sampleAlbumId,actual);
  }
  const mappings=legacy.map(row=>{
    const term=terms.get(row.sourceGenre),release=releases.find(r=>r.sampleAlbumId===row.album);
    if(!term||!release)throw new Error(`Correspondencia sin revisión o publicación: ${row.sourceGenre}`);
    if(term.targetSlug&&!activeSlugs.has(term.targetSlug))throw new Error(`Destino ausente/inactivo: ${term.targetSlug}`);
    const mapping=genreMappingSchema.parse({version:"crv-rym-mapping-v1",originalTerm:row.sourceGenre,originalLevel:row.sourceLevel,
      source:`https://rateyourmusic.com${release.href}`,sourceCaptureHash:sourceHashes.get(row.album),targetSlug:term.targetSlug,relation:term.relation,
      scope:"Correspondencia terminológica general; conserva publicación y nivel RYM de origen. No asigna atributos de obras ni habilita expansión de consultas.",rationale:term.rationale,
      aliasWarning:row.warning,status:"proposed",reviewer:review.analyst});
    return {...row,mapping,sourceConceptKind:term.sourceConceptKind,definitionReferences:term.definitionReferences,
      disposition:"analytically_reviewed_proposal",queryExpansionAllowed:false,humanAssignmentsChanged:false};
  });
  return {version:review.version,analyst:review.analyst,mappings,coverage:{observations:mappings.length,uniqueTerms:terms.size,
    relations:Object.fromEntries(["equivalence","specialization","partial","pending"].map(relation=>[relation,review.terms.filter(t=>t.relation===relation).length])),approved:0},humanAssignmentsChanged:false};
}
