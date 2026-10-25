import { useId, useRef, useState } from "react";
import { genresApi } from "../lib/api";
import { useAsync } from "../lib/useAsync";
import { useOperator } from "../lib/OperatorContext";
import { useToast } from "../lib/ToastContext";
import type { PublicGenre } from "../lib/types";

type Action = "confirm_primary" | "add_secondary" | "reject";
const searchable = (text: string) => text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("es");

export function GenreEditor({ kind, id, genres, primaryGenre, onChanged }: {
  kind: "artist" | "album"; id: number; genres: PublicGenre[]; primaryGenre: PublicGenre | null; onChanged: () => void;
}) {
  const { isAdmin } = useOperator();
  const { data, loading, error, reload } = useAsync(genresApi.vocabulary, []);
  const { notify } = useToast();
  const uid = useId();
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const [query, setQuery] = useState("");
  const [note, setNote] = useState("");
  const [proposal, setProposal] = useState(false);
  const [proposedName, setProposedName] = useState("");
  const [familySlug, setFamilySlug] = useState("");
  const [rawValue, setRawValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string>();
  if (!isAdmin) return null;

  const assigned = new Set(genres.map(genre => genre.slug));
  const matches = (data ?? []).filter(genre => !assigned.has(genre.slug) && searchable(genre.name).includes(searchable(query.trim())));
  const visible = matches.slice(0, query.trim() ? 20 : 8);
  function requireNote() {
    if (note.trim()) return true;
    setFailure("Escribe el motivo del cambio para guardarlo en el historial.");
    noteRef.current?.focus();
    return false;
  }
  async function decide(action: Action, slug: string, name: string) {
    if (!requireNote() || busy) return;
    setBusy(true); setFailure(undefined);
    try {
      await genresApi.decide(kind, id, action, slug, note.trim());
      setQuery(""); onChanged();
      notify("success", action === "reject" ? `${name} retirado.` : `${name} ${action === "confirm_primary" ? "establecido como principal" : "añadido como secundario"}.`);
    } catch (cause) { setFailure(cause instanceof Error ? cause.message : "No se pudo actualizar el género."); }
    finally { setBusy(false); }
  }
  async function propose(event: React.FormEvent) {
    event.preventDefault();
    if (!proposedName.trim() || !requireNote() || busy) return;
    setBusy(true); setFailure(undefined);
    try {
      const result = await genresApi.propose(kind, id, { proposedName: proposedName.trim(),
        ...(familySlug ? { familySlug } : {}), ...(rawValue.trim() ? { rawValue: rawValue.trim() } : {}), note: note.trim() });
      setProposedName(""); setFamilySlug(""); setRawValue(""); setProposal(false);
      notify("success", `Propuesta enviada a revisión #${result.reviewId}.`);
    } catch (cause) { setFailure(cause instanceof Error ? cause.message : "No se pudo enviar la propuesta."); }
    finally { setBusy(false); }
  }

  return <section className="relation-editor genre-editor" aria-label="Géneros confirmados">
    <h3>Géneros</h3>
    <p className="hint">Los géneros de {kind === "artist" ? "este artista" : "este disco"} se editan aquí. Cada cambio queda en el historial.</p>
    <div className="field genre-editor__note">
      <label htmlFor={`${uid}-note`}>Motivo del cambio *</label>
      <textarea id={`${uid}-note`} ref={noteRef} rows={2} maxLength={2000} value={note}
        onChange={event => { setNote(event.target.value); setFailure(undefined); }}
        placeholder="Ej.: aparece en los créditos de la edición original" />
      <span className="hint">Puedes usar el mismo motivo para varios cambios seguidos.</span>
    </div>
    {failure ? <p className="form-error-banner" role="alert">{failure}</p> : null}
    <h4>En la ficha</h4>
    {genres.length ? <ul className="relation-editor__list">{genres.map(genre => {
      const primary = genre.id === primaryGenre?.id;
      return <li key={genre.id}><div><strong>{genre.name}</strong><span>{primary ? "Principal" : "Secundario"}</span></div>
        <div className="relation-editor__actions">
          {!primary ? <button type="button" className="btn btn--sm" disabled={busy} onClick={() => decide("confirm_primary", genre.slug, genre.name)}>Hacer principal</button> : null}
          <button type="button" className="btn btn--sm btn--danger" disabled={busy}
            aria-label={`Quitar ${genre.name} de la ficha`} onClick={() => decide("reject", genre.slug, genre.name)}>Quitar</button>
        </div></li>;
    })}</ul> : <p className="genre-editor__empty">Aún no hay géneros confirmados.</p>}

    <div className="genre-editor__search">
      <h4>Añadir un género</h4>
      <div className="field"><label htmlFor={`${uid}-search`}>Buscar en el catálogo</label>
        <input id={`${uid}-search`} type="search" autoComplete="off" value={query}
          onChange={event => setQuery(event.target.value)} placeholder="Escribe un género o estilo" /></div>
      {loading ? <p role="status">Cargando géneros…</p> : error ? <p role="alert">{error} <button type="button" className="btn" onClick={reload}>Reintentar</button></p> : <>
        {visible.length ? <ul className="genre-editor__results">{visible.map(genre => <li key={genre.slug}>
          <div><strong>{genre.name}</strong><span>{genre.level === "family" ? "Familia" : genre.level === "subgenre" ? "Subgénero" : "Género"}</span></div>
          <div className="relation-editor__actions">
            <button type="button" className="btn btn--sm btn--primary" disabled={busy}
              aria-label={`Añadir ${genre.name} como principal`} onClick={() => decide("confirm_primary", genre.slug, genre.name)}>Principal</button>
            <button type="button" className="btn btn--sm" disabled={busy}
              aria-label={`Añadir ${genre.name} como secundario`} onClick={() => decide("add_secondary", genre.slug, genre.name)}>Secundario</button>
          </div></li>)}</ul> : <p className="genre-editor__empty">{query ? "No hay géneros con ese nombre." : "No quedan géneros para añadir."}</p>}
        {matches.length > visible.length ? <p className="hint">Escribe más letras para acotar los resultados.</p> : null}
      </>}
    </div>

    <details className="genre-editor__proposal" open={proposal} onToggle={event => setProposal(event.currentTarget.open)}>
      <summary>¿No aparece? Proponer un género nuevo</summary>
      <form onSubmit={propose}>
        <p className="hint">La propuesta se revisa antes de incorporarla al catálogo.</p>
        <div className="form-grid">
          <div className="field"><label htmlFor={`${uid}-proposed`}>Nombre propuesto *</label><input id={`${uid}-proposed`} required maxLength={100} value={proposedName} onChange={event => setProposedName(event.target.value)} /></div>
          <div className="field"><label htmlFor={`${uid}-family`}>Familia</label><select id={`${uid}-family`} value={familySlug} onChange={event => setFamilySlug(event.target.value)}><option value="">Por revisar</option>{data?.filter(genre => genre.level === "family").map(genre => <option key={genre.slug} value={genre.slug}>{genre.name}</option>)}</select></div>
          <div className="field span-2"><label htmlFor={`${uid}-source`}>Texto y referencia de la fuente</label><textarea id={`${uid}-source`} maxLength={2000} value={rawValue} onChange={event => setRawValue(event.target.value)} /></div>
        </div>
        <div className="form-actions"><button type="submit" className="btn btn--primary" disabled={busy}>{busy ? "Enviando…" : "Enviar a revisión"}</button></div>
      </form>
    </details>
  </section>;
}
