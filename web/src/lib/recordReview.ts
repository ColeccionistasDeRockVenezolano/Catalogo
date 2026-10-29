// Plan 20/20, etapa 4: el recorrido «Investigar y completar» dentro de la ficha.
// Reparte las propuestas de la IA en Datos, Discografía y Dudas, las agrupa por la
// ficha a la que afectan y resume qué falta, sin cambiar ninguna decisión editorial:
// cada cambio se sigue aceptando o rechazando por separado.
import { operationRefs } from "../../../src/curation/ai/schema";
import type { CatalogKind, CatalogOperation, CatalogPlan, CatalogRef } from "../../../src/curation/ai/types";

export type RecordSection = "resumen" | "datos" | "discografia" | "imagenes" | "dudas";
export const RECORD_SECTIONS: ReadonlyArray<{ key: RecordSection; label: string }> = [
  { key: "resumen", label: "Resumen" },
  { key: "datos", label: "Datos" },
  { key: "discografia", label: "Discografía" },
  { key: "imagenes", label: "Imágenes" },
  { key: "dudas", label: "Dudas" },
];
export const isRecordSection = (value: string | null): value is RecordSection => RECORD_SECTIONS.some((section) => section.key === value);

/** Standard request of the main entry: everything documented about the record and its relations. */
export const COMPLETE_INSTRUCTION = "Investiga y completa todos los datos documentados de la ficha y sus relaciones.";

const RELEASE_KINDS = new Set<CatalogKind>(["album", "track"]);
const RELEASE_RELATIONS = new Set(["album_credit", "track_credit", "album_format"]);

/** The record an operation changes first: what the card says «En …». */
export function operationSubject(op: CatalogOperation): CatalogRef | null {
  switch (op.op) {
    case "create_album": return { kind: "album", key: op.key };
    case "create_entity": return { kind: op.kind, key: op.key };
    case "reorder_tracks": return op.album;
    case "merge_entities": return op.keep;
    case "create_relation": return Object.values(op.endpoints)[0] ?? null;
    case "replace_relation": case "remove_relation": return null;
    default: return op.target;
  }
}

/** Releases, tracks and their credits go to the discography; everything else is data of the record. */
export function proposalSection(op: CatalogOperation): "datos" | "discografia" {
  if (op.op === "create_album" || op.op === "reorder_tracks") return "discografia";
  if (op.op === "create_relation" || op.op === "replace_relation" || op.op === "remove_relation") return RELEASE_RELATIONS.has(op.kind) ? "discografia" : "datos";
  const subject = operationSubject(op);
  return subject && RELEASE_KINDS.has(subject.kind) ? "discografia" : "datos";
}

const EDITORIAL = /Sin evidencia|extracto citado|criterio editorial|Respaldo insuficiente/iu;
export type ProposalState = "accepted" | "rejected" | "undone" | "ready" | "judgement" | "waiting" | "blocked";
export const STATE_LABELS: Record<ProposalState, string> = {
  accepted: "Aplicado", rejected: "Rechazado", undone: "Deshecho", ready: "Documentado",
  judgement: "Requiere tu criterio", waiting: "Espera otro cambio", blocked: "Bloqueado",
};

/**
 * What a proposal needs now. «ready» is documented and can be accepted; «judgement» lacks support
 * or needs an editorial decision; «waiting» depends on a record another proposal creates;
 * «blocked» cannot be applied as it stands.
 */
export function proposalState(plan: CatalogPlan, op: CatalogOperation): ProposalState {
  const decision = plan.decisions?.[op.key];
  if (decision) return decision.undone ? "undone" : decision.decision;
  if (plan.status === "applied") return "accepted";
  const preview = plan.preview?.items.find((item) => item.key === op.key);
  const waiting = operationRefs(op).some((ref) => "key" in ref && ref.key !== op.key && (!plan.result?.created[ref.key] || plan.decisions?.[ref.key]?.undone));
  if (waiting) return "waiting";
  if (preview?.evidenceGaps?.length || (preview?.error && EDITORIAL.test(preview.error))) return "judgement";
  if (preview?.error) return "blocked";
  return "ready";
}
export const isOpen = (state: ProposalState) => state === "ready" || state === "judgement" || state === "waiting" || state === "blocked";

