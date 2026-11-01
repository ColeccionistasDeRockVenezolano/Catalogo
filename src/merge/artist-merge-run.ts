// CRV · Núcleo compartido de fusión de artistas (etapa 2 de unificación).
//
// Lo usan la CLI (`src/review/artist-merge.ts`) y la acción `fusionar` de
// Curaduría (`src/curation/actions/merge.ts`). Una sola implementación:
//  - elige la ficha canónica por contenido real, no por créditos;
//  - combina los textos largos y los deja marcados para reescribir;
//  - no impone años incompatibles: los anota en `notes`;
//  - mueve todas las referencias con `mergeEntities` (camino auditado);
//  - compara integrantes, discos, audiovisuales, alias y fechas antes y
//    después; si falta algo lanza `ArtistMergeLossError` para que la
//    transacción del llamador se revierta.
//
// No abre transacciones ni escribe fuera del `OperatorContext` que recibe.
import type { PoolClient } from "pg";
import {
  mergeEntities, previewEntityMerge,
  type EntityMergePreview, type EntityMergeResult, type MergeFieldChoice,
} from "./entity-merge.js";
import type { OperatorContext } from "./operator.js";
import { OperatorError } from "./operator.js";
import { normalizeEntityName } from "../normalization/entity-name.js";
import { dedupeArtistPersons, type PersonDedupeResult } from "../review/person-dedupe.js";
import { dedupeArtistAlbums, type AlbumDedupeResult } from "../review/album-dedupe.js";
import { recordMergeFeedback } from "../curation/feedback.js";

export interface ArtistProfile {
  id: number;
  name: string;
  artistType: string;
  originCity: string | null;
  originCountry: string | null;
  formedYear: number | null;
  disbandedYear: number | null;
  yearsActive: string | null;
  status: string | null;
  biography: string | null;
  aliases: string[];
  members: Array<{ name: string; role: string; from: number | null; to: number | null }>;
  albums: Array<{ title: string; year: number | null; type: string }>;
  audiovisuals: Array<{ title: string; year: number | null; videoId: number | null }>;
  links: string[];
  evidence: string[];
  claims: number;
  gallery: number;
  documents: number;
  mediaLinks: number;
}

