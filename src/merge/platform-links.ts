// Perfiles de escucha y redes: la edición humana comparte el run y el diario
// reversible que ya utiliza la campaña de enlaces (migraciones 0039/0040).
import type { OperatorContext } from "./operator.js";
import { OperatorError } from "./operator.js";

export const SOCIAL_PLATFORMS = ["instagram", "facebook", "x", "tiktok", "threads", "bluesky"] as const;
export const STREAMING_PLATFORMS = ["spotify", "apple_music", "deezer", "youtube", "youtube_music", "tidal", "bandcamp", "soundcloud", "amazon_music"] as const;
export type LinkOwner = "artist" | "album";
export type LinkCategory = "social" | "streaming";
export interface EditablePlatformLink {
  platform: string; url: string; handle: string | null; verified: boolean;
}

export function linkStorage(kind: LinkOwner, category: LinkCategory) {
  if (category === "social" && kind !== "artist") throw new OperatorError("invalid", "Las redes sociales pertenecen al artista.");
  return { table: category === "social" ? "social_links" : "streaming_links", column: kind === "artist" ? "artist_id" : "album_id" };
}

export async function writePlatformLink(context: OperatorContext, kind: LinkOwner, id: number, category: LinkCategory,
  platform: string, value: Omit<EditablePlatformLink, "platform"> | null): Promise<void> {
  const { table, column } = linkStorage(kind, category);
  const entity = await context.client.query(`SELECT id FROM public.${kind === "artist" ? "artists" : "albums"} WHERE id=$1 FOR KEY SHARE`, [id]);
  if (!entity.rowCount) throw new OperatorError("not_found", "La ficha no existe.");
  const allowed: readonly string[] = category === "social" ? SOCIAL_PLATFORMS : STREAMING_PLATFORMS;
  if (!allowed.includes(platform)) throw new OperatorError("invalid", "Plataforma no admitida.");
  if (value === null) {
    const removed = await context.client.query(`DELETE FROM public.${table} WHERE ${column}=$1 AND platform=$2 RETURNING id`, [id, platform]);
    if (!removed.rowCount) throw new OperatorError("not_found", "El enlace ya no existe.");
    return;
  }
  const extraColumn = category === "social" ? "handle" : "external_id";
  await context.client.query(`
    INSERT INTO public.${table} (${column},platform,url,${extraColumn},method,source,verified,notes)
    VALUES ($1,$2,$3,$4,'exact','crv-operador',$5,$6)
    ON CONFLICT (${column},platform) ${category === "social" ? "" : `WHERE ${column} IS NOT NULL`}
    DO UPDATE SET url=EXCLUDED.url, ${extraColumn}=EXCLUDED.${extraColumn}, method=EXCLUDED.method,
      source=EXCLUDED.source, verified=EXCLUDED.verified, notes=EXCLUDED.notes`,
  [id, platform, value.url, category === "social" ? value.handle : null, value.verified, context.note]);
}
