// CRV · Tarjeta de imágenes candidatas de una ficha: la imagen actual al lado de
// sus alternativas, con calidad, uso y fuente. La comparten la curaduría de
// imágenes y el recorrido «Investigar y completar» de cada ficha.
import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { ArrowSquareOut, Check, Warning, X } from "@phosphor-icons/react";
import type { ImageCandidate, ImageCandidateGroup } from "../lib/api";
import { imageGroupKey } from "../lib/imageCurationQueue";

export const SOURCE_LABEL: Readonly<Record<string, string>> = {
  deezer: "Deezer", musicbrainz: "MusicBrainz", discogs: "Discogs", spotify: "Spotify",
  "myspace-wayback": "MySpace · Wayback",
  "myspace-wayback-sin-copia": "MySpace · sin copia local",
};

/** Current image beside its candidates; «Usar esta» and «Dejar la actual» are the only decisions. */
export function ImageGroupCard({ group, onDecide, onUpload }: {
  group: ImageCandidateGroup; onDecide: (candidate: ImageCandidate | null) => void; onUpload?: (() => void) | undefined;
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
      {onUpload ? <button type="button" className="btn btn--sm" onClick={onUpload}>Subir otra imagen</button> : null}
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
