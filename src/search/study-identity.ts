import { readFile } from "node:fs/promises";
import path from "node:path";
import { load } from "cheerio";
import { z } from "zod";
import { getPool } from "../db/client.js";
import { hashText } from "./review-protocol.js";
import type { Pool, PoolClient } from "pg";

const text=z.string().trim().min(1),hash=z.string().regex(/^[a-f0-9]{64}$/);
export const studyReleaseSchema=z.object({
  release:text,albumId:z.number().int().positive(),artistId:z.number().int().positive(),
  identityMethod:z.enum(["accepted_rym_title","accepted_title_and_repertoire","operator_import_plan"]),claimId:text.nullable(),importPlan:text.nullable(),
  html:text,metadata:text,htmlHash:hash,metadataHash:hash,
  studyRole:z.literal("pilot_reanalysis").optional(),
  rationale:text,gaps:text,stratum:z.enum(["multiple_review_pages","single_release_page_exception"]),
}).strict();
export const studyReleaseFileSchema=z.object({version:text,releases:z.array(studyReleaseSchema).min(1)}).strict().superRefine((f,ctx)=>{
  if(new Set(f.releases.map(r=>r.release.replace(/\/$/u,""))).size!==f.releases.length)ctx.addIssue({code:"custom",message:"Publicación de estudio duplicada"});
});
export type StudyRelease=z.infer<typeof studyReleaseSchema>;
export const studyReserveSchema=z.object({version:text,releases:z.array(text).min(1)}).strict().superRefine((f,ctx)=>{
  if(new Set(f.releases.map(r=>r.replace(/\/$/u,""))).size!==f.releases.length)ctx.addIssue({code:"custom",message:"Publicación reservada duplicada"});
});
export function assertDevelopmentSelection(selected:string[],reserved:string[]){
  const reserve=new Set(reserved.map(r=>r.replace(/\/$/u,"")));
  if(selected.some(r=>reserve.has(r.replace(/\/$/u,""))))throw new Error("La selección no puede abrir publicaciones de reserva");
}
/** Case and Unicode composition are typography; punctuation/accents are not aliases. */
export const identityLabel=(value:string)=>value.normalize("NFC").replace(/\s+/gu," ").trim().toLocaleLowerCase("es");
export function verifyRepertoire(html:string,tracks:Array<{id:number;title:string;track_number:number|null}>) {
  const $=load(html),labels=new Map<string,string>();
  $(".tracklist_line").each((_,el)=>{
    if($(el).closest('.review_body,[id^="review_shell_"],[id^="review_track_rating_"]').length)return;
    const label=$(el).find(".tracklist_num").first().text().trim();
    const title=$(el).find('.tracklist_title [itemprop="name"]').first().text().trim();
    if(!title)return;
    if(!/^(?:[1-9]\d*|[A-Z][1-9]\d*)$/u.test(label))throw new Error("Numeración de repertorio requiere revisión");
    const prior=labels.get(label);
    if(prior&&identityLabel(prior)!==identityLabel(title))throw new Error("Posición de repertorio con títulos contradictorios");
    if(!prior)labels.set(label,title);
  });
  const vinyl=[...labels.keys()].some(label=>/^[A-Z]/u.test(label));
  let side="A",number=0;
  const source=[...labels].map(([label,title],index)=>{
    if(!vinyl)return {position:Number(label),title};
    const match=label.match(/^([A-Z])([1-9]\d*)$/u);
    if(!match)throw new Error("Numeración mixta de repertorio requiere revisión");
    if(match[1]!==side){
      if(match[1]!==String.fromCharCode(side.charCodeAt(0)+1)||number===0)throw new Error("Secuencia de lados incompleta o desordenada");
      side=match[1]!;number=0;
    }
    if(Number(match[2])!==number+1)throw new Error("Secuencia de lados incompleta o desordenada");
    number++;
    return {position:index+1,title,sourcePosition:label};
  });
  const matches=source.flatMap(s=>{
    const candidates=tracks.filter(t=>t.track_number===s.position&&identityLabel(t.title)===identityLabel(s.title));
    return candidates.length===1?[{sourceTitle:s.title,position:s.position,...("sourcePosition" in s?{sourcePosition:s.sourcePosition}:{}),trackId:candidates[0]!.id,catalogTitle:candidates[0]!.title}]:[];
  });
  if(matches.length<3||matches.length/source.length<0.75||matches.length/tracks.length<0.75)throw new Error("Repertorio insuficiente o ambiguo para vincular publicación y catálogo");
  return {method:vinyl?"title_artist_and_vinyl_side_sequence-v1":"title_artist_and_ordered_repertoire-v1",sourceTracks:source.length,catalogTracks:tracks.length,matches,
    unmatchedSource:source.filter(s=>!matches.some(m=>m.position===s.position&&identityLabel(m.sourceTitle)===identityLabel(s.title))),
    unmatchedCatalog:tracks.filter(t=>!matches.some(m=>m.trackId===t.id)),edition:"unknown"};
}
export async function resolveStudyRelease(root:string,input:StudyRelease,database?:Pool|PoolClient) {
  const spec=studyReleaseSchema.parse(input);
  const [html,metadataText]=await Promise.all([readFile(path.join(root,spec.html),"utf8"),readFile(path.join(root,spec.metadata),"utf8")]);
  if(hashText(html)!==spec.htmlHash||hashText(metadataText)!==spec.metadataHash)throw new Error("Captura de identidad cambió: revisar corte");
  const meta=z.object({href:text,rec:z.object({name:text,artist:text}).passthrough()}).passthrough().parse(JSON.parse(metadataText));
  const $=load(html),canonical=$('meta[property="og:url"]').attr("content"),title=$(".album_title").first().clone();title.find("input,div").remove();
  const sourceArtist=$(".album_title .artist").first().text().trim(),sourceTitle=title.text().trim();
  const sourceUrl=`https://rateyourmusic.com${spec.release}`;
  if(!canonical||canonical.replace(/\/$/u,"")!==sourceUrl.replace(/\/$/u,"")||meta.href.replace(/\/$/u,"")!==spec.release.replace(/\/$/u,""))throw new Error("URL de identidad no coincide");
  if(sourceTitle!==meta.rec.name||sourceArtist!==meta.rec.artist)throw new Error("Encabezado y metadatos discrepan");
  database??=getPool();
  const album=(await database.query("SELECT a.id,a.title,a.artist_id,r.name AS artist_name FROM public.albums a JOIN public.artists r ON r.id=a.artist_id WHERE a.id=$1",[spec.albumId])).rows[0];
  if(!album||Number(album.artist_id)!==spec.artistId||identityLabel(album.title)!==identityLabel(sourceTitle)||identityLabel(album.artist_name)!==identityLabel(sourceArtist))throw new Error("Identidad de álbum/artista requiere revisión");
  const tracks=(await database.query("SELECT id,title,track_number FROM public.tracks WHERE album_id=$1 ORDER BY track_number,id",[spec.albumId])).rows.map(t=>({id:Number(t.id),title:String(t.title),track_number:t.track_number===null?null:Number(t.track_number)}));
  const claims=(await database.query(`SELECT c.id,e.url FROM ingest.claims c JOIN ingest.claim_evidence e ON e.claim_id=c.id WHERE c.album_id=$1 AND c.field='title' AND c.status='accepted'`,[spec.albumId])).rows;
  let identityEvidence:string[],repertoire:ReturnType<typeof verifyRepertoire>|null=null;
  if(spec.identityMethod==="accepted_rym_title"){
    const claim=claims.find(c=>c.url.replace(/\/$/u,"")===sourceUrl.replace(/\/$/u,""));if(!claim)throw new Error("Falta claim aceptado de URL RYM exacta");
    identityEvidence=[`ingest.claims:${claim.id}; título aceptado y URL de publicación RYM exacta`];
  }else{
    if(!spec.claimId||!claims.some(c=>String(c.id)===spec.claimId))throw new Error("Falta claim aceptado del título en este álbum");
    if(spec.identityMethod==="operator_import_plan"){
      if(!spec.importPlan)throw new Error("Falta plan de vínculo documental");
      const plan=(await readFile(path.join(root,spec.importPlan),"utf8")).trim().split("\n").map(line=>JSON.parse(line));
      if(!plan.some(p=>p.rym_href?.replace(/\/$/u,"")===spec.release.replace(/\/$/u,"")&&p.parent?.artist_id===spec.artistId&&p.values?.title===album.title))throw new Error("Plan de importación no acredita la publicación");
      identityEvidence=[`ingest.claims:${spec.claimId}; título aceptado`,`${spec.importPlan}: RYM href exacto + artist_id ${spec.artistId} + título; edición desconocida`];
    }else{
      repertoire=verifyRepertoire(html,tracks);
      identityEvidence=[`ingest.claims:${spec.claimId}; título aceptado del álbum ${spec.albumId}`,`URL canónica y encabezados RYM; artista ${spec.artistId}; ${repertoire.matches.length}/${repertoire.sourceTracks} títulos y posiciones cotejados con IDs de pistas existentes; ${repertoire.method==="title_artist_and_vinyl_side_sequence-v1"?"secuencia explícita de lados conservada y cotejada con numeración lineal; no identifica edición":"solo normalización de mayúsculas y Unicode"}; edición desconocida`];
    }
  }
  return {album:{id:spec.albumId,title:String(album.title),artist_id:spec.artistId},artistName:String(album.artist_name),sourceTitle,sourceArtist,tracks,identityEvidence,repertoire};
}
