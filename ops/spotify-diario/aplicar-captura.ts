// CRV · Plantilla re-ejecutable para completar la ficha de un artista del core
// desde una captura de Spotify (skill `spotify-artist-extract`): foto,
// discografía, pistas, duraciones, portadas y fechas. Copia versionada de
// tmp-analysis/spotify-lote-2026-10-03/apply.ts (2026-10-14) con `--solo-foto`: para
// extranjeros con vínculo venezolano entra la foto y no su discografía (pertinencia). Un solo run reversible
// (`crv runs undo <run>`); dry-run por defecto, escribe solo con --confirm.
//
// Copiar a tmp-analysis/spotify-<slug>-<fecha>/apply.ts y correr:
//   ./scripts/with-node22.sh npx tsx tmp-analysis/spotify-<slug>-<fecha>/apply.ts \
//     --capture=data/raw/spotify-<slug>-<fecha> --artist-id=<id en el core>            # dry-run
//     ... --confirm                                                                   # aplica
// Después: `npm run media:localize` baja foto y portadas a web/public/media y
// reescribe los campos a /crv/media/… (el claim remoto queda superseded, normal).
//
// Foto en conflicto (la ficha ya tiene picture_url): NO se pisa automáticamente.
// La foto de Spotify entra como candidata en `ingest.image_candidates` y se
// resuelve en Curaduría → Imágenes (/curaduria/imagenes). Regla del catálogo
// (Brian, 2026-10-04).
//
// Mismo camino que la etapa 3 del nuevo lote 2026-10-02: persistClaim +
// mergeClaim con evidencia de plataforma y decisión humana «different» (la
// duplicidad ya se comprobó contra el core dentro de la transacción). Probada
// 2026-10-03 con José Coraspe (run 11589): 4 discos + 17 pistas, 0 errores.
import { config as loadDotenv } from "dotenv";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import type { PoolClient } from "pg";
import { persistClaim, type ClaimToPersist } from "../../src/claims/persistence.js";
import { mergeClaim } from "../../src/merge/engine.js";
import { getPool, closeDb } from "../../src/db/client.js";
import { titleKey, variantOf, type CoreAlbum } from "../../scripts/lote-etapa3-comun.js";

loadDotenv();

function arg(name: string): string | undefined {
  const position = process.argv.indexOf(name);
  if (position >= 0 && process.argv[position + 1] !== undefined) return process.argv[position + 1];
  const inline = process.argv.find((value) => value.startsWith(`${name}=`));
  return inline?.slice(name.length + 1);
}

const CAPTURE = arg("--capture");
const ARTIST_ID = Number(arg("--artist-id"));
if (!CAPTURE || !Number.isInteger(ARTIST_ID) || ARTIST_ID <= 0) {
  console.error("uso: apply.ts --capture=data/raw/spotify-<slug>-<fecha> --artist-id=<id core> [--confirm] [--out-dir=reports/...]");
  process.exit(2);
}
const OUT_DIR = arg("--out-dir") ?? path.join("reports", path.basename(CAPTURE));
const OPERATOR = arg("--operator") ?? "hermes (encargo dirigido de Brian)";
const CONFIRM = process.argv.includes("--confirm");
const SOLO_FOTO = process.argv.includes("--solo-foto");

interface Context { client: PoolClient; runId: number; sourceId: number }
interface AlbumJson {
  id: string; name: string; album_type: string; release_date: string; total_tracks: number;
  images: Array<{ width: number; url: string }>;
}
interface TrackJson {
  name: string; track_number: number; disc_number: number; duration_ms: number;
}

const artistJson = JSON.parse(readFileSync(`${CAPTURE}/artist.json`, "utf8")) as { id: string; name: string; images: Array<{ url: string; width?: number }> };
const albumsJson = JSON.parse(readFileSync(`${CAPTURE}/albums.json`, "utf8")) as AlbumJson[];
const ARTIST_NAME = artistJson.name;
const SPOTIFY_ARTIST = artistJson.id;
const NOTE = `Ficha de ${ARTIST_NAME} desde Spotify (API oficial): foto, discografía, pistas, duraciones y portadas. Captura: ${CAPTURE}.`;

const report = {
  mode: CONFIRM ? "confirm" : "dry-run", runId: 0, operator: OPERATOR, capture: CAPTURE,
  artist: { id: ARTIST_ID, name: ARTIST_NAME, spotifyId: SPOTIFY_ARTIST, photo: artistJson.images[0]?.url ?? null },
  created: [] as Array<{ albumId: number; title: string; year: number; type: string; date: string; tracks: number; cover: string }>,
  skipped: [] as Array<{ title: string; why: string }>,
  fields: [] as Array<{ albumId: number | null; field: string; value: string }>,
  candidates: [] as Array<{ artistId: number; url: string; reemplaza: string }>,
  errors: [] as Array<{ title: string; error: string }>,
};

