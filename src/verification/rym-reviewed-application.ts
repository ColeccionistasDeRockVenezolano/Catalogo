import { normalizeRymIdentity as norm } from './rym-identity.js';
import { rymCatalogKey, rymFormatKey, rymPublicationConflict } from './rym-publication-identity.js';

export interface ReviewedReleaseCandidate {
  id:number; title:string; aliases:string[]; release_year:number|null;
  catalog_id:string|null; media_format:string|null; album_type:string;
  classifications:string[]; titles:string[];
}
export interface ReviewedReleaseSource {
  titulo:string; anio:number|null; catalog_no:string|null; formato:string|null;
  tipo:string|null; pistas:Array<{titulo:string}>; musicalEditionVerified?:boolean;
}
export type ReviewedReleaseMatch = {status:'match';album:ReviewedReleaseCandidate}|{status:'new'}|{status:'hold';reason:string;ids:number[]};

/** A title identifies a work, not necessarily the captured publication/edition. */
export function matchReviewedRymRelease(source:ReviewedReleaseSource, albums:ReviewedReleaseCandidate[]):ReviewedReleaseMatch {
  const title=norm(source.titulo),code=rymCatalogKey(source.catalog_no);
  let exact=albums.filter(a=>[a.title,...a.aliases].some(t=>norm(t)===title));
  const compatible=exact.filter(a=>!rymPublicationConflict(source.tipo??'',a.album_type,a.classifications,!!source.musicalEditionVerified));
  if(compatible.length)exact=compatible;
  const year=exact.filter(a=>!!source.anio&&a.release_year===source.anio);
  if(exact.length>1&&year.length===1)exact=year;
  const codes=code?albums.filter(a=>rymCatalogKey(a.catalog_id)===code):[];
  if(exact.length>1)return {status:'hold',reason:'multiple_catalog_publications_with_same_title',ids:exact.map(a=>a.id)};
  const album=exact[0];
  if(album){
    if(source.anio&&album.release_year&&source.anio!==album.release_year)return {status:'hold',reason:'edition_year_differs',ids:[album.id]};
    if(code&&album.catalog_id&&rymCatalogKey(album.catalog_id)!==code)return {status:'hold',reason:'edition_catalog_differs',ids:[album.id]};
    if(source.formato&&album.media_format&&rymFormatKey(source.formato)!==rymFormatKey(album.media_format))return {status:'hold',reason:'edition_format_differs',ids:[album.id]};
    if(rymPublicationConflict(source.tipo??'',album.album_type,album.classifications,!!source.musicalEditionVerified))return {status:'hold',reason:'publication_type_differs',ids:[album.id]};
    return {status:'match',album};
  }
  if(codes.length)return {status:'hold',reason:'existing_catalog_number_different_title',ids:codes.map(a=>a.id)};
  const incoming=source.pistas.map(t=>norm(t.titulo)).sort();
  const same=incoming.length?albums.filter(a=>JSON.stringify(a.titles.map(norm).sort())===JSON.stringify(incoming)):[];
  if(same.length)return {status:'hold',reason:'same_complete_repertoire',ids:same.map(a=>a.id)};
  const near=albums.filter(a=>{
    const native=new Set(a.titles.map(norm)),shared=new Set(incoming.filter(t=>native.has(t))).size;
    return shared>=3&&shared/Math.max(new Set(incoming).size,native.size)>=0.8;
  });
  if(near.length)return {status:'hold',reason:'nearly_complete_existing_repertoire',ids:near.map(a=>a.id)};
  return {status:'new'};
}

/** An explicit discrepancy withholds the affected fields, not the identity. */
export function disputedRymField(field:string, contradictions:string[]):boolean {
  const text=contradictions.filter(s=>!/carencia.*no.*contradic|no son incompatibles/iu.test(s)).join(' ').toLowerCase();
  if(/birth|death|deceased/u.test(field))return /nac[ie]|birth|born|fallec|defunci|death|died|edad|fechas? biogr/iu.test(text);
  if(/formed|disbanded/u.test(field))return /formaci|formad|fundaci|fundad|formed|disband|disol|fechas? de inicio/iu.test(text);
  if(/origin/u.test(field))return /origen|origin|ciudad|caracas|valencia|formaci/iu.test(text);
  if(field==='real_name')return /nombre civil|apellido|identidad civil|equivalencia personal/iu.test(text);
  return false;
}

export function compatibleRymDate(current:string|null,wanted:string|null):boolean {
  return !current||!wanted||current.slice(0,Math.min(current.length,wanted.length))===wanted.slice(0,Math.min(current.length,wanted.length));
}

/** A person may own several projects which must retain separate discographies. */
export function reviewedRymOwnerMatches(sourceArtist:string,verifiedNames:string[]):boolean {
  const credited=` ${norm(sourceArtist)} `;
  return verifiedNames.some(name=>!!norm(name)&&credited.includes(` ${norm(name)} `));
}
