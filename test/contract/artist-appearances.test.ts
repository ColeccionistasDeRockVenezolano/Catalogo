import { afterAll, beforeAll, expect, it } from "vitest";
import { startPgContainer, type PgContainer } from "../support/pg-container.js";
import { applyCore } from "../support/apply-core.js";
import { migrateUp } from "../../src/db/migrate.js";
import { closeDb, getPool } from "../../src/db/client.js";
import { resetEnvCache } from "../../src/config/env.js";
import { artistAppearances } from "../../src/api/repositories/artist-appearances.js";

let container: PgContainer;
const originalUrl = process.env["DATABASE_URL"];
beforeAll(async () => {
  container = await startPgContainer();
  process.env["DATABASE_URL"] = container.databaseUrl;
  resetEnvCache();
  await applyCore(container.name);
  await migrateUp();
});
afterAll(async () => {
  await closeDb(); await container?.stop();
  if (originalUrl === undefined) delete process.env["DATABASE_URL"]; else process.env["DATABASE_URL"] = originalUrl;
  resetEnvCache();
});

it("muestra canciones documentadas sin inventar pistas y filtra evidencia ajena, pendiente o no interpretativa", async () => {
  const p = getPool();
  const artist = Number((await p.query("INSERT INTO public.artists(name,artist_type) VALUES('Kashmir','band') RETURNING id")).rows[0].id);
  const owner = Number((await p.query("INSERT INTO public.artists(name,artist_type) VALUES('Various Artists','other') RETURNING id")).rows[0].id);
  const album = Number((await p.query("INSERT INTO public.albums(artist_id,title,album_type) VALUES($1,'Recopilatorio documentado','compilation') RETURNING id", [owner])).rows[0].id);
  const track = Number((await p.query("INSERT INTO public.tracks(album_id,track_number,title) VALUES($1,2,'Kashmir - No Se Decir Adiós') RETURNING id", [album])).rows[0].id);
  await p.query("INSERT INTO public.track_credits(track_id,artist_id,credit_type,role) VALUES($1,$2,'musician','Intérprete')", [track, artist]);
  const credit = Number((await p.query("INSERT INTO public.album_credits(album_id,artist_id,credit_type,role) VALUES($1,$2,'musician','Intérprete') RETURNING id", [album, artist])).rows[0].id);
  const composer = Number((await p.query("INSERT INTO public.album_credits(album_id,artist_id,credit_type,role) VALUES($1,$2,'composer','Compositor') RETURNING id", [album, artist])).rows[0].id);
  const source = Number((await p.query("INSERT INTO ingest.sources(slug,name) VALUES('appearance-test','Test') RETURNING id")).rows[0].id);
  async function claim(id: number, titles: unknown, status: string) {
    await p.query(`INSERT INTO ingest.claims(source_id,entity_kind,album_credit_id,field,raw_value,normalized_value,raw_hash,extractor,extractor_version,confidence,status)
      VALUES($1,'album_credit',$2,'documented_tracks',$3::jsonb,$3::jsonb,md5($3::text)||md5($3::text),'test','1','medium',$4)`, [source, id, JSON.stringify(titles), status]);
  }
  await claim(credit, ["No se decir adiós", "No puede ser"], "accepted");
  await claim(credit, ["Pendiente"], "candidate");
  await claim(credit, ["Descartada"], "rejected");
  await claim(credit, { invalid: "shape" }, "accepted");
  await claim(composer, ["Solo compuesta"], "accepted");
  expect((await artistAppearances(artist)).map(a => ({ id: a.albumId, tracks: a.tracks })))
    .toEqual([{ id: album, tracks: ["No Se Decir Adiós", "No puede ser"] }]);
  expect((await artistAppearances(owner))).toEqual([]);
  expect(Number((await p.query("SELECT count(*) FROM public.tracks WHERE album_id=$1", [album])).rows[0].count)).toBe(1);
  await p.query("DELETE FROM public.album_credits WHERE id=$1", [credit]);
  expect((await artistAppearances(artist))[0]!.tracks).toEqual(["No Se Decir Adiós"]);
});
