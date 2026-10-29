// CRV · Edición de series por la administración: datos de la serie, sus
// entregas y la pertenencia de un disco. Las reglas de publicación no cambian
// (solo Various Artists y al menos dos entregas, salvo series de sesiones);
// aquí se ve por qué una serie está oculta en lugar de perderla de vista.
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { CATALOG_DATA_CHANGED_EVENT, seriesEditorApi } from "../lib/api";
import { useAsync } from "../lib/useAsync";
import { useToast } from "../lib/ToastContext";
import type { AlbumSeriesMembership, SeriesEditorDetail, SeriesEditorEntry, SeriesHiddenReason } from "../lib/types";
import { Modal } from "./Modal";
import { ConfirmDialog } from "./ConfirmDialog";
import { NoteField } from "./NoteField";
import { FormFields, type FieldConfig, type FieldValue } from "./FormFields";
import { EntityPicker } from "./EntityPicker";

export const SERIES_HIDDEN_REASON: Record<SeriesHiddenReason, string> = {
  few_entries: "Oculta: necesita al menos dos entregas visibles en el catálogo.",
  not_various_artists: "Oculta: tiene entregas que no son de Various Artists. Solo una serie de sesiones las admite.",
};

export function SeriesStatus({ isPublic, hiddenReason }: { isPublic: boolean; hiddenReason: SeriesHiddenReason | null }) {
  return isPublic
    ? <span className="badge">Pública</span>
    : <span className="badge badge--red" title={hiddenReason ? SERIES_HIDDEN_REASON[hiddenReason] : undefined}>Oculta</span>;
}

const SERIES_FIELDS: readonly FieldConfig[] = [
  { key: "title", label: "Título de la serie", type: "text", required: true, span2: true },
  { key: "kind", label: "Tipo", type: "select", required: true, options: [
    { value: "compilation", label: "Compilados de Various Artists" },
    { value: "sessions", label: "Serie de sesiones (una banda por entrega)" },
  ], hint: "Las colecciones de sello con un artista por volumen no son series de sesiones." },
  { key: "description", label: "Descripción pública", type: "textarea", span2: true },
  { key: "notes", label: "Notas internas y evidencia", type: "textarea", span2: true },
];
const VOLUME_FIELDS: readonly FieldConfig[] = [
  { key: "volumeNumber", label: "Número para ordenar", type: "number", hint: "Vacío: la entrega se ordena por año." },
  { key: "volumeLabel", label: "Volumen como lo escribe la fuente", type: "text", hint: "Por ejemplo «Vol. IV»." },
];

type Ref = { id: number; name: string } | null;
/** Vuelve a leer tras cualquier escritura del catálogo, incluido «Deshacer» desde un aviso. */
export function useReloadOnCatalogChange(reload: () => void): void {
  const latest = useRef(reload);
  latest.current = reload;
  useEffect(() => {
    const listener = () => latest.current();
    window.addEventListener(CATALOG_DATA_CHANGED_EVENT, listener);
    return () => window.removeEventListener(CATALOG_DATA_CHANGED_EVENT, listener);
  }, []);
}

const message = (cause: unknown) => cause instanceof Error ? cause.message : "No se pudo guardar.";
const blank = (value: FieldValue) => typeof value === "string" && !value.trim() ? null : value;

