// Campaña RYM 2026-10-15 · FASE 2b: reclasifica los enlaces de YouTube que quedaron candidatos.
//
// Los vídeos de las fichas de RYM no siempre nombran el disco («3 Dueños - 🍩👻⚡️ (Album) | Video Arte»
// para el disco «Originales»), así que el título no basta. Señales que sí valen, comprobadas por
// oEmbed: el CANAL es del artista (author_name) o el título lo nombra, y el vídeo se declara
// álbum/subida completa. Con las tres → verified; si no, sigue candidato.
// Uso: ./scripts/with-node22.sh npx tsx scripts/rym-2026-10-15/10-revisar-youtube.mts [--confirm]
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { closeDb, getPool } from "../../src/db/client.js";
import { withOperatorRun } from "../../src/merge/operator.js";

// La campaña «resto» (2026-10-16) reusa esta fase: --informe apunta a su informe de enlaces.
const argumento = (nombre: string): string | undefined => {
  const i = process.argv.indexOf(nombre);
  return i < 0 ? undefined : process.argv[i + 1];
};
const INFORME = argumento("--informe") ?? "reports/rym-2026-10-15/verificacion-enlaces.json";
const DIR_SALIDA = INFORME.replace(/\/[^/]+$/u, "");
const confirm = process.argv.includes("--confirm");
const pausa = 400;

interface Fila { albumId: number; platform: string; id: string; url: string; titulo: string; tituloPlataforma: string; veredicto: string }

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

function normalizar(t: string): string {
  return (t ?? "").normalize("NFD").replace(/[\u0300-\u036f]/gu, "").toLowerCase()
    .replace(/\b(?:official|oficial|music|musica|band|banda|the|el|la|los|las)\b/gu, " ")
    .replace(/[^a-z0-9]+/gu, "");
}

const ES_ALBUM = /\((?:full\s+)?album\)|album\s+completo|\(álbum\)|full\s+album|\(cd\)|\(ep\)/iu;

async function oembed(url: string): Promise<{ title: string; author: string } | null> {
  try {
    const r = await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(url)}`, { signal: AbortSignal.timeout(20000) });
    if (!r.ok) return null;
    const d = (await r.json()) as { title?: string; author_name?: string };
    return { title: d.title ?? "", author: d.author_name ?? "" };
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  if (!existsSync(INFORME)) { console.error(`no existe ${INFORME}`); process.exit(1); }
  const informe = JSON.parse(readFileSync(INFORME, "utf8")) as { verificados: Fila[] };
  const pool = getPool();
  // El informe guarda lo REVISADO, que incluye filas ya verificadas en corridas anteriores: se
  // excluyen para no gastar peticiones ni contar de más.
  const yaVerificados = new Set((await pool.query<{ k: string }>(
    "SELECT album_id::text || '|' || url AS k FROM public.streaming_links WHERE platform='youtube' AND album_id IS NOT NULL AND verified")).rows.map((r) => r.k));
  const candidatos = informe.verificados
    .filter((f) => f.platform === "youtube" && f.url.includes("watch?v="))
    .filter((f) => !yaVerificados.has(`${f.albumId}|${f.url}`));
  console.log(`candidatos de YouTube a revisar: ${candidatos.length} (de ${informe.verificados.length} revisados en el informe)`);

  const artistas = new Map((await pool.query<{ id: string; name: string }>("SELECT id::text AS id, name FROM public.artists")).rows.map((r) => [Number(r.id), r.name]));
  const albumes = new Map((await pool.query<{ id: string; title: string; artist_id: string }>("SELECT id::text AS id, title, artist_id::text AS artist_id FROM public.albums")).rows.map((r) => [Number(r.id), r]));

  const ascender: Array<Fila & { author: string; motivo: string }> = [];
  const cuenta: Record<string, number> = {};
  const sumar = (k: string) => { cuenta[k] = (cuenta[k] ?? 0) + 1; };

  for (const f of candidatos) {
    const album = albumes.get(f.albumId);
    const artista = album ? artistas.get(Number(album.artist_id)) : undefined;
    if (!album || !artista) { sumar("sin ficha de artista/disco"); continue; }
    await dormir(pausa);
    const datos = await oembed(f.url);
    if (!datos) { sumar("oEmbed no responde"); continue; }
    const na = normalizar(artista), nt = normalizar(datos.title), nal = normalizar(album.title);
    const canalDelArtista = na.length > 2 && normalizar(datos.author).includes(na);
    const tituloNombra = na.length > 2 && (nt.includes(na) || nt.includes(nal));
    const seDeclaraAlbum = ES_ALBUM.test(datos.title);
    const vale = canalDelArtista && (tituloNombra || seDeclaraAlbum);
    if (vale) {
      ascender.push({ ...f, author: datos.author, motivo: `${canalDelArtista ? "canal del artista" : ""}${seDeclaraAlbum ? " + se declara álbum" : ""}${tituloNombra ? " + título nombra" : ""}`.trim() });
      sumar("asciende a verificado");
    } else {
      sumar(`sigue candidato (${canalDelArtista ? "canal sí" : "canal no"}${seDeclaraAlbum ? ", álbum sí" : ""})`);
    }
  }

  console.log(`ascenderían: ${ascender.length}`);
  for (const [k, v] of Object.entries(cuenta).sort()) console.log(`  ${k}: ${v}`);
  if (!confirm) { writeFileSync(`${DIR_SALIDA}/youtube-ensayo.json`, JSON.stringify(ascender.slice(0, 200), null, 1)); console.log(`dry-run: ensayo en ${DIR_SALIDA}/youtube-ensayo.json`); await closeDb(); return; }

  const { runId, result } = await withOperatorRun({
    name: "hermes:rym-youtube-verificados",
    operator: "hermes (encargo de Brian 2026-10-15)",
    note: "Enlaces de YouTube de las fichas de RYM que estaban como candidatos y pasan a verificados: el canal es del artista y el vídeo se declara álbum o nombra el disco (oEmbed).",
  }, async (context) => {
    let actualizados = 0;
    for (const f of ascender) {
      const { rowCount } = await context.client.query(`
        UPDATE public.streaming_links SET verified = true, notes = COALESCE(notes, '') || $3
         WHERE album_id = $1 AND platform = 'youtube' AND url = $2 AND NOT verified`,
      [f.albumId, f.url, ` · verificado en revisión: ${f.motivo} (canal «${f.author}», vídeo «${f.tituloPlataforma}»)`]);
      actualizados += rowCount ?? 0;
    }
    return { actualizados };
  });
  writeFileSync(`${DIR_SALIDA}/youtube-run` + runId + ".json", JSON.stringify({ runId, ...result, cuenta }, null, 1));
  console.log(`run ${runId}: ${result.actualizados} enlaces pasados a verificados`);
  await closeDb();
}

main().catch(async (error: unknown) => { console.error(error); await closeDb(); process.exit(1); });
