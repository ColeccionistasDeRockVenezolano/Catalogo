// CRV · Posibles duplicados de persona (E11.6; plan P10).
//
// La página donde el detector (E11.5) deja sus propuestas: cada tarjeta lleva
// a comparar y fusionar (modal, E11.6) o a decir «son distintas», que el
// detector recuerda para no volver a proponer el par.
//
// El score del detector no es una probabilidad: es la SUMA de los pesos de las
// señales encontradas, con tope en 1 (src/review/person-candidates.ts). Aquí se
// muestra en puntos sobre 100 y con su desglose, para que el número se pueda
// leer sin conocer el código.
import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ArrowSquareOut, CaretDown, CaretUp, GitMerge, Info, X } from "@phosphor-icons/react";
import { ApiError, entityMergeApi, reviewApi } from "../lib/api";
import { useAsync } from "../lib/useAsync";
import { useToast } from "../lib/ToastContext";
import { ErrorState, EmptyState } from "../components/StateViews";
import { RowsSkeleton } from "../components/Skeletons";
import { Pagination } from "../components/Pagination";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { MergeEntityModal } from "../components/MergeEntityModal";
import { PersonPairWebResearch } from "../components/PersonPairWebResearch";
import { PersonComparisonDetails } from "../components/PersonComparisonDetails";
import { IDENTITY_RECOMMENDATION, personIdentityAssessment, formatIdentityPoints, type PersonComparison } from "../lib/personIdentityAssessment";
import { PersonIdentitySignals } from "../components/PersonIdentitySignals";
import type { PersonPairResearch, PersonDuplicateCandidate } from "../lib/types";

const LIMIT = 30;
/** Umbrales del detector (PERSON_CANDIDATE_MIN_SCORE / _STRONG_SCORE), en puntos. */
const STRONG_POINTS = 70;

function levelOf(points: number): { label: string; tone: "high" | "medium" } {
  return points >= STRONG_POINTS ? { label: "Coincidencia alta", tone: "high" } : { label: "Conexión documentada", tone: "medium" };
}

