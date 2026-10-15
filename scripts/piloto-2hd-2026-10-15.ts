// Piloto del encargo de Brian (2026-10-15): completar la ficha 2HD (artista 2288) con lo que
// quedó sin aplicar de la captura de Metal Archives y lo que aporta el MySpace archivado (2010).
//
//   1. Disco: demo «Dos humanidades diferentes» (Demo, 2005, CD, independiente, grabado en los
//      estudios R&M de Caracas) — datos y tracklist de data/raw/metal-archives-ve-2026-10-01/
//      (consolidado/discos.csv + pistas.csv, album_id 182364; duraciones con duración real).
//   2. Portada: data/raw/metal-archives-ve-2026-10-01/img/182364_cover.jpg → web/public/media/album/<id>.jpg
//      y cover_url `/crv/media/album/<id>.jpg` (mismo patrón que las 14.498 portadas del catálogo).
//   3. Biografía en español con la historia del About del MySpace (tildes reconstruidas; el snapshot
//      de 2010 las perdió) + el dato del nombre que da MA. No se nombran fuentes en el texto.
//
// Todo en UN run del operador (auditoría por campo; deshacer = undo del run). Sin --confirm la
// transacción se revierte (vista previa exacta) y no se copia ningún archivo.
// Uso: ./scripts/with-node22.sh npx tsx scripts/piloto-2hd-2026-10-15.ts [--confirm]
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { closeDb, getPool } from "../src/db/client.js";
import { createEntity, updateEntity, withOperatorRun } from "../src/merge/operator.js";

const CONFIRM = process.argv.includes("--confirm");
const ROOT = process.cwd();
const MA = "data/raw/metal-archives-ve-2026-10-01";
const ARTIST_ID = 2288;
const ALBUM_MA_ID = "182364";
const PORTADA = path.join(MA, "img", `${ALBUM_MA_ID}_cover.jpg`);
const REPORT = `reports/myspace-2026-10-15/piloto-2hd-${CONFIRM ? "aplicado" : "vista-previa"}.json`;

const BIO = `2HD nace a finales de 2002 en la Isla de Margarita, Venezuela, de la mano de Fernando Mendoza, Igor Hurtado, Ómar Rodríguez y Ademar Arias, con la idea de mezclar los sonidos clásicos del metal extremo en una propuesta propia entre el black y el death metal. El nombre de la banda responde a «Dos Humanidades Diferentes».

En marzo de 2003 fueron invitados a tocar en Puerto Ordaz, su primera presentación fuera de la isla; al regreso se integró el tecladista Pedro Laprea y siguieron las presentaciones en Margarita. En julio de 2003 salió Igor Hurtado y entró el guitarrista Francisco Laprea. En 2004 la banda tocó en el antiguo Petróleo Bar de Valencia, un local que apoyó durante años a la movida metalera nacional, y se convirtió en la única banda margariteña en presentarse allí. Tras la salida de Pedro Laprea entró el guitarrista Jonathan González, con lo que quedó cerrada la formación que definió su sonido. En 2005 grabaron su primera producción, el demo «Dos Humanidades Diferentes», en los estudios R&M de Caracas.`;

function filasCsv(archivo: string): Record<string, string>[] {
  const texto = readFileSync(path.join(ROOT, MA, "consolidado", archivo), "utf8");
  const lineas = texto.split(/\r?\n/).filter((l) => l.trim());
  const cab = lineas[0]!.split(",");
  return lineas.slice(1).map((l) => {
    const celdas = l.split(",");
    return Object.fromEntries(cab.map((k, i) => [k!, celdas[i] ?? ""]));
  });
}

function segundos(mmss: string): number {
  const [m, s] = mmss.split(":").map(Number);
  return (m ?? 0) * 60 + (s ?? 0);
}

