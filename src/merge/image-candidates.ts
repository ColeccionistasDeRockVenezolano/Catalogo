// CRV · Regla del catálogo para imágenes (Brian, 2026-10-04): «cada imagen que
// entre al catálogo, sea de perfil de artista o de álbum, crea un conflicto que
// aparece en Curaduría · Portadas y fotos para seleccionar cuál queda como
// principal».
//
// Si la ficha NO tiene imagen, la primera que llega se usa (no hay nada que
// elegir). Si YA tiene una y llega otra distinta, la actual se queda y la nueva
// se propone en `ingest.image_candidates` (0038); se decide a ojo en
// /curaduria/imagenes. No se abre conflicto genérico de campo.
//
// No es «nueva» una imagen que ya se conoce para esa ficha:
//   · la URL de origen de la copia local que se muestra hoy (manifiesto de medios);
//   · una URL que otra afirmación de la ficha ya puso (claim aceptado o reemplazado);
//   · una URL que ya fue candidata (abierta, elegida o descartada: no se reabre).
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import type { PoolClient } from "pg";

export type ImageEntityKind = "album" | "artist";

/** Campo de imagen principal por tipo de ficha. Personas y organizaciones quedan fuera de la regla. */
export const IMAGE_FIELD: Readonly<Record<ImageEntityKind, string>> = { album: "cover_url", artist: "picture_url" };

export function isImageField(kind: string, field: string): kind is ImageEntityKind {
  return (kind === "album" || kind === "artist") && IMAGE_FIELD[kind] === field;
}

const TARGET_COLUMN: Readonly<Record<ImageEntityKind, string>> = { album: "album_id", artist: "artist_id" };

let manifestCache: { file: string; mtimeMs: number; entries: Record<string, { sourceUrl?: string }> } | undefined;

function manifestFile(): string {
  return process.env["CRV_MEDIA_MANIFEST"] ?? path.resolve(process.cwd(), "web/public/media/manifest.json");
}

/** URL de origen de la copia local que la ficha muestra hoy, si la hay. */
export function localSourceUrl(kind: ImageEntityKind, id: number): string | undefined {
  const file = manifestFile();
  try {
    const { mtimeMs } = statSync(file);
    if (!manifestCache || manifestCache.file !== file || manifestCache.mtimeMs !== mtimeMs) {
      const parsed = JSON.parse(readFileSync(file, "utf8")) as { entries?: Record<string, { sourceUrl?: string }> };
      manifestCache = { file, mtimeMs, entries: parsed.entries ?? {} };
    }
  } catch {
    return undefined;
  }
  return manifestCache.entries[`${kind}:${id}`]?.sourceUrl;
}

export interface ImageProposal {
  kind: ImageEntityKind;
  targetId: number;
  currentUrl: string | null;
  candidateUrl: string;
  /** Claim que trajo la imagen (se excluye de «ya conocida»). */
  claimId?: number;
  sourceId?: number;
  source?: string;
  pageUrl?: string | null;
  width?: number | null;
  height?: number | null;
  origin: string;
  runId?: number | null;
  /** Texto de la página que describe la imagen (pie, alt, «Imagen: …»); sirve para clasificar su uso. */
  context?: string | null;
}

/** proposed = candidata nueva; already = ya era candidata (no se reabre); known = es la imagen que la ficha ya usa. */
export type ImageProposalResult = "proposed" | "already" | "known";

/** Propone una imagen distinta de la actual en Curaduría · Portadas y fotos; nunca toca el core. */
export async function proposeImageCandidate(client: PoolClient, proposal: ImageProposal): Promise<ImageProposalResult> {
  const { kind, targetId, currentUrl, candidateUrl } = proposal;
  if (candidateUrl === currentUrl || candidateUrl === localSourceUrl(kind, targetId)) return "known";
  const column = TARGET_COLUMN[kind];
  const field = IMAGE_FIELD[kind];
  const seen = await client.query(`
    SELECT 1 FROM ingest.claims
     WHERE ${column}=$1 AND field=$2 AND id<>$3 AND status IN ('accepted','superseded')
       AND COALESCE(normalized_value, raw_value) #>> '{}' = $4
     LIMIT 1`, [targetId, field, proposal.claimId ?? 0, candidateUrl]);
  if (seen.rowCount) return "known";
  let source = proposal.source;
  if (!source && proposal.sourceId !== undefined) {
    const row = await client.query<{ name: string }>("SELECT name FROM ingest.sources WHERE id=$1", [proposal.sourceId]);
    source = row.rows[0]?.name;
  }
  const inserted = await client.query(`
    INSERT INTO ingest.image_candidates(entity_kind, ${column}, current_url, candidate_url, source, page_url, origin, run_id, width, height, image_context)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
    ON CONFLICT DO NOTHING`,
  [kind, targetId, currentUrl, candidateUrl, (source ?? "fuente").slice(0, 40), proposal.pageUrl ?? null, proposal.origin.slice(0, 80), proposal.runId ?? null, proposal.width ?? null, proposal.height ?? null, proposal.context?.slice(0, 500) || null]);
  return inserted.rowCount ? "proposed" : "already";
}
