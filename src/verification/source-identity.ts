import type {WebPage} from "../ambiguity/web-search.js";
import type {VerificationSnapshot} from "./types.js";
import {words} from "./proof.js";

const trustCache=new WeakMap<WebPage[],{length:number;snapshots:WeakMap<VerificationSnapshot,Set<string>>}>();
/** A solo artist's stage name alone cannot distinguish homonyms. */
export function sourceMatchesIdentity(snapshot:VerificationSnapshot,page:WebPage,pages:WebPage[]=[]):boolean{
  const legal=snapshot.units.find(u=>u.key==="identity.realName")?.value;
  if(snapshot.kind!=="artist"||!legal)return true;
  const names=snapshot.identity.map(words);
  const anchors=[legal,...snapshot.catalogAlbums.map(a=>a.title).filter(title=>!names.includes(words(title))&&words(title).length>=5)].map(words);
  const direct=(candidate:WebPage)=>{
    const raw=`${candidate.title} ${candidate.content}`;
    const text=` ${words(raw)} `;
    return names.some(name=>text.includes(` ${name} `))&&(
      anchors.some(anchor=>text.includes(` ${anchor} `))||
      (/venezolan[oa]|venezuelan/iu.test(raw)&&/cantante|cantautor|singer|songwriter|compositor/iu.test(raw)));
  };
  if(!pages.length)return direct(page);
  let cache=trustCache.get(pages);
  if(!cache||cache.length!==pages.length){cache={length:pages.length,snapshots:new WeakMap()};trustCache.set(pages,cache);}
  let trusted=cache.snapshots.get(snapshot);
  if(!trusted){
    const parents=pages.filter(direct);
    trusted=new Set(parents.map(p=>p.url));
    // A documented artist discography establishes the identity of its linked releases.
    for(const parent of parents){
      const links=parent.content.split("Enlaces de la página:")[1]?.split("Recursos visuales de la página:")[0]??"";
      for(const raw of links.match(/https?:\/\/[^\s·]+/gu)??[]){
        try{
          const url=new URL(raw);
          const path=` ${words(decodeURIComponent(url.pathname))} `;
          if(url.hostname===new URL(parent.url).hostname&&/\/(?:album|albums|disco|release|releases)\//iu.test(url.pathname)&&names.some(name=>path.includes(` ${name} `)))trusted.add(url.href);
        }catch{ /* Invalid source link. */ }
      }
    }
    cache.snapshots.set(snapshot,trusted);
  }
  return trusted.has(page.url);
}
