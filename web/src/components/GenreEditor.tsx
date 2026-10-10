import { useId, useState } from "react";
import { genresApi } from "../lib/api";
import { useAsync } from "../lib/useAsync";
import { useOperator } from "../lib/OperatorContext";
import { useToast } from "../lib/ToastContext";
import type { PublicGenre } from "../lib/types";

export function GenreEditor({ kind, id, genres, primaryGenre, onChanged }: {
  kind: "artist" | "album"; id: number; genres: PublicGenre[]; primaryGenre: PublicGenre | null; onChanged: () => void;
}) {
  const { isAdmin } = useOperator();
  const { data, loading, error, reload } = useAsync(genresApi.vocabulary, []);
  const [slug, setSlug] = useState("");
  const [action, setAction] = useState<"confirm_primary" | "add_secondary" | "reject">("confirm_primary");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string>();
  const uid = useId();
  const { notify } = useToast();
  if (!isAdmin) return null;
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!slug || !note.trim()) { setFailure("Selecciona un género y escribe el motivo."); return; }
    setBusy(true); setFailure(undefined);
    try {
      await genresApi.decide(kind, id, action, slug, note.trim());
      setNote(""); onChanged(); notify("success", "Géneros actualizados.");
    } catch (cause) { setFailure(cause instanceof Error ? cause.message : "No se pudo actualizar el género."); }
    finally { setBusy(false); }
  }
  return <section className="relation-editor" aria-label="Géneros confirmados">
    <h3>Géneros confirmados</h3>
    <p className="hint">El género del artista y el del disco se editan por separado.</p>
    <ul className="relation-editor__list">{genres.map((genre) => <li key={genre.id}><div><strong>{genre.name}</strong><span>{genre.id === primaryGenre?.id ? "Principal" : "Secundario"}</span></div><button type="button" className="btn btn--sm" onClick={() => { setSlug(genre.slug); setAction("reject"); }}>Quitar {genre.name}</button></li>)}</ul>
    {!genres.length ? <p>Sin géneros confirmados.</p> : null}
    {loading ? <p role="status">Cargando géneros…</p> : error ? <p role="alert">{error} <button type="button" className="btn" onClick={reload}>Reintentar</button></p> : <form className="relation-editor__form" onSubmit={submit}>
      {failure ? <p className="form-error-banner" role="alert">{failure}</p> : null}
      <div className="form-grid">
        <div className="field"><label htmlFor={`${uid}-genre`}>Género *</label><select id={`${uid}-genre`} value={slug} required onChange={(event) => setSlug(event.target.value)}><option value="">Selecciona un género</option>{data?.map((genre) => <option key={genre.slug} value={genre.slug}>{genre.name}</option>)}</select></div>
        <div className="field"><label htmlFor={`${uid}-action`}>Acción</label><select id={`${uid}-action`} value={action} onChange={(event) => setAction(event.target.value as typeof action)}><option value="confirm_primary">Establecer como principal</option><option value="add_secondary">Añadir como secundario</option><option value="reject">Quitar de la ficha</option></select></div>
        <div className="field span-2"><label htmlFor={`${uid}-note`}>Motivo *</label><textarea id={`${uid}-note`} required maxLength={2000} value={note} onChange={(event) => setNote(event.target.value)} /></div>
      </div>
      <div className="form-actions"><button type="submit" className="btn btn--primary" disabled={busy}>{busy ? "Guardando…" : "Guardar géneros"}</button></div>
    </form>}
  </section>;
}
