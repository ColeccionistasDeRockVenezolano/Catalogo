// Plan Aqustico · E3 (H3) — duraciones de pista que faltan, desde Aqustico.
//
// Lee el hueco H3 de reports/aqustico-2026-10/tabla-maestra.json (cotejo fino E0:
// artista, disco y título de pista exactos y únicos; duración numérica 10–3600 s).
// Solo llena pistas que siguen sin duración (NULL o 0). Se salta un disco si en
// él Aqustico contradice (>15 s) dos o más duraciones que CRV ya tiene, o más del
// 20 % de las comparables: señal de otra edición. Cada cambio deja un claim de la
// fuente `aqustico` con su evidencia y su fila de merge_audit; todo en UN run
// (`auto:aqustico`), reversible con `crv runs undo <run>`. Sin --confirm corre
// entero y se deshace.
//
//   ./scripts/with-node22.sh node_modules/.bin/tsx scripts/aqustico/rellenar-duraciones.mts [--confirm]
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { closeDb, getPool } from "../../src/db/client.js";
import { ensureAqusticoSource } from "./fuente.mjs";

const DIR = "reports/aqustico-2026-10";
const EXTRACTOR = "aqustico-volcado-2026-10-11";
const sha = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

interface Hueco { hueco: string; crvId: number; aqId: number; valor: number; evidencia: string; detalle?: string }

function discosConOtraEdicion(): Set<string> {
  const pistas = readFileSync(`${DIR}/cruces-pistas.tsv`, "utf8").trim().split("\n").slice(1).map((l) => l.split("\t"));
  const albumOf = new Map(pistas.filter((p) => p[4]).map((p) => [p[4]!, p[3]!]));
  const comparables = new Map<string, number>();
  for (const p of pistas) {
    if (p[4] && p[6] && p[6] !== "0" && /^\d+(\.\d+)?$/u.test(p[2] ?? "")) comparables.set(p[3]!, (comparables.get(p[3]!) ?? 0) + 1);
  }
  const malas = new Map<string, number>();
  for (const d of readFileSync(`${DIR}/discrepancias.tsv`, "utf8").trim().split("\n").slice(1).map((l) => l.split("\t"))) {
    if (d[0] === "duracion") { const a = albumOf.get(d[2]!)!; malas.set(a, (malas.get(a) ?? 0) + 1); }
  }
  return new Set([...malas].filter(([a, n]) => n >= 2 || n / (comparables.get(a) ?? 1) > 0.2).map(([a]) => a));
}