let sequence = 0;
function baseClaim(context: Context, input: {
  entityKind: "album" | "track" | "artist"; identity: string; originalIdentity: string;
  field: string; value: unknown; normalized?: unknown; url: string; excerpt: string; extra?: Partial<ClaimToPersist>;
}): ClaimToPersist {
  sequence += 1;
  return {
    entityKind: input.entityKind,
    identity: input.identity, identitySecondary: input.identity, originalIdentity: input.originalIdentity,
    field: input.field, rawValue: input.value, normalizedValue: input.normalized ?? input.value,
    rawHash: createHash("sha256").update(JSON.stringify([input.identity, input.field, input.value])).digest("hex"),
    extractor: "spotify-api", extractorVersion: "1",
    evidence: { url: input.url, excerpt: input.excerpt.slice(0, 1000) },
    sourceId: context.sourceId, runId: context.runId, confidence: "medium", createdBy: "human",
    ...input.extra,
  } as ClaimToPersist;
}

function albumType(spotifyType: string): string {
  if (spotifyType === "album") return "studio_album";
  if (spotifyType === "single") return "single";
  if (spotifyType === "compilation") return "compilation";
  if (spotifyType === "ep") return "ep";
  return "other";
}
const yearOf = (date: string) => Number(date.slice(0, 4));
const fmtDuration = (ms: number) => `${String(Math.floor(ms / 60000)).padStart(2, "0")}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, "0")}`;

async function createAlbum(context: Context, album: AlbumJson): Promise<number> {
  const url = `https://open.spotify.com/album/${album.id}`;
  const excerpt = `${ARTIST_NAME} — ${album.name} (${album.release_date}, ${album.album_type}, ${album.total_tracks} pistas); Spotify (API oficial)`;
  const claim = baseClaim(context, {
    entityKind: "album", identity: `spotify:album:${album.id}`, originalIdentity: `${ARTIST_NAME} — ${album.name}`,
    field: "title", value: album.name, url, excerpt, extra: { parentArtistId: ARTIST_ID },
  });
  const persisted = await persistClaim(claim, context.client);
  const outcome = await mergeClaim(claim, persisted, {
    client: context.client,
    humanResolution: { verdict: "different", decidedBy: OPERATOR, reference: `captura de Spotify (${CAPTURE}): el título no estaba en la ficha del artista ${ARTIST_ID}` },
  });
  if (!outcome.created || outcome.entityId === undefined) {
    throw new Error(`no se creó «${album.name}»: ${outcome.action} ${outcome.detail ?? ""}`);
  }
  return outcome.entityId;
}

async function field(context: Context, albumId: number, album: AlbumJson, name: string, value: unknown, excerpt: string): Promise<void> {
  const claim = baseClaim(context, {
    entityKind: "album", identity: `spotify:album:${album.id}`, originalIdentity: `${ARTIST_NAME} — ${album.name}`,
    field: name, value, url: `https://open.spotify.com/album/${album.id}`, excerpt, extra: { albumId },
  });
  const persisted = await persistClaim(claim, context.client);
  await mergeClaim(claim, persisted, { client: context.client });
  report.fields.push({ albumId, field: name, value: String(value) });
}

async function createTrack(context: Context, albumId: number, album: AlbumJson, track: TrackJson): Promise<void> {
  const url = `https://open.spotify.com/album/${album.id}`;
  const excerpt = `${ARTIST_NAME} — ${album.name}, pista ${track.disc_number}-${track.track_number}: ${track.name} (${fmtDuration(track.duration_ms)}); Spotify (API oficial)`;
  const identity = `spotify:album:${album.id}:track:${track.disc_number}:${track.track_number}`;
  const claim = baseClaim(context, {
    entityKind: "track", identity, originalIdentity: `${ARTIST_NAME} — ${album.name} / ${track.name}`,
    field: "title", value: track.name, url, excerpt,
    extra: { parentAlbumId: albumId, discNumber: track.disc_number, trackNumber: track.track_number },
  });
  const persisted = await persistClaim(claim, context.client);
  const outcome = await mergeClaim(claim, persisted, {
    client: context.client,
    humanResolution: { verdict: "different", decidedBy: OPERATOR, reference: `captura de Spotify (${CAPTURE}): pista del disco recién creado` },
  });
  if (!outcome.created || outcome.entityId === undefined) {
    throw new Error(`no se creó la pista «${track.name}»: ${outcome.action} ${outcome.detail ?? ""}`);
  }
  const durClaim = baseClaim(context, {
    entityKind: "track", identity, originalIdentity: `${ARTIST_NAME} — ${album.name} / ${track.name}`,
    field: "duration_seconds", value: fmtDuration(track.duration_ms), normalized: Math.round(track.duration_ms / 1000),
    url, excerpt, extra: { trackId: outcome.entityId },
  });
  const durPersisted = await persistClaim(durClaim, context.client);
  await mergeClaim(durClaim, durPersisted, { client: context.client });
}

