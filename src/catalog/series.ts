import type { Pool, PoolClient } from "pg";
import { OperatorError, type OperatorContext } from "../merge/operator.js";
import { compilationAlbumSql, compilationSeriesSql, variousArtistsAlbumSql } from "../api/repositories/compilation-series.js";
import { seriesVolumeOrderSql } from "../api/repositories/series-order.js";

/** Edición de series por la administración (Brian, 2026-10-27: CRUD 20/20).
 *  Las reglas de publicación no cambian: `compilationSeriesSql` decide qué series
 *  son públicas. El editor muestra también las ocultas y el motivo, para que una
 *  serie no desaparezca de la vista de quien la edita. */
type Database = Pick<Pool | PoolClient, "query">;
export const SERIES_KINDS = ["compilation", "sessions"] as const;
export type SeriesKind = (typeof SERIES_KINDS)[number];
/** Por qué una serie registrada no aparece en /series. */
export type SeriesHiddenReason = "few_entries" | "not_various_artists";

interface SeriesFields {
  title: string; kind: SeriesKind; description: string | null; notes: string | null;
  artistId: number | null; organizationId: number | null;
}
interface SeriesEntryFields { albumId: number; volumeNumber: number | null; volumeLabel: string | null }
export type SeriesInput = { [K in keyof SeriesFields]?: SeriesFields[K] | undefined };
export type SeriesEntryInput = { [K in keyof SeriesEntryFields]?: SeriesEntryFields[K] | undefined };

export interface SeriesEditorEntry {
  id: number; albumId: number; title: string; artistId: number; artistName: string;
  releaseYear: number | null; coverUrl: string | null; volumeNumber: number | null; volumeLabel: string | null;
  /** La ficha está oculta del catálogo público (no cuenta para la serie). */ visible: boolean;
  variousArtists: boolean; compilation: boolean;
}
export interface SeriesEditorSummary {
  id: number; title: string; kind: SeriesKind; artistName: string | null; organizationName: string | null;
  entryCount: number; visibleCount: number; isPublic: boolean; hiddenReason: SeriesHiddenReason | null;
}
export interface SeriesEditorDetail {
  id: number; title: string; kind: SeriesKind; description: string | null; notes: string | null; source: string;
  artist: { id: number; name: string } | null; organization: { id: number; name: string } | null;
  isPublic: boolean; hiddenReason: SeriesHiddenReason | null; entries: SeriesEditorEntry[];
}
export interface AlbumSeriesMembership {
  id: number; seriesId: number; seriesTitle: string; kind: SeriesKind;
  volumeNumber: number | null; volumeLabel: string | null; isPublic: boolean; hiddenReason: SeriesHiddenReason | null;
}

/** Mismo criterio que compilationSeriesSql, desglosado para explicarlo en pantalla. */
const STATUS_SQL = (alias: string) => `
  ${compilationSeriesSql(alias)} AS is_public,
  CASE WHEN ${compilationSeriesSql(alias)} THEN NULL
       WHEN (SELECT count(*) FROM ingest.series_albums cs JOIN ingest.catalog_albums ca ON ca.id=cs.album_id WHERE cs.series_id=${alias}.id) < 2 THEN 'few_entries'
       ELSE 'not_various_artists' END AS hidden_reason`;

const number = (value: string | null) => value === null ? null : Number(value);
const text = (value: string | null | undefined) => {
  if (value === undefined || value === null) return value;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
};

