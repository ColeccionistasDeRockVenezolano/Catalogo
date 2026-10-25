import type { Pool, PoolClient } from "pg";
import { dateYear, parseDateValue } from "./date-value.js";
import { updateEntity, OperatorError, type OperatorContext } from "../merge/operator.js";

type Database = Pick<Pool | PoolClient, "query">;
export const MODEL_TABLES = {
  work: "catalog_works", edition: "catalog_edition_details", identity: "musical_identities",
  support: "edition_support_details", genre: "scoped_genres",
} as const;
export type ModelKind = keyof typeof MODEL_TABLES;
interface ModelFields {
  title?: string; artistId?: number; personId?: number; albumId?: number; trackId?: number;
  genreSlug?: string; workId?: number | null; albumFormatId?: number | null; genreId?: number;
  relationship?: "solo_identity" | "member" | "collaborator";
  period?: string | null; releaseDate?: string | null; editionName?: string | null;
  format?: string; discNumber?: number; notes?: string | null; trackIds?: number[];
}
export type ModelInput = { [K in keyof ModelFields]?: ModelFields[K] | undefined };
const allowed: Record<ModelKind, readonly (keyof ModelInput)[]> = {
  work: ["title", "artistId", "notes"],
  edition: ["albumId", "workId", "releaseDate", "editionName", "notes"],
  identity: ["personId", "artistId", "relationship", "period", "notes"],
  support: ["albumId", "albumFormatId", "format", "discNumber", "notes", "trackIds"],
  genre: ["artistId", "personId", "albumId", "trackId", "genreId", "period", "notes"],
};
const parents: Partial<Record<keyof ModelInput, string>> = {
  artistId: "public.artists", personId: "public.persons", albumId: "public.albums", trackId: "public.tracks",
  workId: "ingest.catalog_works", albumFormatId: "public.album_formats", genreId: "ingest.genres",
};
const column = (key: string) => key.replace(/[A-Z]/gu, char => `_${char.toLowerCase()}`);

/** All model decisions share the existing operator transaction and strict undo. */
export async function writeModel(context: OperatorContext, kind: ModelKind, input: ModelInput, id?: number): Promise<number> {
  const table = MODEL_TABLES[kind];
  if (!table || !Object.keys(input).length) throw new OperatorError("invalid", "datos del modelo obligatorios");
  if (kind === "genre" && input.genreSlug !== undefined) {
    if (input.genreId !== undefined) throw new OperatorError("invalid", "elige un solo identificador de género");
    const genre=(await context.client.query<{id:string}>("SELECT id::text FROM ingest.genres WHERE slug=$1 AND active FOR KEY SHARE",[input.genreSlug])).rows[0];
    if(!genre) throw new OperatorError("not_found", "género activo inexistente");
    const {genreSlug: _slug,...rest}=input;
    input={...rest,genreId:Number(genre.id)};
  }
  const entries = Object.entries(input).filter(([, value]) => value !== undefined);
  for (const [key, value] of entries) {
    if (!allowed[kind].includes(key as keyof ModelInput)) throw new OperatorError("invalid", `campo ${key} no admitido en ${kind}`);
    const parent = parents[key as keyof ModelInput];
    if (parent && value !== null && !(await context.client.query(`SELECT id FROM ${parent} WHERE id=$1 FOR UPDATE`, [value])).rowCount) {
      throw new OperatorError("not_found", `destino ${key} inexistente`);
    }
  }
  const values = entries.filter(([key]) => key !== "trackIds").map(([key, value]) => [column(key),
    ["period", "releaseDate"].includes(key) && value !== null ? JSON.stringify(parseDateValue(String(value))) : value] as const);
  let result: number;
  if (id === undefined) {
    if (!values.length) throw new OperatorError("invalid", "no hay datos para crear");
    const inserted = await context.client.query<{ id: string }>(`INSERT INTO ingest.${table}(${values.map(([key]) => key).join(",")}) VALUES(${values.map((_, i) => `$${i + 1}`).join(",")}) RETURNING id::text`, values.map(([, value]) => value));
    result = Number(inserted.rows[0]!.id);
  } else {
    if (!(await context.client.query(`SELECT id FROM ingest.${table} WHERE id=$1 FOR UPDATE`, [id])).rowCount) throw new OperatorError("not_found", "registro del modelo inexistente");
    if (values.length) await context.client.query(`UPDATE ingest.${table} SET ${values.map(([key], i) => `${key}=$${i + 2}`).join(",")} WHERE id=$1`, [id, ...values.map(([, value]) => value)]);
    result = id;
  }
  if (input.trackIds !== undefined) {
    await context.client.query("DELETE FROM ingest.support_tracks WHERE support_id=$1", [result]);
    for (const track of [...new Set(input.trackIds)].sort((a,b) => a-b)) {
      if (!(await context.client.query("SELECT id FROM public.tracks WHERE id=$1 FOR UPDATE", [track])).rowCount) throw new OperatorError("not_found", "pista inexistente");
      await context.client.query("INSERT INTO ingest.support_tracks(support_id,track_id) VALUES($1,$2)", [result, track]);
    }
  }
  if(kind === "edition" && input.releaseDate !== undefined && input.releaseDate !== null) {
    const owner=(await context.client.query<{album_id:string}>("SELECT album_id::text FROM ingest.catalog_edition_details WHERE id=$1",[result])).rows[0]!;
    await updateEntity(context,"album",Number(owner.album_id),{release_year:dateYear(input.releaseDate)});
  }
  return result;
}

