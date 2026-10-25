// CRV · Perfiles por API dentro de la petición general de curaduría.
//
// La discografía (años, pistas, sellos, discos faltantes) la resuelve el
// código comparando los perfiles de MusicBrainz, Discogs y Deezer/iTunes; el
// modelo ya no lee páginas para eso y se queda con la biografía, integrantes,
// trayectoria, géneros, redes e imágenes. Funciones puras: el planificador
// decide cuándo usarlas.
//
//  * SOLO CON IDENTIDAD FIRME. Hacen falta dos familias de origen confirmadas
//    (Last.fm no cuenta); si no, el modelo sigue revisando la discografía.
//  * EL CÓDIGO PROPONE, NO APLICA. Año y pistas salen como propuestas con su
//    evidencia; lo dudoso (sellos, pistas que no cuadran, discos nuevos) va a
//    pendientes con los valores de cada fuente.
import { createHash } from "node:crypto";
import type { CatalogDraft, CatalogEvidence, CatalogOperation } from "../curation/ai/types.js";
import type { SourceProfileRun } from "./source-profile-run.js";
import { SOURCE_FAMILY, workKey, type OriginFamily, type ProfileRelease, type ProfileSourceSlug, type WorkComparison } from "./source-profiles.js";

/** Áreas de la verificación que cubren los perfiles. */
export const PROFILE_COVERED_AREAS = ["discography", "missingAlbums", "tracks", "labels"] as const;

const SOURCE_LABEL: Record<ProfileSourceSlug, string> = { deezer: "Deezer", itunes: "iTunes", musicbrainz: "MusicBrainz", discogs: "Discogs", lastfm: "Last.fm" };

/** Familias que votan con identidad confirmada. */
export function confirmedFamilies(run: Pick<SourceProfileRun, "profiles">): OriginFamily[] {
  return [...new Set(run.profiles.map((profile) => SOURCE_FAMILY[profile.source]).filter((family) => family !== "lastfm"))];
}

export function profileIsReliable(run: Pick<SourceProfileRun, "profiles">): boolean {
  return confirmedFamilies(run).length >= 2;
}

const clip = (value: string, max = 700) => (value.length <= max ? value : `${value.slice(0, max - 1)}…`);

/** Una cita por disco y fuente: lo que la API dice de ese disco, literal. */
function releaseQuote(source: ProfileSourceSlug, release: ProfileRelease): string {
  const parts = [`${SOURCE_LABEL[source]} (API): «${release.title}»`];
  if (release.year) parts.push(`año ${release.year}`);
  if (release.trackCount) parts.push(`${release.trackCount} pistas`);
  if (release.label) parts.push(`sello ${release.label}`);
  const quote = parts.join(" · ");
  return release.tracks.length ? clip(`${quote} · pistas: ${release.tracks.map((track, index) => `${index + 1}. ${track}`).join("; ")}`, 2000) : quote;
}

/**
 * Propuestas y pendientes del código a partir de la comparación. Año y pistas
 * de discos de la ficha van como operaciones; lo demás, como pendientes.
 */
