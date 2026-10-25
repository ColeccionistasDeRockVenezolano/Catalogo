// CRV · Plan v2 del primo, etapa 3: aplica reports/plan-v2-etapa3/plan.json
// (lo genera scripts/plan-v2-etapa3-plan.ts). Un run de operador por bloque,
// para deshacer cada uno con `npm run cli -- runs undo <run> --confirm`.
//
//   3a / 3b · fusiones de personas (mergeEntities: bios unidas y marcadas para
//             reescribir, el nombre absorbido queda como alias). Si la ficha
//             principal cambia de grafía, la vieja también queda como alias.
//             Un grupo que falla (p. ej. era-guard) se deshace y sus pares van
//             a la cola. Los pares sin vínculo se abren como person_duplicate.
//   3c      · fusiones de discos (mergeAlbums en modo match; el título que se
//             pierde queda como alias) y la nota «Grabado en …».
//   3d      · renombre del artista a la grafía con tilde; la vieja, alias.
//
// Sin --confirm corre entero y se deshace (rollbackOnly).
//
//   ./scripts/with-node22.sh npx tsx scripts/plan-v2-etapa3-apply.ts --block=3a|3b|3c|3d [--confirm]
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { closeDb } from "../src/db/client.js";
import { mergeAlbums, previewAlbumMerge } from "../src/merge/album-merge.js";
import { mergeEntities, previewEntityMerge } from "../src/merge/entity-merge.js";
import { updateEntity, withOperatorRun, type OperatorContext } from "../src/merge/operator.js";
import { createAlias, type AliasKind } from "../src/api/repositories/aliases.js";

const DIR = "reports/plan-v2-etapa3";
const block = process.argv.find((arg) => arg.startsWith("--block="))?.slice(8) ?? "";
const confirm = process.argv.includes("--confirm");
if (!["3a", "3b", "3c", "3d"].includes(block)) throw new Error("--block=3a|3b|3c|3d");
const NOTES: Record<string, string> = {
  "3a": "Plan v2 del primo, etapa 3a: personas que solo difieren en tildes o mayúsculas, fusionadas con proyecto común (D3)",
  "3b": "Plan v2 del primo, etapa 3b: abreviaturas y apellidos sueltos unidos al nombre completo del integrante",
  "3c": "Plan v2 del primo, etapa 3c: discos repetidos del mismo artista (tilde, espacio, año pegado o alias)",
  "3d": "Plan v2 del primo, etapa 3d: artistas renombrados a la grafía con tilde de su fuente (D3)",
};
const NOTE = NOTES[block]!;

interface MergeGroup { keep: number; keepName: string; name: string; nameWhy: string; drops: number[]; names: string[]; why: string[] }
interface QueuePair { a: number; b: number; aName: string; bName: string; why: string }
interface AlbumMerge { keep: number; drop: number; artist: string; keepTitle: string; dropTitle: string; title: string | null; titleWhy: string; recordedNote: string | null; why: string }
interface Rename { id: number; from: string; to: string; why: string }
const plan = JSON.parse(readFileSync(`${DIR}/plan.json`, "utf8")) as Record<string, { merge?: MergeGroup[] | AlbumMerge[]; queue?: QueuePair[]; rename?: Rename[] }>;

/** Alias si la ficha aún no lo tiene (ni como alias ni como nombre). */
async function aliasIfMissing(context: OperatorContext, kind: AliasKind, table: string, column: string, id: number, alias: string): Promise<boolean> {
  const exists = await context.client.query(`SELECT 1 FROM ${table} WHERE ${column}=$1 AND alias=$2`, [id, alias]);
  if (exists.rowCount) return false;
  await createAlias(context, kind, id, { alias, aliasType: "spelling_variant", isPrimary: false });
  return true;
}