export async function deleteModel(context: OperatorContext, kind: ModelKind, id: number): Promise<void> {
  const result = await context.client.query(`DELETE FROM ingest.${MODEL_TABLES[kind]} WHERE id=$1`, [id]);
  if (!result.rowCount) throw new OperatorError("not_found", "registro del modelo inexistente");
}

export async function readModel(db: Database, kind: "artist" | "person" | "album" | "track", id: number) {
  const table={artist:"artists",person:"persons",album:"albums",track:"tracks"}[kind];
  if(!(await db.query(`SELECT 1 FROM public.${table} WHERE id=$1`,[id])).rowCount) throw new OperatorError("not_found","ficha inexistente");
  const identities = kind === "person" || kind === "artist" ? (await db.query(`SELECT m.*,a.name AS artist_name,p.name AS person_name FROM ingest.musical_identities m JOIN public.artists a ON a.id=m.artist_id JOIN public.persons p ON p.id=m.person_id WHERE m.${kind}_id=$1 ORDER BY m.id`,[id])).rows : [];
  const editions = kind === "album" || kind === "artist" ? (await db.query(`SELECT e.*,w.title AS work_title,a.title,a.artist_id,a.label_id,a.media_format,a.release_date_text,a.release_year FROM ingest.catalog_edition_details e JOIN public.albums a ON a.id=e.album_id LEFT JOIN ingest.catalog_works w ON w.id=e.work_id WHERE a.${kind === "album" ? "id" : "artist_id"}=$1 ORDER BY e.id`,[id])).rows : [];
  const works = kind === "artist" || kind === "album" ? (await db.query(`SELECT * FROM ingest.catalog_works WHERE artist_id=${kind === "artist" ? "$1" : "(SELECT artist_id FROM public.albums WHERE id=$1)"} ORDER BY id`,[id])).rows : [];
  const supports = kind === "album" ? (await db.query(`SELECT s.*,COALESCE((SELECT jsonb_agg(track_id ORDER BY track_id) FROM ingest.support_tracks WHERE support_id=s.id),'[]'::jsonb) AS track_ids FROM ingest.edition_support_details s WHERE album_id=$1 ORDER BY disc_number,id`,[id])).rows : [];
  const genres = (await db.query(`SELECT s.*,g.name AS genre_name FROM ingest.scoped_genres s JOIN ingest.genres g ON g.id=s.genre_id WHERE s.${kind}_id=$1 ORDER BY s.id`,[id])).rows;
  return { identities, editions, works, supports, genres };
}
