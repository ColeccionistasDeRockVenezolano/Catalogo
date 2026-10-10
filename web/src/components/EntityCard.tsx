import { useState } from "react";
import { Link } from "react-router-dom";
import { Buildings, Disc, ImageSquare } from "@phosphor-icons/react";
import { DeceasedMark } from "./DeceasedMark";

interface EntityCardProps {
  to: string;
  title: string;
  subtitle?: string | null | undefined;
  albumMetadata?: { artist: string; year: number | null; type: string };
  imageUrl?: string | null | undefined;
  imageFit?: "cover" | "contain";
  placeholder: string;
  tag?: string | null | undefined;
  tagTitle?: string | undefined;
  deceased?: boolean | undefined;
  /** Género principal confirmado, en una línea propia bajo el subtítulo. */
  genre?: string | null | undefined;
  /** Marca de referencia (violeta) cuando la ficha entró al filtro por una relación, no por su género. */
  note?: string | null | undefined;
  noteTitle?: string | undefined;
}

export function EntityCard({ to, title, subtitle, albumMetadata, imageUrl, imageFit = "cover", placeholder, tag, tagTitle, deceased, genre, note, noteTitle }: EntityCardProps) {
  const [failedImage, setFailedImage] = useState<string | null>(null);
  const hasImage = Boolean(imageUrl && failedImage !== imageUrl);
  const isAlbum = to.startsWith("/discos/");
  const isOrganization = to.startsWith("/organizaciones/");
  const MissingIcon = isAlbum ? Disc : isOrganization ? Buildings : ImageSquare;
  const missingLabel = isAlbum ? "Sin portada" : "Sin imagen";
  return (
    <Link to={to} className={`entity-card${albumMetadata ? " entity-card--album" : ""}`}>
      <span className={`entity-card__art${hasImage ? "" : " entity-card__art--empty"}`}>
        {hasImage && imageUrl ? (
          <img src={imageUrl} alt="" loading="lazy" decoding="async" width="400" height="400"
            style={{ objectFit: imageFit }} onError={() => setFailedImage(imageUrl)} />
        ) : (
          <span className="entity-card__placeholder" aria-hidden="true">
            <span className="placeholder">{placeholder}</span>
            <span className="entity-card__missing"><MissingIcon size={16} aria-hidden="true" />{missingLabel}</span>
          </span>
        )}
      </span>
      <span className="entity-card__body">
        <span className="entity-card__title">{title}<DeceasedMark deceased={deceased} /></span>
        {albumMetadata ? <>
          <span className="entity-card__artist">{albumMetadata.artist}</span>
          <span className="entity-card__edition">
            <span className="entity-card__year"><span className="visually-hidden">Año de lanzamiento: </span>{albumMetadata.year ?? "Sin año"}</span>
            <span className="entity-card__edition-separator" aria-hidden="true">·</span>
            <span className="entity-card__album-type">{albumMetadata.type}</span>
          </span>
        </> : subtitle ? <span className="entity-card__sub">{subtitle}</span> : null}
        {genre ? <span className="entity-card__genre">{genre}</span> : null}
        {note ? <span className="badge badge--violet entity-card__tag" title={noteTitle}>{note}</span> : null}
        {tag ? <span className="badge badge--amber entity-card__tag" title={tagTitle}>{tag}</span> : null}
      </span>
    </Link>
  );
}

export function initialOf(name: string): string {
  return name.trim().charAt(0).toUpperCase() || "?";
}
