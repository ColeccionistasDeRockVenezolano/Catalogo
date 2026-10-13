import type { WebPage } from "../ambiguity/web-search.js";
import type { VerificationEvidence, VerificationUnit } from "./types.js";
import {dateBacked} from "./date-proof.js";
import {visibleQuote,visibleTranscript} from "./documents/visibility.js";
import {extractionKey} from "./documents/extraction-key.js";
export function matchesEvidence(page:WebPage,evidence:VerificationEvidence):boolean{return page.url===evidence.url&&(!evidence.contentHash||page.contentHash===evidence.contentHash)&&(!evidence.extractionHash||!!page.document&&extractionKey(page.document)===evidence.extractionHash);}

export const RULES_VERSION = 10;
export function fold(value: string): string { return value.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/gu, " ").trim(); }
export function words(value: string): string { return fold(value.replace(/(\p{L})(?=\d+[.-](?:\s|\p{Lu}))/gu, "$1 ").replace(/([\p{Ll}])([\p{Lu}])/gu, "$1 $2")).replace(/[^\p{L}\p{N}]+/gu, " ").replace(/\s+/gu, " ").trim(); }
export function contains(text: string, value: string): boolean { const term=words(value); return Boolean(term && ` ${words(text)} `.includes(` ${term} `)); }
export function escapeRegex(value: string): string { return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"); }
export function albumName(value: string): string { return words(value.replace(/\s*\((?:cd\s*\/\s*dvd|cd|special edition)\)\s*/giu," ")); }
export function contextPresent(text: string, value: string): boolean {
  return contains(text,value) || Boolean(/\((?:cd|cd\s*\/\s*dvd)\)/iu.test(value) && contains(text,albumName(value)))
    || Boolean(value.includes(":") && contains(text,value.split(":")[0]!));
}
export function usablePage(page: WebPage): boolean {
  const text=fold(page.content);
  return Boolean(text) && !(/^(?:client challenge|just a moment|access denied|attention required)/iu.test(page.title)
    || (/log in|iniciar sesi[oó]n/iu.test(page.content)&&page.content.length<500&&!/biograf|tracks|discograf|banda|band/iu.test(page.content))
    || /your current browser isn't compatible with soundcloud|verify you are human|enable javascript and cookies to continue|checking your browser before accessing/iu.test(text));
}
export function publisher(url: string): string {
  const host=new URL(url).hostname.replace(/^www\./u,"");
  // Los catálogos digitales reciben frecuentemente la misma entrega del sello.
  if(/(?:^|\.)(deezer\.com|spotify\.com|apple\.com|tidal\.com|amazon\.[a-z.]+)$/u.test(host)) return "catalogo-distribuido";
  if(host.endsWith("wikipedia.org")) return "wikipedia.org";
  if(host.endsWith("blogspot.com")) return host;
  const parts=host.split("."); const root=parts.slice(-2).join(".");
  return /^(co|com|org)\.[a-z]{2}$/u.test(root)?parts.slice(-3).join("."):root;
}
export function sourceCeiling(url: string, origin: VerificationEvidence["origin"]): number {
  if(origin==="search_snippet")return .25;
  const host=new URL(url).hostname;
  if(host.endsWith("musica.com") && /\/biografia\/?$/u.test(new URL(url).pathname)) return .25;
  if(host.endsWith("blogspot.com")||host.endsWith("denunciando.com")||host.endsWith("teksti.pl"))return .5;
  return .75;
}
function shingles(value: string): Set<string> { const tokens=words(value).split(" ");return new Set(tokens.slice(0,-5).map((_,i)=>tokens.slice(i,i+6).join(" "))); }
function copied(a: string,b: string): boolean {
  const left=shingles(a),right=shingles(b); if(Math.min(left.size,right.size)<8)return words(a)===words(b);
  const common=[...left].filter(v=>right.has(v)).length; return common/Math.min(left.size,right.size)>.65;
}
export function corroborationStrength(evidence: VerificationEvidence[], pages: WebPage[]): number {
  const selected:VerificationEvidence[]=[];
  for(const e of [...evidence].sort((a,b)=>sourceCeiling(b.url,b.origin)-sourceCeiling(a.url,a.origin))) {
    if(selected.some(s=>publisher(s.url)===publisher(e.url)))continue;
    const page=pages.find(p=>p.url===e.url);
    if(selected.some(s=>copied(s.quote,e.quote)||Boolean(page&&pages.find(p=>p.url===s.url)?.contentHash===page.contentHash)))continue;
    selected.push(e);
  }
  const strong=selected.filter(e=>sourceCeiling(e.url,e.origin)>=.75);
  return strong.length>=2?1:Math.max(0,...selected.map(e=>sourceCeiling(e.url,e.origin)));
}
/** Cobertura del dato: una cita completa de una página basta; la independencia es otra dimensión. */
export function sourceStrength(evidence: VerificationEvidence[], _pages: WebPage[]): number {
  return evidence.some(e=>e.origin==="page"&&!e.requiresOriginalReview&&!e.locations?.some(location=>location.selector.includes("ocr")))?1:
    evidence.some(e=>e.origin==="page")?.5:evidence.length?.25:0;
}
export function canonicalLink(value: string): string {
  const url=new URL(value);
  url.hash="";
  for(const key of [...url.searchParams.keys()])if(/^(?:utm_.*|si|fbclid|gclid|igsh|igshid|hl|lang|locale)$/iu.test(key))url.searchParams.delete(key);
  url.searchParams.sort();
  return `${url.hostname.replace(/^www\./u,"")}${url.pathname.replace(/\/$/u,"")}${url.search}`;
}
const SYNONYMS:Record<string,string[]>={
  venezuela:["Venezuela","venezolano","venezolana","Venezuelan"],record_label:["record label","sello discográfico","discográfica"],
  "rock alternativo":["rock alternativo","alternative rock"],"alternative rock":["alternative rock","rock alternativo"],
  "pop rock":["pop rock","poprock"],
  bass:["bass","bajo","bajista"],bajo:["bass","bajo","bajista"],guitar:["guitar","guitarra","guitarrista"],guitars:["guitars","guitar","guitarra","guitarrista"],guitarra:["guitar","guitarra","guitarrista"],
  drums:["drums","drummer","bateria","baterista","percusionista"],bateria:["drums","bateria","baterista"],vocals:["vocals","voz","voces","vocalista","cantante"],voz:["vocals","voz","vocalista","cantante"],
  "lead vocals":["lead vocals","voz principal","vocalista"],keyboards:["keyboards","teclados","tecladista"],producer:["producer","produccion","productor"],writer:["writer","compositor","autor"],
  studio_album:["studio album","album de estudio","disco de estudio"],live_album:["live album","album en vivo","disco en vivo","(en vivo)"],compilation:["compilation","recopilacion","compilacion","recopilatorio"],
  single:["single","singles","sencillo"],soundtrack:["soundtrack","banda sonora"],collaboration_album:["collaboration album","album colaborativo"],
};
export function backed(text: string, value: string): boolean {
  if(/^\d{4}-\d{2}(?:-\d{2})?$/u.test(value))return dateBacked(text,value);
  return (SYNONYMS[fold(value)]??[value]).some(v=>contains(text,v));
}
/** Espacios dentro de un nombre compuesto no cambian la identidad de una pista. */
export function trackTitleMatch(text: string,value: string): boolean {
  const compact=words(value.replace(/[²³]/gu,"")).replace(/ /gu,"");
  if(!compact)return false;
  const pattern=[...compact].map(escapeRegex).join("\\s*");
  return new RegExp(`(?:^|\\s)${pattern}(?=$|\\s)`,"u").test(words(text));
}
/** Devuelve posiciones ligadas al título, conservando el soporte de la lista. */
export function positions(unit: VerificationUnit,e: VerificationEvidence,page: WebPage): Array<{disc:number;number:number}> {
  const title=unit.expected[0];if(!title)return [];
  const normalized=fold(page.document?visibleTranscript(page.content,page.document.locations):page.content); const quote=fold(page.document?visibleQuote(page.content,page.document.locations,e.quote):e.quote);const start=normalized.indexOf(quote); if(start<0)return [];
  const titlePattern=[...words(title.replace(/[²³]/gu,"")).replace(/ /gu,"")].map(escapeRegex).join("[^\\p{L}\\p{N}]*");
  const pattern=new RegExp(`(?:^|[^0-9])(?:(\\d+)\\.)?0*(\\d+)[^\\p{L}\\p{N}]+${titlePattern}(?=$|[^\\p{L}\\p{N}]|\\d+[.-])`,"gu");
  const found:Array<{disc:number;number:number}>=[];
  for(const match of quote.matchAll(pattern)) {
    const before=normalized.slice(0,start+(match.index??0));
    const headers=[...before.matchAll(/\b(?:dvd|cd|disc\s*\d+|disco\s*\d+)\b/gu)].filter(h=>before[(h.index??0)-1]!=="/"&&before[(h.index??0)+h[0].length]!=="/");
    const header=headers.at(-1)?.[0];
    const disc=match[1]?Number(match[1]):header==="dvd"&&/\bcd\b/u.test(before)?2:header&&/\d/u.test(header)?Number(header.match(/\d+/u)?.[0]):1;
    const sides=[...before.matchAll(/\b(?:side|lado)\s+([ab])\b/gu)];
    const side=sides.at(-1);let offset=0;
    if(!match[1]&&side?.[1]==="b"){
      const a=[...sides].reverse().find(s=>s[1]==="a");
      if(a){const sideA=before.slice(a.index!+a[0].length,side.index);const numbers=[...sideA.matchAll(/(?:^|[^0-9])0*(\d{1,2})[.\s):–-]+(?=\p{L})/gu)].map(m=>Number(m[1]));offset=Math.max(0,...numbers);}
    }
    found.push({disc,number:Number(match[2])+offset});
  }
  return found;
}
export function sameValue(unit:VerificationUnit,observed:string):boolean {
  if(unit.key.endsWith(".order")) {const parts=observed.trim().match(/^(?:(\d+)\.)?0*(\d+)$/u);return Boolean(parts&&Number(parts[2])===Number(unit.value?.split(".")[1])&&(!parts[1]||Number(parts[1])===Number(unit.value?.split(".")[0])));}
  return words(unit.value??"")===words(observed);
}
export function claimContext(unit:VerificationUnit,e:VerificationEvidence,page:WebPage):boolean {
  if(unit.area!=="tracks"&&unit.area!=="discography"&&unit.key!=="status.type"&&unit.area!=="labels"&&unit.area!=="images"&&!(unit.area==="genres"&&unit.key.startsWith("album.")))return true;
  for(const context of unit.context){
    if(/\(cd\s*\/\s*dvd\)/iu.test(context)&&!/\bdvd\b/iu.test(`${page.title} ${page.content}`))return false;
    if(/\(cd\)/iu.test(context)&&unit.area==="discography"&&/\bdvd\b/iu.test(page.title))return false;
  }
  const album=unit.context[1];
  if(unit.area==="tracks"&&album&&words(album)===words(unit.expected[0]??"")&&!releaseBacked({...unit,key:"album.0.title",value:album},e,page))return false;
  const contexts=unit.context.filter(v=>v&&!contains(v,page.title)&&!contains(page.title,v));
  const at=fold(page.content).indexOf(fold(e.quote));
  const heading=at>=0?fold(page.content).slice(Math.max(0,at-400),at):"";
  return contexts.every(v=>contextPresent(e.quote,v)||contextPresent(page.title,v)||contextPresent(heading,v));
}
export function releaseBacked(unit:VerificationUnit,e:VerificationEvidence,page:WebPage):boolean {
  if(!/^album\.\d+\.title$/u.test(unit.key))return true;
  const title=unit.value!;const text=fold(page.content);const quote=fold(e.quote);const at=text.indexOf(quote);
  // Una página de un álbum, o una cabecera de edición, identifica el lanzamiento.
  if(contains(page.title,title)&&/\/album\//u.test(new URL(page.url).pathname)&&/(?:deezer|spotify|apple)\.com/u.test(new URL(page.url).hostname))return true;
  if(contains(page.title,title)&&/album|cd info|lp info|ep info|da info|releases|single/iu.test(page.title))return true;
  const firstTracks=text.search(/\btracks\b/u);
  if(/album title/iu.test(text)&&at>=0&&at<firstTracks&&contains(e.quote,title))return true;
  if(new RegExp(`\\b(?:ep|album|single|sencillo|lanzamiento|disco|recopilacion)\\b[^0-9]{0,40}${escapeRegex(fold(title))}`,"u").test(quote))return true;
  if(/\balbum(?:es|s)\b/iu.test(quote)&&/figuran|destacados|discograf|incluyen|including|albums include/iu.test(quote)&&contains(quote,title))return true;
  // En catálogos extensos, exige cabecera con fecha antes del listado de pistas.
  const term=escapeRegex(fold(title));
  return new RegExp(`(?:\\d{4}[^|]{0,80}\\||℗[^.]{0,100}\\d{2}-\\d{2}-\\d{4})[^.]{0,180}${term}[^.]{0,100}(?:\\||01\\s)`,"u").test(quote);
}
