import { Link, useParams } from "react-router-dom";
import { BackLink } from "../components/BackLink";
import { DetailSkeleton } from "../components/Skeletons";
import { EntityLoadError } from "../components/RemovedEntityState";
import { initialOf } from "../components/EntityCard";
import { CatalogYear } from "../components/CatalogMetadata";
import { discographyApi } from "../lib/api";
import { useAsync } from "../lib/useAsync";

/** Página de una serie (plan del primo, punto 13): sus volúmenes en orden, como en Discogs. */
export function SeriesPage() {
  const { id } = useParams();
  const seriesId = Number(id);
  const { data: series, loading, error, errorValue, reload } = useAsync(() => discographyApi.series(seriesId), [seriesId]);
  if (loading && (!series || series.id !== seriesId)) return <DetailSkeleton />;
  if (error || !series) return <EntityLoadError message={error ?? "Serie no encontrada."} errorValue={errorValue} onRetry={reload} />;
  const cover = series.volumes.find((volume) => volume.coverUrl)?.coverUrl ?? null;

  return (
    <>
      <BackLink fallback="/discos" />
      <div className="entity-hero">
        <span className="entity-hero__art">{cover ? <img src={cover} alt="" loading="lazy" decoding="async" /> : <span className="placeholder">{initialOf(series.title)}</span>}</span>
        <div>
          <p className="entity-hero__kicker">Serie</p>
          <h1 className="entity-hero__title">{series.title}</h1>
          <p style={{ margin: "6px 0 0" }}>
            {series.artist ? <Link to={`/artistas/${series.artist.id}`} style={{ fontWeight: 600, color: "var(--text)" }}>{series.artist.name}</Link> : null}
            {series.organization ? <> · <Link to={`/organizaciones/${series.organization.id}`}>{series.organization.name}</Link></> : null}
          </p>
          {series.description ? <p className="entity-hero__desc">{series.description}</p> : null}
        </div>
      </div>

      <div className="section">
        <h2>Volúmenes <span className="mono" style={{ color: "var(--text-faint)", fontWeight: 400 }}>({series.volumes.length})</span></h2>
        <ol className="series-volumes">
          {series.volumes.map((volume) => (
            <li key={volume.albumId} className="series-volume">
              <Link to={`/discos/${volume.albumId}`} className="series-volume__art" aria-hidden="true" tabIndex={-1}>
                {volume.coverUrl ? <img src={volume.coverUrl} alt="" loading="lazy" decoding="async" /> : <span className="placeholder">{initialOf(volume.title)}</span>}
              </Link>
              <div>
                <p className="series-volume__label">{volume.volumeLabel ?? "Sin número"}</p>
                <Link to={`/discos/${volume.albumId}`} className="series-volume__title">{volume.title}</Link>
                <p className="series-volume__year"><CatalogYear year={volume.releaseYear}>{volume.releaseYear ?? "Año sin dato"}</CatalogYear></p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </>
  );
}
