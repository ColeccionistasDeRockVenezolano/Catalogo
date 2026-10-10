import { PersonComparisonDetails } from "./PersonComparisonDetails";
import { PersonIdentitySignals } from "./PersonIdentitySignals";
import { useEffect, useState } from "react";
import { reviewApi } from "../lib/api";
import type { PersonPairResearch } from "../lib/types";
import { IDENTITY_RECOMMENDATION, personIdentityAssessment, formatIdentityPoints } from "../lib/personIdentityAssessment";

const VERDICT: Record<PersonPairResearch["verdict"], string> = {
  same: "Podrían ser la misma persona",
  different: "Podrían ser personas distintas",
  mixed: "Una ficha podría estar mezclada",
  unknown: "Sin conclusión comprobada",
};

/** Investigación accesible desde las pantallas donde se decide un duplicado. */
export function PersonPairWebResearch({ aId, bId, reviewId, catalogScore = null, onResearch, onResult, className, autoLoad = true, onConsiderMerge, onDeclareDistinct, showTotalScore = true, autoExpandSaved = true }: {
  aId: number; bId: number; reviewId?: number; catalogScore?: number | null; onResearch?: () => void; onResult?: (result: PersonPairResearch | null) => void; className?: string; autoLoad?: boolean;
  onConsiderMerge?: () => void; onDeclareDistinct?: () => void; /** La tarjeta ya muestra el único total. */ showTotalScore?: boolean; autoExpandSaved?: boolean;
}) {
  const [result, setResult] = useState<PersonPairResearch | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [jobId, setJobId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { onResult?.(result); }, [result, onResult]);

  useEffect(() => {
    let active = true;
    setResult(null); setOpen(false); setError(null); setJobId(null); setBusy(false);
    if (autoLoad) void Promise.all([
      reviewApi.personPairResearch(aId, bId),
      reviewApi.activePersonPairJob(aId, bId),
    ]).then(([saved, job]) => {
      if (!active) return;
      if (saved) { setResult(saved); setOpen(autoExpandSaved); }
      if (job) { setJobId(job.id); setBusy(true); setOpen(true); }
    }).catch((cause: unknown) => { if (active) setError(cause instanceof Error ? cause.message : String(cause)); });
    return () => { active = false; };
  }, [aId, bId, reviewId, autoLoad, autoExpandSaved]);

  useEffect(() => {
    if (jobId === null) return;
    let active = true;
    let polling = false;
    const poll = async () => {
      if (polling) return;
      polling = true;
      try {
        const job = await reviewApi.personResearchJob(jobId);
        if (!active || job.status === "queued" || job.status === "running") return;
        if (job.status === "failed") { setJobId(null); setBusy(false); setError(job.error ?? "No se pudo completar la investigación."); return; }
        const saved = await reviewApi.personPairResearch(aId, bId);
        if (active) { setResult(saved); setOpen(true); setJobId(null); setBusy(false); onResearch?.(); }
      } catch (cause) {
        if (active) { setJobId(null); setBusy(false); setError(cause instanceof Error ? cause.message : String(cause)); }
      } finally { polling = false; }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 2500);
    return () => { active = false; window.clearInterval(timer); };
  }, [jobId, aId, bId, onResearch]);

  async function investigate() {
    setBusy(true);
    setError(null);
    setOpen(true);
    try {
      const job = await reviewApi.startPersonPairResearch(aId, bId);
      setJobId(job.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setBusy(false);
    }
  }

  async function openOrInvestigate() {
    setBusy(true); setError(null);
    try {
      const [saved, activeJob] = await Promise.all([
        reviewApi.personPairResearch(aId, bId), reviewApi.activePersonPairJob(aId, bId),
      ]);
      if (saved) { setResult(saved); setOpen(true); }
      if (activeJob) { setJobId(activeJob.id); setBusy(true); setOpen(true); return; }
      if (saved) { setBusy(false); return; }
      await investigate();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause)); setBusy(false);
    }
  }

  const effectiveCatalogScore = result?.baseScore !== undefined ? result.baseScore : catalogScore;
  const assessment = result ? personIdentityAssessment(effectiveCatalogScore, result, result.scoreBlocked ?? null) : null;
  return <div className={`person-research${className ? ` ${className}` : ""}`}>
    <button type="button" className="btn btn--sm btn--outline" disabled={busy}
      onClick={() => result ? setOpen((value) => !value) : void openOrInvestigate()}>
      {busy ? "Investigando en segundo plano…" : result ? open ? "Ocultar investigación" : "Ver investigación guardada" : "Investigar ambas fichas en internet"}
    </button>
    {error ? <p role="alert">{error}</p> : null}
    {busy ? <p role="status">La búsqueda continúa aunque salgas de esta ficha. Puedes volver más tarde para consultar el resultado.</p> : null}
    {open && result ? <div className="person-research__result">
      {showTotalScore ? <h3 className="person-research__verdict">{result.declaredDistinct ? "Confirmadas como personas distintas" : VERDICT[result.comparison?.conclusion ?? result.verdict]}</h3> : null}
      {showTotalScore && assessment?.score !== null && assessment?.score !== undefined ? <p>
        <strong className="person-research__score">Puntaje de coincidencia: {formatIdentityPoints(assessment.score * 100)}/100</strong>.
      </p> : null}
      {showTotalScore && assessment ? <p className="person-research__recommendation"><strong>{IDENTITY_RECOMMENDATION[assessment.recommendation]}.</strong> {assessment.explanation}</p> : null}
      {showTotalScore && assessment ? <div className="person-research__signals">
        <h3>Señales que componen el puntaje</h3>
        <PersonIdentitySignals signals={assessment.signals} score={assessment.score} />
        {result.comparison ? <PersonComparisonDetails comparison={result.comparison} score={assessment?.score ?? null} /> : null}
      </div> : null}
      {showTotalScore ? <p><strong>Por qué:</strong> {result.comparison?.rationale ?? result.rationale}</p> : null}
      {(!result.comparison || (!result.comparison.a.evidence.length && !result.comparison.b.evidence.length)) && result.evidence.length ? <ul className="person-research__evidence">{result.evidence.map((item, index) => <li key={`${item.url}-${index}`}>
        <blockquote>«{item.quote}»</blockquote> <a href={item.url} target="_blank" rel="noopener noreferrer">{item.title || "Fuente"}</a>
      </li>)}</ul> : !result.comparison ? <p>No hay citas extraídas; revisa las páginas usadas antes de decidir.</p> : null}
      {!result.evidence.length && result.sources.length ? <ul>{result.sources.slice(0, 8).map((source) => <li key={source.url}>
        <a href={source.url} target="_blank" rel="noopener noreferrer">{source.title || source.url}</a>
      </li>)}</ul> : null}
      {result.createdAt ? <p>Investigación guardada: {new Date(result.createdAt).toLocaleString("es-VE")}.</p> : null}
      <p className="person-research__caveat">Es una propuesta para revisar. Investigar no fusiona ni separa las fichas.</p>
      {assessment?.recommendation === "consider_merge" && onConsiderMerge ? <button type="button" className="btn btn--sm btn--primary" onClick={onConsiderMerge}>
        Comparar para fusionar
      </button> : null}
      {assessment?.recommendation === "do_not_merge" && !result.declaredDistinct && onDeclareDistinct ? <button type="button" className="btn btn--sm btn--outline" onClick={onDeclareDistinct}>
        Confirmar que son distintas…
      </button> : null}
      <button type="button" className="btn btn--sm btn--outline" disabled={busy} onClick={() => void investigate()}>
        Actualizar investigación
      </button>
    </div> : null}
  </div>;
}
