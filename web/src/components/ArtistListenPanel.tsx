import type { CSSProperties } from "react";
import { ArrowSquareOut } from "@phosphor-icons/react";
import { ARTIST_EMBED_ORDER, type EmbedOption } from "../lib/embeds";
import { EmbedPanel } from "./ListenPlayer";
import { platformMeta, type PlatformLink } from "./PlatformLinks";

/** Los perfiles con reproductor lo seleccionan; los demás abren su enlace oficial. */
export function ArtistListenPanel({ subject, links, options, selected, onChange }: {
  subject: string;
  links: PlatformLink[];
  options: EmbedOption[];
  selected: EmbedOption | null;
  onChange: (platform: string) => void;
}) {
  const ordered = [...links].sort((a, b) => {
    const rank = (platform: string) => {
      const index = (ARTIST_EMBED_ORDER as readonly string[]).indexOf(platform);
      return index < 0 ? ARTIST_EMBED_ORDER.length : index;
    };
    return rank(a.platform) - rank(b.platform);
  });

  return (
    <section className="artist-listen" aria-label={`Escuchar a ${subject}`}>
      <h2>Escuchar artista</h2>
      <p className="artist-listen__intro">Disponible en estas plataformas de streaming.</p>
      <ul className="artist-listen__platforms" aria-label="Plataformas de escucha">
        {ordered.map((link) => {
          const { label, color, Icon } = platformMeta(link.platform);
          const playable = options.some((option) => option.platform === link.platform);
          const style = { "--platform-color": color } as CSSProperties;
          return (
            <li key={link.platform}>
              {playable ? (
                <button type="button" className="artist-listen__platform" style={style}
                  aria-label={`Escuchar a ${subject} en ${label}`} aria-pressed={selected?.platform === link.platform}
                  onClick={() => onChange(link.platform)}>
                  <Icon size={24} aria-hidden="true" /><span>{label}</span>
                </button>
              ) : (
                <a className="artist-listen__platform" style={style} href={link.url} target="_blank" rel="noreferrer noopener"
                  aria-label={`Abrir a ${subject} en ${label} (nueva pestaña)`}>
                  <Icon size={24} aria-hidden="true" /><span>{label}</span><ArrowSquareOut size={12} aria-hidden="true" />
                </a>
              )}
            </li>
          );
        })}
      </ul>
      {selected ? (
        <div className="artist-listen__player" aria-label={`${subject} en ${platformMeta(selected.platform).label}`}>
          {selected.targets[0]?.label ? <p className="artist-listen__video-title">{selected.targets[0].label}</p> : null}
          <EmbedPanel key={selected.platform} option={selected} subject={subject} fullElsewhere={null} previewNote={false} />
          <a className="artist-listen__external" href={selected.targets[0]!.url} target="_blank" rel="noreferrer noopener">
            Abrir en {platformMeta(selected.platform).label}<ArrowSquareOut size={13} aria-hidden="true" />
          </a>
        </div>
      ) : null}
    </section>
  );
}
