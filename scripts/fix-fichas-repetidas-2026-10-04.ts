// CRV · Aplica reports/fichas-repetidas-2026-10-04-plan.json (lo genera
// scripts/plan-fichas-repetidas-2026-10-04.ts; reglas y motivos allí).
//
// Orden: artistas → organizaciones → personas (+ grafía con tilde) → discos →
// pistas → pares distintos → careos de la Mesa que se descartan → alias
// ambiguos de la cola → «sello que es artista» (autoedición, se ignora).
// Cada grupo va en su SAVEPOINT: si uno falla se anota y sigue. UN run de
// operador. Sin --confirm corre entero y se deshace. Los careos que se
// aceptan van después, uno por uno, por acceptReview (la Mesa).
//
//   ./scripts/with-node22.sh npx tsx scripts/fix-fichas-repetidas-2026-10-04.ts [--plan=archivo.json] [--confirm]
import { readFileSync, writeFileSync } from "node:fs";
import { closeDb } from "../src/db/client.js";
import { mergeAlbums, previewAlbumMerge } from "../src/merge/album-merge.js";
import { mergeEntities, previewEntityMerge, type MergeableKind } from "../src/merge/entity-merge.js";
import { updateEntity, withOperatorRun, type OperatorContext } from "../src/merge/operator.js";
import { mergeInto } from "../src/review/duplicates.js";
import { acceptReview } from "../src/review/operator-review.js";

const PLAN = process.argv.find((arg) => arg.startsWith("--plan="))?.slice(7) ?? "reports/fichas-repetidas-2026-10-04-plan.json";
const NOTE = "Fichas repetidas de Curaduría: decisiones recomendadas (Brian, 2026-10-04)";

type Kind = "person" | "organization" | "artist" | "album" | "track";
interface Group { keep: number; drops: number[]; why: string[] }
interface Plan {
  merges: Record<Kind, Group[]>;
  distinct: Record<Kind, Array<{ a: number; b: number; why: string }>>;
  personRenames: Record<string, string>;
  mesa: Array<{ reviewId: number; verdict: "same" | "dismiss"; why: string }>;
  labelIsArtist: number[];
}
class DryRun extends Error {
  constructor(readonly lines: string[], readonly stats: Record<string, number>) { super("dry-run"); }
}
const TABLE: Record<Kind, string> = { person: "persons", organization: "organizations", artist: "artists", album: "albums", track: "tracks" };

async function exists(context: OperatorContext, kind: Kind, id: number): Promise<boolean> {
  return ((await context.client.query(`SELECT 1 FROM public.${TABLE[kind]} WHERE id=$1`, [id])).rowCount ?? 0) > 0;
}

async function mergeGroup(context: OperatorContext, kind: Kind, group: Group): Promise<number> {
  let merged = 0;
  for (const drop of group.drops) {
    if (!(await exists(context, kind, drop)) || !(await exists(context, kind, group.keep))) continue;
    if (kind === "album") {
      const preview = await previewAlbumMerge(context.client, group.keep, drop, { lock: true });
      await mergeAlbums(context, { keepId: group.keep, dropId: drop, previewHash: preview.previewHash, keepDropNameAsAlias: preview.drop.title !== preview.keep.title });
    } else if (kind === "track") {
      await mergeInto(context.client, "track", group.keep, drop, context.note, context.runId, { alias: true });
    } else {
      const preview = await previewEntityMerge(context.client, kind as MergeableKind, group.keep, drop, { lock: true });
      await mergeEntities(context, {
        kind: kind as MergeableKind, keepId: group.keep, dropId: drop, previewHash: preview.previewHash,
        keepDropNameAsAlias: preview.drop.name !== preview.keep.name, rewriteLater: true,
      });
    }
    merged += 1;
  }
  return merged;
}

