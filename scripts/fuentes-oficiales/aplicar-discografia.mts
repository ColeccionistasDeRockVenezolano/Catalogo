// CRV · Aplicador del cotejo de discografía con Bandcamp oficial (Brian, 2026-10-13).
//
// Escribe SOLO huecos, en un run del operador (se deshace por run):
//   - lista de pistas de los discos del catálogo que no tienen ninguna (posición, título, duración);
//   - duración de pistas que no la tenían (misma posición y título).
// No crea discos ni cambia años ni títulos: los discos faltantes, los años distintos y las listas que
// no cuadran van al informe para revisión. Fichas con identidad sin confirmar u homónimas: se saltan.
// Sin --confirm la transacción se revierte (vista previa exacta).
// Uso: tsx scripts/fuentes-oficiales/aplicar-discografia.mts [--in=…jsonl] [--ids=…] [--confirm]
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { closeDb } from "../../src/db/client.js";
import { createEntity, updateEntity, withOperatorRun } from "../../src/merge/operator.js";
import type { DiscographyRow } from "./cotejar-discografia.mjs";

const arg = (name: string) => process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const IN = arg("in") ?? "reports/fuentes-oficiales-2026-10-13/discografia.jsonl";
const ONLY = arg("ids")?.split(",").map(Number);
const CONFIRM = process.argv.includes("--confirm");
const REPORT = `reports/fuentes-oficiales-2026-10-13/aplicar-discografia-${CONFIRM ? "aplicado" : "vista-previa"}.json`;
const OPERATOR = "claude-code (delegado por Brian)";

async function main(): Promise<void> {
  const rows = (existsSync(IN) ? readFileSync(IN, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l) as DiscographyRow) : [])
    .filter((row) => !ONLY || ONLY.includes(row.artistId));
  const report = {
    run: null as number | null,
    tracklists: [] as Array<{ artistId: number; artist: string; albumId: number; album: string; tracks: number; url: string }>,
    durations: [] as Array<{ albumId: number; album: string; trackId: number; title: string; seconds: number }>,
    review: {
      skipped: rows.filter((row) => !["trayectoria", "disco-en-comun"].includes(row.identity)).map((row) => ({ artistId: row.artistId, artist: row.name, identity: row.identity, missing: row.missing.length })),
      missingAlbums: [] as Array<{ artistId: number; artist: string; title: string; year: number | null; tracks: number; url: string }>,
      yearDiffs: [] as Array<{ artistId: number; artist: string; albumId: number; album: string; catalog: number; source: number; url: string }>,
      trackDiffs: [] as Array<{ artistId: number; artist: string; albumId: number; album: string; diffs: string[]; url: string }>,
      failed: [] as Array<{ albumId: number; album: string; error: string }>,
    },
  };
  const usable = rows.filter((row) => ["trayectoria", "disco-en-comun"].includes(row.identity));
  const { runId } = await withOperatorRun({
    name: "fuentes-oficiales:discografia",
    operator: OPERATOR,
    note: "Listas de pistas y duraciones de discos sin pistas desde el Bandcamp oficial del artista (datos estructurados de la página); campaña de fuentes oficiales 2026-10-13 pedida por Brian.",
    params: { fichas: usable.length },
  }, async (context) => {
    for (const row of usable) {
      for (const album of row.missing) report.review.missingAlbums.push({ artistId: row.artistId, artist: row.name, title: album.title, year: album.year, tracks: album.tracks.length, url: album.url });
      for (const match of row.matched) {
        if (match.catalogYear && match.sourceYear && match.catalogYear !== match.sourceYear)
          report.review.yearDiffs.push({ artistId: row.artistId, artist: row.name, albumId: match.albumId, album: match.title, catalog: match.catalogYear, source: match.sourceYear, url: match.url });
        if (match.trackDiffs.length) report.review.trackDiffs.push({ artistId: row.artistId, artist: row.name, albumId: match.albumId, album: match.title, diffs: match.trackDiffs, url: match.url });
        await context.client.query("SAVEPOINT disco");
        try {
          if (match.action === "sin-pistas" && match.tracks.length) {
            // Otra pasada o una persona pudo llenarlo entretanto.
            const { rows: existing } = await context.client.query("SELECT 1 FROM public.tracks WHERE album_id=$1 LIMIT 1", [match.albumId]);
            if (!existing.length) {
              const positions = new Set<number>();
              for (const track of match.tracks) {
                if (positions.has(track.position)) continue;
                positions.add(track.position);
                await createEntity(context, "track", {
                  title: track.title.slice(0, 250), disc_number: 1, track_number: track.position,
                  ...(track.durationSeconds ? { duration_seconds: track.durationSeconds } : {}),
                }, { albumId: match.albumId, allowSimilar: true });
              }
              report.tracklists.push({ artistId: row.artistId, artist: row.name, albumId: match.albumId, album: match.title, tracks: positions.size, url: match.url });
            }
          }
          for (const duration of match.durations) {
            const { rows: live } = await context.client.query<{ duration_seconds: number | null }>("SELECT duration_seconds FROM public.tracks WHERE id=$1", [duration.trackId]);
            if (live[0] && live[0].duration_seconds === null) {
              await updateEntity(context, "track", duration.trackId, { duration_seconds: duration.durationSeconds });
              report.durations.push({ albumId: match.albumId, album: match.title, trackId: duration.trackId, title: duration.title, seconds: duration.durationSeconds });
            }
          }
          await context.client.query("RELEASE SAVEPOINT disco");
        } catch (error) {
          await context.client.query("ROLLBACK TO SAVEPOINT disco");
          report.review.failed.push({ albumId: match.albumId, album: match.title, error: (error as Error).message.slice(0, 300) });
        }
      }
    }
  }, { rollbackOnly: !CONFIRM });
  if (CONFIRM) report.run = runId;
  writeFileSync(REPORT, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ confirm: CONFIRM, run: report.run, listas: report.tracklists.length, pistas: report.tracklists.reduce((sum, item) => sum + item.tracks, 0),
    duraciones: report.durations.length, revision: Object.fromEntries(Object.entries(report.review).map(([key, list]) => [key, list.length])) }, null, 2));
  console.log(`informe: ${REPORT}`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => closeDb());
