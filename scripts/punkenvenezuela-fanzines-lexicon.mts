// Lexicón del catálogo para cotejar fuentes externas (solo lectura).
// Uso: ./scripts/with-node22.sh tsx scripts/punkenvenezuela-fanzines-lexicon.mts <salida.jsonl>
import { closeDb, getPool } from "../src/db/client.js";
import { createWriteStream } from "node:fs";

const out = process.argv[2] || "/tmp/crv-lexicon.jsonl";
const ws = createWriteStream(out, { encoding: "utf8" });
const pool = getPool();

const artists = await pool.query(
  `SELECT id, name, artist_type, origin_city, formed_year, disbanded_year, status
     FROM public.artists ORDER BY id`);
for (const r of artists.rows) {
  ws.write(JSON.stringify({ kind: "artist", ...r }) + "\n");
}

const aliases = await pool.query(
  `SELECT a.artist_id, a.alias, a.alias_type FROM ingest.artist_aliases a ORDER BY a.artist_id`);
for (const r of aliases.rows) {
  ws.write(JSON.stringify({ kind: "alias", ...r }) + "\n");
}

const persons = await pool.query(`SELECT id, name FROM public.persons ORDER BY id`);
for (const r of persons.rows) {
  ws.write(JSON.stringify({ kind: "person", ...r }) + "\n");
}

await new Promise((res) => ws.end(res));
console.log(JSON.stringify({
  out,
  artists: artists.rowCount,
  aliases: aliases.rowCount,
  persons: persons.rowCount,
}));
await closeDb();
