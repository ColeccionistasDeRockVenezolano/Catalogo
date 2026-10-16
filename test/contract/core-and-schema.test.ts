// CRV · Test de contrato: puerto a Vitest de tests/run_all.sh (ARCH §7,
// PHASES F0). Contra un PostgreSQL 16 desechable, en un solo run:
//   1. el core (crv_simple_v1.sql) se aplica verbatim y el hash coincide;
//   2. las migraciones 0001-0021 se aplican vía el runner TS
//      (src/db/migrate.ts), 2 veces (idempotencia), y toda FK de
//      ingest/media queda respaldada por un índice;
//   3. el diff de `pg_dump --schema=public --schema-only` antes/después de
//      migrar es VACÍO — el core no fue tocado;
//   4. el schema Drizzle (src/db/schema) funciona de verdad: insertar y
//      leer a través de core+ingest+media con FKs y enums reales;
//   5. el rollback completo (down) deja el diff de `public` vacío también.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";
import { startPgContainer, type PgContainer } from "../support/pg-container.js";
import { applyCore } from "../support/apply-core.js";
import { resetEnvCache } from "../../src/config/env.js";
import { closeDb, getDb, getPool } from "../../src/db/client.js";
import { migrateUp, migrateDownAll } from "../../src/db/migrate.js";
import * as schema from "../../src/db/schema/index.js";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "..");

function useDatabaseUrl(url: string): void {
  process.env["DATABASE_URL"] = url;
  resetEnvCache();
}

async function pgDumpPublic(containerName: string): Promise<string> {
  const { stdout } = await execFileAsync("docker", [
    "exec", containerName, "pg_dump", "-U", "postgres", "-d", "postgres",
    "--schema=public", "--schema-only",
  ]);
  // \restrict/\unrestrict llevan una clave aleatoria por dump (no son
  // objetos de base de datos): se excluyen del diff, igual que en
  // tests/run_all.sh.
  // Los disparadores `crv_journal` del diario de cambios (0028) son la primera
  // excepción aprobada al core: solo registran, no cambian columnas ni datos.
  return stdout
    .split("\n")
    .filter((line) => !/^\\(un)?restrict/.test(line))
    .join("\n")
    .replace(/--\n-- Name: \S+ crv_journal; Type: TRIGGER;[^\n]*\n--\n\nCREATE TRIGGER crv_journal [^\n]*\n\n\n/gu, "")
    // La quinta (0036): el disparador que anota al artista cuando un disco se
    // borra o cambia de artista (géneros que el artista recibe de sus discos).
    .replace(/--\n-- Name: \S+ crv_artist_genres_from_albums; Type: TRIGGER;[^\n]*\n--\n\nCREATE TRIGGER crv_artist_genres_from_albums [^\n]*\n\n\n/gu, "")
    .replace(/--\n-- Name: persons crv_person_date_precision; Type: TRIGGER;[^\n]*\n--\n\nCREATE TRIGGER crv_person_date_precision [^\n]*\n\n\n/gu, "")
    .replace(/--\n-- Name: \S+ crv_catalog_model_parent_check; Type: TRIGGER;[^\n]*\n--\n\nCREATE CONSTRAINT TRIGGER crv_catalog_model_parent_check [^\n]*\n\n\n/gu, "")
    // La segunda excepción (0029): `persons.is_venezuelan` admite NULL (sin dato).
    .replace(/^ {4}is_venezuelan boolean,$/mu, "    is_venezuelan boolean DEFAULT false NOT NULL,")
    // La tercera excepción (0032): la columna añadida `persons.is_deceased boolean`.
    .replace(/^ {4}is_deceased boolean,\n/mu, "")
    // La cuarta excepción (0033): campos de la captura MA en artists/persons/albums.
    // (la coma final es opcional: la última columna de una tabla no la lleva,
    //  salvo que le sigan CONSTRAINTs como en artists/persons).
    // La novena (0073): `tracks.lyrics` (letra de la canción, campaña musicavenezuela).
    .replace(/^ {4}(birth_date_value|death_date_value|status|themes|years_active|logo_url|real_name|birth_city|death_cause|trivia|gender|release_date_text|catalog_id|media_format|lyrics) (?:character varying\(\d+\)|text),?\n/gmu, "")
    // …y si las columnas quitadas eran las últimas (albums), la columna previa
    // queda con una coma colgando antes de `);`: se normaliza igual en ambos dumps.
    .replace(/,(\n\);)/gu, "$1")
    // La sexta, la séptima, la octava y la décima excepción (0039, 0040, 0063,
    // 0081): las tablas `public.streaming_links`, `public.social_links`,
    // `public.album_discs`, `public.album_disc_links` y las cuatro de datos
    // sociales (`entity_metrics`, `entity_user_tags`, `entity_shouts`,
    // `entity_emotions`). Se descartan sus bloques completos (CREATE
    // TABLE, constraints e índices; su disparador del diario ya lo quita el
    // filtro genérico de arriba) para que «antes» y «después» de migrar sigan
    // coincidiendo.
    .split("--\n-- Name: ")
    .filter((bloque, i) => i === 0 || !/^((streaming|social)_links|album_disc(s|_links)|entity_(metrics|user_tags|shouts|emotions))/u.test(bloque))
    .join("--\n-- Name: ");
}

