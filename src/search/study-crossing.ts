import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { annotationSchema, type KnowledgeAnnotation } from "./knowledge-contracts.js";
import { readGenreKnowledge } from "./genre-map.js";
import { extractReleaseCommunity } from "./rym-release-community.js";
import { hashText } from "./review-protocol.js";

const text=z.string().trim().min(1),hash=z.string().regex(/^[a-f0-9]{64}$/);
export const crossingConfigSchema=z.object({version:text,analyst:text,
  captures:z.array(z.object({albumId:z.number().int().positive(),html:text,metadata:text,htmlHash:hash,metadataHash:hash,readingVersion:text.optional()}).strict()),
  readings:z.array(z.object({annotationId:text,terms:z.array(text).min(1),communityRelation:z.enum(["supports","refines","disagrees","unresolved"]),communityReason:text,
    genres:z.array(text).min(1),genreRelation:z.enum(["supports","refines","disagrees","unresolved"]),genreReason:text}).strict()),
}).strict().superRefine((c,ctx)=>{
  if(new Set(c.captures.map(r=>r.albumId)).size!==c.captures.length||new Set(c.readings.map(r=>r.annotationId)).size!==c.readings.length)ctx.addIssue({code:"custom",message:"Captura o anotación duplicada en el cruce"});
});
export interface ExaminedRelease {release:string;albumId:number;artistName:string;albumName:string;sourceTitle?:string;sourceArtist?:string;reviewIds:string[];trackIds:number[];identityEvidence:string[]}
/** Crosses four named authorities without voting, inheriting parent tags, or
 * allowing general style descriptions to count as observations of a recording. */
