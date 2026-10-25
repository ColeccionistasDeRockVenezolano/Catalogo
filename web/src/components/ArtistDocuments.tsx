import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { ArrowSquareOut, Article, CaretLeft, CaretRight, MagnifyingGlass, PencilSimple } from "@phosphor-icons/react";
import { DOCUMENT_CATEGORIES, DOCUMENT_CATEGORY_LABELS, WAYBACK_ARCHIVE_TAG, type ArtistDocument, type DocumentCategory } from "../../../src/shared/artist-documents";
import { artistDocumentsApi } from "../lib/api";
import { useOperator } from "../lib/OperatorContext";
import { useToast } from "../lib/ToastContext";
import { TabEmpty } from "./EntityTabs";
import { Modal } from "./Modal";
import "../styles/artist-documents.css";

const searchable = (text: string) => text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("es").trim();
const tagLabel = (tag: string) => tag === WAYBACK_ARCHIVE_TAG ? "Archivo Wayback · 2026-10-22" : tag.replaceAll("-", " ");

function DocumentSources({ document }: { document: ArtistDocument }) {
  return <div className="artist-documents__sources">
    {document.archiveUrl ? <a href={document.archiveUrl} target="_blank" rel="noreferrer">Consultar captura archivada <ArrowSquareOut size={16} aria-hidden="true" /></a> : null}
    {document.sourceUrl ? <a href={document.sourceUrl} target="_blank" rel="noreferrer">Página de origen <ArrowSquareOut size={16} aria-hidden="true" /></a> : null}
  </div>;
}

