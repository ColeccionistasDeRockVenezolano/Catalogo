// Fase B del hueco de Metal Archives (2026-10-15): bandas capturadas que NO tienen ficha en el
// catálogo, con sus discos. Mismo patrón que la fase A (scripts/ma-discos-2026-10-15.ts):
// un run del operador, savepoint por banda, portadas locales.
//
// Datos por banda de la captura: nombre, país, ciudad (location, se toma la primera plaza),
// año de formación, años activos, estado (status) y temas de las letras (traducidos con el
// glosario cerrado de reports/themes-es-2026-10-15/glosario-en-es.json). Foto y logo del
// manifest de imágenes (band_photo / band_logo → /crv/media/artist/<id>.<ext>).
//
// Se EXCLUYEN a propósito las bandas con posible duplicado en el catálogo (se reportan en el
// informe para cotejo humano): Anatomiæ Occultii (sus discos ya están en #823/#1764),
// Blood Work (ya en #860), Sanetoxic (¿= Sane Toxic #1371?), Sorte (¿= Sorthe #2150?).
// Los géneros musicales y las bios capturadas (en inglés) NO se aplican aquí: van por el flujo
// de vocabulario y por la síntesis de biografías.
//
// Uso: ./scripts/with-node22.sh npx tsx scripts/ma-bandas-2026-10-15.ts [--confirm]
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { closeDb } from "../src/db/client.js";
import { createEntity, updateEntity, withOperatorRun } from "../src/merge/operator.js";

const ROOT = process.cwd();
const DIR = "reports/myspace-2026-10-15";
const MA = "data/raw/metal-archives-ve-2026-10-01";
const CONFIRM = process.argv.includes("--confirm");

const EXCLUIDAS = new Set(["Anatomiæ Occultii", "Blood Work", "Sanetoxic", "Sorte"]);
const STATUS: Record<string, string> = { "Active": "active", "Split-up": "split_up", "On hold": "on_hold", "Changed name": "changed_name", "Unknown": "unknown", "Disputed": "unknown" };
const TIPO: Record<string, string> = { Single: "single", Demo: "demo", "Full-length": "studio_album", EP: "ep", Compilation: "compilation", "Live album": "live_album" };

function parseCsv(texto: string): string[][] {
  const filas: string[][] = []; let fila: string[] = []; let celda = ""; let q = false;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i]!;
    if (q) { if (c === '"') { if (texto[i + 1] === '"') { celda += '"'; i++; } else q = false; } else celda += c; }
    else if (c === '"') q = true;
    else if (c === ",") { fila.push(celda); celda = ""; }
    else if (c === "\n") { fila.push(celda); filas.push(fila); fila = []; celda = ""; }
    else if (c !== "\r") celda += c;
  }
  if (celda !== "" || fila.length > 0) { fila.push(celda); filas.push(fila); }
  return filas;
}
function tabla(archivo: string): Record<string, string>[] {
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
function ciudad(loc: string): string | null {
  const s = (loc || "").split(";")[0]!.split(" / ")[0]!.replace(/\s*\([^)]*\)\s*/gu, " ").trim();
  return s || null;
}

// Traducción de temas con el glosario cerrado (misma tokenización: «,» y «;», paréntesis aparte).
function traductor(glos: Record<string, string>, faltan: Set<string>) {
  const atomo = (t: string): string => {
    const m = /^(.*?)\s*\(([^)]*)\)\s*$/u.exec(t.trim());
    if (m) return `${atomo(m[1]!)} (${glos[m[2]!.trim()] ?? m[2]!.trim()})`.trim();
    const clave = t.trim();
    const val = glos[clave];
    if (val === undefined) { faltan.add(clave); return clave; }
    return val;
  };
  return (valor: string): string => valor.split(/([;,])/u).map((p) => (p === "," || p === ";" ? p : p.replace(/^(\s*)(.*?)(\s*)$/su, (_m, a: string, b: string, c: string) => a + atomo(b) + c))).join("");
}


