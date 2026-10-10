import type { WebPage } from "../ambiguity/web-search.js";
import { fold } from "./proof.js";
export function pageExcerpt(page:WebPage,terms:string[]):string {
  if(page.content.length<=18000)return page.content;
  // La tabla de offsets conserva citas con la escritura original, aunque la
  // búsqueda ignore tildes y compacte espacios.
  let normalized="";const offsets:number[]=[];let rawOffset=0;
  for(const char of page.content){
    const token=char.normalize("NFKD").replace(/\p{M}/gu,"").toLowerCase();
    for(const letter of token){
      const value=/\s/u.test(letter)?" ":letter;
      if(value===" "&&normalized.endsWith(" "))continue;
      normalized+=value;offsets.push(rawOffset);
    }
    rawOffset+=char.length;
  }
  const visualStart=page.content.indexOf("Recursos visuales de la página:");
  const visuals=visualStart>=0?` ${page.content.slice(visualStart).slice(0,10000)}`:"";
  const windows:Array<[number,number]>=[[0,2500]];
  for(const term of [...new Set(terms.map(fold))].filter(t=>t.length>=3)){
    let start=0;
    for(let n=0;n<3;n++){const position=normalized.indexOf(term,start);if(position<0)break;const raw=offsets[position]??0;windows.push([Math.max(0,raw-600),Math.min(page.content.length,raw+2600)]);start=position+term.length;}
  }
  windows.sort((a,b)=>a[0]-b[0]);const merged:Array<[number,number]>=[];
  for(const window of windows){const previous=merged.at(-1);if(previous&&window[0]<=previous[1])previous[1]=Math.max(previous[1],window[1]);else merged.push(window);}
  return merged.map(([start,end])=>page.content.slice(start,end)).join(" [...] ").slice(0,24000-visuals.length)+visuals;
}