/** Perfiles completos de los artistas implicados, en siete consultas planas. */
export async function loadArtistProfiles(
  queryable: Pick<PoolClient, "query">, ids: number[],
): Promise<Map<number, ArtistProfile>> {
  const unique = [...new Set(ids)];
  if (!unique.length) return new Map();
  const rows = (await queryable.query<{
    id: string; name: string; artist_type: string; origin_city: string | null; origin_country: string | null;
    formed_year: number | null; disbanded_year: number | null; years_active: string | null; status: string | null;
    biography: string | null;
  }>(`SELECT id::text,name,artist_type::text,origin_city,origin_country,formed_year,disbanded_year,years_active,status,biography
        FROM public.artists WHERE id=ANY($1::bigint[])`, [unique])).rows;
  const byId = new Map<number, ArtistProfile>();
  for (const row of rows) {
    byId.set(Number(row.id), {
      id: Number(row.id), name: row.name, artistType: row.artist_type, originCity: row.origin_city,
      originCountry: row.origin_country, formedYear: row.formed_year, disbandedYear: row.disbanded_year,
      yearsActive: row.years_active, status: row.status, biography: row.biography,
      aliases: [], members: [], albums: [], audiovisuals: [], links: [], evidence: [],
      claims: 0, gallery: 0, documents: 0, mediaLinks: 0,
    });
  }
  const aliases = (await queryable.query<{ artist_id: string; alias: string }>(
    "SELECT artist_id::text,alias FROM ingest.artist_aliases WHERE artist_id=ANY($1::bigint[]) ORDER BY alias", [unique])).rows;
  for (const row of aliases) byId.get(Number(row.artist_id))?.aliases.push(row.alias);
  const members = (await queryable.query<{ artist_id: string; name: string; role: string; from_year: number | null; to_year: number | null }>(`
    SELECT m.artist_id::text,p.name,m.role,m.from_year,m.to_year
      FROM public.artist_members m JOIN public.persons p ON p.id=m.person_id
     WHERE m.artist_id=ANY($1::bigint[]) ORDER BY m.from_year NULLS FIRST,m.id`, [unique])).rows;
  for (const row of members) byId.get(Number(row.artist_id))?.members.push({
    name: row.name, role: row.role, from: row.from_year, to: row.to_year,
  });
  const albums = (await queryable.query<{ artist_id: string; title: string; release_year: number | null; album_type: string }>(
    "SELECT artist_id::text,title,release_year,album_type::text FROM public.albums WHERE artist_id=ANY($1::bigint[]) ORDER BY release_year NULLS LAST,title",
    [unique])).rows;
  for (const row of albums) byId.get(Number(row.artist_id))?.albums.push({
    title: row.title, year: row.release_year, type: row.album_type,
  });
  const audiovisuals = (await queryable.query<{ artist_id: string; title: string; release_year: number | null; video_id: string | null }>(
    "SELECT artist_id::text,title,release_year,video_id::text FROM media.artist_audiovisuals WHERE artist_id=ANY($1::bigint[]) ORDER BY release_year NULLS LAST,title",
    [unique])).rows;
  for (const row of audiovisuals) byId.get(Number(row.artist_id))?.audiovisuals.push({
    title: row.title, year: row.release_year, videoId: row.video_id === null ? null : Number(row.video_id),
  });
  const links = (await queryable.query<{ artist_id: string; url: string }>(`
    SELECT artist_id::text,url FROM public.social_links WHERE artist_id=ANY($1::bigint[])
    UNION SELECT artist_id::text,url FROM public.streaming_links WHERE artist_id=ANY($1::bigint[]) AND album_id IS NULL`, [unique])).rows;
  for (const row of links) byId.get(Number(row.artist_id))?.links.push(row.url);
  const evidence = (await queryable.query<{ artist_id: string; url: string }>(`
    SELECT DISTINCT c.artist_id::text,e.url FROM ingest.claims c JOIN ingest.claim_evidence e ON e.claim_id=c.id
     WHERE c.artist_id=ANY($1::bigint[]) AND e.url ~ '^https?://'`, [unique])).rows;
  for (const row of evidence) byId.get(Number(row.artist_id))?.evidence.push(row.url);
  const counts = (await queryable.query<{
    id: string; claims: string; gallery: string; documents: string; media_links: string;
  }>(`SELECT a.id::text,
             (SELECT count(*) FROM ingest.claims c WHERE c.artist_id=a.id)::text AS claims,
             (SELECT count(*) FROM media.artist_gallery g WHERE g.artist_id=a.id)::text AS gallery,
             (SELECT count(*) FROM media.artist_documents d WHERE d.artist_id=a.id)::text AS documents,
             (SELECT count(*) FROM media.media_links l WHERE l.artist_id=a.id)::text AS media_links
        FROM public.artists a WHERE a.id=ANY($1::bigint[])`, [unique])).rows;
  for (const row of counts) {
    const profile = byId.get(Number(row.id));
    if (!profile) continue;
    profile.claims = Number(row.claims); profile.gallery = Number(row.gallery);
    profile.documents = Number(row.documents); profile.mediaLinks = Number(row.media_links);
  }
  return byId;
}

/**
 * Ficha que se conserva: la más completa de verdad. El `recommendedKeepId` de
 * `previewEntityMerge` solo cuenta membresías y créditos, y dejaba perder la
 * ficha canónica de un artista con 85 discos frente a un alias con 6 (caso
 * Nuuro/Arca). Aquí pesan discos, audiovisuales, integrantes, alias, galería,
 * documentos, enlaces y claims; a igualdad, el id menor (URL estable).
 */
export function chooseArtistKeep(a: ArtistProfile, b: ArtistProfile): number {
  const richness = (profile: ArtistProfile) => profile.albums.length * 30 + profile.audiovisuals.length * 20
    + profile.members.length * 10 + profile.aliases.length * 8 + profile.gallery * 2 + profile.documents * 2
    + profile.links.length * 5 + profile.claims;
  const difference = richness(a) - richness(b);
  if (difference !== 0) return difference > 0 ? a.id : b.id;
  return Math.min(a.id, b.id);
}

export interface RelationSnapshot {
  members: Set<string>;
  albums: Set<string>;
  audiovisuals: Set<string>;
  aliases: Set<string>;
  claims: number;
  gallery: number;
  documents: number;
  mediaLinks: number;
}

