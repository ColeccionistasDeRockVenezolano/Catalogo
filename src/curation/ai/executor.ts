import { z } from "zod";
import type { PoolClient } from "pg";
import { ENTITY_FIELDS, toSnake } from "../../api/routes/catalog-writes.js";
import { RELATION_ROUTES } from "../../api/routes/relation-writes.js";
import { createAlias } from "../../api/repositories/aliases.js";
import {
  createEntity,
  updateEntity,
  deleteEntity,
  createRelation,
  updateRelation,
  deleteRelation,
  OperatorError,
  type OperatorContext,
  type CreateEntityOptions,
} from "../../merge/operator.js";
import { ENTITY_SPECS } from "../../merge/specs.js";
import { RELATION_SPECS } from "../../merge/relations.js";
import { previewEntityMerge, mergeEntities } from "../../merge/entity-merge.js";
import {
  previewAlbumMerge,
  mergeAlbums,
  type AlbumMergeField,
} from "../../merge/album-merge.js";
import { confirmGenre, rejectGenre } from "../../genres/human.js";
import { operationRefs, orderedOperations } from "./schema.js";
import { entityRow, entityState, hashValue } from "./context.js";
import { EvidenceGapError, evidenceGaps, type EvidenceContext } from "./evidence.js";
import type {
  CatalogDraft,
  CatalogEvidence,
  CatalogKind,
  CatalogOperation,
  CatalogPreview,
  CatalogPreviewItem,
  CatalogRef,
} from "./types.js";

type Created = Record<string, { kind: CatalogKind; id: number }>;
const endpointKinds: Record<string, CatalogKind> = {
  artistId: "artist",
  personId: "person",
  organizationId: "organization",
  albumId: "album",
  trackId: "track",
};
export const sensitiveOperation = (op: CatalogOperation): boolean =>
  [
    "merge_entities",
    "remove_entity",
    "remove_relation",
    "remove_genre",
  ].includes(op.op) ||
  (op.op === "replace_fields" &&
    Object.values(op.values).some((v) => v === null));
export function resolveRef(ref: CatalogRef, created: Created): number {
  if ("id" in ref) return ref.id;
  const result = created[ref.key];
  if (!result || result.kind !== ref.kind)
    throw new Error(`referencia ${ref.key} no disponible para ${ref.kind}`);
  return result.id;
}
function entityValues(
  kind: CatalogKind,
  values: Record<string, unknown>,
  create: boolean,
): Record<string, unknown> {
  if (kind === "album" && "genre" in values)
    throw new Error(
      "Usa Añadir género para asignar géneros canónicos al disco.",
    );
  const fields: z.ZodRawShape = ENTITY_FIELDS[kind];
  const schema = z.object(fields).partial().strict();
  const parsed = schema.parse(values);
  if (create) {
    const identity = kind === "album" || kind === "track" ? "title" : "name";
    if (!parsed[identity]) throw new Error(`${identity} obligatorio`);
    if (kind === "track" && !parsed["trackNumber"])
      throw new Error("trackNumber obligatorio");
  }
  if (!Object.keys(parsed).length)
    throw new Error("No hay campos para cambiar");
  return Object.fromEntries(
    Object.entries(parsed).map(([k, v]) => [toSnake(k), v]),
  );
}
function validatePeriod(values: Record<string, unknown>): void {
  const from = values["fromYear"],
    to = values["toYear"];
  if (typeof from === "number" && typeof to === "number" && to < from)
    throw new Error("El período termina antes de empezar");
  if (values["isCurrent"] === true && to !== null && to !== undefined)
    throw new Error("Un integrante actual no puede tener fecha final");
}
function assertKind(ref: CatalogRef, kind: CatalogKind): void {
  if (ref.kind !== kind)
    throw new Error(`Se esperaba ${kind}, se recibió ${ref.kind}`);
}

