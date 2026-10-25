import {normalizeRymIdentity as norm} from './rym-identity.js';
import {albumTitleEdition} from '../normalization/album-characteristics.js';

export interface RymExistingPublication{title:string;aliases:string[];titles:string[];album_type:string}
/** Explicit source identity is checked by the caller. This additional proof
 * can distinguish a documented new work from the resolver's broad same-artist
 * candidates, without interpreting a spelling change or edition as a new work. */
export function distinctRymPublication(source:{title:string;year:number|null;albumType:string;titles:string[]},existing:RymExistingPublication[]):boolean{
 const title=norm(source.title),tracks=source.titles.map(norm);
 if(!title||!source.year||albumTitleEdition(source.title)||!tracks.length||tracks.some(t=>!t))return false;
 if(source.albumType!=='single'&&new Set(tracks).size<(source.albumType==='ep'?2:3))return false;
 const compact=(s:string)=>norm(s).replace(/ /gu,'');
 const words=title.split(' ');
 const repertoire=JSON.stringify([...tracks].sort());
 for(const album of existing){
  for(const alias of [album.title,...album.aliases]){
   const key=norm(alias),parts=key.split(' ');
   if(compact(alias)===compact(source.title)||key.includes(title)||title.includes(key))return false;
   const shared=words.filter(w=>parts.includes(w));
   if(shared.length>=2&&shared.length/Math.min(words.length,parts.length)>=0.5)return false;
  }
  if(album.titles.length&&JSON.stringify(album.titles.map(norm).sort())===repertoire)return false;
 }
 return true;
}