const key = (value: string) => normalizeEntityName(value).secondaryKey;

export async function snapshotRelations(queryable: Pick<PoolClient, "query">, artistId: number): Promise<RelationSnapshot> {
  const members = (await queryable.query<{ name: string }>(`
    SELECT p.name FROM public.artist_members m JOIN public.persons p ON p.id=m.person_id WHERE m.artist_id=$1`, [artistId])).rows;
  const albums = (await queryable.query<{ title: string; release_year: number | null }>(
    "SELECT title,release_year FROM public.albums WHERE artist_id=$1", [artistId])).rows;
  const audiovisuals = (await queryable.query<{ video_id: string | null; source_key: string }>(
    "SELECT video_id::text,source_key FROM media.artist_audiovisuals WHERE artist_id=$1", [artistId])).rows;
  const aliases = (await queryable.query<{ alias: string }>(
    "SELECT alias FROM ingest.artist_aliases WHERE artist_id=$1", [artistId])).rows;
  const counts = (await queryable.query<{ claims: string; gallery: string; documents: string; media_links: string }>(`
    SELECT (SELECT count(*) FROM ingest.claims WHERE artist_id=$1)::text AS claims,
           (SELECT count(*) FROM media.artist_gallery WHERE artist_id=$1)::text AS gallery,
           (SELECT count(*) FROM media.artist_documents WHERE artist_id=$1)::text AS documents,
           (SELECT count(*) FROM media.media_links WHERE artist_id=$1)::text AS media_links`, [artistId])).rows[0]!;
  return {
    members: new Set((members as Array<{ name: string }>).map((row) => key(row.name))),
    albums: new Set((albums as Array<{ title: string; release_year: number | null }>).map((row) => `${key(row.title)}|${row.release_year ?? ""}`)),
    audiovisuals: new Set((audiovisuals as Array<{ video_id: string | null; source_key: string }>).map((row) => row.video_id ?? row.source_key)),
    aliases: new Set((aliases as Array<{ alias: string }>).map((row) => key(row.alias))),
    claims: Number(counts.claims), gallery: Number(counts.gallery),
    documents: Number(counts.documents), mediaLinks: Number(counts.media_links),
  };
}

/** Lo que falta tras fusionar, comparando el duplicado con la ficha que queda. */
export function missingAfterMerge(before: RelationSnapshot, after: RelationSnapshot, keepName?: string): string[] {
  const missing: string[] = [];
  const aliases = new Set(after.aliases);
  if (keepName) aliases.add(key(keepName));
  const diff = (what: string, from: Set<string>, to: Set<string>) => {
    const lost = [...from].filter((item) => !to.has(item));
    if (lost.length) missing.push(`${what}: ${lost.slice(0, 5).join(", ")}${lost.length > 5 ? ` (+${lost.length - 5})` : ""}`);
  };
  diff("integrantes", before.members, after.members);
  diff("discos", before.albums, after.albums);
  diff("audiovisuales", before.audiovisuals, after.audiovisuals);
  diff("alias", before.aliases, aliases);
  return missing;
}

/** Columnas de la ficha que no pueden desaparecer al fusionar. */
const MERGE_FIELD_COLUMNS = [
  "origin_city", "origin_country", "formed_year", "disbanded_year", "years_active", "status",
  "biography", "picture_url", "logo_url", "themes", "current_city", "current_country", "email",
] as const;

function hasValue(value: unknown): boolean {
  return value !== null && value !== undefined && (typeof value !== "string" || value.trim() !== "");
}

export async function fieldSnapshot(queryable: Pick<PoolClient, "query">, artistId: number): Promise<Record<string, unknown>> {
  const row = (await queryable.query<Record<string, unknown>>(
    `SELECT ${MERGE_FIELD_COLUMNS.join(",")},notes FROM public.artists WHERE id=$1`, [artistId])).rows[0];
  return row ?? {};
}

