// Cierre del hueco de discografías de Metal Archives (encargo de Brian, 2026-10-15).
//
// De los 1.824 discos capturados, 705 no están en el catálogo (reports/myspace-2026-10-15/
// ma-discos-faltantes.jsonl). Este motor crea los que el modelo soporta, por LOTES (un run del
// operador por lote — reversible — y savepoint por disco para que un fallo no tumbe el lote):
//   - álbum bajo el artista que ya existe en el catálogo (los de bandas sin ficha van a la fase B);
//   - pistas con número, título y duración (parser CSV correcto: hay títulos con comas);
//   - portada local (img/<album_id>_cover.jpg → web/public/media/album/<id>.jpg + cover_url).
//
// Excluidos a propósito (se reportan, no se crean): Split / Split video / Collaboration (el modelo
// de álbum tiene UN artista) y Video (no es un álbum de música). Tampoco se copian las notas de la
// fuente (mezcla de grabación/lineup/trivia en inglés): quedan para una pasada dirigida.
//
// Uso: ./scripts/with-node22.sh npx tsx scripts/ma-discos-2026-10-15.ts [--confirm] [--lote=40] [--limite=N]
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { closeDb, getPool } from "../src/db/client.js";
import { createEntity, updateEntity, withOperatorRun } from "../src/merge/operator.js";

const ROOT = process.cwd();
const DIR = "reports/myspace-2026-10-15";
const MA = "data/raw/metal-archives-ve-2026-10-01";
const CONFIRM = process.argv.includes("--confirm");
const LOTE = Number(process.argv.find((v) => v.startsWith("--lote="))?.slice(7) ?? 40);
const LIMITE = Number(process.argv.find((v) => v.startsWith("--limite="))?.slice(9) ?? 0);

const TIPO: Record<string, string> = {
  Single: "single", Demo: "demo", "Full-length": "studio_album", EP: "ep",
  Compilation: "compilation", "Live album": "live_album",
};
const EXCLUIDOS = new Set(["Split", "Split video", "Collaboration", "Video"]);

interface Faltante { album_id: number; band: string; title: string; type: string; year: string; label: string; format: string; pistas: number; url: string }
interface Pista { n: number; title: string; seconds: number | null }

function norm(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/gu, "").toLowerCase().replace(/[^a-z0-9]+/gu, " ").trim();
}

function parseCsv(texto: string): string[][] {
  const filas: string[][] = []; let fila: string[] = []; let celda = ""; let enComillas = false;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i]!;
    if (enComillas) {
      if (c === '"') { if (texto[i + 1] === '"') { celda += '"'; i++; } else enComillas = false; }
      else celda += c;
    } else if (c === '"') enComillas = true;
    else if (c === ",") { fila.push(celda); celda = ""; }
    else if (c === "\n") { fila.push(celda); filas.push(fila); fila = []; celda = ""; }
    else if (c !== "\r") celda += c;
  }
  if (celda !== "" || fila.length > 0) { fila.push(celda); filas.push(fila); }
  return filas;
}

function tablaCsv(archivo: string): Record<string, string>[] {
  const filas = parseCsv(readFileSync(path.join(ROOT, MA, "consolidado", archivo), "utf8"));
  const cab = filas[0]!;
  return filas.slice(1).filter((f) => f.length > 1).map((f) => Object.fromEntries(cab.map((k, i) => [k!, f[i] ?? ""])));
}

