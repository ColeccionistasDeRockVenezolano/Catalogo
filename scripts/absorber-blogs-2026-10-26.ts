#!/usr/bin/env tsx
/**
 * Aplica el plan de absorción de los blogs (reports/2026-10-26-absorcion-plan.jsonl).
 *
 * Todo pasa por el motor del operador (`withOperatorRun`): un run por lote, claims
 * con evidencia, merge determinista, `change_journal` y auditoría. El script NO
 * escribe SQL a mano sobre el core.
 *
 * Garantías:
 *  - Relee el estado antes de escribir: nunca pisa un valor existente ni crea una
 *    pista en una posición ocupada.
 *  - `createEntity` es la red anti-duplicados: si el ER reconoce la entidad,
 *    devuelve `already_exists` y la acción se salta (queda en el informe).
 *  - Reanudable: reports/2026-10-26-absorcion-state.json guarda lo aplicado.
 *  - Informe: reports/2026-10-26-absorcion-aplicado.json con contadores y errores.
 *
 * Uso:
 *   npx tsx scripts/absorber-blogs-2026-10-26.ts --dry-run
 *   npx tsx scripts/absorber-blogs-2026-10-26.ts --kinds=album_fields --limit=5
 *   npx tsx scripts/absorber-blogs-2026-10-26.ts --batch=20
 */
import { copyFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { closeDb } from "../src/db/client.js";
import { OperatorError, createEntity, createRelation, updateEntity, withOperatorRun, type OperatorContext } from "../src/merge/operator.js";

const ROOT = process.cwd();
const PLAN = path.join(ROOT, "reports/2026-10-26-absorcion-plan.jsonl");
const STATE = path.join(ROOT, "reports/2026-10-26-absorcion-state.json");
const REPORT = path.join(ROOT, "reports/2026-10-26-absorcion-aplicado.json");
const MEDIA = path.join(ROOT, "web/public/media/album");
const RAW_MEDIA = path.join(ROOT, "web/public/media/antologiavenezuela-blogspot");

type FieldBag = Record<string, string | number>;
type PlanTrack = { n: number; title: string; composer_person_id?: number | null };
type PlanItem =
  | { kind: "album_fields"; album_id: number; fields: FieldBag; src: string }
  | { kind: "album_tracks"; album_id: number; tracks: PlanTrack[]; src: string }
  | { kind: "album_tracks_add"; album_id: number; tracks: PlanTrack[]; src: string }
  | { kind: "album_new"; artist_id: number; artist: string; fields: FieldBag; cover_file?: string | null; tracks: PlanTrack[]; src: string }
  | { kind: "composer_credit"; album_id: number; track_number: number; person_id: number; composer: string; src: string }
  | { kind: "vd_credit"; album_id: number; track_id: number; artist_id: number; person_id: number | null; src: string };

const argv = process.argv.slice(2);
const arg = (name: string): string | undefined => argv.find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=");
const dryRun = argv.includes("--dry-run");
const limit = Number(arg("limit") ?? "0");
const batchSize = Number(arg("batch") ?? "25");
const kinds = new Set((arg("kinds") ?? "album_fields,album_tracks,album_tracks_add,album_new,composer_credit,vd_credit").split(","));
const from = arg("from");

let counters: Record<string, number> = {};
let errors: Array<{ kind: string; key: string; error: string }> = [];
let pendingBumps: Record<string, number> = {};

const bump = (key: string, n = 1): void => { pendingBumps[key] = (pendingBumps[key] ?? 0) + n; };
const flushBumps = (): void => {
  for (const [k, v] of Object.entries(pendingBumps)) counters[k] = (counters[k] ?? 0) + v;
  pendingBumps = {};
};
const keyOf = (item: PlanItem): string =>
  item.kind === "composer_credit" ? `${item.kind}:${item.album_id}:${item.track_number}:${item.person_id}`
  : item.kind === "vd_credit" ? `${item.kind}:${item.track_id}:${item.artist_id}`
  : item.kind === "album_new" ? `${item.kind}:${item.artist_id}:${item.fields["title"]}:${item.src}`
  : item.kind === "album_tracks" || item.kind === "album_tracks_add" ? `${item.kind}:${item.album_id}:${item.src}`
  : `${item.kind}:${item.album_id}:${Object.keys(item.fields).sort().join("+")}`;

const coverTarget = (albumId: number): string => path.join(MEDIA, `${albumId}.jpg`);

/** ¿El artista ya tiene un disco con ese título? Compara sin tildes ni mayúsculas. */
async function sameArtistAlbum(ctx: OperatorContext, artistId: number, title: string): Promise<number | null> {
  const { rows } = await ctx.client.query<{ id: string }>(
    `SELECT id::text FROM public.albums
      WHERE artist_id=$1
        AND lower(btrim(translate(title,'áéíóúüñÁÉÍÓÚÜÑ','aeiouunAEIOUUN'))) =
            lower(btrim(translate($2,'áéíóúüñÁÉÍÓÚÜÑ','aeiouunAEIOUUN')))
      LIMIT 1`, [artistId, title]);
  return rows[0] ? Number(rows[0].id) : null;
}

async function ensureCover(albumId: number, file: string | null | undefined): Promise<boolean> {
  if (!file) return false;
  const src = path.join(RAW_MEDIA, file);
  try { await stat(src); } catch { return false; }
  await mkdir(MEDIA, { recursive: true });
  const dst = coverTarget(albumId);
  try { await stat(dst); return false; } catch { /* no existe */ }
  await copyFile(src, dst);
  return true;
}

async function emptyFields(ctx: OperatorContext, albumId: number, wanted: FieldBag): Promise<{ values: FieldBag; cover: string | null }> {
  const { rows } = await ctx.client.query<Record<string, string | null>>(
    "SELECT release_year::text AS release_year, label_id::text AS label_id, catalog_id, cover_url, media_format FROM public.albums WHERE id=$1", [albumId]);
  const row = rows[0];
  if (!row) throw new OperatorError("not_found", `álbum ${albumId} inexistente`);
  const values: FieldBag = {};
  let cover: string | null = null;
  for (const [field, value] of Object.entries(wanted)) {
    if (field === "cover_file") { if (!row["cover_url"]) cover = String(value); continue; }
    if (row[field] === null || row[field] === "" || row[field] === undefined) values[field] = value;
  }
  return { values, cover };
}

async function applyAlbumFields(ctx: OperatorContext, item: Extract<PlanItem, { kind: "album_fields" }>): Promise<void> {
  const { values, cover } = await emptyFields(ctx, item.album_id, item.fields);
  if (cover) {
    if (await ensureCover(item.album_id, cover)) {
      values["cover_url"] = `/crv/media/album/${item.album_id}.jpg`;
      bump("portada_copiada");
    }
  }
  if (Object.keys(values).length === 0) { bump("sin_cambios"); return; }
  await updateEntity(ctx, "album", item.album_id, values);
  bump("album_actualizado");
  for (const f of Object.keys(values)) bump(`campo_${f}`);
}

async function addTracks(ctx: OperatorContext, albumId: number, tracks: PlanTrack[]): Promise<void> {
  for (const t of tracks) {
    // Se inserta la lista completa de un disco: cada posición la fija el blog y
    // `createEntity` ya rechaza una posición ocupada. La resolución de entidades
    // se salta a propósito (`allowSimilar`): comparar títulos de pista contra
    // todo el catálogo no aporta y era el cuello de botella (7,7 GB de decisiones
    // en la tanda de 2026-09-26, ver src/merge/engine.ts:627).
    try {
      const id = (await createEntity(ctx, "track", { title: t.title, track_number: t.n, disc_number: 1 },
        { albumId, allowSimilar: true })).id;
      bump("pista_creada");
      if (t.composer_person_id) await creditComposer(ctx, id, t.composer_person_id, albumId);
    } catch (error) {
      if (error instanceof OperatorError && (error.code === "already_exists" || error.code === "needs_review")) {
        bump("pista_ya_existe");
        continue;
      }
      throw error;
    }
  }
}

async function creditComposer(ctx: OperatorContext, trackId: number, personId: number, albumId: number): Promise<void> {
  const { rows } = await ctx.client.query(
    "SELECT 1 FROM public.track_credits WHERE track_id=$1 AND person_id=$2 AND credit_type='composer' LIMIT 1", [trackId, personId]);
  if (rows[0]) { bump("compositor_ya_estaba"); return; }
  await createRelation(ctx, "track_credit", { trackId, personId }, { credit_role: "Compositor" });
  bump("compositor_creado");
  void albumId;
}

async function applyAlbumNew(ctx: OperatorContext, item: Extract<PlanItem, { kind: "album_new" }>): Promise<void> {
  let albumId: number;
  try {
    const created = await createEntity(ctx, "album", { ...item.fields }, { artistId: item.artist_id });
    albumId = created.id;
    bump("album_creado");
  } catch (error) {
    if (error instanceof OperatorError && error.code === "already_exists") {
      bump("album_ya_existe");
      const existing = Number((error.details as { existingId?: number } | undefined)?.existingId ?? NaN);
      if (Number.isInteger(existing)) await topUpAlbum(ctx, existing, item.tracks);
      return;
    }
    if (error instanceof OperatorError && error.code === "needs_review") {
      // El ER bloquea por parecido de título, a menudo con discos de OTRO artista
      // («Mujer» de José Luis Rodríguez frente a «Mujer» de otro). Si el artista
      // no tiene ya ese disco, se crea como distinto a sabiendas; si lo tiene, se
      // salta. Nunca se duplica dentro del mismo artista.
      const own = await sameArtistAlbum(ctx, item.artist_id, String(item.fields["title"]));
      if (own) {
        bump("album_ya_existe");
        await topUpAlbum(ctx, own, item.tracks);
        return;
      }
      try {
        const created = await createEntity(ctx, "album", { ...item.fields }, { artistId: item.artist_id, allowSimilar: true });
        albumId = created.id;
        bump("album_creado_allowSimilar");
      } catch (retry) {
        bump("album_necesita_revision");
        errors.push({ kind: item.kind, key: keyOf(item), error: `ER pide revisión: ${(retry as Error).message}`.slice(0, 300) });
        return;
      }
    } else {
      throw error;
    }
  }
  if (await ensureCover(albumId, item.cover_file)) {
    await updateEntity(ctx, "album", albumId, { cover_url: `/crv/media/album/${albumId}.jpg` });
    bump("portada_copiada");
  }
  await addTracks(ctx, albumId, item.tracks);
}

/** Rellena posiciones vacías de un disco que ya existe (idempotente). */
async function topUpAlbum(ctx: OperatorContext, albumId: number, tracks: PlanTrack[]): Promise<void> {
  const { rows } = await ctx.client.query<{ n: string }>(
    "SELECT count(*)::text AS n FROM public.tracks WHERE album_id=$1", [albumId]);
  const have = Number(rows[0]?.n ?? 0);
  if (have >= tracks.length) { bump("album_completo"); return; }
  bump("album_incompleto_topup");
  await addTracks(ctx, albumId, tracks);
}

async function applyComposerCredit(ctx: OperatorContext, item: Extract<PlanItem, { kind: "composer_credit" }>): Promise<void> {
  const { rows } = await ctx.client.query<{ id: string }>(
    "SELECT id::text FROM public.tracks WHERE album_id=$1 AND track_number=$2 AND disc_number=1 LIMIT 1",
    [item.album_id, item.track_number]);
  if (!rows[0]) { bump("pista_inexistente"); return; }
  await creditComposer(ctx, Number(rows[0].id), item.person_id, item.album_id);
}

async function applyVdCredit(ctx: OperatorContext, item: Extract<PlanItem, { kind: "vd_credit" }>): Promise<void> {
  // Compositor primero: el intérprete de estas compilaciones ya estaba fichado
  // (626 pistas con crédito de artista), así que el retorno temprano de abajo no
  // puede saltarse el compositor.
  if (item.person_id) {
    const dup = await ctx.client.query(
      "SELECT 1 FROM public.track_credits WHERE track_id=$1 AND person_id=$2 AND credit_type='composer' LIMIT 1", [item.track_id, item.person_id]);
    if (!dup.rows[0]) {
      await createRelation(ctx, "track_credit", { trackId: item.track_id, personId: item.person_id }, { credit_role: "Compositor" });
      bump("compositor_creado");
    } else {
      bump("compositor_ya_estaba");
    }
  }
  const { rows } = await ctx.client.query(
    "SELECT 1 FROM public.track_credits WHERE track_id=$1 AND artist_id=$2 LIMIT 1", [item.track_id, item.artist_id]);
  if (rows[0]) { bump("interprete_ya_estaba"); return; }
  await createRelation(ctx, "track_credit", { trackId: item.track_id, artistId: item.artist_id }, { credit_role: "Intérprete" });
  bump("interprete_creado");
}

async function applyItem(ctx: OperatorContext, item: PlanItem): Promise<void> {
  switch (item.kind) {
    case "album_fields": return applyAlbumFields(ctx, item);
    case "album_tracks": return addTracks(ctx, item.album_id, item.tracks);
    case "album_tracks_add": return addTracks(ctx, item.album_id, item.tracks);
    case "album_new": return applyAlbumNew(ctx, item);
    case "composer_credit": return applyComposerCredit(ctx, item);
    case "vd_credit": return applyVdCredit(ctx, item);
  }
}

/** Un lote = un run atómico. Cada acción va en su propio SAVEPOINT: si una
 *  revienta (trigger editorial, restricción única, dato raro) se deshace sola y
 *  el resto del lote sigue. Sin esto, un solo fallo aborta la transacción
 *  entera y todas las acciones siguientes fallan en cadena. */
async function runBatch(batch: PlanItem[], index: number): Promise<void> {
  const kindsInBatch = [...new Set(batch.map((b) => b.kind))].join("+");
  await withOperatorRun({
    name: "absorcion-blogs",
    operator: "Hermes",
    note: `Absorción de antologiavenezuela.blogspot.com y venezuelademo (Wayback), lote ${index} (${kindsInBatch})`,
    params: { plan: path.basename(PLAN), batch: index, items: batch.length, kinds: kindsInBatch },
  }, async (ctx) => {
    for (const item of batch) {
      pendingBumps = {};
      await ctx.client.query("SAVEPOINT accion");
      try {
        await applyItem(ctx, item);
        await ctx.client.query("RELEASE SAVEPOINT accion");
        flushBumps();
      } catch (error) {
        await ctx.client.query("ROLLBACK TO SAVEPOINT accion");
        pendingBumps = {};
        const message = error instanceof Error ? error.message : String(error);
        errors.push({ kind: item.kind, key: keyOf(item), error: message.slice(0, 300) });
        counters[`error_${item.kind}`] = (counters[`error_${item.kind}`] ?? 0) + 1;
      }
    }
    return null;
  }, { serializable: true });
}

/** Un lote entero falló (commit roto, conexión perdida): se registra y se sigue. */
function batchFailed(batch: PlanItem[], error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  pendingBumps = {};
  counters["lote_fallido"] = (counters["lote_fallido"] ?? 0) + 1;
  for (const item of batch) errors.push({ kind: item.kind, key: keyOf(item), error: `lote fallido: ${message}`.slice(0, 300) });
}

async function main(): Promise<void> {
  const lines = (await readFile(PLAN, "utf8")).split("\n").filter(Boolean);
  let plan = lines.map((l) => JSON.parse(l) as PlanItem).filter((item) => kinds.has(item.kind));
  const state = await readFile(STATE, "utf8").then((t) => JSON.parse(t) as { done: string[] }).catch(() => ({ done: [] as string[] }));
  const done = new Set(state.done);
  plan = plan.filter((item) => !done.has(keyOf(item)));
  if (from) {
    const idx = plan.findIndex((item) => keyOf(item) === from);
    if (idx > 0) plan = plan.slice(idx);
  }
  if (limit > 0) plan = plan.slice(0, limit);

  console.log(JSON.stringify({ pending: plan.length, kinds: [...kinds], dryRun, batchSize }));
  if (dryRun) {
    const summary: Record<string, number> = {};
    for (const item of plan) summary[item.kind] = (summary[item.kind] ?? 0) + 1;
    console.log(JSON.stringify({ plan: summary }));
    return;
  }

  // Los campos de álbum van en un run único (son pocos y no crean entidades).
  const fields = plan.filter((p) => p.kind === "album_fields");
  const rest = plan.filter((p) => p.kind !== "album_fields");
  let index = 0;
  if (fields.length) {
    index += 1;
    try { await runBatch(fields, index); } catch (error) { batchFailed(fields, error); }
    for (const item of fields) if (!errors.some((e) => e.key === keyOf(item))) done.add(keyOf(item));
    await writeFile(STATE, JSON.stringify({ done: [...done] }));
    console.log(JSON.stringify({ lote: index, fase: "album_fields", hechos: fields.length, counters }));
  }
  for (let i = 0; i < rest.length; i += batchSize) {
    index += 1;
    const batch = rest.slice(i, i + batchSize);
    try { await runBatch(batch, index); } catch (error) { batchFailed(batch, error); }
    for (const item of batch) if (!errors.some((e) => e.key === keyOf(item))) done.add(keyOf(item));
    await writeFile(STATE, JSON.stringify({ done: [...done] }));
    console.log(JSON.stringify({ lote: index, hechos: Math.min(i + batchSize, rest.length), total: rest.length, counters }));
  }
  await writeFile(REPORT, JSON.stringify({ at: new Date().toISOString(), counters, errors }, null, 2));
  console.log(JSON.stringify({ counters, errores: errors.length }));
}

try {
  await main();
} finally {
  await closeDb();
}
