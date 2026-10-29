// Auditoría de Shared 2026-10-25 · aplicador de los huecos verificados.
//
// Codex inventarió los campos vacíos con candidatos locales (reports/shared-auditoria-profunda-2026-10-25);
// Claude Code los volvió a verificar contra la fuente y el catálogo vigente antes de este plan
// (edición corroborada por pistas en común, año coincidente, identidad del perfil, etc.).
// Cada fila del plan rellena UN campo vacío con un claim de su fuente real (URL + extracto) que pasa
// por el motor de merge; nunca pisa un valor existente. Una fase = un run reversible.
//
//   ./scripts/with-node22.sh node_modules/.bin/tsx scripts/shared-auditoria-2026-10-25/aplicar.mts \
//     --dir=$HOME/crv-staging/reports/shared-auditoria-aplicacion-2026-10-25 --phase=duraciones [--confirm]
//
// Sin --confirm corre entero y deshace la transacción (ensayo con los mismos números).
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { closeDb } from "../../src/db/client.js";
import { persistClaim, type ClaimToPersist } from "../../src/claims/persistence.js";
import { mergeClaim } from "../../src/merge/engine.js";
import { withOperatorRun } from "../../src/merge/operator.js";
import { syncCoreAlbumLabel } from "../../src/catalog/album-labels.js";

interface PlanRow {
  kind: "track" | "album" | "artist" | "person";
  id: number; field: string; value: string | number;
  sourceSlug: string; extractor: string; url: string; excerpt: string;
}
const TABLE = { track: "tracks", album: "albums", artist: "artists", person: "persons" } as const;
const TARGET = { track: "trackId", album: "albumId", artist: "artistId", person: "personId" } as const;
const NEW_SOURCES: Record<string, string> = {
  "crv-auditoria-shared": "Auditoría de Shared 2026-10-25 (Last.fm, Bandcamp, TheAudioDB, sitios oficiales)",
};

const args = process.argv.slice(2);
const argVal = (name: string) => args.find((v) => v.startsWith(`--${name}=`))?.slice(name.length + 3);
const dir = argVal("dir");
const phase = argVal("phase");
const confirm = args.includes("--confirm");
if (!dir || !phase) throw new Error("--dir=… --phase=… obligatorios");
const sha = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex");

async function main(): Promise<void> {
  const plan = readFileSync(path.join(dir!, `plan-${phase}.jsonl`), "utf8").split("\n").filter(Boolean)
    .map((line) => JSON.parse(line) as PlanRow);
  const keys = new Set(plan.map((r) => `${r.kind}:${r.id}:${r.field}`));
  if (keys.size !== plan.length) throw new Error("filas repetidas en el plan");
  const report = { phase, mode: confirm ? "aplicado" : "ensayo (revertido)", runId: 0, rows: plan.length,
    applied: 0, alreadySet: 0, notApplied: [] as unknown[], bySource: {} as Record<string, number> };

  const { runId } = await withOperatorRun({
    name: `claude-code:auditoria-shared-2026-10-25 (${phase})`, operator: "claude-code (encargo de Brian)",
    note: `Huecos de la auditoría de Shared 2026-10-25 (${phase}), re-verificados contra la fuente y el catálogo: solo campos vacíos, con fuente y evidencia por dato.`,
    params: { plan: `plan-${phase}.jsonl`, rows: plan.length, planSha256: sha(plan) },
  }, async (context) => {
    const { client } = context;
    for (const [slug, name] of Object.entries(NEW_SOURCES)) {
      await client.query(`INSERT INTO ingest.sources(slug,name,site_type,trust_level,enabled,notes)
        VALUES($1,$2,'database','medium',false,'Rellenos verificados de la auditoría de Shared (scripts/shared-auditoria-2026-10-25). Nunca se raspa.')
        ON CONFLICT (slug) DO NOTHING`, [slug, name]);
    }
    const sources = new Map((await client.query<{ id: string; slug: string }>("SELECT id::text,slug FROM ingest.sources")).rows
      .map((r) => [r.slug, Number(r.id)]));
    for (const row of plan) {
      const sourceId = sources.get(row.sourceSlug);
      if (!sourceId) throw new Error(`fuente desconocida: ${row.sourceSlug}`);
      const column = row.field;
      const current = (await client.query<{ value: string | null }>(
        `SELECT ${column}::text AS value FROM public.${TABLE[row.kind]} WHERE id=$1 FOR UPDATE`, [row.id])).rows[0];
      if (!current) { report.notApplied.push({ ...row, reason: "ficha inexistente" }); continue; }
      if (current.value !== null && current.value.trim() !== "") { report.alreadySet += 1; continue; }
      const identity = `auditoria-shared:${row.kind}:${row.id}:${row.field}`;
      const claim: ClaimToPersist = {
        entityKind: row.kind, identity, identitySecondary: identity, originalIdentity: identity,
        field: row.field, rawValue: row.value, normalizedValue: row.value,
        rawHash: sha([identity, row.value, row.url]), extractor: row.extractor, extractorVersion: "1",
        sourceId, runId: context.runId, confidence: "medium", createdBy: "human",
        evidence: { url: row.url, excerpt: row.excerpt },
        [TARGET[row.kind]]: row.id,
      } as ClaimToPersist;
      // Una ficha excluida por decisión editorial (PCE01) no admite cambios: se anota y se sigue.
      await client.query("SAVEPOINT fila");
      let outcome: Awaited<ReturnType<typeof mergeClaim>>;
      try {
        const persisted = await persistClaim(claim, client);
        outcome = await mergeClaim(claim, persisted, { client });
        await client.query("RELEASE SAVEPOINT fila");
      } catch (error) {
        if ((error as { code?: string }).code !== "PCE01") throw error;
        await client.query("ROLLBACK TO SAVEPOINT fila");
        report.notApplied.push({ kind: row.kind, id: row.id, field: row.field, value: row.value, reason: "ficha excluida por política editorial (PCE01)" });
        continue;
      }
      const after = (await client.query<{ value: string | null }>(
        `SELECT ${column}::text AS value FROM public.${TABLE[row.kind]} WHERE id=$1`, [row.id])).rows[0];
      if (after?.value === null || after?.value === undefined) {
        report.notApplied.push({ kind: row.kind, id: row.id, field: row.field, value: row.value, action: outcome.action, detail: outcome.detail });
        continue;
      }
      if (row.field === "label_id") await syncCoreAlbumLabel(context, row.id, Number(row.value));
      report.applied += 1;
      report.bySource[row.extractor] = (report.bySource[row.extractor] ?? 0) + 1;
    }
    return true;
  }, { rollbackOnly: !confirm });
  report.runId = runId;
  const out = path.join(dir!, `aplicacion-${phase}-${confirm ? `run${runId}` : "ensayo"}.json`);
  writeFileSync(out, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ phase, mode: report.mode, runId, applied: report.applied, alreadySet: report.alreadySet,
    notApplied: report.notApplied.length, sample: report.notApplied.slice(0, 3), out }, null, 2));
}

main().catch((error: unknown) => { console.error(error); process.exitCode = 1; }).finally(() => closeDb());