export async function listSeriesForEditor(db: Database, query: { q?: string | undefined; status?: "all" | "public" | "hidden" | undefined; limit: number; offset: number }):
  Promise<{ rows: SeriesEditorSummary[]; total: number }> {
  const params: unknown[] = [];
  const where: string[] = [];
  if (query.q) { params.push(`%${query.q}%`); where.push(`s.title ILIKE $${params.length}`); }
  if (query.status === "public") where.push(compilationSeriesSql("s"));
  if (query.status === "hidden") where.push(`NOT ${compilationSeriesSql("s")}`);
  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const [rows, total] = await Promise.all([
    db.query<{ id: string; title: string; kind: SeriesKind; artist_name: string | null; organization_name: string | null; entry_count: string; visible_count: string;
      is_public: boolean; hidden_reason: SeriesHiddenReason | null }>(`
      SELECT s.id::text, s.title, s.kind, ar.name AS artist_name, o.name AS organization_name,
             (SELECT count(*) FROM ingest.series_albums sa WHERE sa.series_id=s.id)::text AS entry_count,
             (SELECT count(*) FROM ingest.series_albums sa JOIN ingest.catalog_albums ca ON ca.id=sa.album_id WHERE sa.series_id=s.id)::text AS visible_count,
             ${STATUS_SQL("s")}
        FROM ingest.series s LEFT JOIN public.artists ar ON ar.id=s.artist_id LEFT JOIN public.organizations o ON o.id=s.organization_id
        ${clause} ORDER BY lower(s.title), s.id LIMIT $${params.length + 1} OFFSET $${params.length + 2}`, [...params, query.limit, query.offset]),
    db.query<{ n: string }>(`SELECT count(*)::text AS n FROM ingest.series s ${clause}`, params),
  ]);
  return {
    rows: rows.rows.map((row) => ({ id: Number(row.id), title: row.title, kind: row.kind, artistName: row.artist_name, organizationName: row.organization_name,
      entryCount: Number(row.entry_count), visibleCount: Number(row.visible_count), isPublic: row.is_public, hiddenReason: row.hidden_reason })),
    total: Number(total.rows[0]!.n),
  };
}

export async function readSeriesForEditor(db: Database, id: number): Promise<SeriesEditorDetail> {
  const series = (await db.query<{ id: string; title: string; kind: SeriesKind; description: string | null; notes: string | null; source: string;
    artist_id: string | null; artist_name: string | null; organization_id: string | null; organization_name: string | null; is_public: boolean; hidden_reason: SeriesHiddenReason | null }>(`
    SELECT s.id::text, s.title, s.kind, s.description, s.notes, s.source, ar.id::text AS artist_id, ar.name AS artist_name,
           o.id::text AS organization_id, o.name AS organization_name, ${STATUS_SQL("s")}
      FROM ingest.series s LEFT JOIN public.artists ar ON ar.id=s.artist_id LEFT JOIN public.organizations o ON o.id=s.organization_id
     WHERE s.id=$1`, [id])).rows[0];
  if (!series) throw new OperatorError("not_found", `No existe la serie ${id}.`);
  // Las fichas ocultas también se listan: retirarlas de la serie es una decisión editorial.
  const entries = await db.query<{ id: string; album_id: string; title: string; artist_id: string; artist_name: string; release_year: number | null; cover_url: string | null;
    volume_number: string | null; volume_label: string | null; visible: boolean; various_artists: boolean; compilation: boolean }>(`
    SELECT sa.id::text, a.id::text AS album_id, a.title, ar.id::text AS artist_id, ar.name AS artist_name, a.release_year, a.cover_url,
           sa.volume_number::text, sa.volume_label,
           EXISTS (SELECT 1 FROM ingest.catalog_albums ca WHERE ca.id=a.id) AS visible,
           ${variousArtistsAlbumSql("a")} AS various_artists, ${compilationAlbumSql("a")} AS compilation
      FROM ingest.series_albums sa JOIN public.albums a ON a.id=sa.album_id JOIN public.artists ar ON ar.id=a.artist_id
     WHERE sa.series_id=$1 ORDER BY ${seriesVolumeOrderSql("sa", "a")}`, [id]);
  return {
    id: Number(series.id), title: series.title, kind: series.kind, description: series.description, notes: series.notes, source: series.source,
    artist: series.artist_id ? { id: Number(series.artist_id), name: series.artist_name! } : null,
    organization: series.organization_id ? { id: Number(series.organization_id), name: series.organization_name! } : null,
    isPublic: series.is_public, hiddenReason: series.hidden_reason,
    entries: entries.rows.map((row) => ({ id: Number(row.id), albumId: Number(row.album_id), title: row.title, artistId: Number(row.artist_id), artistName: row.artist_name,
      releaseYear: row.release_year, coverUrl: row.cover_url, volumeNumber: number(row.volume_number), volumeLabel: row.volume_label,
      visible: row.visible, variousArtists: row.various_artists, compilation: row.compilation })),
  };
}