function segundos(mmss: string): number | null {
  const m = /^(\d+):(\d{2})$/.exec(mmss.trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

function anio(literal: string): number | null {
  const m = /\b(19|20)\d{2}\b/.exec(literal);
  return m ? Number(m[0]) : null;
}

async function main(): Promise<void> {
  const faltantes = readFileSync(path.join(ROOT, DIR, "ma-discos-faltantes.jsonl"), "utf8")
    .split("\n").filter(Boolean).map((l) => JSON.parse(l) as Faltante);

  const excluidos = faltantes.filter((f) => EXCLUIDOS.has(f.type));
  const sinTipo = faltantes.filter((f) => !EXCLUIDOS.has(f.type) && !TIPO[f.type]);
  const candidatos = faltantes.filter((f) => !EXCLUIDOS.has(f.type) && TIPO[f.type]);
  console.log(`faltantes: ${faltantes.length} · excluidos por tipo: ${excluidos.length} (${[...new Set(excluidos.map((e) => e.type))].join(", ")}) · tipo desconocido: ${sinTipo.length} · candidatos: ${candidatos.length}`);

  // pistas por disco
  const pistasPorDisco = new Map<number, Pista[]>();
  for (const p of tablaCsv("pistas.csv")) {
    const id = Number(p["album_id"]);
    const lista = pistasPorDisco.get(id) ?? [];
    lista.push({ n: Number(p["n"]), title: p["title"]!, seconds: segundos(p["duration"] ?? "") });
    pistasPorDisco.set(id, lista);
  }

  const pool = getPool();
  const artistas = (await pool.query<{ id: string; name: string }>("SELECT id::text, name FROM public.artists")).rows;
  const porNombre = new Map<string, number>();
  const ambiguos: string[] = [];
  for (const a of artistas) {
    const clave = norm(a.name);
    if (porNombre.has(clave) && porNombre.get(clave) !== Number(a.id)) { ambiguos.push(`${a.name} (#${a.id})`); continue; }
    porNombre.set(clave, Number(a.id));
  }

  let cola = candidatos.map((f) => ({ ...f, artistId: porNombre.get(norm(f.band)) ?? null }));
  const sinFicha = cola.filter((f) => f.artistId === null);
  cola = cola.filter((f) => f.artistId !== null);
  console.log(`bandas ambiguas (se usa la primera): ${ambiguos.length} ${ambiguos.slice(0, 5).join(" | ")}`);
  console.log(`candidatos con ficha: ${cola.length} · de bandas sin ficha (fase B, no se tocan aquí): ${sinFicha.length} (${new Set(sinFicha.map((f) => f.band)).size} bandas)`);

  const aplicadosPath = path.join(ROOT, DIR, "ma-discos-aplicados.jsonl");
  const hechos = new Set<number>(existsSync(aplicadosPath)
    ? readFileSync(aplicadosPath, "utf8").split("\n").filter(Boolean).map((l) => (JSON.parse(l) as { albumMa: number }).albumMa)
    : []);
  cola = cola.filter((f) => !hechos.has(f.album_id));
  if (LIMITE > 0) cola = cola.slice(0, LIMITE);
  console.log(`cola: ${cola.length} discos (lote de ${LOTE})`);

  const vistaPrevia = { excluidos: excluidos.map((e) => ({ band: e.band, title: e.title, type: e.type })), sinFicha: sinFicha.map((e) => ({ band: e.band, title: e.title, type: e.type })), primeras: cola.slice(0, 6).map((f) => ({ band: f.band, artistId: f.artistId, title: f.title, tipo: TIPO[f.type], year: anio(f.year), pistas: (pistasPorDisco.get(f.album_id) ?? []).length })) };
  writeFileSync(path.join(ROOT, DIR, "ma-discos-vista-previa.json"), JSON.stringify(vistaPrevia, null, 1));
  if (!CONFIRM) {
    console.log("vista previa (sin escrituras):", JSON.stringify(vistaPrevia.primeras, null, 1));
    console.log("repite con --confirm");
    await closeDb();
    return;
  }

  const resumen: Array<Record<string, unknown>> = [];
  let totalDiscos = 0, totalPistas = 0, totalPortadas = 0, fallos = 0;
  for (let i = 0; i < cola.length; i += LOTE) {
    const lote = cola.slice(i, i + LOTE);
    const idsArtista = [...new Set(lote.map((f) => f.artistId!))];
    const existentes = new Map<number, Set<string>>();
    for (const fila of (await pool.query<{ artist_id: string; title: string }>(
      "SELECT artist_id::text, title FROM public.albums WHERE artist_id = ANY($1::int[])", [idsArtista])).rows) {
      const clave = Number(fila.artist_id);
      const set = existentes.get(clave) ?? new Set<string>();
      set.add(norm(fila.title));
      existentes.set(clave, set);
    }

    const { runId, result } = await withOperatorRun({
      name: "hermes:ma-discos-hueco",
      operator: "hermes (encargo de Brian 2026-10-15)",
      note: "Discografía pendiente de la captura de Metal Archives (705 discos sin catálogo): alta de los discos que el modelo soporta bajo su banda, con pistas, duraciones y portada local.",
      params: { lote: Math.floor(i / LOTE) + 1, desde: lote[0]!.album_id },
    }, async (context) => {
      let discos = 0, nPistas = 0, portadas = 0;
      for (const f of lote) {
        await context.client.query("SAVEPOINT disco");
        try {
          const nTitulo = norm(f.title);
          const set = existentes.get(f.artistId!) ?? new Set<string>();
          if (set.has(nTitulo) || [...set].some((t) => t.length > 3 && nTitulo.length > 3 && (t.startsWith(nTitulo) || nTitulo.startsWith(t)))) {
            resumen.push({ albumMa: f.album_id, band: f.band, title: f.title, estado: "ya existía (título igual o afín)" });
            await context.client.query("RELEASE SAVEPOINT disco");
            continue;
          }
          const album = await createEntity(context, "album", {
            title: f.title.slice(0, 250),
            ...(anio(f.year) !== null ? { release_year: anio(f.year)! } : {}),
            album_type: TIPO[f.type]!,
            ...(f.year.trim() ? { release_date_text: f.year.trim() } : {}),
            ...(f.format.trim() ? { media_format: f.format.trim() } : {}),
          }, { artistId: f.artistId!, allowSimilar: true });
          discos++;
          set.add(nTitulo);

          const listaPistas = pistasPorDisco.get(f.album_id) ?? [];
          const posiciones = new Set<number>();
          for (const p of listaPistas) {
            if (posiciones.has(p.n)) continue;
            posiciones.add(p.n);
            await createEntity(context, "track", {
              title: p.title.slice(0, 250), disc_number: 1, track_number: p.n,
              ...(p.seconds !== null ? { duration_seconds: p.seconds } : {}),
            }, { albumId: album.id, allowSimilar: true });
            nPistas++;
          }

          const portada = path.join(ROOT, MA, "img", `${f.album_id}_cover.jpg`);
          let portadaOk = false;
          if (existsSync(portada)) {
            const destino = path.join(ROOT, "web", "public", "media", "album", `${album.id}.jpg`);
            mkdirSync(path.dirname(destino), { recursive: true });
            copyFileSync(portada, destino);
            await updateEntity(context, "album", album.id, { cover_url: `/crv/media/album/${album.id}.jpg` });
            portadas++; portadaOk = true;
          }
          resumen.push({ albumMa: f.album_id, albumId: album.id, band: f.band, title: f.title, tipo: TIPO[f.type], pistas: posiciones.size, portada: portadaOk, runId: context.runId });
          await context.client.query("RELEASE SAVEPOINT disco");
        } catch (error) {
          await context.client.query("ROLLBACK TO SAVEPOINT disco");
          fallos++;
          resumen.push({ albumMa: f.album_id, band: f.band, title: f.title, estado: "FALLÓ", error: (error as Error).message.slice(0, 200) });
        }
      }
      return { discos, pistas: nPistas, portadas };
    });

    totalDiscos += result.discos; totalPistas += result.pistas; totalPortadas += result.portadas;
    const creados = resumen.filter((r) => r["runId"] === runId);
    for (const r of creados) appendFileSync(aplicadosPath, JSON.stringify(r) + "\n");
    console.log(`run ${runId}: ${result.discos} discos · ${result.pistas} pistas · ${result.portadas} portadas (acumulado ${totalDiscos} discos / ${totalPistas} pistas)`);
  }

  writeFileSync(path.join(ROOT, DIR, "ma-discos-aplicacion.json"), JSON.stringify({
    discos: totalDiscos, pistas: totalPistas, portadas: totalPortadas, fallos,
    excluidos: excluidos.length, sinFicha: sinFicha.length, detalle: resumen,
  }, null, 1));
  console.log(`hecho: ${totalDiscos} discos · ${totalPistas} pistas · ${totalPortadas} portadas · ${fallos} fallos`);
  await closeDb();
}

main().catch(async (error: unknown) => { console.error(error); await closeDb(); process.exit(1); });