function plural(count: number, singular: string, pluralForm: string): string {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

interface CandidatePair {
  comparison: PersonComparison | null;
  advice?: string;
  reviewId: number;
  a: PersonDuplicateCandidate["a"];
  b: PersonDuplicateCandidate["b"];
  score: number | null;
  scoreBlocked: string | null;
  webVerdict: PersonDuplicateCandidate["webVerdict"];
  webEvidence: PersonDuplicateCandidate["webEvidence"];
}

export function PersonDuplicatesPage() {
  const paginationStartRef = useRef<HTMLDivElement>(null);
  const { notify } = useToast();
  const [params] = useSearchParams();
  const [offset, setOffset] = useState(0);
  const [onlyStrong, setOnlyStrong] = useState(false);
  const [merging, setMerging] = useState<CandidatePair | null>(null);
  const [dismissing, setDismissing] = useState<CandidatePair | null>(null);
  const [busyPriority, setBusyPriority] = useState<number | null>(null);
  const highlightedRef = useRef<HTMLLIElement>(null);

  const { data, loading, error, reload } = useAsync(
    () => entityMergeApi.duplicateCandidates({
      limit: LIMIT, offset, ...(onlyStrong ? { minScore: STRONG_POINTS / 100 } : {}),
    }),
    [offset, onlyStrong],
  );

  const setFilter = (strong: boolean) => { setOnlyStrong(strong); setOffset(0); };

  // Un par precargado (PLAN_CURADURIA E7.3): un `possible_duplicate` de otra
  // revisión que resultó ser el mismo par que el detector nuevo ya propone.
  // Sin orden fijo: A/B llegan como los guardó la revisión vieja.
  const highlightA = Number(params.get("a") ?? "") || undefined;
  const highlightB = Number(params.get("b") ?? "") || undefined;
  const isHighlighted = (a: number, b: number) =>
    highlightA !== undefined && highlightB !== undefined
    && ((a === highlightA && b === highlightB) || (a === highlightB && b === highlightA));

  useEffect(() => {
    if (highlightA === undefined || !data) return;
    highlightedRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [data, highlightA]);

  /**
   * El orden de la cola (1-10, mayor = antes) no lo decide el detector: aquí
   * el operador lo ajusta a mano cuando un par urge más que otros.
   */
  async function changePriority(reviewId: number, next: number) {
    if (next < 1 || next > 10) return;
    setBusyPriority(reviewId);
    try {
      await reviewApi.setPriority(reviewId, next, "Reordenado desde posibles duplicados");
      reload();
    } catch (err) {
      notify("error", err instanceof ApiError ? err.message : "No se pudo cambiar la prioridad.");
    } finally {
      setBusyPriority(null);
    }
  }

  return (
    <>
      <header className="page-header"><div><h2>Posibles duplicados</h2><p>Revisa cada par y decide si debe conservarse una sola ficha.</p></div></header>
      <p className="curation-lead">
        Compara los nombres y la trayectoria. Consulta las evidencias cuando tengas dudas; al fusionar podrás elegir los datos que se conservan.
      </p>

      <ScoreGuide />

      <div className="list-toolbar">
        <div className="segmented" role="group" aria-label="Filtrar por coincidencia">
          <button type="button" className="segmented__option" aria-pressed={!onlyStrong} onClick={() => setFilter(false)}>
            Todos
          </button>
          <button type="button" className="segmented__option" aria-pressed={onlyStrong} onClick={() => setFilter(true)}>
            Coincidencia alta <span className="segmented__range">{STRONG_POINTS}–100 pts</span>
          </button>
        </div>
        {data && !loading ? (
          <p className="dup-count" aria-live="polite">
            {plural(data.pagination.total, "par pendiente", "pares pendientes")}
          </p>
        ) : null}
      </div>

      <div ref={paginationStartRef} className="pagination-start" />

      {loading && !data ? <RowsSkeleton rows={3} height={180} label="Cargando los pares pendientes…" /> : error ? <ErrorState message={error} onRetry={reload} /> : !data || data.data.length === 0 ? (
        <EmptyState
          title={onlyStrong ? "No hay pares con coincidencia alta" : "No hay posibles duplicados pendientes"}
          hint={onlyStrong ? "Prueba con «Todos» para ver los pares con evidencia parcial." : "El detector no tiene pares nuevos por revisar."}
        />
      ) : (
        <>
          <ol className={`dup-list${loading ? " is-refreshing" : ""}`}>
            {data.data.map((candidate) => {
              const pair = { reviewId: candidate.reviewId, a: candidate.a, b: candidate.b,
                score: candidate.score, scoreBlocked: candidate.scoreBlocked, comparison: candidate.comparison ?? null,
                webVerdict: candidate.webVerdict, webEvidence: candidate.webEvidence };
              const highlighted = isHighlighted(candidate.a.id, candidate.b.id);
              return (
                <li key={candidate.reviewId} ref={highlighted ? highlightedRef : undefined}
                  style={highlighted ? { outline: "2px solid var(--accent, #6d5bd0)", outlineOffset: 4, borderRadius: 12 } : undefined}>
                  <CandidateCard
                    candidate={candidate} onMerge={(advice) => setMerging({ ...pair, advice })} onDismiss={() => setDismissing(pair)}
                    priorityBusy={busyPriority === candidate.reviewId}
                    onPriorityChange={(next) => void changePriority(candidate.reviewId, next)}
                    onResearch={reload}
                  />
                </li>
              );
            })}
          </ol>
          <Pagination scrollTargetRef={paginationStartRef} limit={LIMIT} offset={offset} total={data.pagination.total} onOffsetChange={setOffset} />
        </>
      )}

      {merging ? (
        <MergeEntityModal
          kind="person"
          entityId={merging.a.id}
          entityName={merging.a.name}
          otherId={merging.b.id}
          otherName={merging.b.name}
          identityAdvice={(() => {
            const assessment = personIdentityAssessment(merging.score, merging.webVerdict
              ? { verdict: merging.webVerdict, evidence: merging.webEvidence, comparison: merging.comparison } : null, merging.scoreBlocked, merging.comparison);
            return merging.advice ?? `${IDENTITY_RECOMMENDATION[assessment.recommendation]}. ${assessment.explanation}`;
          })()}
          onMerged={() => { setMerging(null); reload(); }}
          onClose={() => setMerging(null)}
        />
      ) : null}

      {dismissing ? (
        <ConfirmDialog
          title="¿Son personas distintas?"
          description={`«${dismissing.a.name}» y «${dismissing.b.name}» seguirán como dos fichas separadas. La propuesta se cierra y el detector no volverá a sugerir este par. Ninguna ficha se modifica.`}
          confirmLabel="Sí, son personas distintas"
          onConfirm={async (note) => {
            await reviewApi.reject(dismissing.reviewId, note);
            notify("success", "Marcadas como personas distintas; el par no se volverá a proponer.");
            setDismissing(null);
            reload();
          }}
          onClose={() => setDismissing(null)}
        />
      ) : null}
    </>
  );
}

/** Explica qué mide el número antes de que haga falta preguntarlo. */
function ScoreGuide() {
  return (
    <details className="score-guide">
      <summary>
        <Info size={18} weight="bold" aria-hidden="true" />
        <span>¿Cómo se calcula el puntaje de coincidencia?</span>
        <CaretDown className="score-guide__caret" size={16} weight="bold" aria-hidden="true" />
      </summary>
      <div className="score-guide__body">
        <p>El puntaje de coincidencia suma el respaldo comprobado de ambas fichas, de 0 a 100. No es un porcentaje de certeza.</p>
        <ul className="score-guide__levels">
          <li><strong>Nombres y alias:</strong> hasta 20 puntos, evaluados una sola vez.</li>
          <li><strong>Catálogo:</strong> hasta 20 puntos por solapamiento de bandas, discos y fechas conocidas.</li>
          <li><strong>Evidencia web:</strong> hasta 60 puntos por respaldo de cada trayectoria y una prueba que conecte ambas.</li>
        </ul>
        <p>Los puntos son proporcionales a los datos comprobados. Proyecto, disco, año y función se verifican por separado.
          Un dato faltante aporta 0; un resumen del buscador aporta menos que una página leída. Las citas repetidas no añaden puntos.</p>
        <p>«Coincidencia alta» requiere al menos {STRONG_POINTS} puntos y una conexión documental comprobada entre ambas fichas.
          Sin esa conexión, la conclusión queda pendiente. Las contradicciones documentadas impiden recomendar la fusión.</p>
        <p className="score-guide__muted">
          Nunca se proponen pares con fechas de nacimiento o muerte distintas, ni nombres que parecen un estudio, sello o productora.
        </p>
      </div>
    </details>
  );
}

function CandidateCard({ candidate, onMerge, onDismiss, priorityBusy, onPriorityChange, onResearch }: {
  candidate: PersonDuplicateCandidate; onMerge: (advice: string) => void; onDismiss: () => void;
  priorityBusy: boolean; onPriorityChange: (next: number) => void; onResearch: () => void;
}) {
  const [research, setResearch] = useState<PersonPairResearch | null>(null);
  // Al refrescar el catálogo, sus datos actuales sustituyen la copia local de la investigación.
  useEffect(() => { setResearch(null); }, [candidate]);
  const catalogScore = research?.baseScore !== undefined ? research.baseScore : candidate.score;
  const comparison = research?.comparison ?? candidate.comparison ?? null;
  const assessment = personIdentityAssessment(catalogScore, research ?? (candidate.webVerdict
    ? { verdict: candidate.webVerdict, evidence: candidate.webEvidence, comparison } : null),
    research?.scoreBlocked !== undefined ? research.scoreBlocked : candidate.scoreBlocked, comparison);
  const points = assessment.score === null ? null : Math.round(assessment.score * 1000) / 10;
  const level = points !== null && assessment.recommendation === "consider_merge" ? levelOf(points) : null;
  const scoreLabel = level?.label ?? (assessment.recommendation === "do_not_merge" ? "Personas distintas"
    : assessment.recommendation === "review_split" ? "Ficha mezclada" : "Evidencia parcial");
  const titleId = `dup-${candidate.reviewId}`;

  return (
    <article className="dup-card" aria-labelledby={titleId}>
      <h2 className="visually-hidden" id={titleId}>{candidate.a.name} y {candidate.b.name}</h2>

      <div className="dup-card__people">
        <PersonSide person={candidate.a} />
        <span className="dup-card__vs" aria-hidden="true">≈</span>
        <PersonSide person={candidate.b} />
      </div>

      <div className={`dup-score${level ? ` dup-score--${level.tone}` : ""}`}>
        {points === null ? (
          <span className="dup-score__label">Sin puntaje</span>
        ) : (
          <>
            <span className="dup-score__label">{scoreLabel}</span>
            <span className="dup-score__value">
              <strong className="mono">{points === null ? "" : formatIdentityPoints(points)}</strong>
              <span>/ 100 pts</span>
            </span>
            <span
              className="dup-score__bar" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={points}
              aria-label={`${scoreLabel}: ${points} de 100 puntos`}
            >
              <span className="dup-score__fill" style={{ width: `${points}%` }} />
            </span>
          </>
        )}
      </div>

      <p className="dup-card__assessment">
        <strong>{IDENTITY_RECOMMENDATION[assessment.recommendation]}</strong>. {assessment.explanation}
        {comparison?.rationale || research?.rationale || candidate.webRationale ? <span className="dup-card__assessment-reason">Por qué: {comparison?.rationale ?? research?.rationale ?? candidate.webRationale}</span> : null}
      </p>

      <div className="dup-card__signals">
        <details className="dup-evidence-details"><summary>Ver señales y evidencias de este par</summary>
        <h3>Señales que componen el puntaje</h3>
        <PersonIdentitySignals signals={assessment.signals} score={assessment.score} />
        {comparison ? <PersonComparisonDetails comparison={comparison} score={assessment.score} /> : null}
        </details>
        <PersonPairWebResearch aId={candidate.a.id} bId={candidate.b.id} reviewId={candidate.reviewId}
          catalogScore={catalogScore} onResearch={onResearch} onResult={setResearch}
          className="dup-card__research" autoLoad={false} showTotalScore={false} />
      </div>

      <p className="dup-decision-hint">La propuesta con IA y la revisión de fusión permiten revisar los cambios antes de aplicarlos.</p>
      <div className="dup-card__actions">
        <Link className="btn" to={`/curaduria/ia?kind=person&id=${candidate.a.id}&instruction=${encodeURIComponent(`Revisa si las fichas de persona #${candidate.a.id} (${candidate.a.name}) y #${candidate.b.id} (${candidate.b.name}) corresponden a la misma identidad. Consulta ambas fichas y su evidencia. Si está documentado, propone una fusión indicando qué ficha se conserva y los campos que se combinan. Conserva las dudas como pendientes.`)}`}>Preparar propuesta con IA</Link>
        <button type="button" className="btn btn--primary" onClick={() => onMerge(`${IDENTITY_RECOMMENDATION[assessment.recommendation]}. ${assessment.explanation}`)}>
          <GitMerge size={16} weight="bold" aria-hidden="true" />
          Revisar fusión
        </button>
        <button type="button" className="btn btn--outline" onClick={onDismiss}>
          <X size={16} weight="bold" aria-hidden="true" />
          No son la misma persona
        </button>
        <div className="dup-priority" role="group" aria-label="Orden en la cola">
          <span className="dup-priority__label">Prioridad</span>
          <button
            type="button" className="btn btn--sm btn--outline" disabled={priorityBusy || candidate.priority <= 1}
            onClick={() => onPriorityChange(candidate.priority - 1)} aria-label="Bajar prioridad"
          >
            <CaretDown size={13} weight="bold" aria-hidden="true" />
          </button>
          <span className="mono dup-priority__value">{candidate.priority}</span>
          <button
            type="button" className="btn btn--sm btn--outline" disabled={priorityBusy || candidate.priority >= 10}
            onClick={() => onPriorityChange(candidate.priority + 1)} aria-label="Subir prioridad"
          >
            <CaretUp size={13} weight="bold" aria-hidden="true" />
          </button>
        </div>
      </div>
    </article>
  );
}

function PersonSide({ person }: { person: PersonDuplicateCandidate["a"] }) {
  return (
    <div className="dup-person">
      <Link className="text-link dup-person__name" to={`/personas/${person.id}`} target="_blank" rel="noopener">
        <span>{person.name}</span>
        <ArrowSquareOut size={14} weight="bold" aria-hidden="true" />
        <span className="visually-hidden"> (abre la ficha en otra pestaña)</span>
      </Link>
      <span className="dup-person__meta">
        Ficha <span className="mono">#{person.id}</span> · {plural(person.creditCount, "crédito", "créditos")}
      </span>
    </div>
  );
}
