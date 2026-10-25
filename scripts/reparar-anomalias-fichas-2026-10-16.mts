// Reparación cautelosa de anomalías de fichas detectadas el 2026-10-16 (barrido lateral).
//
// Módulos:
//   alias-compuestos  — los «Also Known As» de RYM escritos como una sola fila («A [birth name], B, C»)
//                       se parten en alias individuales y se retira la fila compuesta. Se descartan
//                       anotaciones ([birth name], [1968-69]), URLs, correos, vacíos y repetidos.
//   alias-redundantes — alias del mismo artista con la MISMA clave normalizada del ER (solo difieren
//                       en caja/puntuación/acentos): se conserva uno (el primario; si no, el que
//                       coincide con el nombre; si no, el más antiguo) y se retiran los demás.
//   membresias        — membresías con is_current=true y año de salida (to_year): is_current=false.
//   compartidos       — SOLO informe: alias que existen en 2+ fichas (la mayoría legítimos: nombres
//                       propios repetidos con desambiguación por ciudad, AKA recíprocos de RYM).
//
// Uso: ./scripts/with-node22.sh npx tsx scripts/reparar-anomalias-fichas-2026-10-16.mts [--confirm]
//      [--modulo=alias-compuestos|alias-redundantes|membresias|compartidos|todo]
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createAlias, deleteAlias, updateAlias } from "../src/api/repositories/aliases.js";
import { closeDb, getPool } from "../src/db/client.js";
import { updateRelation, withOperatorRun } from "../src/merge/operator.js";
import { normalizeEntityName } from "../src/normalization/entity-name.js";

const DIR = "reports/anomalias-fichas-2026-10-16";
mkdirSync(DIR, { recursive: true });
const confirm = process.argv.includes("--confirm");
const modulo = process.argv.find((v) => v.startsWith("--modulo="))?.slice(9) ?? "todo";
const clave = (t: string) => normalizeEntityName(t).primaryKey;

interface AliasRow { id: number; artistId: number; nombre: string; alias: string; norm: string; primary: boolean; fecha: string }

async function cargarAlias(): Promise<AliasRow[]> {
  const { rows } = await getPool().query<Record<string, unknown>>(`
    SELECT al.id, al.artist_id, a.name, al.alias, al.normalized_alias, al.is_primary, al.created_at::date::text AS fecha
    FROM ingest.artist_aliases al JOIN public.artists a ON a.id = al.artist_id
    ORDER BY al.artist_id, al.id`);
  return rows.map((r) => ({
    id: Number(r["id"]), artistId: Number(r["artist_id"]), nombre: String(r["name"]), alias: String(r["alias"]),
    norm: String(r["normalized_alias"]), primary: r["is_primary"] === true, fecha: String(r["fecha"]),
  }));
}

/** Limpia una parte de un alias compuesto: quita anotaciones [..], bordes de puntuación y descarta
 *  URLs, correos, vacíos y lo que coincide con el nombre del artista o con un alias ya existente. */
function limpiarParte(bruto: string, nombre: string, claves: Set<string>): string | null {
  const p = bruto
    .replace(/\[[^\]]*\]/gu, " ")
    .replace(/\s+/gu, " ")
    .replace(/^[\s.,;:&+\-–—|/]+/gu, "")
    .replace(/[\s.,;:&+\-–—|/]+$/gu, "")
    .trim();
  if (p.length < 2 || p.length > 200) return null;
  if (/https?:\/\/|www\.|@/iu.test(p)) return null;
  if (!/[\p{L}\p{N}]/u.test(p)) return null;
  const k = clave(p);
  if (!k || k === clave(nombre)) return null;
  if (claves.has(k)) return null;
  return p;
}

