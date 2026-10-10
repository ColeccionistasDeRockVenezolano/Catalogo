import type { CatalogDraft, CatalogKind, CatalogOperation, CatalogPlan, CatalogRef } from "./types.js";
import { OperatorError } from "../../merge/operator.js";

/** Previously accepted creations and fusions become real references for later decisions. */
export function resolveDecisionRef(plan: CatalogPlan, ref: CatalogRef): { kind: CatalogKind; id: number } {
  let current: { kind: CatalogKind; id: number };
  if ("id" in ref) current = { ...ref };
  else {
    const created = plan.result?.created[ref.key];
    const decision = plan.decisions?.[ref.key];
    if (!created || created.kind !== ref.kind || decision?.decision !== "accepted" || decision.undone) {
      const label = plan.draft?.operations.find((op) => op.key === ref.key)?.label ?? ref.key;
      throw new OperatorError("invalid", `Primero acepta «${label}». Este cambio necesita esa ficha.`);
    }
    current = { kind: created.kind, id: created.id };
  }
  const applied = [...(plan.draft?.operations ?? [])].sort((a, b) => (plan.decisions?.[a.key]?.decidedAt ?? "").localeCompare(plan.decisions?.[b.key]?.decidedAt ?? ""));
  for (const op of applied) {
    const decision = plan.decisions?.[op.key];
    if (op.op !== "merge_entities" || decision?.decision !== "accepted" || decision.undone) continue;
    // Merge operands can themselves refer to earlier accepted creations.
    const snapshot = decision.preview?.before as { keep?: { id: number }; drop?: { id: number }; matchedTracks?: Array<{ dropTrackId: number; keepTrackId: number }> } | undefined;
    if (current.kind === "track" && op.keep.kind === "album") {
      const match = snapshot?.matchedTracks?.find((track) => track.dropTrackId === current.id);
      if (match) current = { kind: "track", id: match.keepTrackId };
    }
    const drop = snapshot?.drop ? { kind: op.drop.kind, id: snapshot.drop.id } : "id" in op.drop ? op.drop : plan.result?.created[op.drop.key];
    const keep = snapshot?.keep ? { kind: op.keep.kind, id: snapshot.keep.id } : "id" in op.keep ? op.keep : plan.result?.created[op.keep.key];
    if (drop && keep && current.kind === drop.kind && current.id === drop.id)
      current = { kind: keep.kind, id: keep.id };
  }
  return current;
}

export function resolveDecisionOperation(plan: CatalogPlan, operation: CatalogOperation): CatalogOperation {
  const op = structuredClone(operation);
  const resolve = (ref: CatalogRef) => resolveDecisionRef(plan, ref);
  if ("target" in op) op.target = resolve(op.target);
  if (op.op === "create_entity" && op.parent) op.parent = resolve(op.parent);
  if (op.op === "create_relation") op.endpoints = Object.fromEntries(Object.entries(op.endpoints).map(([key, ref]) => [key, resolve(ref)]));
  if (op.op === "create_album") {
    op.artist = resolve(op.artist);
    if (op.labelEntity) op.labelEntity = resolve(op.labelEntity);
    op.credits = op.credits.map((credit) => ({ ...credit, target: resolve(credit.target) }));
  }
  if (op.op === "merge_entities") { op.keep = resolve(op.keep); op.drop = resolve(op.drop); }
  if (op.op === "reorder_tracks") {
    op.album = resolve(op.album);
    op.positions = op.positions.map((position) => ({ ...position, track: resolve(position.track) }));
  }
  op.enabled = true;
  return op;
}

/** Retain unresolved creation dependencies so the existing preview can validate the full remainder. */
export function remainingDecisionDraft(plan: CatalogPlan, draft: CatalogDraft = plan.draft!): CatalogDraft {
  const remaining = structuredClone(draft);
  remaining.operations = remaining.operations.filter((op) => !plan.decisions?.[op.key]);
  // Resolve only references already accepted; pending references stay within this draft.
  const resolve = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(resolve);
    if (value && typeof value === "object") {
      const row = value as Record<string, unknown>;
      if (typeof row["kind"] === "string" && Object.keys(row).every((key) => ["kind", "id", "key"].includes(key)) && (typeof row["id"] === "number" || typeof row["key"] === "string")) {
        if (typeof row["key"] === "string" && !plan.decisions?.[row["key"]]) return value;
        // A rejected prerequisite remains a missing reference, producing a useful validation error.
        if (typeof row["key"] === "string" && plan.decisions?.[row["key"]]?.decision !== "accepted") return value;
        return resolveDecisionRef(plan, value as CatalogRef);
      }
      return Object.fromEntries(Object.entries(row).map(([key, item]) => [key, resolve(item)]));
    }
    return value;
  };
  remaining.operations = remaining.operations.map((op) => resolve(op) as CatalogOperation);
  return remaining;
}
