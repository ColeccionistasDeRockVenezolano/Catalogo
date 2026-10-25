import { afterAll, beforeAll, describe, expect, it } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { serializerCompiler, validatorCompiler } from "fastify-type-provider-zod";
import { startPgContainer, type PgContainer } from "../support/pg-container.js";
import { applyCore } from "../support/apply-core.js";
import { migrateUp } from "../../src/db/migrate.js";
import { closeDb, getPool } from "../../src/db/client.js";
import { resetEnvCache } from "../../src/config/env.js";
import { registerArtistRoutes } from "../../src/api/routes/artists.js";
import { syncArtistAudiovisuals } from "../../src/youtube/audiovisuals.js";
import { persistVideoPayload } from "../../src/youtube/pipeline.js";
import { createEntity, withOperatorRun } from "../../src/merge/operator.js";
import { CRV_CHANNEL_ID } from "../../src/youtube/home-channel.js";

describe("audiovisuales de los perfiles", () => {
  let pg: PgContainer, app: FastifyInstance;
  let artist: number, gas: number;
  beforeAll(async () => {
    pg = await startPgContainer(); process.env["DATABASE_URL"] = pg.databaseUrl; resetEnvCache();
    await applyCore(pg.name); await migrateUp();
    app = Fastify(); app.setValidatorCompiler(validatorCompiler); app.setSerializerCompiler(serializerCompiler);
    await registerArtistRoutes(app);
    artist = Number((await getPool().query("INSERT INTO public.artists(name) VALUES('Banda de prueba') RETURNING id")).rows[0].id);
    gas = Number((await getPool().query("INSERT INTO public.artists(name) VALUES('Gasolina') RETURNING id")).rows[0].id);
    let order = 1;
    for (const [name, title, type, video] of [["Banda de prueba", "Película", "Documentary", "docVideo001"],
      ["Banda de prueba", "Archivo sin video", "Live Concert", null],
      ["Banda de prueba", "Clip bloqueado", "Music Video", "blocked0001"],
      ["Gasolina", "Blues Criollo", "Documentary", "bePwD424LvA"]]) {
      const index = order++;
      await getPool().query(`INSERT INTO ingest.seed_uploads(upload_order,artist_name_raw,album_name_raw,type_raw,video_id,row_hash,content_kind)
        VALUES($1,$2,$3,$4,$5,$6,'media')`, [index, name, title, type, video, String(index).repeat(64)]);
    }
  });
  afterAll(async () => { await app?.close(); await closeDb(); await pg?.stop(); });
  it("ingresa el documental al hidratar, conserva capítulos y no crea discos", async () => {
    const client = await getPool().connect();
    try {
      await persistVideoPayload(client, { id: "docVideo001", snippet: { title: "Banda de prueba - Película (2010) || Full Documentary ||", channelId: CRV_CHANNEL_ID,
        description: "Timestamps:\n00:00 - Prólogo\n05:00 - Concierto\n20:00 - Error de la fuente\n\nOther Credits\nDirected by Persona de Prueba" }, contentDetails: { duration: "PT10M" }, status: { privacyStatus: "public", embeddable: true } });
      await persistVideoPayload(client, { id: "blocked0001", snippet: { title: "Banda de prueba - Clip bloqueado (Official Video)", channelId: CRV_CHANNEL_ID }, status: { privacyStatus: "private" } });
      await syncArtistAudiovisuals(client);
    } finally { client.release(); }
    const response = await app.inject(`/artists/${artist}`); expect(response.statusCode).toBe(200);
    const detail = response.json(); expect(detail.discography).toEqual([]); expect(detail.audiovisuals).toHaveLength(1);
    expect(detail.audiovisuals.find((item: { title: string }) => item.title === "Película")).toMatchObject({ kind: "documentary", playable: true,
      chapters: [{ title: "Prólogo", startSeconds: 0 }, { title: "Concierto", startSeconds: 300 }] });
    expect(detail.audiovisuals).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ title: "Archivo sin video" }),
      expect.objectContaining({ title: "Clip bloqueado" }),
    ]));
  });
  it("es idempotente y no recrea el audiovisual como disco mediante altas manuales", async () => {
    const client = await getPool().connect();
    try { await syncArtistAudiovisuals(client); await syncArtistAudiovisuals(client); } finally { client.release(); }
    expect(Number((await getPool().query("SELECT count(*) FROM media.artist_audiovisuals WHERE artist_id=$1", [artist])).rows[0].count)).toBe(3);
    await expect(withOperatorRun({ name: "test-av", operator: "test", note: "Alta incorrecta" },
      context => createEntity(context, "album", { title: "Película" }, { artistId: artist }))).rejects.toThrow("Audiovisuales");
    expect(Number((await getPool().query("SELECT count(*) FROM public.albums WHERE artist_id=$1", [artist])).rows[0].count)).toBe(0);
  });
  it("conserva el disco de Gasolina y muestra también su documental en audiovisuales", async () => {
    const client = await getPool().connect();
    try {
      await persistVideoPayload(client, { id: "bePwD424LvA", snippet: { title: "Gasolina - Blues Criollo (Documentary)", channelId: CRV_CHANNEL_ID },
        status: { privacyStatus: "public", embeddable: true } });
    } finally { client.release(); }
    await withOperatorRun({ name: "test-gas", operator: "test", note: "Excepción musical expresa" },
      context => createEntity(context, "album", { title: "Blues Criollo" }, { artistId: gas }));
    const detail = (await app.inject(`/artists/${gas}`)).json();
    expect(detail.audiovisuals).toHaveLength(1);
    expect(detail.audiovisuals[0]).toMatchObject({ title: "Blues Criollo", kind: "documentary" });
    expect(detail.discography).toHaveLength(1);
  });
  it("envía identidades ambiguas a revisión sin fabricar artistas", async () => {
    await getPool().query("INSERT INTO public.artists(name) VALUES('Ambigua'),('Ámbigua')");
    await getPool().query(`INSERT INTO ingest.seed_uploads(upload_order,artist_name_raw,album_name_raw,type_raw,row_hash)
      VALUES(10,'Ambigua','Documental ambiguo','Documentary',repeat('f',64))`);
    const client = await getPool().connect();
    try { await syncArtistAudiovisuals(client); await syncArtistAudiovisuals(client); } finally { client.release(); }
    expect(Number((await getPool().query("SELECT count(*) FROM media.artist_audiovisuals WHERE title='Documental ambiguo'")).rows[0].count)).toBe(0);
    expect(Number((await getPool().query("SELECT count(*) FROM ingest.review_queue WHERE payload->>'title'='Documental ambiguo'")).rows[0].count)).toBe(1);
  });
  it("acepta en el perfil un video de un canal ajeno al propio", async () => {
    const client = await getPool().connect();
    try {
      await persistVideoPayload(client, { id: "ajenoVid001", snippet: { title: "Banda de prueba - Toma Ajena (Official Video)", channelId: "UCcanalAjenoDeArtista001" },
        status: { privacyStatus: "public", embeddable: true } });
    } finally { client.release(); }
    const detail = (await app.inject(`/artists/${artist}`)).json();
    expect(detail.audiovisuals.find((item: { title: string }) => item.title === "Toma Ajena (Official Video)")).toMatchObject({ kind: "music_video", playable: true });
  });
  it("no duplica ni reasigna un video ya colocado por una captura editorial", async () => {
    const inserted = await getPool().query(`INSERT INTO media.youtube_videos(video_id,url,title,channel_id,publication_status,metadata,last_fetched_at)
      VALUES('editorial02','https://youtu.be/editorial02','Banda de prueba - Toma Editora (Official Video)','UCcanalEditorial00001','published','{"status":{"embeddable":true}}',now()) RETURNING id`);
    const videoDbId = Number(inserted.rows[0].id);
    await getPool().query(`INSERT INTO media.artist_audiovisuals(artist_id,source_key,video_id,title,title_key,kind,source_type,metadata)
      VALUES($1,'rym:test',$2,'Toma Editora','tomaeditora','music_video','Music Video','{"editorial":true}')`, [gas, videoDbId]);
    const client = await getPool().connect();
    try { await syncArtistAudiovisuals(client); await syncArtistAudiovisuals(client); } finally { client.release(); }
    const rows = (await getPool().query("SELECT artist_id FROM media.artist_audiovisuals WHERE video_id=$1", [videoDbId])).rows;
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].artist_id)).toBe(gas);
  });
});
