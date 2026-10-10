// CRV · Personas con dos épocas separadas ≥20 años sin proyecto ni colegas en
// común (caso Víctor Valerio, Brian 2026-10-06): probables homónimos
// fusionados. No va a Curaduría porque también marca a veteranos reales (no
// llega al 90 % de precisión); es una lista para verificar en fuentes, ficha
// por ficha, antes de separar con scripts/split-person-by-era.ts.
// Las fusiones nuevas de este tipo ya no ocurren: las frena src/merge/era-guard.ts.
//
//   ./scripts/with-node22.sh npx tsx scripts/report-epocas-sin-vinculo.ts [--out=reports/epocas-sin-vinculo-AAAA-MM-DD]
import { writeFileSync } from "node:fs";
import { closeDb, getPool } from "../src/db/client.js";
import { eraSplit, type EraSide } from "../src/curation/person-timeline.js";
import { loadPersonTimelines } from "../src/merge/era-guard.js";

const today = new Date().toISOString().slice(0, 10);
const OUT = process.argv.find((arg) => arg.startsWith("--out="))?.slice(6) ?? `reports/epocas-sin-vinculo-${today}`;
const pool = getPool();

const { rows: people } = await pool.query<{ id: string; name: string }>("SELECT id::text, name FROM public.persons ORDER BY id");
const names = new Map(people.map((row) => [Number(row.id), row.name]));
const { rows: artistRows } = await pool.query<{ id: string; name: string }>("SELECT id::text, name FROM public.artists");
const artists = new Map(artistRows.map((row) => [Number(row.id), row.name]));
const { rows: pairs } = await pool.query<{ album_id: string; person_id: string }>(`
  SELECT album_id::text, person_id::text FROM public.album_credits WHERE person_id IS NOT NULL
  UNION SELECT t.album_id::text, c.person_id::text FROM public.track_credits c JOIN public.tracks t ON t.id=c.track_id WHERE c.person_id IS NOT NULL`);
const onAlbum = new Map<number, Set<number>>();
for (const row of pairs) {
  const album = Number(row.album_id);
  (onAlbum.get(album) ?? onAlbum.set(album, new Set()).get(album)!).add(Number(row.person_id));
}
const colleagues = (albumIds: number[]) => new Set(albumIds.flatMap((id) => [...(onAlbum.get(id) ?? [])]));

const timelines = await loadPersonTimelines(pool, [...names.keys()], { colleagues: false });
const side = (s: EraSide) => ({
  años: s.from === s.to ? `${s.from}` : `${s.from}–${s.to}`, roles: s.families,
  artistas: s.artistIds.map((id) => artists.get(id) ?? `#${id}`),
  creditos: s.events.slice(0, 12).map((event) => `${event.source}:${event.refId}`),
});
const rows = [...timelines.values()].flatMap(({ timeline }) => {
  const split = eraSplit(timeline, colleagues);
  if (!split) return [];
  const rolesChange = !split.before.families.some((family) => split.after.families.includes(family));
  return [{ persona: timeline.personId, nombre: names.get(timeline.personId), hueco: split.gap, cambiaDeRol: rolesChange,
    colegasComunes: split.sharedColleagues, antes: side(split.before), despues: side(split.after), veredicto: null as string | null }];
}).sort((a, b) => Number(b.cambiaDeRol) - Number(a.cambiaDeRol) || b.hueco - a.hueco);

writeFileSync(`${OUT}.json`, `${JSON.stringify({ generado: new Date().toISOString(), total: rows.length, filas: rows }, null, 2)}\n`);
const md = [
  `# Personas con dos épocas sin vínculo (${today})`, "",
  `${rows.length} fichas con un hueco de ≥20 años sin artista ni ≥2 colegas en común. Verificar en fuentes antes de separar.`, "",
  "| Persona | Hueco | Antes | Después | Cambia de rol |", "|---|---|---|---|---|",
  ...rows.map((row) => `| ${row.persona} ${row.nombre} | ${row.hueco} | ${row.antes.años} ${row.antes.artistas.slice(0, 3).join(", ")} | ${row.despues.años} ${row.despues.artistas.slice(0, 3).join(", ")} | ${row.cambiaDeRol ? "sí" : ""} |`),
].join("\n");
writeFileSync(`${OUT}.md`, `${md}\n`);
console.log(JSON.stringify({ total: rows.length, cambiaDeRol: rows.filter((row) => row.cambiaDeRol).length, out: OUT }));
await closeDb();
