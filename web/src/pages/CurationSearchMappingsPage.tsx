// CRV · Curaduría: adjudicación editorial de las correspondencias RYM→CRV
// propuestas en la etapa 2. Aprobar, corregir o rechazar no cambia géneros de
// discos ni artistas: decide qué significa cada término de RYM en CRV.
import { useEffect, useState } from "react";
import { ApiError, searchHumanReviewApi, type MappingAdjudicationState, type MappingRelation, type MappingTerm } from "../lib/api";
import "../styles/curation-emotions.css";

const RELATION: [MappingRelation, string][] = [["equivalence", "Equivalente"], ["specialization", "Más específico"], ["partial", "Coincide en parte"], ["pending", "Sin destino claro"]];
const DECISION = { approved: "Aprobada", corrected: "Corregida", rejected: "Rechazada" } as const;
const relationLabel = (value: string | null) => RELATION.find(([v]) => v === value)?.[1] ?? "—";

export function CurationSearchMappingsPage() {
  const [data, setData] = useState<MappingAdjudicationState>();
  const [selected, setSelected] = useState<string | null>(null);
  const [mode, setMode] = useState<"approved" | "corrected" | "rejected" | "">("");
  const [targetSlug, setTargetSlug] = useState("");
  const [relation, setRelation] = useState<MappingRelation | "">("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  async function load() {
    try { setData(await searchHumanReviewApi.mappings()); setError(null); } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "No se pudieron cargar las correspondencias.");
    }
  }
  useEffect(() => { void load(); }, []);

  const current = data?.terms.find((t) => t.originalTerm === selected) ?? null;
  const genreName = (slug: string | null) => (slug ? data?.genres.find((g) => g.slug === slug)?.name ?? slug : "sin destino");
  function choose(term: MappingTerm) {
    setSelected(term.originalTerm); setMessage(""); setError(null);
    setMode(term.decision?.decision ?? ""); setTargetSlug(term.decision?.targetSlug ?? term.proposal.targetSlug ?? "");
    setRelation(term.decision?.relation ?? term.proposal.relation); setNote(term.decision?.note ?? "");
  }
  async function save() {
    if (!current || !mode) return;
    setSaving(true); setError(null);
    try {
      await searchHumanReviewApi.decideMapping({ term: current.originalTerm, decision: mode,
        targetSlug: mode === "corrected" && relation !== "pending" ? targetSlug || null : null, relation: mode === "corrected" ? relation || null : null, note });
      setMessage(`Decisión guardada para «${current.originalTerm}».`);
      await load();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "No se pudo guardar la decisión.");
    } finally { setSaving(false); }
  }
  const pendingProposal = current?.proposal.relation === "pending";
  const ready = mode === "approved" ? !pendingProposal : mode === "rejected" ? true : mode === "corrected" ? Boolean(relation && (relation === "pending" || targetSlug)) : false;

  return <div className="emotion-review">
    <header className="emotion-review__head">
      <h2>Correspondencias RYM → CRV</h2>
      <p>Cada término de RYM tiene una propuesta del analista. Apruébala, corrígela o recházala. Tu decisión fija el significado del término; no cambia los géneros asignados a discos o artistas ni amplía búsquedas por sí sola.</p>
      {data ? <span className="emotion-review__count">{data.decided} de {data.total} decididas</span> : null}
    </header>
    {error ? <p role="alert" className="emotion-review__error">{error}</p> : null}
    {message ? <p role="status" className="emotion-review__saved">{message}</p> : null}
    {!data ? (error ? null : <p role="status">Cargando correspondencias…</p>) : (
      <div className="emotion-review__workspace">
        <div className="emotion-review__list" aria-label="Términos para decidir">
          {data.terms.map((term) => <button key={term.originalTerm} type="button" className={`emotion-review__item${selected === term.originalTerm ? " is-selected" : ""}`} onClick={() => choose(term)}>
            <strong>{term.originalTerm}</strong>
            <span>{term.decision ? DECISION[term.decision.decision] : `Propuesta: ${relationLabel(term.proposal.relation)} · ${genreName(term.proposal.targetSlug)}`}</span>
          </button>)}
        </div>
        <section className="emotion-review__detail" aria-live="polite">
          {current ? <>
            <h2>{current.originalTerm}</h2>
            <p>Propuesta de {current.proposal.analyst}: <strong>{relationLabel(current.proposal.relation)}</strong> → {genreName(current.proposal.targetSlug)}</p>
            <p className="emotion-review__help">{current.proposal.rationale}</p>
            <label htmlFor="mapping-mode">Tu decisión</label>
            <select id="mapping-mode" value={mode} onChange={(event) => setMode(event.target.value as typeof mode)}>
              <option value="">Elegir</option>
              <option value="approved" disabled={pendingProposal}>Aprobar la propuesta</option>
              <option value="corrected">Corregir</option>
              <option value="rejected">Rechazar</option>
            </select>
            {pendingProposal ? <p className="emotion-review__help">La propuesta no tiene destino: se corrige o se rechaza.</p> : null}
            {mode === "corrected" ? <>
              <label htmlFor="mapping-relation">Relación</label>
              <select id="mapping-relation" value={relation} onChange={(event) => setRelation(event.target.value as MappingRelation | "")}>
                {RELATION.map(([value, name]) => <option key={value} value={value}>{name}</option>)}
              </select>
              {relation !== "pending" ? <>
                <label htmlFor="mapping-target">Género CRV</label>
                <select id="mapping-target" value={targetSlug} onChange={(event) => setTargetSlug(event.target.value)}>
                  <option value="">Elegir género</option>
                  {data.genres.map((genre) => <option key={genre.slug} value={genre.slug}>{genre.name}</option>)}
                </select>
              </> : null}
            </> : null}
            <label htmlFor="mapping-note">Nota opcional</label>
            <textarea id="mapping-note" value={note} onChange={(event) => setNote(event.target.value)} maxLength={1000} rows={3} placeholder="Por qué" />
            <div className="emotion-review__actions">
              <button className="btn btn--primary" type="button" disabled={!ready || saving} onClick={() => void save()}>{saving ? "Guardando…" : "Guardar decisión"}</button>
            </div>
            {current.decision ? <small>Última decisión: {current.decision.decidedBy} · {new Date(current.decision.decidedAt).toLocaleDateString("es-VE")}</small> : null}
          </> : <p>Elige un término de la lista para ver la propuesta y decidir.</p>}
        </section>
      </div>
    )}
  </div>;
}
