import type {WebPage} from "../ambiguity/web-search.js";
import type {VerificationSnapshot} from "./types.js";
import {words} from "./proof.js";

/** Identity matching also separates letters from digits glued by lost line breaks ("venérea15) La torre"). */
const idWords=(value:string)=>words(value.replace(/(\p{L})(\d)/gu,"$1 $2").replace(/(\d)(\p{L})/gu,"$1 $2"));
const trustCache=new WeakMap<WebPage[],{length:number;snapshots:WeakMap<VerificationSnapshot,Set<string>>}>();
const originalText=new WeakMap<WebPage,string>();
function documentaryText(page:WebPage):string{
 const old=originalText.get(page);if(old!==undefined)return old;
 const bytes=Buffer.from(page.content,"utf8"),locations=page.document?.locations;
 const content=locations?locations.filter(location=>!location.context||location.context==="body"||location.context==="structured").filter(location=>!location.selector.includes("image-resources")&&!location.selector.includes("uncorroborated")).map(location=>bytes.subarray(location.start,location.end).toString("utf8")).join(" "):page.content;
 // The title often carries the only mention of the artist ("Banda – Disco (1996)") above a review that says "la banda".
 const text=` ${idWords(`${page.title} . ${content}`)} `;originalText.set(page,text);return text;
}
/** Venezuelan cities whose names are not also common words or foreign cities (no Valencia, Mérida, Barcelona or Coro). */
const VENEZUELAN_CITIES=/\b(?:caracas|maracaibo|barquisimeto|maracay|puerto ordaz|ciudad guayana|puerto la cruz|cumana|maturin|barinas|guarenas|petare|chacao|los teques|ciudad bolivar|acarigua|guanare|punto fijo|cabimas|san felix)\b/u;
/** What a musical subject is called: band, project, label or a musician's role, singular or plural. */
const MUSICAL_ROLE=/\b(?:bandas?|grupos?|agrupacion(?:es)?|bands?|music group|music artist|musicians?|songwriters?|cantantes?|cantautor(?:a|es)?|singers?|rappers?|raper[oa]s?|musicos?|compositor(?:a|es)?|sellos?|record label|discografica|estudio|tenor|soprano|baritono|mezzosoprano|solista|instrumentista|(?:clarinet|flaut|pian|guitarr|violin|violonchel|saxofon|trompet|percusion|bater|baj|teclad|cuatr|arp|contrabaj)istas?|director(?:a)? (?:de orquesta|musical)|arreglista|productor(?:a)? musical|dj|vocalists?|(?:guitar|pian|bass|keyboard|violin|saxophon|percussion)ists?|drummers?|trumpeters?|composers?|record producers?)\b/u;
/** A city named as the place of a show or tour is not the band's origin ("presentan un toque en la ciudad de Barquisimeto"). */
const VENUE_BEFORE=/\b(?:toques?|conciertos?|presentacion(?:es)?|presenta(?:n|ron)?|giras?|toca(?:n|ron)?|toco|festival(?:es)?|shows?)\b(?: \S+){0,6} $/u;
/** Demonyms that name the catalogued city as well as the city itself ("bandas caraqueñas"). */
const CITY_DEMONYMS:Record<string,RegExp>={caracas:/\bcaraquen[oa]s?\b/u,maracaibo:/\b(?:maracuchos?|maracuchas?|marabin[oa]s?)\b/u,barquisimeto:/\bbarquisimetan[oa]s?\b/u,maracay:/\bmaracayer[oa]s?\b/u};
/**
 * A person anchor also matches with a middle initial ("Arnold M. De Vries") and with one misread letter in a
 * long surname ("Gigiaqui" for "Gibiaqui"); the first name is always exact.
 */
