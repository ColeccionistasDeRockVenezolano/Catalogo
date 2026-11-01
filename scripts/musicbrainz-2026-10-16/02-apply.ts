// Aplicación al catálogo de la cosecha MusicBrainz 2026-10-16 (encargo de Brian:
// «periodos de miembros y ciudades que no tenemos»). Dos modos:
//   --modo=membresias → crea membresías (persona YA existente del catálogo, con
//                       guarda de país Venezuela en el plan) con rol y períodos.
//   --modo=campos     → rellena origin_city / formed_year / disbanded_year SOLO
//                       en fichas con el campo vacío (doble guarda dentro del run).
// Runs reversibles por lotes; savepoint por fila; claim + evidencia por escritura
// (fuente `musicbrainz`). Ensayo por defecto; --confirm aplica.
//
// Uso: tsx scripts/musicbrainz-2026-10-16/02-apply.ts --modo=membresias|campos [--confirm] [--batch=100]
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { closeDb, getPool } from "../../src/db/client.js";
import { OperatorError, createRelation, updateEntity, withOperatorRun, type OperatorContext } from "../../src/merge/operator.js";

interface FilaMembresia {
  artistId: number; banda: string; personId: number; role: string;
  fromYear: number | null; toYear: number | null; isCurrent: boolean;
  url: string; evidencia: string;
}

interface FilaCampo {
  artistId: number; banda: string; url: string;
  originCity?: string; evidenciaCiudad?: string;
  formedYear?: number; evidenciaAnio?: string;
  disbandedYear?: number; evidenciaDisolucion?: string;
}

const args = process.argv.slice(2);
const argVal = (name: string) => args.find((v) => v.startsWith(`--${name}=`))?.split("=")[1];
const MODO = argVal("modo") ?? "membresias";
const confirm = args.includes("--confirm");
const BATCH = Number(argVal("batch") ?? 100);
const DIR = "reports/musicbrainz-apply-2026-10-16";
const EXTRACTOR = "musicbrainz-api";
const sha = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex");

