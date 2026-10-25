import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ApiError, emotionCurationApi, type EmotionReviewCategory, type EmotionReviewTag } from "../lib/api";
import "../styles/curation-emotions.css";

const CATEGORIES: { value: EmotionReviewCategory; label: string }[] = [
  { value: "no_expresa_emocion", label: "No expresa emoción" },
  { value: "emocion", label: "Emoción / amor" },
  { value: "tristeza", label: "Tristeza" },
  { value: "enfocado", label: "Enfoque" },
  { value: "libertad", label: "Libertad" },
  { value: "cachonda", label: "Sexo y seducción" },
  { value: "aumenta_mi_aura", label: "Energía y confianza" },
];
const label = (value: string) => CATEGORIES.find((item) => item.value === value)?.label ?? (value === "dudoso" ? "Dudoso" : "Sin clasificar");

export function CurationEmotionsPage() {
  const [params, setParams] = useSearchParams();
  const status = params.get("estado") === "reviewed" ? "reviewed" : params.get("estado") === "all" ? "all" : "pending";
  const query = params.get("q") ?? "";
  const offset = Math.max(0, Number(params.get("desde") || 0) || 0);
  const [search, setSearch] = useState(query);
  const [data, setData] = useState<{ data: EmotionReviewTag[]; total: number; pending: number }>();
  const [selected, setSelected] = useState<string | null>(null);
  const [choice, setChoice] = useState<EmotionReviewCategory | "">("");
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  async function load() {
    setLoading(true);
    try {
      setData(await emotionCurationApi.list({ status, q: query, limit: 25, offset }));
      setError(null);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "No se pudo cargar la revisión emocional.");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { void load(); }, [status, query, offset]);

  const current = data?.data.find((item) => item.tag === selected) ?? null;
  function choose(item: EmotionReviewTag) {
    setSelected(item.tag);
    setChoice(item.category ?? (CATEGORIES.some((c) => c.value === item.suggested) ? item.suggested as EmotionReviewCategory : ""));
    setNote(item.note ?? "");
    setMessage("");
  }
  function changeParams(next: { status?: string; q?: string; offset?: number }) {
    const p = new URLSearchParams();
    const newStatus = next.status ?? status;
    const newQ = next.q ?? query;
    const newOffset = next.offset ?? 0;
    if (newStatus !== "pending") p.set("estado", newStatus);
    if (newQ) p.set("q", newQ);
    if (newOffset) p.set("desde", String(newOffset));
    setParams(p);
    setSelected(null);
  }
  async function save(category: EmotionReviewCategory) {
    if (!current || saving) return;
    setSaving(true);
    setError(null);
    try {
      await emotionCurationApi.decide(current.tag, category, note);
      setMessage(`Decisión guardada para «${current.tag}».`);
      setSelected(null);
      await load();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "No se pudo guardar la decisión.");
    } finally {
      setSaving(false);
    }
  }

  return <div className="emotion-review">
    <header className="emotion-review__head">
      <h2>Emociones de la música</h2>
      <p>Revisa el significado de las etiquetas. Las capturas de Last.fm pueden mezclar homónimos: sus frecuencias y sugerencias no acreditan canciones ni artistas. Solo se muestran vínculos con identidad revisada; +shoutbox está retirado.</p>
      {data ? <span className="emotion-review__count">{data.pending.toLocaleString("es-VE")} pendientes</span> : null}
    </header>
    <div className="emotion-review__toolbar">
      <form onSubmit={(event) => { event.preventDefault(); changeParams({ q: search.trim() }); }}>
        <label htmlFor="emotion-review-search">Buscar etiqueta</label>
        <input id="emotion-review-search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Ej. hot, tristeza, rock" />
        <button className="btn" type="submit">Buscar</button>
      </form>
      <label>Estado
        <select value={status} onChange={(event) => changeParams({ status: event.target.value })}>
          <option value="pending">Pendientes</option><option value="reviewed">Revisadas</option><option value="all">Todas</option>
        </select>
      </label>
    </div>
    {error ? <p role="alert" className="emotion-review__error">{error} <button type="button" onClick={() => void load()}>Reintentar</button></p> : null}
    {message ? <p role="status" className="emotion-review__saved">{message}</p> : null}
    {loading ? <p role="status">Cargando etiquetas…</p> : data?.data.length === 0 ? <p>No hay etiquetas en esta vista.</p> : (
      <div className="emotion-review__workspace">
        <div className="emotion-review__list" aria-label="Etiquetas para revisar">
          {data?.data.map((item) => <button key={item.tag} type="button" className={`emotion-review__item${selected === item.tag ? " is-selected" : ""}`} onClick={() => choose(item)}>
            <strong>{item.tag}</strong>
            <span>{item.category ? `Decidido: ${label(item.category)}` : `Sugerido: ${label(item.suggested)}`}</span>
            <small>{item.uses} usos · peso {item.weight}</small>
          </button>)}
        </div>
        <section className="emotion-review__detail" aria-live="polite">
          {current ? <>
            <h2>{current.tag}</h2>
            <p>{current.category ? "Clasificación aplicada" : "Clasificación automática"}: <strong>{label(current.suggested)}</strong>{current.probability !== null ? ` · puntuación Laya ${Math.round(current.probability * 100)} %` : ""}</p>
            <p className="emotion-review__help">La propuesta se refiere a la etiqueta, no a todas las canciones del artista.</p>
            <h3>Referencias con identidad revisada</h3>
            {current.artists.length === 0 ? <p>No hay referencias de artistas con identidad revisada para esta etiqueta.</p> : null}
            <ul>{current.artists.map((artist) => <li key={artist.id}><Link to={`/artistas/${artist.id}`}>{artist.name}</Link> <span>peso {artist.weight}</span></li>)}</ul>
            <label htmlFor="emotion-review-choice">Tu decisión</label>
            <select id="emotion-review-choice" value={choice} onChange={(event) => setChoice(event.target.value as EmotionReviewCategory | "")}>
              <option value="">Elegir categoría</option>
              {CATEGORIES.map((category) => <option key={category.value} value={category.value}>{category.label}</option>)}
            </select>
            <label htmlFor="emotion-review-note">Nota opcional</label>
            <textarea id="emotion-review-note" value={note} onChange={(event) => setNote(event.target.value)} maxLength={500} rows={3} placeholder="Por qué tomaste esta decisión" />
            <div className="emotion-review__actions">
              <button className="btn btn--primary" type="button" disabled={!choice || saving} onClick={() => choice && void save(choice)}>{saving ? "Guardando…" : "Guardar decisión"}</button>
              <button className="btn" type="button" disabled={saving} onClick={() => void save("no_expresa_emocion")}>No expresa emoción</button>
            </div>
            {current.decidedBy ? <small>Última revisión: {current.decidedBy}{current.decidedAt ? ` · ${new Date(current.decidedAt).toLocaleDateString("es-VE")}` : ""}</small> : null}
          </> : <p>Elige una etiqueta de la lista para revisar su evidencia y guardar tu decisión.</p>}
        </section>
      </div>
    )}
    {data && data.total > 25 ? <nav className="emotion-review__pages" aria-label="Paginación">
      <button className="btn" type="button" disabled={offset === 0 || loading} onClick={() => changeParams({ offset: Math.max(0, offset - 25) })}>Anterior</button>
      <span>{offset + 1}–{Math.min(offset + 25, data.total)} de {data.total}</span>
      <button className="btn" type="button" disabled={offset + 25 >= data.total || loading} onClick={() => changeParams({ offset: offset + 25 })}>Siguiente</button>
    </nav> : null}
  </div>;
}
