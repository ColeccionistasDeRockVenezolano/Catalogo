// CRV · Plan del primo, etapa 2 (2026-10-12): series con criterio de producto (punto 13).
//
// Decisión de Brian: un volumen publicado por separado tiene su propia página
// y entra en su serie con su número; un 2CD o una caja vendidos juntos siguen
// en una página. La run 18980 juntó en una página 71 grupos de volúmenes
// («Colección De Éxitos» Vol. 1–15 de Hugo Blanco, «Antología» Vol. 1–10 de
// Sevillano…). Revisados uno a uno (reports/primo-etapa2/series-*.md): casi
// todos traían portada propia y su propia ficha en la fuente, así que se
// publicaron por separado.
//
//   --stage=separar [--only=<keep>]  deshace, SOLO para las fichas de cada
//        grupo, lo que hicieron la run 18980 y las que vinieron por ella
//        (19001 enlaces por disco; 18999/19004/19005 reseñas unidas). Cada
//        volumen vuelve con su id, pistas, portada, enlaces y reseña.
//   --stage=series   crea las series y liga cada volumen con su número.
//
// Sin --confirm solo informa. Un run por grupo.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { closeDb, getPool } from "../src/db/client.js";
import { withOperatorRun } from "../src/merge/operator.js";
import { planJournalUndo, undoRunWithJournal, type UndoScope } from "../src/merge/journal-undo.js";
import { volumeOf, seriesTitleOf } from "../src/discography/series.js";

const stage = process.argv.find((arg) => arg.startsWith("--stage="))?.slice("--stage=".length);
const only = process.argv.find((arg) => arg.startsWith("--only="))?.slice("--only=".length);
const confirm = process.argv.includes("--confirm");
const NOTE = "Plan del primo, etapa 2 (2026-10-12): volúmenes publicados por separado vuelven a su página (punto 13)";
const OUT = "reports/primo-etapa2";
// Del más reciente al más antiguo: 19003 pasó el alias principal al título nuevo.
const RUNS = [19005, 19004, 19003, 19001, 18999, 18980];
/**
 * Grupos que no se separan: en «Valses Venezolanos» (8752) Brian juntó a mano
 * una reedición en la página de la original (run 19007) después de la 18980.
 */
const KEEP_TOGETHER = new Set([8752]);
// Fichas que la run 18980 juntó por coincidencia con un volumen antes de juntar
// los volúmenes: sin ellas la ficha no se puede devolver.
const EXTRA_ALBUMS: Readonly<Record<number, number[]>> = { 9191: [8715] };
const pool = getPool();
mkdirSync(OUT, { recursive: true });

interface Group { name: string; keep: number; drops: number[]; labels: string[] }

/** Los grupos de volúmenes de la run 18980 (modo «append» con discos «Vol.», «Volumen», «Parte»). */
function volumeGroups(): Group[] {
  const plan = JSON.parse(readFileSync("reports/discos-multiples-2026-10-11/plan.json", "utf8")) as {
    groups: Array<{ name: string; steps: Array<{ op: string; keep?: number; drop?: number; mode?: string; title?: string }> }>;
  };
  return plan.groups.flatMap((group) => {
    const labels = group.steps.filter((step) => step.op === "label").map((step) => step.title ?? "");
    const merges = group.steps.filter((step) => step.op === "merge" && step.mode === "append");
    if (!merges.length || !labels.some((label) => /\b(?:vol|volumen|parte)\b/iu.test(label))) return [];
    return [{ name: group.name, keep: merges[0]!.keep!, drops: merges.map((merge) => merge.drop!), labels }];
  });
}

