import { getPool } from "../../db/client.js";
import type { ArtistGalleryPhoto } from "../../shared/artist-gallery.js";

export async function artistGallery(artistId: number): Promise<ArtistGalleryPhoto[]> {
  const { rows } = await getPool().query<ArtistGalleryPhoto>(
    `SELECT id::int, image_url AS "imageUrl", category, title, description,
      photo_date::text AS date, location FROM media.artist_gallery WHERE artist_id=$1 ORDER BY id`, [artistId],
  );
  return rows;
}
