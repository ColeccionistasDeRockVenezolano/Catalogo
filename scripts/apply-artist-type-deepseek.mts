// Aplica el tipo de artista propuesto por scripts/check-artist-type-deepseek.mts
// (bio + lista de integrantes) en un run reversible. Solo toca fichas cuyo tipo
// nadie afirmó y que siguen con el tipo leído; los conflictos con un tipo
// afirmado van a la cola de revisión sin tocar el core.
// Uso: tsx apply-artist-type-deepseek.mts [--dir=reports/tipo-artista-2026-10-15] [--confirm]
import { readFileSync, writeFileSync } from "node:fs";
import { closeDb, getPool } from "../src/db/client.js";
import { updateEntity, withOperatorRun } from "../src/merge/operator.js";

interface Row {
  artistId: number; name: string; tipo: string; tipo_actual: string; afirmado: boolean;
  integrantes_segun_bio: number | null; integrantes_registrados: number; cita: string; nota: string;
}

const DIR = process.argv.find((arg) => arg.startsWith("--dir="))?.slice(6) ?? "reports/tipo-artista-2026-10-15";
const confirm = process.argv.includes("--confirm");
const OPERATOR = "claude-code (delegado por Brian)";

// Revisión de Brian/Claude sobre la tanda del 2026-10-15.
// Recopilaciones, tributos, festivales y splits: no son un artista con tipo.
const EXCLUIR = new Map<number, string>([
  [1781, "recopilación (Sudamerica Brutal 2)"], [1470, "recopilación (Venezuela Electrónica)"],
  [3422, "proyecto discográfico de un productor (Venezuela Suite)"], [1022, "disco de remezclas (Simón Díaz Remixes)"],
  [1621, "colectivo de tributo (Tributo Aldemaro Romero)"], [1636, "festival (W.T.Fest)"],
  [890, "split de dos bandas (Triangular Ascension/Abiotha)"],
]);
// Un solo músico con nombre que no es de persona → proyecto, no solista.
const A_PROYECTO = new Set([704, 799, 913, 1411, 2410, 2488, 2578, 3091, 3094, 3123, 3176, 3179, 4644]);
// DJ con nombre de persona → solista.
const A_SOLISTA = new Set([2884, 2889]);

const AFIRMADOS = `
  WITH afirmados AS (
    SELECT artist_id AS id FROM ingest.merge_audit WHERE entity_kind = 'artist' AND field = 'artist_type'
    UNION
    SELECT (new_data->>'id')::bigint FROM ingest.change_journal
     WHERE table_name = 'artists' AND op = 'UPDATE' AND old_data->>'artist_type' IS DISTINCT FROM new_data->>'artist_type')
  SELECT a.id::int AS id, a.artist_type::text AS tipo, (a.artist_type::text <> 'band' OR a.id IN (SELECT id FROM afirmados)) AS afirmado
    FROM public.artists a WHERE a.id = ANY($1::bigint[])`;

const read = (file: string) => readFileSync(`${DIR}/${file}`, "utf8").split("\n").filter((line) => line.trim()).map((line) => JSON.parse(line) as Row);
const finalType = (row: Row) => (A_PROYECTO.has(row.artistId) ? "project" : A_SOLISTA.has(row.artistId) ? "solo_artist" : row.tipo);

