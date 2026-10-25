// Traducción al español de los «temas de las letras» de las fichas de artista.
//
// `public.artists.themes` llegó desde las fichas de Metal Archives, que lo traen en inglés
// («Death, War, Society»). La traducción NO es libre ni ficha por ficha: hay un glosario cerrado
// EN→ES (reports/themes-es-2026-10-15/glosario-en-es.json, 312 términos + 2 calificadores) y el
// ledger de propuesta (propuesta.jsonl) con el antes/después de cada artista, generado con la misma
// tokenización que usa `themes` (segmentos por «,» y «;», con paréntesis calificadores).
//
// La escritura va por el camino sancionado: cada lote es UN run del operador con `updateEntity`,
// que deja claim humano + auditoría (merge_audit guarda el valor anterior → deshacer = undo del run).
//
// Uso: ./scripts/with-node22.sh npx tsx scripts/traducir-themes-2026-10-15.ts [--confirm] [--lote=N] [--limit=N]
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { closeDb, getPool } from "../src/db/client.js";
import { updateEntity, withOperatorRun } from "../src/merge/operator.js";

const DIR = "reports/themes-es-2026-10-15";
const confirm = process.argv.includes("--confirm");
const tamanoLote = Number(process.argv.find((v) => v.startsWith("--lote="))?.slice(7) ?? 80);
const limite = Number(process.argv.find((v) => v.startsWith("--limit="))?.slice(8) ?? 0);

interface Fila { id: number; name: string; antes: string; despues: string }

async function main(): Promise<void> {
  mkdirSync(DIR, { recursive: true });
  const propuesta = readFileSync(path.join(DIR, "propuesta.jsonl"), "utf8")
    .split("\n").filter(Boolean).map((l) => JSON.parse(l) as Fila);

  const aplicar = propuesta.filter((f) => f.antes !== f.despues);
  const sinCambio = propuesta.filter((f) => f.antes === f.despues);
  console.log(`propuesta: ${propuesta.length} · a traducir: ${aplicar.length} · ya en español (mismo texto): ${sinCambio.length}`);
  if (sinCambio.length > 0) console.log(`  sin cambio: ${sinCambio.map((f) => f.name).join(", ")}`);

  const pool = getPool();
  const ids = propuesta.map((f) => f.id);
  const { rows } = await pool.query<{ id: string; name: string; themes: string | null }>(
    "SELECT id::text, name, themes FROM public.artists WHERE id = ANY($1::int[])", [ids]);
  const actual = new Map(rows.map((r) => [Number(r.id), r]));

  const faltan: number[] = [];
  const drift: Array<{ id: number; name: string; esperado: string; actual: string | null }> = [];
  for (const f of aplicar) {
    const cur = actual.get(f.id);
    if (!cur) { faltan.push(f.id); continue; }
    if ((cur.themes ?? "") !== f.antes) drift.push({ id: f.id, name: f.name, esperado: f.antes, actual: cur.themes });
  }
  if (faltan.length > 0) console.log(`artistas inexistentes (se omiten): ${faltan.join(", ")}`);
  if (drift.length > 0) {
    writeFileSync(path.join(DIR, "drift.json"), JSON.stringify(drift, null, 1));
    console.error(`DRIFT: ${drift.length} fichas ya no tienen el valor esperado (ver ${DIR}/drift.json)`);
    for (const d of drift.slice(0, 8)) console.error(`  ${d.id} ${d.name}: «${d.actual}» ≠ «${d.esperado}»`);
    throw new Error("hay deriva contra la base: revisa antes de aplicar");
  }

  let cola = aplicar.filter((f) => actual.has(f.id));
  if (limite > 0) cola = cola.slice(0, limite);
  console.log(`cola: ${cola.length} fichas · lote de ${tamanoLote}`);
  writeFileSync(path.join(DIR, "ensayo.json"), JSON.stringify(cola.slice(0, 5), null, 1));

  if (!confirm) {
    console.log("dry-run (sin escrituras): repite con --confirm");
    for (const f of cola.slice(0, 4)) console.log(`  ${f.id} ${f.name}: «${f.antes}» → «${f.despues}»`);
    await closeDb();
    return;
  }

  const aplicadosPath = path.join(DIR, "aplicados.jsonl");
  const hechos = new Set<string>(
    existsSync(aplicadosPath)
      ? readFileSync(aplicadosPath, "utf8").split("\n").filter(Boolean).map((l) => String((JSON.parse(l) as { id: number }).id))
      : []);
  cola = cola.filter((f) => !hechos.has(String(f.id)));

  const runs: Array<{ runId: number; desde: number; hasta: number; total: number }> = [];
  for (let i = 0; i < cola.length; i += tamanoLote) {
    const lote = cola.slice(i, i + tamanoLote);
    const { runId, result } = await withOperatorRun({
      name: "hermes:temas-letras-es",
      operator: "hermes (encargo de Brian 2026-10-15)",
      note: `Traducción al español de «temas de las letras» (artists.themes, en inglés por procedencia Metal Archives) por glosario cerrado ${DIR}/glosario-en-es.json; lote ${Math.floor(i / tamanoLote) + 1} de ${Math.ceil(cola.length / tamanoLote)}.`,
    }, async (context) => {
      let aplicados = 0;
      for (const f of lote) {
        await updateEntity(context, "artist", f.id, { themes: f.despues });
        appendFileSync(aplicadosPath, JSON.stringify({ id: f.id, name: f.name, antes: f.antes, despues: f.despues, runId: context.runId }) + "\n");
        aplicados++;
      }
      return { aplicados };
    });
    runs.push({ runId, desde: lote[0]!.id, hasta: lote[lote.length - 1]!.id, total: result.aplicados });
    console.log(`run ${runId}: ${result.aplicados} fichas traducidas (desde ${lote[0]!.id} hasta ${lote[lote.length - 1]!.id})`);
  }

  const { rows: post } = await pool.query<{ n: string }>(
    "SELECT count(*)::text AS n FROM public.artists WHERE id = ANY($1::int[]) AND themes = ANY($2::text[])",
    [ids, aplicar.map((f) => f.despues)]);
  writeFileSync(path.join(DIR, `aplicacion-${Date.now()}.json`), JSON.stringify({
    propuesta: propuesta.length, aTraducir: aplicar.length, aplicadas: runs.reduce((s, r) => s + r.total, 0), runs,
  }, null, 1));
  console.log(`hecho: ${runs.reduce((s, r) => s + r.total, 0)} fichas en ${runs.length} runs · control por SQL (themes == esperado): ${post[0]?.n}`);
  await closeDb();
}

main().catch(async (error: unknown) => { console.error(error); await closeDb(); process.exit(1); });