/** Capture the entire affected state, not just fields the model happened to mention. */
export async function planState(
  client: PoolClient,
  root: { kind: CatalogKind; id: number },
  draft: CatalogDraft,
  lock = false,
): Promise<{ state: unknown; affected: CatalogPreview["affected"] }> {
  const refs = new Map<string, { kind: CatalogKind; id: number }>([
    [`${root.kind}:${root.id}`, root],
  ]);
  const relationRows: unknown[] = [];
  const mergeHashes: unknown[] = [];
  for (const op of draft.operations.filter((o) => o.enabled)) {
    for (const ref of operationRefs(op))
      if ("id" in ref) refs.set(`${ref.kind}:${ref.id}`, ref);
    if (
      (op.op === "create_album" ||
        op.op === "create_entity" ||
        op.op === "replace_fields") &&
      typeof op.values["labelId"] === "number"
    )
      refs.set(`organization:${op.values["labelId"]}`, {
        kind: "organization",
        id: op.values["labelId"],
      });
    if (op.op === "replace_relation" || op.op === "remove_relation") {
      const spec = RELATION_SPECS[op.kind];
      const row = (
        await client.query<Record<string, unknown>>(
          `SELECT * FROM ${spec.table} WHERE id=$1${lock ? " FOR UPDATE" : ""}`,
          [op.id],
        )
      ).rows[0];
      relationRows.push({ kind: op.kind, id: op.id, row: row ?? null });
      if (row)
        for (const [key, kind] of Object.entries(endpointKinds)) {
          const id = row[toSnake(key)];
          if (id !== null && id !== undefined)
            refs.set(`${kind}:${id}`, { kind, id: Number(id) });
        }
    }
    if (
      op.op === "merge_entities" &&
      "id" in op.keep &&
      "id" in op.drop &&
      op.keep.kind === op.drop.kind &&
      op.keep.kind !== "track"
    ) {
      const p =
        op.keep.kind === "album"
          ? await previewAlbumMerge(client, op.keep.id, op.drop.id)
          : await previewEntityMerge(
              client,
              op.keep.kind,
              op.keep.id,
              op.drop.id,
            );
      mergeHashes.push({ key: op.key, hash: p.previewHash });
    }
  }
  const states: unknown[] = [];
  const affected: CatalogPreview["affected"] = [];
  for (const ref of [...refs.values()].sort((a, b) =>
    `${a.kind}:${a.id}`.localeCompare(`${b.kind}:${b.id}`),
  )) {
    if (lock)
      await client.query(
        `SELECT id FROM ${ENTITY_SPECS[ref.kind].table} WHERE id=$1 FOR UPDATE`,
        [ref.id],
      );
    const state = await entityState(client, ref.kind, ref.id);
    const row = state["row"] as Record<string, unknown>;
    states.push({ kind: ref.kind, id: ref.id, state });
    affected.push({
      ...ref,
      label: String(row[ENTITY_SPECS[ref.kind].identityColumn]),
    });
  }
  const taxonomy = (
    await client.query("SELECT * FROM ingest.genres ORDER BY id")
  ).rows;
  return { state: { states, relationRows, mergeHashes, taxonomy }, affected };
}
async function view(
  client: PoolClient,
  op: CatalogOperation,
  created: Created,
): Promise<unknown> {
  if (op.op === "create_entity" || op.op === "create_album") return null;
  if (op.op === "replace_relation" || op.op === "remove_relation")
    return (
      (
        await client.query(
          `SELECT * FROM ${RELATION_SPECS[op.kind].table} WHERE id=$1`,
          [op.id],
        )
      ).rows[0] ?? null
    );
  if (op.op === "create_relation") {
    const entries = Object.entries(op.endpoints);
    if (!entries.length) return { endpoints: op.endpoints, existing: [] };
    if (entries.some(([key, ref]) => endpointKinds[key] !== ref.kind))
      throw new Error("Extremos de relación inválidos");
    const existing = (
      await client.query(
        `SELECT * FROM ${RELATION_SPECS[op.kind].table} WHERE ${entries.map(([key], i) => `${toSnake(key)}=$${i + 1}`).join(" AND ")} ORDER BY id`,
        entries.map(([, ref]) => resolveRef(ref, created)),
      )
    ).rows;
    return { endpoints: op.endpoints, existing };
  }
  if (op.op === "merge_entities") {
    if (op.keep.kind !== op.drop.kind || op.keep.kind === "track")
      throw new Error(
        "Solo se fusionan fichas del mismo tipo; pistas requieren una operación especializada.",
      );
    const keep = resolveRef(op.keep, created),
      drop = resolveRef(op.drop, created);
    return op.keep.kind === "album"
      ? previewAlbumMerge(client, keep, drop)
      : previewEntityMerge(client, op.keep.kind, keep, drop);
  }
  const ref = op.op === "reorder_tracks" ? op.album : op.target;
  if (
    op.op === "reorder_tracks" ||
    op.op === "assign_genre" ||
    op.op === "remove_genre" ||
    op.op === "add_alias" ||
    op.op === "remove_entity"
  )
    return entityState(client, ref.kind, resolveRef(ref, created));
  const row = await entityRow(client, ref.kind, resolveRef(ref, created));
  return Object.fromEntries(
    Object.keys(op.values).map((k) => [k, row[toSnake(k)]]),
  );
}
/** Swap/reposition without unique-key collisions; journal collapses staging into the true before/after. */
async function reorder(
  context: OperatorContext,
  op: Extract<CatalogOperation, { op: "reorder_tracks" }>,
  created: Created,
): Promise<unknown> {
  assertKind(op.album, "album");
  const albumId = resolveRef(op.album, created);
  const rows = (
    await context.client.query<{
      id: number;
      title: string;
      disc_number: number;
      track_number: number;
    }>(
      "SELECT id,title,disc_number,track_number FROM public.tracks WHERE album_id=$1 ORDER BY id FOR UPDATE",
      [albumId],
    )
  ).rows;
  const byId = new Map(rows.map((r) => [Number(r.id), r]));
  const changed = new Map<
    number,
    { discNumber: number; trackNumber: number }
  >();
  for (const p of op.positions) {
    assertKind(p.track, "track");
    const id = resolveRef(p.track, created);
    if (!byId.has(id))
      throw new Error(`La pista ${id} no pertenece a este disco`);
    if (changed.has(id)) throw new Error(`La pista ${id} aparece dos veces`);
    changed.set(id, p);
  }
  const positions = new Set<string>();
  for (const r of rows) {
    const p = changed.get(Number(r.id));
    const key = `${p?.discNumber ?? r.disc_number}:${p?.trackNumber ?? r.track_number}`;
    if (positions.has(key)) throw new Error(`Dos pistas ocuparían ${key}`);
    positions.add(key);
  }
  const max = Math.max(
    0,
    ...rows.map((r) => r.track_number),
    ...op.positions.map((p) => p.trackNumber),
  );
  if (max + changed.size >= 32767)
    throw new Error("La numeración no deja espacio temporal para ordenar");
  let offset = 0;
  for (const id of changed.keys())
    await context.client.query(
      "UPDATE public.tracks SET track_number=$2 WHERE id=$1",
      [id, max + ++offset],
    );
  for (const [id, p] of changed) {
    const original = byId.get(id)!;
    await context.client.query(
      "UPDATE public.tracks SET disc_number=$2,track_number=$3 WHERE id=$1",
      [id, p.discNumber, p.trackNumber],
    );
    for (const [field, before, after] of [
      ["disc_number", original.disc_number, p.discNumber],
      ["track_number", original.track_number, p.trackNumber],
    ] as const)
      if (before !== after) {
        await context.client.query(
          "INSERT INTO ingest.merge_audit(run_id,entity_kind,track_id,field,old_value,new_value,reason,confidence,performed_by) VALUES($1,'track',$2,$3,$4::jsonb,$5::jsonb,$6,'high','human')",
          [
            context.runId,
            id,
            field,
            JSON.stringify(before),
            JSON.stringify(after),
            context.note,
          ],
        );
      }
  }
  return {
    positions: op.positions.map((p) => ({
      ...p,
      title: byId.get(resolveRef(p.track, created))!.title,
    })),
  };
}
async function execute(
  context: OperatorContext,
  op: CatalogOperation,
  created: Created,
  allowSimilar = false,
): Promise<unknown> {
  const client = context.client;
  if (op.op === "create_album") {
    assertKind(op.artist, "artist");
    const values = { ...op.values };
    if (op.labelEntity) {
      assertKind(op.labelEntity, "organization");
      values["labelId"] = resolveRef(op.labelEntity, created);
    }
    const result = await createEntity(
      context,
      "album",
      entityValues("album", values, true),
      { artistId: resolveRef(op.artist, created), allowSimilar },
    );
    created[op.key] = { kind: "album", id: result.id };
    const tracks: unknown[] = [];
    for (const track of op.tracks) {
      const saved = await createEntity(
        context,
        "track",
        entityValues("track", track, true),
        { albumId: result.id, allowSimilar },
      );
      tracks.push({ ...track, id: saved.id });
    }
    for (const c of op.credits) {
      const route = RELATION_ROUTES.find((r) => r.kind === "album_credit")!;
      const body = {
        albumId: result.id,
        [`${c.target.kind}Id`]: resolveRef(c.target, created),
        role: c.role,
        ...(c.creditType ? { creditType: c.creditType } : {}),
      };
      const parsed = z.object(route.create).strict().parse(body);
      route.check?.(parsed);
      await createRelation(
        context,
        "album_credit",
        route.endpoints(parsed),
        route.values(parsed),
      );
    }
    for (const format of op.formats) {
      const route = RELATION_ROUTES.find((r) => r.kind === "album_format")!;
      const parsed = z
        .object(route.create)
        .strict()
        .parse({ albumId: result.id, ...format });
      await createRelation(
        context,
        "album_format",
        route.endpoints(parsed),
        route.values(parsed),
      );
    }
    for (const g of op.genres)
      await confirmGenre(client, {
        kind: "album",
        entityId: result.id,
        genreSlug: g.slug,
        role: g.role,
        actor: context.operator,
        reason: context.note,
        runId: context.runId,
      });
    for (const alias of op.aliases)
      await createAlias(context, "album", result.id, {
        alias,
        aliasType: "alternate_title",
        isPrimary: false,
      });
    return {
      values,
      tracks: tracks.map((t, i) => ({
        ...(t as object),
        id: `nueva:${op.key}:pista${i + 1}`,
      })),
      credits: op.credits,
      genres: op.genres,
      aliases: op.aliases,
      formats: op.formats,
    };
  }
  if (op.op === "create_entity") {
    const values = entityValues(op.kind, op.values, true);
    let options: CreateEntityOptions = { allowSimilar };
    if (op.kind === "album" || op.kind === "track") {
      if (!op.parent)
        throw new Error("Indica la ficha padre para crear disco o pista");
      assertKind(op.parent, op.kind === "album" ? "artist" : "album");
      const id = resolveRef(op.parent, created);
      options =
        op.kind === "album"
          ? { artistId: id, allowSimilar }
          : { albumId: id, allowSimilar };
    } else if (op.parent) throw new Error("Esta entidad no admite ficha padre");
    const result = await createEntity(context, op.kind, values, options);
    created[op.key] = { kind: op.kind, id: result.id };
    const row = await entityRow(client, op.kind, result.id);
    return { ...row, id: `nueva:${op.key}` };
  }
  if (op.op === "replace_fields") {
    const id = resolveRef(op.target, created);
    const values = entityValues(op.target.kind, op.values, false);
    await updateEntity(context, op.target.kind, id, values);
    const row = await entityRow(client, op.target.kind, id);
    for (const [field, value] of Object.entries(values)) {
      const stored =
        row[field] instanceof Date
          ? (row[field] as Date).toISOString().slice(0, 10)
          : row[field];
      if (
        JSON.stringify(stored) !== JSON.stringify(value) &&
        String(stored) !== String(value)
      )
        throw new Error(`El motor no aplicó ${field} como se propuso`);
    }
    return Object.fromEntries(
      Object.keys(op.values).map((k) => [k, row[toSnake(k)]]),
    );
  }
  if (op.op === "add_alias")
    return createAlias(
      context,
      op.target.kind,
      resolveRef(op.target, created),
      { alias: op.alias, aliasType: op.aliasType, isPrimary: op.isPrimary },
    );
  if (op.op === "create_relation") {
    const route = RELATION_ROUTES.find((r) => r.kind === op.kind)!;
    const body: Record<string, unknown> = { ...op.values };
    for (const [field, ref] of Object.entries(op.endpoints)) {
      if (endpointKinds[field] !== ref.kind)
        throw new Error(`Extremo ${field} de tipo incorrecto`);
      body[field] = resolveRef(ref, created);
    }
    const parsed = z.object(route.create).strict().parse(body);
    route.check?.(parsed);
    validatePeriod(parsed);
    const saved = await createRelation(
      context,
      op.kind,
      route.endpoints(parsed),
      route.values(parsed),
    );
    return {
      ...saved,
      relation: (
        await client.query(
          `SELECT * FROM ${RELATION_SPECS[op.kind].table} WHERE id=$1`,
          [saved.id],
        )
      ).rows[0],
    };
  }
  if (op.op === "replace_relation") {
    const route = RELATION_ROUTES.find((r) => r.kind === op.kind)!;
    const parsed = z.object(route.update).partial().strict().parse(op.values);
    route.checkUpdate?.(parsed);
    const existing = (
      await client.query<Record<string, unknown>>(
        `SELECT * FROM ${RELATION_SPECS[op.kind].table} WHERE id=$1`,
        [op.id],
      )
    ).rows[0];
    if (!existing) throw new Error("La relación ya no existe");
    validatePeriod({
      fromYear: existing["from_year"],
      toYear: existing["to_year"],
      isCurrent: existing["is_current"],
      ...parsed,
    });
    const values = Object.fromEntries(
      Object.entries(parsed).map(([k, v]) => [
        k === "role" &&
        (op.kind === "album_credit" || op.kind === "track_credit")
          ? "credit_role"
          : toSnake(k),
        v,
      ]),
    );
    await updateRelation(context, op.kind, op.id, values);
    return (
      await client.query(
        `SELECT * FROM ${RELATION_SPECS[op.kind].table} WHERE id=$1`,
        [op.id],
      )
    ).rows[0];
  }
  if (op.op === "remove_relation") {
    await deleteRelation(context, op.kind, op.id);
    return { removed: true };
  }
  if (op.op === "assign_genre" || op.op === "remove_genre") {
    if (op.target.kind !== "artist" && op.target.kind !== "album")
      throw new Error("Los géneros se asignan a artistas o discos");
    const input = {
      kind: op.target.kind,
      entityId: resolveRef(op.target, created),
      genreSlug: op.genreSlug,
      actor: context.operator,
      reason: context.note,
      runId: context.runId,
    };
    if (op.op === "assign_genre")
      await confirmGenre(client, { ...input, role: op.role });
    else await rejectGenre(client, input);
    return {
      genreSlug: op.genreSlug,
      ...(op.op === "assign_genre" ? { role: op.role } : { rejected: true }),
    };
  }
  if (op.op === "reorder_tracks") return reorder(context, op, created);
  if (op.op === "merge_entities") {
    if (op.keep.kind !== op.drop.kind || op.keep.kind === "track")
      throw new Error("La fusión exige dos fichas del mismo tipo");
    const keepId = resolveRef(op.keep, created),
      dropId = resolveRef(op.drop, created);
    const fieldChoices = Object.fromEntries(
      Object.entries(op.fieldChoices).map(([k, v]) => [toSnake(k), v]),
    );
    if (op.keep.kind === "album") {
      const preview = await previewAlbumMerge(client, keepId, dropId, {
        lock: true,
      });
      return mergeAlbums(context, {
        keepId,
        dropId,
        previewHash: preview.previewHash,
        fieldChoices: fieldChoices as Partial<
          Record<AlbumMergeField, "keep" | "drop">
        >,
        keepDropNameAsAlias: true,
      });
    }
    const preview = await previewEntityMerge(
      client,
      op.keep.kind,
      keepId,
      dropId,
      { lock: true },
    );
    if (preview.eraConflict)
      throw new Error(`Trayectorias incompatibles: ${preview.eraConflict}`);
    return mergeEntities(context, {
      kind: op.keep.kind,
      keepId,
      dropId,
      previewHash: preview.previewHash,
      fieldChoices,
      keepDropNameAsAlias: true,
    });
  }
  await deleteEntity(context, op.target.kind, resolveRef(op.target, created));
  return { removed: true };
}
export async function executePlan(
  context: OperatorContext,
  root: { kind: CatalogKind; id: number },
  draft: CatalogDraft,
  evidence: CatalogEvidence[],
  reviewedKeys: string[],
  options: { preview: boolean; expectedHash?: string },
): Promise<{ preview: CatalogPreview; created: Created }> {
  const beforeState = await planState(context.client, root, draft, true);
  const hash = hashValue({
    executionVersion: 1,
    root,
    draft,
    state: beforeState.state,
  });
  if (options.expectedHash && hash !== options.expectedHash)
    throw new OperatorError(
      "stale_preview",
      "El catálogo o la taxonomía cambiaron. Valida de nuevo antes de implementar.",
    );
  const created: Created = {};
  const items: CatalogPreviewItem[] = [];
  const evidenceIds = new Set(evidence.map((e) => e.id));
  const plannedNames = new Map(
    draft.operations.flatMap((o) => {
      if (o.op !== "create_entity" && o.op !== "create_album") return [];
      const name = o.values["name"] ?? o.values["title"];
      return typeof name === "string" ? [[o.key, name] as const] : [];
    }),
  );
  const evidenceContext: EvidenceContext = {
    root,
    nameOf: (ref) =>
      "id" in ref
        ? beforeState.affected.find((a) => a.kind === ref.kind && a.id === ref.id)?.label
        : plannedNames.get(ref.key),
  };
  let ordered: CatalogOperation[];
  try {
    ordered = orderedOperations(draft);
  } catch (error) {
    if (!options.preview) throw error;
    return {
      created,
      preview: {
        hash,
        ready: false,
        sensitive: false,
        affected: beforeState.affected,
        items: [
          {
            key: "plan",
            op: "replace_fields",
            label: "Dependencias del plan",
            before: null,
            after: null,
            warnings: [],
            error: error instanceof Error ? error.message : String(error),
          },
        ],
      },
    };
  }
  for (const op of ordered) {
    await context.client.query("SAVEPOINT ai_operation");
    let before: unknown = null;
    try {
      before = await view(context.client, op, created);
      if (op.evidenceIds.some((id) => !evidenceIds.has(id)))
        throw new Error("La operación cita evidencia inexistente");
      if (!op.evidenceIds.length && !reviewedKeys.includes(op.key))
        throw new Error(
          "Sin evidencia. Marca esta operación como decisión editorial si la has comprobado.",
        );
      const gaps = evidenceGaps(op, evidence, evidenceContext);
      if (!reviewedKeys.includes(op.key) && gaps.length)
        throw new EvidenceGapError(gaps);
      const after = await execute(
        {
          ...context,
          note: `${context.note} · ${op.label}: ${op.reason}`.slice(0, 2000),
        },
        op,
        created,
        reviewedKeys.includes(op.key),
      );
      const warnings: string[] = gaps.length
        ? [`Decisión editorial: sin respaldo documental para ${gaps.join("; ")}.`]
        : [];
      if (
        op.op === "create_album" ||
        (op.op === "create_entity" && op.kind === "album")
      )
        for (const f of ["releaseYear", "description", "coverUrl", "albumType"])
          if (op.values[f] === undefined || op.values[f] === null)
            warnings.push(
              `${f}: no documentado; se conservará vacío o desconocido.`,
            );
      items.push({
        key: op.key,
        op: op.op,
        label: op.label,
        before,
        after,
        error: null,
        warnings,
        ...(gaps.length ? { evidenceGaps: gaps } : {}),
      });
      await context.client.query("RELEASE SAVEPOINT ai_operation");
    } catch (error) {
      await context.client.query("ROLLBACK TO SAVEPOINT ai_operation");
      await context.client.query("RELEASE SAVEPOINT ai_operation");
      delete created[op.key];
      if (!options.preview) throw error;
      items.push({
        key: op.key,
        op: op.op,
        label: op.label,
        before,
        after: null,
        warnings: [],
        error: error instanceof Error ? error.message : String(error),
        ...(error instanceof EvidenceGapError ? { evidenceGaps: error.gaps } : {}),
      });
    }
  }
  return {
    created,
    preview: {
      hash,
      ready: items.length > 0 && items.every((i) => i.error === null),
      sensitive: ordered.some(sensitiveOperation),
      affected: beforeState.affected,
      items,
    },
  };
}