async function moduloAliasCompuestos(): Promise<void> {
  const alias = (await cargarAlias()).filter((a) => a.alias.includes(","));
  // Claves existentes por artista (para no crear duplicados).
  const clavesPorArtista = new Map<number, Set<string>>();
  for (const a of await cargarAlias()) {
    clavesPorArtista.set(a.artistId, new Set([...(clavesPorArtista.get(a.artistId) ?? []), a.norm]));
  }
  const trabajos: Array<{ original: AliasRow; partes: string[]; promuevePrimary: boolean }> = [];
  const sinPartes: AliasRow[] = [];
  const omitidos: AliasRow[] = [];
  for (const a of alias) {
    // Guarda: si la clave del compuesto es la del NOMBRE del artista, la fila es el «original
    // conservado» del propio nombre con comas («Azúcar, Cacao & Leche») — por diseño, no se parte.
    if (a.norm === clave(a.nombre)) { omitidos.push(a); continue; }
    const claves = new Set(clavesPorArtista.get(a.artistId) ?? []);
    claves.delete(a.norm); // la propia fila compuesta no bloquea
    const vistas = new Set<string>();
    const partes: string[] = [];
    for (const bruto of a.alias.split(",")) {
      const p = limpiarParte(bruto, a.nombre, claves);
      if (!p) continue;
      const k = clave(p);
      if (vistas.has(k)) continue;
      vistas.add(k);
      partes.push(p);
      claves.add(k);
    }
    if (partes.length) trabajos.push({ original: a, partes, promuevePrimary: a.primary });
    else sinPartes.push(a);
  }
  console.log(`alias compuestos: ${alias.length} · con partes válidas: ${trabajos.length} · solo retirar: ${sinPartes.length} · omitidos (nombre con comas): ${omitidos.length}`);
  const informe = {
    total: alias.length,
    conPartes: trabajos.map((t) => ({ id: t.original.id, artista: t.original.nombre, compuesto: t.original.alias, partes: t.partes, primary: t.original.primary })),
    soloRetirar: sinPartes.map((a) => ({ id: a.id, artista: a.nombre, alias: a.alias })),
    omitidos: omitidos.map((a) => ({ id: a.id, artista: a.nombre, alias: a.alias })),
  };
  if (!confirm) { writeFileSync(path.join(DIR, "alias-compuestos-ensayo.json"), JSON.stringify(informe, null, 1)); return; }
  const { runId, result } = await withOperatorRun({
    name: "hermes:anomalias-alias-compuestos",
    operator: "hermes (encargo de Brian 2026-10-16)",
    note: "Las listas de «Also Known As» de RYM escritas como un solo alias («A [birth name], B, C») se parten en alias individuales: se crean las partes limpias y se retira la fila compuesta. Se descartan anotaciones [..], URLs, correos y repetidos.",
  }, async (context) => {
    let creados = 0, retirados = 0;
    for (const t of trabajos) {
      let primera = true;
      for (const parte of t.partes) {
        const isPrimary = t.promuevePrimary && primera;
        try {
          await createAlias(context, "artist", t.original.artistId, { alias: parte, aliasType: "name_variant", isPrimary });
        } catch (error) {
          if (!(error instanceof Error) || (error as { code?: string }).code !== "already_exists") throw error;
        }
        creados++; primera = false;
      }
      await deleteAlias(context, "artist", t.original.artistId, t.original.id);
      retirados++;
    }
    for (const a of sinPartes) { await deleteAlias(context, "artist", a.artistId, a.id); retirados++; }
    return { creados, retirados };
  });
  writeFileSync(path.join(DIR, `alias-compuestos-run${runId}.json`), JSON.stringify({ runId, ...result, informe }, null, 1));
  console.log(`run ${runId}: ${result.creados} alias creados · ${result.retirados} compuestos retirados`);
}

async function moduloAliasRedundantes(): Promise<void> {
  const alias = await cargarAlias();
  const grupos = new Map<string, AliasRow[]>();
  for (const a of alias) {
    const k = `${a.artistId}\u0000${a.norm}`;
    grupos.set(k, [...(grupos.get(k) ?? []), a]);
  }
  const trabajos: Array<{ conserva: AliasRow; retira: AliasRow[] }> = [];
  for (const grupo of grupos.values()) {
    if (grupo.length < 2) continue;
    const nombreClave = clave(grupo[0]!.nombre);
    const conserva = grupo.find((a) => a.primary)
      ?? grupo.find((a) => clave(a.alias) === nombreClave)
      ?? grupo.reduce((mejor, a) => (a.id < mejor.id ? a : mejor), grupo[0]!);
    trabajos.push({ conserva, retira: grupo.filter((a) => a.id !== conserva.id) });
  }
  const totalRetira = trabajos.reduce((n, t) => n + t.retira.length, 0);
  console.log(`alias redundantes: ${trabajos.length} grupos de ${new Set(trabajos.map((t) => t.conserva.artistId)).size} artistas · ${totalRetira} filas a retirar`);
  const informe = { grupos: trabajos.map((t) => ({ artista: t.conserva.nombre, clave: t.conserva.norm, conserva: t.conserva.alias, retira: t.retira.map((a) => a.alias) })) };
  if (!confirm) { writeFileSync(path.join(DIR, "alias-redundantes-ensayo.json"), JSON.stringify(informe, null, 1)); return; }
  const { runId, result } = await withOperatorRun({
    name: "hermes:anomalias-alias-redundantes",
    operator: "hermes (encargo de Brian 2026-10-16)",
    note: "Alias del mismo artista con la misma clave normalizada del ER (solo difieren en caja/acentos/puntuación): se conserva uno (primario → el que coincide con el nombre → el más antiguo) y se retiran los demás. No cambia ninguna resolución: la clave es idéntica.",
  }, async (context) => {
    let retirados = 0;
    for (const t of trabajos) { for (const a of t.retira) { await deleteAlias(context, "artist", a.artistId, a.id); retirados++; } }
    return { retirados };
  });
  writeFileSync(path.join(DIR, `alias-redundantes-run${runId}.json`), JSON.stringify({ runId, ...result, informe }, null, 1));
  console.log(`run ${runId}: ${result.retirados} alias redundantes retirados`);
}

