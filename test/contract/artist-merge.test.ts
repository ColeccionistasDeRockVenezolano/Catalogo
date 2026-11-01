import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startPgContainer, type PgContainer } from "../support/pg-container.js";
import { applyCore } from "../support/apply-core.js";
import { migrateUp } from "../../src/db/migrate.js";
import { closeDb, getPool } from "../../src/db/client.js";
import { resetEnvCache } from "../../src/config/env.js";
import { applyArtistMerge, type ArtistMergeVerdict } from "../../src/review/artist-merge.js";
import type { ArtistCandidate } from "../../src/review/artist-candidates.js";

// Fusión asistida por IA: el camino real de `mergeEntities` con verificación de
// que integrantes, discos, audiovisuales, alias y fechas sobreviven.
describe("fusión de artistas asistida (contrato)", () => {
  let container: PgContainer;

  beforeAll(async () => {
    container = await startPgContainer();
    process.env["DATABASE_URL"] = container.databaseUrl;
    resetEnvCache();
    await applyCore(container.name);
    await migrateUp();
  }, 120_000);

  afterAll(async () => { await closeDb(); await container?.stop(); }, 60_000);

  async function one(sql: string, params: unknown[] = []): Promise<number> {
    return Number((await getPool().query<{ id: string }>(sql, params)).rows[0]!.id);
  }

  it("fusiona sin perder integrantes, discos, audiovisuales, alias ni fechas", async () => {
    const keep = await one("INSERT INTO public.artists(name,origin_city) VALUES('Kámara de Tortura','Maracay - Aragua') RETURNING id");
    const drop = await one("INSERT INTO public.artists(name,origin_city,formed_year) VALUES('La Kámara De la Tortura','Maracay',1978) RETURNING id");
    // El duplicado es el que trae el año y el disco; la ficha que queda, los integrantes.
    const album = await one("INSERT INTO public.albums(artist_id,title,release_year,album_type) VALUES($1,'Vampiro',2003,'studio_album') RETURNING id", [drop]);
    for (const [index, title] of ["Crash in course brain surgery", "Purple haze", "El vampiro", "War pigs"].entries()) {
      await one("INSERT INTO public.tracks(album_id,track_number,title) VALUES($1,$2,$3) RETURNING id", [album, index + 1, title]);
    }
    const gustavo = await one("INSERT INTO public.persons(name) VALUES('Gustavo Guerrero') RETURNING id");
    const carlos = await one("INSERT INTO public.persons(name) VALUES('Carlos Rojas') RETURNING id");
    const ivars = await one("INSERT INTO public.persons(name) VALUES('Ivars Ostors') RETURNING id");
    await one("INSERT INTO public.artist_members(artist_id,person_id,role,from_year) VALUES($1,$2,'Guitarra, voz',2002) RETURNING id", [keep, gustavo]);
    await one("INSERT INTO public.artist_members(artist_id,person_id,role,from_year) VALUES($1,$2,'Bajo',2002) RETURNING id", [keep, carlos]);
    await one("INSERT INTO public.artist_members(artist_id,person_id,role,from_year) VALUES($1,$2,'Batería',1978) RETURNING id", [keep, ivars]);
    for (const name of ["Nelson Campins", "Omar Quintero", "Luis Gil"]) {
      const person = await one("INSERT INTO public.persons(name) VALUES($1) RETURNING id", [name]);
      await one("INSERT INTO public.artist_members(artist_id,person_id,role,from_year) VALUES($1,$2,'Músico',1980) RETURNING id", [keep, person]);
    }
    await one("INSERT INTO ingest.artist_aliases(artist_id,alias,alias_type,normalized_alias) VALUES($1,'La Kamara','former_name','la kamara') RETURNING id", [drop]);
    await one(`INSERT INTO media.artist_audiovisuals(artist_id,source_key,title,title_key,kind)
               VALUES($1,'test:yatu','YATU con La Kamara de la Tortura','yatu con la kamara de la tortura','documentary') RETURNING id`, [drop]);
    await one(`INSERT INTO ingest.review_queue(kind,artist_a_id,artist_b_id,priority,status,payload)
               VALUES('possible_duplicate',$1,$2,8,'open','{"detector":"artist-candidates"}'::jsonb) RETURNING id`,
    [Math.min(keep, drop), Math.max(keep, drop)]);

    const candidate: ArtistCandidate = {
      a: { id: keep, name: "Kámara de Tortura" }, b: { id: drop, name: "La Kámara De la Tortura" },
      score: 1, deterministic: true, signals: 3, priority: 8,
      features: [{ key: "tracklist_equal", value: 0.45, evidence: "mismo disco" }],
    };
    const verdict: ArtistMergeVerdict = {
      decision: "same_identity", confidence: 0.97,
      evidence: [{ fact_id: "a.discografia", supports: "match" }, { fact_id: "b.integrantes", supports: "match" }],
      reasoning: "mismo disco, mismos músicos y misma página",
      data_gaps: [], identity_doubts: [],
    };

    const outcome = await applyArtistMerge(candidate, verdict, "prueba", "prueba de fusión", { rewrite: false });
    expect(outcome.status).toBe("merged");
    expect(outcome.missing ?? []).toEqual([]);

    const merged = (await getPool().query<{ name: string; formed_year: number | null; origin_city: string }>(
      "SELECT name,formed_year,origin_city FROM public.artists WHERE id=$1", [keep])).rows[0]!;
    expect(merged.formed_year).toBe(1978);
    expect(merged.origin_city).toBe("Maracay - Aragua");
    expect(Number((await getPool().query<{ n: string }>("SELECT count(*)::text AS n FROM public.artists WHERE id=$1", [drop])).rows[0]!.n)).toBe(0);

    const members = (await getPool().query<{ name: string }>(
      "SELECT p.name FROM public.artist_members m JOIN public.persons p ON p.id=m.person_id WHERE m.artist_id=$1 ORDER BY p.name", [keep])).rows.map((row) => row.name);
    expect(members).toEqual(["Carlos Rojas", "Gustavo Guerrero", "Ivars Ostors", "Luis Gil", "Nelson Campins", "Omar Quintero"]);
    expect(Number((await getPool().query<{ n: string }>("SELECT count(*)::text AS n FROM public.albums WHERE artist_id=$1 AND title='Vampiro'", [keep])).rows[0]!.n)).toBe(1);
    expect(Number((await getPool().query<{ n: string }>("SELECT count(*)::text AS n FROM media.artist_audiovisuals WHERE artist_id=$1", [keep])).rows[0]!.n)).toBe(1);
    const aliases = (await getPool().query<{ alias: string }>("SELECT alias FROM ingest.artist_aliases WHERE artist_id=$1 ORDER BY alias", [keep])).rows.map((row) => row.alias);
    expect(aliases).toEqual(expect.arrayContaining(["La Kámara De la Tortura", "La Kamara"]));

    // La fusión suelta el lado que desaparece del careo y lo cierra (no lo borra).
    const review = (await getPool().query<{ status: string; artist_a_id: string | null; artist_b_id: string | null }>(
      "SELECT status::text, artist_a_id::text, artist_b_id::text FROM ingest.review_queue WHERE artist_a_id=$1 OR artist_b_id=$1",
      [keep])).rows[0]!;
    expect(review.status).toBe("approved");
    expect(review.artist_a_id === null || review.artist_b_id === null).toBe(true);
  });
});
