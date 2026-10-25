import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { ArrowUpRight, ImageSquare, PencilSimple, Plus, Trash, UploadSimple } from "@phosphor-icons/react";
import { GALLERY_CATEGORIES, GALLERY_CATEGORY_LABELS, type ArtistGalleryPhoto, type GalleryCategory, type GalleryPhotoInput } from "../../../src/shared/artist-gallery";
import { IMAGE_UPLOAD_MAX_BYTES, IMAGE_UPLOAD_TYPES } from "../../../src/shared/image-upload";
import { artistGalleryApi } from "../lib/api";
import { useOperator } from "../lib/OperatorContext";
import { useToast } from "../lib/ToastContext";
import { mediaImage } from "../lib/media";
import { ImageViewer } from "./ImageViewer";
import { Modal } from "./Modal";
import { ConfirmDialog } from "./ConfirmDialog";
import { NoteField } from "./NoteField";
import { TabEmpty } from "./EntityTabs";
import "../styles/artist-gallery.css";

function photoDate(date: string): string { return date.split("-").reverse().join("/"); }

export function ArtistGallery({ artistId, artistName, items, onChanged }: {
  artistId: number; artistName: string; items: ArtistGalleryPhoto[]; onChanged: () => void;
}) {
  const { isAdmin } = useOperator();
  const { notify } = useToast();
  const [category, setCategory] = useState<GalleryCategory | "all">("all");
  const [managing, setManaging] = useState(false);
  const [editor, setEditor] = useState<ArtistGalleryPhoto | "new" | null>(null);
  const [removing, setRemoving] = useState<ArtistGalleryPhoto | null>(null);
  const [viewing, setViewing] = useState<ArtistGalleryPhoto | null>(null);
  const visible = items.filter(photo => category === "all" || photo.category === category);
  const viewingIndex = viewing ? visible.findIndex(photo => photo.id === viewing.id) : -1;
  return <section className="artist-gallery" aria-label={`Galería de ${artistName}`}>
    <div className="artist-gallery__toolbar">
      <div className="artist-gallery__intro"><h2>Galería</h2><p className="muted-note">Fotografías del artista, conciertos, pósters y recuerdos del archivo.</p></div>
      {isAdmin ? <div className="artist-gallery__actions">
        {items.length ? <button type="button" className="btn btn--sm" aria-pressed={managing} onClick={() => setManaging(value => !value)}><PencilSimple size={16} />{managing ? "Terminar edición" : "Editar galería"}</button> : null}
        <button type="button" className="btn btn--primary btn--sm" onClick={() => setEditor("new")}><Plus size={16} />Añadir fotos</button>
      </div> : null}
    </div>
    {items.length ? <div className="artist-gallery__browse"><div className="artist-gallery__filters" role="group" aria-label="Filtrar galería por categoría">
      <button type="button" className="btn btn--sm" aria-pressed={category === "all"} onClick={() => setCategory("all")}>Todas <span>{items.length}</span></button>
      {GALLERY_CATEGORIES.map(key => {
        const count = items.filter(photo => photo.category === key).length;
        return count || key === category ? <button type="button" className="btn btn--sm" key={key} aria-pressed={category === key} onClick={() => setCategory(key)}>{GALLERY_CATEGORY_LABELS[key]} <span>{count}</span></button> : null;
      })}
    </div><p className="artist-gallery__hint" role="status">{visible.length} {visible.length === 1 ? "imagen" : "imágenes"} · Toca una foto para explorar</p></div> : null}
    {!items.length ? <TabEmpty><ImageSquare size={32} aria-hidden="true" /><p>Aún no hay imágenes en esta galería.</p>{isAdmin ? "Añade una foto o selecciona varias a la vez." : null}</TabEmpty> : !visible.length ? <TabEmpty>Sin imágenes en esta categoría.</TabEmpty> : <ul className="artist-gallery__grid">
      {visible.map(photo => <li key={photo.id}>
        <figure className="artist-gallery__photo">
          <button type="button" className="artist-gallery__open" aria-label={`Ampliar ${photo.title || `imagen de ${artistName}`}`} onClick={() => setViewing(photo)}>
            <img {...mediaImage(photo.imageUrl, 400)} alt={photo.title || `Imagen de ${artistName}`} loading="lazy" />
            <span className="artist-gallery__enlarge" aria-hidden="true"><ArrowUpRight size={20} /></span>
          </button>
          <figcaption>
            <span className="artist-gallery__category">{GALLERY_CATEGORY_LABELS[photo.category]}</span>
            <h3><button type="button" onClick={() => setViewing(photo)}>{photo.title || `Imagen de ${artistName}`}</button></h3>
            {photo.description ? <p className="artist-gallery__description">{photo.description}</p> : null}
            {photo.date || photo.location ? <p className="artist-gallery__details">{photo.date ? <time dateTime={photo.date}>{photoDate(photo.date)}</time> : null}{photo.location ? <span>{photo.location}</span> : null}</p> : null}
          </figcaption>
        </figure>
        {isAdmin && managing ? <div className="artist-gallery__actions">
          <button type="button" className="btn btn--sm" aria-label={`Editar ${photo.title || "foto"}`} onClick={() => setEditor(photo)}><PencilSimple size={16} />Editar</button>
          <button type="button" className="btn btn--danger btn--sm" aria-label={`Eliminar ${photo.title || "foto"}`} onClick={() => setRemoving(photo)}><Trash size={16} />Eliminar</button>
        </div> : null}
      </li>)}
    </ul>}
    {viewing && viewingIndex >= 0 ? <ImageViewer src={viewing.imageUrl} title={viewing.title || `Imagen de ${artistName}`} description={viewing.description} collectionTitle={artistName}
      navigation={{ index: viewingIndex, items: visible.map(photo => ({ src: photo.imageUrl, title: photo.title || `Imagen de ${artistName}` })), onSelect: index => setViewing(visible[index] ?? null) }}
      date={viewing.date} location={viewing.location} category={GALLERY_CATEGORY_LABELS[viewing.category]} onClose={() => setViewing(null)} /> : null}
    {isAdmin && editor ? <GalleryEditor artistId={artistId} photo={editor === "new" ? undefined : editor}
      onClose={() => setEditor(null)} onSaved={() => { setEditor(null); onChanged(); notify("success", "Galería guardada."); }} /> : null}
    {isAdmin && removing ? <ConfirmDialog title="Eliminar foto de la galería" description={`Se retirará ${removing.title ? `«${removing.title}»` : "esta foto"} de la galería del artista. Puedes deshacer el cambio desde el historial.`}
      confirmLabel="Eliminar foto" danger presets={["Imagen duplicada", "No corresponde al artista", "Corrección de la galería"]} onClose={() => setRemoving(null)}
      onConfirm={async note => { await artistGalleryApi.remove(artistId, removing.id, note); setRemoving(null); onChanged(); notify("success", "Foto eliminada de la galería."); }} /> : null}
  </section>;
}

