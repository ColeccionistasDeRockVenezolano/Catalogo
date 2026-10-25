// Auditoría de una ficha de artista sospechosa de mezclar dos bandas homónimas.
// SOLO LECTURA: no escribe nada. Reúne en una sola salida lo que a mano son ~10 consultas:
//   · la fila del artista (ciudad, años, estado, temas, foto, email),
//   · todos sus claims con la URL de evidencia (procedencia de cada valor),
//   · el historial de cambios de los campos clave (quién puso qué y en qué run),
//   · integrantes, discos (con pistas y enlaces), géneros, redes y escuchas,
//   · las otras fichas con el mismo nombre (homónimos) y
//   · las filas de la captura local de Metal Archives que casan por nombre.
//
// Uso: ./scripts/with-node22.sh npx tsx scripts/auditar-ficha.mts --artist=748 [--json]
//      [--ma=data/raw/metal-archives-ve-2026-10-01/band-details-full.jsonl]
import { existsSync, readFileSync } from "node:fs";
import { closeDb, getPool } from "../src/db/client.js";

const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const artistId = Number(arg("artist"));
const MA = arg("ma") ?? "data/raw/metal-archives-ve-2026-10-01/band-details-full.jsonl";
const asJson = process.argv.includes("--json");
if (!Number.isInteger(artistId) || artistId <= 0) {
  console.error("uso: auditar-ficha.mts --artist=<id> [--json]");
  process.exit(2);
}

const pool = getPool();
const q = async <T extends Record<string, unknown>>(sql: string, params: unknown[] = []) => (await pool.query<T>(sql, params)).rows;
const norm = (t: string) => t.normalize("NFD").replace(/[\u0300-\u036f]/gu, "").toLowerCase().replace(/[^a-z0-9]+/gu, "");
const baseName = (t: string) => norm(t.replace(/\s*\(.*\)$/u, ""));

const [artist] = await q<Record<string, unknown>>(
  `SELECT id, name, artist_type, origin_city, origin_country, formed_year, disbanded_year, status, years_active,
          themes, email, picture_url, logo_url, length(biography) AS bio_len, left(biography, 400) AS bio_head
     FROM public.artists WHERE id=$1`, [artistId]);
if (!artist) {
  console.error(`artista ${artistId} inexistente`);
  await closeDb();
  process.exit(1);
}

const [claims, audit, members, albums, genres, social, streaming, homonyms] = await Promise.all([
  q(`SELECT c.id, c.field, c.status, s.slug AS source, c.raw_value #>> '{}' AS value,
            (SELECT e.url FROM ingest.claim_evidence e WHERE e.claim_id=c.id ORDER BY e.id LIMIT 1) AS evidence
       FROM ingest.claims c JOIN ingest.sources s ON s.id=c.source_id
      WHERE c.entity_kind='artist' AND c.artist_id=$1 ORDER BY c.field, c.id`, [artistId]),
  q(`SELECT id, run_id, performed_by, left(reason, 90) AS reason, left(old_value::text, 70) AS old_value, left(new_value::text, 70) AS new_value
       FROM ingest.merge_audit
      WHERE entity_kind='artist' AND artist_id=$1 AND field IN ('biography','name','origin_city','formed_year','disbanded_year','years_active','status','themes','picture_url','logo_url')
      ORDER BY id DESC LIMIT 25`, [artistId]),
  q(`SELECT m.id AS member_id, m.person_id, p.name, m.role, m.from_year, m.to_year, m.is_current
       FROM public.artist_members m JOIN public.persons p ON p.id=m.person_id WHERE m.artist_id=$1 ORDER BY m.id`, [artistId]),
  q(`SELECT al.id, al.title, al.release_year, al.album_type,
            (SELECT count(*) FROM public.tracks t WHERE t.album_id=al.id) AS tracks,
            (SELECT string_agg(platform||':'||url, ' | ') FROM public.streaming_links l WHERE l.album_id=al.id) AS links
       FROM public.albums al WHERE al.artist_id=$1 ORDER BY al.release_year NULLS LAST, al.id`, [artistId]),
  q(`SELECT x.name, g.role, g.status FROM ingest.artist_genres g JOIN ingest.genres x ON x.id=g.genre_id WHERE g.artist_id=$1 ORDER BY g.role DESC, x.name`, [artistId]),
  q(`SELECT platform, url, source, method, verified FROM public.social_links WHERE artist_id=$1 ORDER BY platform`, [artistId]),
  q(`SELECT platform, url, external_id, source, method, verified FROM public.streaming_links WHERE artist_id=$1 ORDER BY platform`, [artistId]),
  q(`SELECT id, name, origin_city, formed_year, disbanded_year, status,
            (SELECT count(*) FROM public.albums al WHERE al.artist_id=a.id) AS albums,
            (SELECT count(*) FROM public.artist_members m WHERE m.artist_id=a.id) AS members
       FROM public.artists a WHERE id<>$1 ORDER BY id`, [artistId]),
]);

