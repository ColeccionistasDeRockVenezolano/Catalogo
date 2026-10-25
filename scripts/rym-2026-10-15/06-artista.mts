// Campaña RYM 2026-10-15 · FASE 5: ficha de artista y personas, desde las fichas de artista de RYM.
//
//   Also Known As → alias (name_variant)          Currently → artists.current_city/current_country (fase 11, 0083)
//   Formed        → formed_year y origin_city     Members   → artist_members (rol, años, vigente)
//   Born / Died   → birth_date, death_date, birth_city, is_deceased de la persona homónima
//
// CORREGIDO 2026-10-16: la versión original leía «Currently» como «otro nombre del proyecto» y lo
// escribía como alias — en realidad es la UBICACIÓN ACTUAL del artista (campo propio desde la
// migración 0083). El error dejó ~515 ciudades como alias (lote 2026-10-15); las fases 11 y 12
// (11-ubicacion-actual.mts · 12-limpiar-alias-ubicacion.mts) llevan el dato a su campo y retiran
// los alias. Este script ya NO escribe «Currently» como alias.
//
// Reglas: solo se llenan huecos; la persona de un miembro debe existir ya en el catálogo (nombre o
// alias exacto) y no tener ya membresía en ese artista; las fechas parciales (solo año) se reportan.
// Uso: ./scripts/with-node22.sh npx tsx scripts/rym-2026-10-15/06-artista.mts [--confirm] [--limit=N]
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createAlias } from "../../src/api/repositories/aliases.js";
import { closeDb, getPool } from "../../src/db/client.js";
import { createRelation, updateEntity } from "../../src/merge/operator.js";
import { assertRymIdentity, readRymIdentityLedger, rymHref } from "../../src/verification/rym-identity.js";
import { applyRymBatches } from "../../src/verification/rym-batches.js";

// La campaña «resto» (2026-10-16) reusa esta fase: --dir (informes) y --v4 (re-parseo) apuntan a lo suyo.
const argumento = (nombre: string): string | undefined => {
  const i = process.argv.indexOf(nombre);
  return i < 0 ? undefined : process.argv[i + 1];
};
const DIR = argumento("--dir") ?? "reports/rym-2026-10-15";
const V4 = argumento("--v4") ?? "reports/rym-v4-2026-10-04/artistas.jsonl";
const confirm = process.argv.includes("--confirm");
const limite = Number(process.argv.find((v) => v.startsWith("--limit="))?.slice(8) ?? 0);

interface Ficha { slug: string; href: string; nombre: string; formed: string | null; foto: string | null; info: Record<string, string> }

const MESES: Record<string, string> = { january: "01", february: "02", march: "03", april: "04", may: "05", june: "06", july: "07", august: "08", september: "09", october: "10", november: "11", december: "12" };

function normalizar(t: string): string {
  return t.normalize("NFD").replace(/[\u0300-\u036f]/gu, "").toLowerCase().replace(/[^a-z0-9]+/gu, " ").trim();
}

/** «31 December 1872, Vorozhba, Sums'ka Oblast', Ukraine» → { fecha: '1872-12-31', ciudad: 'Vorozhba', completa: true } */
function partirFecha(texto: string | undefined): { fecha: string | null; ciudad: string | null; completa: boolean } {
  if (!texto) return { fecha: null, ciudad: null, completa: false };
  const limpio = texto.replace(/\s+/gu, " ").trim();
  let m = /^(\d{1,2}) ([A-Za-z]+) (\d{4})(?:, (.*))?$/u.exec(limpio);
  if (m) {
    const mes = MESES[m[2]!.toLowerCase()];
    const fecha = mes ? `${m[3]}-${mes}-${String(Number(m[1])).padStart(2, "0")}` : null;
    return { fecha, ciudad: m[4] ? m[4].split(",")[0]!.trim() : null, completa: !!fecha };
  }
  m = /^(\d{4}|[A-Za-z]+ \d{4})(?:, (.*))?$/u.exec(limpio);
  if (m) return { fecha: null, ciudad: m[2] ? m[2].split(",")[0]!.trim() : null, completa: false };
  return { fecha: null, ciudad: limpio.split(",")[0]!.trim() || null, completa: false };
}