async function main(): Promise<void> {
  const vp = JSON.parse(readFileSync(path.join(ROOT, DIR, "ma-discos-vista-previa.json"), "utf8")) as { sinFicha: Array<{ band: string; title: string; type: string }> };
  const bandas = [...new Set(vp.sinFicha.map((s) => s.band))].filter((b) => !EXCLUIDAS.has(b));
  const excluidas = [...new Set(vp.sinFicha.map((s) => s.band))].filter((b) => EXCLUIDAS.has(b));

  const detalles = new Map<string, Record<string, unknown>>();
  for (const l of readFileSync(path.join(ROOT, MA, "band-details-full.jsonl"), "utf8").split("\n").filter(Boolean)) {
    const d = JSON.parse(l) as Record<string, unknown>;
    if (typeof d["name"] === "string") detalles.set(d["name"] as string, d);
  }
  const discos = tabla("discos.csv");
  const porAlbumId = new Map<number, Record<string, string>>(discos.map((f) => [Number(f["album_id"]), f]));
  const pistasPorDisco = new Map<number, Array<{ n: number; title: string; seconds: number | null }>>();
  for (const p of tabla("pistas.csv")) {
    const id = Number(p["album_id"]);
    const lista = pistasPorDisco.get(id) ?? [];
    lista.push({ n: Number(p["n"]), title: p["title"]!, seconds: segundos(p["duration"] ?? "") });
    pistasPorDisco.set(id, lista);
  }
  const imagenes = new Map<string, string>();   // "band_photo:7312" → img/7312_photo.jpg
  for (const i of tabla("imagenes.csv")) {
    if (i["kind"] === "band_photo" || i["kind"] === "band_logo") imagenes.set(`${i["kind"]}:${i["band_id"]}`, i["archivo"]!);
  }
  const glos = JSON.parse(readFileSync(path.join(ROOT, "reports/themes-es-2026-10-15/glosario-en-es.json"), "utf8")) as Record<string, string>;
  const faltanGlos = new Set<string>();
  const traducir = traductor(glos, faltanGlos);

  console.log(`bandas a crear: ${bandas.length} · excluidas por posible duplicado: ${excluidas.join(", ")}`);
  const report: Record<string, unknown> = { bandas: [], excluidas, faltanGlos: [] as string[] };

  const aplicadosPath = path.join(ROOT, DIR, "ma-bandas-aplicados.jsonl");
  const hechas = new Set<string>(existsSync(aplicadosPath)
    ? readFileSync(aplicadosPath, "utf8").split("\n").filter(Boolean).map((l) => (JSON.parse(l) as { band: string }).band)
    : []);
  const cola = bandas.filter((b) => !hechas.has(b));
  if (!CONFIRM) { console.log("vista previa (sin escrituras):", cola.join(", ")); await closeDb(); return; }

  const { runId, result } = await withOperatorRun({
    name: "hermes:ma-bandas-hueco",
    operator: "hermes (encargo de Brian 2026-10-15)",
    note: "Fase B del hueco de Metal Archives: bandas capturadas sin ficha en el catálogo, con sus discos, pistas y portadas; temas de las letras traducidos con el glosario cerrado.",
    params: { bandas: cola.length },
  }, async (context) => {
    for (const banda of cola) {
      const det = detalles.get(banda) ?? {};
      await context.client.query("SAVEPOINT banda");
      try {
        const themes = typeof det["themes"] === "string" && det["themes"] !== "N/A" ? traducir(det["themes"] as string) : null;
        const formed = anio(String(det["formed_in"] ?? ""));
        const artist = await createEntity(context, "artist", {
          name: banda,
          artist_type: "band",
          origin_country: typeof det["country"] === "string" ? det["country"] : "Venezuela",
          ...(ciudad(String(det["location"] ?? "")) ? { origin_city: ciudad(String(det["location"] ?? ""))! } : {}),
          ...(formed !== null ? { formed_year: formed } : {}),
          ...(typeof det["years_active"] === "string" && det["years_active"] !== "N/A" ? { years_active: (det["years_active"] as string).slice(0, 200) } : {}),
          ...(typeof det["status"] === "string" && STATUS[det["status"] as string] ? { status: STATUS[det["status"] as string]! } : {}),
          ...(themes ? { themes } : {}),
        }, { allowSimilar: true });
        const creada: Record<string, unknown> = { band: banda, artistId: artist.id };

        const maId = String(det["ma_id"] ?? "");
        for (const [etiqueta, campo, sufijo] of [["band_photo", "picture_url", ""], ["band_logo", "logo_url", "-logo"]] as const) {
          const archivo = imagenes.get(`${etiqueta}:${maId}`);
          if (!archivo) continue;
          const origen = path.join(ROOT, MA, archivo);
          if (!existsSync(origen)) continue;
          const ext = path.extname(archivo) || ".jpg";
          const destino = path.join(ROOT, "web", "public", "media", "artist", `${artist.id}${sufijo}${ext}`);
          mkdirSync(path.dirname(destino), { recursive: true });
          copyFileSync(origen, destino);
          await updateEntity(context, "artist", artist.id, { [campo]: `/crv/media/artist/${artist.id}${sufijo}${ext}` });
          creada[campo] = true;
        }

        const suyos = vp.sinFicha.filter((s) => s.band === banda);
        const ids: number[] = [];
        for (const s of suyos) {
          const fila = [...porAlbumId.values()].find((f) => f["band_ref"] === banda && f["title"] === s.title && f["type"] === s.type);
          if (!fila) { (report["bandas"] as Array<Record<string, unknown>>).push({ band: banda, disco: s.title, estado: "sin fila en discos.csv" }); continue; }
          await context.client.query("SAVEPOINT disco");
          try {
            const album = await createEntity(context, "album", {
              title: s.title.slice(0, 250),
              ...(anio(fila["release_date"] ?? "") !== null ? { release_year: anio(fila["release_date"]!)! } : {}),
              album_type: TIPO[s.type]!,
              ...(fila["release_date"]?.trim() ? { release_date_text: fila["release_date"]!.trim() } : {}),
              ...(fila["format"]?.trim() ? { media_format: fila["format"]!.trim() } : {}),
            }, { artistId: artist.id, allowSimilar: true });
            ids.push(album.id);
            for (const p of pistasPorDisco.get(Number(fila["album_id"])) ?? []) {
              await createEntity(context, "track", {
                title: p.title.slice(0, 250), disc_number: 1, track_number: p.n,
                ...(p.seconds !== null ? { duration_seconds: p.seconds } : {}),
              }, { albumId: album.id, allowSimilar: true });
            }
            const portada = path.join(ROOT, MA, "img", `${fila["album_id"]}_cover.jpg`);
            if (existsSync(portada)) {
              const destino = path.join(ROOT, "web", "public", "media", "album", `${album.id}.jpg`);
              mkdirSync(path.dirname(destino), { recursive: true });
              copyFileSync(portada, destino);
              await updateEntity(context, "album", album.id, { cover_url: `/crv/media/album/${album.id}.jpg` });
            }
            await context.client.query("RELEASE SAVEPOINT disco");
          } catch (error) {
            await context.client.query("ROLLBACK TO SAVEPOINT disco");
            (report["bandas"] as Array<Record<string, unknown>>).push({ band: banda, disco: s.title, estado: "FALLÓ", error: (error as Error).message.slice(0, 200) });
          }
        }
        creada["discos"] = ids;
        appendFileSync(aplicadosPath, JSON.stringify(creada) + "\n");
        (report["bandas"] as Array<Record<string, unknown>>).push(creada);
        console.log(`banda ${banda} → #${artist.id} · ${ids.length} discos`);
        await context.client.query("RELEASE SAVEPOINT banda");
      } catch (error) {
        await context.client.query("ROLLBACK TO SAVEPOINT banda");
        console.log(`banda ${banda} FALLÓ: ${(error as Error).message.slice(0, 160)}`);
        (report["bandas"] as Array<Record<string, unknown>>).push({ band: banda, estado: "FALLÓ", error: (error as Error).message.slice(0, 200) });
      }
    }
    return { bandas: cola.length };
  });

  report["run"] = runId; report["faltanGlos"] = [...faltanGlos];
  writeFileSync(path.join(ROOT, DIR, "ma-bandas-aplicacion.json"), JSON.stringify(report, null, 1));
  console.log(`run ${runId} · ${result.bandas} bandas · informe: ${DIR}/ma-bandas-aplicacion.json`);
  if (faltanGlos.size) console.log(`términos de temas sin glosario (quedaron tal cual): ${[...faltanGlos].join(", ")}`);
  await closeDb();
}

main().catch(async (error: unknown) => { console.error(error); await closeDb(); process.exit(1); });
