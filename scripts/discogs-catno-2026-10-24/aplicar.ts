// CRV · Aplica los números de catálogo cosechados de Discogs a ingest.album_versions.
//
// Reglas (Brian, 2026-10-24: «haz el siguiente paso lógico»):
//  1. Solo ediciones con país Venezuela y cuyo título de release coincide
//     EXACTAMENTE (normalizado) con el álbum del catálogo. El match laxo por
//     contención produjo discos con 36–38 «ediciones»: eso es ruido, no cartera.
//  2. Si el disco tiene una versión sin número, se completa ESA versión (no se
//     crea otra): el número pertenece al disco que ya está en la ficha.
//  3. Si todas las versiones ya tienen número, se crean versiones nuevas solo
//     cuando el disco aporta como mucho MAX_NUEVAS números distintos.
//  4. No se toca release_year ni release_date de versiones existentes: el año
//     de una edición venezolana no puede pisar la fecha documentada del disco.
//
//   npx tsx scripts/discogs-catno-2026-10-24/aplicar.ts            # dry-run
//   npx tsx scripts/discogs-catno-2026-10-24/aplicar.ts --confirm  # aplica
import { readFileSync, writeFileSync } from "node:fs";
import { closeDb, getPool } from "../../src/db/client.js";
import { withOperatorRun } from "../../src/merge/operator.js";
import { writeEditorResource } from "../../src/catalog/editor.js";
import { mediaFormatLabel } from "../../src/discography/versions.js";

const JSONL = "/mnt/1tb/Shared/coleccionistas-rock-venezolano/data/research/discogs-catno-2026-10-24/resultados.jsonl";
const MAX_NUEVAS = 4;
const LOTE = 100;
const confirm = process.argv.includes("--confirm");
const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i < 0 ? undefined : process.argv[i + 1];
};

interface Cosecha {
  artist_id: number; artist: string; album_match: string; titulo: string; anio: string | null;
  pais: string | null; sello: string[] | null; formato: string[] | null; catno: string; uri: string;
}

interface VersionFila {
  id: number; catno: string; format: string | null; country: string | null;
  year: number | null; release_date: unknown; position: number; primary: boolean;
}

interface Trabajo {
  albumId: number; album: string; completar: VersionFila | null; conNumero: Cosecha | null;
  crear: Cosecha[]; omitidas: number;
}

const norm = (value: string) => (value ?? "")
  .normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
  .replace(/[^a-z0-9]+/g, " ").trim();

const catKey = (value: string | null | undefined) => (value ?? "").toLowerCase().replace(/[\s.\-_/]/g, "");

function formatoDiscogs(formatos: string[] | null): string | null {
  if (!formatos?.length) return null;
  const texto = formatos.join(" ");
  if (/\b(file|digital|aac|mp3|flac|wav|streaming)\b/iu.test(texto)) return "Digital";
  const doble = /(^|\s)([23])\s*x\s*(cd|vinilo|vinyl|lp)/iu.exec(texto) ?? /(^|\s)([23])cd\b/iu.exec(texto);
  if (doble) return /cd/iu.test(doble[3] ?? "cd") ? `${doble[2]} CD` : "Vinilo";
  return mediaFormatLabel(texto);
}

