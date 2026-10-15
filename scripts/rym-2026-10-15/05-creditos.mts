// Campaña RYM 2026-10-15 · FASE 4: créditos de disco de las fichas de RYM.
//
// RYM lista los créditos de cada disco (nombre + rol). Se aplican SOLO cuando la persona ya existe
// en el catálogo con el nombre exacto (normalizado, o por uno de sus alias): no se crean personas
// aquí (eso es otra decisión, con sus guardas). Los que no casan van al informe.
//
// El tipo de crédito lo clasifica el propio motor (`creditTypeForRole`, src/merge/relations.ts), el
// mismo que usa el resto del pipeline; los roles del mismo tipo se agrupan por (disco, persona).
//
// Uso: ./scripts/with-node22.sh npx tsx scripts/rym-2026-10-15/05-creditos.mts [--confirm] [--limit=N]
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { closeDb, getPool } from "../../src/db/client.js";
import { createRelation, withOperatorRun } from "../../src/merge/operator.js";
import { creditTypeForRole } from "../../src/merge/relations.js";

// La campaña «resto» (2026-10-16) reusa esta fase: --dir (informes) y --v4 (re-parseo) apuntan a lo suyo.
const argumento = (nombre: string): string | undefined => {
  const i = process.argv.indexOf(nombre);
  return i < 0 ? undefined : process.argv[i + 1];
};
const DIR = argumento("--dir") ?? "reports/rym-2026-10-15";
const V4 = argumento("--v4") ?? "reports/rym-v4-2026-10-04/albumes.jsonl";
const confirm = process.argv.includes("--confirm");
const limite = Number(process.argv.find((v) => v.startsWith("--limit="))?.slice(8) ?? 0);

interface Credito { nombre: string; roles: string | null; href: string | null }

function normalizar(t: string): string {
  return t.normalize("NFD").replace(/[\u0300-\u036f]/gu, "").toLowerCase().replace(/[^a-z0-9]+/gu, " ").trim();
}

async function main(): Promise<void> {
  if (!existsSync(path.join(DIR, "cruce.jsonl"))) { console.error("falta cruce.jsonl (fase 1)"); process.exit(1); }
  const cruce = new Map<string, { albumId: number; artistId: number }>();
  for (const l of readFileSync(path.join(DIR, "cruce.jsonl"), "utf8").split("\n").filter(Boolean)) {
    const d = JSON.parse(l) as { slug: string; albumId: number; artistId: number };
    cruce.set(d.slug, d);
  }

  const pool = getPool();
  const porNombre = new Map<string, number[]>();
  for (const r of (await pool.query<{ id: string; name: string }>("SELECT id::text AS id, name FROM public.persons")).rows) {
    const k = normalizar(r.name);
    porNombre.set(k, [...(porNombre.get(k) ?? []), Number(r.id)]);
  }
  for (const r of (await pool.query<{ person_id: string; alias: string }>("SELECT person_id::text AS person_id, alias FROM ingest.person_aliases WHERE is_primary IS NOT TRUE")).rows) {
    const k = normalizar(r.alias);
    porNombre.set(k, [...(porNombre.get(k) ?? []), Number(r.person_id)]);
  }
  const artistas = new Set((await pool.query<{ name: string }>("SELECT name FROM public.artists")).rows.map((r) => normalizar(r.name)));

  // (albumId|personId|creditType) → roles
  const grupos = new Map<string, { albumId: number; personId: number; tipo: string; roles: Set<string> }>();
  const cuenta: Record<string, number> = {};
  const sinCasar: Array<{ nombre: string; albumId: number; roles: string }> = [];
  const sumar = (k: string) => { cuenta[k] = (cuenta[k] ?? 0) + 1; };
  let revisados = 0;

  for (const l of readFileSync(V4, "utf8").split("\n").filter(Boolean)) {
    const d = JSON.parse(l) as { slug: string; creditos?: Credito[] };
    const c = cruce.get(d.slug);
    if (!c || !d.creditos?.length) continue;
    for (const credito of d.creditos) {
      const nombre = (credito.nombre ?? "").trim();
      if (!nombre) continue;
      revisados++;
      const ids = [...new Set(porNombre.get(normalizar(nombre)) ?? [])];
      if (ids.length === 0) {
        if (artistas.has(normalizar(nombre))) sumar("credito de un artista (no persona)");
        else { sumar("sin ficha de persona"); if (sinCasar.length < 4000) sinCasar.push({ nombre, albumId: c.albumId, roles: credito.roles ?? "" }); }
        continue;
      }
      if (ids.length > 1) { sumar("ambiguo (varias personas)"); continue; }
      const conRol = !!(credito.roles ?? "").trim();
      const role = conRol ? credito.roles!.trim() : "Musician";
      // Sin rol publicado, RYM lista al acreditado como músico: se declara el tipo en vez de dejar
      // que el clasificador mande «Musician» a `other`.
      const tipo = conRol ? creditTypeForRole(role) : "musician";
      const clave = `${c.albumId}|${ids[0]}|${tipo}`;
      const grupo = grupos.get(clave) ?? { albumId: c.albumId, personId: ids[0]!, tipo, roles: new Set<string>() };
      grupo.roles.add(role);
      grupos.set(clave, grupo);
      sumar(`tipo ${tipo}`);
    }
  }

  const trabajos = [...grupos.values()].map((g) => ({ albumId: g.albumId, personId: g.personId, tipo: g.tipo, role: [...g.roles].join(", ").slice(0, 200) }));
  const lista = limite ? trabajos.slice(0, limite) : trabajos;
  console.log(`créditos leídos: ${revisados} · filas a escribir: ${lista.length} (agrupadas por disco+persona+tipo)`);
  for (const [k, v] of Object.entries(cuenta).sort((a, b) => b[1] - a[1])) console.log(`  ${k}: ${v}`);

  if (lista.length === 0) { await closeDb(); return; }
  if (!confirm) {
    writeFileSync(path.join(DIR, "creditos-sin-persona.json"), JSON.stringify(sinCasar, null, 1));
    writeFileSync(path.join(DIR, "creditos-ensayo.json"), JSON.stringify(lista.slice(0, 300), null, 1));
    console.log("dry-run: revisa creditos-ensayo.json y creditos-sin-persona.json; luego --confirm");
    await closeDb();
    return;
  }

  const { runId, result } = await withOperatorRun({
    name: "hermes:rym-creditos",
    operator: "hermes (encargo de Brian 2026-10-15)",
    note: "Créditos de disco de las fichas de RYM, solo cuando la persona ya existe en el catálogo (nombre o alias exacto); tipos clasificados por creditTypeForRole.",
  }, async (context) => {
    let creados = 0, yaEstaban = 0;
    for (const t of lista) {
      const r = await createRelation(context, "album_credit", { albumId: t.albumId, personId: t.personId },
        { credit_role: t.role, credit_type: t.tipo });
      if (r.created) creados++; else yaEstaban++;
    }
    return { creados, yaEstaban };
  });
  writeFileSync(path.join(DIR, `creditos-run${runId}.json`), JSON.stringify({ runId, ...result, cuenta }, null, 1));
  console.log(`run ${runId}: ${result.creados} créditos nuevos · ${result.yaEstaban} ya estaban`);
  await closeDb();
}

main().catch(async (error: unknown) => { console.error(error); await closeDb(); process.exit(1); });