export function profileDraft(run: SourceProfileRun, fetchedAt = new Date().toISOString()): { draft: CatalogDraft; evidence: CatalogEvidence[] } {
  const evidence: CatalogEvidence[] = [];
  const operations: CatalogOperation[] = [];
  const unresolved: string[] = [];
  const cite = (source: ProfileSourceSlug, release: ProfileRelease): string | null => {
    if (!release.url) return null;
    const quote = releaseQuote(source, release);
    const existing = evidence.find((item) => item.url === release.url && item.quote === quote);
    if (existing) return existing.id;
    const id = `P${evidence.length + 1}`;
    evidence.push({ id, url: release.url, quote, fetchedAt, origin: "source_profile_api", contentHash: createHash("sha256").update(quote).digest("hex"), label: `Perfil ${SOURCE_LABEL[source]}: ${release.title}`, readAt: fetchedAt, acquisitionMethod: "http" });
    return id;
  };
  const releasesOf = (work: WorkComparison) => run.profiles.flatMap((profile) => profile.releases.filter((release) => workKey(release.title) === work.key).map((release) => ({ source: profile.source, release })));
  const citeSources = (work: WorkComparison, sources: ProfileSourceSlug[]) =>
    releasesOf(work).filter((item) => sources.includes(item.source)).flatMap((item) => cite(item.source, item.release) ?? []).slice(0, 8);
  const sourcesOf = (families: OriginFamily[]) => (Object.keys(SOURCE_FAMILY) as ProfileSourceSlug[]).filter((source) => families.includes(SOURCE_FAMILY[source]));
  const values = (bySource: Partial<Record<ProfileSourceSlug, unknown>>) => Object.entries(bySource).map(([source, value]) => `${SOURCE_LABEL[source as ProfileSourceSlug]}: ${value ?? "—"}`).join(", ");

  for (const work of run.works.filter((item) => item.catalogAlbumId !== null)) {
    const album = { kind: "album" as const, id: work.catalogAlbumId! };
    const year = work.year;
    if ((year.status === "propuesta" || year.status === "discrepancia") && year.value !== null && year.support.length >= 2) {
      operations.push({
        op: "replace_fields", target: album, values: { releaseYear: year.value },
        key: `perfil_anio_${album.id}`, label: clip(`${year.catalog ? "Cambiar" : "Añadir"} año de «${work.title}»: ${year.value}`, 160),
        reason: clip(`Perfiles por API: ${values(year.bySource)}. Respaldan ${year.value}: ${year.support.join(" y ")}${year.catalog ? `; la ficha dice ${year.catalog}` : ""}.`),
        evidenceIds: citeSources(work, sourcesOf(year.support)), enabled: true,
      });
    } else if (year.status === "dudoso") {
      unresolved.push(clip(`Año de «${work.title}» (disco ${album.id}) dudoso: ficha ${year.catalog ?? "—"}; ${values(year.bySource)}${year.note ? ` (${year.note})` : ""}.`));
    }
    const tracks = work.tracks;
    if (tracks.status === "propuesta" && tracks.proposed.length) {
      const ids = citeSources(work, tracks.from ? [tracks.from, ...sourcesOf(work.families)] : sourcesOf(work.families));
      tracks.proposed.forEach((title, index) => operations.push({
        op: "create_entity", kind: "track", parent: album, values: { title, discNumber: 1, trackNumber: index + 1 },
        key: `perfil_pista_${album.id}_${index + 1}`, label: clip(`Añadir pista ${index + 1} de «${work.title}»: ${title}`, 160),
        reason: clip(`La ficha no tiene pistas. Lista de ${tracks.from ? SOURCE_LABEL[tracks.from] : "las APIs"}; cada pista figura en al menos ${tracks.agreement} familias de origen.`),
        evidenceIds: ids, enabled: true,
      }));
    } else if (tracks.status === "discrepancia" || tracks.status === "dudoso") {
      unresolved.push(clip(`Pistas de «${work.title}» (disco ${album.id}): ${tracks.note ?? tracks.status}. Revisar con ${releasesOf(work).flatMap((item) => item.release.url ?? []).slice(0, 3).join(" · ")}`));
    }
    const label = work.label;
    if ((label.status === "propuesta" || label.status === "discrepancia") && label.value) {
      unresolved.push(clip(`Sello de «${work.title}» (disco ${album.id}): ${label.value} según ${label.support.join(" y ")}${label.catalog ? ` (ficha: ${label.catalog})` : ""}. Falta resolver la organización en el catálogo.`));
    } else if (label.status === "dudoso") {
      unresolved.push(clip(`Sello de «${work.title}» (disco ${album.id}) dudoso: ${values(label.bySource)}.`));
    }
  }
  const born = run.artistFields.birthYear.value ?? run.artist.birthYear ?? null;
  for (const work of run.works.filter((item) => item.catalogAlbumId === null && item.families.length >= 2)) {
    const early = born !== null && work.year.value !== null && work.year.value < born + 12 ? " Posible homónimo: anterior a los 12 años del titular." : "";
    const urls = releasesOf(work).flatMap((item) => item.release.url ?? []).slice(0, 3);
    unresolved.push(clip(`Disco que la ficha no tiene: «${work.title}» (${work.year.value ?? "año desconocido"}), en ${work.families.join(", ")}.${early} ${urls.join(" · ")}`));
  }
  const families = confirmedFamilies(run);
  const summary = `Perfiles por API (${run.profiles.map((profile) => SOURCE_LABEL[profile.source]).join(", ") || "ninguno"}; ${families.length} familias de origen): ${operations.length} propuestas de discografía y ${unresolved.length} pendientes, sin modelo de IA.`;
  return { draft: { summary, operations, unresolved }, evidence };
}

interface PendingUnit { key: string; area: string; evidenceIds: string[] }

const PROFILE_NOTE = "La discografía (discos, años, pistas y sellos) ya se comparó con las APIs de MusicBrainz, Discogs y Deezer/iTunes y sus propuestas las agrega el código. No propongas ni pidas lookups para discos, pistas, años o sellos; dedícate a biografía, integrantes, trayectoria, géneros, redes e imágenes.";
/** Nota cuando la discografía salió de la ficha por preguntas (las APIs no encontraron al artista). */
export const HUMAN_NOTE = "Las APIs no encontraron a este artista. Su discografía se buscó con preguntas simples en fuentes confiables: las citas con etiqueta «Discos» y «Pistas» son esa respuesta. Propón desde ellas; no pidas lookups para discos, pistas, años o sellos.";

/**
 * Quita del inventario del planificador los hallazgos de discografía y las
 * citas que solo los respaldaban: esas tareas ya las hizo el código. Un pedido
 * dirigido a un hallazgo concreto no se toca.
 */
export function narrowPlanningInventory(context: Record<string, unknown>, evidence: CatalogEvidence[], note = PROFILE_NOTE): { context: Record<string, unknown>; evidence: CatalogEvidence[]; removedFindings: string[]; removedCitations: number } {
  const report = context["report"] as { pending?: PendingUnit[]; selectedKey?: string } | null;
  if (!report?.pending || report.selectedKey) return { context, evidence, removedFindings: [], removedCitations: 0 };
  const covered = new Set<string>(PROFILE_COVERED_AREAS);
  const kept = report.pending.filter((unit) => !covered.has(unit.area));
  const removed = report.pending.filter((unit) => covered.has(unit.area));
  const keptIds = new Set(kept.flatMap((unit) => unit.evidenceIds));
  const removedIds = new Set(removed.flatMap((unit) => unit.evidenceIds).filter((id) => !keptIds.has(id)));
  const nextEvidence = evidence.filter((item) => !removedIds.has(item.id));
  return {
    context: {
      ...context, report: { ...report, pending: kept }, evidence: nextEvidence,
      sourceProfiles: {
        covered: [...PROFILE_COVERED_AREAS],
        note,
      },
    },
    evidence: nextEvidence, removedFindings: removed.map((unit) => unit.key), removedCitations: evidence.length - nextEvidence.length,
  };
}
