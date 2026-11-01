// CRV · Cascada de discos idénticos tras fusionar artistas (etapa 5).
//
// Al mover los discos de la ficha absorbida aparecen dos filas del mismo álbum.
// Solo se unen si el título normalizado no queda vacío, el año coincide, la
// lista de pistas es idéntica y no hay formatos ni catálogos en conflicto.
// Las ediciones con listas distintas NO se tocan: se revisan como edición.
import type { OperatorContext } from "../merge/operator.js";
import { mergeInto } from "./duplicates.js";
import { normalizeEntityName } from "../normalization/entity-name.js";

interface AlbumRow {
  id: string; title: string; release_year: number | null;
  media_format: string | null; catalog_id: string | null;
}

export interface AlbumDedupeResult {
  merged: number;
  skipped: number;
  groups: number;
  details: string[];
}

async function tracklistSignature(context: OperatorContext, albumId: number): Promise<string> {
  const { rows } = await context.client.query<{ title: string }>(
    "SELECT title FROM public.tracks WHERE album_id=$1 ORDER BY disc_number,track_number NULLS LAST,id", [albumId]);
  return rows.map((row) => normalizeEntityName(row.title).secondaryKey).join("\n");
}

/** Une discos idénticos del artista que dejó una fusión. Corre en el run de la fusión. */
export async function dedupeArtistAlbums(context: OperatorContext, artistId: number): Promise<AlbumDedupeResult> {
  const { rows } = await context.client.query<AlbumRow>(`
    SELECT id::text,title,release_year,media_format,catalog_id
      FROM public.albums WHERE artist_id=$1 ORDER BY id`, [artistId]);
  const groups = new Map<string, AlbumRow[]>();
  for (const album of rows) {
    const titleKey = normalizeEntityName(album.title).secondaryKey;
    if (!titleKey) continue; // títulos que normalizan a vacío: intocables.
    const key = `${titleKey}|${album.release_year ?? ""}`;
    groups.set(key, [...(groups.get(key) ?? []), album]);
  }
  let merged = 0;
  let skipped = 0;
  let touched = 0;
  const details: string[] = [];
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const signatures = new Map<number, string>();
    for (const album of group) signatures.set(Number(album.id), await tracklistSignature(context, Number(album.id)));
    const distinct = new Set([...signatures.values()].filter(Boolean));
    if (distinct.size !== 1) continue; // ediciones distintas: las revisa el detector.
    const formats = new Set(group.map((album) => album.media_format?.trim().toLowerCase()).filter(Boolean));
    const catalogs = new Set(group.map((album) => album.catalog_id?.trim().toLowerCase()).filter(Boolean));
    if (formats.size > 1 || catalogs.size > 1) { skipped += group.length - 1; continue; }
    touched += 1;
    const ordered = [...group].sort((left, right) => Number(left.id) - Number(right.id));
    const [keep, ...drops] = ordered;
    for (const drop of drops) {
      await mergeInto(context.client, "album", Number(keep!.id), Number(drop.id), `Disco idéntico unido tras fusionar artistas: «${keep!.title}»`, context.runId);
      merged += 1;
      details.push(`disco ${drop.id} → ${keep!.id} («${keep!.title}»)`);
    }
  }
  return { merged, skipped, groups: touched, details };
}
