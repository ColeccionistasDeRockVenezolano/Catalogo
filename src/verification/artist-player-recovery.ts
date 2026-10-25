export interface PlaybackAlbumEvidence {title:string;year:number|null;tracks:string[];artist:string}
export interface PlaybackCatalogAlbum {id:number;title:string;year:number|null;tracks:string[]}
export function playbackIdentityKey(value:string):string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/gu,'').toLowerCase().replace(/[^a-z0-9]+/gu,' ').trim();
}
export function corroboratesPlaybackAlbum(source:PlaybackAlbumEvidence,album:PlaybackCatalogAlbum,names:string[]):boolean {
  const key=playbackIdentityKey;
  const aliases=new Set(names.map(key));
  if(!aliases.has(key(source.artist))||key(source.title)!==key(album.title))return false;
  const tracks=new Set(album.tracks.map(key).filter(Boolean));
  const genericTracks=new Set(['intro','outro','introduction','interlude','untitled']);
  const shared=new Set(source.tracks.map(key).filter(title=>title.length>=3&&!genericTracks.has(title)&&tracks.has(title)));
  const generic=new Set([...aliases,'ep','demo','demos','single','album','live','en vivo','untitled']);
  const distinctive=key(source.title).length>=4&&!generic.has(key(source.title));
  return shared.size>=2||distinctive&&source.year!==null&&source.year===album.year;
}
/** An artist can play a documented reissue without equating it to a catalog edition. */
export function corroboratesPlaybackRepertoire(source:PlaybackAlbumEvidence,albums:PlaybackCatalogAlbum[],names:string[]):boolean {
  const normalize=playbackIdentityKey;
  if(!names.map(normalize).includes(normalize(source.artist)))return false;
  const generic=new Set(['intro','outro','introduction','interlude','untitled']);
  const known=new Set(albums.flatMap(album=>album.tracks).map(normalize));
  const shared=new Set(source.tracks.map(normalize).filter(title=>title.length>=3&&!generic.has(title)&&!/^track \d+$/u.test(title)&&known.has(title)));
  return shared.size>=2;
}
export function corroboratedPlaybackMembers(bio:string,members:Array<{id:number;name:string}>):number[] {
  const text=` ${playbackIdentityKey(bio)} `;
  return [...new Set(members.filter(member=>playbackIdentityKey(member.name).split(' ').filter(part=>part.length>1).length>=2
    &&text.includes(` ${playbackIdentityKey(member.name)} `)).map(member=>member.id))];
}
