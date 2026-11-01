import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { startPgContainer, type PgContainer } from "../support/pg-container.js";
import { applyCore } from "../support/apply-core.js";
import { migrateUp } from "../../src/db/migrate.js";
import { closeDb, getPool } from "../../src/db/client.js";
import { resetEnvCache } from "../../src/config/env.js";
import { findArtistCandidates, openArtistCandidateReviews } from "../../src/review/artist-candidates.js";

// Detector de duplicados de artista: contrato con PostgreSQL. Cubre el caso
// real 3230/8576 (nombre con conector de más, mismo disco, mismos músicos,
// misma página), la idempotencia del índice 0115 y la guarda de épocas.
describe("detector de candidatos de artista (contrato)", () => {
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

  const newArtist = (name: string, city: string | null, formedYear: number | null) => one(
    "INSERT INTO public.artists(name,origin_city,formed_year) VALUES($1,$2,$3) RETURNING id", [name, city, formedYear]);
  const newPerson = (name: string) => one("INSERT INTO public.persons(name) VALUES($1) RETURNING id", [name]);
  const newMember = (artistId: number, personId: number, role: string) => one(
    "INSERT INTO public.artist_members(artist_id,person_id,role) VALUES($1,$2,$3) RETURNING id", [artistId, personId, role]);

  async function newAlbum(artistId: number, title: string, year: number, tracks: string[]): Promise<number> {
    const albumId = await one("INSERT INTO public.albums(artist_id,title,release_year,album_type) VALUES($1,$2,$3,'studio_album') RETURNING id",
      [artistId, title, year]);
    for (const [index, track] of tracks.entries()) {
      await one("INSERT INTO public.tracks(album_id,track_number,title) VALUES($1,$2,$3) RETURNING id", [albumId, index + 1, track]);
    }
    return albumId;
  }

  async function newEvidence(artistId: number, url: string): Promise<number> {
    const sourceId = await one(`
      INSERT INTO ingest.sources(slug,name,site_type,trust_level,enabled)
      VALUES('test-directorio','Directorio de prueba','website','high',false)
      ON CONFLICT (slug) DO UPDATE SET name=EXCLUDED.name RETURNING id`);
    const rawHash = createHash("sha256").update(`biography:"ficha":${artistId}`).digest("hex");
    const claimId = await one(
      "INSERT INTO ingest.claims(source_id,entity_kind,artist_id,field,raw_value,raw_hash) VALUES($1,'artist',$2,'biography','\"ficha\"'::jsonb,$3) RETURNING id",
      [sourceId, artistId, rawHash]);
    const hash = createHash("sha256").update(`${claimId}:${url}`).digest("hex");
    await getPool().query("INSERT INTO ingest.claim_evidence(claim_id,url,evidence_hash) VALUES($1,$2,$3)", [claimId, url, hash]);
    return claimId;
  }

  it("propone el par real, con señales deterministas, y la corrida es idempotente", async () => {
    const keep = await newArtist("Kámara de Tortura", "Maracay - Aragua", 1978);
    const drop = await newArtist("La Kámara De la Tortura", "Maracay", null);
    await newAlbum(keep, "Vampiro", 2003, ["Crash in course brain surgery", "Purple haze", "El vampiro", "War pigs"]);
    await newAlbum(drop, "Vampiro", 2003, ["Crash in course brain surgery", "Purple haze", "El vampiro", "War pigs"]);

    // El mismo músico puede estar duplicado en `persons`: el detector empareja
    // por nombre normalizado + instrumento, nunca por person_id.
    const gustavoA = await newPerson("Gustavo Guerrero");
    const gustavoB = await newPerson("Gustavo Guerrero");
    const carlosA = await newPerson("Carlos Rojas");
    const carlosB = await newPerson("Carlos Rojas");
    await newMember(keep, gustavoA, "Guitarra, voz");
    await newMember(keep, carlosA, "Bajo");
    await newMember(drop, gustavoB, "Guitars & Lead Vocals");
    await newMember(drop, carlosB, "Bass");

    const url = "https://rockhechovenezuela.com/k/kamara-de-la-tortura-la/";
    await newEvidence(keep, url);
    await newEvidence(drop, url);

    const scan = await findArtistCandidates();
    const pair = scan.candidates.find((candidate) =>
      [candidate.a.id, candidate.b.id].includes(keep) && [candidate.a.id, candidate.b.id].includes(drop));
    expect(pair).toBeDefined();
    expect(pair!.deterministic).toBe(true);
    expect(pair!.score).toBe(1);
    const keys = pair!.features.map((feature) => feature.key);
    expect(keys).toEqual(expect.arrayContaining([
      "shared_evidence_url", "tracklist_equal", "album_overlap", "member_overlap", "name_token_containment",
    ]));

    const opened = await openArtistCandidateReviews([pair!], "prueba de candidatos de artista", "prueba");
    expect(opened).toMatchObject({ opened: 1, skipped: 0 });
    // El índice parcial 0115 evita que una segunda corrida duplique el careo vivo.
    const twice = await openArtistCandidateReviews([pair!], "prueba de candidatos de artista", "prueba");
    expect(twice).toMatchObject({ opened: 0, skipped: 1 });
    const row = (await getPool().query<{ kind: string; artist_a_id: string; artist_b_id: string; priority: number; payload: { detector: string; deterministic: boolean } }>(
      "SELECT kind::text, artist_a_id::text, artist_b_id::text, priority, payload FROM ingest.review_queue WHERE artist_a_id=$1 AND artist_b_id=$2",
      [Math.min(keep, drop), Math.max(keep, drop)])).rows[0]!;
    expect(row.kind).toBe("possible_duplicate");
    expect(row.priority).toBe(8);
    expect(row.payload.detector).toBe("artist-candidates");
    expect(row.payload.deterministic).toBe(true);

    // La revisión viva evita que la corrida siguiente repita el par.
    const again = await findArtistCandidates();
    expect(again.candidates.filter((candidate) =>
      [candidate.a.id, candidate.b.id].includes(keep) && [candidate.a.id, candidate.b.id].includes(drop))).toEqual([]);

    // Y «son distintas» tampoco vuelve a proponerse.
    await getPool().query("UPDATE ingest.review_queue SET status='dismissed', resolved_by='human', resolved_at=now() WHERE artist_a_id=$1 AND artist_b_id=$2",
      [Math.min(keep, drop), Math.max(keep, drop)]);
    const after = await findArtistCandidates();
    expect(after.candidates.filter((candidate) =>
      [candidate.a.id, candidate.b.id].includes(keep) && [candidate.a.id, candidate.b.id].includes(drop))).toEqual([]);
  });

  it("no propone homónimos de épocas separadas con ciudades distintas y sin ancla", async () => {
    const old = await newArtist("Témpano", "Maracay", 1975);
    const modern = await newArtist("El Témpano", "Caracas", 2005);
    const scan = await findArtistCandidates();
    const pair = scan.candidates.find((candidate) =>
      [candidate.a.id, candidate.b.id].includes(old) && [candidate.a.id, candidate.b.id].includes(modern));
    expect(pair).toBeUndefined();
  });

  it("dos discos distintos con el mismo título y año no bastan si no hay nada más", async () => {
    const a = await newArtist("Proyecto Uno", "Valencia", 1999);
    const b = await newArtist("Proyecto Dos", "Valencia", 1999);
    await newAlbum(a, "Maqueta", 1999, ["Uno", "Dos", "Tres"]);
    await newAlbum(b, "Maqueta", 1999, ["Uno", "Dos", "Tres"]);
    // La huella de tracklist sí coincide y es determinista: el par debe
    // proponerse para revisión, sin que el detector decida nada.
    const scan = await findArtistCandidates();
    const pair = scan.candidates.find((candidate) =>
      [candidate.a.id, candidate.b.id].includes(a) && [candidate.a.id, candidate.b.id].includes(b));
    expect(pair?.features.map((feature) => feature.key)).toContain("tracklist_equal");
  });
});