async function main() {
  const file = arg("--jsonl") ?? JSONL;
  const cosecha: Cosecha[] = readFileSync(file, "utf8").split("\n").filter(Boolean)
    .map((line) => JSON.parse(line) as Cosecha);

  const porAlbum = new Map<string, { artist_id: number; album: string; catnos: Map<string, Cosecha> }>();
  let descartadosTitulo = 0;
  let ve = 0;
  for (const r of cosecha) {
    if ((r.pais ?? "") !== "Venezuela") continue;
    ve++;
    if (!r.album_match || !r.catno) continue;
    if (norm(r.titulo) !== norm(r.album_match)) { descartadosTitulo++; continue; }
    const key = `${r.artist_id}\u0000${r.album_match}`;
    const entry = porAlbum.get(key) ?? { artist_id: r.artist_id, album: r.album_match, catnos: new Map<string, Cosecha>() };
    const prev = entry.catnos.get(catKey(r.catno));
    const score = (r.anio ? 1 : 0) + (r.sello ? 1 : 0) + (r.formato ? 1 : 0);
    const prevScore = prev ? (prev.anio ? 1 : 0) + (prev.sello ? 1 : 0) + (prev.formato ? 1 : 0) : -1;
    if (score > prevScore) entry.catnos.set(catKey(r.catno), r);
    porAlbum.set(key, entry);
  }
  console.log(`releases VE: ${ve} · discos con título exacto: ${porAlbum.size} · descartados por título: ${descartadosTitulo}`);

  const pool = getPool();
  const artistIds = [...new Set([...porAlbum.values()].map((v) => v.artist_id))];
  const albumRows = (await pool.query<{ id: number; artist_id: number; title: string }>(
    `SELECT id::int, artist_id::int, title FROM public.albums WHERE artist_id = ANY($1::int[])`, [artistIds],
  )).rows;
  const albumByKey = new Map(albumRows.map((a) => [`${a.artist_id}\u0000${a.title}`, a.id]));

  const trabajos: Trabajo[] = [];
  let sinAlbum = 0;
  let fueraDeTope = 0;
  for (const entry of porAlbum.values()) {
    const albumId = albumByKey.get(`${entry.artist_id}\u0000${entry.album}`);
    if (!albumId) { sinAlbum++; continue; }
    const versiones = (await pool.query<VersionFila>(
      `SELECT id::int, coalesce(catalog_number,'') AS catno, format, country, release_year AS year,
              release_date, position, is_primary AS primary
         FROM ingest.album_versions WHERE album_id=$1 ORDER BY is_primary DESC, position, id`, [albumId],
    )).rows;
    const existentes = new Set(versiones.map((v) => catKey(v.catno)).filter(Boolean));
    const nuevos = [...entry.catnos.entries()].filter(([key]) => !existentes.has(key)).map(([, v]) => v);
    if (!nuevos.length) continue;
    const hueco = versiones.find((v) => !v.catno.trim()) ?? null;
    const conNumero = hueco ? nuevos[0]! : null;
    const crear = hueco ? nuevos.slice(1) : nuevos;
    if (crear.length > MAX_NUEVAS) {
      fueraDeTope += nuevos.length;
      continue;
    }
    trabajos.push({ albumId, album: entry.album, completar: hueco, conNumero, crear, omitidas: 0 });
  }

  const completar = trabajos.filter((t) => t.completar).length;
  const crearTotal = trabajos.reduce((n, t) => n + t.crear.length, 0);
  const solo = arg("--album");
  if (solo) {
    const t = trabajos.find((x) => x.albumId === Number(solo));
    console.log("trabajo:", JSON.stringify(t ?? null));
  }
  console.log(`plan: ${completar} versiones existentes completadas · ${crearTotal} versiones nuevas · `
    + `${fueraDeTope} números fuera de tope (>${MAX_NUEVAS} por disco) · ${sinAlbum} discos sin álbum en BD`);
  if (!confirm) {
    console.log("muestra:");
    for (const t of trabajos.slice(0, 8)) {
      const c = t.completar ? `completa v${t.completar.id} [${t.completar.catno || "sin nº"}] con ${t.conNumero?.catno}` : `crea ${t.crear.length}`;
      const det = (t.completar ? t.conNumero : t.crear[0]);
      console.log(`  ${t.album} · ${c} · formato=${formatoDiscogs(det?.formato ?? null)} · año=${det?.anio ?? "-"}`);
    }
    console.log("dry-run: sin cambios. Añade --confirm para aplicar.");
    await closeDb();
    return;
  }

  const resumen = { runs: [] as number[], completadas: 0, creadas: 0, errores: [] as Array<{ albumId: number; error: string }> };
  const lotes: Trabajo[][] = [];
  for (let i = 0; i < trabajos.length; i += LOTE) lotes.push(trabajos.slice(i, i + LOTE));

  for (const [indice, lote] of lotes.entries()) {
    const { runId } = await withOperatorRun({
      name: "catalogo:discogs-catno-2026-10-24",
      operator: "Hermes (encargo de Brian: aplicar cosecha Discogs)",
      note: "Números de catálogo de ediciones venezolanas de Discogs sobre versiones del catálogo; sin crear discos ni pistas.",
      params: { campaign: "discogs-catno-2026-10-24", lote: indice, discos: lote.length, origen: "api.discogs.com" },
    }, async (ctx) => {
      await ctx.client.query("SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='60s'");
      for (const t of lote) {
        try {
          if (t.completar && t.conNumero) {
            await writeEditorResource(ctx, "version", t.albumId, {
              catalogNumber: t.conNumero.catno,
              country: t.completar.country?.trim() ? undefined : "Venezuela",
              format: t.completar.format?.trim() ? undefined : formatoDiscogs(t.conNumero.formato),
              sourceRef: t.conNumero.uri,
            }, t.completar.id);
            resumen.completadas++;
          }
          for (const c of t.crear) {
            const maxPosition = (await ctx.client.query<{ max: number }>(
              "SELECT coalesce(max(position),0)::int AS max FROM ingest.album_versions WHERE album_id=$1", [t.albumId],
            )).rows[0]!.max;
            await writeEditorResource(ctx, "version", t.albumId, {
              position: maxPosition + 1,
              title: null,
              format: formatoDiscogs(c.formato),
              formatDetails: c.formato?.join(", ") ?? null,
              catalogNumber: c.catno,
              country: "Venezuela",
              releaseYear: c.anio ? Number(c.anio) : null,
              sourceRef: c.uri,
              distinctTracks: false,
              isPrimary: false,
              editionTypes: [],
            });
            resumen.creadas++;
          }
        } catch (error) {
          resumen.errores.push({ albumId: t.albumId, error: (error as Error).message });
        }
      }
      return lote.length;
    });
    resumen.runs.push(runId);
    console.log(`lote ${indice + 1}/${lotes.length} · completadas=${resumen.completadas} creadas=${resumen.creadas} errores=${resumen.errores.length}`);
  }

  writeFileSync("/home/brian/apps/Coleccionistas De Rock Venezolano/reports/discogs-catno-aplicacion-2026-10-24.json",
    JSON.stringify({ ...resumen, discos: trabajos.length, plan: { completar, crear: crearTotal, fueraDeTope } }, null, 2));
  console.log(JSON.stringify({ completadas: resumen.completadas, creadas: resumen.creadas, errores: resumen.errores.length, runs: resumen.runs.length }));
  await closeDb();
}

main().catch(async (error) => { console.error(error); await closeDb(); process.exit(1); });
