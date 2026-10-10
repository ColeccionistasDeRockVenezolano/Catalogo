import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { CatalogDecision, CatalogOperation, CatalogPlan, CatalogRef, CatalogVocabulary } from "../../../src/curation/ai/types";
import { operationRefs } from "../../../src/curation/ai/schema";
import { CatalogChangePreview } from "./CatalogChangePreview";
import { CatalogOperationEditor, catalogFieldLabel, KIND_LABELS } from "./CatalogOperationEditor";

const PATHS = { artist: "artistas", person: "personas", album: "discos", organization: "organizaciones", track: "pistas" };
const editorialError = (message: string) => /Sin evidencia|extracto citado|criterio editorial/iu.test(message);
function title(op: CatalogOperation, vocabulary: CatalogVocabulary): string {
  const genre = (slug: string) => vocabulary.genres.find((item) => item.slug === slug)?.name ?? slug;
  switch (op.op) {
    case "assign_genre": return `Añadir género: ${genre(op.genreSlug)}`;
    case "remove_genre": return `Retirar género: ${genre(op.genreSlug)}`;
    case "add_alias": return `Añadir alias: ${op.alias}`;
    case "create_entity": return `Añadir ${KIND_LABELS[op.kind].toLocaleLowerCase("es")}: ${op.values.name ?? op.values.title ?? op.label}`;
    case "create_album": return `Añadir disco: ${op.values.title}${op.values.releaseYear ? ` (${op.values.releaseYear})` : ""}`;
    case "replace_fields": {
      const keys = Object.keys(op.values);
      if (keys.length === 1 && keys[0] === "biography") return /combin|fusion/iu.test(op.label) ? "Combinar las biografías" : "Actualizar biografía";
      if (keys.length === 1 && keys[0] === "description") return "Actualizar descripción";
      if (keys.length === 1 && keys[0] && typeof op.values[keys[0]] !== "boolean" && String(op.values[keys[0]] ?? "").length < 80)
        return `${op.values[keys[0]] === null ? "Vaciar" : "Corregir"} ${catalogFieldLabel(keys[0]).toLocaleLowerCase("es")}${op.values[keys[0]] === null ? "" : `: ${op.values[keys[0]]}`}`;
      return op.label;
    }
    default: return op.label;
  }
}