export async function crossStudySources(root:string,input:KnowledgeAnnotation[],examined:ExaminedRelease[]) {
  const raw=await readFile(path.join(root,"docs/unified-search/stage2/community-crossing.json"),"utf8"),config=crossingConfigSchema.parse(JSON.parse(raw));
  const knowledge=await readGenreKnowledge(root),annotations=input.map(a=>annotationSchema.parse(a));
  for(const r of config.readings)if(!annotations.some(a=>a.id===r.annotationId))throw new Error(`Cruce sin anotación: ${r.annotationId}`);
  const captures=await Promise.all(config.captures.map(async c=>{
    const album=examined.find(r=>r.albumId===c.albumId);if(!album)throw new Error("Captura sin identidad de álbum documentada");
    const [html,metadata]=await Promise.all([readFile(path.join(root,c.html),"utf8"),readFile(path.join(root,c.metadata),"utf8")]);
    if(hashText(metadata)!==c.metadataHash)throw new Error("Metadatos de captura cambiaron");
    const meta=z.object({href:text,capturedAt:text}).passthrough().parse(JSON.parse(metadata));
    if(meta.href.replace(/\/$/u,"")!==album.release.replace(/\/$/u,""))throw new Error("Manifiesto comunitario refiere otra publicación");
    const capture=extractReleaseCommunity({html,expectedHash:c.htmlHash,source:`https://rateyourmusic.com${album.release}`,capturedAtOriginal:meta.capturedAt,
      object:{kind:"album",id:album.albumId,name:album.sourceTitle??album.albumName,artist:album.sourceArtist??album.artistName,identityEvidence:album.identityEvidence}});
    return {capture,manifest:c};
  }));
  const versions=new Map(captures.map(({capture,manifest})=>{
    const owner=examined.find(e=>e.albumId===capture.object.id)!;
    const readingIds=new Set(input.filter(a=>a.observation.reviewId!==null&&owner.reviewIds.includes(a.observation.reviewId)).map(a=>a.id));
    const readings=config.readings.filter(r=>readingIds.has(r.annotationId));
    const definitions=knowledge.descriptions.filter(d=>readings.some(r=>r.genres.includes(d.slug)));
    const {readingVersion,...captureManifest}=manifest;
    return [capture.object.id,hashText(JSON.stringify([readingVersion??config.version,config.analyst,captureManifest,readings,definitions])).slice(0,12)];
  }));
  const crossings=annotations.map(a=>{
    const reading=config.readings.find(r=>r.annotationId===a.id);if(!reading)throw new Error(`Anotación sin cruce explícito: ${a.id}`);
    const owners=examined.filter(e=>a.observation.reviewId!==null&&e.reviewIds.includes(a.observation.reviewId));
    if(owners.length!==1)throw new Error(`Reseña sin publicación única documentada: ${a.id}`);
    const linked=captures.find(c=>c.capture.object.id===owners[0]!.albumId);
    if(!linked)throw new Error(`Captura comunitaria ausente: ${a.id}`);
    const {capture}=linked;
    if(a.object.kind==="album"&&a.object.id!==capture.object.id)throw new Error("Objeto de anotación y publicación de reseña no coinciden");
    if(!["album","track"].includes(a.object.kind)||a.object.kind==="track"&&!owners[0]!.trackIds.includes(a.object.id!))throw new Error("Pista sin relación documental con el álbum de la reseña");
    if((a.object.kind!=="album"||a.object.segment!==null)&&reading.communityRelation!=="unresolved")throw new Error("Un tag de álbum no sustenta un atributo de pista o segmento");
    for(const term of reading.terms)if(!capture.terms.some(t=>t.term===term))throw new Error(`Término no presente en la ficha: ${term}`);
    const definitions=reading.genres.map(slug=>{
      const definition=knowledge.descriptions.find(d=>d.slug===slug);if(!definition)throw new Error(`Definición ausente: ${slug}`);
      return {slug,version:definition.version,mapVersion:knowledge.version,hash:hashText(JSON.stringify(definition)),status:definition.status,relation:reading.genreRelation,reason:reading.genreReason};
    });
    a.layers.community=capture.terms.map(t=>({term:t.term,level:t.level,source:capture.source,measure:null,capturedAt:null,
      capturedAtOriginal:capture.capturedAtOriginal,captureTimeZone:null,captureHash:capture.captureHash,resourceId:t.resourceId,locator:t.locator,object:{kind:"album",id:capture.object.id}}));
    a.layers.communityRating=capture.rating?{rating:{value:capture.rating.value,minimum:capture.rating.minimum,maximum:capture.rating.maximum,object:`album:${capture.object.id}`},votes:capture.rating.votes,
      capturedAt:null,capturedAtOriginal:capture.capturedAtOriginal,captureTimeZone:null,source:capture.source,captureHash:capture.captureHash,locator:capture.rating.locator}:null;
    a.layers.genreKnowledge=definitions.map(d=>({reference:`${d.version}:${d.slug}:${d.hash}`,relation:d.relation}));
    a.analysis.uncertainty="Cuatro procedencias cruzadas por separado; tags de álbum no se trasladan a pistas. Definiciones propuestas no acreditan rasgos de obras. Edición desconocida; independencia musical no acreditada.";
    a.observation.extractorVersion=`${a.observation.extractorVersion.split("+cross:")[0]}+cross:v1:${versions.get(capture.object.id)}`;
    return {annotationId:a.id,object:a.object,review:{source:a.observation.source,captureHash:a.observation.captureHash,account:a.observation.account,state:a.assertion.state},
      community:{object:capture.object,source:capture.source,captureHash:capture.captureHash,terms:reading.terms,relation:reading.communityRelation,reason:reading.communityReason},
      genreKnowledge:definitions,individualRating:{value:a.layers.individualRating,relation:"evaluation_only_not_support"},communityRating:{value:a.layers.communityRating,relation:"community_evaluation_not_witness"},
      // Crossing metadata is not a blind before/after annotation experiment.
      // Without those two readings there is no evidence of change or stability.
      interpretationChangedAfterContext:null,contextComparisonStatus:"not_evaluated" as const,
      additionalWitnesses:0,entityAssignmentsAuthorized:false};
  });
  return {version:config.version,annotations:annotations.map(a=>annotationSchema.parse(a)),crossings,
    manifest:captures.map(({capture,manifest})=>({...manifest,source:capture.source,capturedAtOriginal:capture.capturedAtOriginal,capturedAt:null,captureTimeZone:null})),
    policy:"four_authorities_separate_no_parent_inheritance_no_rating_truth_weight",independentValidation:false};
}
