import { readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { load } from "cheerio";
import { z } from "zod";
const text=z.string().trim().min(1),https=z.string().url().refine(u=>u.startsWith("https://"),"Fuente HTTPS requerida"),sha=z.string().regex(/^[a-f0-9]{64}$/);
export const genreCaptureReferenceSchema=z.object({path:z.literal("docs/unified-search/stage2/genre-source-captures.json"),sha256:sha}).strict();
export const genreSourceManifestSchema=z.object({version:z.enum(["crv-genre-source-captures-0.1.0","crv-genre-source-captures-0.2.0"]),purpose:text,legacySourceIds:z.array(text),
  sources:z.array(z.object({id:text,requestedUrl:https,finalUrl:https,canonicalUrl:https,title:text,
    html:z.string().regex(/^data\/research\/unified-search-genres-\d{4}-\d{2}-\d{2}\/[A-Za-z0-9_-]+-[a-f0-9]{12}\.html$/),sha256:sha,
    bytes:z.number().int().positive(),capturedAt:z.string().datetime(),sections:z.array(text),
    parser:z.enum(["wikipedia_html","institutional_html"]).optional(),
    articleSelector:z.enum([".element-item",".entry-content"]).optional(),
    captureTimeBasis:z.enum(["initial_snapshot_file_mtime"]).optional(),
  }).strict()).min(1),
}).strict().superRefine((m,ctx)=>{
  const ids=m.sources.map(s=>s.id);
  if(new Set(ids).size!==ids.length||new Set(m.legacySourceIds).size!==m.legacySourceIds.length||m.legacySourceIds.some(id=>ids.includes(id)))ctx.addIssue({code:"custom",message:"IDs de fuente duplicados o con procedencias incompatibles"});
  if(new Set(m.sources.map(s=>s.html)).size!==m.sources.length)ctx.addIssue({code:"custom",message:"Captura repetida bajo fuentes distintas"});
  if(new Set(m.sources.map(s=>s.canonicalUrl)).size!==m.sources.length||new Set(m.sources.map(s=>s.sha256)).size!==m.sources.length)ctx.addIssue({code:"custom",message:"Una redirección o copia de la misma página no constituye otra fuente"});
  for(const s of m.sources)if(s.parser==="institutional_html"&&!s.articleSelector||s.parser!=="institutional_html"&&s.articleSelector)ctx.addIssue({code:"custom",message:"El lector institucional requiere selector explícito de artículo"});
});
const hash=(b:Buffer|string)=>createHash("sha256").update(b).digest("hex");
/** Offline source verification, not a validator of musical truth. Keeping a
 * source snapshot does not prove attributes of any individual catalog work. */
export async function verifyGenreSourceCaptures(root:string,reference:z.infer<typeof genreCaptureReferenceSchema>,descriptions:Array<{sources:Array<{id:string;url:string}>}>){
  const pointer=genreCaptureReferenceSchema.parse(reference),raw=await readFile(path.join(root,pointer.path));
  if(hash(raw)!==pointer.sha256)throw new Error("Manifiesto de fuentes de géneros cambió; revisar el corte");
  const manifest=genreSourceManifestSchema.parse(JSON.parse(raw.toString("utf8"))),allSources=descriptions.flatMap(g=>g.sources);
  const ids=new Set(allSources.map(s=>s.id)),declared=new Set([...manifest.legacySourceIds,...manifest.sources.map(s=>s.id)]);
  if(ids.size!==declared.size||[...ids].some(id=>!declared.has(id)))throw new Error("Fuente sin captura o sin declaración histórica explícita");
  let totalBytes=0;
  for(const source of manifest.sources){
    const bindings=allSources.filter(s=>s.id===source.id);
    if(bindings.some(s=>s.url!==source.canonicalUrl&&s.url!==source.requestedUrl))throw new Error(`Fuente capturada vinculada a otra URL: ${source.id}`);
    if(!source.html.endsWith(`-${source.sha256.slice(0,12)}.html`))throw new Error("Nombre de captura no corresponde a su huella");
    const actual=await realpath(path.join(root,source.html)),directory=await realpath(path.join(root,path.dirname(source.html)));
    const researchRoot=await realpath(path.join(root,"data","research"));
    if(!actual.startsWith(`${researchRoot}${path.sep}`)||path.dirname(actual)!==directory)throw new Error("Captura fuera del archivo de investigación");
    const bytes=await readFile(actual);
    if(hash(bytes)!==source.sha256||bytes.length!==source.bytes)throw new Error(`Captura de género cambió: ${source.id}`);
    const $=load(bytes.toString("utf8")),title=$("h1").first().text().replace(/\s+/gu," ").trim(),canonical=$("link[rel='canonical']").attr("href");
    if(title!==source.title||canonical&&canonical!==source.canonicalUrl)throw new Error(`Identidad documental de género no coincide: ${source.id}`);
    const article=source.parser==="institutional_html"
      ? $(source.articleSelector!).toArray().some(el=>$(el).find("p").text().trim().length>=150)
      : $(".mw-parser-output").toArray().some(el=>$(el).find("p").length>0);
    if(!article)throw new Error("Captura sin artículo legible; no usar página bloqueada como fuente");
    const anchors=new Set($("[id]").toArray().map(el=>$(el).attr("id")));
    for(const anchor of source.sections)if(!anchors.has(anchor))throw new Error("Sección declarada ausente de la captura");
    totalBytes+=bytes.length;
  }
  return {manifestVersion:manifest.version,capturedSources:manifest.sources.length,legacySourcesWithoutSnapshot:manifest.legacySourceIds.length,totalBytes,
    checkedSourceIds:manifest.sources.map(s=>s.id),institutionalSources:manifest.sources.filter(s=>s.parser==="institutional_html").length,
    verified:"source_identity_and_snapshot_integrity_only",musicalClaimsIndependentlyValidated:false,entityAssignmentsAuthorized:false};
}