export interface ProposalGroup {
  key: string;
  subject: CatalogRef | null;
  operations: CatalogOperation[];
}
/** Groups operations by the record they change, keeping the plan's order inside each group. */
export function groupBySubject(operations: CatalogOperation[]): ProposalGroup[] {
  const groups = new Map<string, ProposalGroup>();
  for (const op of operations) {
    const subject = operationSubject(op);
    // A new record and the changes that point at it share the key of the proposal that creates it.
    const key = subject ? `${subject.kind}:${"id" in subject ? subject.id : `nuevo:${subject.key}`}` : "otros";
    const group = groups.get(key) ?? { key, subject, operations: [] };
    group.operations.push(op);
    groups.set(key, group);
  }
  return [...groups.values()];
}

export interface RecordSummary {
  bySection: Record<"datos" | "discografia", { open: number; ready: number }>;
  counts: Record<ProposalState, number>;
  doubts: number;
  images: number;
  /** Why the preparation stopped, in the owner's words. */
  ended: string | null;
  next: string[];
}
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function summarizeRecord(plan: CatalogPlan | null, images: number): RecordSummary {
  const counts: Record<ProposalState, number> = { accepted: 0, rejected: 0, undone: 0, ready: 0, judgement: 0, waiting: 0, blocked: 0 };
  const bySection = { datos: { open: 0, ready: 0 }, discografia: { open: 0, ready: 0 } };
  for (const op of plan?.draft?.operations ?? []) {
    const state = proposalState(plan!, op);
    counts[state]++;
    const section = bySection[proposalSection(op)];
    if (isOpen(state)) section.open++;
    if (state === "ready") section.ready++;
  }
  const doubts = plan?.draft?.unresolved.length ?? 0;
  const next: string[] = [];
  if (bySection.datos.ready) next.push(`Decide ${plural(bySection.datos.ready, "cambio documentado", "cambios documentados")} en Datos.`);
  if (bySection.discografia.ready) next.push(`Decide ${plural(bySection.discografia.ready, "cambio documentado", "cambios documentados")} en Discografía.`);
  if (images) next.push(`Elige imagen en ${plural(images, "ficha", "fichas")} (Imágenes).`);
  if (counts.judgement) next.push(`Revisa ${plural(counts.judgement, "cambio que requiere", "cambios que requieren")} tu criterio: falta respaldo o se parece a otra ficha.`);
  if (counts.waiting) next.push(`${plural(counts.waiting, "cambio espera", "cambios esperan")} a que aceptes la ficha que crean otros cambios.`);
  if (doubts) next.push(`Consulta ${plural(doubts, "duda", "dudas")} sin resolver con lo que falta para resolverlas.`);
  return { bySection, counts, doubts, images, ended: planEnded(plan), next };
}

/** Why a preparation finished, even when the record still has doubts. */
export function planEnded(plan: CatalogPlan | null): string | null {
  if (!plan) return null;
  if (plan.status === "queued" || plan.status === "running") return null;
  if (plan.status === "failed") return plan.error ? `La preparación no terminó: ${plan.error}` : "La preparación no terminó. Puedes reanudarla; se conserva lo obtenido.";
  if (plan.phase === "partial") return "La preparación quedó incompleta: algunas tareas no terminaron (límite de consultas o fuentes caídas). Lo obtenido se conserva y puedes reanudarla.";
  const operations = plan.draft?.operations.length ?? 0;
  const doubts = plan.draft?.unresolved.length ?? 0;
  if (!operations && !doubts) return "La investigación terminó sin encontrar datos nuevos documentados para esta ficha.";
  if (!operations) return "La investigación terminó: lo encontrado no tiene respaldo suficiente para proponerlo y queda como dudas.";
  return doubts
    ? "La investigación terminó: propone lo que está documentado y deja como dudas lo que las fuentes no confirman."
    : "La investigación terminó: todo lo encontrado está documentado y propuesto.";
}
