import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { serializerCompiler, validatorCompiler } from "fastify-type-provider-zod";
import { startPgContainer, type PgContainer } from "../support/pg-container.js";
import { applyCore } from "../support/apply-core.js";
import { migrateUp } from "../../src/db/migrate.js";
import { closeDb, getPool } from "../../src/db/client.js";
import { resetEnvCache } from "../../src/config/env.js";
import { registerHomeRoutes } from "../../src/api/routes/home.js";
import { bioExcerpt } from "../../src/api/repositories/home.js";
import { applyTaxonomyOperations, planTaxonomyFile } from "../../src/genres/admin.js";
import { CRV_CHANNEL_ID } from "../../src/youtube/home-channel.js";

vi.mock("../../src/youtube/home-channel.js", () => ({
  CRV_CHANNEL_ID: "UCtYlrz6GyvRahlhHjocWQYQ",
  CRV_CHANNEL_URL: "https://www.youtube.com/channel/UCtYlrz6GyvRahlhHjocWQYQ",
  latestChannelSnapshot: async () => ({ videos: [], checkedAt: null, stale: true }),
}));

describe("portada (GET /home)", () => {
  let container: PgContainer;
  let app: FastifyInstance;
  beforeAll(async () => {
    container = await startPgContainer();
    process.env["DATABASE_URL"] = container.databaseUrl;
    resetEnvCache();
    await applyCore(container.name);
    await migrateUp();
    app = Fastify();
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    await registerHomeRoutes(app);
    const pool = getPool();
    await pool.query(`INSERT INTO public.artists(name, artist_type, picture_url, biography, origin_city, formed_year) VALUES
      ('Banda Uno', 'band', '/a/1.jpg', 'Banda de Caracas. Grabó dos discos.', 'Caracas', 1975),
      ('Banda Dos', 'band', NULL, NULL, NULL, NULL),
      ('Various Artists', 'band', '/a/va.jpg', 'Recopilaciones.', NULL, NULL)`);
    await pool.query(`INSERT INTO public.organizations(name, organization_type) VALUES ('Sello Uno', 'record_label')`);
    await pool.query(`INSERT INTO public.albums(artist_id, title, release_year, album_type, cover_url, label_id)
      SELECT a.id, v.title, v.y, v.t::public.album_type, v.cover, CASE WHEN v.label THEN (SELECT id FROM public.organizations) END
        FROM (VALUES ('Banda Uno', 'Disco A', 1976, 'studio_album', '/c/a.jpg', true),
                     ('Banda Dos', 'disco a', 1976, 'studio_album', NULL, false),
                     ('Banda Dos', 'Disco B', 1976, 'single', NULL, true),
                     ('Banda Uno', 'Disco C', 1996, 'studio_album', '/c/c.jpg', false),
                     ('Various Artists', 'Recopilado', 2006, 'compilation', '/c/va.jpg', false))
             AS v(artist, title, y, t, cover, label)
        JOIN public.artists a ON a.name = v.artist`);
    await pool.query(`INSERT INTO public.tracks(album_id, track_number, title) SELECT id, 1, 'Pista' FROM public.albums WHERE title = 'Disco A'`);
    await pool.query(`INSERT INTO public.streaming_links(album_id, platform, url, method, source, verified)
      SELECT id, 'deezer', 'https://www.deezer.com/album/' || id, 'search', 'deezer_api', title = 'Disco C'
        FROM public.albums WHERE title IN ('Disco C', 'Disco B')`);
    await pool.query(`INSERT INTO media.youtube_videos(video_id, title, published_at, publication_status) VALUES
      ('aaaaaaaaaaa', 'Disco A completo', '2026-09-01', 'published'),
      ('bbbbbbbbbbb', 'Borrador', '2026-09-30', 'unknown')`);
    await pool.query("UPDATE media.youtube_videos SET channel_id = $1", [CRV_CHANNEL_ID]);
    await pool.query(`INSERT INTO media.youtube_videos(video_id, title, published_at, publication_status, channel_id)
      VALUES ('ccccccccccc', 'Video de otro canal', '2026-10-10', 'published', 'otro-canal')`);
    await pool.query(`INSERT INTO media.video_albums(video_id, album_id, is_primary_link)
      SELECT v.id, al.id, true FROM media.youtube_videos v, public.albums al
       WHERE v.video_id = 'aaaaaaaaaaa' AND al.title = 'Disco A'`);
  });
  afterAll(async () => { await app?.close(); await closeDb(); await container?.stop(); });

  it("reúne cifras, aniversarios, canal, artista del día, disco para escuchar y sellos", async () => {
    const response = await app.inject("/home?date=2026-10-11");
    expect(response.statusCode).toBe(200);
    const home = response.json();
    expect(home.date).toBe("2026-10-11");
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(home.wall.every((album: { coverUrl: string | null }) => Boolean(album.coverUrl))).toBe(true);
    expect(home.stats).toEqual({ artists: 3, albums: 5, tracks: 1, persons: 0, firstYear: 1976, lastYear: 2006 });

    // 50 años: cuenta los tres discos de 1976, pero «Disco A» repetido sale una vez y primero el de portada.
    const fifty = home.anniversaries.find((group: { years: number }) => group.years === 50);
    expect(fifty).toMatchObject({ releaseYear: 1976, total: 3 });
    expect(fifty.albums.map((album: { title: string }) => album.title)).toEqual(["Disco A", "Disco B"]);
    expect(fifty.albums[0].coverUrl).toBe("/c/a.jpg");
    expect(home.anniversaries.map((group: { years: number }) => group.years)).toEqual([50, 30, 20]);

    // Solo videos publicados; el que tiene disco lleva a su ficha.
    expect(home.videos).toHaveLength(1);
    expect(home.videos[0]).toMatchObject({ videoId: "aaaaaaaaaaa", album: { title: "Disco A" } });

    // «Various Artists» tiene foto, bio y portada, pero nunca es artista del día.
    expect(home.featuredArtist).toMatchObject({ name: "Banda Uno", startYear: 1975, albumCount: 2, originCity: "Caracas" });
    expect(home.featuredArtist.album).toMatchObject({ title: "Disco A" });

    // Solo discos con portada y enlace verificado.
    expect(home.listen.map((album: { title: string }) => album.title)).toEqual(["Disco C"]);
    expect(home.listen[0].links).toEqual([{ platform: "deezer", url: expect.stringContaining("deezer.com") }]);

    expect(home.labels).toEqual([{ id: expect.any(Number), name: "Sello Uno", pictureUrl: null, albumCount: 2, fromYear: 1976, toYear: 1976 }]);
  });

  it("es estable dentro del mismo día y rechaza fechas mal formadas", async () => {
    const first = (await app.inject("/home?date=2026-10-11")).json();
    const second = (await app.inject("/home?date=2026-10-11")).json();
    expect(second).toEqual(first);
    expect((await app.inject("/home?date=11-10-2026")).statusCode).toBe(400);
  });

  it("recorta la biografía en un final de frase", () => {
    const bio = `${"Primera frase con bastante contenido para llenar. ".repeat(4)}Segunda parte ${"muy larga ".repeat(40)}`;
    const excerpt = bioExcerpt(bio, 320);
    expect(excerpt.length).toBeLessThanOrEqual(320);
    expect(excerpt.endsWith(".")).toBe(true);
    expect(bioExcerpt("Corta.")).toBe("Corta.");
    expect(bioExcerpt("palabra ".repeat(80), 50).endsWith("…")).toBe(true);
  });

  it("cambia el artista en días consecutivos manteniendo los criterios de la sección", async () => {
    const pool = getPool();
    await pool.query("UPDATE public.artists SET picture_url = '/a/2.jpg', biography = 'Segunda banda con una discografía propia.' WHERE name = 'Banda Dos'");
    await pool.query("UPDATE public.albums SET cover_url = '/c/b.jpg' WHERE title = 'Disco B'");
    try {
      const first = (await app.inject("/home?date=2026-10-11")).json();
      const next = (await app.inject("/home?date=2026-10-12")).json();
      expect(first.featuredArtist.id).not.toBe(next.featuredArtist.id);
      expect(next.featuredArtist.pictureUrl).toBeTruthy();
      expect(next.featuredArtist.excerpt).toBeTruthy();
      expect(next.featuredArtist.album.coverUrl).toBeTruthy();
      expect(next.anniversaries.every((group: { years: number; releaseYear: number }) => group.years + group.releaseYear === 2026)).toBe(true);
    } finally {
      await pool.query("UPDATE public.artists SET picture_url = NULL, biography = NULL WHERE name = 'Banda Dos'");
      await pool.query("UPDATE public.albums SET cover_url = NULL WHERE title = 'Disco B'");
    }
  });
  it("intercala familias musicales confirmadas sin sacrificar el año del aniversario", async () => {
    const pool = getPool();
    await applyTaxonomyOperations(await planTaxonomyFile(), { actor: "prueba", reason: "taxonomía aprobada" }, { confirm: true });
    const artistId = Number((await pool.query("INSERT INTO public.artists(name) VALUES('Diversidad aniversarios') RETURNING id")).rows[0].id);
    try {
      for (let index = 0; index < 24; index++) {
        const slug = index < 20 ? "rock" : ["jazz", "folk", "metal", "blues"][index - 20];
        const albumId = Number((await pool.query("INSERT INTO public.albums(artist_id, title, release_year, cover_url) VALUES($1, $2, 1966, '/c/diversidad.jpg') RETURNING id", [artistId, `Diversidad ${index}`])).rows[0].id);
        await pool.query(`INSERT INTO ingest.album_genres(album_id, genre_id, role, status, source_kind, decided_by, decision_rule, decision_kind)
          SELECT $1, id, 'primary', $3, 'editorial', 'prueba', 'prueba', 'human' FROM ingest.genres WHERE slug = $2`, [albumId, slug, index === 23 ? "suggested" : "confirmed"]);
      }
      const home = (await app.inject("/home?date=2026-10-11")).json();
      const group = home.anniversaries.find((item: { years: number }) => item.years === 60);
      expect(group.albums).toHaveLength(12);
      expect(group.albums.every((album: { releaseYear: number; coverUrl: string }) => album.releaseYear === 1966 && album.coverUrl)).toBe(true);
      const families = group.albums.slice(0, 4).flatMap((album: { genres: Array<{ family: string }> }) => album.genres.map(genre => genre.family));
      expect(new Set(families)).toEqual(new Set(["rock", "jazz", "folk", "metal"]));
      expect(group.albums.flatMap((album: { genres: Array<{ slug: string }> }) => album.genres.map(genre => genre.slug))).not.toContain("blues");
    } finally { await pool.query("DELETE FROM ingest.album_genres WHERE album_id IN (SELECT id FROM public.albums WHERE artist_id = $1)", [artistId]); await pool.query("DELETE FROM ingest.artist_genres WHERE artist_id = $1", [artistId]); await pool.query("DELETE FROM public.albums WHERE artist_id = $1", [artistId]); await pool.query("DELETE FROM public.artists WHERE id = $1", [artistId]); }
  });

});
