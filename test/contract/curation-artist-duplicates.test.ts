import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { startPgContainer, type PgContainer } from "../support/pg-container.js";
import { applyCore } from "../support/apply-core.js";
import { migrateUp } from "../../src/db/migrate.js";
import { closeDb, getPool } from "../../src/db/client.js";
import { resetEnvCache } from "../../src/config/env.js";
import { loadCatalogSnapshot } from "../../src/curation/snapshot.js";
import { analyzeCatalog } from "../../src/curation/analyze.js";
import { evidenceArtistDuplicates } from "../../src/curation/detectors/artist-duplicates.js";

// La foto de Curaduría debe traer los hechos que usa el detector de evidencia
// (página, cuenta oficial, ID externo, discografía, integrantes) y el detector
// debe emitir el par sobre esa foto, sin tocar la base.
describe("duplicados de artista por evidencia (contrato de foto + detector)", () => {
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

  const artist = (name: string, city: string, formed: number) => one(
    "INSERT INTO public.artists(name,origin_city,formed_year) VALUES($1,$2,$3) RETURNING id", [name, city, formed]);

  async function albumWithTracks(artistId: number, title: string, year: number, tracks: string[]): Promise<number> {
    const albumId = await one(
      "INSERT INTO public.albums(artist_id,title,release_year,album_type) VALUES($1,$2,$3,'studio_album') RETURNING id",
      [artistId, title, year]);
    for (const [index, track] of tracks.entries()) {
      await one("INSERT INTO public.tracks(album_id,disc_number,track_number,title) VALUES($1,1,$2,$3) RETURNING id",
        [albumId, index + 1, track]);
    }
    return albumId;
  }

  it("carga la evidencia y detecta el par real", async () => {
    const keep = await artist("Kámara Test", "Maracay - Aragua", 1978);
    const drop = await artist("La Kámara Test", "Maracay", 1978);
    const personA = await one("INSERT INTO public.persons(name) VALUES('Gustavo Test') RETURNING id");
    const personB = await one("INSERT INTO public.persons(name) VALUES('Gustavo Test') RETURNING id");
    await one("INSERT INTO public.artist_members(artist_id,person_id,role) VALUES($1,$2,'Guitarra') RETURNING id", [keep, personA]);
    await one("INSERT INTO public.artist_members(artist_id,person_id,role) VALUES($1,$2,'Guitarra') RETURNING id", [drop, personB]);
    await albumWithTracks(keep, "Vampiro Test", 2003, ["Uno", "Dos", "Tres"]);
    await albumWithTracks(drop, "Vampiro Test", 2003, ["Uno", "Dos", "Tres"]);
    await one("INSERT INTO ingest.artist_aliases(artist_id,alias,alias_type,normalized_alias) VALUES($1,'La Kámara Test','name_variant','la kamara test') RETURNING id", [keep]);
    await one("INSERT INTO public.social_links(artist_id,platform,url,method,source,verified) VALUES($1,'instagram','https://instagram.com/kamara-test','manual','test',false) RETURNING id", [keep]);
    await one("INSERT INTO public.social_links(artist_id,platform,url,method,source,verified) VALUES($1,'instagram','https://instagram.com/kamara-test','manual','test',false) RETURNING id", [drop]);
    for (const artistId of [keep, drop]) {
      await one(
        "INSERT INTO ingest.artist_editorial_policy(artist_id,disposition,reference_kind,reason,snapshot,decided_by) VALUES($1,'reference','collective','prueba','{}'::jsonb,'prueba') RETURNING artist_id AS id",
        [artistId]);
    }
    await one("INSERT INTO ingest.artist_editorial_identifiers(artist_id,namespace,identifier) VALUES($1,'discogs','123') RETURNING artist_id AS id", [keep]);
    await one("INSERT INTO ingest.artist_editorial_identifiers(artist_id,namespace,identifier) VALUES($1,'discogs','123') RETURNING artist_id AS id", [drop]);

    const sourceId = await one(
      "INSERT INTO ingest.sources(slug,name,site_type,trust_level,enabled) VALUES('test-foto','Test foto','website','high',true) RETURNING id");
    const claim = await one(
      "INSERT INTO ingest.claims(source_id,entity_kind,artist_id,field,raw_value,raw_hash) VALUES($1,'artist',$2,'biography','\"ficha\"'::jsonb,$3) RETURNING id",
      [sourceId, keep, createHash("sha256").update(`claim-${keep}`).digest("hex")]);
    const sharedUrl = "https://rockhechovenezuela.com/k/kamara-test/";
    await one("INSERT INTO ingest.claim_evidence(claim_id,url,evidence_hash) VALUES($1,$2,$3) RETURNING id",
      [claim, sharedUrl, createHash("sha256").update(sharedUrl).digest("hex")]);
    const claimDrop = await one(
      "INSERT INTO ingest.claims(source_id,entity_kind,artist_id,field,raw_value,raw_hash) VALUES($1,'artist',$2,'biography','\"ficha\"'::jsonb,$3) RETURNING id",
      [sourceId, drop, createHash("sha256").update(`claim-${drop}`).digest("hex")]);
    await one("INSERT INTO ingest.claim_evidence(claim_id,url,evidence_hash) VALUES($1,$2,$3) RETURNING id",
      [claimDrop, sharedUrl, createHash("sha256").update(`${sharedUrl}-2`).digest("hex")]);

    const client = await getPool().connect();
    let snapshot;
    try {
      snapshot = await loadCatalogSnapshot(client);
    } finally {
      client.release();
    }

    const facts = snapshot.artistFacts ?? [];
    const keepFacts = facts.find((item) => item.id === keep)!;
    const dropFacts = facts.find((item) => item.id === drop)!;
    expect(keepFacts.evidenceUrls).toContainEqual({ url: "https://rockhechovenezuela.com/k/kamara-test", artists: 2 });
    expect(keepFacts.officialLinks).toContainEqual({ url: "https://instagram.com/kamara-test", platform: "instagram", artists: 2 });
    expect(keepFacts.externalIds).toContain("discogs:123");
    expect(keepFacts.albumKeys).toEqual(new Set(["vampiro test|2003"]));
    expect([...keepFacts.tracklistHashes.keys()]).toEqual([...dropFacts.tracklistHashes.keys()]);
    expect(keepFacts.members.map((member) => member.key)).toEqual(["gustavo test"]);

    const analysis = analyzeCatalog(snapshot, { detectors: [evidenceArtistDuplicates], anomalies: false });
    expect(analysis.failures).toEqual([]);
    expect(analysis.findings).toHaveLength(1);
    expect(analysis.findings[0]!.pair).toEqual([Math.min(keep, drop), Math.max(keep, drop)]);
    expect(analysis.findings[0]!.signature).toBe("evidencia_determinista");
  }, 60_000);
});
