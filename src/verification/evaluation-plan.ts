import type { WebPage } from "../ambiguity/web-search.js";
import { fold } from "./evaluate.js";
import { contains, albumName } from "./proof.js";
import type { VerificationSnapshot } from "./types.js";

type Unit = VerificationSnapshot["units"][number];
export interface SourceChunk { source:number; page:WebPage; content:string; key:string }
/** One model call: a group of fragments read once, with the units it may support or contradict. */
export interface ReadingCall { group:number; part:number; chunks:SourceChunk[]; units:Unit[]; known:Unit[]; extract:boolean }

export const GROUP_CHARS=24000;
export const GROUP_FRAGMENTS=4;
export const UNITS_PER_CALL=60;

/** Album or track units belong to their album; every other unit concerns the whole entity. */
export function unitSubject(snapshot:Pick<VerificationSnapshot,"kind">,unit:Unit):string|null{
  if(snapshot.kind==="album"||!/^(album|tracks?)\.\d+/u.test(unit.key))return null;
  const title=/^album\.\d+\.title$/u.test(unit.key)?unit.expected[0]:unit.context[1];
  return title?.trim()?title:null;
}

/** A track title or position can only be documented by a fragment that names the track. */
function trackTitle(unit:Unit):string|null{
  return /^track\.\d+(?:\.order)?$/u.test(unit.key)&&unit.expected[0]?.trim()?unit.expected[0]:null;
}

function mentions(text:string,subject:string):boolean{
  return contains(text,subject)||contains(text,albumName(subject));
}

/** Fragments in source order, packed without splitting a fragment. */
export function readingGroups(chunks:SourceChunk[]):SourceChunk[][]{
  const groups:SourceChunk[][]=[];
  for(const fragment of chunks){
    const last=groups.at(-1);
    if(last&&last.length<GROUP_FRAGMENTS&&last.reduce((n,c)=>n+c.content.length,0)+fragment.content.length<=GROUP_CHARS)last.push(fragment);
    else groups.push([fragment]);
  }
  return groups;
}

/**
 * Every fragment is read once for new data in a call of its own. Separately the model checks the
 * entity-level units and the album/track units whose album the fragment mentions —
 * directly, through its page title, or in a neighbouring fragment of the same page,
 * since a tracklist continues after its heading. A unit whose album no fragment
 * mentions is reported as unsupported without a model call.
 */
export function readingPlan(snapshot:Pick<VerificationSnapshot,"kind">,units:Unit[],chunks:SourceChunk[],unitsPerCall=UNITS_PER_CALL):{calls:ReadingCall[];unsupported:Array<{unit:Unit;subject:string}>}{
  const albumCache=new Map<string,Set<SourceChunk>>();
  const albumChunks=(subject:string)=>{
    const key=fold(subject);const cached=albumCache.get(key);if(cached)return cached;
    const hit=chunks.map(chunk=>mentions(chunk.content,subject));
    const titled=new Set(chunks.filter(chunk=>mentions(chunk.page.title??"",subject)).map(chunk=>chunk.page));
    const result=new Set(chunks.filter((chunk,index)=>titled.has(chunk.page)||hit[index]||
      (index>0&&chunks[index-1]!.page===chunk.page&&hit[index-1])||(index+1<chunks.length&&chunks[index+1]!.page===chunk.page&&hit[index+1])));
    albumCache.set(key,result);return result;
  };
  const trackCache=new Map<string,Set<SourceChunk>>();
  const entity:Unit[]=[];
  const scoped:Array<{unit:Unit;chunks:Set<SourceChunk>}>=[];
  const unsupported:Array<{unit:Unit;subject:string}>=[];
  for(const unit of units){
    const subject=unitSubject(snapshot,unit);
    if(subject===null){entity.push(unit);continue;}
    const title=trackTitle(unit);
    let relevant=albumChunks(subject);
    if(title){
      const key=`${fold(subject)}\u0000${fold(title)}`;
      relevant=trackCache.get(key)??new Set([...relevant].filter(chunk=>mentions(chunk.content,title)));
      trackCache.set(key,relevant);
    }
    if(relevant.size)scoped.push({unit,chunks:relevant});
    else if(chunks.length)unsupported.push({unit,subject:title?`${title}» en «${subject}`:subject});
  }
  const calls:ReadingCall[]=[];
  readingGroups(chunks).forEach((group,index)=>{
    const groupUnits=[...entity,...scoped.filter(item=>group.some(chunk=>item.chunks.has(chunk))).map(item=>item.unit)];
    const parts=Math.ceil(groupUnits.length/unitsPerCall);
    for(let part=0;part<parts;part++)calls.push({group:index,part,chunks:group,units:groupUnits.slice(part*unitsPerCall,(part+1)*unitsPerCall),known:groupUnits,extract:false});
    // Exhaustive reading: each fragment also gets a call devoted only to extracting its facts,
    // so confirming units never crowds new data out of the answer.
    group.forEach((chunk,offset)=>calls.push({group:index,part:parts+offset,chunks:[chunk],units:[],known:groupUnits,extract:true}));
  });
  return {calls,unsupported};
}
