// CRV · Plan del primo, etapa 1 (punto 1): pasada del detector de artistas parecidos con la regla
// nueva «variante_de_nombre» (número en cifra o letra; «La Banda de…», «… - La Banda»). Lista los
// pares que solo junta esa regla, con sus discos, para decidir: lo claro se fusiona, lo dudoso queda
// en la cola de Curaduría (el detector lo emite en cada análisis).
import { closeDb, getPool } from "../src/db/client.js";
import { bandVariantKey } from "../src/curation/detectors/duplicates.js";
import { compactKey } from "../src/curation/lexicon.js";

const pool = getPool();
const rows = (await pool.query<{ id: string; name: string; albums: string; type: string }>(
  `SELECT a.id::text, a.name, a.artist_type::text AS type,
          coalesce((SELECT string_agg(al.title || ' (' || coalesce(al.release_year::text, '?') || ')', '; ' ORDER BY al.release_year) FROM public.albums al WHERE al.artist_id = a.id), '') AS albums
     FROM public.artists a`)).rows;
const groups = new Map<string, typeof rows>();
for (const row of rows) {
  const key = bandVariantKey(row.name.replace(/\s*\([^()]*\)\s*$/u, ""));
  if (key.length < 2) continue;
  groups.set(key, [...(groups.get(key) ?? []), row]);
}
for (const [key, group] of groups) {
  if (group.length < 2) continue;
  if (new Set(group.map((row) => compactKey(row.name))).size === 1) continue; // ya lo junta una regla anterior
  console.log(`\n${key}`);
  for (const row of group) console.log(`  ${row.id}\t${row.name}\t[${row.type}]\t${row.albums.slice(0, 160)}`);
}
await closeDb();
