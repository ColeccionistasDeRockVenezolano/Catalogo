/**
 * Cruce MP3.com 2003 ↔ catálogo CRV.
 *
 * Lee reports/mp3com-2003/venezolanos.jsonl (candidatos detectados por
 * scripts/mp3com-venezolanos.py) y responde, con las claves de identidad del
 * propio proyecto (normalizeEntityName), cuáles ya están y cuáles faltan.
 *
 * Uso: tsx scripts/mp3com-cruce.mts   (sólo lectura; escribe reports/mp3com-2003/cruce.{jsonl,csv})
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { closeDb, getPool } from "../src/db/client.js";
import { normalizeEntityName } from "../src/normalization/entity-name.js";
import { classifyPersonName } from "../src/review/person-junk.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = process.env["MP3COM_OUT"] ?? path.join(process.env["HOME"] ?? ROOT, "crv-staging/reports/mp3com-2003");
const IN = path.join(OUT, "venezolanos.jsonl");

interface Candidato {
  name?: string | null; uri?: string | null; dir: string; page: string;
  location?: string; find_more?: string; loc_city?: string; loc_state?: string; loc_country?: string;
  tier: "A" | "B" | "C"; why: string; style?: string; description?: string; history?: string;
  members?: string; instruments?: string; albums?: string; influences?: string; similar?: string; plays?: number;
}

/** Nombre presentable: colapsa espacios, quita guiones/puntos de los extremos. */
function displayName(raw: string | null | undefined): string {
  return (raw ?? "").replace(/\s+/g, " ").replace(/^[\s\-–—.|:]+|[\s\-–—.|:]+$/g, "").trim();
}

/** Similitud Dice por bigramas sobre la clave secundaria compacta (sin tildes ni signos). */
function bigrams(s: string): Set<string> {
  const out = new Set<string>();
  const t = ` ${s} `;
  for (let i = 0; i < t.length - 1; i++) out.add(t.slice(i, i + 2));
  return out;
}
function dice(a: string, b: string): number {
  const A = bigrams(a), B = bigrams(b);
  if (!A.size || !B.size) return 0;
  let hit = 0;
  for (const x of A) if (B.has(x)) hit++;
  return (2 * hit) / (A.size + B.size);
}
function containment(a: string, b: string): boolean {
  const [x, y] = a.length <= b.length ? [a, b] : [b, a];
  return x.length >= 8 && y.includes(x);
}

const surnameOnly = [
  /^(dj|mc|mr|mrs|dr|the)\s+/i,
];

function keysOf(name: string): string[] {
  const n = normalizeEntityName(name);
  const bases = new Set<string>([n.primaryKey, n.secondaryKey, n.articlelessPrimaryKey, n.articlelessSecondaryKey, n.compactPrimaryKey, n.compactSecondaryKey]);
  for (const re of surnameOnly) {
    const stripped = name.replace(re, "").trim();
    if (stripped && stripped !== name) {
      const m = normalizeEntityName(stripped);
      bases.add(m.compactSecondaryKey);
      bases.add(m.articlelessSecondaryKey);
    }
  }
  return [...bases].filter(Boolean);
}

async function main() {
  const rows: Candidato[] = readFileSync(IN, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l) as Candidato);
  const pool = getPool();
  const map = new Map<string, { kind: "artist" | "person"; id: number; name: string }>();
  const artists: Array<{ id: number; name: string; city: string | null; key: string }> = [];
  const add = (kind: "artist" | "person", id: number, name: string) => {
    for (const k of keysOf(name)) if (!map.has(k)) map.set(k, { kind, id, name });
  };
  for (const r of (await pool.query<{ id: string; name: string; origin_city: string | null }>("SELECT id::text,name,origin_city FROM public.artists")).rows) {
    add("artist", Number(r.id), r.name);
    artists.push({ id: Number(r.id), name: r.name, city: r.origin_city, key: normalizeEntityName(r.name).compactSecondaryKey });
  }
  for (const r of (await pool.query<{ artist_id: string; alias: string }>("SELECT artist_id::text,alias FROM ingest.artist_aliases")).rows) add("artist", Number(r.artist_id), r.alias);
  for (const r of (await pool.query<{ id: string; name: string }>("SELECT id::text,name FROM public.persons")).rows) add("person", Number(r.id), r.name);
  for (const r of (await pool.query<{ person_id: string; alias: string }>("SELECT person_id::text,alias FROM ingest.person_aliases")).rows) add("person", Number(r.person_id), r.alias);

  const out = rows.map((c) => {
    const name = displayName(c.name);
    let hit: { kind: "artist" | "person"; id: number; name: string } | undefined;
    for (const k of keysOf(name)) { const h = map.get(k); if (h) { hit = h; break; } }
    const personCheck = hit ? null : classifyPersonName(name);
    let fuzzy: { id: number; name: string; city: string | null; dice: number; contiene: boolean } | null = null;
    if (!hit) {
      const k = normalizeEntityName(name).compactSecondaryKey;
      let best = { id: 0, name: "", city: null as string | null, dice: 0, contiene: false };
      for (const a of artists) {
        const d = dice(k, a.key);
        const c = containment(k, a.key);
        if (d > best.dice || (c && !best.contiene)) best = { id: a.id, name: a.name, city: a.city, dice: d, contiene: c };
      }
      if (best.dice >= 0.6 || best.contiene) fuzzy = best;
    }
    return {
      name, uri: c.uri, page: `${c.dir}/${c.page}`, tier: c.tier, why: c.why,
      location: c.location ?? c.find_more ?? "", loc_city: c.loc_city ?? null, loc_state: c.loc_state ?? null,
      loc_country: c.loc_country ?? null, style: c.style ?? null, plays: c.plays ?? null,
      tiene: Boolean(hit), match_kind: hit?.kind ?? null, match_id: hit?.id ?? null, match_name: hit?.name ?? null,
      probable_persona: personCheck && personCheck.kind !== "ok" ? personCheck.kind : null,
      fuzzy,
      ficha: {
        description: c.description ?? null, history: c.history ?? null, members: c.members ?? null,
        instruments: c.instruments ?? null, albums: c.albums ?? null, influences: c.influences ?? null, similar: c.similar ?? null,
      },
    };
  });

  writeFileSync(path.join(OUT, "cruce.jsonl"), out.map((o) => JSON.stringify(o)).join("\n") + "\n");
  const csv = ["tiene,nivel,nombre,ciudad,estado,coincide_con,id,uri,motivo"];
  for (const o of out) csv.push([o.tiene ? "SI" : "NO", o.tier, JSON.stringify(o.name), JSON.stringify(o.loc_city ?? ""), JSON.stringify(o.loc_state ?? ""), JSON.stringify(o.match_name ?? ""), o.match_id ?? "", JSON.stringify(o.uri ?? ""), JSON.stringify(o.why)].join(","));
  writeFileSync(path.join(OUT, "cruce.csv"), csv.join("\n") + "\n");

  const faltan = out.filter((o) => !o.tiene);
  const porTier = (t: string) => faltan.filter((o) => o.tier === t).length;
  console.log(JSON.stringify({
    candidatos: out.length, ya_estan: out.length - faltan.length, faltantes: faltan.length,
    faltantes_por_nivel: { A: porTier("A"), B: porTier("B"), C: porTier("C") },
    faltantes_artista_ya_persona: faltan.filter((o) => o.match_kind === "person").length,
  }, null, 2));
  await closeDb();
}

main();
