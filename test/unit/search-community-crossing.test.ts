import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { afterEach, expect, it } from "vitest";
import { extractReleaseCommunity } from "../../src/search/rym-release-community.js";
import { hashText } from "../../src/search/review-protocol.js";
import { crossStudySources } from "../../src/search/study-crossing.js";
import os from "node:os";
import path from "node:path";
import { knowledgeFixture } from "../support/knowledge-fixture.js";
import { knowledgeModelState } from "../../src/search/knowledge-interpretation.js";
import { analyzePattern } from "../../src/search/knowledge-contracts.js";
const html='<meta property="og:url" content="https://rateyourmusic.com/release/album/test/release/"><h1 class="album_title">Release<div>By <a class="artist">Artist</a></div></h1><span class="release_pri_genres"><a class="genre">Ambient</a></span><span class="release_sec_genres"><a class="genre">Glitch</a></span><table><tr class="release_descriptors"><td><meta content="instrumental"><meta content=" male vocalist"><a class="genre">Not a genre here</a></td></tr></table><div><span class="avg_rating">4.01</span><span class="max_rating"><span>5.0</span><span>0.5</span></span><span class="num_ratings"><b>1,201</b></span></div><div class="review_body">BAD TAG</div>';
const input={html,source:"https://rateyourmusic.com/release/album/test/release/",capturedAtOriginal:"2026-10-04 08:55:33",expectedHash:hashText(html),object:{kind:"album" as const,id:1,name:"Release",artist:"Artist",identityEvidence:["accepted exact URL claim"]}};
it("extrae niveles y descriptores de ficha sin tomar reseñas ni inventar UTC",()=>{
 const c=extractReleaseCommunity(input);
 expect(c.terms.map(t=>[t.term,t.level])).toEqual([["Ambient","primary"],["Glitch","secondary"],["instrumental","descriptor"],["male vocalist","descriptor"]]);
 expect(c.rating?.votes).toBe(1201);expect(c.capturedAt).toBeNull();expect(c.captureTimeZone).toBeNull();expect(c.capturedAtOriginal).toBe(input.capturedAtOriginal);
});
it("detiene captura cambiada, homónimo y escala no documentada",()=>{
 expect(()=>extractReleaseCommunity({...input,html:html+"changed"})).toThrow(/cambió/);
 expect(()=>extractReleaseCommunity({...input,object:{...input.object,artist:"Homónimo"}})).toThrow(/documental/);
 const changed=html.replace('<span>5.0</span>','<span>10.0</span>');
 expect(()=>extractReleaseCommunity({...input,html:changed,expectedHash:hashText(changed)})).toThrow(/Escala/);
 const wrong=html.replace('/test/release/','/other/release/');
 expect(()=>extractReleaseCommunity({...input,html:wrong,expectedHash:hashText(wrong)})).toThrow(/Identidad/);
});
it("la falta de nota comunitaria permanece explícita y no equivale a cero",()=>{
 const changed=html.replace('<span class="avg_rating">4.01</span>','');
 expect(extractReleaseCommunity({...input,html:changed,expectedHash:hashText(changed)}).rating).toBeNull();
});
const roots:string[]=[];
afterEach(async()=>{await Promise.all(roots.splice(0).map(root=>rm(root,{recursive:true,force:true})));});
async function crossingFixture(){
 const root=await mkdtemp(path.join(os.tmpdir(),"crv-cross-test-"));roots.push(root);
 const folder=path.join(root,"docs/unified-search/stage2");await mkdir(folder,{recursive:true});
 await writeFile(path.join(root,"capture.html"),html);
 const metadata=JSON.stringify({href:"/release/album/test/release/",capturedAt:input.capturedAtOriginal});
 await writeFile(path.join(root,"capture.json"),metadata);
 // This isolated fixture uses only the inherited Ambient definition. Full
 // source snapshots are verified by search-genre-source-captures.test.ts.
 const book=JSON.parse(await readFile("docs/unified-search/stage2/genre-descriptions.json","utf8"));
 await writeFile(path.join(folder,"genre-descriptions.json"),JSON.stringify({version:"crossing-fixture-v1",analyst:"Test fixture",policy:book.policy,descriptions:book.descriptions.filter((d:{slug:string})=>d.slug==="ambient")}));
 const track=knowledgeFixture();track.id="track-claim";track.object={...track.object,kind:"track",id:2,name:"Track"};
 const album=structuredClone(track);album.id="album-claim";album.object={...album.object,kind:"album",id:1,name:"Release"};
 const annotations=[track,album];
 await writeFile(path.join(folder,"community-crossing.json"),JSON.stringify({version:"test-v1",analyst:"test",captures:[{albumId:1,html:"capture.html",metadata:"capture.json",htmlHash:hashText(html),metadataHash:hashText(metadata)}],
 readings:annotations.map(a=>({annotationId:a.id,terms:["instrumental","male vocalist"],communityRelation:a.object.kind==="track"?"unresolved":"refines",communityReason:"Album context only",genres:["ambient"],genreRelation:"unresolved",genreReason:"General knowledge only"}))}));
 const examined=[{release:"/release/album/test/release/",albumId:1,artistName:"Artist",albumName:"Release",reviewIds:[track.observation.reviewId!],trackIds:[2],identityEvidence:["accepted exact URL claim"]}];
 return {root,annotations,examined};
}
it("el cruce no suma testigos, traslada tags a pistas ni muestra notas al modelo",async()=>{
 const {root,annotations,examined}=await crossingFixture();
 const result=await crossStudySources(root,annotations,examined);
 const repeated=await crossStudySources(root,result.annotations,examined);
 expect(result).toEqual(repeated);
 expect(result.crossings.every(c=>c.additionalWitnesses===0&&!c.entityAssignmentsAuthorized)).toBe(true);
 expect(result.crossings.every(c=>c.interpretationChangedAfterContext===null&&c.contextComparisonStatus==="not_evaluated")).toBe(true);
 expect(new Set(result.annotations.map(a=>a.observation.extractorVersion)).size).toBe(1);
 const track=result.annotations[0]!;
 expect(track.layers.community.every(c=>c.object?.kind==="album"&&c.object.id!==track.object.id)).toBe(true);
 expect(result.crossings[0]!.community.relation).toBe("unresolved");
 expect(analyzePattern([track]).distinctAccounts).toBe(analyzePattern([annotations[0]!]).distinctAccounts);
 expect(track.assertion).toEqual(annotations[0]!.assertion);
 expect(track.layers.community.filter(c=>["instrumental","male vocalist"].includes(c.term))).toHaveLength(2);
 expect(knowledgeModelState(track)).not.toHaveProperty("layers");
});
it("rechaza una pista ajena al álbum aunque la reseña tenga un ID válido",async()=>{
 const {root,annotations,examined}=await crossingFixture();annotations[0]!.object.id=999999;
 await expect(crossStudySources(root,annotations,examined)).rejects.toThrow(/relación documental/);
});

it("un tag de álbum no confirma un atributo de un segmento",async()=>{
 const {root,annotations,examined}=await crossingFixture();annotations[1]!.object.segment="Introducción";
 await expect(crossStudySources(root,annotations,examined)).rejects.toThrow(/segmento/);
});

it("ampliar el corte conserva la versión de lectura de una captura ya anotada",async()=>{
 const {root,annotations,examined}=await crossingFixture();
 const before=await crossStudySources(root,annotations,examined);
 const filename=path.join(root,"docs/unified-search/stage2/community-crossing.json");
 const config=JSON.parse(await readFile(filename,"utf8"));
 config.captures.forEach((capture:{readingVersion?:string})=>{capture.readingVersion=config.version;});
 config.version="test-v2";await writeFile(filename,JSON.stringify(config));
 const after=await crossStudySources(root,annotations,examined);
 expect(after.annotations).toEqual(before.annotations);expect(after.version).toBe("test-v2");
});
