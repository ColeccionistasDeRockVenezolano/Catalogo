import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { buildGenreKnowledgeMap, genreKnowledgeFileSchema, readGenreKnowledge } from "../../src/search/genre-map.js";
import { reviewGenreMappings } from "../../src/search/genre-mapping-review.js";
import { hashText } from "../../src/search/review-protocol.js";
import { genreDescriptionSchema } from "../../src/search/taxonomy-knowledge.js";

const roots:string[]=[];
afterEach(async()=>{await Promise.all(roots.splice(0).map(root=>rm(root,{recursive:true,force:true})));});
it("conserva el texto editorial aunque haya propuesta y no rellena rasgos ausentes",async()=>{
  const file=await readGenreKnowledge(process.cwd());
  const proposal=file.descriptions[0]!;
  const genres=[{id:1,slug:proposal.slug,name:"Género",description:"Texto editorial conservado"},{id:2,slug:"sin-documentar",name:"Pendiente",description:null},...file.descriptions.slice(1).map((d,i)=>({id:i+3,slug:d.slug,name:d.slug,description:null})),
    ...(file.exclusions??[]).map((e,i)=>({id:10000+i,slug:e.slug,name:e.slug,description:null}))];
  const result=buildGenreKnowledgeMap(genres,file,"available");
  expect(result.genres[0]!.description).toBe("Texto editorial conservado");
  expect(result.genres[0]!.proposedDefinition).toBe(proposal.definition);
  expect(result.genres[1]!.characteristics).toEqual([]);
  expect(result.genres[1]!.missingAspects).toHaveLength(6);
  expect(result.genres.every(g=>g.entityAssignmentsAuthorized===false)).toBe(true);
  expect(result.coverage.described).toBe(file.descriptions.length);
});
it("marca las exclusiones editoriales sin describirlas ni contarlas como pendientes",async()=>{
  const file=await readGenreKnowledge(process.cwd());
  const genres=[...file.descriptions.map((d,i)=>({id:i+1,slug:d.slug,name:d.slug,description:null})),
    ...(file.exclusions??[]).map((e,i)=>({id:10000+i,slug:e.slug,name:e.slug,description:null})),{id:99999,slug:"sin-documentar",name:"Pendiente",description:null}];
  const result=buildGenreKnowledgeMap(genres,file,"available");
  const excluded=result.genres.filter(g=>g.descriptionStatus==="excluded_by_decision");
  expect(excluded).toHaveLength(file.exclusions?.length??0);
  expect(excluded.every(g=>g.description===null&&g.characteristics.length===0&&g.exclusion?.decidedBy==="Brian")).toBe(true);
  expect(result.coverage).toMatchObject({excludedByDecision:excluded.length,missingDescriptions:1});
  const described={...file,exclusions:[{slug:file.descriptions[0]!.slug,reason:"x",decidedBy:"Brian",decidedAt:"2026-10-18"}]};
  expect(genreKnowledgeFileSchema.safeParse(described).success).toBe(false);
  expect(()=>buildGenreKnowledgeMap(genres.filter(g=>g.slug!==file.exclusions![0]!.slug),file,"available")).toThrow(/Exclusión/);
});
it("rechaza identidad ausente, fuentes inexistentes y descripciones duplicadas",async()=>{
  const file=await readGenreKnowledge(process.cwd());
  expect(()=>buildGenreKnowledgeMap([],file,"available")).toThrow(/ausente/);
  expect(genreKnowledgeFileSchema.safeParse({...file,descriptions:[file.descriptions[0],file.descriptions[0]]}).success).toBe(false);
  const changed=structuredClone(file);changed.descriptions[0]!.characteristics[0]!.sources=["sin-evidencia"];
  expect(genreKnowledgeFileSchema.safeParse(changed).success).toBe(false);
  const duplicate=structuredClone(file);duplicate.descriptions[0]!.sources.push(duplicate.descriptions[0]!.sources[0]!);
  expect(genreKnowledgeFileSchema.safeParse(duplicate).success).toBe(false);
});
async function mappingFixture(){
  const root=await mkdtemp(path.join(os.tmpdir(),"crv-genre-test-"));roots.push(root);
  const folder=path.join(root,"docs/unified-search/stage2");await mkdir(folder,{recursive:true});
  const terms=[{originalTerm:"Field Recording",targetSlug:null,relation:"pending",sourceConceptKind:"technique",rationale:"No forzar un género desde la técnica",definitionReferences:[],active:false}];
  await writeFile(path.join(folder,"mapping-review.json"),JSON.stringify({version:"test",analyst:"Codex",policy:"analytical_proposals_preserve_human_assignments",terms}));
  await writeFile(path.join(root,"capture.html"),"immutable capture");
  const releases=[{sampleAlbumId:"A01",href:"/release/album/example/",metadata:{file:"capture.html",sha256:hashText("immutable capture")}}];
  const legacy=[{album:"A01",sourceGenre:"Field Recording",sourceLevel:"secondary" as const,crvSlug:"experimental",match:"old",warning:"Alias amplio"}];
  return {root,releases,legacy};
}
it("preserva original/nivel/huella y destino anterior sin convertir técnica en género",async()=>{
  const {root,releases,legacy}=await mappingFixture();
  const result=await reviewGenreMappings(root,legacy,releases,new Set(["experimental"]));
  const row=result.mappings[0]!;
  expect(row.crvSlug).toBe("experimental");expect(row.mapping.targetSlug).toBeNull();
  expect(row.mapping.originalLevel).toBe("secondary");expect(row.mapping.sourceCaptureHash).toBe(releases[0]!.metadata.sha256);
  expect(row.mapping.relation).toBe("pending");expect(row.queryExpansionAllowed).toBe(false);
  expect(result.humanAssignmentsChanged).toBe(false);expect(result.coverage.approved).toBe(0);
});
it("detiene remapeo si la captura cambia o queda un término sin revisar",async()=>{
  const {root,releases,legacy}=await mappingFixture();
  await expect(reviewGenreMappings(root,[...legacy,{...legacy[0]!,sourceGenre:"Sin revisión"}],releases,new Set())).rejects.toThrow(/sin revisión/);
  await writeFile(path.join(root,"capture.html"),"changed capture");
  await expect(reviewGenreMappings(root,legacy,releases,new Set())).rejects.toThrow(/Captura del piloto cambió/);
});

