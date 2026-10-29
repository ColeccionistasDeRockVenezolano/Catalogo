// Altas de PERSONA + membresía para los miembros citados en MySpace que la ER dirigida no
// resolvió (motivo «sin candidato»). El ER del sistema decide:
//   - sin parecidos → crea la ficha (persona) + relación + claims de la fuente;
//   - already_exists → usa la ficha existente y añade solo la relación + claim;
//   - needs_review (candidatos parecidos) → NO crea: al reporte para revisión humana.
// Guardas locales: 2-4 palabras alfabéticas, sin dígitos. Runs reversibles; savepoint por fila.
// Uso: tsx scripts/myspace-2026-10-16/12-alta-miembros.ts [sin-resolver.jsonl] [--confirm]
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { closeDb, getPool } from "../../src/db/client.js";
import { OperatorError, createEntity, createRelation, withOperatorRun } from "../../src/merge/operator.js";

interface Fila { artistId: number; banda: string; person: string; role: string; url: string; evidencia: string; motivo: string; }

const args = process.argv.slice(2);
const LEDGER = args.find((v) => !v.startsWith("--")) ?? "reports/myspace-2026-10-16/er/miembros-sin-resolver.jsonl";
const confirm = args.includes("--confirm");
const EXTRACTOR = "perfil-myspace-wayback";
const NOMBRE = /^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ'’.\- ]{6,60}$/u;
// basura medida del primer lote: etiquetas de plantilla y títulos de vídeo/disco, no personas
const PALABRAS_MALAS = /\b(video|vídeo|photos?|fotos?|editor|imagen|google|search|by|realizado|editado|myspace|demo|disc|album|álbum|contacto|manager|booking|promo|intro|outro|live|official)\b/iu;
const sha = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex");