async function openPair(context: OperatorContext, pair: QueuePair): Promise<boolean> {
  const inserted = await context.client.query(`
    INSERT INTO ingest.review_queue(kind,person_a_id,person_b_id,priority,status,payload,notes)
    VALUES('person_duplicate',LEAST($1::bigint,$2::bigint),GREATEST($1::bigint,$2::bigint),6,'open',$3::jsonb,$4)
    ON CONFLICT DO NOTHING`, [pair.a, pair.b,
    JSON.stringify({ detector: "plan-v2-etapa3", block, version: 1, runId: context.runId, why: pair.why }),
    `${NOTE} — «${pair.aName}» / «${pair.bName}»: ${pair.why}`]);
  return (inserted.rowCount ?? 0) > 0;
}

async function persons(context: OperatorContext, out: string[], count: Record<string, number>): Promise<void> {
  const groups = (plan[block]!.merge ?? []) as MergeGroup[];
  for (const group of groups) {
    await context.client.query("SAVEPOINT grupo");
    try {
      const alive = (await context.client.query<{ id: string }>("SELECT id::text FROM public.persons WHERE id = ANY($1::bigint[])",
        [[group.keep, ...group.drops]])).rows.map((r) => Number(r.id));
      if (!alive.includes(group.keep)) throw new Error(`la ficha principal ${group.keep} ya no existe`);
      const before = (await context.client.query<{ name: string }>("SELECT name FROM public.persons WHERE id=$1", [group.keep])).rows[0]!.name;
      let merged = 0;
      for (const drop of group.drops.filter((id) => alive.includes(id))) {
        const preview = await previewEntityMerge(context.client, "person", group.keep, drop, { lock: true });
        await mergeEntities(context, {
          kind: "person", keepId: group.keep, dropId: drop, previewHash: preview.previewHash,
          keepDropNameAsAlias: preview.drop.name !== preview.keep.name, rewriteLater: true,
        });
        merged += 1;
      }
      if (group.name !== before) {
        await updateEntity(context, "person", group.keep, { name: group.name });
        await aliasIfMissing(context, "person", "ingest.person_aliases", "person_id", group.keep, before);
        count["renombradas"]! += 1;
      }
      await context.client.query("RELEASE SAVEPOINT grupo");
      count["grupos"]! += 1;
      count["fusionadas"]! += merged;
      out.push(`- ${group.keep} «${group.name}» ← ${group.drops.join(", ")} (${group.names.join(" · ")}) — ${group.why.join("; ")}`);
    } catch (error) {
      await context.client.query("ROLLBACK TO SAVEPOINT grupo");
      count["fallidos"]! += 1;
      let queued = 0;
      for (const drop of group.drops) {
        if (await openPair(context, { a: group.keep, b: drop, aName: group.name, bName: group.names[group.drops.indexOf(drop) + 1] ?? String(drop), why: `fusión rechazada: ${(error as Error).message.slice(0, 160)}` })) queued += 1;
      }
      count["cola"]! += queued;
      out.push(`- NO FUSIONADO (a la cola) ${group.keep} «${group.keepName}» ← ${group.drops.join(", ")}: ${(error as Error).message.slice(0, 200)}`);
    }
  }
  out.push("", "## Abiertos en la cola (sin vínculo o ambiguos)", "");
  for (const pair of plan[block]!.queue ?? []) {
    const alive = await context.client.query("SELECT count(*)::int n FROM public.persons WHERE id IN ($1,$2)", [pair.a, pair.b]);
    if ((alive.rows[0] as { n: number }).n < 2) continue;
    if (await openPair(context, pair)) { count["cola"]! += 1; out.push(`- ${pair.a} «${pair.aName}» / ${pair.b} «${pair.bName}»: ${pair.why}`); }
  }
}