/** Filas del diario que pertenecen a las fichas del grupo (y a sus pistas, créditos y claims). */
async function scopeFor(albumIds: number[]): Promise<UndoScope> {
  const ids = (sql: string) => pool.query<{ id: string }>(sql, [RUNS, albumIds]).then((result) => new Set(result.rows.map((row) => row.id)));
  const albums = new Set(albumIds.map(String));
  const tracks = await ids(`
    SELECT DISTINCT row_pk->>'id' AS id FROM ingest.change_journal
     WHERE run_id = ANY($1::bigint[]) AND table_name = 'public.tracks'
       AND (COALESCE(old_data->>'album_id', '') = ANY($2::text[]) OR COALESCE(new_data->>'album_id', '') = ANY($2::text[]))
    UNION SELECT id::text FROM public.tracks WHERE album_id = ANY($2::bigint[])`.replace(/\$2::text\[\]/gu, "$2::bigint[]::text[]"));
  const credits = await ids(`
    SELECT DISTINCT row_pk->>'id' AS id FROM ingest.change_journal
     WHERE run_id = ANY($1::bigint[]) AND table_name = 'public.album_credits'
       AND (COALESCE(old_data->>'album_id', '') = ANY($2::bigint[]::text[]) OR COALESCE(new_data->>'album_id', '') = ANY($2::bigint[]::text[]))`);
  const trackList = [...tracks];
  const trackCredits = new Set((await pool.query<{ id: string }>(`
    SELECT DISTINCT row_pk->>'id' AS id FROM ingest.change_journal
     WHERE run_id = ANY($1::bigint[]) AND table_name = 'public.track_credits'
       AND (COALESCE(old_data->>'track_id', '') = ANY($2::text[]) OR COALESCE(new_data->>'track_id', '') = ANY($2::text[]))`, [RUNS, trackList])).rows.map((row) => row.id));
  const claims = new Set<string>();
  const claimTouches = (row: Record<string, unknown> | null): boolean => !!row && (
    albums.has(String(row["album_id"] ?? "")) || tracks.has(String(row["track_id"] ?? ""))
    || credits.has(String(row["album_credit_id"] ?? "")) || trackCredits.has(String(row["track_credit_id"] ?? "")));
  for (const row of (await pool.query<{ id: string; old_data: Record<string, unknown> | null; new_data: Record<string, unknown> | null }>(`
    SELECT row_pk->>'id' AS id, old_data, new_data FROM ingest.change_journal WHERE run_id = ANY($1::bigint[]) AND table_name = 'ingest.claims'`, [RUNS])).rows) {
    if (claimTouches(row.old_data) || claimTouches(row.new_data)) claims.add(row.id);
  }
  // Una actualización guarda solo las columnas cambiadas («is_primary»): la fila
  // se ubica por su clave en cualquier asiento del diario o en la tabla actual.
  const SPECIAL = ["public.albums", "public.tracks", "public.album_credits", "public.track_credits", "ingest.claims", "ingest.conflicts", "ingest.entity_redirects", "ingest.text_rewrites"];
  const rowKeys = new Set((await pool.query<{ table_name: string; row_pk: unknown }>(`
    WITH touched AS (
      SELECT DISTINCT table_name, row_pk FROM ingest.change_journal
       WHERE run_id = ANY($1::bigint[]) AND NOT (table_name = ANY($4::text[])))
    SELECT DISTINCT t.table_name, t.row_pk
      FROM touched t JOIN ingest.change_journal j ON j.table_name = t.table_name AND j.row_pk = t.row_pk
     WHERE COALESCE(j.old_data->>'album_id', j.new_data->>'album_id', '') = ANY($2::bigint[]::text[])
        OR COALESCE(j.new_data->>'album_id', '') = ANY($2::bigint[]::text[])
        OR COALESCE(j.old_data->>'track_id', j.new_data->>'track_id', '') = ANY($3::text[])
        OR COALESCE(j.new_data->>'track_id', '') = ANY($3::text[])`, [RUNS, albumIds, trackList, SPECIAL])).rows.map((row) => `${row.table_name}|${JSON.stringify(row.row_pk)}`));
  for (const { table_name: table, column } of (await pool.query<{ table_name: string; column: string }>(`
    SELECT DISTINCT j.table_name, c.column_name AS column FROM ingest.change_journal j
      JOIN information_schema.columns c ON c.table_schema || '.' || c.table_name = j.table_name AND c.column_name IN ('album_id', 'track_id')
     WHERE j.run_id = ANY($1::bigint[]) AND NOT (j.table_name = ANY($2::text[]))`, [RUNS, SPECIAL])).rows) {
    const values = column === "album_id" ? albumIds.map(String) : trackList;
    const current = await pool.query<{ id: string }>(`SELECT id::text FROM ${table} WHERE ${column}::text = ANY($1::text[])`, [values]).catch(() => ({ rows: [] as Array<{ id: string }> }));
    for (const row of current.rows) rowKeys.add(`${table}|${JSON.stringify({ id: Number(row.id) })}`);
  }
  const keyOf = (table: string, pk: unknown) => `${table}|${JSON.stringify(pk)}`;
  const touches = (row: Record<string, unknown> | null, table: string): boolean => {
    if (!row) return false;
    const id = String(row["id"] ?? "");
    if (table === "public.albums") return albums.has(id);
    if (table === "public.tracks") return tracks.has(id);
    if (table === "public.album_credits") return credits.has(id);
    if (table === "public.track_credits") return trackCredits.has(id);
    if (table === "ingest.claims") return claims.has(id);
    if (table === "ingest.conflicts") return claims.has(String(row["claim_a_id"] ?? "")) || claims.has(String(row["claim_b_id"] ?? ""));
    if (table === "ingest.entity_redirects") {
      const set = row["entity_kind"] === "album" ? albums : row["entity_kind"] === "track" ? tracks : null;
      return !!set && (set.has(String(row["from_id"])) || set.has(String(row["to_id"])));
    }
    if (table === "ingest.text_rewrites") return row["entity_kind"] === "album" && albums.has(String(row["entity_id"]));
    return albums.has(String(row["album_id"] ?? "")) || tracks.has(String(row["track_id"] ?? ""));
  };
  return (change) => touches(change.before, change.table) || touches(change.after, change.table)
    || touches(change.pk as Record<string, unknown>, change.table)
    || (!SPECIAL.includes(change.table) && rowKeys.has(keyOf(change.table, change.pk)));
}