async function main(): Promise<void> {
  const ordered = [...albumsJson].sort((a, b) => a.release_date.localeCompare(b.release_date));
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext('merge:duplicates'))");
    await client.query(
      `INSERT INTO ingest.sources(slug,name,site_type,trust_level,enabled,notes) VALUES('spotify','Spotify (API oficial)','database','medium',false,$1)
       ON CONFLICT (slug) DO NOTHING`,
      [`Ficha y discografía desde la API oficial (client credentials). Captura: ${CAPTURE}.`],
    );
    const sourceId = Number((await client.query<{ id: string }>("SELECT id::text FROM ingest.sources WHERE slug='spotify'")).rows[0]!.id);
    const run = await client.query<{ id: string }>(
      "INSERT INTO ingest.scrape_runs(kind,source_id,status,params) VALUES('manual',$1,'running',$2::jsonb) RETURNING id::text",
      [sourceId, JSON.stringify({ action: `spotify:${ARTIST_NAME}`, operator: OPERATOR, note: NOTE, confirm: CONFIRM, capture: CAPTURE })]);

    const context: Context = { client, runId: Number(run.rows[0]!.id), sourceId };
    report.runId = context.runId;

    // El core actual del artista: contra esto se comprueba que nada se duplique.
    const core: CoreAlbum[] = (await client.query<{ id: string; title: string; year: number | null; type: string }>(
      "SELECT id::text, title, release_year AS year, album_type::text AS type FROM public.albums WHERE artist_id=$1", [ARTIST_ID]))
      .rows.map((row) => ({ id: Number(row.id), title: row.title, year: row.year, type: row.type }));
    const coreKeys = new Map(core.map((album) => [titleKey(album.title), album]));

    // Foto del artista → picture_url (remota; el localizador la baja a disco después).
    const photo = artistJson.images[0];
    const currentPhoto = (await client.query<{ value: string | null }>(
      "SELECT picture_url AS value FROM public.artists WHERE id=$1", [ARTIST_ID])).rows[0]?.value ?? null;
    if (photo && !currentPhoto) {
      const photoClaim = baseClaim(context, {
        entityKind: "artist", identity: `spotify:artist:${SPOTIFY_ARTIST}`, originalIdentity: ARTIST_NAME,
        field: "picture_url", value: photo.url,
        url: `https://open.spotify.com/artist/${SPOTIFY_ARTIST}`,
        excerpt: `Foto oficial de ${ARTIST_NAME} en Spotify (${photo.width ?? "?"}px); Spotify (API oficial)`,
        extra: { artistId: ARTIST_ID },
      });
      const photoPersisted = await persistClaim(photoClaim, client);
      await mergeClaim(photoClaim, photoPersisted, { client });
    } else if (currentPhoto) {
      // Conflicto de foto: la ficha ya tiene imagen — no se pisa sola. La foto de Spotify
      // entra como candidata y se decide en Curaduría → Imágenes (/curaduria/imagenes),
      // viendo la actual contra las candidatas (regla del catálogo, Brian 2026-10-04).
      const propuesta = await client.query(
        `INSERT INTO ingest.image_candidates(entity_kind, artist_id, current_url, candidate_url, source, page_url, origin, run_id)
         VALUES ('artist', $1, $2, $3, 'spotify', $4, $5, $6)
         ON CONFLICT DO NOTHING`,
        [ARTIST_ID, currentPhoto, photo.url, `https://open.spotify.com/artist/${SPOTIFY_ARTIST}`, path.basename(CAPTURE), context.runId]);
      report.skipped.push({ title: `foto de ${ARTIST_NAME}`, why: `picture_url ya presente (${currentPhoto.slice(0, 60)}) — propuesta como candidata de curaduría` });
      if (propuesta.rowCount) report.candidates.push({ artistId: ARTIST_ID, url: photo.url, reemplaza: currentPhoto.slice(0, 80) });
    }

    for (const album of SOLO_FOTO ? [] : ordered) {
      const key = titleKey(album.name);
      if (coreKeys.has(key)) {
        report.skipped.push({ title: album.name, why: `ya en catálogo (id ${coreKeys.get(key)!.id})` });
        continue;
      }
      const variant = variantOf(key, core);
      if (variant) {
        report.skipped.push({ title: album.name, why: `variante probable de «${variant.title}» (id ${variant.id})` });
        continue;
      }
      await client.query("SAVEPOINT disco");
      try {
        const albumId = await createAlbum(context, album);
        await field(context, albumId, album, "release_year", yearOf(album.release_date), `Año de lanzamiento en Spotify: ${album.release_date}; Spotify (API oficial)`);
        await field(context, albumId, album, "album_type", albumType(album.album_type), `Tipo de lanzamiento en Spotify: ${album.album_type}; Spotify (API oficial)`);
        await field(context, albumId, album, "release_date_text", album.release_date, `Fecha exacta de lanzamiento en Spotify; Spotify (API oficial)`);
        await field(context, albumId, album, "cover_url", album.images[0]!.url, `Portada oficial en Spotify (${album.images[0]!.width ?? "?"}px); Spotify (API oficial)`);
        const tracks = JSON.parse(readFileSync(`${CAPTURE}/tracks-${album.id}.json`, "utf8")) as TrackJson[];
        let createdTracks = 0;
        for (const track of tracks) {
          await client.query("SAVEPOINT pista");
          try {
            await createTrack(context, albumId, album, track);
            createdTracks += 1;
            await client.query("RELEASE SAVEPOINT pista");
          } catch (error) {
            await client.query("ROLLBACK TO SAVEPOINT pista");
            report.errors.push({ title: `${album.name} / ${track.name}`, error: (error as Error).message });
          }
        }
        await client.query("RELEASE SAVEPOINT disco");
        core.push({ id: albumId, title: album.name, year: yearOf(album.release_date), type: albumType(album.album_type) });
        coreKeys.set(key, core[core.length - 1]!);
        report.created.push({
          albumId, title: album.name, year: yearOf(album.release_date), type: albumType(album.album_type),
          date: album.release_date, tracks: createdTracks, cover: album.images[0]!.url,
        });
      } catch (error) {
        await client.query("ROLLBACK TO SAVEPOINT disco");
        report.errors.push({ title: album.name, error: (error as Error).message });
      }
      console.log(`disco: ${album.name} → ${JSON.stringify(report.created.find((row) => row.title === album.name) ?? report.skipped.at(-1) ?? report.errors.at(-1))}`);
    }

    await client.query("UPDATE ingest.scrape_runs SET status='ok', finished_at=now(), counters=$2::jsonb WHERE id=$1",
      [context.runId, JSON.stringify({ created: report.created.length, skipped: report.skipped.length, errors: report.errors.length })]);
    await client.query(CONFIRM ? "COMMIT" : "ROLLBACK");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  writeReport();
}

