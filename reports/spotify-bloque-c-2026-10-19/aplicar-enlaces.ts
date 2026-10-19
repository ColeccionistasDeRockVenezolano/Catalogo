// Enlaces de Spotify del bloque C confirmados por la web CON SESIÓN (2026-10-19), en UN run
// reversible. Solo perfiles de artista confirmados por repertorio: una pista del catálogo aparece
// entre los top tracks del perfil, o un disco coincide por título (y año ±1).
// Nunca pisa un enlace verificado ni uno escrito a mano.
//
// Uso: ./scripts/with-node22.sh npx tsx reports/spotify-bloque-c-2026-10-19/aplicar-enlaces.ts [--confirm]
import { readFileSync, writeFileSync } from "node:fs";
import { closeDb, getPool } from "../../src/db/client.js";
import { withOperatorRun } from "../../src/merge/operator.js";

const DIR = "reports/spotify-bloque-c-2026-10-19";
const RESULTADOS = `${DIR}/resultados-sesion.jsonl`;
const confirm = process.argv.includes("--confirm");

interface Resultado {
  artistId: number; name: string; hallado: boolean | null; motivo: string;
  spotifyId?: string; spotifyName?: string; via?: string; pistas?: string[]; albumes?: string[]; oyentes?: number | null;
}

const norm = (value: string) => value.normalize("NFD").replace(/\p{Mn}/gu, "").toLowerCase()
  .replace(/&/gu, " y ").replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/** Mismo nombre, o uno contenido en el otro por palabras (ignora iniciales sueltas: «Luis G. Tovar» = «Luis Gerardo Tovar»). */
const palabras = (value: string): string[] => norm(value).split(" ").filter((w) => w.length > 1);
const mismoNombre = (a: string, b: string): boolean => {
  const x = palabras(a), y = palabras(b);
  if (!x.length || !y.length) return norm(a) === norm(b);
  const [corto, largo] = x.length <= y.length ? [x, y] : [y, x];
  let i = 0;
  for (const w of largo) if (w === corto[i]) i++;
  return i === corto.length;
};

async function main(): Promise<void> {
  const pool = getPool();
  const filas = readFileSync(RESULTADOS, "utf8").split("\n").filter((l) => l.trim())
    .map((l) => JSON.parse(l) as Resultado);
  const confirmados = filas.filter((r) => r.hallado === true && r.spotifyId);
  const vivos = new Set((await pool.query<{ id: string }>("SELECT id::text AS id FROM public.artists")).rows.map((r) => Number(r.id)));
  const nombreDe = new Map((await pool.query<{ id: string; name: string }>("SELECT id::text AS id, name FROM public.artists")).rows
    .map((r) => [Number(r.id), r.name]));
  const conPerfil = new Set((await pool.query<{ artist_id: string }>(
    "SELECT DISTINCT artist_id::text AS artist_id FROM public.streaming_links WHERE platform = 'spotify' AND artist_id IS NOT NULL AND verified")).rows
    .map((r) => Number(r.artist_id)));

  const aplicar: Array<{ artistId: number; url: string; externalId: string; nota: string; name: string }> = [];
  const saltados: string[] = [];
  for (const r of confirmados) {
    if (!vivos.has(r.artistId)) { saltados.push(`${r.name}: artista ya no existe`); continue; }
    if (conPerfil.has(r.artistId)) { saltados.push(`${r.name}: ya tenía perfil Spotify verificado`); continue; }
    const propio = nombreDe.get(r.artistId) ?? r.name;
    if (r.spotifyName && !mismoNombre(r.spotifyName, propio)) { saltados.push(`${r.name}: el perfil dice «${r.spotifyName}»`); continue; }
    const evidencia = [
      r.via === "pista" ? `pistas en común: ${(r.pistas ?? []).join(", ")}` : `discos en común: ${(r.albumes ?? []).join(", ")}`,
      r.oyentes != null ? `${r.oyentes} oyentes` : null,
      `perfil: «${r.spotifyName}»`,
    ].filter(Boolean).join(" · ");
    aplicar.push({ artistId: r.artistId, url: `https://open.spotify.com/artist/${r.spotifyId}`, externalId: r.spotifyId!, nota: evidencia, name: propio });
  }
  console.log(`confirmados ${confirmados.length} · a aplicar ${aplicar.length} · saltados ${saltados.length}`);
  for (const s of saltados) console.log("  saltado:", s);
  writeFileSync(`${DIR}/aplicacion-ensayo.json`, JSON.stringify({ confirmados: confirmados.length, aplicar, saltados }, null, 1));
  if (!confirm) { await closeDb(); return; }

  const { runId, result } = await withOperatorRun({
    name: "hermes:spotify-bloque-c-web",
    operator: "hermes (Brian)",
    note: "Perfiles de Spotify del bloque C confirmados por la web con sesión: pista del catálogo entre los top tracks del perfil o disco con título y año. Brian 2026-10-19: «vuelve a intentar lo que falta».",
  }, async (context) => {
    let escritas = 0;
    for (const f of aplicar) {
      const { rowCount } = await context.client.query(`
        INSERT INTO public.streaming_links(artist_id, platform, url, external_id, method, source, verified, notes)
        VALUES($1,'spotify',$2,$3,'exact','spotify-web-sesion',true,$4)
        ON CONFLICT (artist_id, platform) WHERE artist_id IS NOT NULL
        DO UPDATE SET url=EXCLUDED.url, external_id=EXCLUDED.external_id, method=EXCLUDED.method,
          source=EXCLUDED.source, verified=true, notes=EXCLUDED.notes
        WHERE NOT streaming_links.verified AND streaming_links.source <> 'crv-operador'`,
      [f.artistId, f.url, f.externalId, f.nota]);
      escritas += rowCount ?? 0;
    }
    return { escritas };
  });
  writeFileSync(`${DIR}/aplicacion-run${runId}.json`, JSON.stringify({ runId, filas: aplicar.length, ...result }, null, 1));
  console.log(`run ${runId}: ${result.escritas} enlaces`);
  await closeDb();
}

main().catch(async (error: unknown) => { console.error(error); await closeDb(); process.exit(1); });