export async function readAlbumSeries(db: Database, albumId: number): Promise<AlbumSeriesMembership[]> {
  if (!(await db.query("SELECT 1 FROM public.albums WHERE id=$1", [albumId])).rowCount) throw new OperatorError("not_found", "Ficha inexistente.");
  const rows = await db.query<{ id: string; series_id: string; title: string; kind: SeriesKind; volume_number: string | null; volume_label: string | null;
    is_public: boolean; hidden_reason: SeriesHiddenReason | null }>(`
    SELECT sa.id::text, s.id::text AS series_id, s.title, s.kind, sa.volume_number::text, sa.volume_label, ${STATUS_SQL("s")}
      FROM ingest.series_albums sa JOIN ingest.series s ON s.id=sa.series_id
     WHERE sa.album_id=$1 ORDER BY lower(s.title), s.id`, [albumId]);
  return rows.rows.map((row) => ({ id: Number(row.id), seriesId: Number(row.series_id), seriesTitle: row.title, kind: row.kind,
    volumeNumber: number(row.volume_number), volumeLabel: row.volume_label, isPublic: row.is_public, hiddenReason: row.hidden_reason }));
}

async function lockSeries(ctx: OperatorContext, id: number): Promise<void> {
  if (!(await ctx.client.query("SELECT id FROM ingest.series WHERE id=$1 FOR UPDATE", [id])).rowCount) throw new OperatorError("not_found", `No existe la serie ${id}.`);
}

/** Crea o corrige una serie. Un título repetido se rechaza: dos fichas de la misma
 *  colección partirían sus entregas. */
export async function writeSeries(ctx: OperatorContext, input: SeriesInput, id?: number): Promise<number> {
  const db = ctx.client;
  if (id !== undefined) await lockSeries(ctx, id);
  const values: Record<string, unknown> = {};
  if (input.title !== undefined) {
    const title = text(input.title);
    if (!title) throw new OperatorError("invalid", "La serie necesita un título.");
    const twin = (await db.query<{ id: string }>("SELECT id::text FROM ingest.series WHERE lower(btrim(title))=lower($1) AND id<>$2 LIMIT 1", [title, id ?? 0])).rows[0];
    if (twin) throw new OperatorError("already_exists", `Ya existe la serie «${title}» (${twin.id}). Añade las entregas a esa serie.`, { seriesId: Number(twin.id) });
    values["title"] = title;
  } else if (id === undefined) throw new OperatorError("invalid", "La serie necesita un título.");
  if (input.kind !== undefined) values["kind"] = input.kind;
  if (input.description !== undefined) values["description"] = text(input.description);
  if (input.notes !== undefined) values["notes"] = text(input.notes);
  if (input.artistId !== undefined) {
    if (input.artistId !== null && !(await db.query("SELECT id FROM public.artists WHERE id=$1 FOR KEY SHARE", [input.artistId])).rowCount) throw new OperatorError("not_found", "Artista inexistente.");
    values["artist_id"] = input.artistId;
  }
  if (input.organizationId !== undefined) {
    if (input.organizationId !== null && !(await db.query("SELECT id FROM public.organizations WHERE id=$1 FOR KEY SHARE", [input.organizationId])).rowCount) throw new OperatorError("not_found", "Organización inexistente.");
    values["organization_id"] = input.organizationId;
  }
  values["run_id"] = ctx.runId;
  const entries = Object.entries(values);
  if (id === undefined) {
    entries.push(["source", "operador"]);
    const inserted = await db.query<{ id: string }>(`INSERT INTO ingest.series(${entries.map(([key]) => key).join(",")}) VALUES(${entries.map((_, i) => `$${i + 1}`).join(",")}) RETURNING id::text`,
      entries.map(([, value]) => value));
    return Number(inserted.rows[0]!.id);
  }
  await db.query(`UPDATE ingest.series SET ${entries.map(([key], i) => `${key}=$${i + 2}`).join(",")} WHERE id=$1`, [id, ...entries.map(([, value]) => value)]);
  return id;
}

