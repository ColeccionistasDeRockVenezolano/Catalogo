// Relleno de huecos con los datos de los duplicados RYM (plan-relleno.jsonl).
// Solo campos VACÍOS: origin_city y formed_year de artistas (las personas quedaron fuera del plan
// porque su año de nacimiento exige decidir formato de fecha). Claim + evidencia por escritura
// (fuente `rateyourmusic`), runs reversibles por lotes, savepoint por fila. Ensayo por defecto.
//
// Uso: tsx scripts/rym-venezolanos-2026-10-17/02-apply-relleno.ts [--confirm] [--batch=100]
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { closeDb, getPool } from "../../src/db/client.js";
import { OperatorError, updateEntity, withOperatorRun, type OperatorContext } from "../../src/merge/operator.js";

interface FilaRelleno {
  tabla: "artists" | "persons";
  id: number;
  campo: "origin_city" | "formed_year";
  valor: string | number;
  catalogo: string;
  rym: string;
  slug: string;
  rym_url: string;
  referencia: string;
  puntos_er: number;
}

const args = process.argv.slice(2);
const argVal = (name: string) => args.find((v) => v.startsWith(`--${name}=`))?.split("=")[1];
const confirm = args.includes("--confirm");
const BATCH = Number(argVal("batch") ?? 100);
const DIR = "reports/rym-venezolanos-2026-10-17";
const EXTRACTOR = "rym-duplicados-relleno";
const SOURCE_SLUG = "rateyourmusic";
const CAMPOS = new Set(["origin_city", "formed_year"]);
const sha = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex");

async function main(): Promise<void> {
  const pool = getPool();
  const fuente = await pool.query<{ id: string }>("SELECT id::text FROM ingest.sources WHERE slug=$1", [SOURCE_SLUG]);
  const sourceId = Number(fuente.rows[0]?.id);
  if (!sourceId) throw new Error(`fuente ${SOURCE_SLUG} no existe`);

  const filas = readFileSync(`${DIR}/plan-relleno.jsonl`, "utf8")
    .split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l) as FilaRelleno)
    .filter((f) => f.tabla === "artists" && CAMPOS.has(f.campo));
  console.log(`plan: ${filas.length} filas · ciudad ${filas.filter(f => f.campo === "origin_city").length} · año ${filas.filter(f => f.campo === "formed_year").length}`);

  if (!confirm) {
    for (const f of filas.slice(0, 6)) console.log("  ", JSON.stringify({ artista: f.catalogo, campo: f.campo, valor: f.valor, er: f.puntos_er }).slice(0, 190));
    console.log("ensayo (--confirm para aplicar)");
    await closeDb();
    return;
  }

  const report = { aplicados: 0, yaEstaban: 0, saltados: 0, review: [] as unknown[], errores: [] as unknown[], runs: [] as number[] };
  for (let i = 0; i < filas.length; i += BATCH) {
    const slice = filas.slice(i, i + BATCH);
    const { runId } = await withOperatorRun({
      name: `hermes:rym-relleno-duplicados (${i + 1}-${i + slice.length}/${filas.length})`,
      operator: "hermes (encargo de Brian 2026-10-17)",
      note: "Relleno de ciudad/año con los datos de fichas RYM que ya estaban en el catálogo (duplicados confirmados); solo campos vacíos.",
    }, async (context) => {
      let aplicados = 0;
      for (const f of slice) {
        await context.client.query("SAVEPOINT rym_relleno");
        try {
          const cur = await context.client.query<Record<string, string | number | null>>(
            `SELECT ${f.campo} AS actual FROM public.artists WHERE id=$1 FOR UPDATE`, [f.id]);
          const actual = cur.rows[0]?.["actual"] ?? null;
          if (!cur.rows[0]) {
            report.saltados += 1;
          } else if (actual !== null && String(actual).trim() !== "") {
            report.yaEstaban += 1;
          } else {
            await updateEntity(context, "artist", f.id, { [f.campo]: f.valor });
            aplicados += 1;
            report.aplicados += 1;
            await claim(context, sourceId, f.id, f.campo, { [f.campo]: f.valor }, f.rym_url,
              `Rate Your Music (ficha del artista ya en el catálogo): ${f.referencia}`.slice(0, 480), `rym:relleno:${f.campo}:${f.id}`);
          }
          await context.client.query("RELEASE SAVEPOINT rym_relleno");
        } catch (error) {
          await context.client.query("ROLLBACK TO SAVEPOINT rym_relleno");
          await context.client.query("RELEASE SAVEPOINT rym_relleno");
          if (error instanceof OperatorError && (error.code === "needs_review" || error.code === "invalid")) {
            report.review.push({ fila: f, detail: error.message.slice(0, 180) });
          } else {
            report.errores.push({ fila: f, error: (error instanceof Error ? error.message : String(error)).slice(0, 200) });
          }
        }
      }
      return aplicados;
    });
    report.runs.push(runId);
    writeFileSync(`${DIR}/apply-relleno.partial.json`, JSON.stringify(report, null, 1));
    console.log(`lote ${i + 1}-${i + slice.length}: run ${runId} · aplicados=${report.aplicados} yaEstaban=${report.yaEstaban} review=${report.review.length} err=${report.errores.length}`);
  }
  writeFileSync(`${DIR}/apply-relleno.json`, JSON.stringify(report, null, 1));
  console.log(`TOTAL: aplicados=${report.aplicados} yaEstaban=${report.yaEstaban} saltados=${report.saltados} review=${report.review.length} errores=${report.errores.length}`);
  await closeDb();
}

async function claim(
  context: OperatorContext, sourceId: number, artistId: number, field: string,
  valor: unknown, url: string, excerpt: string, identityKey: string,
): Promise<void> {
  const res = await context.client.query(
    `INSERT INTO ingest.claims(source_id,entity_kind,artist_id,field,raw_value,normalized_value,raw_hash,extractor,
                              extractor_version,confidence,status,created_by,run_id,notes,identity_key)
     VALUES($1,'artist',$2,$3,$4::jsonb,$4::jsonb,$5,$6,'1','medium','accepted','human',$7,$8,$9)
     ON CONFLICT DO NOTHING RETURNING id::text`,
    [sourceId, artistId, field, JSON.stringify(valor), sha([EXTRACTOR, artistId, field, valor, url]),
      EXTRACTOR, context.runId, "Rate Your Music, relleno desde ficha duplicada (encargo de Brian 2026-10-17)", identityKey]);
  const claimId = res.rows[0]?.id;
  if (claimId) {
    await context.client.query(
      "INSERT INTO ingest.claim_evidence(claim_id,url,excerpt,position,evidence_hash) VALUES($1,$2,$3,0,$4) ON CONFLICT DO NOTHING",
      [claimId, url, excerpt.slice(0, 500), sha([url, excerpt])]);
  }
}

main().catch((error) => { console.error(error); process.exit(1); });