interface Draft extends GalleryPhotoInput { key: string; preview: string; file?: File; }

function GalleryEditor({ artistId, photo, onClose, onSaved }: {
  artistId: number; photo?: ArtistGalleryPhoto | undefined; onClose: () => void; onSaved: () => void;
}) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const objectUrls = useRef<string[]>([]);
  const operation = useRef<AbortController>();
  const [drafts, setDrafts] = useState<Draft[]>(photo ? [{ ...photo, key: String(photo.id), preview: photo.imageUrl }] : []);
  const [selected, setSelected] = useState(0);
  const [batchCategory, setBatchCategory] = useState<GalleryCategory>(photo?.category ?? "artist");
  const [note, setNote] = useState(photo ? "Corrección de la galería" : "Añadir imágenes al archivo del artista");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const current = drafts[selected];
  useEffect(() => () => { operation.current?.abort(); objectUrls.current.forEach(url => URL.revokeObjectURL(url)); }, []);

  function addFiles(files: File[]) {
    if (busy) return;
    if (drafts.length + files.length > 100) { setError("Puedes añadir hasta 100 imágenes por lote."); return; }
    const invalid = files.filter(file => !(IMAGE_UPLOAD_TYPES as readonly string[]).includes(file.type) || !file.size || file.size > IMAGE_UPLOAD_MAX_BYTES);
    if (invalid.length) { setError(`Revisa estos archivos: ${invalid.map(file => file.name).join(", ")}. Usa JPG, PNG, WebP, GIF o AVIF de hasta 12 MiB cada uno.`); return; }
    const added = files.map(file => {
      const preview = URL.createObjectURL(file); objectUrls.current.push(preview);
      return { key: crypto.randomUUID(), file, preview, imageUrl: "", category: batchCategory, title: null, description: null, date: null, location: null } satisfies Draft;
    });
    setDrafts(previous => [...previous, ...added]); setSelected(drafts.length); setError("");
  }
  function update(values: Partial<GalleryPhotoInput>) {
    setDrafts(previous => previous.map((draft, index) => index === selected ? { ...draft, ...values } : draft));
  }
  async function save(event: FormEvent) {
    event.preventDefault(); if (busy || !drafts.length) return;
    if (!note.trim()) { setError("Escribe un motivo para guardar la galería."); return; }
    setBusy(true); setError("");
    const controller = new AbortController(); operation.current = controller;
    try {
      const photos: GalleryPhotoInput[] = [];
      for (let index = 0; index < drafts.length; index++) {
        const draft = drafts[index]!;
        let imageUrl = draft.imageUrl;
        if (!imageUrl && draft.file) {
          setProgress(`Subiendo imagen ${index + 1} de ${drafts.length}: ${draft.file.name}`);
          const timeout = window.setTimeout(() => controller.abort(), 90_000);
          try { imageUrl = (await artistGalleryApi.upload(draft.file, controller.signal)).url; }
          finally { window.clearTimeout(timeout); }
          // Conservar las subidas completadas: un reintento no vuelve a subirlas.
          setDrafts(previous => previous.map(item => item.key === draft.key ? { ...item, imageUrl } : item));
        }
        photos.push({ imageUrl, category: draft.category, title: draft.title?.trim() || null,
          description: draft.description?.trim() || null, date: draft.date || null, location: draft.location?.trim() || null });
      }
      setProgress("Guardando galería…");
      if (photo) await artistGalleryApi.update(artistId, photo.id, photos[0]!, note.trim());
      else await artistGalleryApi.add(artistId, photos, note.trim());
      onSaved();
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "No se pudo guardar. Vuelve a intentarlo.");
      else setError("La subida tardó demasiado. Vuelve a intentarlo; las imágenes completadas se conservan.");
    } finally { operation.current = undefined; setBusy(false); setProgress(""); }
  }
  return <Modal title={photo ? "Editar foto" : "Añadir fotos a la galería"} wide closeOnOverlay={false} onClose={() => { if (!busy) onClose(); }}>
    <form onSubmit={event => void save(event)} className="gallery-editor" aria-busy={busy}>
      {!photo ? <div className="gallery-editor__drop" onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); addFiles(Array.from(event.dataTransfer.files)); }}>
        <UploadSimple size={28} aria-hidden="true" /><p>Arrastra una o varias fotos aquí</p>
        <button type="button" className="btn" disabled={busy} onClick={() => input.current?.click()}>Seleccionar fotos</button>
        <input ref={input} type="file" multiple accept={IMAGE_UPLOAD_TYPES.join(",")} aria-label="Seleccionar fotos de la galería" hidden disabled={busy}
          onChange={event => { addFiles(Array.from(event.target.files ?? [])); event.target.value = ""; }} />
        <span className="hint">Hasta 100 imágenes por lote · 12 MiB y 40 megapíxeles por imagen.</span>
      </div> : null}
      <fieldset disabled={busy} className="gallery-editor__fields">
        {!photo && drafts.length > 1 ? <div className="gallery-editor__batch field"><label htmlFor={`${id}-batch`}>Categoría del lote</label><select id={`${id}-batch`} value={batchCategory} onChange={event => {
          const category = event.target.value as GalleryCategory; setBatchCategory(category); setDrafts(previous => previous.map(draft => ({ ...draft, category })));
        }}>{GALLERY_CATEGORIES.map(key => <option key={key} value={key}>{GALLERY_CATEGORY_LABELS[key]}</option>)}</select><span className="hint">Aplica a todas las fotos; puedes ajustar cada una después.</span></div> : null}
        {current ? <div className="gallery-editor__workspace">
          <div className="gallery-editor__queue" role="group" aria-label="Fotos seleccionadas">
            {drafts.map((draft, index) => <button key={draft.key} type="button" className="gallery-editor__thumbnail" aria-pressed={index === selected}
              onClick={() => setSelected(index)} aria-label={`Foto ${index + 1}: ${draft.title || draft.file?.name || "Imagen"}`}>
              <img src={draft.preview} alt="" loading="lazy" decoding="async" /><span>{index + 1}</span>
            </button>)}
          </div>
          <div className="gallery-editor__inspector">
            <div className="artist-gallery__toolbar"><p className="hint">Foto {selected + 1} de {drafts.length}{current.file ? ` · ${current.file.name}` : ""}</p>
              {!photo ? <button type="button" className="btn btn--danger btn--sm" onClick={() => { setDrafts(previous => previous.filter((_, index) => index !== selected)); setSelected(Math.max(0, selected - 1)); }}>Quitar del lote</button> : null}</div>
            <img className="gallery-editor__preview" src={current.preview} alt="Vista previa de la foto seleccionada" />
            <p className="hint">El título, la descripción, la fecha y la ubicación son opcionales.</p>
            <div className="field"><label htmlFor={`${id}-title`}>Título de la imagen</label><input id={`${id}-title`} maxLength={300} value={current.title ?? ""} onChange={event => update({ title: event.target.value })} /></div>
            <div className="field"><label htmlFor={`${id}-description`}>Descripción o comentario</label><textarea id={`${id}-description`} rows={3} maxLength={5000} value={current.description ?? ""} onChange={event => update({ description: event.target.value })} /></div>
            <div className="gallery-editor__metadata">
              <div className="field"><label htmlFor={`${id}-category`}>Categoría</label><select id={`${id}-category`} value={current.category} onChange={event => update({ category: event.target.value as GalleryCategory })}>{GALLERY_CATEGORIES.map(key => <option key={key} value={key}>{GALLERY_CATEGORY_LABELS[key]}</option>)}</select></div>
              <div className="field"><label htmlFor={`${id}-date`}>Fecha</label><input id={`${id}-date`} type="date" value={current.date ?? ""} onChange={event => update({ date: event.target.value || null })} /></div>
              <div className="field"><label htmlFor={`${id}-location`}>Ubicación</label><input id={`${id}-location`} maxLength={300} value={current.location ?? ""} onChange={event => update({ location: event.target.value })} /></div>
            </div>
          </div>
        </div> : null}
        {drafts.length ? <NoteField value={note} onChange={setNote} presets={photo ? ["Corrección de la galería"] : ["Añadir imágenes al archivo del artista"]} /> : null}
      </fieldset>
      <p role="status" className="hint">{progress}</p>
      {error ? <p role="alert" className="form-error-banner">{error}</p> : null}
      <div className="form-actions"><button type="button" className="btn" disabled={busy} onClick={onClose}>Cancelar</button>
        <button type="submit" className="btn btn--primary" disabled={busy || !drafts.length}>{busy ? "Guardando…" : photo ? "Guardar cambios" : `Añadir ${drafts.length} ${drafts.length === 1 ? "foto" : "fotos"}`}</button></div>
    </form>
  </Modal>;
}
