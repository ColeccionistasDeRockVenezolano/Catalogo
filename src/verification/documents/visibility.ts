import type {DocumentLocation} from "./types.js";
import type {DocumentMetadata} from "./types.js";
export const MIN_VISIBLE_PDF_VERSION=2;
export function requiresPdfReread(document:DocumentMetadata|undefined):boolean{return document?.format==="pdf"&&document.extractionVersion<MIN_VISIBLE_PDF_VERSION;}

const normalize=(value:string)=>value.normalize("NFKD").replace(/\p{M}/gu,"").toLowerCase().replace(/[^\p{L}\p{N}]/gu,"");
function overlap(a:NonNullable<DocumentLocation["bbox"]>,b:NonNullable<DocumentLocation["bbox"]>):number{
 if(a.unit!==b.unit)return 0;
 const width=Math.max(0,Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x)),height=Math.max(0,Math.min(a.y+a.height,b.y+b.height)-Math.max(a.y,b.y));
 return width*height/Math.max(1,Math.min(a.width*a.height,b.width*b.height));
}
/** PDF text can survive behind a replacement image or text layer. Preserve the
 * native reading, but only corroborated words may support the visible page.
 */
export function corroborateNativeLayer(content:string,locations:DocumentLocation[]):number{
 const bytes=Buffer.from(content,"utf8"),ocr=locations.filter(location=>location.selector==="pdf:ocr-word"&&location.bbox),native=locations.filter(location=>location.selector==="pdf:native-word"&&location.bbox);
 let uncorroborated=0;
 for(const word of native){
  const value=normalize(bytes.subarray(word.start,word.end).toString("utf8"));if(!value)continue;
  const neighbours=ocr.filter(candidate=>candidate.page===word.page&&overlap(word.bbox!,candidate.bbox!)>=.3);
  const corroborated=neighbours.some(candidate=>normalize(bytes.subarray(candidate.start,candidate.end).toString("utf8"))===value);
  if(!corroborated){word.selector="pdf:native-uncorroborated-word";uncorroborated++;}
 }
 return uncorroborated;
}
export function visibleTranscript(content:string,locations:DocumentLocation[]):string{
 const bytes=Buffer.from(content,"utf8");
 for(const location of locations)if(location.selector.includes("uncorroborated"))bytes.fill(32,location.start,location.end);
 return bytes.toString("utf8");
}
export function visibleQuote(content:string,locations:DocumentLocation[],quote:string):string{
 const offset=content.indexOf(quote);if(offset<0)return quote;
 const start=Buffer.byteLength(content.slice(0,offset),"utf8"),end=start+Buffer.byteLength(quote,"utf8"),bytes=Buffer.from(quote,"utf8");
 for(const location of locations)if(location.selector.includes("uncorroborated")&&location.start<end&&location.end>start)bytes.fill(32,Math.max(start,location.start)-start,Math.min(end,location.end)-start);
 return bytes.toString("utf8");
}
/** Contiguous original spans keep literal citations without exposing an
 * uncorroborated alternative to a model as if it were visible text.
 */
export function visibleSegments(content:string,locations:DocumentLocation[]):string[]{
 const bytes=Buffer.from(content,"utf8"),hidden=locations.filter(location=>location.selector.includes("uncorroborated")).sort((a,b)=>a.start-b.start);
 const result:string[]=[];let offset=0;
 for(const location of hidden){
  if(location.start>offset)result.push(bytes.subarray(offset,location.start).toString("utf8"));
  offset=Math.max(offset,location.end);
 }
 if(offset<bytes.length)result.push(bytes.subarray(offset).toString("utf8"));
 return result;
}
