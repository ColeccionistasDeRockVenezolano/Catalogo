import { Fragment, useState } from "react";
import { Link } from "react-router-dom";
import { Buildings, Disc, ImageSquare } from "@phosphor-icons/react";
import { DeceasedMark } from "./DeceasedMark";
import { CatalogGenres, CatalogYear } from "./CatalogMetadata";
import type { PublicGenre } from "../lib/types";
import { mediaImage } from "../lib/media";

interface EntityCardProps {
  to: string;
  title: string;
  subtitle?: string | null | undefined;
  albumMetadata?: { artist: string; artistId: number; year: number | null; type: string; typeValue?: string; categories?: Array<{ key: string; label: string }> };
  imageUrl?: string | null | undefined;
  imageFit?: "cover" | "contain";
  placeholder: string;
  tag?: string | null | undefined;
  tagTitle?: string | undefined;
  deceased?: boolean | undefined;
  genres?: PublicGenre[] | undefined;
  year?: number | null | undefined;
  typeValue?: string | undefined;
  note?: string | null | undefined;
  noteTitle?: string | undefined;
}

export function EntityCard({ to, title, subtitle, albumMetadata, imageUrl, imageFit = "cover", placeholder, tag, tagTitle, deceased, genres, year, typeValue, note, noteTitle }: EntityCardProps) {
  const [failedImage, setFailedImage] = useState<string | null>(null);
  const hasImage = Boolean(imageUrl && failedImage !== imageUrl);
  const isAlbum = to.startsWith("/discos/");
  const isArtist = to.startsWith("/artistas/");
  const isOrganization = to.startsWith("/organizaciones/");
  const MissingIcon = isAlbum ? Disc : isOrganization ? Buildings : ImageSquare;
  const missingLabel = isAlbum ? "Sin portada" : "Sin imagen";
  const [typeLabel, ...otherSubtitle] = subtitle?.split(" · ") ?? [];
  return (
    <div className={`entity-card${albumMetadata ? " entity-card--album" : ""}`}>
      <Link to={to} aria-label={`Ver ${isAlbum ? "el disco" : "la ficha de"} ${title}`} className={`entity-card__art${hasImage ? "" : " entity-card__art--empty"}`}>
        {hasImage && imageUrl ? (
          <img {...mediaImage(imageUrl, 240)} alt="" loading="lazy" decoding="async" width="400" height="400"
            style={{ objectFit: imageFit }} onError={() => setFailedImage(imageUrl)} />
        ) : (
          <span className="entity-card__placeholder" aria-hidden="true">
            <span className="placeholder">{placeholder}</span>
            <span className="entity-card__missing"><MissingIcon size={16} aria-hidden="true" />{missingLabel}</span>
          </span>
        )}
      </Link>
      <div className="entity-card__body">
        <Link to={to} className="entity-card__title">{title}<DeceasedMark deceased={deceased} /></Link>
        {albumMetadata ? <>
          <Link to={`/artistas/${albumMetadata.artistId}`} className="entity-card__artist">{albumMetadata.artist}</Link>
          <span className="entity-card__edition">
            <CatalogYear year={albumMetadata.year} className="entity-card__year" />
            <span className="entity-card__edition-separator" aria-hidden="true">·</span>
            {albumMetadata.typeValue !== "other" || !albumMetadata.categories?.length ? albumMetadata.typeValue ? <Link className="entity-card__album-type" to={`/discos?tipo=${encodeURIComponent(albumMetadata.typeValue)}`}>{albumMetadata.type}</Link> : <span className="entity-card__album-type">{albumMetadata.type}</span> : null}
            {albumMetadata.categories?.map((category, index) => <Fragment key={category.key}>
              {albumMetadata.typeValue !== "other" || index > 0 ? <span className="entity-card__edition-separator" aria-hidden="true">·</span> : null}
              <Link className="entity-card__album-type" to={`/discos?tipo=${encodeURIComponent(category.key)}`}>{category.label}</Link>
            </Fragment>)}
          </span>
        </> : subtitle ? <span className="entity-card__sub">
          {isArtist && typeValue ? <><Link to={`/artistas?tipo=${encodeURIComponent(typeValue)}`}>{typeLabel}</Link>{otherSubtitle.length ? ` · ${otherSubtitle.join(" · ")}` : null}</> : subtitle}
        </span> : null}
        {!albumMetadata && year !== undefined && year !== null ? <CatalogYear year={year} kind={isArtist ? "artist" : "album"} className="entity-card__year" /> : null}
        {genres?.length ? <span className="entity-card__genres"><CatalogGenres genres={genres} kind={isArtist ? "artist" : "album"} className="entity-card__genre" /></span> : null}
        {note ? <span className="badge badge--violet entity-card__tag" title={noteTitle}>{note}</span> : null}
        {tag ? <span className="badge badge--amber entity-card__tag" title={tagTitle}>{tag}</span> : null}
      </div>
    </div>
  );
}

export function initialOf(name: string): string {
  return name.trim().charAt(0).toUpperCase() || "?";
}
