import { Link, useParams } from "react-router-dom";
import { BackLink } from "../components/BackLink";
import { DetailSkeleton } from "../components/Skeletons";
import { EntityLoadError } from "../components/RemovedEntityState";
import { EntityInfo, type InfoItem } from "../components/EntityInfo";
import { initialOf } from "../components/EntityCard";
import { CatalogYear } from "../components/CatalogMetadata";
import { discographyApi } from "../lib/api";
import { useAsync } from "../lib/useAsync";
import { creditRoleGroupLabel } from "../lib/labels";

const PLACE_TYPE: Record<string, string> = { city: "Ciudad", region: "Región", country: "País", area: "Zona" };

/**
 * Página de un lugar (plan del primo, punto 8): sus estudios y los discos
 * grabados, mezclados o masterizados ahí, por rol. Se llega desde la frase de
 * créditos («(Hollywood, CA)») y desde la página del estudio.
 */
export function PlacePage() {
  const { id } = useParams();
  const placeId = Number(id);
  const { data: place, loading, error, errorValue, reload } = useAsync(() => discographyApi.place(placeId), [placeId]);
  if (loading && (!place || place.id !== placeId)) return <DetailSkeleton />;
  if (error || !place) return <EntityLoadError message={error ?? "Lugar no encontrado."} errorValue={errorValue} onRetry={reload} />;

  const info: InfoItem[] = [
    { label: "Tipo", value: PLACE_TYPE[place.placeType] ?? place.placeType },
    { label: "Región", value: place.placeType === "city" ? place.region : null },
    { label: "Dentro de", value: place.parent ? <Link to={`/lugares/${place.parent.id}`}>{place.parent.name}</Link> : null },
    { label: "También escrito", value: place.aliases.length ? place.aliases.join(" · ") : null },
  ];

  return (
    <>
      <BackLink fallback="/organizaciones" />
      <div className="entity-hero">
        <span className="entity-hero__art"><span className="placeholder">{initialOf(place.name)}</span></span>
        <div>
          <h1 className="entity-hero__title">{place.name}</h1>
          <EntityInfo items={info} />
        </div>
      </div>

      {place.children.length ? (
        <div className="section">
          <h2>Lugares dentro de {place.name}</h2>
          <ul className="chip-list">
            {place.children.map((child) => <li key={child.id} className="chip"><Link to={`/lugares/${child.id}`}>{child.name}</Link></li>)}
          </ul>
        </div>
      ) : null}

      <div className="section">
        <h2>Estudios <span className="mono" style={{ color: "var(--text-faint)", fontWeight: 400 }}>({place.studios.length})</span></h2>
        {place.studios.length === 0 ? <p className="muted-note">Sin estudios registrados aquí.</p> : (
          <ul className="chip-list">
            {place.studios.map((studio) => (
              <li key={studio.id} className="chip">
                <Link to={`/organizaciones/${studio.id}`}>{studio.name}</Link>
                {studio.albumCount ? <span className="chip__count">{studio.albumCount}</span> : null}
              </li>
            ))}
          </ul>
        )}
      </div>

      {place.albumsByRole.map((group) => (
        <div className="section" key={group.roleKey}>
          <h2>{creditRoleGroupLabel(group.roleKey)} aquí <span className="mono" style={{ color: "var(--text-faint)", fontWeight: 400 }}>({group.albums.length})</span></h2>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Disco</th><th>Artista</th><th>Estudio</th><th className="num">Año</th></tr></thead>
              <tbody>
                {group.albums.map((album) => (
                  <tr key={album.albumId}>
                    <td><Link to={`/discos/${album.albumId}`}>{album.title}</Link></td>
                    <td><Link to={`/artistas/${album.artistId}`}>{album.artistName}</Link></td>
                    <td>{album.studios.map((studio, index) => <span key={studio.id}>{index ? ", " : ""}<Link to={`/organizaciones/${studio.id}`}>{studio.name}</Link></span>)}</td>
                    <td className="num"><CatalogYear year={album.releaseYear}>{album.releaseYear ?? "—"}</CatalogYear></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </>
  );
}
