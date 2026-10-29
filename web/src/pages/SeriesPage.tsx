import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { BackLink } from "../components/BackLink";
import { DetailSkeleton } from "../components/Skeletons";
import { EntityLoadError } from "../components/RemovedEntityState";
import { initialOf } from "../components/EntityCard";
import { CatalogYear } from "../components/CatalogMetadata";
import { EntityAdminBar } from "../components/EntityAdminBar";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { SERIES_HIDDEN_REASON, SeriesEntriesEditor, SeriesFormModal, SeriesStatus, useReloadOnCatalogChange } from "../components/SeriesEditor";
import { discographyApi, seriesEditorApi } from "../lib/api";
import { useAsync } from "../lib/useAsync";
import { mediaImage } from "../lib/media";
import { useOperator } from "../lib/OperatorContext";
import { useToast } from "../lib/ToastContext";
import type { SeriesDetail, SeriesEditorDetail } from "../lib/types";

/** Lo que vería el público: solo las fichas visibles del catálogo. */
function publicShape(series: SeriesEditorDetail): SeriesDetail {
  return {
    id: series.id, title: series.title, description: series.description, kind: series.kind, artist: series.artist, organization: series.organization,
    volumes: series.entries.filter((entry) => entry.visible).map(({ albumId, title, artistId, artistName, releaseYear, coverUrl, volumeNumber, volumeLabel }) =>
      ({ albumId, title, artistId, artistName, releaseYear, coverUrl, volumeNumber, volumeLabel })),
  };
}

/** Página de una serie (plan del primo, punto 13): sus volúmenes en orden, como en Discogs.
 *  La administración la lee desde el editor: ve también las series ocultas y las corrige aquí. */
export function SeriesPage() {
  const { id } = useParams();
  const seriesId = Number(id);
  const { isAdmin } = useOperator();
  const navigate = useNavigate();
  const { notify } = useToast();
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const { data, loading, error, errorValue, reload } = useAsync(
    async () => isAdmin ? { editor: await seriesEditorApi.get(seriesId), published: null } : { editor: null, published: await discographyApi.series(seriesId) },
    [seriesId, isAdmin],
  );
  useReloadOnCatalogChange(reload);
  const editor = data?.editor ?? null;
  const series = editor ? publicShape(editor) : data?.published ?? null;
  if (loading && (!series || series.id !== seriesId)) return <DetailSkeleton />;
  if (error || !series) return <EntityLoadError message={error ?? "Serie no encontrada."} errorValue={errorValue} onRetry={reload} />;
  const cover = series.volumes.find((volume) => volume.coverUrl)?.coverUrl ?? null;

  return (
    <>
      <nav className="series-page-nav" aria-label="Navegación de series">
        <BackLink fallback="/series" />
        <Link to="/series" className="series-index-link">Todas las series de compilados</Link>
      </nav>
      {editor ? <>
        <EntityAdminBar onEdit={() => setEditing(true)} onRemove={() => setDeleting(true)} />
        <p className="hint" role="status" style={{ margin: "0 0 16px" }}>
          <SeriesStatus isPublic={editor.isPublic} hiddenReason={editor.hiddenReason} />{" "}
          {editor.hiddenReason ? SERIES_HIDDEN_REASON[editor.hiddenReason] : "Aparece en /series y en «En esta serie» de cada disco."}
          {editor.notes ? <><br />Notas internas: {editor.notes}</> : null}
        </p>
      </> : null}
      <div className="entity-hero">
        <span className="entity-hero__art">{cover ? <img {...mediaImage(cover, 132)} alt="" loading="lazy" decoding="async" /> : <span className="placeholder">{initialOf(series.title)}</span>}</span>
        <div>
          <p className="entity-hero__kicker">{series.kind === "sessions" ? "Serie de sesiones" : "Serie"}</p>
          <h1 className="entity-hero__title">{series.title}</h1>
          <p style={{ margin: "6px 0 0" }}>
            {series.artist ? <Link to={`/artistas/${series.artist.id}`} style={{ fontWeight: 600, color: "var(--text)" }}>{series.artist.name}</Link> : null}
            {series.organization ? <> · <Link to={`/organizaciones/${series.organization.id}`}>{series.organization.name}</Link></> : null}
          </p>
          {series.description ? <p className="entity-hero__desc">{series.description}</p> : null}
        </div>
      </div>

      <div className="section">
        <h2>{series.kind === "sessions" ? "Sesiones" : "Compilados"} <span className="mono" style={{ color: "var(--text-faint)", fontWeight: 400 }}>({series.volumes.length})</span></h2>
        <ol className="series-volumes">
          {series.volumes.map((volume) => (
            <li key={volume.albumId} className="series-volume">
              <Link to={`/discos/${volume.albumId}`} className="series-volume__art" aria-hidden="true" tabIndex={-1}>
                {volume.coverUrl ? <img {...mediaImage(volume.coverUrl, 160)} alt="" loading="lazy" decoding="async" /> : <span className="placeholder">{initialOf(volume.title)}</span>}
              </Link>
              <div>
                <p className="series-volume__label">{volume.volumeLabel ?? "Entrega"}</p>
                <Link to={`/discos/${volume.albumId}`} className="series-volume__title">{volume.title}</Link>
                <Link to={`/artistas/${volume.artistId}`} className="series-volume__artist">{volume.artistName}</Link>
                <p className="series-volume__year"><CatalogYear year={volume.releaseYear}>{volume.releaseYear ?? "Año sin dato"}</CatalogYear></p>
              </div>
            </li>
          ))}
        </ol>
      </div>

      {editor ? <div className="section"><SeriesEntriesEditor series={editor} onChanged={reload} /></div> : null}
      {editor && editing ? <SeriesFormModal series={editor} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); reload(); }} /> : null}
      {editor && deleting ? (
        <ConfirmDialog title={`Borrar la serie «${editor.title}»`} danger confirmLabel="Borrar serie"
          description={`Se retiran la serie y sus ${editor.entries.length} vínculos de entrega. Los discos conservan sus fichas. El cambio puede deshacerse.`}
          onClose={() => setDeleting(false)}
          onConfirm={async (note) => {
            await seriesEditorApi.remove(editor.id, note);
            notify("success", "Serie borrada.");
            navigate("/series");
          }} />
      ) : null}
    </>
  );
}
