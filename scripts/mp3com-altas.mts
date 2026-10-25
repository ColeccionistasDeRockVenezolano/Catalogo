/**
 * Altas de fichas venezolanas del volcado MP3.com 2003 (mp3-2003.computer-legacy.com).
 *
 * Camino sancionado del operador: createEntity (guardas ER + run) y después un claim
 * aceptado con evidencia por campo, apuntando a la ficha original de MP3.com.
 * Reversible con `crv runs undo <id>`.
 *
 * Uso:
 *   MP3COM_OUT=~/crv-staging/reports/mp3com-2003 tsx scripts/mp3com-altas.mts            # seco
 *   ... --confirm [--limit=50] [--batch=100]
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { closeDb, getPool } from "../src/db/client.js";
import { OperatorError, createEntity, withOperatorRun, type OperatorContext } from "../src/merge/operator.js";
import { normalizeEntityName } from "../src/normalization/entity-name.js";
import { classifyPersonName } from "../src/review/person-junk.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = process.env["MP3COM_OUT"] ?? path.join(process.env["HOME"] ?? ROOT, "crv-staging/reports/mp3com-2003");
const PLAN = process.env["MP3COM_PLAN"] ?? path.join(OUT, "plan-altas.jsonl");
const SOURCE_SLUG = "mp3-com-2003-project";
const args = process.argv.slice(2);
const CONFIRM = args.includes("--confirm");
const BATCH = Number(args.find((a) => a.startsWith("--batch="))?.split("=")[1] ?? 100);
const LIMIT = Number(args.find((a) => a.startsWith("--limit="))?.split("=")[1] ?? 0);

interface PlanItem {
  clave: string; tipo: "artist"; nombre: string;
  values: Record<string, unknown>;
  evidencia: { url: string; url_artista?: string; excerpt: string; motivo?: string };
  origen: string; nivel: "A" | "B";
}

const sha = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex");
const ts = () => new Date().toISOString().replace(/[-:T]/g, "").slice(0, 12);

function cargarPlan(): PlanItem[] {
  const items = readFileSync(PLAN, "utf8").split("\n").filter((l) => l.trim())
    .map((l) => JSON.parse(l) as PlanItem);
  for (const it of items) {
    if (!it.nombre?.trim()) throw new Error(`ítem sin nombre: ${it.clave}`);
    if (!it.values?.["name"]) throw new Error(`ítem sin values.name: ${it.clave}`);
  }
  return LIMIT > 0 ? items.slice(0, LIMIT) : items;
}

/** Claim aceptado con la evidencia real de MP3.com (no pasa por el merge: sólo procedencia). */
async function claimFuente(context: OperatorContext, sourceId: number, it: PlanItem, artistId: number, field: string, value: unknown): Promise<void> {
  const identity = `${SOURCE_SLUG}:${it.clave}:${field}`;
  const claim = await context.client.query<{ id: string }>(
    `INSERT INTO ingest.claims(source_id,entity_kind,artist_id,field,raw_value,normalized_value,raw_hash,extractor,
        extractor_version,confidence,status,created_by,run_id,notes,identity_key)
     VALUES($1,'artist',$2,$3,$4::jsonb,$4::jsonb,$5,'captura-mp3com-2003','1','medium','accepted','human',$6,$7,$8)
     ON CONFLICT DO NOTHING RETURNING id::text`,
    [sourceId, artistId, field, JSON.stringify(value), sha(["artist", identity, field, value, it.evidencia.url]),
     context.runId,
     `${field} según MP3.com (volcado de 2003, ${it.evidencia.url}): ${String(value).slice(0, 300)}`,
     identity]);
  const claimId = claim.rows[0]?.id;
  if (!claimId) return;
  await context.client.query(
    `INSERT INTO ingest.claim_evidence(claim_id,url,excerpt,position,evidence_hash)
     VALUES($1,$2,$3,0,$4) ON CONFLICT DO NOTHING`,
    [claimId, it.evidencia.url, `${it.evidencia.excerpt} · ${field}=${String(value).slice(0, 300)}`.slice(0, 500),
     sha([it.evidencia.url, it.evidencia.excerpt, field])]);
}

