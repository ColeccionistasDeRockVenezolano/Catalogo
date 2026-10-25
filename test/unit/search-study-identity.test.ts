import { expect, it } from "vitest";
import { assertDevelopmentSelection, identityLabel, studyReleaseFileSchema, verifyRepertoire } from "../../src/search/study-identity.js";
const tracks=[{id:1,title:"Árbol",track_number:1},{id:2,title:"Río",track_number:2},{id:3,title:"Final",track_number:3},{id:4,title:"¡Plis!",track_number:4}];
const html=(titles:string[])=>titles.map((title,i)=>`<div class="tracklist_line"><span class="tracklist_num">${i+1}</span><span class="tracklist_title"><a itemprop="name">${title}</a></span></div>`).join("");
it("vincula títulos y posiciones sin convertir una grafía distinta en alias",()=>{
 const source=html(["A\u0301RBOL","RÍO","final","Plis"]);
 const result=verifyRepertoire(source+source,tracks);
 expect(result.matches.map(m=>m.trackId)).toEqual([1,2,3]);
 expect(result.sourceTracks).toBe(4);expect(result.unmatchedSource).toEqual([{position:4,title:"Plis"}]);
 expect(result.unmatchedCatalog[0]!.title).toBe("¡Plis!");expect(result.edition).toBe("unknown");
 expect(identityLabel("ÁRBOL")).not.toBe(identityLabel("Arbol"));
});
it("rechaza mismo nombre con repertorio desordenado, insuficiente o ambiguo",()=>{
 expect(()=>verifyRepertoire(html(["Río","Árbol","Final","¡Plis!"]),tracks)).toThrow(/insuficiente/);
 expect(()=>verifyRepertoire(html(["Árbol","Río"]),tracks)).toThrow(/insuficiente/);
 const ambiguous=[...tracks,{id:5,title:"Árbol",track_number:1},{id:6,title:"Río",track_number:2}];
 expect(()=>verifyRepertoire(html(["Árbol","Río","Final","¡Plis!"]),ambiguous)).toThrow(/ambiguo/);
});
it("impide duplicar publicaciones con y sin barra final en la selección",()=>{
 const row={release:"/release/album/a/b/",albumId:1,artistId:1,identityMethod:"accepted_rym_title",claimId:null,importPlan:null,html:"capture.html",metadata:"capture.json",htmlHash:"a".repeat(64),metadataHash:"b".repeat(64),rationale:"test",gaps:"edition unknown",stratum:"multiple_review_pages"};
 expect(studyReleaseFileSchema.safeParse({version:"test",releases:[row,{...row,release:row.release.slice(0,-1)}]}).success).toBe(false);
});

it("la ampliación conserva la reserva aunque cambie el orden o la barra final",()=>{
 const reserve=["/release/album/arca/kick-i/","/release/album/arca/kick-iiiii/"];
 expect(()=>assertDevelopmentSelection(["/release/album/new/b/", "/release/album/arca/kick-i"],reserve)).toThrow(/reserva/);
 expect(()=>assertDevelopmentSelection(["/release/album/new/a/","/release/album/new/b/"],reserve)).not.toThrow();
});

it("coteja lados explícitos, conserva las etiquetas e ignora ratings en reseñas",()=>{
 const sides=(labels:string[])=>labels.map((label,i)=>`<div class="tracklist_line"><span class="tracklist_num">${label}</span><span class="tracklist_title"><a itemprop="name">${tracks[i]!.title}</a></span></div>`).join("");
 const source=sides(["A1","A2","B1","B2"]);
 const result=verifyRepertoire(source+source+`<div id="review_shell_std_99">${html(["Wrong","Review","Only"])}</div>`,tracks);
 expect(result.method).toBe("title_artist_and_vinyl_side_sequence-v1");
 expect(result.matches.map(m=>"sourcePosition" in m?m.sourcePosition:null)).toEqual(["A1","A2","B1","B2"]);
 expect(result.matches.map(m=>m.trackId)).toEqual([1,2,3,4]);expect(result.edition).toBe("unknown");
 for(const labels of [["A1","A3","B1","B2"],["B1","B2","C1","C2"],["A1","A2","C1","C2"],["A1","2","B1","B2"]])expect(()=>verifyRepertoire(sides(labels),tracks)).toThrow(/Secuencia|mixta/);
 expect(()=>verifyRepertoire(source+source.replace("Árbol","Otro título"),tracks)).toThrow(/contradictorios/);
});