async function moduloMembresias(): Promise<void> {
  const { rows } = await getPool().query<Record<string, unknown>>(`
    SELECT am.id, am.artist_id, ar.name AS artist_name, p.name AS person_name, am.from_year, am.to_year, am.role
    FROM public.artist_members am
    JOIN public.artists ar ON ar.id = am.artist_id
    JOIN public.persons p ON p.id = am.person_id
    WHERE am.is_current IS TRUE AND am.to_year IS NOT NULL ORDER BY am.id`);
  const filas = rows.map((r) => ({ id: Number(r["id"]), artistId: Number(r["artist_id"]), artista: String(r["artist_name"]), persona: String(r["person_name"]), desde: r["from_year"], hasta: Number(r["to_year"]), rol: String(r["role"]) }));
  console.log(`membresías is_current=true con año de salida: ${filas.length}`);
  if (!confirm) { writeFileSync(path.join(DIR, "membresias-ensayo.json"), JSON.stringify(filas, null, 1)); return; }
  const { runId, result } = await withOperatorRun({
    name: "hermes:anomalias-membresias-current",
    operator: "hermes (encargo de Brian 2026-10-16)",
    note: "Membresías marcadas como vigentes (is_current=true) con año de salida registrado: se corrigen a is_current=false. La incoherencia (vigente Y con fecha de fin) no es posible; el año de salida manda.",
  }, async (context) => {
    let corregidas = 0;
    for (const f of filas) { await updateRelation(context, "artist_membership", f.id, { is_current: false }); corregidas++; }
    return { corregidas };
  });
  writeFileSync(path.join(DIR, `membresias-run${runId}.json`), JSON.stringify({ runId, ...result, filas }, null, 1));
  console.log(`run ${runId}: ${result.corregidas} membresías corregidas`);
}

