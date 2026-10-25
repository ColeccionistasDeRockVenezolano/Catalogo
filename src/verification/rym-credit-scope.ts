import {rymTrackPositions,type RymTrackInput} from './rym-release-plan.js';

/** A credit range addresses literal labels in this edition's primary list.
 * No duration, title similarity or number on another disc establishes a scope. */
export function rymCreditScope(raw:string,source:RymTrackInput[]):ReturnType<typeof rymTrackPositions>{
 const tracks=rymTrackPositions(source);if(!tracks)return null;
 const labels=source.map(t=>t.n.trim());
 const clean=raw.trim().replace(/^\(?tracks?\s*:?\s*/iu,'').replace(/\)$/u,'').replace(/[–—]/gu,'-');
 const result=new Set<number>();
 for(const token of clean.split(',').map(t=>t.trim())){
  const match=/^([A-Z]\d*|[1-9]\d*(?:\.[1-9]\d*)?)(?:\s*-\s*([A-Z]\d*|[1-9]\d*(?:\.[1-9]\d*)?))?$/u.exec(token);
  if(!match)return null;
  const from=labels.indexOf(match[1]!),to=match[2]?labels.indexOf(match[2]):from;
  if(from<0||to<from||to-from>500)return null;
  for(let i=from;i<=to;i++)result.add(i);
 }
 return [...result].sort((a,b)=>a-b).map(i=>tracks[i]!);
}
