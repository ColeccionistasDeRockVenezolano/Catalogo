// Aplica la cosecha de reproductores (scripts/streaming-embeds-cosecha.py, 2026-10-13) a
// `public.streaming_links` en UN run reversible (diario 0028): discos de Spotify, YouTube Music,
// Bandcamp y Tidal, más los perfiles que esos discos confirman.
//
// Uso: ./scripts/with-node22.sh npx tsx scripts/apply-streaming-embeds.ts \
//        reports/streaming-embeds-2026-10-13 [--confirm]
//
// Reglas:
//   * La cosecha ya casó por nombre de artista exacto + título idéntico; aquí todo entra
//     verified=true y la nota guarda el título y el año de la plataforma (reedición de otro año).
//   * Nunca pisa un enlace ya verificado ni uno escrito a mano (source «crv-operador»); un
//     candidato sin verificar de la campaña anterior sí se reemplaza.
//   * Valida contra la BD viva: el artista existe y el disco sigue siendo suyo (las fusiones
//     mueven ids entre el volcado y la aplicación).
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { closeDb, getPool } from "../src/db/client.js";
import { withOperatorRun } from "../src/merge/operator.js";

interface AlbumLink { albumId: number; url: string; id: string; title_plat: string; year_plat: number | null }
interface ArtistLink { url: string; id: string | null; name_plat?: string | null; comunes: number }
interface Cosecha { artistId: number; name: string; artist_link: ArtistLink | null; album_links: AlbumLink[] }

const DIR = process.argv.slice(2).find((value) => !value.startsWith("--")) ?? "reports/streaming-embeds-2026-10-13";
const confirm = process.argv.includes("--confirm");
const FUENTES = [
  { dir: "spotify", platform: "spotify", source: "spotify-search-album" },
  { dir: "ytmusic", platform: "youtube_music", source: "ytmusic-search" },
  { dir: "bandcamp", platform: "bandcamp", source: "bandcamp-music" },
  { dir: "tidal", platform: "tidal", source: "tidal-search" },
] as const;

type Fila = { artistId: number | null; albumId: number | null; platform: string; url: string; externalId: string | null; source: string; nota: string };

