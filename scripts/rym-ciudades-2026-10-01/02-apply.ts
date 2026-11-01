// Aplicación al catálogo de las CIUDADES de RYM — páginas de ciudad de la cosecha manual
// del 2026-10-01 (data/raw/rateyourmusic/*.html, re-parseadas por
// scripts/rym-ciudades-reparse.py). Rellena SOLO campos que están vacíos:
//   · artist.origin_city  (grupos, «Formed/Born <año>, <ciudad>»)
//   · person.birth_city   (personas)
// Claim + evidencia por escritura (fuente `rateyourmusic`, id 8793), runs reversibles por lotes
// y savepoint por fila. Ensayo por defecto; --confirm aplica.
//
// Uso: tsx scripts/rym-ciudades-2026-10-01/02-apply.ts [--confirm] [--batch=100] [--limite=N]
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { closeDb, getPool } from "../../src/db/client.js";
import { OperatorError, updateEntity, withOperatorRun, type OperatorContext } from "../../src/merge/operator.js";

interface FilaCiudad {
  tabla: "artists" | "persons";
  id: number;
  campo: "origin_city" | "birth_city";
  catalogo: string;
  tipo_rym: string;
  nivel: string;
  rym: string;
  slug: string;
  ciudad: string;
  ubicacion_completa: string;
  anio: number | null;
  referencia: string;
  pagina: string;
  rym_url: string;
}

const args = process.argv.slice(2);
const argVal = (name: string) => args.find((v) => v.startsWith(`--${name}=`))?.split("=")[1];
const confirm = args.includes("--confirm");
const BATCH = Number(argVal("batch") ?? 100);
const LIMITE = Number(argVal("limite") ?? 0);
const DIR = "reports/rym-ciudades-2026-10-01";
const EXTRACTOR = "rym-paginas-ciudad";
const SOURCE_SLUG = "rateyourmusic";
const sha = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex");

/** Año de un valor del catálogo que puede ser número (formed_year) o texto (birth_date_value). */
function extraerAnio(valor: unknown): number | null {
  if (valor === null || valor === undefined) return null;
  const coincidencia = String(valor).match(/\b(1[89]\d{2}|20\d{2})\b/);
  return coincidencia ? Number(coincidencia[1]) : null;
}

