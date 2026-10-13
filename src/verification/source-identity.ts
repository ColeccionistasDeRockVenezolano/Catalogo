import type {WebPage} from "../ambiguity/web-search.js";
import type {VerificationSnapshot} from "./types.js";
import {words} from "./proof.js";

const trustCache=new WeakMap<WebPage[],{length:number;snapshots:WeakMap<VerificationSnapshot,Set<string>>}>();
const originalText=new WeakMap<WebPage,string>();
function documentaryText(page:WebPage):string{
 const old=originalText.get(page);if(old!==undefined)return old;
 const bytes=Buffer.from(page.content,"utf8"),locations=page.document?.locations;
 const content=locations?locations.filter(location=>!location.context||location.context==="body"||location.context==="structured").filter(location=>!location.selector.includes("image-resources")&&!location.selector.includes("uncorroborated")).map(location=>bytes.subarray(location.start,location.end).toString("utf8")).join(" "):page.content;
 const text=` ${words(content)} `;originalText.set(page,text);return text;
}
function profileMatches(snapshot:VerificationSnapshot,page:WebPage):boolean{
 const profile=snapshot.identityProfile!;
 const text=documentaryText(page),names=profile.names.map(words).filter(Boolean);
 const regions=names.flatMap(name=>{
  const needle=` ${name} `,result:string[]=[];let start=0;
  while((start=text.indexOf(needle,start))>=0){result.push(text.slice(Math.max(0,start-700),start+needle.length+1600));start+=needle.length;}
  return result;
 });
 if(!regions.length)return false;
 const has=(region:string,value:string)=>value.trim().length>0&&region.includes(` ${words(value)} `);
 if(profile.artist)return regions.some(region=>has(region,profile.artist!)&&(!profile.album||has(region,profile.album)));
 const anchors=[...profile.legalNames,...profile.relatedNames,...profile.repertoire].filter(value=>words(value).length>=5&&!names.includes(words(value)));
 const country=words(profile.country??"");
 const countryMatches=(region:string)=>country&&(has(region,country)||country==="venezuela"&&/\bvenezolan[oa]s?\b|\bvenezuelan\b/u.test(region));
 return regions.some(region=>anchors.some(anchor=>has(region,anchor))||countryMatches(region)&&/\bbanda\b|\bgrupo\b|\bband\b|\bmusic group\b|\bmusic artist\b|\bmusician\b|\bsongwriter\b|\bcantante\b|\bcantautor\b|\bsinger\b|\brapper\b|\brapero\b|\bmusico\b|\bcompositor\b|\bsello\b|\brecord label\b|\bdiscografica\b|\bestudio\b/u.test(region));
}
/** A solo artist's stage name alone cannot distinguish homonyms. */
export function sourceMatchesIdentity(snapshot:VerificationSnapshot,page:WebPage,pages:WebPage[]=[]):boolean{
  const legal=snapshot.units.find(u=>u.key==="identity.realName")?.value;
  if(!snapshot.identityProfile&&(snapshot.kind!=="artist"||!legal))return true;
  const names=snapshot.identity.map(words);
  const anchors=[...(legal?[legal]:[]),...snapshot.catalogAlbums.map(a=>a.title).filter(title=>!names.includes(words(title))&&words(title).length>=5)].map(words);
  const direct=(candidate:WebPage)=>{
    if(snapshot.identityProfile)return profileMatches(snapshot,candidate);
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
      for(const url of parent.document?.followLinks??[])trusted.add(url);
    }
    cache.snapshots.set(snapshot,trusted);
  }
  return trusted.has(page.url);
}