/** «2001, Caracas, Distrito Capital, Venezuela» → { anio: 2001, ciudad: 'Caracas, Distrito Capital' } */
function partirFormed(texto: string | number | undefined): { anio: number | null; ciudad: string | null } {
  if (!texto) return { anio: null, ciudad: null };
  const partes = String(texto).split(",").map((p) => p.trim()).filter(Boolean);
  // RYM también usa «October 1985, Venezuela» y «8 May 1925, Santiago de Cuba».
  // La fecha describe la formación; jamás debe acabar en origin_city.
  const fecha = /^(?:(?:\d{1,2}\s+)?[A-Za-z]+\s+)?((?:18|19|20)\d{2})$/u.exec(partes[0] ?? "");
  const anio = fecha ? Number(fecha[1]) : null;
  const resto = partes.slice(fecha ? 1 : 0);
  const pais = /^(venezuela|usa|united states|uk|united kingdom|españa|spain|mexico|méxico|colombia|argentina|chile|peru|perú|cuba)$/iu;
  const ciudad = resto.filter((p) => !pais.test(p)).join(", ") || null;
  return { anio, ciudad: ciudad ? ciudad.slice(0, 120) : null };
}

/** «Karen M. González (guitar, synthesizer, lead vocals), Edmanuel Castillo (bass, 2007-present)» */
function partirMiembros(texto: string): Array<{ nombre: string; role: string; desde: number | null; hasta: number | null; vigente: boolean }> {
  const salida = [];
  for (const trozo of texto.split(/\),\s*/u)) {
    const m = /^(.+?)\s*\(([^)]*)\)?$/u.exec(trozo.trim());
    if (!m) continue;
    const nombre = m[1]!.trim();
    const detalle = (m[2] ?? "").trim();
    let desde: number | null = null, hasta: number | null = null, vigente = false;
    const rango = /(\d{4})\s*[-–]\s*(present|\d{4})/iu.exec(detalle);
    if (rango) {
      desde = Number(rango[1]);
      if (/present/iu.test(rango[2]!)) vigente = true; else hasta = Number(rango[2]);
    }
    const role = detalle.replace(/\(?\d{4}\s*[-–]\s*(?:present|\d{4})\)?/giu, "").replace(/^[,\s]+|[,\s]+$/gu, "");
    if (!nombre || nombre.length < 3) continue;
    salida.push({ nombre, role: role.slice(0, 200) || "Integrante", desde, hasta, vigente });
  }
  return salida;
}