/** Campos que el duplicado tenía, la ficha conservada no, y la fusión no completó. */
export function missingFields(
  beforeKeep: Record<string, unknown>, beforeDrop: Record<string, unknown>, after: Record<string, unknown>,
): string[] {
  const notes = String(after["notes"] ?? "");
  return MERGE_FIELD_COLUMNS.filter((column) => {
    if (!hasValue(beforeDrop[column]) || hasValue(beforeKeep[column]) || hasValue(after[column])) return false;
    // Un año incompatible no se aplica, pero queda escrito en las notas.
    if ((column === "formed_year" || column === "disbanded_year") && notes.includes(String(beforeDrop[column]))) return false;
    return true;
  });
}

export class ArtistMergeLossError extends Error {
  readonly missing: string[];
  constructor(missing: string[]) {
    super(`faltaban datos tras la fusión: ${missing.join(" · ")}`);
    this.name = "ArtistMergeLossError";
    this.missing = missing;
  }
}

export interface ArtistMergeRunOptions {
  keepId: number;
  dropId: number;
  /** Hash de la vista previa que aprobó la persona; si no coincide, no se fusiona. */
  previewHash?: string;
  /** Desactiva la verificación solo en pruebas internas. */
  verify?: boolean;
}

export interface ArtistMergeRunResult {
  keepId: number;
  dropId: number;
  preview: EntityMergePreview;
  merged: EntityMergeResult;
  missing: string[];
  persons: PersonDedupeResult;
  albums: AlbumDedupeResult;
}

/**
 * Fusiona dentro de una transacción y un run ya abiertos. Si falta algo lanza
 * `ArtistMergeLossError`; el llamador debe revertir la transacción.
 */
export async function mergeArtistVerified(
  context: OperatorContext, options: ArtistMergeRunOptions,
): Promise<ArtistMergeRunResult> {
  const { keepId, dropId } = options;
  if (keepId === dropId) throw new OperatorError("invalid", "no se puede fusionar una ficha consigo misma");
  const preview = await previewEntityMerge(context.client, "artist", keepId, dropId, { lock: true });
  if (options.previewHash !== undefined && options.previewHash !== preview.previewHash) {
    throw new OperatorError("stale_preview", "la vista previa de la fusión cambió; vuelve a abrirla");
  }
  const beforeDrop = await snapshotRelations(context.client, dropId);
  const fieldsKeep = await fieldSnapshot(context.client, keepId);
  const fieldsDrop = await fieldSnapshot(context.client, dropId);
  const choices: Partial<Record<string, MergeFieldChoice>> = {};
  for (const field of preview.combinableFields) choices[field] = "combine";
  const merged = await mergeEntities(context, {
    kind: "artist", keepId, dropId, previewHash: preview.previewHash,
    fieldChoices: choices, rewriteLater: true, keepDropNameAsAlias: true,
  });
  if (options.verify === false) return { keepId, dropId, preview, merged, missing: [], persons: { merged: 0, skipped: 0, groups: 0, details: [] }, albums: { merged: 0, skipped: 0, groups: 0, details: [] } };
  const after = await snapshotRelations(context.client, keepId);
  const afterFields = await fieldSnapshot(context.client, keepId);
  const missing = [
    ...missingAfterMerge(beforeDrop, after, preview.keep.name),
    ...missingFields(fieldsKeep, fieldsDrop, afterFields),
  ];
  if (missing.length) throw new ArtistMergeLossError(missing);
  await context.client.query(`
    UPDATE ingest.review_queue
       SET status='approved', resolved_by='human', resolved_at=now(), updated_at=now(), resolution_note=$3
     WHERE kind='possible_duplicate' AND status IN ('open','in_progress')
       AND LEAST(artist_a_id,artist_b_id)=LEAST($1::bigint,$2::bigint)
       AND GREATEST(artist_a_id,artist_b_id)=GREATEST($1::bigint,$2::bigint)`,
  [keepId, dropId, `Fusionado desde Curaduría: ${context.note}`.slice(0, 1500)]);
  await recordMergeFeedback(context, {
    kind: "artist", aId: keepId, bId: dropId, outcome: "same_identity", source: "merge",
    note: context.note,
  });
  // La fusión deja dos fichas de la misma persona con el mismo nombre: se unen
  // dentro del mismo run y con la misma auditoría.
  const persons = await dedupeArtistPersons(context, keepId);
  const albums = await dedupeArtistAlbums(context, keepId);
  return { keepId, dropId, preview, merged, missing: [], persons, albums };
}
