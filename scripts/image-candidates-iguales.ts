// CRV · Candidatas que son la MISMA imagen que la actual (Brian, 2026-10-04:
// «marca o acepta todos los que son iguales»).
//
// Lee las medidas de scripts/image-candidates-medir.py y, por ficha:
//   · guarda en cada candidata medida su parecido y tamaño (la página los muestra);
//   · parecido ≥ SAME (revisado a ojo: 0,50–1,00 es la misma portada con otro
//     recorte o color; por debajo hay de todo) y NO más grande que la actual →
//     se descarta (la actual se queda);
//   · misma imagen y MÁS grande que la actual → si es lo único pendiente de la
//     ficha, se usa (updateEntity, auditado); si hay otras distintas, queda abierta.
// Lo distinto o no medido sigue abierto para elegir a ojo.
//
// UN run de operador; sin --confirm corre y se deshace. --sample N: N fichas al azar.
//
//   ./scripts/with-node22.sh npx tsx scripts/image-candidates-iguales.ts [--sample 40] [--confirm]
import { readFileSync } from "node:fs";
import { closeDb } from "../src/db/client.js";
import { OperatorError, updateEntity, withOperatorRun } from "../src/merge/operator.js";
import { IMAGE_FIELD, type ImageEntityKind } from "../src/merge/image-candidates.js";

const MEASURES = "data/raw/image-candidates-medidas-2026-10-04.jsonl";
const NOTE = "Candidatas iguales a la imagen actual: se deja la actual o se usa la misma en más grande (Brian, 2026-10-04)";
const SAME = 0.5;

interface Measure { id: number; score?: number; size?: [number, number]; currentSize?: [number, number]; error?: string }
interface Open { id: string; kind: ImageEntityKind; entity_id: string; current_url: string | null; candidate_url: string; live: string | null }
class DryRun extends Error {
  constructor(readonly counts: Record<string, number>, readonly lines: string[]) { super("dry-run"); }
}

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main(): Promise<void> {
  const confirm = process.argv.includes("--confirm");
  const sample = arg("--sample") === undefined ? undefined : Math.max(1, Math.trunc(Number(arg("--sample"))));
  const measures = new Map(readFileSync(MEASURES, "utf8").split("\n").filter(Boolean)
    .map((line) => JSON.parse(line) as Measure).filter((m) => !m.error).map((m) => [m.id, m]));
  let counts: Record<string, number>;
  let lines: string[];
  let runId: number | null = null;
  try {
    const done = await withOperatorRun({ name: "image_candidates_same", operator: "brian", note: NOTE, params: { measures: MEASURES, same: SAME, sample: sample ?? null } }, async (context) => {
      const count: Record<string, number> = { fichas: 0, "medidas guardadas": 0, "descartadas (iguales)": 0, "usadas (igual y más grande)": 0, "fichas cerradas": 0, "quedan abiertas": 0 };
      const out: string[] = [];
      const { rows } = await context.client.query<Open>(`
        SELECT c.id::text, c.entity_kind AS kind, COALESCE(c.album_id, c.artist_id)::text AS entity_id, c.current_url, c.candidate_url,
               COALESCE(al.cover_url, ar.picture_url) AS live
          FROM ingest.image_candidates c
          LEFT JOIN public.albums al ON al.id = c.album_id
          LEFT JOIN public.artists ar ON ar.id = c.artist_id
         WHERE c.status = 'open'
         ORDER BY c.id
         FOR UPDATE OF c`);
      const byEntity = new Map<string, Open[]>();
      for (const row of rows) byEntity.set(`${row.kind}:${row.entity_id}`, [...(byEntity.get(`${row.kind}:${row.entity_id}`) ?? []), row]);
      let entities = [...byEntity.values()];
      if (sample !== undefined) entities = entities.sort(() => Math.random() - 0.5).slice(0, sample);
      for (const group of entities) {
        count["fichas"]! += 1;
        const { kind } = group[0]!;
        const entityId = Number(group[0]!.entity_id);
        const same: Array<{ row: Open; measure: Measure; bigger: boolean }> = [];
        for (const row of group) {
          const measure = measures.get(Number(row.id));
          if (!measure?.size) continue;
          await context.client.query("UPDATE ingest.image_candidates SET score=$2, width=$3, height=$4 WHERE id=$1",
            [row.id, Math.min(Math.max(measure.score ?? 0, 0), 1), measure.size[0], measure.size[1]]);
          count["medidas guardadas"]! += 1;
          // La ficha cambió de imagen desde la propuesta: la comparación no vale.
          if (row.live !== row.current_url || (measure.score ?? 0) < SAME) continue;
          same.push({ row, measure, bigger: Math.max(...measure.size) > Math.max(...(measure.currentSize ?? [0, 0])) });
        }
        const bigger = same.filter((item) => item.bigger).sort((a, b) => Math.max(...b.measure.size!) - Math.max(...a.measure.size!));
        const allSame = same.length === group.length;
        const chosen = allSame ? bigger[0] : undefined;
        if (chosen) {
          await updateEntity(context, kind, entityId, { [IMAGE_FIELD[kind]]: chosen.row.candidate_url });
          count["usadas (igual y más grande)"]! += 1;
        }
        const closing = same.filter((item) => item === chosen || !item.bigger);
        for (const item of closing) {
          await context.client.query(`
            UPDATE ingest.image_candidates SET status=$2, decided_by=$3, decided_at=now(), decision_run_id=$4 WHERE id=$1`,
          [item.row.id, item === chosen ? "chosen" : "rejected", context.operator, context.runId]);
          if (item !== chosen) count["descartadas (iguales)"]! += 1;
        }
        // Si se usó una, el resto de la ficha (todas iguales y más chicas o menos) se cierra con ella.
        if (chosen) {
          await context.client.query(`
            UPDATE ingest.image_candidates SET status='rejected', decided_by=$2, decided_at=now(), decision_run_id=$3
             WHERE id = ANY($1::bigint[]) AND status='open'`, [group.map((row) => row.id), context.operator, context.runId]);
        }
        const left = chosen ? 0 : group.length - closing.length;
        if (left === 0) count["fichas cerradas"]! += 1;
        count["quedan abiertas"]! += left;
        out.push(`${kind}:${entityId} · ${group.length} candidatas · iguales ${same.length}${chosen ? ` · usa ${chosen.measure.size!.join("×")}` : ""} · abiertas ${left}`);
      }
      if (!confirm) throw new DryRun(count, out);
      return { count, out };
    });
    runId = done.runId;
    counts = done.result.count;
    lines = done.result.out;
  } catch (error) {
    if (error instanceof OperatorError) throw error;
    if (!(error instanceof DryRun)) throw error;
    counts = error.counts;
    lines = error.lines;
  }
  for (const line of lines.slice(0, 40)) console.log(line);
  console.log(`${confirm ? `run ${runId}` : "ensayo"} · ${Object.entries(counts).map(([key, value]) => `${key} ${value}`).join(" · ")}`);
}

main().finally(() => closeDb()).catch((error) => { console.error(error); process.exitCode = 1; });