export function CatalogProposalCard({ operation, plan, rootLabel, vocabulary, busy, processing, error, onDecide, onUndo }: {
  operation: CatalogOperation; plan: CatalogPlan; vocabulary: CatalogVocabulary; busy: boolean;
  rootLabel: string | null;
  processing: boolean; error?: string | undefined; onDecide: (operation: CatalogOperation, decision: CatalogDecision["decision"]) => void;
  onUndo: (runId: number) => void;
}) {
  const [op, setOp] = useState(operation);
  const signature = JSON.stringify(operation);
  useEffect(() => { setOp(JSON.parse(signature) as CatalogOperation); }, [signature]);
  const decision = plan.decisions?.[op.key];
  const legacyApplied = plan.status === "applied" && !decision;
  const editable = plan.status === "ready" && !decision;
  const displayPreview = plan.preview ? { ...plan.preview, items: [...plan.preview.items, ...(decision?.preview ? [decision.preview] : [])] } : null;
  const preview = decision?.preview ?? plan.preview?.items.find((item) => item.key === op.key);
  const sources = plan.evidence.filter((item) => op.evidenceIds.includes(item.id));
  const narrative = op.op === "replace_fields" ? Object.entries(op.values).filter(([key]) => ["biography", "description"].includes(key)) : [];
  const otherFields = op.op === "replace_fields" && narrative.length ? { ...op, values: Object.fromEntries(Object.entries(op.values).filter(([key]) => !["biography", "description"].includes(key))) } : null;
  function refName(ref: CatalogRef): string {
    if ("key" in ref) {
      const created = plan.result?.created[ref.key];
      return plan.draft?.operations.find((item) => item.key === ref.key)?.label ?? (created ? `${KIND_LABELS[ref.kind]} #${created.id}` : "Nueva ficha");
    }
    const snapshot = preview?.before as { keep?: { id: number; name?: string; title?: string }; drop?: { id: number; name?: string; title?: string } } | undefined;
    const previous = [snapshot?.keep, snapshot?.drop].find((item) => item?.id === ref.id);
    return plan.preview?.affected.find((item) => item.kind === ref.kind && item.id === ref.id)?.label ?? previous?.name ?? previous?.title ?? (ref.kind === plan.entityKind && ref.id === plan.entityId ? rootLabel : null) ?? `${KIND_LABELS[ref.kind]} #${ref.id}`;
  }
  function refLink(ref: CatalogRef) {
    const id = "id" in ref ? ref.id : plan.result?.created[ref.key]?.id;
    return id ? <Link to={`/${PATHS[ref.kind]}/${id}`}>{refName(ref)}</Link> : <span>{refName(ref)}</span>;
  }
  const dependencies = operationRefs(op).filter((ref) => "key" in ref && (!plan.result?.created[ref.key] || plan.decisions?.[ref.key]?.undone));
  const structuralError = preview?.error && !editorialError(preview.error) ? preview.error : null;
  return <article className={`ai-proposal${decision || legacyApplied ? " is-decided" : ""}`} aria-label={title(op, vocabulary)}>
    <header><h3>{title(op, vocabulary)}</h3>{decision || legacyApplied ? <span className="ai-proposal__state">{decision?.undone ? "Deshecho" : decision?.decision === "rejected" ? "Rechazado" : "Aplicado"}</span> : null}</header>
    {"target" in op ? <p className="ai-proposal__context">En {refLink(op.target)}</p> : null}
    {op.op === "merge_entities" ? <div className="ai-proposal__merge"><p>Unir {refLink(op.drop)} con {refLink(op.keep)}.</p><p>Se conserva {refLink(op.keep)} y se integran las relaciones y los alias de ambas fichas.</p></div> : null}
    {op.op === "create_album" ? <p>{op.tracks.length} pistas · {op.credits.length} créditos · Artista: {refLink(op.artist)}</p> : null}
    {narrative.length ? narrative.map(([field, text]) => <div key={field} className="ai-proposal-narrative"><h4>Texto propuesto</h4>{text === null ? <p>Se vaciará este texto.</p> : <p>{String(text)}</p>}<details><summary>Ver texto actual</summary><p>{String((preview?.before as Record<string, unknown> | undefined)?.[field] ?? "Sin texto registrado")}</p></details></div>) : ["replace_fields", "replace_relation"].includes(op.op) ? <CatalogChangePreview operation={op} preview={displayPreview} vocabulary={vocabulary} /> : null}
    {otherFields && Object.keys(otherFields.values).length ? <CatalogChangePreview operation={otherFields} preview={displayPreview} vocabulary={vocabulary} /> : null}
    {editable && dependencies.length ? <p className="hint">Primero acepta {dependencies.map((ref) => `«${refName(ref)}»`).join(" y ")}. Este cambio necesita esa ficha.</p> : null}
    {editable && structuralError && !dependencies.length ? <p className="ai-proposal__warning">{structuralError}</p> : null}
    {error ? <p className="ai-message ai-message--error" role="alert">{error}</p> : null}
    {processing ? <p role="status">Guardando decisión…</p> : null}
    {editable ? <div className="ai-proposal__decision" role="group" aria-label={`¿Aceptas el cambio «${title(op, vocabulary)}»?`}><span>¿Aceptas el cambio?</span><button type="button" className="btn btn--primary btn--sm" disabled={busy || dependencies.length > 0} onClick={() => onDecide(op, "accepted")}>Sí, aceptar</button><button type="button" className="btn btn--sm" disabled={busy} onClick={() => onDecide(operation, "rejected")}>No</button></div> : null}
    {decision?.decision === "accepted" && decision.runId && !decision.undone ? <div className="page-actions"><Link className="text-link" to="/historial">Ver cambio #{decision.runId}</Link><button type="button" className="btn btn--sm" disabled={busy} onClick={() => onUndo(decision.runId!)}>Deshacer</button></div> : null}
    <details className="ai-proposal__detail"><summary>Por qué se propone · {sources.length} {sources.length === 1 ? "fuente" : "fuentes"}</summary><p>{op.reason}</p>{sources.length ? sources.map((source) => <div className="ai-proposal__source" key={source.id}>{/^https?:\/\//iu.test(source.url) ? <a href={source.url} target="_blank" rel="noreferrer">{source.label || source.url}</a> : <strong>{source.label || "Datos del catálogo"}</strong>}<blockquote>{source.quote}</blockquote></div>) : <p>La IA no adjuntó una fuente documental. Revisa el dato antes de aceptarlo.</p>}{preview?.error && editorialError(preview.error) ? <p className="hint">Las citas no bastan para comprobar este cambio. Al aceptarlo confirmas tu revisión editorial.</p> : null}</details>
    {!["assign_genre", "remove_genre", "add_alias", "replace_fields", "replace_relation"].includes(op.op) ? <details className="ai-proposal__detail"><summary>Ver qué se añadirá o modificará</summary><CatalogChangePreview operation={op} preview={plan.preview} vocabulary={vocabulary} /></details> : null}
    {editable ? <details className="ai-proposal__detail"><summary>Editar propuesta</summary><fieldset disabled={busy}><CatalogOperationEditor operation={op} operations={plan.draft!.operations} onChange={setOp} vocabulary={vocabulary} preview={plan.preview} /></fieldset><p className="hint">Tus ajustes se guardan y se aplican cuando eliges Sí, aceptar.</p></details> : null}
  </article>;
}
