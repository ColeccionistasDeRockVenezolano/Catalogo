import { useState } from "react";
import { Link } from "react-router-dom";
import { ApiError, searchApi } from "../lib/api";
import { useAsync } from "../lib/useAsync";
import { useToast } from "../lib/ToastContext";
import { ErrorState } from "./StateViews";
import { RowsSkeleton } from "./Skeletons";

type Laya = Awaited<ReturnType<typeof searchApi.laya>>;
type Evaluation = Laya["evaluations"][number];

const tasks: Record<string, string> = {
  query_interpretation: "Interpretación de consultas",
  evidence_typed_decision: "Decisiones sobre evidencia",
  claim_extraction: "Extracción de citas",
};
const systems: Record<string, string> = { legacy: "Reglas heredadas", rules: "Reglas nuevas sin modelo", base: "Laya base", tuned: "Laya ajustada" };

function fmt(value: unknown): string {
  if (typeof value !== "number") return "—";
  return Math.abs(value) <= 1 && !Number.isInteger(value) ? value.toFixed(3) : String(Math.round(value * 10) / 10);
}

/** Etapa 3: evaluaciones de Laya por tarea y registro de activaciones (atribuido y reversible). */
export function LayaEvaluation() {
  const { data, loading, error, reload } = useAsync(signal => searchApi.laya(signal), []);
  if (loading && !data) return <RowsSkeleton rows={4} label="Cargando evaluaciones…" />;
  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (!data) return null;
  const active = new Map(data.active.map(row => [row.task, row]));
  return (
    <div className="search-admin__rules">
      <section className="search-admin__block">
        <h3>Reglas</h3>
        <p>{data.criteria.authority}</p>
        <p>{data.criteria.activation}</p>
        <p>Criterios {data.criteria.version}. Los umbrales se fijaron antes de medir y no se relajan; un fallo exige otra versión con otra prueba reservada.</p>
      </section>
      {Object.entries(tasks).map(([task, label]) => {
        const rows = data.evaluations.filter(e => e.task === task);
        const current = active.get(task);
        return (
          <section key={task} className="search-admin__block">
            <h3>{label}</h3>
            <p>{current ? <>Activo: <strong>{current.model_id}</strong> desde {new Date(current.created_at).toLocaleString("es")} por {current.actor} (run {current.run_id}).</> : "Sin modelo activo para esta tarea."}</p>
            {!rows.length ? <p>Aún no hay evaluaciones registradas.</p> : rows.map(e => <EvaluationCard key={e.path} evaluation={e} isActive={current?.model_id === e.modelId} onChanged={reload} />)}
          </section>
        );
      })}
      <section className="search-admin__block">
        <h3>Historial de activaciones</h3>
        {!data.history.length ? <p>Sin activaciones registradas.</p> : (
          <div className="search-admin__table" role="region" aria-label="Historial de activaciones" tabIndex={0}>
            <table><thead><tr><th>Fecha</th><th>Tarea</th><th>Acción</th><th>Modelo</th><th>Persona</th><th>Motivo</th><th>Run</th></tr></thead>
              <tbody>{data.history.map(h => <tr key={h.id}><td>{new Date(h.created_at).toLocaleString("es")}</td><td>{tasks[h.task] ?? h.task}</td>
                <td>{h.action === "activate" ? "Activar" : "Desactivar"}</td><td>{h.model_id}</td><td>{h.actor}</td><td>{h.reason}</td><td>{h.run_id}</td></tr>)}</tbody></table>
          </div>
        )}
        <p><Link to="/historial">Abrir historial y deshacer</Link></p>
      </section>
    </div>
  );
}

function EvaluationCard({ evaluation: e, isActive, onChanged }: { evaluation: Evaluation; isActive: boolean; onChanged: () => void }) {
  const toast = useToast();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const metricNames = [...new Set(e.comparison.flatMap(row => Object.keys(row).filter(k => k !== "system" && typeof row[k] === "number")))];
  async function act(action: "activate" | "deactivate") {
    setBusy(true);
    try {
      await searchApi.layaActivation({ task: e.task, modelId: e.modelId, action, reason });
      toast.notify("success", action === "activate" ? "Modelo activado." : "Modelo desactivado.");
      setReason("");
      onChanged();
    } catch (err) {
      toast.notify("error", err instanceof ApiError ? err.message : "No se pudo registrar la activación.");
    } finally { setBusy(false); }
  }
  return (
    <article className="search-admin__block">
      <h4>{e.modelId} · {e.passed ? "cumple los criterios" : "no cumple los criterios"}</h4>
      <p>Evaluada el {new Date(e.evaluatedAt).toLocaleString("es")} · prueba reservada usada {e.reservedTestRuns} vez/veces · base {e.card.baseRevision.slice(0, 10)}
        {e.card.weightsSha256 ? <> · pesos {e.card.weightsSha256.slice(0, 12)}</> : null}{e.card.bestEpoch ? <> · época {String(e.card.bestEpoch)}</> : null}</p>
      <div className="search-admin__table" role="region" aria-label={`Umbrales de ${e.modelId}`} tabIndex={0}>
        <table><thead><tr><th>Criterio</th><th>Valor</th><th>Umbral</th><th>Resultado</th></tr></thead>
          <tbody>{e.checks.map(c => <tr key={c.name}><td>{c.name}</td><td>{fmt(c.value)}</td><td>{c.threshold}</td><td>{c.pass ? "Cumple" : "No cumple"}</td></tr>)}</tbody></table>
      </div>
      {!!e.comparison.length && <div className="search-admin__table" role="region" aria-label={`Comparación de ${e.modelId}`} tabIndex={0}>
        <table><thead><tr><th>Sistema</th>{metricNames.map(m => <th key={m}>{m}</th>)}</tr></thead>
          <tbody>{e.comparison.map(row => <tr key={String(row.system)}><td>{systems[String(row.system)] ?? String(row.system)}</td>{metricNames.map(m => <td key={m}>{fmt(row[m])}</td>)}</tr>)}</tbody></table>
      </div>}
      {!!e.notes.length && <ul>{e.notes.map(n => <li key={n}>{n}</li>)}</ul>}
      <p>Conjuntos: {Object.entries(e.datasets).map(([k, d]) => `${k} (${d.cases}, ${d.sha256.slice(0, 10)})`).join(" · ")}. Evaluación {e.path} · {e.sha256.slice(0, 12)}.</p>
      {(e.passed || isActive) && <div className="search-admin__links">
        <label htmlFor={`reason-${e.path}`}>Motivo</label>
        <input id={`reason-${e.path}`} className="search-admin__filter" value={reason} onChange={ev => setReason(ev.target.value)} maxLength={1000} />
        {isActive
          ? <button type="button" className="btn btn--sm" disabled={busy || reason.trim().length < 3} onClick={() => void act("deactivate")}>Desactivar</button>
          : <button type="button" className="btn btn--sm" disabled={busy || reason.trim().length < 3} onClick={() => void act("activate")}>Activar</button>}
      </div>}
    </article>
  );
}
