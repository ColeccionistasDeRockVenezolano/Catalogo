// CRV · Espacio de curaduría «Videos de YouTube».
//
// Una sola bandeja para los videos del canal: qué disco trae cada uno (leído
// del título y la descripción), si ya está enlazado, qué revisión de ingesta
// tiene abierta y qué propuesta de IA se preparó para darlo de alta. Desde
// aquí se lanza el análisis y se entra a la propuesta o al disco.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowSquareOut, MagicWand, Robot, YoutubeLogo } from "@phosphor-icons/react";
import { ApiError, youtubeIntakeApi, type YouTubeIntakeRow, type YouTubeIntakeSummary } from "../lib/api";
import { useToast } from "../lib/ToastContext";
import "../styles/youtube-intake.css";

const STATUS_LABEL: Record<string, string> = {
  "sin-analizar": "Sin analizar", pending: "Pendiente", planning: "Preparando", ready: "Propuesta lista",
  review: "En revisión", linked: "Enlazado", failed: "Error", skipped: "Omitido",
};
const FILTERS: Array<{ key: string; label: string }> = [
  { key: "all", label: "Todos" },
  { key: "sin-analizar", label: "Sin analizar" },
  { key: "planning", label: "Preparando" },
  { key: "ready", label: "Propuesta lista" },
  { key: "review", label: "En revisión" },
  { key: "linked", label: "Enlazados" },
];

const humanError = (cause: unknown) => cause instanceof Error ? cause.message : "No se pudo completar la acción.";
const fecha = (value: string | null) => value
  ? new Intl.DateTimeFormat("es-VE", { dateStyle: "medium", timeZone: "America/Caracas" }).format(new Date(value))
  : "sin fecha";