export function ArtistDocuments({ artistId, items, onChanged }: { artistId: number; items: ArtistDocument[]; onChanged: () => void }) {
  const { isAdmin } = useOperator();
  const { notify } = useToast();
  const [category, setCategory] = useState<DocumentCategory | "all">("all");
  const [query, setQuery] = useState("");
  const [managing, setManaging] = useState(false);
  const [selected, setSelected] = useState<number[]>([]);
  const [readingId, setReadingId] = useState<number | null>(null);
  const [destination, setDestination] = useState<DocumentCategory>("interview");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const reader = useRef<HTMLElement>(null);
  useLayoutEffect(() => { reader.current?.closest(".modal-body")?.scrollTo({ top: 0 }); }, [readingId]);
  const visible = useMemo(() => items.filter(document => (category === "all" || document.category === category)
    && searchable(`${document.title} ${document.content} ${document.tags.join(" ").replace(/[-_]/g, " ")}`).includes(searchable(query))), [items, category, query]);
  const reading = items.find(document => document.id === readingId);
  const readingIndex = visible.findIndex(document => document.id === readingId);
  const allSelected = visible.length > 0 && visible.every(document => selected.includes(document.id));

  async function move() {
    setBusy(true); setError("");
    try {
      await artistDocumentsApi.reclassify(artistId, selected, destination, `Reclasificar ${selected.length} documentos como ${DOCUMENT_CATEGORY_LABELS[destination]}`);
      setSelected([]); onChanged(); notify("success", "Documentos reclasificados.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudieron mover los documentos. Vuelve a intentarlo."); }
    finally { setBusy(false); }
  }

  return <section className="artist-documents" aria-label="Entrevistas y otros documentos">
    <div className="artist-documents__header">
      <div><h2>Archivo del artista</h2><p className="muted-note">Entrevistas, artículos, noticias y documentos de su historia.</p></div>
      {isAdmin && items.length ? <button className="btn btn--sm" type="button" aria-pressed={managing} disabled={busy} onClick={() => { setManaging(value => !value); setSelected([]); }}><PencilSimple size={16} />{managing ? "Terminar edición" : "Organizar documentos"}</button> : null}
    </div>
    {!items.length ? <TabEmpty><Article size={32} aria-hidden="true" /><p>Sin entrevistas ni otros documentos registrados.</p></TabEmpty> : <>
      <div className="artist-documents__filters" role="group" aria-label="Filtrar documentos">
        <button className="btn btn--sm" type="button" aria-pressed={category === "all"} onClick={() => setCategory("all")}>Todos <span>{items.length}</span></button>
        {DOCUMENT_CATEGORIES.filter(key => items.some(document => document.category === key) || category === key).map(key => <button className="btn btn--sm" type="button" key={key} aria-pressed={category === key} onClick={() => setCategory(key)}>{DOCUMENT_CATEGORY_LABELS[key]} <span>{items.filter(document => document.category === key).length}</span></button>)}
      </div>
      <div className="artist-documents__search-row">
        <label className="artist-documents__search"><MagnifyingGlass size={20} aria-hidden="true" /><span className="visually-hidden">Buscar en los documentos</span><input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Buscar por título, contenido o etiqueta…" /></label>
        <p className="artist-documents__results" role="status">{visible.length} de {items.length} {items.length === 1 ? "documento" : "documentos"}</p>
      </div>
      {isAdmin && managing ? <div className="artist-documents__manage" aria-label="Organizar documentos" aria-busy={busy}>
        <button className="btn btn--sm" type="button" disabled={busy || !visible.length} onClick={() => setSelected(previous => allSelected ? previous.filter(id => !visible.some(document => document.id === id)) : [...new Set([...previous, ...visible.map(document => document.id)])])}>{allSelected ? "Deseleccionar resultados" : `Seleccionar resultados (${visible.length})`}</button>
        {selected.length ? <><span role="status">{selected.length} {selected.length === 1 ? "seleccionado" : "seleccionados"}</span><label>Mover a<select aria-label="Mover documentos a" value={destination} disabled={busy} onChange={event => setDestination(event.target.value as DocumentCategory)}>{DOCUMENT_CATEGORIES.map(key => <option key={key} value={key}>{DOCUMENT_CATEGORY_LABELS[key]}</option>)}</select></label>
          <button className="btn btn--primary btn--sm" type="button" disabled={busy} onClick={() => void move()}>{busy ? "Moviendo…" : "Mover seleccionados"}</button>
          <button className="btn btn--sm" type="button" disabled={busy} onClick={() => setSelected([])}>Quitar selección</button></> : null}
      </div> : null}
      {error ? <p role="alert" className="form-error-banner">{error}</p> : null}
      {!visible.length ? <TabEmpty><MagnifyingGlass size={28} aria-hidden="true" /><p>No hay documentos con estos filtros.</p><button className="btn" type="button" onClick={() => { setQuery(""); setCategory("all"); }}>Limpiar filtros</button></TabEmpty> : <ul className="artist-documents__list">{visible.map(document => <li key={document.id}>
        {isAdmin && managing ? <label className="artist-documents__select"><input type="checkbox" aria-label={`Seleccionar ${document.title}`} checked={selected.includes(document.id)} disabled={busy} onChange={event => setSelected(previous => event.target.checked ? [...previous, document.id] : previous.filter(id => id !== document.id))} /><span className="visually-hidden">Seleccionar</span></label> : null}
        <article>
          <div className="artist-documents__meta"><span className="artist-documents__category">{DOCUMENT_CATEGORY_LABELS[document.category]}</span>{document.dateText ? <span>{document.dateText}</span> : null}{document.location ? <span>{document.location}</span> : null}</div>
          <h3><button type="button" onClick={() => setReadingId(document.id)}>{document.title}</button></h3>
          <p className="artist-documents__excerpt">{document.content}</p>
          <div className="artist-documents__row-footer"><button type="button" className="artist-documents__read" aria-label={`Leer documento: ${document.title}`} onClick={() => setReadingId(document.id)}>Leer documento <CaretRight size={16} aria-hidden="true" /></button>{document.archiveUrl ? <span className="artist-documents__archived">Copia archivada disponible</span> : null}</div>
        </article>
      </li>)}</ul>}
    </>}
    {reading ? <Modal title="Archivo del artista" wide focusPanel onClose={() => setReadingId(null)}>
      <article ref={reader} className="document-reader" key={reading.id}>
        <div className="artist-documents__meta"><span className="artist-documents__category">{DOCUMENT_CATEGORY_LABELS[reading.category]}</span>{reading.dateText ? <span>{reading.dateText}</span> : null}{reading.location ? <span>{reading.location}</span> : null}</div>
        <h2>{reading.title}</h2>
        <DocumentSources document={reading} />
        <div className="artist-documents__content">{reading.content.split(/\n\s*\n/).filter(Boolean).map((paragraph, index) => <p key={index}>{paragraph}</p>)}</div>
        {reading.tags.length ? <ul className="artist-documents__tags" aria-label="Etiquetas">{reading.tags.map(tag => <li key={tag}>{tagLabel(tag)}</li>)}</ul> : null}
      </article>
      <div className="document-reader__navigation"><button type="button" className="btn" disabled={readingIndex <= 0} onClick={() => setReadingId(visible[readingIndex - 1]?.id ?? null)}><CaretLeft size={16} />Anterior</button><span>{readingIndex + 1} de {visible.length}</span><button type="button" className="btn" disabled={readingIndex < 0 || readingIndex >= visible.length - 1} onClick={() => setReadingId(visible[readingIndex + 1]?.id ?? null)}>Siguiente<CaretRight size={16} /></button></div>
    </Modal> : null}
  </section>;
}