function personPattern(name:string):RegExp|null{
 const parts=name.split(" ");if(parts.length<2)return null;
 const loose=(part:string)=>part.length<6?part:[part,...[...part].map((_,i)=>`${part.slice(0,i)}[a-z]${part.slice(i+1)}`)].join("|");
 return new RegExp(` ${parts[0]}${parts.slice(1).map(part=>`(?: [a-z])? (?:${loose(part)})`).join("")} `,"u");
}
/** Close surroundings of each mention, where a place usually belongs to the named band. */
function nearName(text:string,names:string[],reach=250):string[]{
 return names.flatMap(name=>{const needle=` ${name} `,result:string[]=[];let start=0;
  while((start=text.indexOf(needle,start))>=0){result.push(text.slice(Math.max(0,start-reach),start+needle.length+reach));start+=needle.length;}
  return result;});
}
function profileMatches(snapshot:VerificationSnapshot,page:WebPage):boolean{
 const profile=snapshot.identityProfile!;
 const text=documentaryText(page),names=profile.names.map(idWords).filter(Boolean);
 const regions=names.flatMap(name=>{
  const needle=` ${name} `,result:string[]=[];let start=0;
  while((start=text.indexOf(needle,start))>=0){result.push(text.slice(Math.max(0,start-700),start+needle.length+1600));start+=needle.length;}
  return result;
 });
 if(!regions.length)return false;
 const has=(region:string,value:string)=>value.trim().length>0&&region.includes(` ${idWords(value)} `);
 if(profile.artist)return regions.some(region=>has(region,profile.artist!)&&(!profile.album||has(region,profile.album)));
 const anchors=[...profile.legalNames,...profile.relatedNames,...profile.repertoire].filter(value=>idWords(value).length>=5&&!names.includes(idWords(value)));
 const country=idWords(profile.country??"");
 const countryMatches=(region:string)=>country&&(has(region,country)||country==="venezuela"&&(/\bvenezolan[oa]s?\b|\bvenezuelan\b/u.test(region)||VENEZUELAN_CITIES.test(region)));
 // Two distinct catalogued track titles near the name identify the repertoire; one title alone may be a cover or homonym.
 const tracks=[...new Set(snapshot.units.filter(unit=>/^track\.\d+$/u.test(unit.key)&&unit.value).map(unit=>idWords(unit.value!)))].filter(title=>title.length>=5&&!names.includes(title));
 const trackAnchored=(region:string)=>{let found=0;for(const title of tracks)if(region.includes(` ${title} `)&&++found>=2)return true;return false;};
 const people=[...profile.legalNames,...profile.relatedNames].map(value=>idWords(value)).filter(value=>value.length>=5&&!names.includes(value)).map(personPattern).filter((pattern):pattern is RegExp=>pattern!==null);
 if(regions.some(region=>anchors.some(anchor=>has(region,anchor))||people.some(pattern=>pattern.test(region))||trackAnchored(region)))return true;
 // Without a member or repertoire anchor, a name placed next to another Venezuelan city may be a
 // homonym of the same country (the Nemesis of Barquisimeto against the one from Caracas): review it.
 // A mention that also names the catalogued city stays, since fanzine columns run into each other.
 const city=idWords(snapshot.units.find(unit=>unit.key==="identity.city")?.value??"");
 const namesCity=(near:string)=>near.includes(` ${city} `)||Boolean(CITY_DEMONYMS[city]?.test(near));
 const otherCity=(near:string)=>[...near.matchAll(new RegExp(VENEZUELAN_CITIES.source,"gu"))].some(match=>match[0]!==city&&!VENUE_BEFORE.test(near.slice(Math.max(0,match.index-80),match.index)));
 if(city&&VENEZUELAN_CITIES.test(` ${city} `)&&nearName(text,names).some(near=>!namesCity(near)&&otherCity(near)))return false;
 return regions.some(region=>countryMatches(region)&&MUSICAL_ROLE.test(region));
}
/** A solo artist's stage name alone cannot distinguish homonyms. */
const siteOf=(url:string)=>{try{return new URL(url).hostname.replace(/^www\./u,"").toLowerCase();}catch{return null;}};
/** The first label of the host spells the name, whole or with the first names reduced to initials. */
function ownSite(host:string,names:string[]):boolean{
 const label=host.split(".")[0]!.replace(/[^a-z0-9]/gu,"");
 return names.some(name=>{const parts=name.split(" ").filter(Boolean);
  return [parts.join(""),...parts.slice(1).map((_,k)=>parts.slice(0,k+1).map(part=>part[0]).join("")+parts.slice(k+1).join(""))].some(form=>form.length>=6&&form===label);});
}
export function sourceMatchesIdentity(snapshot:VerificationSnapshot,page:WebPage,pages:WebPage[]=[]):boolean{
  // A document served from the record's catalogued official website is its own publication.
  const site=siteOf(page.url);
  if(site&&snapshot.units.some(unit=>unit.key==="social.website"&&unit.value&&siteOf(unit.value)===site))return true;
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
    // A site named after the subject ("jcperezsoto.com" for Juan Carlos Pérez Soto) that already holds an identified
    // page is the subject's own: its other pages (portfolio, discography) need not repeat the identity.
    const own=new Set(parents.map(p=>siteOf(p.url)).filter((host):host is string=>!!host&&ownSite(host,names)));
    for(const candidate of pages)if(own.has(siteOf(candidate.url)??""))trusted.add(candidate.url);
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
