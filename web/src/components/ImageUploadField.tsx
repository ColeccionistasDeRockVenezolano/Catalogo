import { useEffect, useRef, useState } from "react";
import { UploadSimple } from "@phosphor-icons/react";
import { imageUploadsApi } from "../lib/api";
import { beginImageUpload } from "../lib/imageUploads";
import { IMAGE_UPLOAD_MAX_BYTES, IMAGE_UPLOAD_TYPES } from "../../../src/shared/image-upload";
import "../styles/image-upload.css";

export function ImageUploadField({ id, label, value, onChange, required = false, disabled = false }: {
  id: string; label: string; value: string; onChange: (url: string) => void; required?: boolean; disabled?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const current = useRef<{ controller: AbortController; finish: () => void }>();
  const latestChange = useRef(onChange);
  latestChange.current = onChange;
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState("");
  const [uploaded, setUploaded] = useState("");
  const [failedPreview, setFailedPreview] = useState<string>();
  useEffect(() => () => { current.current?.controller.abort(); current.current?.finish(); current.current = undefined; }, []);

  async function upload(files: File[]) {
    if (disabled || current.current || input.current?.matches(":disabled")) return;
    setDragging(false); setError(""); setUploaded("");
    if (files.length !== 1) { setError("Selecciona una sola imagen para este campo."); return; }
    const file = files[0]!;
    if (!(IMAGE_UPLOAD_TYPES as readonly string[]).includes(file.type)) { setError("Usa una imagen JPG, PNG, WebP, GIF o AVIF."); return; }
    if (!file.size || file.size > IMAGE_UPLOAD_MAX_BYTES) { setError("La imagen debe pesar entre 1 byte y 12 MiB."); return; }
    const controller = new AbortController();
    const finish = beginImageUpload();
    const timeout = window.setTimeout(() => controller.abort(new DOMException("Tiempo de subida agotado", "TimeoutError")), 60_000);
    const operation = { controller, finish: () => { window.clearTimeout(timeout); finish(); } };
    current.current = operation; setUploading(true);
    try {
      const result = await imageUploadsApi.upload(file, operation.controller.signal);
      if (current.current !== operation) return;
      latestChange.current(result.url);
      setUploaded(`Imagen subida: ${result.width} × ${result.height} px. Guarda los cambios para aplicarla.`);
    } catch (cause) {
      if (current.current === operation) {
        if (operation.controller.signal.reason instanceof DOMException && operation.controller.signal.reason.name === "TimeoutError") setError("La subida tardó demasiado. Comprueba la conexión y vuelve a intentarlo.");
        else if (!operation.controller.signal.aborted) setError(cause instanceof Error ? cause.message : "No se pudo subir la imagen. Vuelve a intentarlo.");
      }
    } finally {
      operation.finish();
      if (current.current === operation) { current.current = undefined; setUploading(false); }
    }
  }
  function cancel() {
    current.current?.controller.abort(); current.current?.finish(); current.current = undefined;
    setUploading(false); setUploaded("Subida cancelada.");
  }
  const locked = disabled || uploading;
  return <div className="image-upload" aria-busy={uploading}>
    <div className={`image-upload__drop${dragging ? " is-dragging" : ""}`}
      onDragOver={event => { event.preventDefault(); if (!locked) { event.dataTransfer.dropEffect = "copy"; setDragging(true); } }}
      onDragLeave={event => { if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) setDragging(false); }}
      onDrop={event => { event.preventDefault(); setDragging(false); if (!locked) void upload(Array.from(event.dataTransfer.files)); }}>
      {value && failedPreview !== value ? <img className="image-upload__preview" src={value} alt={`Vista previa: ${label}`} onError={() => setFailedPreview(value)} /> : <UploadSimple size={28} aria-hidden="true" />}
      <div className="image-upload__instructions">
        <span>{uploading ? "Subiendo y validando imagen…" : "Arrastra una imagen aquí"}</span>
        <button className="btn btn--sm" type="button" disabled={locked} onClick={() => input.current?.click()} aria-label={`Seleccionar archivo: ${label}`}>Seleccionar archivo</button>
      </div>
      <input ref={input} className="image-upload__file" type="file" tabIndex={-1} aria-label={`Archivo: ${label}`} accept={IMAGE_UPLOAD_TYPES.join(",")} disabled={locked}
        onChange={event => { const files = Array.from(event.target.files ?? []); event.target.value = ""; if (files.length) void upload(files); }} />
    </div>
    <span className="hint" id={`${id}-help`}>JPG, PNG, WebP, GIF o AVIF · Hasta 12 MiB y 40 megapíxeles. Se guarda como WebP; las animaciones usan el primer fotograma.</span>
    <label className="image-upload__url-label" htmlFor={id}>O pega una URL de imagen</label>
    <input id={id} type="text" inputMode="url" value={value} required={required} disabled={locked} aria-describedby={`${id}-help${error ? ` ${id}-error` : ""}`} aria-invalid={error ? true : undefined}
      onChange={event => { setError(""); setUploaded(""); onChange(event.target.value); }} />
    <p className="image-upload__status hint" role="status">{uploading ? "Subiendo imagen. Espera antes de guardar." : uploaded}</p>
    {uploading ? <button type="button" className="btn btn--sm" onClick={cancel}>Cancelar subida</button> : null}
    {error ? <p className="error" id={`${id}-error`} role="alert">{error}</p> : null}
  </div>;
}