/** Claves de identidad ya ocupadas (artistas, alias, personas, alias de persona). */
async function clavesOcupadas(): Promise<Map<string, { kind: string; id: number; name: string }>> {
  const pool = getPool();
  const map = new Map<string, { kind: string; id: number; name: string }>();
  const put = (kind: string, id: number, name: string) => {
    const n = normalizeEntityName(name);
    for (const k of new Set([n.compactSecondaryKey, n.articlelessSecondaryKey])) if (k && !map.has(k)) map.set(k, { kind, id, name });
  };
  for (const r of (await pool.query<{ id: string; name: string }>("SELECT id::text,name FROM public.artists")).rows) put("artist", Number(r.id), r.name);
  for (const r of (await pool.query<{ artist_id: string; alias: string }>("SELECT artist_id::text,alias FROM ingest.artist_aliases")).rows) put("alias", Number(r.artist_id), r.alias);
  for (const r of (await pool.query<{ id: string; name: string }>("SELECT id::text,name FROM public.persons")).rows) put("person", Number(r.id), r.name);
  return map;
}

async function sondaEr(items: PlanItem[], ocupadas: Map<string, unknown>): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const it of items) {
    const n = normalizeEntityName(it.values["name"] as string);
    const hit = ocupadas.get(n.compactSecondaryKey);
    if (hit) { out[it.clave] = `ya existe (${JSON.stringify(hit)})`; continue; }
    const cls = classifyPersonName(it.nombre);
    if (cls.kind !== "ok") out[it.clave] = `nombre sospechoso (${cls.kind}): ${cls.reason}`;
  }
  try {
    await withOperatorRun({
      name: "hermes:mp3com-altas-sonda (revertida)",
      operator: "hermes (sonda MP3.com)",
      note: "Sonda de altas MP3.com 2003; se revierte al final, no escribe nada.",
    }, async (context) => {
      for (const it of items) {
        if (out[it.clave]?.startsWith("ya existe")) continue;
        await context.client.query("SAVEPOINT s");
        const t0 = Date.now();
        try {
          const res = await createEntity(context, "artist", it.values);
          out[it.clave] = `crearía #${res.id} (${Date.now() - t0}ms)`;
          await context.client.query("ROLLBACK TO SAVEPOINT s");
          await context.client.query("RELEASE SAVEPOINT s");
        } catch (error) {
          if (error instanceof OperatorError) {
            out[it.clave] = `${error.code}: ${error.message.slice(0, 140)}`;
            if (error.code === "needs_review") {
              // Por id: la tabla tiene 2,2 M de filas y `input_name_original` no está indexado (12 s por consulta).
              const rd = error.details?.["resolutionDecisionId"] as number | undefined;
              const dec = rd
                ? await context.client.query<{ score: string | null }>("SELECT score::text FROM ingest.entity_resolution_decisions WHERE id=$1", [rd])
                : { rows: [] as Array<{ score: string | null }> };
              const score = Number(dec.rows[0]?.score ?? 1);
              out[it.clave] = `ER score ${score.toFixed(2)} → ${score < 0.66 ? "crearía con allowSimilar" : "quedaría en cola"}`;
            }
          } else out[it.clave] = (error as Error).message.slice(0, 140);
          await context.client.query("ROLLBACK TO SAVEPOINT s");
          await context.client.query("RELEASE SAVEPOINT s");
        }
      }
      throw new Error("probe-rollback-confirmado");
    });
  } catch (error) {
    if (!(error instanceof Error) || error.message !== "probe-rollback-confirmado") throw error;
  }
  return out;
}