async function main(): Promise<void> {
  const disco = filasCsv("discos.csv").find((f) => f["album_id"] === ALBUM_MA_ID);
  const pistas = filasCsv("pistas.csv").filter((f) => f["album_id"] === ALBUM_MA_ID)
    .map((f) => ({ n: Number(f["n"]), title: f["title"]!, seconds: segundos(f["duration"]!) }))
    .sort((a, b) => a.n - b.n);
  if (!disco || pistas.length === 0) throw new Error("no se encontró el disco o sus pistas en la captura MA");
  if (!existsSync(path.join(ROOT, PORTADA))) throw new Error(`no existe la portada ${PORTADA}`);

  const pool = getPool();
  const artista = (await pool.query<{ name: string; biography: string | null }>(
    "SELECT name, biography FROM public.artists WHERE id=$1", [ARTIST_ID])).rows[0];
  if (!artista) throw new Error(`no existe el artista ${ARTIST_ID}`);
  const existentes = (await pool.query<{ id: string; title: string; year: number | null }>(
    "SELECT id::text, title, release_year AS year FROM public.albums WHERE artist_id=$1", [ARTIST_ID])).rows;
  const ya = existentes.find((a) => a.title.toLowerCase().trim() === disco["title"]!.toLowerCase().trim());

  console.log(`artista: ${artista.name} · bio actual: ${artista.biography?.length ?? 0} caracteres`);
  console.log(`discos actuales del artista: ${existentes.length}`);
  console.log(`disco a crear: «${disco["title"]}» (${disco["type"]}, ${disco["release_date"]}, ${disco["format"]}) · ${pistas.length} pistas`);
  for (const p of pistas) console.log(`   ${p.n}. ${p.title} — ${p.seconds}s`);
  if (ya) { console.log(`YA EXISTE el disco id ${ya.id} — nada que crear`); await closeDb(); return; }

  const report: Record<string, unknown> = { artista: ARTIST_ID, disco: disco["title"], pistas, bioCaracteres: BIO.length };

  const { runId } = await withOperatorRun({
    name: "hermes:piloto-2hd",
    operator: "hermes (encargo de Brian 2026-10-15)",
    note: "Piloto 2HD: alta del demo «Dos humanidades diferentes» con sus 4 pistas y duraciones desde la captura de Metal Archives, portada local y biografía en español (historia del MySpace archivado, tildes reconstruidas).",
    params: { artista: ARTIST_ID, albumMa: ALBUM_MA_ID },
  }, async (context) => {
    const album = await createEntity(context, "album", {
      title: disco["title"]!,
      release_year: Number(disco["release_date"]),
      album_type: "demo",
      release_date_text: disco["release_date"]!,
      media_format: disco["format"]!,
      notes: "Grabado en los estudios R&M (Caracas, Venezuela).",
    }, { artistId: ARTIST_ID, allowSimilar: true });
    report["albumId"] = album.id;
    console.log(`álbum creado: id ${album.id}`);

    const pistaIds: Array<{ n: number; id: number; title: string }> = [];
    for (const p of pistas) {
      const track = await createEntity(context, "track", {
        title: p.title.slice(0, 250), disc_number: 1, track_number: p.n, duration_seconds: p.seconds,
      }, { albumId: album.id, allowSimilar: true });
      pistaIds.push({ n: p.n, id: track.id, title: p.title });
    }
    report["pistaIds"] = pistaIds;
    console.log(`pistas creadas: ${pistaIds.map((p) => p.id).join(", ")}`);

    const campos = await updateEntity(context, "artist", ARTIST_ID, { biography: BIO });
    report["biografia"] = campos.fields.map((f) => `${f.field}:${f.action}`);
    await updateEntity(context, "album", album.id, { cover_url: `/crv/media/album/${album.id}.jpg` });
    return { albumId: album.id, pistas: pistaIds.length };
  }, { rollbackOnly: !CONFIRM });

  report["run"] = CONFIRM ? runId : null;
  mkdirSync(path.dirname(REPORT), { recursive: true });
  writeFileSync(REPORT, JSON.stringify(report, null, 1));

  if (CONFIRM) {
    const albumId = report["albumId"] as number;
    const destino = path.join(ROOT, "web", "public", "media", "album", `${albumId}.jpg`);
    mkdirSync(path.dirname(destino), { recursive: true });
    copyFileSync(path.join(ROOT, PORTADA), destino);
    console.log(`portada copiada: ${path.relative(ROOT, destino)}`);
  }
  console.log(`run ${CONFIRM ? runId : "(vista previa, revertida)"} · informe: ${REPORT}`);
  await closeDb();
}

main().catch(async (error: unknown) => { console.error(error); await closeDb(); process.exit(1); });
