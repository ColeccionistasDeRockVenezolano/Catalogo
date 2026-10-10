import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { aiCurationApi } from "../lib/api";
import type { PersonArtistJob } from "../../../src/curation/ai/person-artist-types";

const PHASE: Record<string, string> = {
  identity: "Comprobando la identidad con IA…",
  sources: "Consultando las fuentes del informe…",
  linking: "Creando el vínculo con el artista…",
  researching_artist: "Buscando información del artista…",
  researching_person: "Actualizando el informe de la persona…",
};
const ACTION: Record<string, string> = {
  created: "Artista creado y vinculado",
  linked: "Artista existente vinculado",
  already_linked: "El artista ya estaba vinculado",
  conflict: "Conflicto de identidad",
  not_solo: "No se confirmó una carrera solista",
  unresolved: "Identidad pendiente",
};
export function PersonArtistResolution({
  personId,
  disabled,
  onChanged,
}: {
  personId: number;
  disabled: boolean;
  onChanged: () => void;
}) {
  const [job, setJob] = useState<PersonArtistJob | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const changed = useRef(onChanged);
  changed.current = onChanged;
  const active = job?.status === "queued" || job?.status === "running";
  useEffect(() => {
    let mounted = true;
    setJob(null);
    setError(null);
    void aiCurationApi
      .artistResolution(personId)
      .then((j) => {
        if (mounted) setJob(j);
      })
      .catch((cause) => {
        if (mounted)
          setError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => {
      mounted = false;
    };
  }, [personId]);
  useEffect(() => {
    if (!active) return;
    let mounted = true,
      polling = false;
    const poll = async () => {
      if (polling) return;
      polling = true;
      try {
        const latest = await aiCurationApi.artistResolution(personId);
        if (!mounted || !latest) return;
        setJob(latest);
        setError(null);
        if (latest.status === "done" || latest.status === "failed")
          changed.current();
      } catch (cause) {
        if (mounted)
          setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        polling = false;
      }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 2500);
    return () => {
      mounted = false;
      window.clearInterval(timer);
    };
  }, [personId, active]);
  async function start() {
    setStarting(true);
    setError(null);
    try {
      setJob(await aiCurationApi.resolveArtist(personId));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setStarting(false);
    }
  }
  const result = job?.result;
  return (
    <div className="person-artist-resolution">
      <button
        type="button"
        className="btn"
        disabled={disabled || starting || active}
        onClick={() => void start()}
      >
        {starting || active
          ? "Resolución en curso…"
          : "Resolver artista y buscar información con IA"}
      </button>
      <p className="entity-verification__muted">
        Comprueba nombres, alias y vínculos. Si hay evidencia suficiente,
        vincula el solista existente o lo crea y busca sus datos. Los conflictos
        quedan pendientes.
      </p>
      {active ? (
        <p role="status" aria-live="polite">
          {PHASE[job?.phase ?? "identity"] ?? "Resolución en curso…"} Puedes
          salir de la ficha; el trabajo queda guardado.
        </p>
      ) : null}
      {error || job?.status === "failed" ? (
        <p role="alert">{error ?? job?.error} Puedes volver a intentarlo.</p>
      ) : null}
      {result ? (
        <div aria-live="polite">
          <p>
            <strong>{ACTION[result.action]}</strong>
            {result.artistId ? (
              <>
                {" "}
                ·{" "}
                <Link to={`/artistas/${result.artistId}`}>
                  {result.stageName}
                </Link>
              </>
            ) : null}
          </p>
          <p>{result.explanation}</p>
          {result.conflicts.length ? (
            <ul>
              {result.conflicts.map((item, i) => (
                <li key={i}>{item}</li>
              ))}
            </ul>
          ) : null}
          {result.candidates.length && result.action === "conflict" ? (
            <p>
              Candidatos:{" "}
              {result.candidates.map((candidate, i) => (
                <span key={candidate.id}>
                  {i ? ", " : ""}
                  <Link to={`/artistas/${candidate.id}`}>{candidate.name}</Link>
                </span>
              ))}
            </p>
          ) : null}
          {result.pending.length ? (
            <details>
              <summary>Datos pendientes ({result.pending.length})</summary>
              <ul>
                {result.pending.map((item, i) => (
                  <li key={i}>{item}</li>
                ))}
              </ul>
            </details>
          ) : null}
          {result.evidence.length ? (
            <details>
              <summary>
                Fuentes de la identidad ({result.evidence.length})
              </summary>
              {result.evidence.map((e) => (
                <blockquote key={e.id}>
                  <p>{e.quote}</p>
                  <a href={e.url} target="_blank" rel="noopener noreferrer">
                    {e.label || e.url}
                  </a>
                </blockquote>
              ))}
            </details>
          ) : null}
          {result.runId ? (
            <Link to="/historial">
              Ver cambios registrados (#{result.runId})
            </Link>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
