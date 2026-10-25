import { genreCaptureReferenceSchema, verifyGenreSourceCaptures } from "./genre-source-captures.js";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { genreDescriptionSchema, inspectGenreDescription } from "./taxonomy-knowledge.js";

export const genreKnowledgeFileSchema = z.object({
  version:z.string().min(1), analyst:z.string().min(1),
  policy:z.literal("general_knowledge_proposals_never_entity_assignments"),
  descriptions:z.array(genreDescriptionSchema),sourceCaptureManifest:genreCaptureReferenceSchema.optional(),
  // Categorías que Brian decidió dejar fuera del mapa descriptivo por falta de
  // fuente. Siguen activas en la taxonomía; solo no se describen ni se inventan rasgos.
  exclusions:z.array(z.object({slug:z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),reason:z.string().min(1),
    decidedBy:z.string().min(1),decidedAt:z.string().regex(/^\d{4}-\d{2}-\d{2}$/)}).strict()).optional(),
}).strict().superRefine((file,ctx)=>{
  const seen=new Set<string>();
  for(const entry of file.descriptions){
    if(seen.has(entry.slug))ctx.addIssue({code:"custom",message:`Descripción duplicada: ${entry.slug}`});
    seen.add(entry.slug);
  }
  for(const entry of file.exclusions??[]){
    if(seen.has(entry.slug))ctx.addIssue({code:"custom",message:`Exclusión duplicada o con descripción: ${entry.slug}`});
    seen.add(entry.slug);
  }
});
export type GenreKnowledgeFile = z.infer<typeof genreKnowledgeFileSchema>;
export async function readGenreKnowledge(root:string):Promise<GenreKnowledgeFile> {
  const file=genreKnowledgeFileSchema.parse(JSON.parse(await readFile(path.join(root,"docs/unified-search/stage2/genre-descriptions.json"),"utf8")));
  if(file.sourceCaptureManifest)await verifyGenreSourceCaptures(root,file.sourceCaptureManifest,file.descriptions);
  return file;
}
export function buildGenreKnowledgeMap(genres:Array<Record<string,unknown>>,file:GenreKnowledgeFile,databaseStatus:string) {
  const slugs=new Set(genres.map(g=>String(g["slug"])));
  const descriptions=new Map(file.descriptions.map(d=>[d.slug,d]));
  const exclusions=new Map((file.exclusions??[]).map(e=>[e.slug,e]));
  for(const e of exclusions.values())if(!slugs.has(e.slug))throw new Error(`Exclusión de género ausente/inactivo: ${e.slug}`);
  for(const d of file.descriptions)if(!slugs.has(d.slug))throw new Error(`Género ausente/inactivo: ${d.slug}; revisar identidad antes de documentarlo`);
  const rows=genres.map(g=>{
    const research=descriptions.get(String(g["slug"]));
    const existing=typeof g["description"]==="string"&&g["description"].trim()?g["description"]:null;
    const excluded=!existing&&!research?(exclusions.get(String(g["slug"]))??null):null;
    return {...g,id:Number(g["id"]),slug:String(g["slug"]),name:String(g["name"]),description:existing??research?.definition??null,existingDescription:existing,
      descriptionStatus:existing?"existing_preserved":research?"documented_proposal":excluded?"excluded_by_decision":"missing",
      proposedDefinition:research?.definition??null,characteristics:research?.characteristics??[],sources:research?.sources??[],scope:research?.scope??null,
      categoryKind:research?.categoryKind??null,profileLimits:research?.profileLimits??null,
      researchStatus:research?.status??"not_documented", analyst:research?.analyst??null,
      missingAspects:research?inspectGenreDescription(research).missingAspects:["instruments_roles","timbre","rhythm","form","voice","production"],
      entityAssignmentsAuthorized:false,
      exclusion:excluded?{reason:excluded.reason,decidedBy:excluded.decidedBy,decidedAt:excluded.decidedAt}:null,
      nextTask:excluded?"Excluida del mapa descriptivo por decisión editorial; se reabre si aparece una fuente que la describa":research?"Propuesta documentada; revisar criterio y excepciones sin derivar atributos de obras":
        "Documentar instrumentos/roles, timbre, ritmo, forma, voz y producción con fuentes; no completar por herencia"};
  });
  return {version:file.version,databaseStatus,policy:file.policy,coverage:{active:rows.length,
    existingDescriptions:rows.filter(r=>r.existingDescription).length,documentedProposals:file.descriptions.length,
    described:rows.filter(r=>r.description).length,excludedByDecision:rows.filter(r=>r.descriptionStatus==="excluded_by_decision").length,
    missingDescriptions:rows.filter(r=>r.descriptionStatus==="missing").length,
    allSixAspectsDocumented:rows.filter(r=>!r.missingAspects.length).length},genres:rows};
}
