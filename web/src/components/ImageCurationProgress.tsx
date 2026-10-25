import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { dismissImageWork, refreshImageQueue, retryImageWork, useImageCurationQueue, useImageQueueConnection } from "../lib/imageCurationQueue";
import { UndoDialog } from "./UndoDialog";

export function ImageCurationProgress({ compact = false }: { compact?: boolean }) {
  const jobs = useImageCurationQueue();
  const connection = useImageQueueConnection();
  const [undoRun, setUndoRun] = useState<number | null>(null);
  const location = useLocation();
  const sending = jobs.filter(job => job.status === "sending");
  const pending = jobs.filter(job => ["sending", "queued", "running"].includes(job.status));
  const failed = jobs.filter(job => job.status === "error");
  const done = jobs.filter(job => job.status === "done");
  if (compact) {
    if (location.pathname === "/curaduria/imagenes" || (!pending.length && !failed.length)) return null;
    return <Link className="img-work-link" to="/curaduria/imagenes">Imágenes: {pending.length ? `${pending.length} en proceso` : `${failed.length} por revisar`}</Link>;
  }
  if (!jobs.length && !connection.loading && !connection.error) return null;
  return <section className="img-work" aria-label="Procesamiento de imágenes">
    {connection.error ? <p className="img-work__error" role="alert">{connection.error} <button className="btn btn--sm" onClick={() => void refreshImageQueue()}>Actualizar actividad</button></p> : null}
    {connection.loading && !jobs.length ? <p role="status">Consultando la cola del servidor…</p> : null}
    {jobs.length ? <>
      <p className="img-work__status" role="status">{pending.length ? `${pending.length} ${pending.length === 1 ? "operación en proceso" : "operaciones en proceso"}` : "Procesamiento terminado"}
        {done.length ? ` · ${done.length} ${done.length === 1 ? "completada" : "completadas"}` : ""}{failed.length ? ` · ${failed.length} con error` : ""}</p>
      {pending.length ? <p className="img-work__hint">{sending.length ? "Enviando solicitudes. Espera la confirmación del servidor antes de cerrar esta pestaña." : "La cola está guardada en el servidor. Puedes cerrar esta pestaña; el procesamiento continuará y verás el resultado al volver."}</p> : null}
      <details><summary>Ver actividad ({jobs.length})</summary>
        <ol className="img-work__list">{[...failed, ...pending, ...done.slice(0, 5)].map(job => <li key={job.id}>
          <div><strong>{job.groups[0]!.name}</strong>
            <span>{job.type === "inspection" ? "Medir calidad" : job.candidateId == null ? "Dejar la actual" : "Cambiar imagen"} · {job.status === "sending" ? "Enviando al servidor…" : job.status === "queued" ? "En cola en el servidor" : job.status === "running" ? "Procesando en el servidor…" : job.status === "done" ? job.result : job.error}</span></div>
          {job.status === "error" ? <div className="img-work__actions">{!job.conflict ? <button className="btn btn--sm" onClick={() => void retryImageWork(job.id)}>Reintentar</button> : null}
            <Link className="btn btn--ghost btn--sm" to={`/curaduria/imagenes?${job.groups[0]!.kind === "artist" ? "tipo=fotos&" : ""}ficha=${job.groups[0]!.entityId}`} onClick={() => void dismissImageWork(job.id)}>Volver a revisar</Link></div> : null}
          {job.status === "done" && job.runId && job.type === "decision" ? <button className="btn btn--ghost btn--sm" onClick={() => setUndoRun(job.runId)}>Deshacer</button> : null}
        </li>)}</ol>
      </details>
      {failed.length ? <p className="img-work__error" role="alert">{failed.length} {failed.length === 1 ? "operación no se pudo completar" : "operaciones no se pudieron completar"}. Las fichas están disponibles para revisar. Consulta la actividad para ver el motivo.</p> : null}
    </> : null}
    {undoRun ? <UndoDialog runId={undoRun} onClose={() => setUndoRun(null)} /> : null}
  </section>;
}
