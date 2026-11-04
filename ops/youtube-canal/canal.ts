import { execFileSync } from "node:child_process";
// CRV · Videos del canal, solos (Brian, 2026-10-13). Punto de entrada de los
// temporizadores de ops/youtube-canal/systemd:
//
//   scripts/with-node22.sh npx tsx ops/youtube-canal/canal.ts watch [--dry-run] [--video=<id>[,<id>]]
//   scripts/with-node22.sh npx tsx ops/youtube-canal/canal.ts availability [--dry-run]
//   scripts/with-node22.sh npx tsx ops/youtube-canal/canal.ts intake [--dry-run] [--video=<db id>] [--limit=N]
//   scripts/with-node22.sh npx tsx ops/youtube-canal/canal.ts complete [--dry-run] [--video=<id>[,<id>]]
//
// Un video nuevo visto por la portada lanza watch → intake → radio en el acto
// (src/youtube/new-video-trigger.ts → ops/youtube-canal/nuevo.sh).
//
// `watch` (cada hora) enlaza, renombra o crea el disco de cada video nuevo;
// `availability` (cada día) marca los videos caídos y promueve otro si lo hay.
import { closeDb, getPool } from "../../src/db/client.js";
import { checkChannelAvailability, watchChannelUploads } from "../../src/youtube/channel-watch.js";
import { autoApproveReadyIntakes, runIntakeSweep, runVideoIntake } from "../../src/youtube/intake.js";
import { completeChannelAlbums } from "../../src/youtube/album-completion.js";
import { completeThumbnailCovers } from "../../src/youtube/thumbnail-cover.js";

/** Tipo y géneros (fuentes → IA → herencia), portada y sello (miniatura) de los discos del canal. */
async function complete(videoIds: string[] | undefined, dryRun: boolean): Promise<boolean> {
  const outcomes = await completeChannelAlbums({ dryRun, ...(videoIds ? { videoIds } : {}) });
  console.log(`youtube complete${dryRun ? " --dry-run" : ""}: ${outcomes.length} discos por completar`);
  for (const item of outcomes) {
    const type = !item.type ? "" : "skipped" in item.type ? ` · tipo sin cambio (${item.type.skipped})` : ` · tipo ${item.type.from} → ${item.type.to} (${item.type.via})`;
    const genres = !item.genres ? "" : "skipped" in item.genres ? ` · géneros: ${item.genres.skipped}` : ` · géneros [${item.genres.basis}]: ${item.genres.detail}`;
    console.log(`  disco ${item.albumId} «${item.title}» (${item.videoId})${type}${genres}${item.error ? ` · ERROR: ${item.error}` : ""}${item.runIds.length ? ` [runs ${item.runIds.join(", ")}]` : ""}`);
  }
  // Portada y sello desde la miniatura (plantilla del canal).
  const covers = await completeThumbnailCovers({ dryRun, ...(videoIds ? { videoIds } : {}) });
  console.log(`youtube miniaturas${dryRun ? " --dry-run" : ""}: ${covers.length} discos mirados`);
  for (const item of covers) {
    console.log(`  disco ${item.albumId} «${item.title}» (${item.videoId}) · portada: ${item.cover}${item.label ? ` · sello: ${item.label}` : ""}${item.error ? ` · ERROR: ${item.error}` : ""}${item.runId ? ` [run ${item.runId}]` : ""}`);
  }
  return outcomes.some((item) => item.error) || covers.some((item) => item.error);
}

const [command, ...args] = process.argv.slice(2);
const dryRun = args.includes("--dry-run");