// Captura local de Metal Archives (si está): filas cuyo nombre casa, con ciudad y plantilla.
let maRows: Array<Record<string, unknown>> = [];
if (existsSync(MA)) {
  const target = baseName(String(artist["name"]));
  for (const line of readFileSync(MA, "utf8").split("\n")) {
    if (!line.trim()) continue;
    const row = JSON.parse(line) as Record<string, unknown>;
    if (norm(String(row["name"] ?? "")) !== target) continue;
    maRows.push({
      ma_id: row["ma_id"], name: row["name"], location: row["location"], formed_in: row["formed_in"],
      years_active: row["years_active"], status: row["status"], genre: row["genre"], themes: row["themes"],
      bio: row["bio"], current: (row["lineup_current"] as Array<{ name: string; role: string }> | undefined)?.map((p) => `${p.name} — ${p.role}`),
      past: (row["lineup_past"] as Array<{ name: string; role: string }> | undefined)?.map((p) => `${p.name} — ${p.role}`),
      discography: (row["discography"] as Array<{ title: string; year: string; type: string }> | undefined)?.map((d) => `${d.title} (${d.year}, ${d.type})`),
      photo_url: row["photo_url"], logo_url: row["logo_url"],
    });
  }
}

const miBase = baseName(String(artist["name"]));
const homonimos = homonyms.filter((h) => {
  const suyo = baseName(String(h["name"]));
  return suyo === miBase || suyo.startsWith(miBase) || miBase.startsWith(suyo) || suyo.includes(miBase);
});

const informe = { artist, claims, audit, members, albums, genres, social, streaming, homonimos, metalArchives: maRows };
if (asJson) {
  console.log(JSON.stringify(informe, null, 1));
} else {
  const line = (title: string) => console.log(`\n=== ${title}`);
  line(`artista ${artist["id"]} · ${artist["name"]}`);
  console.log(JSON.stringify(artist, null, 1));
  line(`claims (${claims.length})`);
  for (const c of claims) console.log(`${c["field"]} | ${c["status"]} | ${c["source"]} | ${String(c["value"] ?? "").slice(0, 60)} | ${c["evidence"] ?? "-"}`);
  line(`historial (${audit.length}, los más recientes primero)`);
  for (const a of audit) console.log(`run ${a["run_id"]} · ${a["performed_by"]} · ${a["reason"]} :: ${String(a["old_value"] ?? "null").slice(0, 50)} → ${String(a["new_value"] ?? "null").slice(0, 50)}`);
  line(`integrantes (${members.length})`);
  for (const m of members) console.log(`${m["name"]} — ${m["role"]} (${m["from_year"] ?? "?"}-${m["to_year"] ?? ""}) actual=${m["is_current"]}`);
  line(`discos (${albums.length})`);
  for (const a of albums) console.log(`${a["id"]} · ${a["title"]} · ${a["release_year"] ?? "-"} · ${a["album_type"]} · ${a["tracks"]} pistas · ${a["links"] ?? "sin enlaces"}`);
  line("géneros");
  for (const g of genres) console.log(`${g["name"]} · ${g["role"]} · ${g["status"]}`);
  line("redes / escuchas");
  for (const s of [...social, ...streaming]) console.log(`${s["platform"]} · ${s["url"]} · fuente=${s["source"] ?? "-"} · método=${s["method"] ?? "-"}`);
  line(`homónimos (${homonimos.length})`);
  for (const h of homonimos) console.log(`${h["id"]} · ${h["name"]} · ${h["origin_city"] ?? "-"} · ${h["formed_year"] ?? "-"}-${h["disbanded_year"] ?? "-"} · ${h["albums"]} discos · ${h["members"]} miembros`);
  line(`Metal Archives en la captura local (${maRows.length})`);
  for (const m of maRows) console.log(`${m["ma_id"]} · ${m["location"]} · formada ${m["formed_in"]} · activa ${m["years_active"]} · ${m["status"]} · ${m["genre"]} :: ${String(m["bio"] ?? "").slice(0, 80)}`);
}

await closeDb();