async function main(): Promise<void> {
  const cambios = read("cambiar.jsonl");
  const conflictos = read("conflictos.jsonl");
  const pool = getPool();
  const ids = [...cambios, ...conflictos].map((row) => row.artistId);
  const now = new Map((await pool.query<{ id: number; tipo: string; afirmado: boolean }>(AFIRMADOS, [ids])).rows.map((row) => [row.id, row]));

  const aplicar: Array<Row & { nuevo: string }> = [];
  const saltados: Array<{ artistId: number; name: string; motivo: string }> = [];
  for (const row of cambios) {
    const current = now.get(row.artistId);
    const excluded = EXCLUIR.get(row.artistId);
    if (excluded) { saltados.push({ artistId: row.artistId, name: row.name, motivo: excluded }); continue; }
    if (!current) { saltados.push({ artistId: row.artistId, name: row.name, motivo: "la ficha ya no existe" }); continue; }
    if (current.tipo !== row.tipo_actual || current.afirmado) {
      saltados.push({ artistId: row.artistId, name: row.name, motivo: `cambió desde la lectura (${current.tipo}, afirmado=${current.afirmado})` });
      continue;
    }
    const nuevo = finalType(row);
    if (nuevo === current.tipo) { saltados.push({ artistId: row.artistId, name: row.name, motivo: "ya tiene ese tipo" }); continue; }
    aplicar.push({ ...row, nuevo });
  }
  const cola = conflictos.filter((row) => now.has(row.artistId));
  const tally = (list: Array<{ tipo_actual: string; nuevo?: string; tipo: string }>) =>
    list.reduce<Record<string, number>>((acc, row) => { const key = `${row.tipo_actual}→${row.nuevo ?? row.tipo}`; acc[key] = (acc[key] ?? 0) + 1; return acc; }, {});

  if (!confirm) {
    for (const row of aplicar) console.log(`${row.artistId} «${row.name}» ${row.tipo_actual} → ${row.nuevo}`);
    console.log(JSON.stringify({ aplicar: aplicar.length, porTipo: tally(aplicar), saltados, cola: cola.length, colaPorTipo: tally(cola) }, null, 2));
    console.log("dry-run; ejecuta con --confirm");
    await closeDb();
    return;
  }

  const { runId, result } = await withOperatorRun({
    name: "tipo-artista:bios-deepseek",
    operator: OPERATOR,
    note: "Tipo de artista (banda/dúo/solista/proyecto) desde la biografía y la lista de integrantes (DeepSeek flash con cita literal, tanda 2026-10-15, revisada y aprobada por Brian). Solo fichas con tipo sin afirmar; los conflictos con un tipo afirmado van a la cola.",
  }, async (context) => {
    const applied: unknown[] = [];
    for (const row of aplicar) {
      await updateEntity(context, "artist", row.artistId, { artist_type: row.nuevo });
      applied.push({ artistId: row.artistId, name: row.name, de: row.tipo_actual, a: row.nuevo });
    }
    let opened = 0;
    for (const row of cola) {
      const open = await context.client.query(`
        SELECT 1 FROM ingest.review_queue WHERE kind='manual_review' AND status IN ('open','in_progress')
           AND payload->>'detector'='artist-type-bio' AND payload->>'artistId'=$1`, [String(row.artistId)]);
      if (open.rowCount) continue;
      // Una agrupación marcada como solista se ve mal en público: va primero.
      const priority = row.tipo_actual === "solo_artist" && (row.tipo === "band" || row.tipo === "duo") ? 3 : 6;
      await context.client.query(
        "INSERT INTO ingest.review_queue(kind,priority,artist_a_id,payload,notes) VALUES('manual_review',$1,$2,$3::jsonb,$4)", [
          priority, row.artistId,
          JSON.stringify({ detector: "artist-type-bio", version: 1, runId: context.runId, artistId: row.artistId, actual: row.tipo_actual,
            propuesto: row.tipo, integrantesBio: row.integrantes_segun_bio, integrantesRegistrados: row.integrantes_registrados, cita: row.cita }),
          `Tipo afirmado ${row.tipo_actual}; la biografía dice ${row.tipo}: «${row.cita.slice(0, 300)}». ${row.nota.slice(0, 300)}`,
        ]);
      opened += 1;
    }
    return { applied, opened };
  });
  const file = `${DIR}/aplicado-run${runId}.json`;
  writeFileSync(file, JSON.stringify({ runId, aplicados: result.applied.length, porTipo: tally(aplicar), saltados, colaAbierta: result.opened, colaPorTipo: tally(cola), detalle: result.applied }, null, 2));
  console.log(`run ${runId}: ${result.applied.length} tipos cambiados, ${result.opened} revisiones abiertas; informe ${file}`);
  await closeDb();
}
main().catch(async (error: unknown) => { console.error(error); await closeDb(); process.exit(1); });
