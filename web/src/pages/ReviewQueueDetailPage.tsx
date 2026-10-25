import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ReviewIdentityComparison } from "../components/ReviewIdentityComparison";
import { BackLink } from "../components/BackLink";
import { reviewApi } from "../lib/api";
import { useAsync } from "../lib/useAsync";
import { useOperator } from "../lib/OperatorContext";
import { ErrorState } from "../components/StateViews";
import { HeaderSkeleton, RowsSkeleton } from "../components/Skeletons";
import { entityHref } from "../lib/routes";
import { reviewKindLabel, reviewStatusLabel } from "../lib/labels";
import { ReviewDecisionActions, ReviewEvidenceList, ReviewValueComparison } from "../components/ReviewDecision";
import type { PersonWebVerification } from "../lib/types";
import { PersonComparisonDetails } from "../components/PersonComparisonDetails";
import { IDENTITY_RECOMMENDATION, personIdentityAssessment } from "../lib/personIdentityAssessment";

const ENTITY_LINKS: ReadonlyArray<{ key: keyof ReturnType<typeof entityRefs>; type: "artist" | "person" | "organization" | "album" | "track"; label: string }> = [
  { key: "artistAId", type: "artist", label: "Artista A" },
  { key: "artistBId", type: "artist", label: "Artista B" },
  { key: "personAId", type: "person", label: "Persona A" },
  { key: "personBId", type: "person", label: "Persona B" },
  { key: "organizationAId", type: "organization", label: "Organización A" },
  { key: "organizationBId", type: "organization", label: "Organización B" },
  { key: "albumId", type: "album", label: "Disco" },
  { key: "trackId", type: "track", label: "Pista" },
];

function entityRefs(detail: NonNullable<ReturnType<typeof useReviewDetail>["data"]>) {
  return {
    artistAId: detail.artistAId, artistBId: detail.artistBId, personAId: detail.personAId, personBId: detail.personBId,
    organizationAId: detail.organizationAId, organizationBId: detail.organizationBId, albumId: detail.albumId, trackId: detail.trackId,
  };
}

function useReviewDetail(id: number) {
  return useAsync(() => reviewApi.get(id), [id]);
}

function displayValue(value: unknown): string {
  return JSON.stringify(value, null, 2) ?? "Sin valor";
}

const WEB_VERDICT_LABEL: Record<PersonWebVerification["verdict"], string> = {
  same: "Podrían ser la misma persona", different: "Podrían ser personas distintas",
  mixed: "Alguna ficha podría estar mezclada", unknown: "Sin conclusión",
};

