// CRV · Ficha por preguntas para un artista del catálogo: arma las
// dependencias (buscador, lector de páginas, modelo y fuentes confiables) y
// convierte lo encontrado en citas para el planificador.
import { createHash } from "node:crypto";
import type { Pool } from "pg";
import { createDeepSeekGateway, type DeepSeekGateway } from "../ai/gateway.js";
import { WebSearchBroker } from "../ambiguity/web-search.js";
import type { CatalogEvidence } from "../curation/ai/types.js";
import { hostOf, humanResearch, TRUSTED_DOMAINS, type HumanArtist, type HumanDossier, type HumanField } from "./human-research.js";
import type { SourceProfileRun } from "./source-profile-run.js";

export async function humanResearchForArtist(db: Pool, run: Pick<SourceProfileRun, "artist">, options: { gateway?: DeepSeekGateway; log?: (line: string) => void } = {}): Promise<HumanDossier> {
  const type = (await db.query<{ artist_type: string | null }>("SELECT artist_type FROM public.artists WHERE id=$1", [run.artist.id])).rows[0]?.artist_type ?? null;
  const artist: HumanArtist = {
    name: run.artist.name, aliases: run.artist.aliases, type, country: run.artist.country, formedYear: run.artist.formedYear, memberNames: run.artist.memberNames,
    albums: run.artist.albums.map((album) => ({ title: album.title, year: album.year, trackCount: album.trackTitles.length })),
  };
  // Confiables: nuestras fuentes registradas más bases de datos, prensa y redes oficiales.
  const ours = (await db.query<{ url: string | null }>("SELECT url FROM ingest.sources WHERE enabled")).rows.flatMap((row) => (row.url ? hostOf(row.url) ?? [] : []));
  // Nuestras páginas de este artista (o de sus discos), las de fuentes con texto primero.
  const ownUrls = (await db.query<{ url: string }>(`
    SELECT e.url, min(CASE WHEN s.trust_level IN ('high','medium') THEN 0 ELSE 1 END) AS rank
      FROM ingest.claims c JOIN ingest.sources s ON s.id=c.source_id JOIN ingest.claim_evidence e ON e.claim_id=c.id
     WHERE (c.artist_id=$1 OR c.album_id IN (SELECT id FROM public.albums WHERE artist_id=$1)) AND e.url ~ '^https?://'
     GROUP BY e.url ORDER BY rank, e.url LIMIT 4`, [run.artist.id])).rows.map((row) => row.url);
  const broker = new WebSearchBroker(db);
  return humanResearch(artist, {
    search: (query) => broker.search(query), page: (url) => broker.page(url), gateway: options.gateway ?? createDeepSeekGateway(),
    trusted: [...new Set([...TRUSTED_DOMAINS, ...ours])], ownUrls, ...(options.log ? { log: options.log } : {}),
  });
}

const FIELD_LABEL: Record<HumanField, string> = { identidad: "Quién es", biografia: "Historia", origen: "Origen", integrantes: "Integrantes y créditos", discografia: "Discos", pistas: "Pistas", generos: "Géneros", redes: "Redes oficiales" };

/**
 * Una cita por dato, agrupada por página y pregunta: el planificador recibe
 * solo lo que respondió cada pregunta, no las páginas enteras.
 */
export function dossierEvidence(dossier: HumanDossier, fetchedAt = new Date().toISOString()): CatalogEvidence[] {
  const evidence: CatalogEvidence[] = [];
  for (const [field, items] of Object.entries(dossier.fields) as Array<[HumanField, HumanDossier["fields"][HumanField]]>) {
    for (const item of items) {
      if (evidence.some((other) => other.url === item.url && other.quote === item.quote)) continue;
      const question = dossier.questions.find((entry) => entry.field === field && entry.items.some((answer) => answer.quote === item.quote))?.question ?? FIELD_LABEL[field];
      evidence.push({
        id: `H${evidence.length + 1}`, url: item.url, quote: item.quote, fetchedAt, origin: "human_question", contentHash: createHash("sha256").update(item.quote).digest("hex"),
        label: `${FIELD_LABEL[field]} · ${question}${item.album ? ` · «${item.album}»` : ""}`, readAt: fetchedAt, acquisitionMethod: "http",
      });
    }
  }
  return evidence;
}