function writeReport(): void {
  mkdirSync(OUT_DIR, { recursive: true });
  const base = `${OUT_DIR}/apply-${CONFIRM ? "confirm" : "dry-run"}-run${report.runId}`;
  writeFileSync(`${base}.json`, `${JSON.stringify(report, null, 1)}\n`);
  const lines = [
    `# ${ARTIST_NAME} (${ARTIST_ID}) — ficha desde Spotify (${report.mode}, run ${report.runId})`, "",
    `Captura: \`${CAPTURE}\`.`, "",
    "## Discos creados", "",
    ...report.created.map((row) => `- ${row.title} (id ${row.albumId}) — ${row.year}, ${row.type}, ${row.tracks} pistas, ${row.date}`),
    "", "## Omitidos (ya en catálogo, variantes o foto presente)", "",
    ...report.skipped.map((row) => `- ${row.title}: ${row.why}`),
    "", "## Candidatas de foto → Curaduría · Imágenes (/curaduria/imagenes)", "",
    ...(report.candidates.length
      ? report.candidates.map((row) => `- artista ${row.artistId}: candidata ${row.url} (reemplaza la actual ${row.reemplaza})`)
      : ["- (ninguna)"]),
    "", "## Campos escritos", "",
    ...report.fields.map((row) => `- album ${row.albumId}: ${row.field} = ${row.value}`),
    "", "## Errores", "",
    ...report.errors.map((row) => `- ${row.title}: ${row.error}`),
    "",
  ];
  writeFileSync(`${base}.md`, `${lines.join("\n")}\n`);
  console.log(`→ ${base}.md`);
}

main().finally(() => closeDb()).catch((error) => { console.error(error); process.exitCode = 1; });
