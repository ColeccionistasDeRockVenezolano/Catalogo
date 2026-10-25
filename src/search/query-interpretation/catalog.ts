import { readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { getPool } from "../../db/client.js";
import { catalogKey, type CatalogMatch, type CatalogResolver } from "./segmenter.js";

/** Nombres exactos del catálogo (fichas y alias). Solo resuelve igualdad de clave, nunca «contiene». */
export class SnapshotCatalog implements CatalogResolver {
  constructor(private readonly byKey: Map<string, CatalogMatch[]>, readonly hash: string) {}
  lookup(literal: string): CatalogMatch[] { return this.byKey.get(catalogKey(literal)) ?? []; }
  get size() { return this.byKey.size; }
}

const SQL: Record<CatalogMatch["kind"], [string, string]> = {
  artist: ["SELECT id, name FROM ingest.catalog_artists", "SELECT artist_id AS id, alias AS name FROM ingest.artist_aliases"],
  album: ["SELECT id, title AS name FROM ingest.catalog_albums", "SELECT album_id AS id, alias AS name FROM ingest.album_aliases"],
  track: ["SELECT id, title AS name FROM ingest.catalog_tracks", "SELECT track_id AS id, alias AS name FROM ingest.track_aliases"],
  person: ["SELECT id, name FROM public.persons", "SELECT person_id AS id, alias AS name FROM ingest.person_aliases"],
  organization: ["SELECT id, name FROM public.organizations", "SELECT organization_id AS id, alias AS name FROM ingest.organization_aliases"],
};

/** Exporta la instantánea: {kind: [[id, name], ...]}. Lectura; no escribe en la base. */
export async function exportCatalogSnapshot(file: string): Promise<{ hash: string; rows: number }> {
  const out: Record<string, [number, string][]> = {};
  let rows = 0;
  for (const [kind, [entities, aliases]] of Object.entries(SQL)) {
    const [a, b] = await Promise.all([getPool().query(entities), getPool().query(aliases)]);
    out[kind] = [...a.rows, ...b.rows].map(r => [Number(r.id), String(r.name)] as [number, string]);
    rows += out[kind]!.length;
  }
  const text = JSON.stringify({ version: "crv-catalog-names-1", exportedAt: new Date().toISOString(), names: out });
  await writeFile(file, text);
  return { hash: createHash("sha256").update(text).digest("hex"), rows };
}

export function loadCatalogSnapshot(file: string): SnapshotCatalog {
  const text = readFileSync(file, "utf8");
  const doc = JSON.parse(text) as { names: Record<CatalogMatch["kind"], [number, string][]> };
  const byKey = new Map<string, CatalogMatch[]>();
  for (const [kind, list] of Object.entries(doc.names) as [CatalogMatch["kind"], [number, string][]][]) {
    for (const [id, name] of list) {
      const key = catalogKey(name);
      if (!key) continue;
      const bucket = byKey.get(key) ?? [];
      if (!bucket.some(x => x.kind === kind && x.id === id)) bucket.push({ kind, id, name });
      byKey.set(key, bucket);
    }
  }
  return new SnapshotCatalog(byKey, createHash("sha256").update(text).digest("hex"));
}
