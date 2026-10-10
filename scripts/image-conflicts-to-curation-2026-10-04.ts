// CRV · Conflictos de portada y foto de artista → Curaduría · Portadas y fotos
// (Brian, 2026-10-04: «cada imagen que entre al catálogo… crea un conflicto que
// aparece en curaduría Portadas y fotos para seleccionar cuál debe quedar como
// principal»).
//
// La regla nueva vive en el motor (src/merge/image-candidates.ts). Este script
// pasa a la sección los conflictos genéricos de `cover_url`/`picture_url` que
// ya estaban abiertos en la cola: la imagen que la ficha muestra se queda, la
// otra se propone como candidata (salvo que sea la misma de la copia local), y
// el conflicto y su revisión se cierran como «dismissed» con nota.
//
// UN run de operador; sin --confirm corre y se deshace. --sample N limita a N
// conflictos al azar (ensayo).
//
//   ./scripts/with-node22.sh npx tsx scripts/image-conflicts-to-curation-2026-10-04.ts [--sample 40] [--confirm]
import { closeDb } from "../src/db/client.js";
import { withOperatorRun } from "../src/merge/operator.js";
import { IMAGE_FIELD, proposeImageCandidate, type ImageEntityKind } from "../src/merge/image-candidates.js";

const NOTE = "Conflictos de portada/foto pasan a Curaduría · Portadas y fotos; la imagen actual se queda (regla de Brian, 2026-10-04)";
const ORIGIN = "cola-conflictos-2026-10-04";

class DryRun extends Error {
  constructor(readonly counts: Record<string, number>, readonly lines: string[]) { super("dry-run"); }
}

interface Row {
  conflict_id: string; kind: ImageEntityKind; target_id: string; current: string | null;
  claim_a: string; value_a: string; source_a: string; claim_b: string; value_b: string; source_b: string;
}

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main(): Promise<void> {
  const confirm = process.argv.includes("--confirm");
  const sample = arg("--sample") === undefined ? undefined : Number(arg("--sample"));
  let counts: Record<string, number>;
  let lines: string[];
  let runId: number | null = null;
  try {
    const done = await withOperatorRun({ name: "image_conflicts_to_curation", operator: "brian", note: NOTE, params: { sample: sample ?? null } }, async (context) => {
      const count: Record<string, number> = { conflictos: 0, "candidatas nuevas": 0, "ya eran candidatas": 0, "misma imagen que la actual": 0, revisiones: 0 };
      const out: string[] = [];
      const { rows } = await context.client.query<Row>(`
        SELECT c.id::text AS conflict_id, c.entity_kind::text AS kind,
               COALESCE(cb.album_id, cb.artist_id)::text AS target_id,
               COALESCE(al.cover_url, ar.picture_url) AS current,
               ca.id::text AS claim_a, c.value_a #>> '{}' AS value_a, sa.name AS source_a,
               cb.id::text AS claim_b, c.value_b #>> '{}' AS value_b, sb.name AS source_b
          FROM ingest.conflicts c
          JOIN ingest.claims ca ON ca.id = c.claim_a_id JOIN ingest.sources sa ON sa.id = ca.source_id
          JOIN ingest.claims cb ON cb.id = c.claim_b_id JOIN ingest.sources sb ON sb.id = cb.source_id
          LEFT JOIN public.albums al ON c.field = 'cover_url' AND al.id = cb.album_id
          LEFT JOIN public.artists ar ON c.field = 'picture_url' AND ar.id = cb.artist_id
         WHERE c.status = 'open'
           AND ((c.entity_kind = 'album' AND c.field = $1) OR (c.entity_kind = 'artist' AND c.field = $2))
         ORDER BY ${sample === undefined ? "c.id" : "random()"}
         ${sample === undefined ? "" : `LIMIT ${Math.max(1, Math.trunc(sample))}`}
         FOR UPDATE OF c`, [IMAGE_FIELD.album, IMAGE_FIELD.artist]);
      for (const row of rows) {
        count["conflictos"]! += 1;
        const targetId = Number(row.target_id);
        const outcomes: string[] = [];
        for (const [claimId, value, source] of [[row.claim_a, row.value_a, row.source_a], [row.claim_b, row.value_b, row.source_b]] as const) {
          let status = "accepted";
          if (row.current !== null && value !== row.current) {
            const result = await proposeImageCandidate(context.client, {
              kind: row.kind, targetId, currentUrl: row.current, candidateUrl: value, claimId: Number(claimId),
              source, origin: ORIGIN, runId: context.runId,
            });
            if (result === "proposed") { count["candidatas nuevas"]! += 1; status = "candidate"; }
            else if (result === "already") { count["ya eran candidatas"]! += 1; status = "candidate"; }
            else count["misma imagen que la actual"]! += 1;
            outcomes.push(`${source}: ${result}`);
          }
          await context.client.query("UPDATE ingest.claims SET status=$2, updated_at=now() WHERE id=$1 AND status='conflict'", [claimId, status]);
        }
        await context.client.query(`
          UPDATE ingest.conflicts SET status='dismissed', resolved_by='human', resolved_at=now(),
                 resolution_note='Pasa a Curaduría · Portadas y fotos (regla de imágenes, 2026-10-04)'
           WHERE id=$1`, [row.conflict_id]);
        const reviews = await context.client.query(`
          UPDATE ingest.review_queue SET status='dismissed', resolved_by='human', resolved_at=now(), updated_at=now(),
                 resolution_note='Pasa a Curaduría · Portadas y fotos (regla de imágenes, 2026-10-04)'
           WHERE conflict_id=$1 AND status IN ('open','in_progress')`, [row.conflict_id]);
        count["revisiones"]! += reviews.rowCount ?? 0;
        out.push(`${row.kind}:${targetId} conflicto ${row.conflict_id} · actual ${row.current} · ${outcomes.join(" · ") || "sin candidatas"}`);
      }
      if (!confirm) throw new DryRun(count, out);
      return { count, out };
    });
    runId = done.runId;
    counts = done.result.count;
    lines = done.result.out;
  } catch (error) {
    if (!(error instanceof DryRun)) throw error;
    counts = error.counts;
    lines = error.lines;
  }
  for (const line of lines.slice(0, 60)) console.log(line);
  console.log(`${confirm ? `run ${runId}` : "ensayo"} · ${Object.entries(counts).map(([key, value]) => `${key} ${value}`).join(" · ")}`);
}

main().finally(() => closeDb()).catch((error) => { console.error(error); process.exitCode = 1; });
