import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Robot } from "@phosphor-icons/react";
import { aiCurationApi, artistsApi, personsApi, albumsApi, organizationsApi, tracksApi, entityVerificationApi, ApiError } from "../lib/api";
import { useToast } from "../lib/ToastContext";
import { EntityPicker } from "../components/EntityPicker";
import { KIND_LABELS } from "../components/CatalogOperationEditor";
import { CatalogProposalCard } from "../components/CatalogProposalCard";
import { UndoDialog } from "../components/UndoDialog";
import { VerificationCurationQueue } from "../components/VerificationCurationQueue";
import { findingInstruction } from "../../../src/verification/curation";
import type { VerificationFinding, VerificationReport } from "../../../src/verification/types";
import type { CatalogKind, CatalogOperation, CatalogPlan, CatalogVocabulary } from "../../../src/curation/ai/types";

const PHASES: Record<string, string> = {
  context: "Consultando la ficha", planning: "La IA está preparando los cambios",
  sources: "Consultando fuentes", preview: "Comprobando los cambios", ready: "Cambios listos para revisar",
  verifying: "Comprobando el resultado", done: "Revisión terminada",
  verification_failed: "Cambios aplicados; la comprobación posterior no terminó",
};
const STATUSES = { queued: "En espera", running: "Preparando", ready: "Por revisar", failed: "No se pudo preparar", applied: "Implementada", reviewed: "Revisada" };
const PATHS = { artist: "artistas", person: "personas", album: "discos", organization: "organizaciones", track: "pistas" };
const DEFAULT_INSTRUCTION = "Revisa los hallazgos del último informe de verificación y los datos incoherentes o faltantes de esta ficha. Prepara correcciones concretas para aceptar o rechazar por separado. Conserva toda la información válida y deja pendientes las dudas sin respaldo.";
const humanError = (cause: unknown) => cause instanceof Error ? cause.message : "No se pudo completar el cambio.";

