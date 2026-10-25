import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { serializerCompiler, validatorCompiler } from "fastify-type-provider-zod";
import { startPgContainer, type PgContainer } from "../support/pg-container.js";
import { applyCore } from "../support/apply-core.js";
import { migrateUp } from "../../src/db/migrate.js";
import { closeDb, getPool } from "../../src/db/client.js";
import { resetEnvCache } from "../../src/config/env.js";
import { registerArtistRoutes } from "../../src/api/routes/artists.js";
import { registerHomeRoutes } from "../../src/api/routes/home.js";
import { registerDiscoveryRoutes } from "../../src/api/routes/discovery.js";
import { registerDailyCycleRoutes } from "../../src/api/daily-cycle.js";
import { CRV_CHANNEL_ID } from "../../src/youtube/home-channel.js";

vi.mock("../../src/youtube/home-channel.js", async importOriginal => ({
  ...await importOriginal<typeof import("../../src/youtube/home-channel.js")>(),
  latestChannelSnapshot: async () => ({ videos: [], checkedAt: null, stale: true }),
}));

describe("videos diarios del canal CRV y reloj común", () => {
  let pg: PgContainer, app: FastifyInstance;
  const artists: Record<string, number> = {};
  beforeAll(async () => {
    pg = await startPgContainer();
    process.env["DATABASE_URL"] = pg.databaseUrl; resetEnvCache();
    await applyCore(pg.name); await migrateUp();
    app = Fastify(); app.setValidatorCompiler(validatorCompiler); app.setSerializerCompiler(serializerCompiler);
    await registerArtistRoutes(app); await registerHomeRoutes(app); await registerDiscoveryRoutes(app); await registerDailyCycleRoutes(app);
    const pool = getPool();
    for (const [name, type] of [["band", "band"], ["solo", "solo_artist"], ["duo", "duo"], ["empty", "band"], ["album", "band"], ["track", "band"], ["subject", "band"]]) {
      artists[name!] = Number((await pool.query("INSERT INTO public.artists(name, artist_type) VALUES($1,$2) RETURNING id", [name, type])).rows[0].id);
    }
    let index = 0;
    async function video(artist: string | null, channel = CRV_CHANNEL_ID, status = "published", relation = "performer") {
      const id = Number((await pool.query("INSERT INTO media.youtube_videos(video_id,title,channel_id,publication_status) VALUES($1,'Video CRV',$2,$3) RETURNING id", [String(index++).padStart(11, "v"), channel, status])).rows[0].id);
      if (artist) await pool.query("INSERT INTO media.video_artists(video_id,artist_id,relation_kind) VALUES($1,$2,$3)", [id, artists[artist], relation]);
      return id;
    }
    const first = await video("band"); await video("band"); await video("band");
    await video("solo"); await video("duo"); await video("subject", CRV_CHANNEL_ID, "published", "subject");
    await video("band", "otro-canal"); await video("band", CRV_CHANNEL_ID, "copyright_blocked");
    await video("empty", "otro-canal"); await video("empty", CRV_CHANNEL_ID, "unpublished");
    await video("empty", CRV_CHANNEL_ID, "published", "channel");
    // El mismo video con vínculo directo y de disco se cuenta solo una vez.
    const bandAlbum = Number((await pool.query("INSERT INTO public.albums(artist_id,title) VALUES($1,'Disco de banda') RETURNING id", [artists["band"]])).rows[0].id);
    await pool.query("INSERT INTO media.video_albums(video_id,album_id) VALUES($1,$2)", [first, bandAlbum]);
    for (const kind of ["album", "track"]) {
      const album = Number((await pool.query("INSERT INTO public.albums(artist_id,title) VALUES($1,$2) RETURNING id", [artists[kind], `Disco ${kind}`])).rows[0].id);
      const id = await video(null);
      if (kind === "album") await pool.query("INSERT INTO media.video_albums(video_id,album_id) VALUES($1,$2)", [id, album]);
      else {
        const track = Number((await pool.query("INSERT INTO public.tracks(album_id,track_number,title) VALUES($1,1,'Pista') RETURNING id", [album])).rows[0].id);
        await pool.query("INSERT INTO media.video_tracks(video_id,track_id,start_seconds) VALUES($1,$2,0)", [id, track]);
      }
    }
  });
  afterAll(async () => { vi.useRealTimers(); await app?.close(); await closeDb(); await pg?.stop(); });
  async function detail(name: string, date = "2026-10-14") {
    const response = await app.inject(`/artists/${artists[name]}?date=${date}`);
    expect(response.statusCode).toBe(200); expect(response.headers["cache-control"]).toBe("no-store");
    return response.json();
  }
  it.each(["solo", "duo", "album", "track", "subject"])("incluye %s aunque no tenga ninguna plataforma de streaming", async name => {
    const first = await detail(name); const next = await detail(name, "2026-10-15");
    expect(first.platforms).toEqual([]);
    expect(first.channelVideo).toMatchObject({ count: 1, date: "2026-10-14", url: expect.stringContaining("youtube.com/watch?v=") });
    expect(next.channelVideo.videoId).toBe(first.channelVideo.videoId);
  });
  it("rota sin duplicados ni videos ajenos o bloqueados y mantiene el video durante el día", async () => {
    const first = await detail("band"); expect((await detail("band")).channelVideo).toEqual(first.channelVideo);
    expect(first.channelVideo.count).toBe(3);
    const days = await Promise.all([14, 15, 16, 17].map(day => detail("band", `2026-10-${day}`)));
    expect(new Set(days.slice(0, 3).map(day => day.channelVideo.videoId)).size).toBe(3);
    expect(days[3].channelVideo.videoId).toBe(first.channelVideo.videoId);
    expect((await detail("empty")).channelVideo).toBeNull();
  });
  it("cambia portada, buscador y video en el mismo instante de Venezuela", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      const selected = [];
      for (const instant of ["2026-10-15T03:59:59.999Z", "2026-10-15T04:00:00.000Z"]) {
        vi.setSystemTime(new Date(instant));
        const clock = (await app.inject("/daily-cycle")).json();
        const home = (await app.inject("/home")).json();
        const discovery = (await app.inject("/discovery/search-suggestions")).json();
        const artist = (await app.inject(`/artists/${artists["band"]}`)).json();
        expect(home.dailyCycle.date).toBe(clock.date);
        expect(discovery.dailyCycle.date).toBe(clock.date);
        expect(artist.dailyCycle.date).toBe(clock.date);
        expect(artist.channelVideo.date).toBe(clock.date);
        selected.push(artist.channelVideo.videoId);
      }
      expect(selected[0]).not.toBe(selected[1]);
    } finally { vi.useRealTimers(); }
  });
  it("rechaza fechas inexistentes en todas las APIs diarias", async () => {
    for (const route of ["/home", "/discovery/search-suggestions", `/artists/${artists["band"]}`]) {
      expect((await app.inject(`${route}?date=2026-02-30`)).statusCode).toBe(400);
    }
  });
  it("ofrece publicaciones verificadas del propio artista sin sustituir sus perfiles", async () => {
    const pool=getPool();
    const own=artists['empty'];
    const album=async (artist:number|undefined,title:string,year:number)=>Number((await pool.query('INSERT INTO public.albums(artist_id,title,release_year) VALUES($1,$2,$3) RETURNING id',[artist,title,year])).rows[0].id);
    const old=await album(own,'Anterior',2001), recent=await album(own,'Publicación reciente',2026), candidate=await album(own,'Candidato',2027), foreign=await album(artists['band'],'Otro artista',2028);
    const link=async(albumId:number|null,platform:string,url:string,externalId:string|null,verified=true)=>pool.query("INSERT INTO public.streaming_links(artist_id,album_id,platform,url,external_id,method,source,verified) VALUES($1,$2,$3,$4,$5,'exact','crv-operador',$6)",[albumId?null:own,albumId,platform,url,externalId,verified]);
    await link(null,'bandcamp','https://perfil.bandcamp.com',null);
    await link(null,'spotify','https://open.spotify.com/artist/1Dt7cfRzxM8qPVa82jX9y5',null);
    await link(old,'bandcamp','https://perfil.bandcamp.com/album/anterior','album=1');
    await link(recent,'bandcamp','https://perfil.bandcamp.com/album/reciente','album=2');
    await link(candidate,'bandcamp','https://perfil.bandcamp.com/album/candidato','album=3',false);
    await link(foreign,'bandcamp','https://otro.bandcamp.com/album/ajeno','album=4');
    await link(recent,'spotify','https://open.spotify.com/album/4aawyAB9vmqN3uQ7FjRGTy',null);
    await link(recent,'apple_music','https://music.apple.com/us/album/reciente/123456',null);
    const result=await detail('empty');
    expect(result.platforms.find((item:{platform:string})=>item.platform==='bandcamp').url).toBe('https://perfil.bandcamp.com');
    expect(result.playbackAlbums).toHaveLength(2);
    expect(result.playbackAlbums.find((item:{platform:string})=>item.platform==='bandcamp')).toMatchObject({albumId:recent,albumTitle:'Publicación reciente',externalId:'album=2'});
    expect(result.playbackAlbums.some((item:{platform:string})=>item.platform==='spotify')).toBe(false);
    expect(result.playbackAlbums.some((item:{platform:string})=>item.platform==='apple_music')).toBe(true);
  });
});
