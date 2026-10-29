// CRV · Curaduría: portadas y fotos de artista para elegir a ojo (Brian, 2026-10-04).
//
// La mejora de portadas pequeñas aplicó sola las coincidencias claras; aquí
// llegan las dudosas (misma portada con otro recorte, otra edición, escaneo
// distinto…) y los artistas con más de una foto de perfil en las fuentes. Cada
// tarjeta pone la imagen actual al lado de las candidatas: «Usar esta» la
// cambia en la ficha (un run, con «Deshacer» en la barra de abajo) y «Dejar la
// actual» solo descarta las candidatas. Nada cambia sin una decisión.
import { useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { X } from "@phosphor-icons/react";
import { albumWrites, artistWrites, imageCandidatesApi, type ImageCandidate, type ImageCandidateGroup, type ImageCandidateKind } from "../lib/api";
import { EntityFormModal } from "../components/EntityFormModal";
import { useAsync } from "../lib/useAsync";
import { useToast } from "../lib/ToastContext";
import { formatCount } from "../lib/curation";
import { EmptyState, ErrorState } from "../components/StateViews";
import { RowsSkeleton } from "../components/Skeletons";
import { Pagination } from "../components/Pagination";
import { ImageCurationProgress } from "../components/ImageCurationProgress";
import { imageGroupKey, queueImageDecision, queueImageInspection, queueKeepCurrent, useImageCurationQueue } from "../lib/imageCurationQueue";
import { ImageGroupCard } from "../components/ImageCandidateGroupCard";

const LIMIT = 20;
const TABS: ReadonlyArray<{ kind: ImageCandidateKind; param: string; label: string }> = [
  { kind: "album", param: "portadas", label: "Portadas" },
  { kind: "artist", param: "fotos", label: "Fotos de artista" },
];

export function CurationImagesPage() {
  const paginationStartRef = useRef<HTMLDivElement>(null);
  const { notify } = useToast();
  const [params, setParams] = useSearchParams();
  const tab = TABS.find((entry) => entry.param === params.get("tipo")) ?? TABS[0]!;
  const offsetValue = Number(params.get("offset"));
  const offset = Number.isSafeInteger(offsetValue) && offsetValue > 0 ? offsetValue : 0;
  const setOffset = (value: number) => setParams(previous => {
    const next = new URLSearchParams(previous);
    if (value) next.set("offset", String(value)); else next.delete("offset");
    return next;
  });
  const jobs = useImageCurationQueue();
  const [editingImage, setEditingImage] = useState<ImageCandidateGroup | null>(null);
  const entityId = Number(params.get("ficha")) || undefined;
  const queryKey = `${tab.kind}:${offset}:${entityId ?? ""}`;
  const result = useAsync(async () => ({
    ...await imageCandidatesApi.list(tab.kind, { limit: LIMIT, offset, ...(entityId ? { entityId } : {}) }), queryKey,
  }), [tab.kind, offset, entityId, queryKey]);
  // Las lecturas anteriores no deben aparecer al cambiar de pestaña o página.
  const data = result.data?.queryKey === queryKey ? result.data : undefined;
  const { loading, error, reload } = result;
  const counts = useAsync(() => imageCandidatesApi.summary(), [data]);
  const hidden = new Set(jobs.filter(job => job.type === "decision" && job.hide).flatMap(job => job.groups.map(imageGroupKey)));
  const visible = data?.data.filter(group => !hidden.has(imageGroupKey(group))) ?? [];
  const hiddenHere = data?.data.filter(group => hidden.has(imageGroupKey(group))).length ?? 0;
  const pending = data ? Math.max(0, data.pagination.total - hiddenHere) : undefined;
  const measurable = visible.filter(group => group.candidates.some(candidate => candidate.quality === null || candidate.quality === "failed")
    && !jobs.some(job => job.type === "inspection" && (job.status === "sending" || job.status === "queued" || job.status === "running") && job.groups.some(other => imageGroupKey(other) === imageGroupKey(group))));

  function decide(group: ImageCandidateGroup, candidate: ImageCandidate | null) {
    const articles = [...(paginationStartRef.current?.parentElement?.querySelectorAll<HTMLElement>(".img-pick") ?? [])];
    const current = articles.findIndex(article => article.dataset.entityKey === imageGroupKey(group));
    const next = articles[current + 1] ?? articles[current - 1];
    queueImageDecision(group, candidate?.id ?? null);
    requestAnimationFrame(() => {
      if (next?.isConnected) next.focus({ preventScroll: true });
    });
  }

  return (
    <>
      <p className="curation-lead">
        Portadas que podrían cambiarse por la misma en mejor calidad y artistas con más de una foto en las fuentes.
        Compara la imagen actual con las candidatas y elige: «Usar esta» la cambia en la ficha y se puede deshacer;
        «Dejar la actual» descarta las candidatas. Las decisiones se guardan en segundo plano: puedes seguir con la siguiente ficha.
      </p>

      <div className="list-toolbar">
        <div className="segmented" role="group" aria-label="Tipo de imagen">
          {TABS.map((entry) => (
            <button
              key={entry.kind} type="button" className="segmented__option" aria-pressed={entry.kind === tab.kind}
              onClick={() => setParams(previous => {
                const next = new URLSearchParams(previous);
                if (entry === TABS[0]) next.delete("tipo"); else next.set("tipo", entry.param);
                next.delete("offset"); next.delete("ficha");
                return next;
              })}
            >
              {entry.label}
              {counts.data ? <span className="segmented__range">{formatCount(counts.data[entry.kind])}</span> : null}
            </button>
          ))}
        </div>
        {visible.length > 0 ? (
          <button type="button" className="btn btn--outline btn--sm" onClick={() => queueKeepCurrent(visible)}>
            <X size={14} weight="bold" aria-hidden="true" />
            Dejar las actuales en esta página ({formatCount(visible.length)})
          </button>
        ) : null}
        {measurable.length ? (
          <button type="button" className="btn btn--outline btn--sm" onClick={() => queueImageInspection(measurable)}>
            Medir calidad de esta página
          </button>
        ) : null}
        {entityId ? <Link className="btn btn--ghost btn--sm" to={tab === TABS[0] ? "" : `?tipo=${tab.param}`}>Ver todas las fichas</Link> : null}
        {pending !== undefined && !loading ? (
          <p className="dup-count" aria-live="polite">{formatCount(pending)} {pending === 1 ? "ficha pendiente" : "fichas pendientes"}</p>
        ) : null}
      </div>

      <ImageCurationProgress />

      <div ref={paginationStartRef} className="pagination-start" />

      {loading && !data ? <RowsSkeleton rows={3} height={260} label="Cargando las imágenes candidatas…" /> : error ? <ErrorState message={error} onRetry={reload} /> : visible.length === 0 ? (
        data && (data.pagination.total > hiddenHere || jobs.some(job => job.type === "decision" && (job.status === "sending" || job.status === "queued" || job.status === "running") && job.groups.some(group => group.kind === tab.kind)) || offset > 0) ? (
          <div className="img-pick__more">
            <p role="status">{jobs.some(job => job.type === "decision" && (job.status === "sending" || job.status === "queued" || job.status === "running")) ? "Guardando tus decisiones. Las siguientes fichas aparecerán automáticamente." : "Quedan más fichas por revisar."}</p>
            <button type="button" className="btn btn--outline" disabled={loading} onClick={() => { setOffset(0); reload(); }}>Cargar las siguientes</button>
          </div>
        ) : (
          <EmptyState
            title={tab.kind === "album" ? "No hay portadas por elegir" : "No hay fotos de artista por elegir"}
            hint="Cuando una búsqueda de imágenes deje candidatas dudosas, aparecerán aquí."
          />
        )
      ) : (
        <>
          <ol className={`img-pick-list${loading ? " is-refreshing" : ""}`}>
            {visible.map((group) => {
              const key = `${group.kind}:${group.entityId}`;
              return (
                <li key={key}>
                  <ImageGroupCard group={group} onDecide={(candidate) => decide(group, candidate)} onUpload={() => setEditingImage(group)} />
                </li>
              );
            })}
          </ol>
          <Pagination scrollTargetRef={paginationStartRef} limit={LIMIT} offset={offset} total={data?.pagination.total ?? 0} onOffsetChange={setOffset} />
        </>
      )}
      {editingImage ? <EntityFormModal title={`Cambiar imagen de ${editingImage.name}`} partial
        fields={[{ key: editingImage.kind === "album" ? "coverUrl" : "pictureUrl", label: editingImage.kind === "album" ? "Portada" : "Foto", type: "mediaUrl", span2: true }]}
        initialValues={{ [editingImage.kind === "album" ? "coverUrl" : "pictureUrl"]: editingImage.currentUrl }}
        onSubmit={(values, note) => (editingImage.kind === "album" ? albumWrites : artistWrites).update(editingImage.entityId, { ...values, note })}
        onSuccess={() => { setEditingImage(null); reload(); counts.reload(); notify("success", "Imagen actualizada. El cambio está disponible en el historial."); }}
        onClose={() => setEditingImage(null)} /> : null}
    </>
  );
}
