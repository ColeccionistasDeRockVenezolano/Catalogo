// Enlaces de Spotify de las capturas confirmadas del lote sin foto (2026-10-14), en UN run
// reversible: el perfil del artista y, para los venezolanos (los que recibieron su discografía),
// cada disco del catálogo cuyo título es idéntico a un lanzamiento capturado. Nunca pisa un
// enlace verificado ni uno escrito a mano.
//
// Uso: ./scripts/with-node22.sh npx tsx ops/spotify-diario/enlaces-lote.ts [--confirm]
import { readFileSync, writeFileSync } from "node:fs";
import { closeDb, getPool } from "../../src/db/client.js";
import { withOperatorRun } from "../../src/merge/operator.js";

const DIR = "reports/spotify-lote-2026-10-03/identidad";
const confirm = process.argv.includes("--confirm");

interface Identidad { artist_id: number; name: string; spotify: string; spotify_id: string; dir: string; veredicto: string; por: string; venezolano: boolean }
type Fila = { artistId: number | null; albumId: number | null; url: string; externalId: string; nota: string };

const norm = (value: string) => value.normalize("NFD").replace(/\p{Mn}/gu, "").toLowerCase().replace(/&/gu, " y ")
  .replace(/[^\p{L}\p{N}]+/gu, " ").trim();

async function main(): Promise<void> {
  const pool = getPool();
  const confirmados = (JSON.parse(readFileSync(`${DIR}/identidad.json`, "utf8")) as Identidad[]).filter((x) => x.veredicto === "confirmado");
  const intocable = new Set((await pool.query<{ k: string }>(`
    SELECT CASE WHEN album_id IS NOT NULL THEN 'd:' || album_id ELSE 'a:' || artist_id END AS k
      FROM public.streaming_links WHERE platform = 'spotify' AND (verified OR source = 'crv-operador')`)).rows.map((r) => r.k));
  const filas: Fila[] = [];
  for (const x of confirmados) {
    if (!intocable.has(`a:${x.artist_id}`)) {
      filas.push({ artistId: x.artist_id, albumId: null, url: `https://open.spotify.com/artist/${x.spotify_id}`, externalId: x.spotify_id,
        nota: `perfil confirmado contra el catálogo (${x.por}) · perfil: «${x.spotify}»` });
    }
    if (!x.venezolano) continue;
    const lanzamientos = new Map((JSON.parse(readFileSync(`${x.dir}/albums.json`, "utf8")) as Array<{ id: string; name: string; release_date: string }>)
      .map((a) => [norm(a.name), a]));
    const discos = (await pool.query<{ id: string; title: string }>("SELECT id::text, title FROM public.albums WHERE artist_id = $1", [x.artist_id])).rows;
    for (const d of discos) {
      const a = lanzamientos.get(norm(d.title));
      if (!a || intocable.has(`d:${d.id}`)) continue;
      filas.push({ artistId: null, albumId: Number(d.id), url: `https://open.spotify.com/album/${a.id}`, externalId: a.id,
        nota: `título idéntico · disco: «${a.name}» (${a.release_date.slice(0, 4)})` });
    }
  }
  console.log(`filas ${filas.length}: perfiles ${filas.filter((f) => f.artistId).length} · discos ${filas.filter((f) => f.albumId).length}`);
  if (!confirm) { await closeDb(); return; }
  const { runId, result } = await withOperatorRun({
    name: "claude-code:spotify-lote-enlaces",
    operator: "claude-code (delegado por Brian)",
    note: "Enlaces de Spotify de las capturas del lote sin foto confirmadas contra el catálogo (pistas, discos o bio en común, o perfil ya verificado); Brian 2026-10-14: «implementa todo».",
  }, async (context) => {
    let escritas = 0;
    for (const f of filas) {
      const col = f.artistId ? "artist_id" : "album_id";
      const { rowCount } = await context.client.query(`
        INSERT INTO public.streaming_links(artist_id, album_id, platform, url, external_id, method, source, verified, notes)
        VALUES($1,$2,'spotify',$3,$4,'exact','spotify-lote-confirmado',true,$5)
        ON CONFLICT (${col}, platform) WHERE ${col} IS NOT NULL
        DO UPDATE SET url=EXCLUDED.url, external_id=EXCLUDED.external_id, method=EXCLUDED.method,
          source=EXCLUDED.source, verified=true, notes=EXCLUDED.notes
        WHERE NOT streaming_links.verified AND streaming_links.source <> 'crv-operador'`,
      [f.artistId, f.albumId, f.url, f.externalId, f.nota]);
      escritas += rowCount ?? 0;
    }
    return { escritas };
  });
  writeFileSync(`${DIR}/enlaces-run${runId}.json`, JSON.stringify({ runId, filas: filas.length, ...result }, null, 1));
  console.log(`run ${runId}: ${result.escritas} enlaces`);
  await closeDb();
}

main().catch(async (error: unknown) => { console.error(error); await closeDb(); process.exit(1); });