export function YouTubeIntakePage() {
  const [rows, setRows] = useState<YouTubeIntakeRow[]>([]);
  const [summary, setSummary] = useState<YouTubeIntakeSummary | null>(null);
  const [filter, setFilter] = useState("all");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const generation = useRef(0);
  const { notify } = useToast();

  const load = useCallback(async () => {
    const current = ++generation.current;
    try {
      const [nextSummary, nextRows] = await Promise.all([
        youtubeIntakeApi.summary(),
        youtubeIntakeApi.videos(filter === "all" ? undefined : filter, 120),
      ]);
      if (current !== generation.current) return;
      setSummary(nextSummary);
      setRows(nextRows);
      setError(null);
    } catch (cause) {
      if (current === generation.current) setError(cause instanceof ApiError ? cause.message : "No se pudo cargar la bandeja de videos.");
    } finally {
      if (current === generation.current) setLoading(false);
    }
  }, [filter]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, 10_000);
    return () => window.clearInterval(timer);
  }, [load]);

  const counts = useMemo(() => ({
    "sin-analizar": summary?.sinAnalizar ?? 0,
    planning: summary?.planning ?? 0,
    ready: summary?.ready ?? 0,
    review: summary?.review ?? 0,
    linked: summary?.linked ?? 0,
  }), [summary]);

  async function analyze(row: YouTubeIntakeRow) {
    setBusy(`intake:${row.videoDbId}`);
    try {
      const result = await youtubeIntakeApi.intake(row.videoDbId);
      notify("success", result.status === "linked" ? "Disco enlazado." : result.status === "planning" ? "Propuesta en preparación." : "Video revisado.",
        { description: result.reason ?? undefined });
      await load();
    } catch (cause) {
      notify("error", "No se pudo analizar el video.", { description: humanError(cause) });
    } finally { setBusy(null); }
  }

  async function sweep() {
    setBusy("sweep");
    try {
      const result = await youtubeIntakeApi.sweep(4);
      notify("success", `Análisis lanzado para ${result.started} ${result.started === 1 ? "video" : "videos"}.`);
      await load();
    } catch (cause) {
      notify("error", "No se pudo lanzar el análisis.", { description: humanError(cause) });
    } finally { setBusy(null); }
  }

  async function autoApply() {
    setBusy("auto");
    try {
      const result = await youtubeIntakeApi.auto();
      notify("success", `${result.accepted} ${result.accepted === 1 ? "cambio aplicado" : "cambios aplicados"} en ${result.plans} ${result.plans === 1 ? "propuesta" : "propuestas"}.`,
        { description: result.skipped ? `${result.skipped} quedaron para revisión humana.` : undefined });
      await load();
    } catch (cause) {
      notify("error", "No se pudieron aplicar las altas seguras.", { description: humanError(cause) });
    } finally { setBusy(null); }
  }

  return <section className="yt-intake">
    <header className="page-header">
      <div>
        <h1><YoutubeLogo size={26} aria-hidden="true" /> Videos de YouTube</h1>
        <p>Lo que llega al canal y todavía no está en el catálogo. La IA lee el título y la descripción, crea la ficha que falta con lo documentado y deja el disco listo para revisar.</p>
      </div>
      <div className="page-actions">
        <button type="button" className="btn" disabled={busy !== null} onClick={() => void sweep()}>
          <MagicWand size={16} aria-hidden="true" /> {busy === "sweep" ? "Lanzando…" : "Analizar pendientes"}
        </button>
        <button type="button" className="btn btn--primary" disabled={busy !== null} onClick={() => void autoApply()}>
          <Robot size={16} aria-hidden="true" /> {busy === "auto" ? "Aplicando…" : "Aplicar altas seguras"}
        </button>
      </div>
    </header>

    {error ? <p role="alert" className="ai-message ai-message--error">{error}</p> : null}

    <div className="cwork-toolbar">
      <div className="cfilter-chips" role="group" aria-label="Filtrar por estado">
        {FILTERS.map((item) => (
          <button key={item.key} type="button" className="cchip" aria-pressed={filter === item.key}
            onClick={() => { setFilter(item.key); setLoading(true); }}>
            {item.label}
            {item.key !== "all" && counts[item.key as keyof typeof counts] !== undefined
              ? <span className="yt-intake__count">{counts[item.key as keyof typeof counts]}</span> : null}
          </button>
        ))}
      </div>
      <p className="yt-intake__hint">
        {summary ? `${summary.linked} enlazados · ${summary.openReviews} revisiones de ingesta abiertas · ${summary.plansReady} propuestas por revisar` : "Cargando el estado del canal…"}
      </p>
    </div>

    {loading && !rows.length ? <p role="status">Leyendo los videos del canal…</p> : null}
    {!loading && !rows.length ? <p role="status">No hay videos en este estado.</p> : null}

    <ul className="yt-intake__list">
      {rows.map((row) => {
        const parsed = row.artistName && row.albumTitle;
        const canAnalyze = row.isAlbum && (row.status === "sin-analizar" || row.status === "review" || row.status === "failed");
        return <li key={row.videoDbId} className="yt-intake__card">
          {row.thumbnailUrl ? <img className="yt-intake__thumb" src={row.thumbnailUrl} alt="" loading="lazy" width={132} height={74} /> : <span className="yt-intake__thumb" aria-hidden="true" />}
          <div className="yt-intake__body">
            <p className="yt-intake__title">
              <a href={`https://www.youtube.com/watch?v=${row.videoId}`} target="_blank" rel="noreferrer">{row.title} <ArrowSquareOut size={13} aria-hidden="true" /></a>
            </p>
            <p className="yt-intake__meta">
              {parsed ? <><strong>{row.artistName}</strong> — {row.albumTitle}{row.releaseYear ? ` (${row.releaseYear})` : ""} · {row.trackCount} pistas</> : "Todavía no se leyó artista y disco"}
              <span> · publicado {fecha(row.publishedAt)}</span>
            </p>
            {row.reason ? <p className="yt-intake__reason">{row.reason}</p> : null}
            {row.error ? <p className="yt-intake__reason" role="alert">{row.error}</p> : null}
            <p className="yt-intake__actions">
              <span className={`yt-intake__status is-${row.status}`}>{STATUS_LABEL[row.status] ?? row.status}</span>
              {!row.isAlbum && row.status !== "linked" ? <span className="yt-intake__reason">No es un disco (videoclip, concierto o pieza editorial): va a Audiovisuales</span> : null}
              {row.planId && row.artistId ? <Link className="btn btn--sm" to={`/curaduria/ia?kind=artist&id=${row.artistId}`}>Ver propuesta{row.planPending ? ` (${row.planPending})` : ""}</Link> : null}
              {row.enrichPlanId && row.artistId ? <Link className="btn btn--sm" to={`/curaduria/ia?kind=artist&id=${row.artistId}`}>Completar ficha{row.enrichPending ? ` (${row.enrichPending})` : ""}</Link> : null}
              {row.albumId ? <Link className="btn btn--sm" to={`/discos/${row.albumId}`}>Ver disco</Link> : null}
              {row.reviewId ? <Link className="btn btn--sm" to={`/curaduria/revision/${row.reviewId}`}>Revisión</Link> : null}
              {canAnalyze ? <button type="button" className="btn btn--sm btn--primary" disabled={busy !== null} onClick={() => void analyze(row)}>
                {busy === `intake:${row.videoDbId}` ? "Analizando…" : "Analizar con IA"}
              </button> : null}
            </p>
          </div>
        </li>;
      })}
    </ul>
  </section>;
}