function WebVerification({ reviewId, personAId, personBId, isAdmin }: { reviewId: number; personAId: number; personBId: number; isAdmin: boolean }) {
  const [result, setResult] = useState<PersonWebVerification | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState("");
  useEffect(() => {
    let active = true;
    reviewApi.webVerification(reviewId).then((value) => { if (active) setResult(value); })
      .catch((cause: unknown) => { if (active) setError(cause instanceof Error ? cause.message : String(cause)); });
    return () => { active = false; };
  }, [reviewId]);
  const run = async (action: () => Promise<PersonWebVerification>) => {
    setBusy(true); setError(null);
    try { setResult(await action()); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  };
  const assessment = result ? personIdentityAssessment(null, result) : null;
  return <section className="section" aria-label="Verificación web de identidad">
    <h2>Verificación web</h2>
    <p>La investigación propone una interpretación de las fuentes. La decisión sobre las fichas sigue siendo tuya.</p>
    {error ? <p role="alert">{error}</p> : null}
    {isAdmin ? <button type="button" className="btn btn--outline" disabled={busy} onClick={() => run(() => reviewApi.investigateWeb(reviewId))}>
      {busy ? "Investigando…" : result ? "Actualizar investigación" : "Investigar en internet"}
    </button> : null}
    {result ? <div className="evidence-card" style={{ marginTop: 16 }}>
      <div className="evidence-card__header"><strong>{WEB_VERDICT_LABEL[result.comparison?.conclusion ?? result.verdict]}</strong><span className="badge">{result.status === "reviewed" ? "Leída" : "Pendiente"}</span></div>
      {assessment ? <p><strong>Recomendación: {IDENTITY_RECOMMENDATION[assessment.recommendation]}.</strong> {assessment.explanation}</p> : null}
      <p>{result.comparison?.rationale ?? result.rationale}</p>
      {result.comparison ? <PersonComparisonDetails comparison={result.comparison} score={assessment?.score ?? null} /> : null}
      {result.evidence.length ? <ul>{result.evidence.map((item, index) => <li key={`${item.url}-${index}`}>
        <blockquote>«{item.quote}»</blockquote>
        <a href={item.url} target="_blank" rel="noopener noreferrer">{item.title || new URL(item.url).hostname}</a>
      </li>)}</ul> : <p>No se encontraron citas verificables.</p>}
      {result.status === "proposed" && isAdmin ? <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
        <input aria-label="Nota de revisión" value={note} onChange={(event) => setNote(event.target.value)} placeholder="Qué concluyes de estas pruebas" />
        <button type="button" className="btn btn--primary" disabled={busy || !note.trim()} onClick={() => run(() => reviewApi.markWebReviewed(reviewId, note.trim()))}>Marcar como leída</button>
      </div> : null}
      {result.reviewNote ? <p>Revisada por {result.reviewedBy}: {result.reviewNote}</p> : null}
      <p><Link to={`/curaduria/duplicados?a=${personAId}&b=${personBId}`}>Comparar las fichas y decidir en Posibles duplicados</Link></p>
    </div> : null}
  </section>;
}

export function ReviewQueueDetailPage() {
  const { id } = useParams();
  const reviewId = Number(id);
  const navigate = useNavigate();
  const { isAdmin } = useOperator();
  const { data: review, loading, error, reload } = useReviewDetail(reviewId);

  if (loading) return (
    <div role="status" aria-label="Cargando la revisión…">
      <HeaderSkeleton />
      <RowsSkeleton rows={3} height={96} />
    </div>
  );
  if (error || !review) return <ErrorState message={error ?? "Revisión no encontrada."} onRetry={reload} />;

  const refs = entityRefs(review);

  return (
    <>
      <BackLink fallback="/curaduria" />

      <div className="page-header">
        <div>
          <p className="page-kicker">Revisión #{review.id}</p>
          <h1>{reviewKindLabel(review.kind)}</h1>
          <p className="page-lead">Prioridad {review.priority} · creada el {new Date(review.createdAt).toLocaleString("es-VE")}</p>
        </div>
        <span className="badge">{reviewStatusLabel(review.status)}</span>
      </div>

      {review.notes ? <p style={{ color: "var(--text-muted)" }}>{review.notes}</p> : null}

      <ReviewIdentityComparison context={review.identityContext} />
      <ReviewValueComparison payload={review.payload} />

      {(refs.artistAId || refs.artistBId || refs.personAId || refs.personBId || refs.organizationAId || refs.organizationBId || refs.albumId || refs.trackId) ? (
        <div className="section">
          <h2>Entidades relacionadas</h2>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {ENTITY_LINKS.filter((link) => refs[link.key] !== null).map((link) => (
              <Link key={link.key} to={entityHref(link.type, refs[link.key] as number, refs.albumId ?? undefined)} className="badge badge--outline">
                {link.label}: #{refs[link.key]}
              </Link>
            ))}
          </div>
        </div>
      ) : null}

      <div className="section">
        <h2>Evidencia de origen</h2>
        <ReviewEvidenceList claims={review.claims} />
        <h3 className="payload-title">Payload completo</h3>
        <div className="evidence-block">{displayValue(review.payload)}</div>
      </div>

      {review.personAId && review.personBId && ["person_duplicate", "possible_duplicate", "person_match"].includes(review.kind)
        ? <WebVerification reviewId={review.id} personAId={review.personAId} personBId={review.personBId} isAdmin={isAdmin} /> : null}

      {review.resolvedAt ? (
        <div className="section">
          <h2>Resolución</h2>
          <p style={{ color: "var(--text-muted)", fontSize: 13.5 }}>
            {review.resolvedBy} · {new Date(review.resolvedAt).toLocaleString("es-VE")}
            {review.resolutionNote ? ` — ${review.resolutionNote}` : ""}
          </p>
        </div>
      ) : null}

      <ReviewDecisionActions review={review} isAdmin={isAdmin} onDone={() => navigate("/curaduria")} />
    </>
  );
}