async function main(): Promise<void> {
  const pool = getPool();
  const vivos = new Set((await pool.query<{ id: string }>("SELECT id::text AS id FROM public.artists")).rows.map((r) => Number(r.id)));
  const albumDe = new Map((await pool.query<{ id: string; artist_id: string; release_year: number | null }>(
    "SELECT id::text AS id, artist_id::text AS artist_id, release_year FROM public.albums")).rows.map((r) => [Number(r.id), { artistId: Number(r.artist_id), year: r.release_year }]));
  // Lo que no se toca: enlaces verificados o escritos a mano.
  const intocable = new Set((await pool.query<{ k: string }>(`
    SELECT CASE WHEN album_id IS NOT NULL THEN 'd:' || album_id ELSE 'a:' || artist_id END || ':' || platform AS k
      FROM public.streaming_links WHERE verified OR source = 'crv-operador'`)).rows.map((r) => r.k));

  const filas: Fila[] = [];
  const cuenta: Record<string, number> = {};
  const sumar = (k: string) => { cuenta[k] = (cuenta[k] ?? 0) + 1; };
  for (const fuente of FUENTES) {
    const dir = path.join(DIR, fuente.dir);
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir).filter((name) => name.startsWith("a-") && name.endsWith(".json"))) {
      const d = JSON.parse(readFileSync(path.join(dir, f), "utf8")) as Cosecha;
      if (!vivos.has(d.artistId)) { sumar(`${fuente.platform}: artista ya no existe`); continue; }
      for (const l of d.album_links) {
        const disco = albumDe.get(l.albumId);
        if (!disco || disco.artistId !== d.artistId) { sumar(`${fuente.platform}: disco movido o retirado`); continue; }
        if (intocable.has(`d:${l.albumId}:${fuente.platform}`)) { sumar(`${fuente.platform}: disco ya verificado`); continue; }
        const otroAno = l.year_plat && disco.year && l.year_plat !== disco.year ? ` (${l.year_plat}; reedición de otro año)` : l.year_plat ? ` (${l.year_plat})` : "";
        filas.push({ artistId: null, albumId: l.albumId, platform: fuente.platform, url: l.url, externalId: l.id, source: fuente.source,
          nota: `título idéntico · disco: «${l.title_plat}»${otroAno}` });
      }
      const a = d.artist_link;
      if (a && fuente.platform !== "bandcamp") {
        if (intocable.has(`a:${d.artistId}:${fuente.platform}`)) { sumar(`${fuente.platform}: perfil ya verificado`); continue; }
        filas.push({ artistId: d.artistId, albumId: null, platform: fuente.platform, url: a.url, externalId: a.id, source: fuente.source,
          nota: `perfil confirmado por ${a.comunes} disco(s) en común${a.name_plat ? ` · perfil: «${a.name_plat}»` : ""}` });
      }
    }
  }

  const resumen: Record<string, number> = {};
  for (const f of filas) { const k = `${f.albumId ? "disco" : "artista"}:${f.platform}`; resumen[k] = (resumen[k] ?? 0) + 1; }
  console.log(`filas ${filas.length}`);
  for (const [k, v] of Object.entries(resumen).sort()) console.log(`  ${k.padEnd(24)} ${v}`);
  for (const [k, v] of Object.entries(cuenta).sort()) console.log(`  ${k}: ${v}`);
  if (!confirm) {
    writeFileSync(path.join(DIR, "aplicacion-ensayo.json"), JSON.stringify({ filas: filas.length, resumen, cuenta }, null, 2));
    console.log("dry-run: ejecuta con --confirm");
    await closeDb();
    return;
  }

  const { runId, result } = await withOperatorRun({
    name: "claude-code:streaming-embeds",
    operator: "claude-code (delegado por Brian)",
    note: "Reproductores por plataforma (Brian 2026-10-13: «deezer+tidal+spotify+ytcanal+ytmusic+soundcloud… como un switch de plataformas»): discos de Spotify, YouTube Music, Bandcamp y Tidal con nombre de artista exacto y título idéntico, y los perfiles que esos discos confirman.",
  }, async (context) => {
    let nuevos = 0, actualizados = 0;
    for (const f of filas) {
      const col = f.artistId ? "artist_id" : "album_id";
      const { rows } = await context.client.query<{ nuevo: boolean }>(`
        INSERT INTO public.streaming_links(artist_id, album_id, platform, url, external_id, method, source, verified, notes)
        VALUES($1,$2,$3,$4,$5,'exact',$6,true,$7)
        ON CONFLICT (${col}, platform) WHERE ${col} IS NOT NULL
        DO UPDATE SET url=EXCLUDED.url, external_id=EXCLUDED.external_id, method=EXCLUDED.method,
          source=EXCLUDED.source, verified=true, notes=EXCLUDED.notes
        WHERE NOT streaming_links.verified AND streaming_links.source <> 'crv-operador'
        RETURNING (xmax = 0) AS nuevo`,
      [f.artistId, f.albumId, f.platform, f.url, f.externalId, f.source, f.nota]);
      if (rows[0]?.nuevo) nuevos++; else if (rows[0]) actualizados++;
    }
    return { nuevos, actualizados };
  });
  writeFileSync(path.join(DIR, `aplicacion-run${runId}.json`), JSON.stringify({ runId, filas: filas.length, ...result, resumen, cuenta }, null, 2));
  console.log(`run ${runId}: ${result.nuevos} nuevos · ${result.actualizados} actualizados (de ${filas.length})`);
  await closeDb();
}

main().catch(async (error: unknown) => { console.error(error); await closeDb(); process.exit(1); });
