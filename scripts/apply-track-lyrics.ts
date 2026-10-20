// Letras de musicavenezuela.com sobre pistas del catálogo.
// Novena excepción al core (migración 0073): solo el operador/merge escribe
// `public.tracks.lyrics`, con claim de fuente, evidencia y run reversible.
// Sin --confirm ensaya y revierte todo. Repetirlo no duplica ni pisa letras.
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { closeDb } from "../src/db/client.js";
import { withOperatorRun } from "../src/merge/operator.js";

const PLAN = process.argv[2] ?? "reports/letras-2026-10-19/plan.json";
const OUT = "reports/letras-2026-10-19";
const EXTRACTOR = "musicavenezuela-letras";
const SOURCE_SLUG = "musicavenezuela";
const sha = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const shaJson = (value: unknown) => sha(JSON.stringify(value));

interface Row {
  slug: string;
  trackId: number;
  trackTitle: string;
  artist: string;
  album: string;
  year: number | null;
  url: string;
  title: string;
  lyrics: string;
  sha256: string;
}

async function main(): Promise<void> {
  const confirm = process.argv.includes("--confirm") || process.env["CONFIRM"] === "1";
  const plan = JSON.parse(readFileSync(PLAN, "utf8")) as Row[];
  if (!Array.isArray(plan) || plan.length === 0) throw new Error("plan vacío");
  for (const row of plan) {
    if (!Number.isSafeInteger(row.trackId) || row.trackId <= 0) throw new Error(`pista inválida: ${row.slug}`);
    if (!row.lyrics.trim()) throw new Error(`letra vacía: ${row.slug}`);
    if (sha(row.lyrics) !== row.sha256) throw new Error(`letra alterada desde el plan: ${row.slug}`);
    if (!/^https:\/\/www\.musicavenezuela\.com\/letras\/[a-z0-9-]+$/u.test(row.url))
      throw new Error(`URL fuera de la fuente: ${row.url}`);
  }
  if (new Set(plan.map((row) => row.trackId)).size !== plan.length)
    throw new Error("pistas repetidas en el plan");

  mkdirSync(OUT, { recursive: true });
  const result = await withOperatorRun({
    name: "catalogo:letras-musicavenezuela",
    operator: "Hermes (encargo de Brian)",
    note: "Cargar la letra de las canciones que faltaban, con el texto literal de musicavenezuela.com " +
      "y sus créditos ya verificados en el cruce. Solo se escribe en pistas del mismo intérprete y misma " +
      "canción (título normalizado), únicamente cuando la columna está vacía. Conservar el texto tal cual, " +
      "con sus saltos de línea.",
    params: { plan: PLAN, planSha256: sha(readFileSync(PLAN)), rows: plan.length, confirm },
  }, async (context) => {
    const { client, runId } = context;
    const source = (await client.query<{ id: string }>(
      "SELECT id::text FROM ingest.sources WHERE slug=$1", [SOURCE_SLUG])).rows[0];
    if (!source) throw new Error(`falta la fuente ${SOURCE_SLUG}`);

    const written: Array<{ slug: string; trackId: number }> = [];
    const skipped: Array<{ slug: string; trackId: number; reason: string }> = [];

    for (const row of plan) {
      const track = (await client.query<{ lyrics: string | null; title: string }>(
        "SELECT lyrics, title FROM public.tracks WHERE id=$1 FOR UPDATE", [row.trackId])).rows[0];
      if (!track) { skipped.push({ slug: row.slug, trackId: row.trackId, reason: "pista inexistente" }); continue; }
      if (track.lyrics !== null && track.lyrics.trim() !== "") {
        skipped.push({ slug: row.slug, trackId: row.trackId, reason: "ya tiene letra" });
        continue;
      }

      const updated = await client.query(
        "UPDATE public.tracks SET lyrics=$2 WHERE id=$1 AND (lyrics IS NULL OR btrim(lyrics)='')",
        [row.trackId, row.lyrics]);
      if (updated.rowCount !== 1) throw new Error(`la pista ${row.trackId} cambió durante la aplicación`);

      const claim = await client.query<{ id: string }>(`
        INSERT INTO ingest.claims(source_id,entity_kind,track_id,field,raw_value,normalized_value,raw_hash,
                                  extractor,extractor_version,confidence,status,created_by,run_id,notes,identity_key)
        VALUES($1,'track',$2,'lyrics',to_jsonb($3::text),to_jsonb($3::text),$4,$5,'1','medium','accepted','human',$6,$7,$8)
        ON CONFLICT DO NOTHING RETURNING id::text`,
      [source.id, row.trackId, row.lyrics, shaJson([EXTRACTOR, row.slug, row.lyrics]), EXTRACTOR, runId,
        `letra de ${row.title} (${row.artist}) desde ${row.url}`, `musicavenezuela-letras:${row.slug}`]);
      const claimId = claim.rows[0]?.id;
      if (!claimId) throw new Error(`claim no creado para ${row.slug} / pista ${row.trackId}`);

      const excerpt = row.lyrics.slice(0, 480);
      await client.query(`
        INSERT INTO ingest.claim_evidence(claim_id,url,excerpt,selector,position,evidence_hash)
        VALUES($1,$2,$3,'[itemprop=lyrics]',0,$4) ON CONFLICT DO NOTHING`,
      [claimId, row.url, excerpt, shaJson([row.url, excerpt])]);

      await client.query(`
        INSERT INTO ingest.merge_audit(run_id,entity_kind,track_id,field,old_value,new_value,reason,confidence,performed_by)
        VALUES($1,'track',$2,'lyrics',NULL,to_jsonb($3::text),$4,'medium','human')`,
      [runId, row.trackId, row.lyrics, `letra de musicavenezuela.com: ${row.url}`]);

      written.push({ slug: row.slug, trackId: row.trackId });
    }
    return { written: written.length, skipped, claims: written.map((row) => row.trackId) };
  }, { rollbackOnly: !confirm });

  const summary = { dryRun: !confirm, runId: confirm ? result.runId : null, ...result.result };
  writeFileSync(`${OUT}/aplicacion-${confirm ? "aplicada" : "ensayo"}.json`,
    JSON.stringify(summary, null, 2) + "\n");
  console.log(JSON.stringify({ dryRun: !confirm, runId: confirm ? result.runId : null,
    escritas: summary.written, saltadas: summary.skipped.length }));
}

main().catch((error: unknown) => { console.error(error); process.exitCode = 1; }).finally(() => closeDb());