async function main(): Promise<void> {
  if (!existsSync(path.join(DIR, "cruce.jsonl"))) { console.error("falta cruce.jsonl (fase 1)"); process.exit(1); }
  const pool = getPool();
  const identities = readRymIdentityLedger(path.join(DIR, "identity-ledger.json"));
  const artistas = new Map<number, { id: number; name: string; formed_year: number | null; origin_city: string | null; origin_country: string | null; picture_url: string | null; artist_type: string }>();
  for (const r of (await pool.query<{ id: string; name: string; formed_year: number | null; origin_city: string | null; origin_country: string | null; picture_url: string | null; artist_type: string }>(
    "SELECT id::text AS id, name, formed_year, origin_city, origin_country, picture_url, artist_type::text AS artist_type FROM public.artists")).rows) {
    artistas.set(Number(r.id), { ...r, id: Number(r.id) });
  }
  const porNombre = new Map<string, number[]>();
  for (const a of artistas.values()) porNombre.set(normalizar(a.name), [...(porNombre.get(normalizar(a.name)) ?? []), a.id]);
  for (const r of (await pool.query<{ artist_id: string; alias: string }>("SELECT artist_id::text AS artist_id, alias FROM ingest.artist_aliases WHERE is_primary IS NOT TRUE")).rows) {
    porNombre.set(normalizar(r.alias), [...(porNombre.get(normalizar(r.alias)) ?? []), Number(r.artist_id)]);
  }
  const aliasExistentes = new Map<number, Set<string>>();
  for (const r of (await pool.query<{ artist_id: string; alias: string }>("SELECT artist_id::text AS artist_id, alias FROM ingest.artist_aliases")).rows) {
    const id = Number(r.artist_id);
    aliasExistentes.set(id, new Set([...(aliasExistentes.get(id) ?? []), normalizar(r.alias)]));
  }
  const personasPorNombre = new Map<string, number[]>();
  for (const r of (await pool.query<{ id: string; name: string }>("SELECT id::text AS id, name FROM public.persons")).rows) {
    personasPorNombre.set(normalizar(r.name), [...(personasPorNombre.get(normalizar(r.name)) ?? []), Number(r.id)]);
  }
  for (const r of (await pool.query<{ person_id: string; alias: string }>("SELECT person_id::text AS person_id, alias FROM ingest.person_aliases WHERE is_primary IS NOT TRUE")).rows) {
    personasPorNombre.set(normalizar(r.alias), [...(personasPorNombre.get(normalizar(r.alias)) ?? []), Number(r.person_id)]);
  }
  const personas = new Map<number, { birth_date: string | null; death_date: string | null; birth_city: string | null; is_deceased: boolean }>();
  for (const r of (await pool.query<{ id: string; birth_date: string | null; death_date: string | null; birth_city: string | null; is_deceased: boolean }>(
    "SELECT id::text AS id, birth_date::text AS birth_date, death_date::text AS death_date, birth_city, is_deceased FROM public.persons")).rows) {
    personas.set(Number(r.id), { birth_date: r.birth_date, death_date: r.death_date, birth_city: r.birth_city, is_deceased: r.is_deceased });
  }
  const yaMiembro = new Set((await pool.query<{ k: string }>("SELECT artist_id::text || ':' || person_id::text AS k FROM public.artist_members")).rows.map((r) => r.k));

  const fichas = readFileSync(V4, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as Ficha);
  const cuenta: Record<string, number> = {};
  const sumar = (k: string) => { cuenta[k] = (cuenta[k] ?? 0) + 1; };

  const trabajos: Array<{
    artistId: number; href: string; nombre: string; cambios: Record<string, string | number>; alias: string[];
    miembros: Array<{ personId: number; role: string; desde: number | null; hasta: number | null; vigente: boolean }>;
    personas: Array<{ personId: number; cambios: Record<string, string | boolean> }>;
  }> = [];
  const sinPersona: Array<{ artista: string; miembro: string }> = [];

  for (const f of fichas) {
    const identity = identities.identities.find(row => rymHref(row.href) === rymHref(f.href));
    const ids = identity?.status === "resolved" && identity.artistId ? [identity.artistId] : [];
    if (ids.length !== 1) { sumar(ids.length === 0 ? "artista sin ficha en el catálogo" : "artista ambiguo"); continue; }
    const artistId = ids[0]!;
    await assertRymIdentity(pool, identities, f.href, artistId);
    const actual = artistas.get(artistId)!;
    const info = f.info ?? {};
    const cambios: Record<string, string | number> = {};
    const { anio, ciudad } = partirFormed(info["Formed"] ?? f.formed ?? undefined);
    if (anio && !actual.formed_year) cambios["formed_year"] = anio;
    if (ciudad && !actual.origin_city) cambios["origin_city"] = ciudad;

    const alias: string[] = [];
    const vistos = aliasExistentes.get(artistId) ?? new Set<string>();
    // «Currently» NO entra aquí: es la ubicación actual del artista, no un alias (0083; ver fase 11).
    for (const posible of [info["Also Known As"]]) {
      for (const bruto of (posible ?? "").split(/[;|]/u)) {
        const a = bruto.trim();
        if (!a || a.length > 120) continue;
        if (a.includes(',') || /\[[^\]]*\]/u.test(a)) { sumar('alias compuesto pendiente de revisión'); continue; }
        if (vistos.has(normalizar(a)) || normalizar(a) === normalizar(actual.name)) { sumar("alias ya presente"); continue; }
        alias.push(a);
        vistos.add(normalizar(a));
      }
    }

    const miembros: Array<{ personId: number; role: string; desde: number | null; hasta: number | null; vigente: boolean }> = [];
    for (const m of partirMiembros(info["Members"] ?? "")) {
      if (normalizar(m.nombre).split(' ').length < 2) { sinPersona.push({ artista: actual.name, miembro: m.nombre }); sumar('miembro de una palabra (revisión)'); continue; }
      const pids = [...new Set(personasPorNombre.get(normalizar(m.nombre)) ?? [])];
      if (pids.length !== 1) { sumar(pids.length === 0 ? "miembro sin ficha de persona" : "miembro ambiguo"); sinPersona.push({ artista: actual.name, miembro: m.nombre }); continue; }
      if (yaMiembro.has(`${artistId}:${pids[0]}`)) { sumar("membresía ya presente"); continue; }
      miembros.push({ personId: pids[0]!, role: m.role, desde: m.desde, hasta: m.hasta, vigente: m.vigente });
      yaMiembro.add(`${artistId}:${pids[0]}`);
    }

    const personasCambios: Array<{ personId: number; cambios: Record<string, string | boolean> }> = [];
    const nacimiento = partirFecha(info["Born"]);
    const muerte = partirFecha(info["Died"]);
    if (nacimiento.fecha || muerte.fecha || nacimiento.ciudad) {
      const pids = [...new Set(personasPorNombre.get(normalizar(f.nombre ?? "")) ?? [])];
      if (pids.length === 1 && yaMiembro.has(`${artistId}:${pids[0]}`)) {
        const p = personas.get(pids[0]!)!;
        const cambiosP: Record<string, string | boolean> = {};
        if (nacimiento.completa && nacimiento.fecha && !p.birth_date) cambiosP["birth_date"] = nacimiento.fecha;
        if (muerte.completa && muerte.fecha && !p.death_date) cambiosP["death_date"] = muerte.fecha;
        if (nacimiento.ciudad && !p.birth_city) cambiosP["birth_city"] = nacimiento.ciudad.slice(0, 120);
        if (muerte.fecha && !p.is_deceased) cambiosP["is_deceased"] = true;
        if (Object.keys(cambiosP).length) personasCambios.push({ personId: pids[0]!, cambios: cambiosP });
        else sumar("fechas sin hueco o incompletas");
      } else {
        sumar(pids.length === 0 ? "artista sin persona homónima" : "persona ambigua");
      }
    }

    if (!Object.keys(cambios).length && !alias.length && !miembros.length && !personasCambios.length) { sumar("ficha sin nada que aplicar"); continue; }
    trabajos.push({ artistId, href: f.href, nombre: actual.name, cambios, alias, miembros, personas: personasCambios });
    if (Object.keys(cambios).length) sumar("ficha: campos");
    if (alias.length) sumar(`alias: ${alias.length}`);
    if (miembros.length) sumar(`miembros: ${miembros.length}`);
    if (personasCambios.length) sumar("personas: fechas");
  }

  const lista = limite ? trabajos.slice(0, limite) : trabajos;
  console.log(`artistas con algo que aplicar: ${lista.length} (de ${fichas.length} fichas)`);
  for (const [k, v] of Object.entries(cuenta).sort((a, b) => b[1] - a[1])) console.log(`  ${k}: ${v}`);

  if (lista.length === 0) { await closeDb(); return; }
  if (!confirm) {
    writeFileSync(path.join(DIR, "artista-ensayo.json"), JSON.stringify({ trabajos: lista, sinPersona }, null, 1));
    console.log("dry-run: muestra en artista-ensayo.json; luego --confirm");
    await closeDb();
    return;
  }

  const count = { campos: 0, aliasCreados: 0, miembros: 0, personasCambiadas: 0 };
  const result = await applyRymBatches({ directory: DIR, phase: 'artista', items: lista,
    apply: async (context, t) => {
      await assertRymIdentity(context.client, identities, t.href, t.artistId);
      const before = JSON.stringify(count);
      const current = (await context.client.query<Record<string, unknown>>('SELECT * FROM public.artists WHERE id=$1 FOR UPDATE', [t.artistId])).rows[0]!;
      const fields = Object.fromEntries(Object.entries(t.cambios).filter(([field]) => current[field] === null || current[field] === ''));
      if (Object.keys(fields).length) { await updateEntity(context, 'artist', t.artistId, fields); count.campos++; }
      for (const a of t.alias) {
        const found = await context.client.query('SELECT 1 FROM ingest.artist_aliases WHERE artist_id=$1 AND alias=$2', [t.artistId, a]);
        if (!found.rowCount) { await createAlias(context, 'artist', t.artistId, { alias: a, aliasType: 'name_variant', isPrimary: false }); count.aliasCreados++; }
      }
      for (const m of t.miembros) {
        const found = await context.client.query('SELECT 1 FROM public.artist_members WHERE artist_id=$1 AND person_id=$2', [t.artistId,m.personId]);
        if (found.rowCount) continue;
        await createRelation(context, "artist_membership", { artistId: t.artistId, personId: m.personId }, {
          role: m.role, from_year: m.desde ?? undefined, to_year: m.hasta ?? undefined,
          is_current: m.vigente ? "true" : "false",
        });
        count.miembros++;
      }
      for (const p of t.personas) {
        const person = (await context.client.query<Record<string, unknown>>('SELECT * FROM public.persons WHERE id=$1 FOR UPDATE', [p.personId])).rows[0];
        if (!person) throw new Error('Persona retirada durante el lote');
        const values = Object.fromEntries(Object.entries(p.cambios).filter(([field]) => person[field] === null || person[field] === '' || field === 'is_deceased' && person[field] === false));
        if (Object.keys(values).length) { await updateEntity(context, 'person', p.personId, values); count.personasCambiadas++; }
      }
      return JSON.stringify(count) !== before;
    } });
  writeFileSync(path.join(DIR, 'artista-aplicado.json'), JSON.stringify({ ...result, ...count, cuenta, sinPersona }, null, 2)+'\n');
  await closeDb();
}

main().catch(async (error: unknown) => { console.error(error); await closeDb(); process.exit(1); });