async function main(): Promise<void> {
  const confirm = process.argv.includes("--confirm");
  const huecos = (JSON.parse(readFileSync(`${DIR}/tabla-maestra.json`, "utf8")) as { huecos: Hueco[] }).huecos.filter((h) => h.hueco === "H3");
  const pistas = readFileSync(`${DIR}/cruces-pistas.tsv`, "utf8").trim().split("\n").slice(1).map((l) => l.split("\t"));
  const albumOf = new Map(pistas.filter((p) => p[4]).map((p) => [Number(p[4]), p[3]!]));
  const saltar = discosConOtraEdicion();
  const report = { mode: confirm ? "confirm" : "dry-run", runId: 0, candidates: huecos.length, applied: 0, alreadySet: 0,
    skippedOtherEdition: [] as number[], applies: [] as Array<{ trackId: number; seconds: number; detalle?: string }> };

  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const sourceId = await ensureAqusticoSource(client);
    const run = await client.query<{ id: string }>(
      `INSERT INTO ingest.scrape_runs(kind, source_id, status, params) VALUES('merge_run',$1,'running',$2::jsonb) RETURNING id::text`,
      [sourceId, JSON.stringify({ action: "aqustico_track_durations", actor: "auto:aqustico", plan: "~/Desktop/PLAN_AQUSTICO_2026-10-12.md E3/H3", confirm })]);
    report.runId = Number(run.rows[0]!.id);
    for (const h of huecos) {
      if (saltar.has(albumOf.get(h.crvId) ?? "")) { report.skippedOtherEdition.push(h.crvId); continue; }
      const updated = await client.query(
        "UPDATE public.tracks SET duration_seconds=$2 WHERE id=$1 AND (duration_seconds IS NULL OR duration_seconds=0) RETURNING id", [h.crvId, h.valor]);
      if (!updated.rowCount) { report.alreadySet += 1; continue; }
      const note = `Aqustico: ${h.detalle ?? ""} (canción ${h.aqId}) dura ${h.valor} s — plan Aqustico H3, run ${report.runId}`;
      const claim = await client.query<{ id: string }>(`
        INSERT INTO ingest.claims(source_id,entity_kind,track_id,field,raw_value,normalized_value,raw_hash,extractor,
                                  extractor_version,confidence,status,created_by,run_id,notes,identity_key)
        VALUES($1,'track',$2,'duration_seconds',to_jsonb($3::int),to_jsonb($3::int),$4,$5,'1','medium','accepted','system',$6,$7,$8)
        ON CONFLICT DO NOTHING RETURNING id::text`,
      [sourceId, h.crvId, h.valor, sha([EXTRACTOR, h.crvId, h.valor, h.aqId]), EXTRACTOR, report.runId, note, `aqustico:song:${h.aqId}`]);
      // Un claim idéntico de una pasada anterior (deshecha) se reutiliza: la
      // auditoría nunca queda sin claim (check `merge_audit.coverage` del doctor).
      const claimId = claim.rows[0]?.id ?? (await client.query<{ id: string }>(
        "SELECT id::text FROM ingest.claims WHERE source_id=$1 AND raw_hash=$2 ORDER BY id DESC LIMIT 1",
        [sourceId, sha([EXTRACTOR, h.crvId, h.valor, h.aqId])])).rows[0]?.id;
      if (claimId) {
        await client.query(`INSERT INTO ingest.claim_evidence(claim_id,url,excerpt,position,evidence_hash) VALUES($1,$2,$3,0,$4) ON CONFLICT DO NOTHING`,
          [claimId, h.evidencia, note.slice(0, 500), sha([h.evidencia, note])]);
      }
      const audit = await client.query<{ id: string }>(`
        INSERT INTO ingest.merge_audit(run_id,entity_kind,track_id,field,old_value,new_value,reason,confidence,performed_by)
        VALUES($1,'track',$2,'duration_seconds','null'::jsonb,to_jsonb($3::int),$4,'medium','system') RETURNING id::text`,
      [report.runId, h.crvId, h.valor, note]);
      if (claimId) await client.query("INSERT INTO ingest.merge_audit_claims(merge_audit_id,claim_id) VALUES($1,$2)", [audit.rows[0]!.id, claimId]);
      report.applied += 1;
      report.applies.push({ trackId: h.crvId, seconds: h.valor, ...(h.detalle ? { detalle: h.detalle } : {}) });
    }
    await client.query(`UPDATE ingest.scrape_runs SET status='ok', finished_at=now(), counters=$2::jsonb WHERE id=$1`,
      [report.runId, JSON.stringify({ applied: report.applied, alreadySet: report.alreadySet, skipped: report.skippedOtherEdition.length })]);
    await client.query(confirm ? "COMMIT" : "ROLLBACK");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  const out = `${DIR}/e3-duraciones-${report.mode}-run${report.runId}.json`;
  writeFileSync(out, JSON.stringify(report, null, 1));
  console.log(`duraciones Aqustico (${report.mode}, run ${report.runId}): ${report.applied} aplicadas de ${report.candidates} · ${report.alreadySet} ya tenían · ${report.skippedOtherEdition.length} saltadas (otra edición) → ${out}`);
  await closeDb();
}

main().catch(async (error: unknown) => { console.error(error); await closeDb(); process.exit(1); });
