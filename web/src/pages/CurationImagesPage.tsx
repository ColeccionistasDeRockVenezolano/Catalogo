// CRV · Curaduría: portadas y fotos de artista para elegir a ojo (Brian, 2026-10-04).
//
// La mejora de portadas pequeñas aplicó sola las coincidencias claras; aquí
// llegan las dudosas (misma portada con otro recorte, otra edición, escaneo
// distinto…) y los artistas con más de una foto de perfil en las fuentes. Cada
// tarjeta pone la imagen actual al lado de las candidatas: «Usar esta» la
// cambia en la ficha (un run, con «Deshacer» en la barra de abajo) y «Dejar la
// actual» solo descarta las candidatas. Nada cambia sin una decisión.
import { useRef, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ArrowSquareOut, Check, Warning, X } from "@phosphor-icons/react";
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

const LIMIT = 20;
const TABS: ReadonlyArray<{ kind: ImageCandidateKind; param: string; label: string }> = [
  { kind: "album", param: "portadas", label: "Portadas" },
  { kind: "artist", param: "fotos", label: "Fotos de artista" },
];
const SOURCE_LABEL: Readonly<Record<string, string>> = {
  deezer: "Deezer", musicbrainz: "MusicBrainz", discogs: "Discogs", spotify: "Spotify",
  "myspace-wayback": "MySpace · Wayback",
  "myspace-wayback-sin-copia": "MySpace · sin copia local",
};

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

function ImageGroupCard({ group, onDecide, onUpload }: {
  group: ImageCandidateGroup; onDecide: (candidate: ImageCandidate | null) => void; onUpload: () => void;
}) {
  const href = group.kind === "album" ? `/discos/${group.entityId}` : `/artistas/${group.entityId}`;
  return (
    <article className="img-pick" aria-label={group.name} tabIndex={-1} data-entity-key={imageGroupKey(group)}>
      <header className="img-pick__head">
        <div>
          <h3 className="img-pick__title"><Link to={href}>{group.name}</Link></h3>
          {group.subtitle ? <p className="img-pick__meta">{group.subtitle}</p> : null}
        </div>
        <button type="button" className="btn btn--ghost btn--sm" onClick={() => onDecide(null)}>
          <X size={14} weight="bold" aria-hidden="true" />
          Dejar la actual
        </button>
      </header>
      {group.stale ? (
        <p className="img-pick__stale">
          <Warning size={15} weight="bold" aria-hidden="true" />
          La imagen de esta ficha cambió desde que se propusieron las candidatas: solo se puede dejar la actual.
        </p>
      ) : null}
      <div className="img-pick__grid">
        <ImageTile key={group.currentUrl} label="Actual" url={group.currentUrl} current />
        {group.candidates.map((candidate) => (
          <ImageTile
            key={`${candidate.id}:${candidate.url}`}
            label={SOURCE_LABEL[candidate.source] ?? candidate.source}
            url={candidate.url}
            pageUrl={candidate.pageUrl}
            score={candidate.score}
            size={candidate.naturalWidth && candidate.naturalHeight ? [candidate.naturalWidth, candidate.naturalHeight] : candidate.width && candidate.height ? [candidate.width, candidate.height] : null}
            inspection={candidate}
            variantOf={candidate.variantOf ? group.candidates.findIndex((other) => other.id === candidate.variantOf) + 1 : null}
            action={group.stale || candidate.source === "myspace-wayback-sin-copia" || candidate.quality === "failed" ? null : (
              <button type="button" className="btn btn--primary btn--sm btn--block" onClick={() => onDecide(candidate)}>
                <Check size={14} weight="bold" aria-hidden="true" />
                Usar esta
              </button>
            )}
          />
        ))}
      </div>
      <button type="button" className="btn btn--sm" onClick={onUpload}>Subir otra imagen</button>
    </article>
  );
}

const QUALITY_LABEL: Readonly<Record<string, string>> = { high: "Alta calidad", medium: "Calidad media", low: "Baja calidad", failed: "No se pudo descargar" };
const USE_LABEL: Readonly<Record<string, string>> = {
  cover: "Portada", back_cover: "Contraportada", portrait: "Retrato", group: "Foto de grupo", live: "En vivo",
  poster: "Afiche", irrelevant: "No sirve como imagen de la ficha", unknown: "Uso sin determinar",
};

function ImageTile({ label, url, pageUrl = null, score = null, size = null, current = false, action = null, inspection = null, variantOf = null }: {
  label: string; url: string | null; pageUrl?: string | null; score?: number | null; size?: [number, number] | null;
  current?: boolean; action?: ReactNode; inspection?: ImageCandidate | null; variantOf?: number | null;
}) {
  // El tamaño real se mide al cargar: la base no lo guarda para la imagen actual.
  const [natural, setNatural] = useState<[number, number] | null>(null);
  const [failed, setFailed] = useState(false);
  const shown = size ?? natural;
  return (
    <figure className={`img-tile${current ? " img-tile--current" : ""}`}>
      <a className="img-tile__frame" href={url ?? undefined} target="_blank" rel="noreferrer" aria-label={`Abrir imagen ${label.toLowerCase()} a tamaño completo`} title="Abrir la imagen a tamaño completo">
        {url && !failed ? (
          <img
            src={url} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer"
            onLoad={(event) => setNatural([event.currentTarget.naturalWidth, event.currentTarget.naturalHeight])}
            onError={() => setFailed(true)}
          />
        ) : <span className="img-tile__empty">{failed ? "No carga" : "Sin imagen"}</span>}
      </a>
      <figcaption className="img-tile__caption">
        <span className="img-tile__label">{label}</span>
        <span className="img-tile__facts">
          {shown ? `${shown[0]}×${shown[1]} px` : "—"}
          {score !== null ? ` · parecido ${Math.round(score * 100)} %` : ""}
        </span>
        {inspection?.quality ? (
          <span className={`img-tile__quality img-tile__quality--${inspection.quality}`}>
            {QUALITY_LABEL[inspection.quality]}
            {inspection.use && inspection.quality !== "failed" ? ` · ${USE_LABEL[inspection.use] ?? inspection.use}` : ""}
          </span>
        ) : null}
        {inspection?.effectiveWidth && inspection.naturalWidth && inspection.effectiveWidth < inspection.naturalWidth * 0.6
          ? <span className="img-tile__facts">Detalle real de unos {inspection.effectiveWidth} px de ancho</span> : null}
        {inspection?.context ? <span className="img-tile__facts">«{inspection.context}»</span> : null}
        {variantOf ? <span className="img-tile__facts">Variante de la candidata {variantOf}</span> : null}
        {inspection?.quality === "failed" ? <span className="img-tile__facts">{inspection.reasons[0]}</span> : null}
        {pageUrl ? (
          <a className="img-tile__source" href={pageUrl} target="_blank" rel="noreferrer">
            Ver en la fuente <ArrowSquareOut size={12} weight="bold" aria-hidden="true" />
          </a>
        ) : null}
      </figcaption>
      {action}
    </figure>
  );
}