async function separar(): Promise<void> {
  const groups = volumeGroups().filter((group) => (!only || group.keep === Number(only)) && !KEEP_TOGETHER.has(group.keep));
  const report = [`# Volúmenes de la run 18980 — separar (${confirm ? "aplicado" : "ensayo"})`, ""];
  const client = await pool.connect();
  try {
    for (const group of groups) {
      const albumIds = [group.keep, ...group.drops, ...(EXTRA_ALBUMS[group.keep] ?? [])];
      const scope = await scopeFor(albumIds);
      const plans = [];
      for (const run of RUNS) {
        const plan = await planJournalUndo(client, run, scope);
        if (plan.changes) plans.push({ run, changes: plan.changes, conflicts: plan.conflicts.length, skipped: plan.skipped.length, conflictInfo: plan.conflicts.slice(0, 3) });
      }
      const blocked = plans.filter((plan) => plan.conflicts);
      report.push(`- **${group.name}** (${albumIds.join(", ")}): ${plans.map((plan) => `run ${plan.run}: ${plan.changes} filas${plan.conflicts ? `, **${plan.conflicts} en conflicto**` : ""}${plan.skipped ? `, ${plan.skipped} blandas omitidas` : ""}`).join(" · ")}`);
      for (const plan of blocked) report.push(`  - conflictos ${plan.run}: ${JSON.stringify(plan.conflictInfo)}`);
    }
  } finally {
    client.release();
  }
  writeFileSync(`${OUT}/series-separar-${confirm ? "aplicado" : "ensayo"}${only ? `-${only}` : ""}.md`, report.join("\n") + "\n");
  console.log(report.slice(0, 12).join("\n"));
  if (!confirm) return;
  for (const group of groups) {
    const albumIds = [group.keep, ...group.drops, ...(EXTRA_ALBUMS[group.keep] ?? [])];
    const scope = await scopeFor(albumIds);
    try {
      const { runId } = await withOperatorRun({ name: "primo-etapa2:separar-volumenes", operator: "claude-code", note: `${NOTE}: ${group.name}`, params: { albumIds } }, async (context) => {
        for (const run of RUNS) await undoRunWithJournal(context, run, { rows: scope, albumIds });
      });
      console.log(`run ${runId}: ${group.name}`);
    } catch (error) {
      console.log(`NO SE SEPARÓ ${group.name}: ${(error as Error).message}`);
    }
  }
}

async function series(): Promise<void> {
  const groups = volumeGroups().filter((group) => !only || group.keep === Number(only));
  const rows = await pool.query<{ id: string; title: string; artist_id: string; release_year: number | null }>(
    "SELECT id::text, title, artist_id::text, release_year FROM public.albums WHERE id = ANY($1::bigint[])", [groups.flatMap((group) => [group.keep, ...group.drops])]);
  const albums = new Map(rows.rows.map((row) => [Number(row.id), row]));
  const plan = groups.map((group) => {
    // El primero suele no llevar número («Tren de Seis»): su etiqueta del plan
    // de la run 18980 («Vol. 1») lo dice.
    const members = [group.keep, ...group.drops].flatMap((id, index) => {
      const album = albums.get(id);
      return album ? [{ id, title: album.title, artist: Number(album.artist_id), volume: volumeOf(album.title) ?? volumeOf(group.labels[index] ?? "") }] : [];
    });
    const title = seriesTitleOf(group.name.split(" · ").slice(1).join(" · "), members.map((member) => member.title));
    return { group, title, artist: members[0]?.artist ?? null, members, separated: members.length === group.drops.length + 1 };
  });
  const report = [`# Series de volúmenes (${confirm ? "aplicado" : "ensayo"})`, "",
    ...plan.map((item) => `- **${item.title}**${item.separated ? "" : " _(volúmenes aún juntos: se omite)_"}: ${item.members.map((member) => `${member.volume?.label ?? "¿?"} → «${member.title}» (${member.id})`).join(" · ")}`)];
  writeFileSync(`${OUT}/series-${confirm ? "aplicado" : "ensayo"}.md`, report.join("\n") + "\n");
  console.log(report.slice(0, 8).join("\n"));
  if (!confirm) return;
  const { runId, result } = await withOperatorRun({ name: "primo-etapa2:series", operator: "claude-code", note: "Plan del primo, etapa 2 (2026-10-12): series de volúmenes (punto 13)" }, async (context) => {
    let created = 0; let linked = 0;
    for (const item of plan) {
      if (!item.separated || item.members.length < 2) continue;
      const existing = await context.client.query<{ id: string }>("SELECT id::text FROM ingest.series WHERE artist_id = $1 AND lower(title) = lower($2)", [item.artist, item.title]);
      const seriesId = existing.rows[0]?.id ?? (await context.client.query<{ id: string }>(`
        INSERT INTO ingest.series(title, artist_id, source, notes, run_id) VALUES ($1, $2, 'run-18980', $3, $4) RETURNING id::text`,
      [item.title, item.artist, `Volúmenes que la run 18980 había juntado en una página (grupo «${item.group.name}»).`, context.runId])).rows[0]!.id;
      if (!existing.rows[0]) created++;
      for (const member of item.members) {
        const result = await context.client.query(`
          INSERT INTO ingest.series_albums(series_id, album_id, volume_number, volume_label, run_id) VALUES ($1, $2, $3, $4, $5)
          ON CONFLICT (series_id, album_id) DO NOTHING`, [seriesId, member.id, member.volume?.number ?? null, member.volume?.label ?? null, context.runId]);
        linked += result.rowCount ?? 0;
      }
    }
    return { created, linked };
  });
  console.log(`run ${runId}:`, result);
}

