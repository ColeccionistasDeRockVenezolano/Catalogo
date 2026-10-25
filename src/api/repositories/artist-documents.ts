import { getPool } from '../../db/client.js';
import type { ArtistDocument } from '../../shared/artist-documents.js';
export async function artistDocuments(id:number):Promise<ArtistDocument[]> {
 return (await getPool().query<ArtistDocument>(`SELECT id::int,category,title,content,source_url AS "sourceUrl",
 archive_url AS "archiveUrl",date_text AS "dateText",location,tags FROM media.artist_documents
 WHERE artist_id=$1 AND NOT (metadata @> '{"editorialHidden":true}') ORDER BY category,id`,[id])).rows;
}
