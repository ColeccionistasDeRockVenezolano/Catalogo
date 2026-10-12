import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import type { PublicGenre } from "../lib/types";
import { decadeHref, genreHref } from "../lib/routes";

export function CatalogYear({ year, kind = "album", children, className }: { year: number | null; kind?: "album" | "artist"; children?: ReactNode; className?: string }) {
  return year === null ? <span className={className}>{children ?? "Sin año"}</span> :
    <Link className={className} to={decadeHref(year, kind)} title={`Ver ${kind === "album" ? "discos" : "artistas"} de esta década`}>{children ?? year}</Link>;
}

export function CatalogGenres({ genres, kind = "album", className }: { genres: readonly PublicGenre[]; kind?: "album" | "artist"; className?: string }) {
  return <>{genres.map(genre => <Link key={genre.id} className={className} to={genreHref(genre, kind)} title={`Ver más ${kind === "album" ? "discos" : "artistas"} de ${genre.name}`}>{genre.name}</Link>)}</>;
}

/** Conserva el texto documentado del período y enlaza cada año por separado. */
export function CatalogPeriod({ text, kind = "artist" }: { text: string | null; kind?: "album" | "artist" }) {
  if (!text) return null;
  return <>{text.split(/(\b(?:19|20)\d{2}\b)/).map((part, index) => /^\d{4}$/.test(part) ? <CatalogYear key={index} year={Number(part)} kind={kind} /> : part)}</>;
}
