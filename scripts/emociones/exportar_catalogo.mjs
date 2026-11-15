// Instantánea de SOLO LECTURA del catálogo para la emoción de respaldo (no escribe en la base).
// Uso: node scripts/emociones/exportar_catalogo.mjs <dir-salida>
// Escribe <dir>/catalogo.json: géneros (slug, padre), discos (artista, géneros confirmados, ficha RYM aceptada)
// y géneros confirmados de artistas.
import fs from "node:fs";
import path from "node:path";
import pg from "pg";

const env = Object.fromEntries(
  fs.readFileSync(path.join(process.cwd(), ".env"), "utf8").split("\n")
    .filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
);
const out = process.argv[2];
if (!out) throw new Error("falta el directorio de salida");
const c = new pg.Client({ connectionString: env.DATABASE_URL });
await c.connect();
await c.query("SET TRANSACTION READ ONLY").catch(() => {});
const q = async (sql) => (await c.query(sql)).rows;
const generos = await q(`SELECT g.id::int, g.slug, g.name, g.level, p.slug AS parent
  FROM ingest.genres g LEFT JOIN ingest.genres p ON p.id = g.parent_genre_id WHERE g.active`);
const discos = await q(`SELECT a.id::int, a.artist_id::int AS artist, a.title FROM public.albums a`);
const ag = await q(`SELECT album_id::int AS id, genre_id::int AS g, role FROM ingest.album_genres WHERE status = 'confirmed'`);
const rg = await q(`SELECT artist_id::int AS id, genre_id::int AS g, role FROM ingest.artist_genres WHERE status = 'confirmed'`);
const rym = await q(`SELECT DISTINCT ON (c.album_id) c.album_id::int AS id, e.url
  FROM ingest.claims c JOIN ingest.claim_evidence e ON e.claim_id = c.id
  WHERE c.field = 'title' AND c.status = 'accepted' AND e.url ILIKE '%rateyourmusic.com/release/%'
  ORDER BY c.album_id, c.id DESC`);
await c.end();
const porDisco = {};
for (const r of ag) (porDisco[r.id] ??= []).push([r.g, r.role]);
const porArtista = {};
for (const r of rg) (porArtista[r.id] ??= []).push([r.g, r.role]);
const url = Object.fromEntries(rym.map((r) => [r.id, r.url]));
const data = {
  exportado: new Date().toISOString(),
  generos,
  discos: discos.map((d) => ({ ...d, generos: porDisco[d.id] ?? [], rym: url[d.id] ?? null })),
  artistas: porArtista,
};
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, "catalogo.json"), JSON.stringify(data));
console.log(`géneros ${generos.length} · discos ${discos.length} · con géneros ${Object.keys(porDisco).length} · con RYM ${rym.length} · artistas con géneros ${Object.keys(porArtista).length}`);