/** Crear (sin `series`) o corregir una serie. */
export function SeriesFormModal({ series, onClose, onSaved }: { series?: SeriesEditorDetail; onClose: () => void; onSaved: (id: number) => void }) {
  const initial: Record<string, FieldValue> = { title: series?.title ?? "", kind: series?.kind ?? "compilation", description: series?.description ?? "", notes: series?.notes ?? "" };
  const [values, setValues] = useState(initial);
  const [artist, setArtist] = useState<Ref>(series?.artist ?? null);
  const [organization, setOrganization] = useState<Ref>(series?.organization ?? null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string>();
  const { notify } = useToast();

  async function save(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (!note.trim()) { setFailure("Escribe el motivo: queda en la auditoría."); return; }
    const body: Record<string, unknown> = { note: note.trim() };
    for (const key of Object.keys(initial)) {
      const value = blank(values[key]) ?? null;
      if (!series || value !== (blank(initial[key]) ?? null)) body[key] = value;
    }
    if (!series || artist?.id !== series.artist?.id) body["artistId"] = artist?.id ?? null;
    if (!series || organization?.id !== series.organization?.id) body["organizationId"] = organization?.id ?? null;
    setBusy(true); setFailure(undefined);
    try {
      const saved = await seriesEditorApi.save(body, series?.id);
      notify("success", series ? "Serie guardada." : "Serie creada.");
      onSaved(saved.id);
    } catch (cause) { setFailure(message(cause)); setBusy(false); }
  }

  return (
    <Modal title={series ? `Editar «${series.title}»` : "Nueva serie"} onClose={() => { if (!busy) onClose(); }} closeOnOverlay={!note.trim() && !busy}>
      <form onSubmit={(event) => void save(event)}>
        {failure ? <p className="form-error-banner" role="alert">{failure}</p> : null}
        <fieldset disabled={busy} className="image-upload-fields">
          <FormFields fields={SERIES_FIELDS} values={values} onChange={(key, value) => setValues({ ...values, [key]: value })} />
          <EntityPicker kind="artist" label="Artista responsable (opcional)" value={artist?.id ?? null} valueLabel={artist?.name ?? null}
            onSelect={(id, name) => setArtist({ id, name })} onClear={() => setArtist(null)} />
          <EntityPicker kind="organization" label="Sello o medio (opcional)" value={organization?.id ?? null} valueLabel={organization?.name ?? null}
            onSelect={(id, name) => setOrganization({ id, name })} onClear={() => setOrganization(null)} />
          <NoteField value={note} onChange={setNote} placeholder="Fuente o motivo del cambio (queda en la auditoría)" />
        </fieldset>
        <div className="form-actions">
          <button type="button" className="btn" disabled={busy} onClick={onClose}>Cancelar</button>
          <button type="submit" className="btn btn--primary" disabled={busy}>{busy ? "Guardando…" : series ? "Guardar" : "Crear serie"}</button>
        </div>
      </form>
    </Modal>
  );
}

interface EntryTarget {
  /** Serie conocida (página de la serie) o null para elegirla (ficha del disco). */
  series: Ref;
  /** Disco conocido (ficha del disco) o null para elegirlo (página de la serie). */
  album: Ref;
  /** Entrega existente: solo se corrigen número y etiqueta. */
  entry?: { id: number; volumeNumber: number | null; volumeLabel: string | null };
}

export function SeriesEntryModal({ target, onClose, onSaved }: { target: EntryTarget; onClose: () => void; onSaved: () => void }) {
  const [series, setSeries] = useState<Ref>(target.series);
  const [album, setAlbum] = useState<Ref>(target.album);
  const [values, setValues] = useState<Record<string, FieldValue>>({ volumeNumber: target.entry?.volumeNumber ?? null, volumeLabel: target.entry?.volumeLabel ?? "" });
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string>();
  const { notify } = useToast();

  async function save(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (!series || !album) { setFailure(series ? "Selecciona el disco." : "Selecciona la serie."); return; }
    if (!note.trim()) { setFailure("Escribe el motivo: queda en la auditoría."); return; }
    const body: Record<string, unknown> = { note: note.trim(), volumeNumber: values["volumeNumber"] ?? null, volumeLabel: blank(values["volumeLabel"]) ?? null };
    if (!target.entry) body["albumId"] = album.id;
    setBusy(true); setFailure(undefined);
    try {
      await seriesEditorApi.saveEntry(series.id, body, target.entry?.id);
      notify("success", target.entry ? "Entrega corregida." : "Disco añadido a la serie.");
      onSaved();
    } catch (cause) { setFailure(message(cause)); setBusy(false); }
  }

  const title = target.entry ? `Volumen de «${album?.name ?? ""}»` : target.series ? `Añadir un disco a «${target.series.name}»` : `Añadir «${target.album?.name ?? ""}» a una serie`;
  return (
    <Modal title={title} onClose={() => { if (!busy) onClose(); }} closeOnOverlay={!note.trim() && !busy}>
      <form onSubmit={(event) => void save(event)}>
        {failure ? <p className="form-error-banner" role="alert">{failure}</p> : null}
        <fieldset disabled={busy} className="image-upload-fields">
          {!target.series ? <EntityPicker kind="series" label="Serie" value={series?.id ?? null} valueLabel={series?.name ?? null}
            onSelect={(id, name) => setSeries({ id, name })} placeholder="Busca por título de la serie" /> : null}
          {!target.album ? <EntityPicker kind="album" label="Disco" value={album?.id ?? null} valueLabel={album?.name ?? null}
            onSelect={(id, name) => setAlbum({ id, name })} placeholder="Busca por título del disco" /> : null}
          <FormFields fields={VOLUME_FIELDS} values={values} onChange={(key, value) => setValues({ ...values, [key]: value })} />
          <NoteField value={note} onChange={setNote} placeholder="Fuente del volumen o motivo del cambio" />
        </fieldset>
        <div className="form-actions">
          <button type="button" className="btn" disabled={busy} onClick={onClose}>Cancelar</button>
          <button type="submit" className="btn btn--primary" disabled={busy}>{busy ? "Guardando…" : target.entry ? "Guardar" : "Añadir"}</button>
        </div>
      </form>
    </Modal>
  );
}

function entryWarnings(entry: SeriesEditorEntry, series: SeriesEditorDetail): string[] {
  return [
    entry.visible ? null : "Ficha oculta del catálogo: no cuenta para la serie.",
    entry.variousArtists || series.kind === "sessions" ? null : "No es de Various Artists: deja la serie oculta.",
    entry.compilation || series.kind === "sessions" ? null : "Sin tipo ni característica de compilado.",
  ].filter((warning): warning is string => warning !== null);
}

/** Entregas de una serie, incluidas las que dejan la serie oculta. */
export function SeriesEntriesEditor({ series, onChanged }: { series: SeriesEditorDetail; onChanged: () => void }) {
  const [editing, setEditing] = useState<EntryTarget | null>(null);
  const [removing, setRemoving] = useState<SeriesEditorEntry | null>(null);
  const { notify } = useToast();
  const self = { id: series.id, name: series.title };
  return (
    <section className="relation-editor" aria-label="Entregas de la serie">
      <h3>Entregas <span className="mono" style={{ color: "var(--text-faint)", fontWeight: 400 }}>({series.entries.length})</span></h3>
      <p className="hint">El orden sigue el número de volumen; si alguna entrega no lo tiene, el año de publicación.</p>
      {!series.entries.length ? <p>Sin entregas.</p> : (
        <ul className="relation-editor__list">
          {series.entries.map((entry) => (
            <li key={entry.id}>
              <div>
                <strong>{entry.volumeLabel ?? (entry.volumeNumber !== null ? `N.º ${entry.volumeNumber}` : "Sin volumen")} · <Link to={`/discos/${entry.albumId}`}>{entry.title}</Link></strong>
                <span className="hint">{entry.artistName}{entry.releaseYear !== null ? ` · ${entry.releaseYear}` : ""}</span>
                {entryWarnings(entry, series).map((warning) => <span key={warning} className="hint" style={{ color: "var(--danger, var(--red))" }}>{warning}</span>)}
              </div>
              <div className="relation-editor__actions">
                <button type="button" className="btn btn--sm" onClick={() => setEditing({ series: self, album: { id: entry.albumId, name: entry.title }, entry })}>Editar</button>
                <button type="button" className="btn btn--sm btn--danger" onClick={() => setRemoving(entry)}>Retirar</button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <button type="button" className="btn" onClick={() => setEditing({ series: self, album: null })}>+ Añadir disco</button>
      {editing ? <SeriesEntryModal target={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); onChanged(); }} /> : null}
      {removing ? (
        <ConfirmDialog title={`Retirar «${removing.title}» de la serie`} danger confirmLabel="Retirar de la serie"
          description="El disco conserva su ficha; solo deja de pertenecer a esta serie. El cambio puede deshacerse."
          onClose={() => setRemoving(null)}
          onConfirm={async (note) => {
            await seriesEditorApi.removeEntry(series.id, removing.id, note);
            setRemoving(null); notify("success", "Entrega retirada."); onChanged();
          }} />
      ) : null}
    </section>
  );
}

/** Series de un disco (todas, públicas u ocultas), desde su ficha. */
export function AlbumSeriesEditor({ album, onChanged }: { album: { id: number; name: string }; onChanged: () => void }) {
  const { data, loading, error, reload } = useAsync(() => seriesEditorApi.forAlbum(album.id), [album.id]);
  useReloadOnCatalogChange(reload);
  const [editing, setEditing] = useState<EntryTarget | null>(null);
  const [removing, setRemoving] = useState<AlbumSeriesMembership | null>(null);
  const { notify } = useToast();
  const changed = () => { reload(); onChanged(); };
  return (
    <section className="relation-editor" aria-label="Series del disco">
      <p className="hint">Una serie pública reúne compilados de Various Artists con al menos dos entregas, salvo las series de sesiones.</p>
      {error ? <p role="alert">{error} <button type="button" className="btn" onClick={reload}>Reintentar</button></p>
        : loading && !data ? <p role="status">Cargando…</p>
        : !data?.length ? <p>Este disco no pertenece a ninguna serie.</p> : (
          <ul className="relation-editor__list">
            {data.map((membership) => (
              <li key={membership.id}>
                <div>
                  <strong><Link to={`/series/${membership.seriesId}`}>{membership.seriesTitle}</Link>{membership.volumeLabel ? ` · ${membership.volumeLabel}` : membership.volumeNumber !== null ? ` · N.º ${membership.volumeNumber}` : ""}</strong>
                  <span><SeriesStatus isPublic={membership.isPublic} hiddenReason={membership.hiddenReason} />{membership.hiddenReason ? <span className="hint"> {SERIES_HIDDEN_REASON[membership.hiddenReason]}</span> : null}</span>
                </div>
                <div className="relation-editor__actions">
                  <button type="button" className="btn btn--sm" onClick={() => setEditing({ series: { id: membership.seriesId, name: membership.seriesTitle }, album, entry: membership })}>Editar</button>
                  <button type="button" className="btn btn--sm btn--danger" onClick={() => setRemoving(membership)}>Retirar</button>
                </div>
              </li>
            ))}
          </ul>
        )}
      <button type="button" className="btn btn--sm" onClick={() => setEditing({ series: null, album })}>+ Añadir a una serie</button>
      {editing ? <SeriesEntryModal target={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); changed(); }} /> : null}
      {removing ? (
        <ConfirmDialog title={`Retirar de «${removing.seriesTitle}»`} danger confirmLabel="Retirar de la serie"
          description="El disco conserva su ficha y la serie sus demás entregas. El cambio puede deshacerse."
          onClose={() => setRemoving(null)}
          onConfirm={async (note) => {
            await seriesEditorApi.removeEntry(removing.seriesId, removing.id, note);
            setRemoving(null); notify("success", "Disco retirado de la serie."); changed();
          }} />
      ) : null}
    </section>
  );
}

/** Índice de series para la administración: las que no llegan a /series y por qué. */
export function HiddenSeriesPanel() {
  const { data, loading, error, reload } = useAsync(() => seriesEditorApi.list({ status: "hidden", limit: 200 }), []);
  useReloadOnCatalogChange(reload);
  const total = data?.pagination.total;
  return (
    <details className="relation-editor" style={{ margin: "0 0 18px" }}>
      <summary><strong>Series ocultas{total !== undefined ? ` (${total})` : ""}</strong> <span className="hint">Solo administración: registradas pero fuera de /series.</span></summary>
      {error ? <p role="alert">{error} <button type="button" className="btn" onClick={reload}>Reintentar</button></p>
        : loading && !data ? <p role="status">Cargando…</p>
        : !data?.data.length ? <p>No hay series ocultas.</p> : (
          <ul className="relation-editor__list">
            {data.data.map((series) => (
              <li key={series.id}>
                <div>
                  <strong><Link to={`/series/${series.id}`}>{series.title}</Link></strong>
                  <span className="hint">{series.visibleCount} de {series.entryCount} {series.entryCount === 1 ? "entrega visible" : "entregas visibles"}{series.hiddenReason ? ` · ${SERIES_HIDDEN_REASON[series.hiddenReason]}` : ""}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      {total !== undefined && data && total > data.data.length ? <p className="hint">Se muestran {data.data.length} de {total}.</p> : null}
    </details>
  );
}