async function moduloAliasSueltos(): Promise<void> {
  const alias = await cargarAlias();
  const sueltos = alias.filter((a) => !a.alias.includes(",") && /https?:\/\/|www\.|@|\[|\]/iu.test(a.alias));
  const clavesPorArtista = new Map<number, Set<string>>();
  for (const a of alias) clavesPorArtista.set(a.artistId, new Set([...(clavesPorArtista.get(a.artistId) ?? []), a.norm]));
  type Accion = { fila: AliasRow; accion: "limpiar" | "retirar" | "omitir"; nuevo?: string; motivo?: string };
  const acciones: Accion[] = [];
  for (const a of sueltos) {
    // Guarda: el alias con basura que es el «original conservado» del propio nombre no se toca.
    if (a.norm === clave(a.nombre)) { acciones.push({ fila: a, accion: "omitir", motivo: "original conservado del nombre" }); continue; }
    const limpio = a.alias
      .replace(/\[[^\]]*\]/gu, " ")
      .replace(/@/gu, " ")
      .replace(/\s+/gu, " ")
      .replace(/^[\s.,;:&+\-–—|/]+/gu, "")
      .replace(/[\s.,;:&+\-–—|/]+$/gu, "")
      .trim();
    const claves = clavesPorArtista.get(a.artistId) ?? new Set<string>();
    if (limpio.length < 2 || limpio.length > 200 || !/[\p{L}\p{N}]/u.test(limpio)) { acciones.push({ fila: a, accion: "retirar", motivo: "sin contenido utilizable" }); continue; }
    if (/https?:\/\/|www\.|@/iu.test(limpio)) { acciones.push({ fila: a, accion: "retirar", motivo: "url o correo" }); continue; }
    const kLimpio = clave(limpio);
    if (!kLimpio || kLimpio === clave(a.nombre)) { acciones.push({ fila: a, accion: "retirar", motivo: "coincide con el nombre del artista" }); continue; }
    if (kLimpio !== a.norm && claves.has(kLimpio)) { acciones.push({ fila: a, accion: "retirar", motivo: "ese alias ya existe en la ficha" }); continue; }
    if (kLimpio === a.norm) { acciones.push({ fila: a, accion: "omitir", motivo: "la limpieza no cambia la clave" }); continue; }
    acciones.push({ fila: a, accion: "limpiar", nuevo: limpio });
  }
  const aLimpiar = acciones.filter((x) => x.accion === "limpiar");
  const aRetirar = acciones.filter((x) => x.accion === "retirar");
  console.log(`alias sueltos con anotaciones/url/@: ${sueltos.length} · limpiar: ${aLimpiar.length} · retirar: ${aRetirar.length} · omitidos: ${acciones.length - aLimpiar.length - aRetirar.length}`);
  const informe = { limpiar: aLimpiar.map((x) => ({ antes: x.fila.alias, despues: x.nuevo, artista: x.fila.nombre })), retirar: aRetirar.map((x) => ({ alias: x.fila.alias, artista: x.fila.nombre, motivo: x.motivo })), omitidos: acciones.filter((x) => x.accion === "omitir").map((x) => ({ alias: x.fila.alias, artista: x.fila.nombre, motivo: x.motivo })) };
  if (!confirm) { writeFileSync(path.join(DIR, "alias-sueltos-ensayo.json"), JSON.stringify(informe, null, 1)); return; }
  const { runId, result } = await withOperatorRun({
    name: "hermes:anomalias-alias-sueltos",
    operator: "hermes (encargo de Brian 2026-10-16)",
    note: "Alias con anotaciones de fuente («[birth name]», «[2017-2019]») o con @/URL: se limpia la anotación conservando el nombre (p. ej. «Ulises Evangelos Hadjis Labarca [birth name]» → «Ulises Evangelos Hadjis Labarca»); si tras limpiar no queda nada usable o ya existe el alias, se retira la fila.",
  }, async (context) => {
    let limpiados = 0, retirados = 0;
    for (const x of aLimpiar) { await updateAlias(context, "artist", x.fila.artistId, x.fila.id, { alias: x.nuevo! }); limpiados++; }
    for (const x of aRetirar) { await deleteAlias(context, "artist", x.fila.artistId, x.fila.id); retirados++; }
    return { limpiados, retirados };
  });
  writeFileSync(path.join(DIR, `alias-sueltos-run${runId}.json`), JSON.stringify({ runId, ...result, informe }, null, 1));
  console.log(`run ${runId}: ${result.limpiados} alias limpiados · ${result.retirados} retirados`);
}

async function moduloCompartidos(): Promise<void> {
  const { rows } = await getPool().query<Record<string, unknown>>(`
    SELECT lower(btrim(al.alias)) AS clave, count(DISTINCT al.artist_id) AS n,
           string_agg(al.artist_id::text || '=' || a.name, ' | ' ORDER BY al.artist_id) AS fichas
    FROM ingest.artist_aliases al JOIN public.artists a ON a.id = al.artist_id
    GROUP BY 1 HAVING count(DISTINCT al.artist_id) > 1 ORDER BY 2 DESC, 1`);
  const informe = rows.map((r) => ({ alias: String(r["clave"]), fichas: String(r["fichas"]) }));
  writeFileSync(path.join(DIR, "alias-compartidos-informe.json"), JSON.stringify(informe, null, 1));
  console.log(`alias compartidos por 2+ fichas: ${informe.length} (solo informe; no se tocan)`);
}

async function main(): Promise<void> {
  if (modulo === "todo" || modulo === "alias-compuestos") await moduloAliasCompuestos();
  if (modulo === "todo" || modulo === "alias-sueltos") await moduloAliasSueltos();
  if (modulo === "todo" || modulo === "alias-redundantes") await moduloAliasRedundantes();
  if (modulo === "todo" || modulo === "membresias") await moduloMembresias();
  if (modulo === "todo" || modulo === "compartidos") await moduloCompartidos();
  if (!confirm) console.log("dry-run: informes en " + DIR + "; luego --confirm");
  await closeDb();
}

main().catch(async (error: unknown) => { console.error(error); await closeDb(); process.exit(1); });