/**
 * Series que nombra el plan (punto 13), dentro de Various Artists. «Los Andes
 * Electrónicos» y «Think! Ok Records» no tienen ningún disco en el catálogo ni
 * en las fuentes leídas: quedan pendientes de ingesta. «Borrachos y Bolingas»
 * (#2209, 2006, sin pistas) parece la misma entrega que el Vol. 2: no se liga.
 */
const PLAN_SERIES: Array<{ title: string; description: string; members: Array<[number, number, string]> }> = [
  { title: "Venezuela Electrónica", description: "Recopilatorios de música electrónica venezolana (2006–2008); el Vol. 2 y el Vol. 3 salieron en varias ediciones de color o estilo.",
    members: [[650, 1, "Vol. 1"], [651, 2, "Vol. 2 «Blanco»"], [652, 2, "Vol. 2 «Verde»"], [589, 3, "Vol. 3 «Mestizo»"], [657, 3, "Vol. 3 «Pop»"], [658, 3, "Vol. 3 «Chill»"]] },
  { title: "Borrachos y Bolingas", description: "Recopilatorios de punk, ska y hardcore venezolano de Borrachos y Bolingas Records.",
    members: [[373, 1, "Vol. 1"], [577, 2, "Vol. 2"], [578, 3, "Vol. 3"], [649, 4, "Vol. 4 «Todos Contra Todos»"]] },
];

async function planSeries(): Promise<void> {
  for (const item of PLAN_SERIES) console.log(`${item.title}: ${item.members.map(([id, , label]) => `${label} (${id})`).join(" · ")}`);
  if (!confirm) return;
  const { runId, result } = await withOperatorRun({ name: "primo-etapa2:series-plan", operator: "claude-code", note: "Plan del primo, etapa 2 (2026-10-12): series del plan en Various Artists (punto 13)" }, async (context) => {
    let linked = 0;
    for (const item of PLAN_SERIES) {
      const artist = (await context.client.query<{ artist_id: string }>("SELECT artist_id::text FROM public.albums WHERE id = $1", [item.members[0]![0]])).rows[0]!.artist_id;
      const existing = await context.client.query<{ id: string }>("SELECT id::text FROM ingest.series WHERE artist_id = $1 AND lower(title) = lower($2)", [artist, item.title]);
      const seriesId = existing.rows[0]?.id ?? (await context.client.query<{ id: string }>(`
        INSERT INTO ingest.series(title, artist_id, description, source, notes, run_id) VALUES ($1, $2, $3, 'plan-primo', 'Serie pedida en el plan del primo (punto 13)', $4) RETURNING id::text`,
      [item.title, artist, item.description, context.runId])).rows[0]!.id;
      for (const [albumId, number, label] of item.members) {
        const inserted = await context.client.query(`
          INSERT INTO ingest.series_albums(series_id, album_id, volume_number, volume_label, run_id) VALUES ($1, $2, $3, $4, $5)
          ON CONFLICT (series_id, album_id) DO NOTHING`, [seriesId, albumId, number, label, context.runId]);
        linked += inserted.rowCount ?? 0;
      }
    }
    return { linked };
  });
  console.log(`run ${runId}:`, result);
}

if (stage === "separar") await separar();
else if (stage === "plan") await planSeries();
else if (stage === "series") await series();
else throw new Error("uso: --stage=separar|series [--only=<keep>] [--confirm]");
await closeDb();