describe("contrato del core + migraciones (Drizzle/TS)", () => {
  let container: PgContainer;

  beforeAll(async () => {
    container = await startPgContainer();
    useDatabaseUrl(container.databaseUrl);
  }, 120_000);

  afterAll(async () => {
    await closeDb();
    await container?.stop();
  }, 60_000);

  it("crv_simple_v1.sql coincide con crv_simple_v1.sql.sha256", async () => {
    const [sql, hashFile] = await Promise.all([
      readFile(path.join(ROOT, "crv_simple_v1.sql"), "utf8"),
      readFile(path.join(ROOT, "crv_simple_v1.sql.sha256"), "utf8"),
    ]);
    const expected = hashFile.trim().split(/\s+/)[0];
    const actual = createHash("sha256").update(sql).digest("hex");
    expect(actual).toBe(expected);
  });

  it("aplica el core y toma snapshot de public", async () => {
    await applyCore(container.name);
    const snapshot = await pgDumpPublic(container.name);
    expect(snapshot).toContain("CREATE TABLE public.artists");
    (globalThis as { __crvBeforeSnapshot?: string }).__crvBeforeSnapshot = snapshot;
  });

  it("aplica todas las migraciones versionadas vía el runner TS (2 pasadas, la 2ª es no-op)", async () => {
    const first = await migrateUp();
    const files = await readdir(path.join(ROOT, "migrations"));
    const expected = files.filter(file => file.endsWith(".up.sql")).sort().map(file => file.replace(/\.up\.sql$/u, ""));
    const down = files.filter(file => file.endsWith(".down.sql")).sort().map(file => file.replace(/\.down\.sql$/u, ""));
    expect(down).toEqual(expected);
    expect(first.applied).toEqual(expected);
    expect((await getPool().query("SELECT version FROM ingest.schema_migrations ORDER BY version")).rows.map(row => row.version)).toEqual(expected);
    const second = await migrateUp();
    expect(second.applied).toEqual([]);
  });

  it("diff de public vacío tras migrar: el core no fue alterado", async () => {
    const before = (globalThis as { __crvBeforeSnapshot?: string }).__crvBeforeSnapshot;
    const after = await pgDumpPublic(container.name);
    expect(after).toBe(before);
  });

  it("toda FK de ingest y media tiene un índice que empieza por sus columnas (0013)", async () => {
    // Sin él, cada DELETE del padre recorre la tabla hija entera (E11).
    const { rows } = await getPool().query<{ fk: string }>(`
      SELECT n.nspname || '.' || t.relname || '.' || c.conname AS fk
        FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace
       WHERE c.contype = 'f' AND n.nspname IN ('ingest', 'media')
         AND NOT EXISTS (
           SELECT 1 FROM pg_index i
            WHERE i.indrelid = c.conrelid AND i.indisvalid
            AND (i.indpred IS NULL OR pg_get_expr(i.indpred, i.indrelid) =
              (SELECT '(' || quote_ident(a.attname) || ' IS NOT NULL)'
                 FROM pg_attribute a WHERE a.attrelid=c.conrelid AND a.attnum=c.conkey[1]))
              -- Rebuild with the same array lower bound as conkey (1).
              -- pg_index.indkey starts at 0; comparing slices also compares bounds.
              AND ARRAY(SELECT u.attnum FROM unnest(i.indkey::int2[]) WITH ORDINALITY u(attnum,n)
                WHERE u.n<=array_length(c.conkey,1) ORDER BY u.n) = c.conkey)
       ORDER BY 1`);
    expect(rows.map((row) => row.fk)).toEqual([]);
  });

  it("el schema Drizzle inserta y lee a través de core + ingest + media", async () => {
    const db = getDb();

    const [artist] = await db.insert(schema.artists).values({
      name: "Los Caramelos de Prueba",
      artistType: "band",
    }).returning();
    expect(artist?.id).toBeTypeOf("number");

    const [album] = await db.insert(schema.albums).values({
      artistId: artist!.id,
      title: "Las Paticas",
      albumType: "studio_album",
      releaseYear: 2009,
    }).returning();
    expect(album?.id).toBeTypeOf("number");

    const [track] = await db.insert(schema.tracks).values({
      albumId: album!.id,
      trackNumber: 1,
      title: "Canción de prueba",
    }).returning();
    expect(track?.id).toBeTypeOf("number");

    const [source] = await db.insert(schema.sources).values({
      slug: "test-source",
      name: "Fuente de prueba",
      siteType: "website",
      trustLevel: "medium",
    }).returning();
    expect(source?.id).toBeTypeOf("number");

    const [video] = await db.insert(schema.youtubeVideos).values({
      videoId: "dQw4w9WgXcQ",
      title: "Video de prueba",
      publicationStatus: "published",
    }).returning();
    expect(video?.id).toBeTypeOf("number");

    // video<->album N:N con enlace primario (media.video_albums, 0002/0003)
    await db.insert(schema.videoAlbums).values({
      videoId: video!.id,
      albumId: album!.id,
      albumKind: "full_album",
      isPrimaryLink: true,
      confidence: "high",
    });

    // claim sobre el álbum (ingest.claims, 0003) con evidencia
    const [claim] = await db.insert(schema.claims).values({
      sourceId: source!.id,
      entityKind: "album",
      albumId: album!.id,
      field: "release_year",
      rawValue: { value: "2009" },
      rawHash: "a".repeat(64),
      confidence: "high",
      status: "accepted",
    }).returning();
    expect(claim?.id).toBeTypeOf("number");

    await db.insert(schema.claimEvidence).values({
      claimId: claim!.id,
      url: "https://example.test/paticas",
      excerpt: "Las Paticas (2009)",
      evidenceHash: "b".repeat(64),
    });

    // review_queue con uno de los 8 kinds de 0004 (missing_url)
    const [review] = await db.insert(schema.reviewQueue).values({
      kind: "missing_url",
      claimAId: claim!.id,
    }).returning();
    expect(review?.kind).toBe("missing_url");

    // Join real a través de las tres tablas: album -> track -> video (media.video_tracks)
    await db.insert(schema.videoTracks).values({
      videoId: video!.id,
      trackId: track!.id,
      startSeconds: 0,
      confidence: "medium",
    });

    const joined = await db
      .select({ artistName: schema.artists.name, albumTitle: schema.albums.title, videoTitle: schema.youtubeVideos.title })
      .from(schema.videoAlbums)
      .innerJoin(schema.albums, eq(schema.albums.id, schema.videoAlbums.albumId))
      .innerJoin(schema.artists, eq(schema.artists.id, schema.albums.artistId))
      .innerJoin(schema.youtubeVideos, eq(schema.youtubeVideos.id, schema.videoAlbums.videoId))
      .where(eq(schema.videoAlbums.albumId, album!.id));

    expect(joined).toEqual([
      { artistName: "Los Caramelos de Prueba", albumTitle: "Las Paticas", videoTitle: "Video de prueba" },
    ]);
  });

  it("un kind de 0004 (missing_url) es rechazado tras el rollback completo, y el diff de public sigue vacío", async () => {
    // Limpia las filas de prueba para no bloquear el down (mismo motivo que
    // tests/test_0004_review_kinds.sh §4/§5: el down aborta si hay filas
    // usando kinds de 0004).
    const pool = getPool();
    await pool.query("DELETE FROM ingest.review_queue");

    const result = await migrateDownAll();
    const expected = (await readdir(path.join(ROOT, "migrations")))
      .filter(file => file.endsWith(".up.sql")).sort().reverse().map(file => file.replace(/\.up\.sql$/u, ""));
    expect(result.reverted).toEqual(expected);

    const { rows } = await pool.query<{ nspname: string }>(
      "SELECT nspname FROM pg_namespace WHERE nspname IN ('ingest','media')",
    );
    expect(rows).toEqual([]);

    const before = (globalThis as { __crvBeforeSnapshot?: string }).__crvBeforeSnapshot;
    const after = await pgDumpPublic(container.name);
    expect(after).toBe(before);
  });
});
