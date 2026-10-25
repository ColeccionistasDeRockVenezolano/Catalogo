import { normalizeRymIdentity as norm } from './rym-identity.js';
import { rymTrackPositions, type RymTrackInput } from './rym-release-plan.js';

export interface ExistingRymTrack { id:number; title:string; disc_number:number; track_number:number; duration_seconds:number|null; aliases?:string[] }
const position=(t:{disc_number:number;track_number:number})=>`${t.disc_number}:${t.track_number}`;
type Wanted=NonNullable<ReturnType<typeof rymTrackPositions>>[number];

/** Adds only literal positions missing from an otherwise compatible list.
 * Every edition supplied must agree on its list. Existing recordings are never
 * deleted, renamed or reordered; differing durations remain undecided. */
export function planRymTrackEnrichment(current:ExistingRymTrack[], sources:RymTrackInput[][]):{
  added:Wanted[]; durations:Array<{id:number;seconds:number}>; withheld:string[];
} {
  const result={added:[] as Wanted[],durations:[] as Array<{id:number;seconds:number}>,withheld:[] as string[]};
  const lists=sources.filter(s=>s.length).map(s=>rymTrackPositions(s));
  if(!lists.length)return result;
  if(lists.some(s=>s===null)){result.withheld.push('ambiguous_source_positions');return result;}
  const valid=lists as Wanted[][];
  const canonicalAtPosition=(track:Wanted)=>{
    const old=current.find(t=>position(t)===position(track));
    return old&&[old.title,...(old.aliases??[])].some(t=>norm(t)===norm(track.title))?norm(old.title):norm(track.title);
  };
  const signature=(list:Wanted[])=>JSON.stringify(list.map(t=>[position(t),canonicalAtPosition(t)]));
  if(new Set(valid.map(signature)).size!==1){result.withheld.push('source_editions_disagree');return result;}
  const wanted=valid[0]!;
  if(wanted.some(t=>!norm(t.title))){result.withheld.push('title_without_identity_key');return result;}
  const byPosition=new Map(wanted.map(t=>[position(t),t]));
  const occupied=new Set<string>();
  for(const track of current){
    const key=position(track),target=byPosition.get(key);
    if(occupied.has(key)||!target||![track.title,...(track.aliases??[])].some(t=>norm(t)===norm(target.title))){
      result.withheld.push('existing_tracklist_differs');return result;
    }
    occupied.add(key);
  }
  result.added=wanted.filter(t=>!occupied.has(position(t)));
  for(const track of current){
    if(track.duration_seconds!==null && track.duration_seconds>0)continue;
    const seconds=[...new Set(valid.map(list=>list.find(t=>position(t)===position(track))?.duration_seconds).filter((n):n is number=>n!==undefined&&n>0))];
    if(seconds.length===1)result.durations.push({id:track.id,seconds:seconds[0]!});
  }
  // A newly added recording also needs consensus before assigning duration.
  result.added=result.added.map(track=>{
    const seconds=[...new Set(valid.map(list=>list.find(t=>position(t)===position(track))?.duration_seconds).filter((n):n is number=>n!==undefined&&n>0))];
    const {duration_seconds:duration,...rest}=track;
    void duration;
    return seconds.length===1?{...rest,duration_seconds:seconds[0]!}:rest;
  });
  return result;
}
