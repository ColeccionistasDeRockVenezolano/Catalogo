import { z } from "zod";
const nonempty=z.string().trim().min(1);
export const genreDescriptionSchema=z.object({
  version:z.literal("crv-genre-description-v1"),slug:z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  definition:nonempty,scope:z.object({historical:nonempty,geographical:nonempty}).strict(),
  categoryKind:z.enum(["genre_style","stylistic_umbrella","regional_tradition","regional_umbrella","functional_category","thematic_category","ensemble_format","musical_feature","performance_practice"]).optional(),
  profileLimits:nonempty.optional(),
  characteristics:z.array(z.object({
    aspect:z.enum(["instruments_roles","timbre","rhythm","form","voice","production"]),
    description:nonempty,frequency:z.enum(["defining","frequent","variable"]),
    sources:z.array(nonempty).min(1),exceptions:z.array(nonempty),
  }).strict()),
  sources:z.array(z.object({id:nonempty,url:z.string().url(),locator:nonempty,accessedAt:z.string().datetime(),attribution:nonempty}).strict()).min(1),
  analyst:nonempty,status:z.literal("proposed"),
}).strict().superRefine((g,ctx)=>{
  if(g.categoryKind&&g.categoryKind!=="genre_style"&&!g.profileLimits)ctx.addIssue({code:"custom",message:"El tipo de categoría requiere delimitar su perfil musical"});
  if(!g.characteristics.length&&!["regional_umbrella","stylistic_umbrella","functional_category","thematic_category"].includes(g.categoryKind??"genre_style"))ctx.addIssue({code:"custom",message:"Un estilo, formación o rasgo musical requiere características documentadas"});
  const ids=new Set(g.sources.map(s=>s.id));
  if(ids.size!==g.sources.length)ctx.addIssue({code:"custom",message:"ID de fuente repetido en la definición"});
  for(const trait of g.characteristics) if(trait.sources.some(id=>!ids.has(id))) ctx.addIssue({code:"custom",message:"Rasgo sin fuente localizable en su definición"});
});
export const genreMappingSchema=z.object({
  version:z.literal("crv-rym-mapping-v1"),originalTerm:nonempty,
  originalLevel:z.enum(["primary","secondary"]),source:z.string().url(),sourceCaptureHash:z.string().regex(/^[a-f0-9]{64}$/),
  targetSlug:z.string().nullable(),relation:z.enum(["equivalence","specialization","partial","pending"]),
  scope:nonempty,rationale:nonempty,aliasWarning:z.string().nullable(),
  status:z.literal("proposed"),reviewer:z.string().nullable(),
}).strict().refine(m=>m.relation==="pending"||m.targetSlug!==null,"La correspondencia debe nombrar el género CRV");
/** Definitions are general knowledge; callers cannot use them to fill absent
 * evidence about an individual work, track, listening activity or negation. */
export function inspectGenreDescription(input:unknown) {
  const definition=genreDescriptionSchema.parse(input);
  const described=new Set(definition.characteristics.map(t=>t.aspect));
  return {definition,missingAspects:["instruments_roles","timbre","rhythm","form","voice","production"].filter(a=>!described.has(a as z.infer<typeof genreDescriptionSchema>["characteristics"][number]["aspect"])),
    entityAssignmentsAuthorized:false as const};
}
