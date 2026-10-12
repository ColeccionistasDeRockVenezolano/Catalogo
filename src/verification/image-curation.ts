import {isDecorativeImageUrl} from "../ambiguity/page-images.js";
import {proposeImageCandidate,type ImageEntityKind} from "../merge/image-candidates.js";
import {withOperatorRun,type OperatorContext} from "../merge/operator.js";
import {words} from "./proof.js";
import type {VerificationFinding,VerificationReport} from "./types.js";

interface ImageTarget{kind:ImageEntityKind;id:number;name:string;currentUrl:string|null;aliases?:string[];}
/** Route by explicit finding or documented image role; an artist and its debut may share a name. */
export function imageTarget(finding:VerificationFinding,artist:ImageTarget|undefined,albums:ImageTarget[]):ImageTarget|undefined{
  const explicit=/^album\.(\d+)\.cover$/u.exec(finding.key);
  if(explicit)return albums.find(a=>a.id===Number(explicit[1]));
  if(finding.key==="images.profile")return artist;
  const contexts=finding.context.map(value=>words(value.replace(/\s*\((?:álbum|album|cd|bonus track version|deluxe edition|expanded edition|special edition)\)\s*/giu," ")));
  const albumMatches=albums.filter(a=>[a.name,...(a.aliases??[])].some(name=>contexts.includes(words(name))));
  const proof=finding.evidence.filter(e=>e.quote.includes(finding.observed??" ")).map(e=>{
    const at=e.quote.indexOf(finding.observed!);
    const start=e.quote.lastIndexOf("Imagen:",at);
    const end=e.quote.indexOf(" · ",at);
    return start>=0?e.quote.slice(start,end<0?undefined:end):e.quote;
  }).join(" ");
  const portrait=/retrato|portrait|foto de perfil|profile|biograf|\/cantantes\/|\/people\//iu.test(proof);
  const explicitCover=/portada|cover|artwork|\bdisco\b|\/discos\/|\bálbum\b|\balbum\b/iu.test(proof);
  const cover=explicitCover||(!portrait&&finding.evidence.some(e=>/\/album\//iu.test(e.url)));
  if(cover&&!portrait&&albumMatches.length===1)return albumMatches[0];
  if(artist&&contexts.includes(words(artist.name))&&!cover)return artist;
  if(albumMatches.length===1&&(!artist||words(albumMatches[0]!.name)!==words(artist.name)))return albumMatches[0];
  return undefined;
}

/** Queue every documented alternative, preserving prior decisions and leaving principal images untouched. */
export async function queueVerificationImages(report:VerificationReport,operator:string,context?:OperatorContext):Promise<{proposed:number;unmatched:number}>{
  const images=[...report.findings,...(report.suggestions??[])].filter(f=>f.area==="images"&&f.observed&&f.evidence.some(e=>e.origin==="page"&&e.quote.includes(f.observed!))&&!isDecorativeImageUrl(f.observed!));
  if(!images.length||!['artist','album'].includes(report.kind))return {proposed:0,unmatched:0};
  if(!context)return (await withOperatorRun({name:"verification.image-candidates",operator,note:`Imágenes documentadas en la investigación de ${report.name}`,params:{kind:report.kind,entityId:report.entityId}},next=>queueVerificationImages(report,operator,next))).result;
  const artistRows=await context.client.query<{id:number;name:string;current_url:string|null}>(report.kind==="artist"?
    "SELECT id,name,picture_url AS current_url FROM public.artists WHERE id=$1":
    "SELECT ar.id,ar.name,ar.picture_url AS current_url FROM public.artists ar JOIN public.albums a ON a.artist_id=ar.id WHERE a.id=$1",[report.entityId]);
  const row=artistRows.rows[0];if(!row)return {proposed:0,unmatched:images.length};
  const artist:ImageTarget={kind:"artist",id:Number(row.id),name:row.name,currentUrl:row.current_url};
  const albumRows=await context.client.query<{id:number;title:string;cover_url:string|null;aliases:string[]}>(`SELECT a.id,a.title,a.cover_url,COALESCE(array_agg(al.alias) FILTER (WHERE al.alias IS NOT NULL),'{}') AS aliases FROM public.albums a LEFT JOIN ingest.album_aliases al ON al.album_id=a.id WHERE a.artist_id=$1 GROUP BY a.id`,[artist.id]);
  const albums:ImageTarget[]=albumRows.rows.map(a=>({kind:"album",id:Number(a.id),name:a.title,currentUrl:a.cover_url,aliases:a.aliases}));
  const candidates=images.map(f=>({f,target:imageTarget(f,artist,albums)}));
  const unmatched=candidates.filter(c=>!c.target).length;
  if(candidates.every(c=>!c.target))return {proposed:0,unmatched};
  const {client,runId}=context;
    let proposed=0;
    for(const {f,target} of candidates){
      if(!target)continue;
      const evidence=f.evidence.find(e=>e.origin==="page"&&e.quote.includes(f.observed!))!;
      const dimensions=/Dimensiones declaradas:\s*(\d+)\s*[×x]\s*(\d+)/iu.exec(evidence.quote);
      const result=await proposeImageCandidate(client,{kind:target.kind,targetId:target.id,currentUrl:target.currentUrl,candidateUrl:f.observed!,source:new URL(evidence.url).hostname,pageUrl:evidence.url,origin:"verificacion-fuentes",runId,width:dimensions?Number(dimensions[1]):null,height:dimensions?Number(dimensions[2]):null});
      if(result==="proposed")proposed++;
    }
  return {proposed,unmatched};
}
