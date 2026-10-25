import { getPool } from '../../db/client.js';
import { embedFor, type EmbedLink } from '../../shared/streaming-embeds.js';

export interface ArtistPlaybackAlbum extends EmbedLink { albumId:number; albumTitle:string }

/** One playable publication per platform, keeping the artist's profile intact. */
export async function artistPlaybackAlbums(artistId:number,profiles:EmbedLink[]):Promise<ArtistPlaybackAlbum[]> {
  const playableProfiles=new Set(profiles.filter(link=>embedFor(link,'artist')).map(link=>link.platform));
  const {rows}=await getPool().query<ArtistPlaybackAlbum>(`
    SELECT al.id::int "albumId",al.title "albumTitle",s.platform,s.url,s.external_id "externalId"
      FROM ingest.catalog_albums al JOIN public.streaming_links s ON s.album_id=al.id
     WHERE al.artist_id=$1 AND s.verified AND NOT(s.platform=ANY($2::text[]))
     ORDER BY al.release_year DESC NULLS LAST,al.id DESC,s.id`,[artistId,[...playableProfiles]]);
  const selected=new Map<string,ArtistPlaybackAlbum>();
  for(const link of rows)if(!selected.has(link.platform)&&embedFor(link,'album'))selected.set(link.platform,link);
  return [...selected.values()];
}