async function aplicar(items: PlanItem[]): Promise<void> {
  const pool = getPool();
  const src = await pool.query<{ id: string }>("SELECT id::text FROM ingest.sources WHERE slug=$1", [SOURCE_SLUG]);
  const sourceId = Number(src.rows[0]?.id);
  if (!sourceId) throw new Error(`fuente ${SOURCE_SLUG} no registrada: corre sources:add / sources:approve`);

  const creadas: unknown[] = []; const review: unknown[] = []; const errors: unknown[] = []; const runs: number[] = [];
  for (let i = 0; i < items.length; i += BATCH) {
    const slice = items.slice(i, i + BATCH);
    const { runId, result } = await withOperatorRun({
      name: `hermes:mp3com-2003-altas (${i + 1}-${i + slice.length}/${items.length})`,
      operator: "hermes (delegado por Brian)",
      note: "Alta de fichas venezolanas del volcado MP3.com 2003 (mp3-2003.computer-legacy.com), con evidencia por campo.",
    }, async (context) => {
      let hechas = 0;
      for (const it of slice) {
        await context.client.query("SAVEPOINT alt");
        try {
          let id: number | null = null;
          try {
            id = (await createEntity(context, "artist", it.values)).id;
          } catch (error) {
            if (error instanceof OperatorError && error.code === "needs_review") {
              const rdId = error.details?.["resolutionDecisionId"] as number | undefined;
              const dec = rdId
                ? await context.client.query<{ score: string | null }>("SELECT score::text FROM ingest.entity_resolution_decisions WHERE id=$1", [rdId])
                : { rows: [] as Array<{ score: string | null }> };
              const score = Number(dec.rows[0]?.score ?? 1);
              if (score < 0.66) {
                id = (await createEntity(context, "artist", it.values, { allowSimilar: true })).id;
                if (rdId) {
                  await context.client.query(
                    `UPDATE ingest.review_queue SET status='dismissed', resolved_by='human',
                        resolution_note=$2, resolved_at=now(), updated_at=now()
                      WHERE status IN ('open','in_progress') AND payload->>'resolutionDecisionId' = $1`,
                    [String(rdId), `Alta MP3.com como ficha distinta con allowSimilar (run ${context.runId}, score ${score.toFixed(3)}).`]);
                }
              } else {
                review.push({ clave: it.clave, nombre: it.nombre, score, detalle: "ER: posible duplicado, queda en cola" });
              }
            } else if (error instanceof OperatorError && error.code === "already_exists") {
              review.push({ clave: it.clave, nombre: it.nombre, existingId: error.details?.["existingId"], detalle: "ya existe (ER)" });
            } else if (error instanceof OperatorError && error.code === "invalid") {
              review.push({ clave: it.clave, nombre: it.nombre, detalle: `invalid: ${error.message.slice(0, 160)}` });
            } else throw error;
          }
          if (id) {
            for (const [field, value] of Object.entries(it.values)) {
              await claimFuente(context, sourceId, it, id, field, value);
            }
            creadas.push({ clave: it.clave, id, nombre: it.nombre, nivel: it.nivel, url: it.evidencia.url });
            hechas += 1;
          }
          await context.client.query("RELEASE SAVEPOINT alt");
        } catch (error) {
          await context.client.query("ROLLBACK TO SAVEPOINT alt");
          await context.client.query("RELEASE SAVEPOINT alt");
          errors.push({ clave: it.clave, nombre: it.nombre, error: (error instanceof Error ? error.message : String(error)).slice(0, 220) });
        }
      }
      return hechas;
    });
    runs.push(runId);
    console.log(`lote ${i + 1}-${i + slice.length}: run ${runId}, ${result} altas`);
  }
  const informe = { generado: new Date().toISOString(), plan: PLAN, runs, creadas, review, errors };
  writeFileSync(path.join(OUT, `altas-apply-${ts()}.json`), JSON.stringify(informe, null, 1));
  console.log(`TOTAL: ${creadas.length} creadas | ${review.length} a cola | ${errors.length} errores | runs ${runs.join(",")}`);
  for (const x of [...review, ...errors].slice(0, 15)) console.log("  ", JSON.stringify(x).slice(0, 220));
}

async function main(): Promise<void> {
  if (!existsSync(PLAN)) throw new Error(`falta el plan: ${PLAN}`);
  const items = cargarPlan();
  console.log(`plan: ${PLAN} (${items.length} fichas)`);
  const ocupadas = await clavesOcupadas();
  if (!CONFIRM) {
    console.log("modo EN SECO: sonda ER en transacción revertida…");
    const er = await sondaEr(items, ocupadas);
    const resumen: Record<string, number> = {};
    for (const v of Object.values(er)) { const k = v.split(":")[0]!.split(" score")[0]!; resumen[k] = (resumen[k] ?? 0) + 1; }
    writeFileSync(path.join(OUT, `altas-dry-run-${ts()}.json`), JSON.stringify({ generado: new Date().toISOString(), plan: PLAN, sonda: er }, null, 1));
    console.log(`sonda ER: ${JSON.stringify(resumen)}`);
    for (const [k, v] of Object.entries(er).slice(0, 25)) console.log(`  ${k} → ${v}`);
    await closeDb();
    return;
  }
  console.log("modo APLICAR (--confirm)");
  await aplicar(items);
  await closeDb();
}

main().catch(async (error: unknown) => { console.error(error); await closeDb(); process.exit(1); });