async function main(): Promise<void> {
  const pool = getPool();
  const fuente = await pool.query<{ id: string }>("SELECT id::text FROM ingest.sources WHERE slug=$1", [SOURCE_SLUG]);
  const sourceId = Number(fuente.rows[0]?.id);
  if (!sourceId) throw new Error(`fuente ${SOURCE_SLUG} no existe`);

  let filas = readFileSync(`${DIR}/candidatos-ciudad.jsonl`, "utf8")
    .split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l) as FilaCiudad);
  if (LIMITE > 0) filas = filas.slice(0, LIMITE);
  const grupos = { artists: filas.filter((f) => f.tabla === "artists").length, persons: filas.filter((f) => f.tabla === "persons").length };
  console.log(`candidatos: ${filas.length} (artistas ${grupos.artists} · personas ${grupos.persons}) · fuente ${SOURCE_SLUG}=${sourceId}`);

  if (!confirm) {
    for (const f of filas.slice(0, 6)) console.log("  ", JSON.stringify({ [f.tabla]: f.id, nombre: f.catalogo, ciudad: f.ciudad, nivel: f.nivel, ref: f.referencia }).slice(0, 190));
    console.log("ensayo (--confirm para aplicar)");
    await closeDb();
    return;
  }

  const report = { aplicados: 0, yaEstaban: 0, saltados: 0, review: [] as unknown[], errores: [] as unknown[], runs: [] as number[] };

  for (let i = 0; i < filas.length; i += BATCH) {
    const slice = filas.slice(i, i + BATCH);
    const { runId } = await withOperatorRun({
      name: `hermes:rym-ciudades (${i + 1}-${i + slice.length}/${filas.length})`,
      operator: "hermes (encargo de Brian 2026-10-16)",
      note: "Ciudades de las páginas de ciudad de RYM (cosecha manual 2026-10-01) SOLO en fichas con el campo vacío; nada se pisa.",
    }, async (context) => {
      let aplicados = 0;
      for (const f of slice) {
        await context.client.query("SAVEPOINT rym_row");
        try {
          const tabla = f.tabla === "artists" ? "public.artists" : "public.persons";
          const campoAnio = f.tabla === "artists" ? "formed_year" : "birth_date_value";
          const cur = await context.client.query<Record<string, string | number | null>>(
            `SELECT ${f.campo} AS actual, ${campoAnio} AS referencia_catalogo FROM ${tabla} WHERE id=$1 FOR UPDATE`, [f.id]);
          const actual = (cur.rows[0]?.["actual"] ?? null) as string | null;
          const anioCatalogo = extraerAnio(cur.rows[0]?.["referencia_catalogo"]);
          if (!cur.rows[0]) {
            report.saltados += 1;
          } else if (actual && actual.trim()) {
            report.yaEstaban += 1;
          } else if (f.anio && anioCatalogo && f.anio !== anioCatalogo) {
            // Guarda de identidad: el año de la ficha de RYM no cuadra con el del catálogo
            // (posible homónimo). No se escribe: va a revisión con el detalle.
            report.review.push({ fila: f, detail: `año RYM ${f.anio} ≠ catálogo ${anioCatalogo}` });
          } else {
            const kind = f.tabla === "artists" ? "artist" as const : "person" as const;
            await updateEntity(context, kind, f.id, { [f.campo]: f.ciudad });
            aplicados += 1;
            report.aplicados += 1;
            const evidencia = `Rate Your Music (página de ciudad «${f.pagina}»): ${f.rym} — ${f.referencia || f.ubicacion_completa}`.slice(0, 480);
            await claim(context, sourceId, kind === "artist" ? { artistId: f.id } : { personId: f.id }, f.campo,
              { [f.campo]: f.ciudad }, f.rym_url, evidencia, `rym:${f.campo}:${f.id}`);
          }
          await context.client.query("RELEASE SAVEPOINT rym_row");
        } catch (error) {
          await context.client.query("ROLLBACK TO SAVEPOINT rym_row");
          await context.client.query("RELEASE SAVEPOINT rym_row");
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
    writeFileSync(`${DIR}/apply-ciudades.partial.json`, JSON.stringify(report, null, 1));
    console.log(`lote ${i + 1}-${i + slice.length}: run ${runId} · aplicados=${report.aplicados} yaEstaban=${report.yaEstaban} review=${report.review.length} err=${report.errores.length}`);
  }
  writeFileSync(`${DIR}/apply-ciudades.json`, JSON.stringify(report, null, 1));
  console.log(`TOTAL: aplicados=${report.aplicados} yaEstaban=${report.yaEstaban} saltados=${report.saltados} review=${report.review.length} errores=${report.errores.length}`);
  await closeDb();
}

/** Claim aceptado + evidencia de la fuente, como el resto de campañas. */
async function claim(
  context: OperatorContext,
  sourceId: number,
  entidad: { artistId?: number; personId?: number },
  field: string, valor: unknown, url: string, excerpt: string, identityKey: string,
): Promise<void> {
  const entityKind = entidad.artistId ? "artist" : "person";
  const res = await context.client.query(
    `INSERT INTO ingest.claims(source_id,entity_kind,artist_id,person_id,field,raw_value,normalized_value,raw_hash,extractor,
                              extractor_version,confidence,status,created_by,run_id,notes,identity_key)
     VALUES($1,$2,$3,$4,$5,$6::jsonb,$6::jsonb,$7,$8,'1','medium','accepted','human',$9,$10,$11)
     ON CONFLICT DO NOTHING RETURNING id::text`,
    [sourceId, entityKind, entidad.artistId ?? null, entidad.personId ?? null,
      field, JSON.stringify(valor), sha([EXTRACTOR, entidad.artistId ?? entidad.personId, field, valor, url]),
      EXTRACTOR, context.runId, `Rate Your Music, páginas de ciudad de Venezuela (encargo de Brian 2026-10-16): ${field}`, identityKey]);
  const claimId = res.rows[0]?.id;
  if (claimId) {
    await context.client.query(
      "INSERT INTO ingest.claim_evidence(claim_id,url,excerpt,position,evidence_hash) VALUES($1,$2,$3,0,$4) ON CONFLICT DO NOTHING",
      [claimId, url, excerpt.slice(0, 500), sha([url, excerpt])]);
  }
}

main().catch((error) => { console.error(error); process.exit(1); });