async function main(): Promise<void> {
  const confirm = process.argv.includes("--confirm");
  const plan = JSON.parse(readFileSync(PLAN, "utf8")) as Plan;
  let runId: number | null = null;
  let lines: string[];
  let stats: Record<string, number>;
  try {
    const done = await withOperatorRun({ name: "fix-fichas-repetidas-2026-10-04", operator: "brian", note: NOTE, params: { plan: PLAN } }, async (context) => {
      const out: string[] = [];
      const count: Record<string, number> = {};
      const bump = (key: string, by = 1) => { count[key] = (count[key] ?? 0) + by; };
      for (const kind of ["artist", "organization", "person", "album", "track"] as Kind[]) {
        out.push(`\n## Fusiones: ${kind}`);
        for (const group of plan.merges[kind] ?? []) {
          await context.client.query("SAVEPOINT grupo");
          try {
            const merged = await mergeGroup(context, kind, group);
            const rename = kind === "person" ? plan.personRenames[String(group.keep)] : undefined;
            if (rename && merged > 0) { await updateEntity(context, "person", group.keep, { name: rename }); bump("renombres"); }
            await context.client.query("RELEASE SAVEPOINT grupo");
            bump(`${kind}:fusionadas`, merged);
            out.push(`- ${group.keep}${rename ? ` «${rename}»` : ""} ← ${group.drops.join(", ")} (${[...new Set(group.why)].join("; ")})`);
          } catch (error) {
            await context.client.query("ROLLBACK TO SAVEPOINT grupo");
            bump(`${kind}:fallidos`);
            out.push(`- FALLÓ ${group.keep} ← ${group.drops.join(", ")}: ${(error as Error).message.slice(0, 200)}`);
          }
        }
      }
      // Pares distintos: el detector no vuelve a proponerlos
      for (const kind of Object.keys(plan.distinct) as Kind[]) {
        for (const pair of plan.distinct[kind]) {
          if (!(await exists(context, kind, pair.a)) || !(await exists(context, kind, pair.b))) { bump(`${kind}:distinto_sin_ficha`); continue; }
          const inserted = await context.client.query(`
            INSERT INTO ingest.curation_distinct_pairs (kind, a_id, b_id, decided_by, note) VALUES ($1, $2, $3, 'brian', $4)
            ON CONFLICT (kind, a_id, b_id) DO NOTHING`, [kind, pair.a, pair.b, `[run ${context.runId}] ${pair.why}`]);
          bump(`${kind}:distintos`, inserted.rowCount ?? 0);
        }
      }
      // Careos de la Mesa que no crean nada: la ficha ya existe o no hay vínculos
      for (const item of plan.mesa.filter((m) => m.verdict === "dismiss")) {
        const closed = await context.client.query(`
          UPDATE ingest.review_queue SET status='dismissed', resolved_by='human', resolved_at=now(), updated_at=now(), resolution_note=$2
           WHERE id=$1 AND status IN ('open','in_progress') RETURNING claim_a_id`, [item.reviewId, `[run ${context.runId}] ${NOTE}: ${item.why}`]);
        const claim = closed.rows[0]?.claim_a_id;
        if (claim) await context.client.query("UPDATE ingest.claims SET status='superseded', updated_at=now(), notes=concat_ws(' · ', notes, $2::text) WHERE id=$1 AND status='candidate'",
          [claim, `[run ${context.runId}] careo descartado: ${item.why}`]);
        bump("mesa:descartados", closed.rowCount ?? 0);
      }
      // Alias ambiguos: el alias no se aplicó porque ya era de otra ficha. Tras
      // las fusiones, o son la misma ficha (el alias quedó al fusionar) o son
      // homónimos legítimos (otra grabación, otro disco): se cierran.
      const aliases = await context.client.query(`
        UPDATE ingest.review_queue q
           SET status='dismissed', resolved_by='human', resolved_at=now(), updated_at=now(),
               resolution_note = '[run ' || $1::text || '] ' || $2::text || ': ' ||
                 CASE WHEN q.payload->>'entityKind'='track' THEN 'pista homónima de otra grabación; el título ya está en la pista'
                      ELSE 'par decidido en Fichas repetidas (fusión o declarado distinto)' END
         WHERE q.kind='ambiguous_alias' AND q.status IN ('open','in_progress')`, [String(context.runId), NOTE]);
      bump("alias_ambiguos:cerrados", aliases.rowCount ?? 0);
      // Sello con el nombre del artista: autoedición, correcto a propósito
      const ignored = await context.client.query(`
        UPDATE ingest.curation_findings SET status='ignored', ignored_at=now(), ignored_by='brian', ignore_reason='correcto_a_proposito',
               ignore_note=$2 WHERE id = ANY($1::bigint[]) AND status='open'`,
      [plan.labelIsArtist, `[run ${context.runId}] autoedición: el sello lleva el nombre del artista (dato de la fuente)`]);
      bump("sello_artista:ignorados", ignored.rowCount ?? 0);
      if (!confirm) throw new DryRun(out, count);
      return { out, count };
    });
    runId = done.runId;
    lines = done.result.out;
    stats = done.result.count;
  } catch (error) {
    if (!(error instanceof DryRun)) throw error;
    lines = error.lines;
    stats = error.stats;
  }
  // Careos que se aceptan: la Mesa los aplica uno por uno
  if (confirm) {
    lines.push("\n## Careos aceptados (Mesa)");
    for (const item of plan.mesa.filter((m) => m.verdict === "same")) {
      try {
        const result = await acceptReview(item.reviewId, { operator: "brian", note: `${NOTE}: ${item.why}` });
        stats["mesa:aceptados"] = (stats["mesa:aceptados"] ?? 0) + 1;
        lines.push(`- ${item.reviewId}: ${result.detail} (run ${result.runId})`);
      } catch (error) {
        stats["mesa:fallidos"] = (stats["mesa:fallidos"] ?? 0) + 1;
        lines.push(`- FALLÓ ${item.reviewId}: ${(error as Error).message.slice(0, 200)}`);
      }
    }
  }
  const mode = confirm ? "confirm" : "dry-run";
  const file = `${PLAN.replace(/-plan\.json$/u, "")}-${mode}${runId ? `-run${runId}` : ""}.md`;
  const summary = Object.entries(stats).sort().map(([key, value]) => `${key} ${value}`).join(" · ");
  writeFileSync(file, [`# Fichas repetidas (${mode}${runId ? `, run ${runId}` : ""})`, "", NOTE, "", summary, "", ...lines, ""].join("\n"));
  console.log(`${summary} → ${file}`);
}

main().finally(() => closeDb()).catch((error) => { console.error(error); process.exitCode = 1; });