async function albums(context: OperatorContext, out: string[], count: Record<string, number>): Promise<void> {
  for (const m of (plan["3c"]!.merge ?? []) as AlbumMerge[]) {
    await context.client.query("SAVEPOINT disco");
    try {
      const preview = await previewAlbumMerge(context.client, m.keep, m.drop, { lock: true, mode: "match" });
      const result = await mergeAlbums(context, {
        keepId: m.keep, dropId: m.drop, previewHash: preview.previewHash, keepDropNameAsAlias: true, mode: "match",
        ...(m.title ? { title: m.title } : {}),
      });
      if (m.recordedNote) {
        const notes = (await context.client.query<{ notes: string | null }>("SELECT notes FROM public.albums WHERE id=$1", [m.keep])).rows[0]?.notes ?? null;
        if (!notes?.includes(m.recordedNote)) await updateEntity(context, "album", m.keep, { notes: notes ? `${notes}\n${m.recordedNote}` : m.recordedNote });
      }
      await context.client.query("RELEASE SAVEPOINT disco");
      count["fusionados"]! += 1;
      out.push(`- ${m.keep} ← ${m.drop} [${m.artist}] «${m.keepTitle}» + «${m.dropTitle}»${m.title ? ` → «${m.title}» (${m.titleWhy})` : ""}${m.recordedNote ? ` · nota «${m.recordedNote}»` : ""} — ${m.why}; ${result.tracksMerged} pistas unidas, ${result.tracksMoved} movidas`);
    } catch (error) {
      await context.client.query("ROLLBACK TO SAVEPOINT disco");
      count["fallidos"]! += 1;
      out.push(`- FALLÓ ${m.keep} ← ${m.drop} [${m.artist}]: ${(error as Error).message.slice(0, 200)}`);
    }
  }
}

async function artists(context: OperatorContext, out: string[], count: Record<string, number>): Promise<void> {
  for (const r of plan["3d"]!.rename ?? []) {
    await context.client.query("SAVEPOINT artista");
    try {
      const now = (await context.client.query<{ name: string }>("SELECT name FROM public.artists WHERE id=$1", [r.id])).rows[0]?.name;
      if (now !== r.from) throw new Error(`el nombre actual es «${now}», no «${r.from}»`);
      await updateEntity(context, "artist", r.id, { name: r.to });
      await aliasIfMissing(context, "artist", "ingest.artist_aliases", "artist_id", r.id, r.from);
      await context.client.query("RELEASE SAVEPOINT artista");
      count["renombrados"]! += 1;
      out.push(`- ${r.id} «${r.from}» → «${r.to}» — ${r.why}`);
    } catch (error) {
      await context.client.query("ROLLBACK TO SAVEPOINT artista");
      count["fallidos"]! += 1;
      out.push(`- FALLÓ ${r.id} «${r.from}» → «${r.to}»: ${(error as Error).message.slice(0, 200)}`);
    }
  }
}

const count: Record<string, number> = block === "3c" ? { fusionados: 0, fallidos: 0 }
  : block === "3d" ? { renombrados: 0, fallidos: 0 } : { grupos: 0, fusionadas: 0, renombradas: 0, fallidos: 0, cola: 0 };
const lines: string[] = [];
const { runId } = await withOperatorRun({
  name: `plan-v2-etapa3-${block}`, operator: "claude-code", note: NOTE, params: { plan: `${DIR}/plan.json`, block },
}, async (context) => {
  if (block === "3a" || block === "3b") await persons(context, lines, count);
  else if (block === "3c") await albums(context, lines, count);
  else await artists(context, lines, count);
}, { rollbackOnly: !confirm });

mkdirSync(DIR, { recursive: true });
const mode = confirm ? "confirm" : "dry-run";
const file = `${DIR}/${block}-${mode}${confirm ? `-run${runId}` : ""}.md`;
const summary = Object.entries(count).map(([key, value]) => `${key} ${value}`).join(" · ");
writeFileSync(file, [`# Etapa ${block} (${mode}${confirm ? `, run ${runId}` : ""})`, "", NOTE, "", summary, "", ...lines, ""].join("\n"));
console.log(`${confirm ? `run ${runId} · ` : ""}${summary} → ${file}`);
await closeDb();