async function main(): Promise<number> {
  if (command === "watch") {
    const only = args.find((arg) => arg.startsWith("--video="))?.slice("--video=".length);
    const result = await watchChannelUploads({ dryRun, ...(only ? { videoIds: only.split(",") } : {}) });
    console.log(`youtube watch${dryRun ? " --dry-run" : ""}: ${result.checked} videos mirados, ${result.newVideos} nuevos, ${result.outcomes.length} evaluados`);
    for (const item of result.outcomes) {
      const decision = item.decision;
      const what = decision.action === "link"
        ? `enlazado al disco ${decision.albumId} (${decision.via}, ${decision.primary ? "principal" : "secundario"})`
          + (decision.rename ? `, renombrado «${item.renamedFrom ?? "?"}» → «${decision.rename}»` : "") + (decision.fillYear ? `, año ${decision.fillYear}` : "")
        : decision.action === "create" ? `disco nuevo «${decision.title}» (${decision.albumType}${decision.year ? `, ${decision.year}` : ""})${item.albumId ? ` id ${item.albumId}` : ""}`
        : decision.action === "review" ? `a la cola: ${decision.reason}${item.reviewOpened === false ? " (ya estaba)" : ""}`
        : decision.action === "audiovisual" ? `audiovisual: ${decision.reason}`
        : `ignorado: ${decision.reason}`;
      const tracks = item.tracks ? `; pistas: ${item.tracks.created} creadas, ${item.tracks.startsSet} inicios, ${item.tracks.durationsSet} duraciones${item.tracks.unmatched.length ? `, sin casar: ${item.tracks.unmatched.join(" · ")}` : ""}` : "";
      console.log(`  ${item.videoId}  ${item.title}\n      ${item.error ? `ERROR: ${item.error}` : what}${tracks}${item.runId ? ` [run ${item.runId}]` : ""}`);
    }
    if (result.credits) {
      console.log(`  créditos del canal: ${result.credits.added} agregados, ${result.credits.retyped} retipados, ${result.credits.retired} retirados (runs ${result.credits.runs.join(", ") || "-"})`);
      for (const line of result.credits.reviews) console.log(`    revisar ${line}`);
    }
    if (result.reconcileRunId) console.log(`  reconciliación video↔pista: run ${result.reconcileRunId}`);
    if (dryRun) console.log("  (dry-run: nada se escribió; créditos y reconciliación solo corren al aplicar)");
    return result.outcomes.some((item) => item.error) ? 1 : 0;
  }
  if (command === "intake") {
    // Alta asistida por IA de los videos que el vigilante dejó en revisión:
    // resuelve el artista, crea la ficha si hace falta y prepara la propuesta
    // del disco con la evidencia del propio video.
    const only = args.find((arg) => arg.startsWith("--video="))?.slice("--video=".length);
    const limitArg = args.find((arg) => arg.startsWith("--limit="))?.slice("--limit=".length);
    if (only) {
      for (const raw of only.split(",")) {
        const result = await runVideoIntake(Number(raw), { dryRun });
        console.log(`  ${result.videoId || raw}: ${result.status}${result.artistId ? ` · artista ${result.artistId}${result.artistCreated ? " (creado)" : ""}` : ""}${result.planId ? ` · propuesta ${result.planId}` : ""}${result.reason ? ` · ${result.reason}` : ""}`);
      }
      return 0;
    }
    const sweep = await runIntakeSweep({ dryRun, ...(limitArg ? { limit: Number(limitArg) } : {}) });
    console.log(`youtube intake${dryRun ? " --dry-run" : ""}: ${sweep.started} propuestas preparadas de ${sweep.results.length} videos`);
    for (const result of sweep.results) {
      console.log(`  ${result.videoId || result.videoDbId}: ${result.status}${result.artistId ? ` · artista ${result.artistId}${result.artistCreated ? " (creado)" : ""}` : ""}${result.planId ? ` · propuesta ${result.planId}` : ""}${result.reason ? ` · ${result.reason}` : ""}`);
    }
    if (!dryRun) {
      const auto = sweep.auto.plans ? sweep.auto : await autoApproveReadyIntakes();
      console.log(`  altas seguras: ${auto.accepted} cambios aceptados en ${auto.plans} propuestas, ${auto.skipped} cambios a revisión humana${auto.linked ? `, ${auto.linked} videos enlazados` : ""}`);
    }
    // El timer horario completa también tipo y géneros de lo que haya quedado sin ellos.
    const failed = await complete(undefined, dryRun);
    if (!dryRun) execFileSync("systemctl", ["--user", "start", "crv-radio-catalogo.service"], { stdio: "inherit" });
    return sweep.results.some((result) => result.status === "failed") || failed ? 1 : 0;
  }
  if (command === "complete") {
    const only = args.find((arg) => arg.startsWith("--video="))?.slice("--video=".length);
    return await complete(only ? only.split(",") : undefined, dryRun) ? 1 : 0;
  }
  if (command === "availability") {
    const result = await checkChannelAvailability({ dryRun });
    console.log(`youtube availability${dryRun ? " --dry-run" : ""}: ${result.checked} videos, ${result.changes.length} cambios de estado, ${result.batchesFailed} lotes sin respuesta${result.runId ? ` [run ${result.runId}]` : ""}`);
    for (const change of result.changes) console.log(`  ${change.videoId}: ${change.from} → ${change.to}`);
    for (const album of result.albums) {
      console.log(`  disco ${album.albumId} «${album.title}»: ${album.action === "promoted" ? `nuevo video principal ${album.videoId}` : `youtube_status → ${album.status}`}`);
    }
    console.log(`  ${result.refreshed} respuestas de YouTube guardadas, ${result.notices.length} avisos nuevos, ${result.noticesClosed} avisos cerrados`);
    for (const notice of result.notices) {
      console.log(`  aviso ${notice.videoId}: ${notice.label}${notice.albums.length ? ` — ${notice.albums.map((album) => `«${album.title}» (${album.id})`).join(", ")}` : ""}`);
    }
    if (!dryRun) execFileSync("systemctl", ["--user", "start", "crv-radio-catalogo.service"], { stdio: "inherit" });
    return result.batchesFailed > 0 ? 1 : 0;
  }
  console.error("uso: canal.ts watch|availability|intake|complete [--dry-run] [--video=<id>] [--limit=N]");
  return 2;
}

// watch, intake y complete escriben el mismo catálogo: el disparador del video nuevo
// (nuevo.sh) y los timers horarios se turnan con un cerrojo de PostgreSQL.
const CANAL_LOCK = "crv:youtube-canal";
const lock = command === "watch" || command === "intake" || command === "complete" ? await getPool().connect() : null;
try {
  if (lock && !dryRun) await lock.query("SELECT pg_advisory_lock(hashtext($1))", [CANAL_LOCK]);
  process.exitCode = await main();
} finally {
  if (lock) {
    if (!dryRun) await lock.query("SELECT pg_advisory_unlock(hashtext($1))", [CANAL_LOCK]).catch(() => undefined);
    lock.release();
  }
  await closeDb();
}
