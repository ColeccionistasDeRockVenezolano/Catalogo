import { mkdir, mkdtemp, writeFile, readFile, rm, symlink, rename } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { afterEach, expect, it } from "vitest";
import { genreSourceManifestSchema, verifyGenreSourceCaptures } from "../../src/search/genre-source-captures.js";
import { hashText } from "../../src/search/review-protocol.js";
import { readGenreKnowledge } from "../../src/search/genre-map.js";
const roots:string[]=[];
afterEach(async()=>{await Promise.all(roots.splice(0).map(root=>rm(root,{recursive:true,force:true})));});
async function fixture(){
 const root=await mkdtemp(path.join(os.tmpdir(),"crv-genre-sources-"));roots.push(root);
 const html='<html><head><link rel="canonical" href="https://example.org/genre"></head><body><h1>Example Genre</h1><div class="mw-parser-output"><h2 id="Characteristics">Characteristics</h2><p>Fixture source article.</p></div></body></html>',sha=hashText(html);
 const capture=`data/research/unified-search-genres-2026-10-17/Example-${sha.slice(0,12)}.html`;
 await mkdir(path.join(root,path.dirname(capture)),{recursive:true});await writeFile(path.join(root,capture),html);
 await mkdir(path.join(root,"docs/unified-search/stage2"),{recursive:true});
 const manifest={version:"crv-genre-source-captures-0.1.0" as const,purpose:"Source identity only",legacySourceIds:["historical"],sources:[{id:"wiki:Example",requestedUrl:"https://example.org/old",finalUrl:"https://example.org/genre",canonicalUrl:"https://example.org/genre",title:"Example Genre",html:capture,sha256:sha,bytes:Buffer.byteLength(html),capturedAt:"2026-10-17T12:00:00Z",sections:["Characteristics"]}]};
 const definitions=[{sources:[{id:"wiki:Example",url:"https://example.org/genre"},{id:"historical",url:"https://example.org/historical"}]}];
 const save=async()=>{const text=JSON.stringify(manifest);await writeFile(path.join(root,"docs/unified-search/stage2/genre-source-captures.json"),text);return {path:"docs/unified-search/stage2/genre-source-captures.json" as const,sha256:hashText(text)};};
 return {root,manifest,definitions,capture,save};
}
it("verifica bytes, identidad y secciones, distinguiendo fuentes históricas sin captura",async()=>{
 const f=await fixture(),result=await verifyGenreSourceCaptures(f.root,await f.save(),f.definitions);
 expect(result).toMatchObject({capturedSources:1,legacySourcesWithoutSnapshot:1,musicalClaimsIndependentlyValidated:false,entityAssignmentsAuthorized:false});
});
it("admite research externo sin permitir que sus capturas escapen de ese archivo",async()=>{
 const f=await fixture(),shared=await mkdtemp(path.join(os.tmpdir(),"crv-genre-shared-"));roots.push(shared);
 const local=path.join(f.root,"data/research"),target=path.join(shared,"research");
 await rename(local,target);await symlink(target,local,"dir");
 expect((await verifyGenreSourceCaptures(f.root,await f.save(),f.definitions)).capturedSources).toBe(1);
 await writeFile(path.join(shared,"outside.html"),await readFile(path.join(f.root,f.capture)));
 await rm(path.join(f.root,f.capture));await symlink(path.join(shared,"outside.html"),path.join(f.root,f.capture));
 await expect(verifyGenreSourceCaptures(f.root,await f.save(),f.definitions)).rejects.toThrow(/fuera del archivo/);
});
it("rechaza alteración del manifiesto o del HTML antes de regenerar conocimiento",async()=>{
 const f=await fixture(),pointer=await f.save();await writeFile(path.join(f.root,pointer.path),"{}");
 await expect(verifyGenreSourceCaptures(f.root,pointer,f.definitions)).rejects.toThrow(/Manifiesto/);
 const restored=await f.save();await writeFile(path.join(f.root,f.capture),"changed");await expect(verifyGenreSourceCaptures(f.root,restored,f.definitions)).rejects.toThrow(/Captura de género cambió/);
});
it("no acepta snapshot de otro título, otra URL ni secciones inexistentes",async()=>{
 const f=await fixture();f.manifest.sources[0]!.title="Other Genre";
 await expect(verifyGenreSourceCaptures(f.root,await f.save(),f.definitions)).rejects.toThrow(/Identidad documental/);
 f.manifest.sources[0]!.title="Example Genre";f.definitions[0]!.sources[0]!.url="https://example.org/different";
 await expect(verifyGenreSourceCaptures(f.root,await f.save(),f.definitions)).rejects.toThrow(/otra URL/);
 f.definitions[0]!.sources[0]!.url="https://example.org/genre";f.manifest.sources[0]!.sections=["Missing"];
 await expect(verifyGenreSourceCaptures(f.root,await f.save(),f.definitions)).rejects.toThrow(/Sección declarada/);
});
it("cada fuente debe tener captura o declaración histórica explícita, sin IDs dobles",async()=>{
 const f=await fixture();f.manifest.legacySourceIds=[];await expect(verifyGenreSourceCaptures(f.root,await f.save(),f.definitions)).rejects.toThrow(/Fuente sin captura/);
 f.manifest.legacySourceIds=["wiki:Example"];expect(genreSourceManifestSchema.safeParse(f.manifest).success).toBe(false);
});
it("no cuenta redirecciones ni copias del mismo artículo como fuentes adicionales",async()=>{
 const f=await fixture(),first=f.manifest.sources[0]!;
 const second={...first,id:"wiki:Redirect",html:first.html.replace("Example-","Redirect-")};
 f.manifest.sources.push(second);
 expect(genreSourceManifestSchema.safeParse(f.manifest).success).toBe(false);
 second.canonicalUrl="https://example.org/other";
 // A different declared URL still does not turn identical bytes into another source.
 expect(genreSourceManifestSchema.safeParse(f.manifest).success).toBe(false);
 second.sha256="a".repeat(64);
 expect(genreSourceManifestSchema.safeParse(f.manifest).success).toBe(true);
});
it("una captura declarada no permite leer rutas ajenas mediante enlaces simbólicos",async()=>{
 const f=await fixture(),bytes=await readFile(path.join(f.root,f.capture));await writeFile(path.join(f.root,"other.html"),bytes);
 await rm(path.join(f.root,f.capture));await symlink(path.join(f.root,"other.html"),path.join(f.root,f.capture));
 await expect(verifyGenreSourceCaptures(f.root,await f.save(),f.definitions)).rejects.toThrow(/fuera del archivo/);
});
it("rechaza páginas bloqueadas aunque su hash y título estén declarados",async()=>{
 const f=await fixture(),html='<html><h1>Example Genre</h1><p>Access denied</p></html>',sha=hashText(html),capture=`data/research/unified-search-genres-2026-10-17/Blocked-${sha.slice(0,12)}.html`;
 await writeFile(path.join(f.root,capture),html);Object.assign(f.manifest.sources[0]!,{html:capture,sha256:sha,bytes:Buffer.byteLength(html),sections:[]});
 await expect(verifyGenreSourceCaptures(f.root,await f.save(),f.definitions)).rejects.toThrow(/artículo legible/);
});
it("el libro real verifica todas sus capturas y distingue fuentes heredadas sin fingir validación musical",async()=>{
 const file=await readGenreKnowledge(process.cwd());expect(file.sourceCaptureManifest).toBeDefined();
 const result=await verifyGenreSourceCaptures(process.cwd(),file.sourceCaptureManifest!,file.descriptions);
 expect(result.capturedSources).toBeGreaterThanOrEqual(32);expect(result.checkedSourceIds).toContain("unesco:llano-work-songs");expect(result.institutionalSources).toBeGreaterThan(0);expect(result.legacySourcesWithoutSnapshot).toBeGreaterThan(0);expect(result.entityAssignmentsAuthorized).toBe(false);
});

it("lee un artículo institucional por selector explícito sin aceptar una página vacía",async()=>{
 const f=await fixture();Object.assign(f.manifest.sources[0]!,{parser:"institutional_html"});
 expect(genreSourceManifestSchema.safeParse(f.manifest).success).toBe(false);
 const html='<html><head><link rel="canonical" href="https://example.org/genre"></head><body><h1>Example Genre</h1><div class="entry-content"><p>'+"Texto institucional de ensayo. ".repeat(12)+'</p></div></body></html>',sha=hashText(html),capture=`data/research/unified-search-genres-2026-10-17/Article-${sha.slice(0,12)}.html`;
 await writeFile(path.join(f.root,capture),html);Object.assign(f.manifest.sources[0]!,{articleSelector:".entry-content",html:capture,sha256:sha,bytes:Buffer.byteLength(html),sections:[]});
 expect((await verifyGenreSourceCaptures(f.root,await f.save(),f.definitions)).institutionalSources).toBe(1);
 Object.assign(f.manifest.sources[0]!,{articleSelector:".element-item"});await expect(verifyGenreSourceCaptures(f.root,await f.save(),f.definitions)).rejects.toThrow(/artículo legible/);
});
