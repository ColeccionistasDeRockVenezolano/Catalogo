/** A characteristic-only legacy type cannot establish album/EP/single identity. */
export function rymCatalogKey(value:string|null|undefined):string{
  const key=(value??'').normalize('NFD').replace(/\p{Mn}/gu,'').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
  return ['na','none','unknown','nonumber','nocatalognumber','nocataloguenumber','notapplicable','notavailable','notspecified','notstated'].includes(key)?'':key;
}
export function rymFormatKey(value:string|null|undefined):string{
  const key=rymCatalogKey(value);
  return ({vinyl:'lp',vinyllp:'lp',compactdisc:'cd',digitalfile:'digital',digitaldownload:'digital',mp3:'digital',flac:'digital',aac:'digital',wav:'digital',cassettetape:'cassette'} as Record<string,string>)[key]??key;
}
export function rymVideoOnlyMedium(format:string|null|undefined):boolean {
  return ['dvd','dvdvideo','bluray','vhs','vcd','videocd','laserdisc'].includes((format ?? '').toLowerCase().replace(/[^a-z0-9]/gu,''));
}
export function rymPublicationConflict(sourceType:string,currentType:string,classifications:string[]=[],audioEditionVerified=false):boolean {
  if(!sourceType.trim() || /video|documentary|documental|interview|entrevista|short|bootleg|unauthorized/iu.test(sourceType))return true;
  if(/\badditional release\b/iu.test(sourceType)&&!audioEditionVerified)return true;
  const parts=sourceType.toLowerCase().split(/[,;+]/u).map(part=>part.trim());
  const wanted=parts.find(part=>['album','ep','single','compilation','live album','studio album'].includes(part));
  const sourceBase=wanted && ['album','compilation','live album','studio album'].includes(wanted)?'album':wanted;
  const currentBase=['studio_album','live_album','compilation'].includes(currentType)?'album':['single','ep'].includes(currentType)?currentType:null;
  const special=parts.includes('dj mix')?'DJ Mix':parts.includes('mixtape')?'Mixtape':null;
  if(special==='DJ Mix'&&!audioEditionVerified&&!classifications.includes('DJ Mix'))return true;
  if(special)return (currentBase==='single'||currentBase==='ep')&&!classifications.includes(special);
  if(!sourceBase || !currentBase || sourceBase===currentBase)return false;
  const labels=sourceBase==='album'?['Album','Studio Album','Live Album','Compilation Album']:sourceBase==='ep'?['EP']:['Single'];
  return !labels.some(label=>classifications.includes(label));
}