it("una categoría funcional documentada no necesita inventar un perfil sonoro uniforme",async()=>{
 const file=await readGenreKnowledge(process.cwd()),functional=file.descriptions.find(d=>d.slug==="banda-sonora")!;
 expect(functional.categoryKind).toBe("functional_category");expect(functional.characteristics).toEqual([]);expect(functional.profileLimits).toContain("video");
 const invalid=structuredClone(file);const entry=invalid.descriptions.find(d=>d.slug==="banda-sonora")!;entry.categoryKind="genre_style";
 expect(genreKnowledgeFileSchema.safeParse(invalid).success).toBe(false);
 entry.categoryKind="functional_category";delete entry.profileLimits;expect(genreKnowledgeFileSchema.safeParse(invalid).success).toBe(false);
});

it("distingue tema, familia estilística y formación sin convertir una letra en entrega vocal",()=>{
 const entry={version:"crv-genre-description-v1",slug:"test-theme",definition:"Grupo definido por el tema tratado",scope:{historical:"Historia de ensayo",geographical:"Ámbito de ensayo"},categoryKind:"thematic_category",profileLimits:"El tema no fija instrumentación o técnica vocal",characteristics:[],sources:[{id:"source",url:"https://example.org/source",locator:"Fragmento",accessedAt:"2026-10-17T12:00:00Z",attribution:"Fixture"}],analyst:"Fixture",status:"proposed"};
 expect(genreDescriptionSchema.safeParse(entry).success).toBe(true);
 expect(genreDescriptionSchema.safeParse({...entry,categoryKind:"stylistic_umbrella"}).success).toBe(true);
 expect(genreDescriptionSchema.safeParse({...entry,profileLimits:undefined}).success).toBe(false);
 expect(genreDescriptionSchema.safeParse({...entry,categoryKind:"ensemble_format"}).success).toBe(false);
 expect(genreDescriptionSchema.safeParse({...entry,categoryKind:"ensemble_format",characteristics:[{aspect:"instruments_roles",frequency:"frequent",description:"Secciones de vientos y ritmo",sources:["source"],exceptions:["La formación varía"]}]}).success).toBe(true);
});
