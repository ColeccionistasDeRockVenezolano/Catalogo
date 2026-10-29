// CRV · Plan 20/20, etapa 4: «Investigar y completar» dentro de la ficha.
//
// Un solo recorrido: investigar, revisar lo propuesto por secciones (Datos,
// Discografía, Imágenes, Dudas), decidir cada cambio con su evidencia y deshacer,
// sin salir de la ficha. La sección elegida vive en la URL (?completar=) para
// volver al mismo punto. La curaduría con IA completa sigue en /curaduria/ia.
import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { MagnifyingGlass, ArrowClockwise } from "@phosphor-icons/react";
import { aiCurationApi, ApiError, CATALOG_DATA_CHANGED_EVENT, imageCandidatesApi, type ImageCandidateGroup } from "../lib/api";
import { useToast } from "../lib/ToastContext";
import { imageGroupKey, queueImageDecision, useImageCurationQueue } from "../lib/imageCurationQueue";
import {
  COMPLETE_INSTRUCTION, RECORD_SECTIONS, STATE_LABELS, groupBySubject, isOpen, isRecordSection, proposalSection, proposalState, summarizeRecord,
  type ProposalGroup, type RecordSection,
} from "../lib/recordReview";
import { CatalogProposalCard } from "./CatalogProposalCard";
import { KIND_LABELS } from "./CatalogOperationEditor";
import { ImageGroupCard } from "./ImageCandidateGroupCard";
import { UndoDialog } from "./UndoDialog";
import { COMPLETE_RECORD_ID } from "../lib/completeRecord";
import type { CatalogKind, CatalogOperation, CatalogPlan, CatalogRef, CatalogVocabulary } from "../../../src/curation/ai/types";

const PATHS: Record<CatalogKind, string> = { artist: "artistas", person: "personas", album: "discos", organization: "organizaciones", track: "pistas" };
const PHASES: Record<string, string> = {
  context: "Consultando la ficha", planning: "Preparando los cambios", sources: "Consultando fuentes", "source-profiles": "Consultando fuentes",
  preview: "Comprobando los cambios", verifying: "Comprobando el resultado",
};
const humanError = (cause: unknown) => cause instanceof Error ? cause.message : "No se pudo completar la acción.";
const dateTime = (value: string) => new Date(value).toLocaleString("es-VE", { dateStyle: "medium", timeStyle: "short" });