/** Retira la serie. Las entregas se borran antes que la serie para que deshacer
 *  las restaure en orden (primero la serie, después sus vínculos). Los discos no se tocan. */
export async function deleteSeries(ctx: OperatorContext, id: number): Promise<number> {
  await lockSeries(ctx, id);
  await ctx.client.query("DELETE FROM ingest.series_albums WHERE series_id=$1", [id]);
  await ctx.client.query("DELETE FROM ingest.series WHERE id=$1", [id]);
  return id;
}

function volumeValues(input: SeriesEntryInput): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  if (input.volumeNumber !== undefined) values["volume_number"] = input.volumeNumber;
  if (input.volumeLabel !== undefined) values["volume_label"] = text(input.volumeLabel);
  return values;
}

/** Añade un disco a la serie o corrige su número/etiqueta de volumen. */
export async function writeSeriesEntry(ctx: OperatorContext, seriesId: number, input: SeriesEntryInput, entryId?: number): Promise<number> {
  const db = ctx.client;
  await lockSeries(ctx, seriesId);
  if (entryId !== undefined) {
    if (input.albumId !== undefined) throw new OperatorError("invalid", "La entrega conserva su disco. Retírala y añade el disco correcto.");
    if (!(await db.query("SELECT id FROM ingest.series_albums WHERE id=$1 AND series_id=$2 FOR UPDATE", [entryId, seriesId])).rowCount) {
      throw new OperatorError("not_found", "La entrega no pertenece a esta serie.");
    }
    const values = Object.entries({ ...volumeValues(input), run_id: ctx.runId });
    await db.query(`UPDATE ingest.series_albums SET ${values.map(([key], i) => `${key}=$${i + 2}`).join(",")} WHERE id=$1`, [entryId, ...values.map(([, value]) => value)]);
    return entryId;
  }
  if (input.albumId === undefined) throw new OperatorError("invalid", "Selecciona el disco que se añade a la serie.");
  if (!(await db.query("SELECT id FROM public.albums WHERE id=$1 FOR KEY SHARE", [input.albumId])).rowCount) throw new OperatorError("not_found", "Disco inexistente.");
  if ((await db.query("SELECT 1 FROM ingest.series_albums WHERE series_id=$1 AND album_id=$2", [seriesId, input.albumId])).rowCount) {
    throw new OperatorError("already_exists", "Ese disco ya pertenece a la serie.");
  }
  const values = Object.entries({ ...volumeValues(input), series_id: seriesId, album_id: input.albumId, run_id: ctx.runId });
  const inserted = await db.query<{ id: string }>(`INSERT INTO ingest.series_albums(${values.map(([key]) => key).join(",")}) VALUES(${values.map((_, i) => `$${i + 1}`).join(",")}) RETURNING id::text`,
    values.map(([, value]) => value));
  return Number(inserted.rows[0]!.id);
}

export async function deleteSeriesEntry(ctx: OperatorContext, seriesId: number, entryId: number): Promise<number> {
  await lockSeries(ctx, seriesId);
  const removed = await ctx.client.query("DELETE FROM ingest.series_albums WHERE id=$1 AND series_id=$2", [entryId, seriesId]);
  if (!removed.rowCount) throw new OperatorError("not_found", "La entrega no pertenece a esta serie.");
  return entryId;
}
