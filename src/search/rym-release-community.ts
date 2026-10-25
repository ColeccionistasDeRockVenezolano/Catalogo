import { load } from "cheerio";
import { z } from "zod";
import { hashText } from "./review-protocol.js";

const value=z.string().trim().min(1);
export const releaseCommunitySchema=z.object({
  version:z.literal("rym-release-community-v1"),source:z.string().url(),captureHash:z.string().regex(/^[a-f0-9]{64}$/),
  capturedAt:z.string().datetime().nullable(),capturedAtOriginal:value,captureTimeZone:value.nullable(),
  object:z.object({kind:z.literal("album"),id:z.number().int().positive(),name:value,artist:value,identityEvidence:z.array(value).min(1)}).strict(),
  terms:z.array(z.object({term:value,level:z.enum(["primary","secondary","descriptor"]),locator:value,resourceId:z.enum(["R01","R02"])}).strict()),
  rating:z.object({value:z.number().min(0.5).max(5),minimum:z.literal(0.5),maximum:z.literal(5),votes:z.number().int().nonnegative().nullable(),locator:value}).strict().nullable(),
  policy:z.literal("community_signals_not_witnesses_or_entity_assignments"),
}).strict();
export type ReleaseCommunity=z.infer<typeof releaseCommunitySchema>;
const normal=(s:string)=>s.replace(/\s+/gu," ").trim();
function releaseUrl(source:string){
  const url=new URL(source);
  if(url.protocol!=="https:"||url.hostname!=="rateyourmusic.com"||url.username||url.password||url.search||url.hash||!url.pathname.startsWith("/release/"))throw new Error("URL de publicación RYM inválida");
  return url.origin+url.pathname.replace(/\/$/u,"");
}
/** Reads metadata from its own immutable release capture, never the review body.
 * The supplied catalog link must already be documented; a matching name is insufficient. */
export function extractReleaseCommunity(input:{html:string;source:string;capturedAtOriginal:string;expectedHash:string;object:ReleaseCommunity["object"]}) : ReleaseCommunity {
  const hash=hashText(input.html);if(hash!==input.expectedHash)throw new Error("Captura comunitaria cambió; revisar el corte");
  const $=load(input.html),canonical=$('meta[property="og:url"]').attr("content")??$('link[rel="canonical"]').attr("href");
  if(!canonical||releaseUrl(canonical)!==releaseUrl(input.source))throw new Error("Identidad de publicación comunitaria no coincide");
  const title=$(".album_title").first().clone();title.find("input,div").remove();
  if(normal(title.text())!==input.object.name||normal($(".album_title .artist").first().text())!==input.object.artist||!input.object.identityEvidence.length)throw new Error("Encabezado o vínculo documental comunitario no coincide");
  const terms:ReleaseCommunity["terms"]=[];
  for(const [selector,level] of [[".release_pri_genres a.genre","primary"],[".release_sec_genres a.genre","secondary"],[".release_descriptors meta[content]","descriptor"]] as const){
    const seen=new Set<string>();$(selector).each((_,el)=>{
      const term=normal(level==="descriptor"?$(el).attr("content")??"":$(el).text());
      if(term&&!seen.has(term)){terms.push({term,level,locator:`${selector} [literal=${JSON.stringify(term)}]`,resourceId:level==="descriptor"?"R02":"R01"});seen.add(term);}
    });
  }
  const scoreText=normal($(".avg_rating").first().text()),votesText=normal($(".num_ratings b").first().text()).replace(/,/gu,"");
  const score=scoreText?Number(scoreText):null;
  if(score!==null&&!Number.isFinite(score))throw new Error("Nota comunitaria ilegible");
  const scale=$(".avg_rating").first().parent().find(".max_rating > span");
  if(score!==null&&(Number(scale.first().text())!==5||Number(scale.last().text())!==0.5))throw new Error("Escala comunitaria no documentada");
  if(votesText&&!/^\d+$/u.test(votesText))throw new Error("Votos comunitarios ilegibles");
  return releaseCommunitySchema.parse({version:"rym-release-community-v1",source:input.source,captureHash:hash,
    capturedAt:null,capturedAtOriginal:input.capturedAtOriginal,captureTimeZone:null,object:input.object,terms,
    rating:score===null?null:{value:score,minimum:0.5,maximum:5,votes:votesText?Number(votesText):null,locator:".avg_rating; .num_ratings b"},
    policy:"community_signals_not_witnesses_or_entity_assignments"});
}
