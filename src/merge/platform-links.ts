// Perfiles de escucha y redes: la edición humana comparte el run y el diario
// reversible que ya utiliza la campaña de enlaces (migraciones 0039/0040).
import type { OperatorContext } from "./operator.js";
import { OperatorError } from "./operator.js";

import { SOCIAL_PLATFORMS, STREAMING_PLATFORMS } from "../shared/platforms.js";
export { SOCIAL_PLATFORMS, STREAMING_PLATFORMS };
export type LinkOwner = "artist" | "album";
export type LinkCategory = "social" | "streaming";
export interface EditablePlatformLink {
  platform: string; url: string; handle: string | null; verified: boolean;
  /** Identificador en la plataforma (p. ej. el id de Spotify). Si la edición no lo trae, se conserva el que hubiera. */
  externalId?: string | null;
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
  const social = category === "social";
  const extraColumn = social ? "handle" : "external_id";
  const extraValue = social ? value.handle : value.externalId ?? null;
  // El identificador de plataforma NUNCA se borra por una edición que no lo trae: la web edita
  // url/verificado y el id (Spotify, Deezer…) sigue siendo el ancla estable de la identidad.
  const extraUpdate = social
    ? `${extraColumn}=EXCLUDED.${extraColumn}`
    : `${extraColumn}=COALESCE(EXCLUDED.${extraColumn}, ${table}.${extraColumn})`;
  await context.client.query(`
    INSERT INTO public.${table} (${column},platform,url,${extraColumn},method,source,verified,notes)
    VALUES ($1,$2,$3,$4,'exact','crv-operador',$5,$6)
    ON CONFLICT (${column},platform) ${social ? "" : `WHERE ${column} IS NOT NULL`}
    DO UPDATE SET url=EXCLUDED.url, ${extraUpdate}, method=EXCLUDED.method,
      source=EXCLUDED.source, verified=EXCLUDED.verified, notes=EXCLUDED.notes`,
  [id, platform, value.url, extraValue, value.verified, context.note]);
}