async function main(): Promise<void> {
  // los ya evaluados como needs_review por el ER no se reintentan (protege el canonico)
  let yaRevisados = new Set<string>();
  try {
    const previo = JSON.parse(readFileSync("reports/myspace-2026-10-16/altas-miembros.json", "utf8")) as {
      revisar?: Array<{ banda: string; person: string }>; creadas?: Array<{ banda: string; person: string }>;
    };
    yaRevisados = new Set([...(previo.revisar ?? []), ...(previo.creadas ?? [])].map((r) => `${r.banda}|${r.person}`));
  } catch { /* sin corrida previa */ }
  const filas = (readFileSync(LEDGER, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l) as Fila))
    .filter((f) => f.motivo === "sin candidato" && NOMBRE.test(f.person) && !/\d/u.test(f.person)
      && !PALABRAS_MALAS.test(f.person) && /[a-záéíóúñ]/u.test(f.person)   // no todo-mayúsculas
      && f.person.split(/\s+/u).length >= 2 && f.person.split(/\s+/u).length <= 4
      && !yaRevisados.has(`${f.banda}|${f.person}`));
  const pool = getPool();
  const source = await pool.query<{ id: string }>("SELECT id::text FROM ingest.sources WHERE slug='myspace-wayback-machine'");
  const sourceId = Number(source.rows[0]?.id);
  if (!sourceId) throw new Error("fuente myspace-wayback-machine no existe");

  console.log(`altas candidatas: ${filas.length}`);
  if (!confirm) {
    for (const f of filas.slice(0, 15)) console.log(`  ${f.banda.slice(0, 22).padEnd(22)} ${f.person} (${f.role.slice(0, 22)})`);
    console.log("dry-run (ejecuta con --confirm)");
    await closeDb();
    return;
  }

  const report = { creadas: [] as unknown[], yaExistian: [] as unknown[], revisar: [] as unknown[], errores: [] as unknown[] };
  const runs: number[] = [];
  for (let i = 0; i < filas.length; i += 100) {
    const slice = filas.slice(i, i + 100);
    const { runId } = await withOperatorRun({
      name: `hermes:myspace-altas-miembros (${i + 1}-${i + slice.length}/${filas.length})`,
      operator: "hermes-curaduria (delegado por Brian)",
      note: "Personas y membresías citadas en los perfiles MySpace (Wayback) que la ER dirigida no resolvió; el ER del sistema decide cada alta.",
    }, async (context) => {
      let creadas = 0;
      for (const f of slice) {
        await context.client.query("SAVEPOINT alta");
        let personId: number | undefined;
        let recienCreada = false;
        try {
          const ent = await createEntity(context, "person", { name: f.person });
          personId = ent.id;
          recienCreada = true;
          const claim = await context.client.query<{ id: string }>(`
            INSERT INTO ingest.claims(source_id,entity_kind,person_id,field,raw_value,normalized_value,raw_hash,extractor,
                                      extractor_version,confidence,status,created_by,run_id,notes,identity_key)
            VALUES($1,'person',$2,'name',to_jsonb($3::text),to_jsonb($3::text),$4,$5,'1','medium','accepted','human',$6,$7,$8)
            ON CONFLICT DO NOTHING RETURNING id::text`,
          [sourceId, personId, f.person, sha([EXTRACTOR, personId, f.person, f.url]), EXTRACTOR, context.runId,
            `Miembro citado en el perfil MySpace de ${f.banda}: ${f.person}${f.role ? ` — ${f.role}` : ""}`,
            `myspace:person:${personId}:name`]);
          if (claim.rows[0]?.id && f.url) {
            await context.client.query(
              "INSERT INTO ingest.claim_evidence(claim_id,url,excerpt,position,evidence_hash) VALUES($1,$2,$3,0,$4) ON CONFLICT DO NOTHING",
              [claim.rows[0].id, f.url, f.evidencia.slice(0, 400), sha([f.url, f.evidencia])]);
          }
          await context.client.query("RELEASE SAVEPOINT alta");
        } catch (error) {
          await context.client.query("ROLLBACK TO SAVEPOINT alta");
          if (error instanceof OperatorError && error.code === "already_exists") {
            const detalle = (error as OperatorError & { details?: { existingId?: number } }).details;
            personId = detalle?.existingId;
            if (!personId) { report.errores.push({ banda: f.banda, person: f.person, error: "already_exists sin id" }); continue; }
          } else if (error instanceof OperatorError && error.code === "needs_review") {
            report.revisar.push({ banda: f.banda, person: f.person, role: f.role, detalle: error.message.slice(0, 140) });
            continue;
          } else {
            report.errores.push({ banda: f.banda, person: f.person, error: (error as Error).message.slice(0, 160) });
            continue;
          }
        }
        await context.client.query("SAVEPOINT rel");
        try {
          const rel = await createRelation(context, "artist_membership", { artistId: f.artistId, personId: personId! },
            { role: f.role || "Miembro" });
          const claimR = await context.client.query<{ id: string }>(`
            INSERT INTO ingest.claims(source_id,entity_kind,artist_membership_id,field,raw_value,normalized_value,raw_hash,extractor,
                                      extractor_version,confidence,status,created_by,run_id,notes,identity_key)
            VALUES($1,'artist_membership',$2,'role',to_jsonb($3::text),to_jsonb($3::text),$4,$5,'1','medium','accepted','human',$6,$7,$8)
            ON CONFLICT DO NOTHING RETURNING id::text`,
          [sourceId, rel.id, f.role || "", sha([EXTRACTOR, f.artistId, personId, f.role, f.url]), EXTRACTOR, context.runId,
            `Membresía citada en el perfil MySpace de ${f.banda}: ${f.person}${f.role ? ` — ${f.role}` : ""}`,
            `myspace:membership:${f.artistId}:${personId}:${(f.role || "sin-rol").toLowerCase().replace(/\s+/gu, "-")}`]);
          if (claimR.rows[0]?.id && f.url) {
            await context.client.query(
              "INSERT INTO ingest.claim_evidence(claim_id,url,excerpt,position,evidence_hash) VALUES($1,$2,$3,0,$4) ON CONFLICT DO NOTHING",
              [claimR.rows[0].id, f.url, f.evidencia.slice(0, 400), sha([f.url, f.evidencia])]);
          }
          await context.client.query("RELEASE SAVEPOINT rel");
          if (rel.created) {
            creadas += 1;
            (recienCreada ? report.creadas : report.yaExistian).push({ banda: f.banda, person: f.person, personId, role: f.role });
          } else {
            report.yaExistian.push({ banda: f.banda, person: f.person, personId, role: f.role, nota: "relación ya existía" });
          }
        } catch (error) {
          await context.client.query("ROLLBACK TO SAVEPOINT rel");
          report.errores.push({ banda: f.banda, person: f.person, error: (error as Error).message.slice(0, 160) });
        }
      }
      return creadas;
    });
    runs.push(runId);
    console.log(`lote ${i + 1}-${i + slice.length}: run ${runId} | creadas=${report.creadas.length} yaExistian=${report.yaExistian.length} revisar=${report.revisar.length} err=${report.errores.length}`);
    writeFileSync("reports/myspace-2026-10-16/altas-miembros.partial.json", JSON.stringify({ runs, ...report }, null, 2));
  }
  writeFileSync("reports/myspace-2026-10-16/altas-miembros.json", JSON.stringify({ runs, ...report }, null, 2));
  console.log(`TOTAL: creadas=${report.creadas.length} yaExistian=${report.yaExistian.length} revisar=${report.revisar.length} errores=${report.errores.length}`);
  await closeDb();
}

main().catch(async (error) => { console.error(error); await closeDb(); process.exit(1); });
