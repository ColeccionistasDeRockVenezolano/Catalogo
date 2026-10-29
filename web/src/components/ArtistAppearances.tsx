import type { AppearanceItem } from "../lib/types";
import { albumClassificationBadges, albumTypeLabel } from "../lib/labels";
import { EntityCard, initialOf } from "./EntityCard";

const SECTIONS: Array<{ kind: AppearanceItem["kind"]; title: string }> = [
  { kind: "compilation", title: "Compilados y Various Artists" },
  { kind: "collaboration", title: "Colaboraciones e invitaciones" },
];

/** Solo el número («1 Pista», «3 Pistas»); los títulos van en el globo. */
function tracksNote(tracks: string[]): string | null {
  if (!tracks.length) return null;
  return `${tracks.length} ${tracks.length === 1 ? "Pista" : "Pistas"}`;
}

/**
 * «Aparece en»: discos de otros titulares donde suena el artista, calculados
 * por la API desde los créditos (no es una lista fija). Cada tarjeta lleva al
 * titular real del disco: Various Artists o la banda que lo invitó.
 */
export function ArtistAppearances({ items }: { items: AppearanceItem[] }) {
  return (
    <>
      {SECTIONS.map((section) => {
        const albums = items.filter((item) => item.kind === section.kind);
        if (!albums.length) return null;
        return (
          <section key={section.kind}>
            <h3 className="similar-reason">{section.title}</h3>
            <div className="grid-cards discography-grid">
              {albums.map((album) => (
                <EntityCard key={album.albumId} to={`/discos/${album.albumId}`} title={album.title}
                  albumMetadata={{ artist: album.ownerName, artistId: album.ownerId, year: album.releaseYear, type: albumTypeLabel(album.albumType), typeValue: album.albumType, categories: albumClassificationBadges(album) }}
                  genres={album.genres} imageUrl={album.coverUrl} imageFit="contain" placeholder={initialOf(album.title)}
                  note={tracksNote(album.tracks)} noteTitle={album.tracks.length ? album.tracks.join(" · ") : undefined} />
              ))}
            </div>
          </section>
        );
      })}
    </>
  );
}