export function AiCurationPage() {
  const [params, setParams] = useSearchParams();
  const initialKind = params.get("kind") as CatalogKind | null;
  const autoPrepare = useRef(params.get("prepare") === "1");
  const [kind, setKind] = useState<CatalogKind>(initialKind && initialKind in KIND_LABELS ? initialKind : "artist");
  const [entityId, setEntityId] = useState<number | null>(Number(params.get("id")) || null);
  const [entityLabel, setEntityLabel] = useState<string | null>(null);
  const [parentAlbumId,setParentAlbumId]=useState<number|null>(null);
  const [instruction, setInstruction] = useState(params.get("instruction")?.slice(0, 6000) ?? DEFAULT_INSTRUCTION);
  const [vocabulary, setVocabulary] = useState<CatalogVocabulary | null>(null);
  const [history, setHistory] = useState<CatalogPlan[]>([]);
  const [plan, setPlan] = useState<CatalogPlan | null>(null);
  const [requestOpen, setRequestOpen] = useState(true);
  const [filter, setFilter] = useState<"pending" | "all">("pending");
  const [historyLoading, setHistoryLoading] = useState(false);
  const [report, setReport] = useState<VerificationReport | null>(null);
  const [reportError, setReportError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [operationErrors, setOperationErrors] = useState<Record<string, string>>({});
  const [undo, setUndo] = useState<number | null>(null);
  const requestId = useRef(0);
  const actionInFlight = useRef(false);
  const planElement = useRef<HTMLDivElement>(null);
  const focusPlan = useRef(false);
  const { notify } = useToast();
  const running = plan?.status === "queued" || plan?.status === "running";

  function selectPlan(next: CatalogPlan) {
    setPlan(next); setRequestOpen(false); setError(null); setOperationErrors({}); setFilter("pending");
    setHistory((rows) => [next, ...rows.filter((row) => row.id !== next.id)]);
  }
  useEffect(() => {
    setReport(null); setReportError(null);
    if (!entityId) return;
    let active = true;
    void entityVerificationApi.get(kind, entityId).then(next => { if (active) setReport(next); }).catch(cause => { if (active) setReportError(humanError(cause)); });
    return () => { active = false; };
  }, [kind, entityId]);
  useEffect(() => {
    let active = true;
    void aiCurationApi.vocabulary().then((value) => { if (active) setVocabulary(value); }).catch((cause) => { if (active) setError(humanError(cause)); });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    const request = ++requestId.current;
    let active = true;
    setPlan(null); setHistory([]); setError(null); setOperationErrors({}); setRequestOpen(true);
    if (!entityId) { setHistoryLoading(false); return; }
    setParams({ kind, id: String(entityId) }, { replace: true });
    setHistoryLoading(true);
    void (async () => {
      try {
        const rows = await aiCurationApi.list(kind, entityId);
        if (!active || request !== requestId.current) return;
        setHistory(rows);
        if (autoPrepare.current) {
          autoPrepare.current = false;
          const next = await aiCurationApi.start(kind, entityId, instruction);
          if (active && request === requestId.current) selectPlan(next);
        } else if (rows[0]) selectPlan(rows[0]);
      } catch (cause) { if (active && request === requestId.current) setError(humanError(cause)); }
      finally { if (active && request === requestId.current) setHistoryLoading(false); }
    })();
    return () => { active = false; };
    // The request instruction is read only when the selected entity changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, entityId, setParams]);
  useEffect(() => {
    setParentAlbumId(null);
    if (!entityId) return;
    let active = true;
    const readers = { artist: artistsApi, person: personsApi, album: albumsApi, organization: organizationsApi, track: tracksApi };
    void readers[kind].get(entityId).then((row) => { if (active){setEntityLabel("name" in row ? row.name : "title" in row ? row.title : `Ficha #${entityId}`);if("albumId" in row)setParentAlbumId(row.albumId);} }).catch(() => undefined);
    return () => { active = false; };
  }, [kind, entityId]);
  const pollingId = plan?.id, pollingStatus = plan?.status, pollingPhase = plan?.phase;
  useEffect(() => {
    if (plan && focusPlan.current) {
      focusPlan.current = false;
      planElement.current?.scrollIntoView({ block: "start", behavior: "instant" });
    }
  }, [plan]);
  useEffect(() => {
    if (!pollingId || (pollingStatus !== "queued" && pollingStatus !== "running" && pollingPhase !== "verifying")) return;
    let active = true, polling = false;
    const timer = window.setInterval(() => {
      if (polling || document.visibilityState !== "visible") return;
      polling = true;
      void aiCurationApi.get(pollingId).then((next) => { if (active) selectPlan(next); }).catch((cause) => { if (active) setError(humanError(cause)); }).finally(() => { polling = false; });
    }, 2000);
    return () => { active = false; window.clearInterval(timer); };
  }, [pollingId, pollingStatus, pollingPhase]);

  async function start(requestInstruction = instruction) {
    if (!entityId || actionInFlight.current) return;
    actionInFlight.current = true; setBusy(true); setError(null);
    try { selectPlan(await aiCurationApi.start(kind, entityId, requestInstruction)); }
    catch (cause) { focusPlan.current = false; setError(humanError(cause)); }
    finally { actionInFlight.current = false; setBusy(false); }
  }
  function prepareFinding(finding: VerificationFinding) {
    const request = findingInstruction(finding);
    focusPlan.current = true;
    setInstruction(request);
    void start(request);
  }
  async function decide(operation: CatalogOperation, decision: "accepted" | "rejected") {
    if (!plan?.draft || actionInFlight.current) return;
    actionInFlight.current = true; setBusy(true); setBusyKey(operation.key);
    setOperationErrors((errors) => { const next = { ...errors }; delete next[operation.key]; return next; });
    try {
      let current = plan;
      const original = plan.draft.operations.find((op) => op.key === operation.key);
      if (decision === "accepted" && JSON.stringify(original) !== JSON.stringify(operation)) {
        current = await aiCurationApi.save(plan, { ...plan.draft, operations: plan.draft.operations.map((op) => op.key === operation.key ? operation : op) }, plan.reviewedKeys);
        setPlan(current);
      }
      const next = await aiCurationApi.decide(current, operation.key, decision);
      setPlan(next); setHistory((rows) => [next, ...rows.filter((row) => row.id !== next.id)]);
      const decided = next.decisions?.[operation.key];
      if (decision === "accepted" && decided?.runId)
        notify("success", "Cambio aplicado.", { action: { label: "Deshacer", onAction: () => setUndo(decided.runId) } });
      else notify("info", "Propuesta rechazada. El dato se conserva.");
    } catch (cause) {
      setOperationErrors((errors) => ({ ...errors, [operation.key]: humanError(cause) }));
      if (cause instanceof ApiError && cause.code === "stale_preview") {
        const latest = await aiCurationApi.get(plan.id).catch(() => null);
        if (latest) setPlan(latest);
      }
    } finally { actionInFlight.current = false; setBusy(false); setBusyKey(null); }
  }
  async function refresh() {
    if (!plan || actionInFlight.current) return;
    actionInFlight.current = true; setBusy(true); setError(null);
    try { const latest = await aiCurationApi.get(plan.id); selectPlan(latest.status === "ready" ? await aiCurationApi.refresh(latest) : latest); }
    catch (cause) { setError(humanError(cause)); }
    finally { actionInFlight.current = false; setBusy(false); }
  }
  async function resumePreparation(){
    if(!plan||actionInFlight.current)return;
    actionInFlight.current=true;setBusy(true);setError(null);
    try{selectPlan(await aiCurationApi.resume(plan.id));}
    catch(cause){setError(humanError(cause));}
    finally{actionInFlight.current=false;setBusy(false);}
  }
  const operations = plan?.draft?.operations ?? [];
  const decisions = plan?.decisions ?? {};
  const remaining = plan?.status === "applied" ? [] : operations.filter((op) => !decisions[op.key]);
  const accepted = Object.values(decisions).filter((decision) => decision.decision === "accepted" && !decision.undone).length;
  const rejected = Object.values(decisions).filter((decision) => decision.decision === "rejected").length;
  const visible = filter === "all" ? operations : remaining;

  return <section className="ai-curation">
    <header className="page-header"><div><h1><Robot size={26} aria-hidden="true" /> Propuestas con IA</h1><p>La IA prepara cada corrección. Tú eliges Sí o No; cada aceptación se aplica al momento.</p></div></header>
    {entityId ? <div className="ai-context"><div><strong>{entityLabel ?? `Ficha #${entityId}`}</strong><span>{KIND_LABELS[kind]}</span></div>{kind!=="track"||parentAlbumId?<Link className="btn btn--sm" to={kind==="track"?`/discos/${parentAlbumId}#pista-${entityId}`:`/${PATHS[kind]}/${entityId}`}>Ver ficha</Link>:null}</div> : null}
    {error ? <p role="alert" className="ai-message ai-message--error">{error}</p> : null}
    {reportError ? <p role="alert">No se pudieron cargar los pendientes de la ficha. {reportError}</p> : null}
    {report ? <VerificationCurationQueue key={`${kind}:${entityId}`} report={report} history={history} disabled={busy || !!running || historyLoading || !vocabulary?.configured} onPrepare={prepareFinding} onSelect={next => { focusPlan.current = true; selectPlan(next); if (next.id === plan?.id) { focusPlan.current = false; planElement.current?.scrollIntoView({ block: "start", behavior: "instant" }); } }} /> : null}
    <details className="ai-request-panel" open={requestOpen} onToggle={(event) => setRequestOpen(event.currentTarget.open)}><summary>{plan ? "Pedir otros cambios o cambiar de ficha" : "Elegir ficha y pedir cambios"}</summary>
      <form className="ai-request" onSubmit={(event) => { event.preventDefault(); void start(); }}>
        <fieldset className="ai-request__entity" disabled={busy || running || historyLoading}>
          <label className="field">Tipo de ficha<select value={kind} onChange={(event) => { setKind(event.target.value as CatalogKind); setEntityId(null); setEntityLabel(null); }}>{Object.entries(KIND_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
          {kind !== "track" ? <EntityPicker key={kind} kind={kind} label="Ficha a revisar" value={entityId} valueLabel={entityLabel ?? (entityId ? `Ficha #${entityId}` : null)} onSelect={(id, label) => { setEntityId(id); setEntityLabel(label); }} /> : null}
          <details className="ai-request-id" open={kind === "track"}><summary>Buscar por ID</summary><label className="field">ID de la ficha<input type="number" min="1" value={entityId ?? ""} onChange={(event) => { setEntityId(Number(event.target.value) || null); setEntityLabel(null); }} /></label></details>
        </fieldset>
        <label className="field">Qué quieres corregir<textarea rows={3} minLength={10} maxLength={6000} required value={instruction} disabled={busy || running || historyLoading} onChange={(event) => setInstruction(event.target.value)} /></label>
        <div className="page-actions"><button type="submit" className="btn btn--primary" disabled={!entityId || busy || running || historyLoading || !vocabulary?.configured}>{running ? "Preparando cambios…" : "Preparar cambios"}</button><span className="hint">Crear fichas, completar datos, combinar textos o fusionar duplicados.</span></div>
        {vocabulary && !vocabulary.configured ? <p role="status">Configura la clave de DeepSeek en el servidor para preparar propuestas.</p> : null}
      </form>
    </details>
    {historyLoading ? <p role="status">Consultando las propuestas de esta ficha…</p> : null}
    {history.length > 1 ? <details className="ai-history-panel"><summary>Otras propuestas ({history.length})</summary><label className="field ai-history">Propuestas guardadas<select value={plan?.id ?? ""} disabled={busy} onChange={(event) => { const next = history.find((row) => row.id === Number(event.target.value)); if (next) selectPlan(next); }}>{history.map((row) => <option key={row.id} value={row.id}>{new Date(row.createdAt).toLocaleString("es-VE", { dateStyle: "medium", timeStyle: "short" })} · {STATUSES[row.status]}</option>)}</select></label></details> : null}
    {plan ? <div className="ai-plan pagination-start" ref={planElement} aria-busy={busy || running}>
      <details className="ai-summary-detail"><summary>Qué se pidió en esta propuesta</summary><p>{plan.instruction}</p></details>
      {running ? <p role="status">{PHASES[plan.phase] ?? "Preparando cambios…"} Puedes salir de la página; la propuesta quedará guardada.</p> : null}
      {plan.error ? <p role="alert">{plan.error}</p> : null}
      {plan.phase==="partial"||plan.status==="failed"?<div role="status"><p>La preparación quedó incompleta. Se conservan los lotes, las fuentes y los cambios obtenidos; puedes continuar las tareas pendientes.</p><button type="button" className="btn" disabled={busy||running} onClick={()=>void resumePreparation()}>Reanudar preparación</button></div>:null}
      {plan.draft && vocabulary ? <>
        <div className="ai-review-heading"><h2>{remaining.length ? `${remaining.length} ${remaining.length === 1 ? "cambio por revisar" : "cambios por revisar"}` : operations.length ? "Revisión terminada" : "Sin cambios preparados"}</h2><p role="status">{accepted || rejected ? `${accepted} aplicados · ${rejected} rechazados` : remaining.length ? "Aceptar modifica el catálogo. Rechazar conserva el dato actual." : plan.status === "applied" ? "Esta propuesta se implementó como lote." : "Consulta las dudas pendientes y las fuentes de esta revisión."}</p></div>
        {operations.length ? <div className="ai-filter" role="group" aria-label="Mostrar propuestas"><button className="btn btn--sm" type="button" aria-pressed={filter === "pending"} onClick={() => setFilter("pending")}>Pendientes ({remaining.length})</button><button className="btn btn--sm" type="button" aria-pressed={filter === "all"} onClick={() => setFilter("all")}>Ver todas ({operations.length})</button>{plan.status === "ready" ? <button type="button" className="btn btn--sm" disabled={busy} onClick={() => void refresh()}>Actualizar cambios</button> : null}</div> : null}
        {!remaining.length && operations.length && filter === "pending" ? <p>Los cambios decididos están en Ver todas. Desde allí puedes consultar o deshacer cada aceptación.</p> : null}
        <div className="ai-operations">{visible.map((operation) => <CatalogProposalCard key={`${plan.id}:${operation.key}`} operation={operation} plan={plan} rootLabel={entityLabel} vocabulary={vocabulary} busy={busy} processing={busyKey === operation.key} error={operationErrors[operation.key]} onDecide={(operation, decision) => void decide(operation, decision)} onUndo={setUndo} />)}</div>
        {plan.draft.unresolved.length ? <details className="ai-pending"><summary>Dudas que la IA no pudo resolver ({plan.draft.unresolved.length})</summary><ul>{plan.draft.unresolved.map((text, index) => <li key={index}>{text}</li>)}</ul></details> : null}
        <details className="ai-summary-detail"><summary>Resumen de la revisión</summary><p className="ai-summary">{plan.draft.summary}</p></details>
        <details className="ai-usage"><summary>Consumo de IA</summary><p>{plan.usage.calls} consultas · {plan.usage.tokensIn.toLocaleString("es")} tokens de entrada · {plan.usage.tokensOut.toLocaleString("es")} de salida.</p><p>Aceptar, rechazar y deshacer no consultan a la IA.</p></details>
        {plan.status === "applied" && plan.runId ? <button className="btn" type="button" onClick={() => setUndo(plan.runId)}>Deshacer el lote anterior</button> : null}
      </> : null}
    </div> : null}
    {undo ? <UndoDialog runId={undo} onClose={() => setUndo(null)} onDone={() => { setUndo(null); if (plan) void aiCurationApi.get(plan.id).then((next) => { setPlan(next); setHistory((rows) => [next, ...rows.filter((row) => row.id !== next.id)]); }).catch((cause) => setError(humanError(cause))); }} /> : null}
  </section>;
}