async function main(): Promise<void> {
  const pool = getPool();
  const fuente = await pool.query<{ id: string }>("SELECT id::text FROM ingest.sources WHERE slug='musicbrainz'");
  const sourceId = Number(fuente.rows[0]?.id);
  if (!sourceId) throw new Error("fuente musicbrainz no existe");

  const filas = readFileSync(`${DIR}/${MODO}.jsonl`, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
  console.log(`modo ${MODO}: ${filas.length} filas del plan`);

  if (!confirm) {
    for (const f of filas.slice(0, 6)) console.log("  ", JSON.stringify(f).slice(0, 170));
    console.log("ensayo (--confirm para aplicar)");
    await closeDb();
    return;
  }

  const report = { modo: MODO, aplicados: 0, yaEstaban: 0, saltados: 0, review: [] as unknown[], errores: [] as unknown[], runs: [] as number[] };

  for (let i = 0; i < filas.length; i += BATCH) {
    const slice = filas.slice(i, i + BATCH);
    const { runId } = await withOperatorRun({
      name: `hermes:musicbrainz-${MODO} (${i + 1}-${i + slice.length}/${filas.length})`,
      operator: "hermes (encargo de Brian 2026-10-16)",
      note: MODO === "membresias"
        ? "Membresías con rol y períodos de MusicBrainz (personas ya existentes, guarda país VE); solo lo que el catálogo no tenía."
        : "Campos de MusicBrainz (ciudad de formación, año de formación/disolución) SOLO en fichas con el campo vacío; nada se pisa.",
    }, async (context) => {
      let aplicados = 0;
      for (const f of slice) {
        await context.client.query("SAVEPOINT mb_row");
        try {
          if (MODO === "membresias") {
            const row = f as FilaMembresia;
            const res = await createRelation(context, "artist_membership",
              { artistId: row.artistId, personId: row.personId },
              {
                role: row.role,
                from_year: row.fromYear ?? undefined,
                to_year: row.toYear ?? undefined,
                is_current: row.isCurrent ? "true" : "false",
              });
            if (res.created) {
              aplicados += 1;
              report.aplicados += 1;
              await claim(context, sourceId, row.artistId, res.id!, "role",
                { role: row.role, from_year: row.fromYear, to_year: row.toYear, is_current: row.isCurrent },
                row.url, row.evidencia, `mb:membership:${row.artistId}:${row.personId}:${row.role.toLowerCase().replace(/\s+/g, "-")}`);
            } else {
              report.yaEstaban += 1;
            }
          } else {
            const row = f as FilaCampo;
            const cur = await context.client.query<{ origin_city: string | null; formed_year: number | null; disbanded_year: number | null }>(
              "SELECT origin_city, formed_year, disbanded_year FROM public.artists WHERE id=$1 FOR UPDATE", [row.artistId]);
            const a = cur.rows[0];
            if (!a) { report.saltados += 1; } else {
              const campos: Array<[string, string | number | undefined, string | undefined]> = [
                ["origin_city", row.originCity, row.evidenciaCiudad],
                ["formed_year", row.formedYear, row.evidenciaAnio],
                ["disbanded_year", row.disbandedYear, row.evidenciaDisolucion],
              ];
              const cambios: Record<string, string | number> = {};
              for (const [k, v] of campos) {
                if (v === undefined) continue;
                const vacio = k === "origin_city" ? !a.origin_city : (k === "formed_year" ? !a.formed_year : !a.disbanded_year);
                if (vacio) cambios[k] = v;
              }
              if (Object.keys(cambios).length) {
                await updateEntity(context, "artist", row.artistId, cambios);
                aplicados += 1;
                report.aplicados += 1;
                for (const [k, v, ev] of campos) {
                  if (cambios[k] !== undefined) {
                    await claim(context, sourceId, row.artistId, null, k, { [k]: v }, row.url, ev ?? "", `mb:${k}:${row.artistId}`);
                  }
                }
              } else { report.yaEstaban += 1; }
            }
          }
          await context.client.query("RELEASE SAVEPOINT mb_row");
        } catch (error) {
          await context.client.query("ROLLBACK TO SAVEPOINT mb_row");
          await context.client.query("RELEASE SAVEPOINT mb_row");
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
    writeFileSync(`${DIR}/apply-${MODO}.partial.json`, JSON.stringify(report, null, 1));
    console.log(`lote ${i + 1}-${i + slice.length}: run ${runId} · aplicados=${report.aplicados} yaEstaban=${report.yaEstaban} review=${report.review.length} err=${report.errores.length}`);
  }
  writeFileSync(`${DIR}/apply-${MODO}.json`, JSON.stringify(report, null, 1));
  console.log(`TOTAL ${MODO}: aplicados=${report.aplicados} yaEstaban=${report.yaEstaban} saltados=${report.saltados} review=${report.review.length} errores=${report.errores.length}`);
  await closeDb();
}

/** Claim aceptado + evidencia de la fuente, como el resto de campañas. */
async function claim(
  context: OperatorContext,
  sourceId: number, artistId: number, membershipId: number | null, field: string,
  valor: unknown, url: string, excerpt: string, identityKey: string,
): Promise<void> {
  const res = await context.client.query(
    `INSERT INTO ingest.claims(source_id,entity_kind,artist_id,artist_membership_id,field,raw_value,normalized_value,raw_hash,extractor,
                              extractor_version,confidence,status,created_by,run_id,notes,identity_key)
     VALUES($1,$2,$3,$4,$5,$6::jsonb,$6::jsonb,$7,$8,'1','medium','accepted','human',$9,$10,$11)
     ON CONFLICT DO NOTHING RETURNING id::text`,
    [sourceId, membershipId ? "artist_membership" : "artist", membershipId ? null : artistId, membershipId,
      field, JSON.stringify(valor), sha([EXTRACTOR, artistId, membershipId, field, valor, url]),
      EXTRACTOR, context.runId, `MusicBrainz (encargo de Brian 2026-10-16): ${field}`, identityKey]);
  const claimId = res.rows[0]?.id;
  if (claimId) {
    await context.client.query(
      "INSERT INTO ingest.claim_evidence(claim_id,url,excerpt,position,evidence_hash) VALUES($1,$2,$3,0,$4) ON CONFLICT DO NOTHING",
      [claimId, url, excerpt.slice(0, 500), sha([url, excerpt])]);
  }
}

main().catch((error) => { console.error(error); process.exit(1); });