export function CompleteRecord({ kind, id, name, children }: {
  kind: Exclude<CatalogKind, "track">; id: number; name: string;
  /** Advanced tools folded under the panel (reliability report, comparison). */
  children?: React.ReactNode;
}) {
  const [params, setParams] = useSearchParams();
  const requested = params.get("completar");
  const section: RecordSection = isRecordSection(requested) ? requested : "resumen";
  const [plan, setPlan] = useState<CatalogPlan | null>(null);
  const [others, setOthers] = useState(0);
  const [vocabulary, setVocabulary] = useState<CatalogVocabulary | null>(null);
  const [images, setImages] = useState<ImageCandidateGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [operationErrors, setOperationErrors] = useState<Record<string, string>>({});
  const [undo, setUndo] = useState<number | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const inFlight = useRef(false);
  const version = useRef(0);
  const { notify } = useToast();
  const jobs = useImageCurationQueue();
  const tabsId = useId();
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const loadImages = useCallback(async () => {
    if (kind !== "artist" && kind !== "album") return [];
    const own = await imageCandidatesApi.list(kind, { entityId: id, limit: 5 });
    const covers = kind === "artist" ? await imageCandidatesApi.list("album", { artistId: id, limit: 50 }) : { data: [] };
    return [...own.data, ...covers.data];
  }, [kind, id]);
  const load = useCallback(async () => {
    const current = ++version.current;
    setLoading(true); setError(null);
    try {
      const [plans, groups, words] = await Promise.all([aiCurationApi.list(kind, id), loadImages(), aiCurationApi.vocabulary()]);
      if (current !== version.current) return;
      setPlan(plans[0] ?? null); setOthers(Math.max(0, plans.length - 1)); setImages(groups); setVocabulary(words);
    } catch (cause) { if (current === version.current) setError(humanError(cause)); }
    finally { if (current === version.current) setLoading(false); }
  }, [kind, id, loadImages]);
  useEffect(() => { void load(); }, [load]);
  // An image decided here or elsewhere reaches the record through the shared queue.
  useEffect(() => {
    const reload = () => { void loadImages().then(setImages).catch(() => undefined); };
    window.addEventListener(CATALOG_DATA_CHANGED_EVENT, reload);
    return () => window.removeEventListener(CATALOG_DATA_CHANGED_EVENT, reload);
  }, [loadImages]);

  const running = plan?.status === "queued" || plan?.status === "running";
  const pollingId = plan?.id;
  useEffect(() => {
    if (!pollingId || !running) return;
    let active = true, polling = false;
    const timer = window.setInterval(() => {
      if (polling || document.visibilityState !== "visible") return;
      polling = true;
      void aiCurationApi.get(pollingId).then((next) => { if (active) setPlan(next); }).catch((cause) => { if (active) setError(humanError(cause)); }).finally(() => { polling = false; });
    }, 2500);
    return () => { active = false; window.clearInterval(timer); };
  }, [pollingId, running]);

  // On narrow screens the tab strip scrolls: keep the selected tab in sight without moving the page.
  useEffect(() => {
    const tab = tabRefs.current[RECORD_SECTIONS.findIndex((item) => item.key === section)];
    const strip = tab?.parentElement;
    if (!tab || !strip) return;
    if (tab.offsetLeft < strip.scrollLeft) strip.scrollLeft = tab.offsetLeft;
    else if (tab.offsetLeft + tab.offsetWidth > strip.scrollLeft + strip.clientWidth) strip.scrollLeft = tab.offsetLeft + tab.offsetWidth - strip.clientWidth;
  }, [section, loading, plan, images.length]);

  function selectSection(next: RecordSection, focus = false) {
    setParams((previous) => {
      const query = new URLSearchParams(previous);
      if (next === "resumen") query.delete("completar"); else query.set("completar", next);
      return query;
    }, { replace: true });
    if (focus) requestAnimationFrame(() => tabRefs.current[RECORD_SECTIONS.findIndex((item) => item.key === next)]?.focus());
  }
  function onTabKey(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const last = RECORD_SECTIONS.length - 1;
    const target = event.key === "ArrowRight" ? (index === last ? 0 : index + 1) : event.key === "ArrowLeft" ? (index === 0 ? last : index - 1) : event.key === "Home" ? 0 : event.key === "End" ? last : null;
    if (target === null) return;
    event.preventDefault();
    selectSection(RECORD_SECTIONS[target]!.key, true);
  }

  async function investigate() {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError(null);
    try { const next = await aiCurationApi.start(kind, id, COMPLETE_INSTRUCTION); setPlan(next); }
    catch (cause) { setError(humanError(cause)); }
    finally { inFlight.current = false; setBusy(false); }
  }
  async function resume() {
    if (!plan || inFlight.current) return;
    inFlight.current = true; setBusy(true); setError(null);
    try { setPlan(await aiCurationApi.resume(plan.id)); }
    catch (cause) { setError(humanError(cause)); }
    finally { inFlight.current = false; setBusy(false); }
  }
  async function refresh() {
    if (!plan || inFlight.current) return;
    inFlight.current = true; setBusy(true); setError(null);
    try { const latest = await aiCurationApi.get(plan.id); setPlan(latest.status === "ready" ? await aiCurationApi.refresh(latest) : latest); }
    catch (cause) { setError(humanError(cause)); }
    finally { inFlight.current = false; setBusy(false); }
  }
  /** One explicit decision on one proposal; returns the updated plan or null when it failed. */
  async function decideOne(current: CatalogPlan, operation: CatalogOperation, decision: "accepted" | "rejected"): Promise<CatalogPlan | null> {
    setBusyKey(operation.key);
    setOperationErrors((errors) => { const next = { ...errors }; delete next[operation.key]; return next; });
    try {
      let base = current;
      const original = current.draft!.operations.find((op) => op.key === operation.key);
      if (decision === "accepted" && JSON.stringify(original) !== JSON.stringify(operation))
        base = await aiCurationApi.save(current, { ...current.draft!, operations: current.draft!.operations.map((op) => op.key === operation.key ? operation : op) }, current.reviewedKeys);
      const next = await aiCurationApi.decide(base, operation.key, decision);
      setPlan(next);
      return next;
    } catch (cause) {
      setOperationErrors((errors) => ({ ...errors, [operation.key]: humanError(cause) }));
      if (cause instanceof ApiError && cause.code === "stale_preview") {
        const latest = await aiCurationApi.get(current.id).catch(() => null);
        if (latest) setPlan(latest);
      }
      return null;
    } finally { setBusyKey(null); }
  }
  async function decide(operation: CatalogOperation, decision: "accepted" | "rejected") {
    if (!plan?.draft || inFlight.current) return;
    inFlight.current = true; setBusy(true);
    try {
      const next = await decideOne(plan, operation, decision);
      const decided = next?.decisions?.[operation.key];
      if (decision === "accepted" && decided?.runId) notify("success", "Cambio aplicado.", { action: { label: "Deshacer", onAction: () => setUndo(decided.runId) } });
      else if (next) notify("info", "Propuesta rechazada. El dato se conserva.");
    } finally { inFlight.current = false; setBusy(false); }
  }
  /** Accepts the documented proposals of one group after an explicit confirmation, one by one. */
  async function acceptGroup(group: ProposalGroup) {
    if (!plan?.draft || inFlight.current) return;
    inFlight.current = true; setBusy(true); setConfirming(null);
    let current: CatalogPlan | null = plan, accepted = 0;
    try {
      for (const op of group.operations) {
        if (!current || proposalState(current, op) !== "ready") continue;
        const next: CatalogPlan | null = await decideOne(current, op, "accepted");
        if (!next) break;
        current = next; accepted++;
      }
      if (accepted) notify("success", `${accepted} ${accepted === 1 ? "cambio aplicado" : "cambios aplicados"}. Cada uno se puede deshacer por separado.`);
    } finally { inFlight.current = false; setBusy(false); }
  }

  const summary = summarizeRecord(plan, images.filter((group) => !jobs.some((job) => job.type === "decision" && job.hide && job.groups.some((other) => imageGroupKey(other) === imageGroupKey(group)))).length);
  const visibleImages = images.filter((group) => !jobs.some((job) => job.type === "decision" && job.hide && job.groups.some((other) => imageGroupKey(other) === imageGroupKey(group))));
  const operations = plan?.draft?.operations ?? [];
  const counts: Record<RecordSection, number> = {
    resumen: summary.next.length,
    datos: summary.bySection.datos.open,
    discografia: summary.bySection.discografia.open,
    imagenes: visibleImages.length,
    dudas: summary.doubts,
  };

  function refLabel(ref: CatalogRef | null): string {
    if (!ref) return "Otras relaciones";
    if ("key" in ref) {
      const created = plan?.result?.created[ref.key];
      const creating = operations.find((op) => op.key === ref.key);
      return created ? `${KIND_LABELS[ref.kind]} nueva #${created.id}` : `${KIND_LABELS[ref.kind]} nueva: ${creating && "values" in creating ? String(creating.values["name"] ?? creating.values["title"] ?? creating.label) : creating?.label ?? ""}`;
    }
    if (ref.kind === kind && ref.id === id) return `${name} (esta ficha)`;
    return plan?.preview?.affected.find((item) => item.kind === ref.kind && item.id === ref.id)?.label ?? `${KIND_LABELS[ref.kind]} #${ref.id}`;
  }
  function refPath(ref: CatalogRef | null): string | null {
    if (!ref || ref.kind === "track") return null;
    const target = "id" in ref ? ref.id : plan?.result?.created[ref.key]?.id;
    return target && !(ref.kind === kind && target === id) ? `/${PATHS[ref.kind]}/${target}` : null;
  }

  function renderProposals(which: "datos" | "discografia") {
    if (!plan || !vocabulary) return null;
    const mine = operations.filter((op) => proposalSection(op) === which);
    if (!mine.length) return <p className="record-complete__empty">{plan.draft ? `No hay cambios propuestos en ${which === "datos" ? "Datos" : "Discografía"}.` : "Todavía no hay cambios preparados."}</p>;
    return groupBySubject(mine).map((group) => {
      const open = group.operations.filter((op) => isOpen(proposalState(plan, op)));
      const decided = group.operations.filter((op) => !isOpen(proposalState(plan, op)));
      const ready = open.filter((op) => proposalState(plan, op) === "ready");
      const path = refPath(group.subject);
      return <section key={group.key} className="record-complete__group" aria-label={refLabel(group.subject)}>
        <header className="record-complete__group-head">
          <h4>{path ? <Link to={path}>{refLabel(group.subject)}</Link> : refLabel(group.subject)}</h4>
          <p>{open.length ? `${open.length} por decidir` : "Todo decidido"}{decided.length ? ` · ${decided.length} decididos` : ""}</p>
          {ready.length > 1 && plan.status === "ready" ? (confirming === group.key
            ? <div className="record-complete__confirm" role="group" aria-label="Confirmar aceptación del grupo">
                <p>Se aplicarán {ready.length} cambios documentados, cada uno con su propio registro para deshacer:</p>
                <ul>{ready.map((op) => <li key={op.key}>{op.label}</li>)}</ul>
                <div className="page-actions"><button type="button" className="btn btn--primary btn--sm" disabled={busy} onClick={() => void acceptGroup(group)}>Confirmar y aplicar {ready.length}</button><button type="button" className="btn btn--sm" onClick={() => setConfirming(null)}>Cancelar</button></div>
              </div>
            : <button type="button" className="btn btn--sm" disabled={busy} onClick={() => setConfirming(group.key)}>Aceptar los {ready.length} documentados…</button>) : null}
        </header>
        {open.map((op) => <div key={op.key} className="record-complete__item">
          <span className={`record-complete__state record-complete__state--${proposalState(plan, op)}`}>{STATE_LABELS[proposalState(plan, op)]}</span>
          <CatalogProposalCard operation={op} plan={plan} rootLabel={name} vocabulary={vocabulary} busy={busy} processing={busyKey === op.key} error={operationErrors[op.key]} onDecide={(operation, decision) => void decide(operation, decision)} onUndo={setUndo} />
        </div>)}
        {decided.length ? <details className="record-complete__decided"><summary>Decididos en este grupo ({decided.length})</summary>
          {decided.map((op) => <CatalogProposalCard key={op.key} operation={op} plan={plan} rootLabel={name} vocabulary={vocabulary} busy={busy} processing={busyKey === op.key} error={operationErrors[op.key]} onDecide={(operation, decision) => void decide(operation, decision)} onUndo={setUndo} />)}
        </details> : null}
      </section>;
    });
  }

  const blocked = plan ? operations.filter((op) => proposalState(plan, op) === "blocked") : [];
  const unfinished = Boolean(plan && (plan.phase === "partial" || plan.status === "failed") && !running);
  const panel = (() => {
    if (loading && !plan) return <p role="status">Cargando lo preparado para esta ficha…</p>;
    switch (section) {
      case "resumen": return <div className="record-complete__summary">
        {/* An unfinished preparation already explains itself in the banner above, next to «Reanudar». */}
        {plan ? <p className="record-complete__ended">{running ? `${PHASES[plan.phase] ?? "Investigando"}… Puedes salir de la ficha: el avance se guarda.` : unfinished ? "Esto es lo preparado hasta ahora:" : summary.ended}</p>
          : <p className="record-complete__ended">Esta ficha todavía no se investigó. «Investigar y completar» consulta fuentes, contrasta lo encontrado y prepara cambios con cita para que los decidas uno a uno.</p>}
        {plan ? <dl className="record-complete__counts">
          <div><dt>Documentados por decidir</dt><dd className="mono">{summary.counts.ready}</dd></div>
          <div><dt>Requieren tu criterio</dt><dd className="mono">{summary.counts.judgement}</dd></div>
          <div><dt>Esperan otro cambio o bloqueados</dt><dd className="mono">{summary.counts.waiting + summary.counts.blocked}</dd></div>
          <div><dt>Dudas sin resolver</dt><dd className="mono">{summary.doubts}</dd></div>
          <div><dt>Fichas con imágenes por elegir</dt><dd className="mono">{visibleImages.length}</dd></div>
          <div><dt>Ya decididos</dt><dd className="mono">{summary.counts.accepted + summary.counts.rejected + summary.counts.undone}</dd></div>
        </dl> : null}
        {plan?.preview?.outcome?.issues.length ? <div role="alert"><p>El resumen de la IA promete cambios que no están preparados; no lo tomes como trabajo terminado:</p><ul>{plan.preview.outcome.issues.map((issue) => <li key={issue}>{issue}</li>)}</ul></div> : null}
        {summary.next.length ? <><h4>Siguientes pasos</h4><ol className="record-complete__next">{summary.next.map((step) => {
          const target: RecordSection = /Datos/u.test(step) ? "datos" : /Discografía/u.test(step) ? "discografia" : /Imágenes/u.test(step) ? "imagenes" : /dudas?/u.test(step) ? "dudas" : /criterio|espera/u.test(step) ? (summary.bySection.datos.open >= summary.bySection.discografia.open ? "datos" : "discografia") : "resumen";
          return <li key={step}><button type="button" className="text-link" onClick={() => selectSection(target, true)}>{step}</button></li>;
        })}</ol></> : plan && !running ? <p>No queda nada por decidir en esta investigación.</p> : null}
      </div>;
      case "datos": case "discografia": return <div className="record-complete__list">{renderProposals(section)}</div>;
      case "imagenes": return kind !== "artist" && kind !== "album"
        ? <p className="record-complete__empty">Las imágenes se eligen en las fichas de artista y de disco.</p>
        : visibleImages.length ? <ol className="img-pick-list">{visibleImages.map((group) => <li key={imageGroupKey(group)}><ImageGroupCard group={group} onDecide={(candidate) => queueImageDecision(group, candidate?.id ?? null)} /></li>)}</ol>
        : <p className="record-complete__empty">No hay imágenes candidatas pendientes para {kind === "artist" ? "esta ficha ni sus discos" : "este disco"}.</p>;
      case "dudas": return <div className="record-complete__doubts">
        {plan?.draft?.unresolved.length ? <><h4>Lo que las fuentes no confirman ({plan.draft.unresolved.length})</h4><p className="hint">No se aplica nada desde aquí. Cada duda dice qué falta para resolverla; puedes pedir una investigación concreta con «Pedir otro cambio con IA», más abajo.</p><ul>{plan.draft.unresolved.map((text, index) => <li key={index}>{text}</li>)}</ul></> : null}
        {blocked.length ? <><h4>Cambios bloqueados ({blocked.length})</h4><ul>{blocked.map((op) => <li key={op.key}><strong>{op.label}</strong>: {plan?.preview?.items.find((item) => item.key === op.key)?.error}</li>)}</ul></> : null}
        {!plan?.draft?.unresolved.length && !blocked.length ? <p className="record-complete__empty">Sin dudas pendientes en esta investigación.</p> : null}
      </div>;
    }
  })();

  return <section id={COMPLETE_RECORD_ID} className="record-complete section" aria-labelledby={`${tabsId}-title`}>
    <header className="record-complete__header">
      <div>
        <h2 id={`${tabsId}-title`} tabIndex={-1}>Completar la ficha</h2>
        <p>{plan ? `Investigación del ${dateTime(plan.createdAt)}${plan.instruction !== COMPLETE_INSTRUCTION ? ` · pedido: «${plan.instruction.slice(0, 90)}${plan.instruction.length > 90 ? "…" : ""}»` : ""}` : "Investiga con fuentes y decide cada cambio con su evidencia."}</p>
      </div>
      <div className="page-actions">
        <button type="button" className="btn btn--primary" disabled={busy || running || !vocabulary?.configured} onClick={() => void investigate()}>
          <MagnifyingGlass size={16} aria-hidden="true" />{running ? "Investigando…" : plan ? "Volver a investigar y completar" : "Investigar y completar"}
        </button>
        {plan?.status === "ready" ? <button type="button" className="btn btn--sm" disabled={busy} onClick={() => void refresh()}><ArrowClockwise size={14} aria-hidden="true" />Actualizar con la ficha actual</button> : null}
      </div>
    </header>
    {vocabulary && !vocabulary.configured ? <p role="status">La investigación con IA no está configurada en el servidor.</p> : null}
    {plan && !running ? <p className="hint">Investigar de nuevo consulta fuentes y la IA (unos centavos de dólar); aceptar, rechazar y deshacer no consultan nada.</p> : null}
    {error ? <p role="alert" className="ai-message ai-message--error">{error} <button type="button" className="text-link" onClick={() => void load()}>Reintentar</button></p> : null}
    {unfinished ? <div role="status" className="record-complete__resume"><p>{summary.ended}</p><button type="button" className="btn btn--sm" disabled={busy} onClick={() => void resume()}>Reanudar la investigación</button></div> : null}
    <div className="record-complete__tabs" role="tablist" aria-label="Secciones de lo preparado">
      {RECORD_SECTIONS.map((item, index) => <button key={item.key} ref={(node) => { tabRefs.current[index] = node; }} type="button" role="tab" id={`${tabsId}-tab-${item.key}`} aria-selected={section === item.key} aria-controls={`${tabsId}-panel`} tabIndex={section === item.key ? 0 : -1} onKeyDown={(event) => onTabKey(event, index)} onClick={() => selectSection(item.key)}>
        {item.label}{item.key !== "resumen" && counts[item.key] ? <span className="record-complete__count mono" aria-label={`${counts[item.key]} pendientes`}>{counts[item.key]}</span> : null}
      </button>)}
    </div>
    <div className="record-complete__panel" role="tabpanel" id={`${tabsId}-panel`} aria-labelledby={`${tabsId}-tab-${section}`} tabIndex={0} aria-busy={busy || running}>{panel}</div>
    <details className="record-complete__more"><summary>Fiabilidad, comparación e investigaciones anteriores</summary>
      <div className="page-actions">
        <Link className="btn btn--sm" to={`/curaduria/ia?kind=${kind}&id=${id}`}>Pedir otro cambio con IA{others ? ` · ${others} investigaciones anteriores` : ""}</Link>
        <Link className="btn btn--sm" to={`/historial`}>Historial de cambios</Link>
      </div>
      {children}
    </details>
    {undo ? <UndoDialog runId={undo} onClose={() => setUndo(null)} onDone={() => { setUndo(null); if (plan) void aiCurationApi.get(plan.id).then(setPlan).catch((cause) => setError(humanError(cause))); }} /> : null}
  </section>;
}
