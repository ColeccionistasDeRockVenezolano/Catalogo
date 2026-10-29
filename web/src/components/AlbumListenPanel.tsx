import { useId, type CSSProperties, type ReactNode } from "react";
import { ArrowSquareOut, Info } from "@phosphor-icons/react";
import { platformMeta, type PlatformLink } from "./PlatformLinks";
import type { ListenTab } from "./ListenPlayer";
import { EMBED_ORDER } from "../lib/embeds";

const PLATFORM_ORDER: readonly string[] = [...EMBED_ORDER, "amazon_music", "qobuz"];

/** Conserva los enlaces registrados, incluso cuando la plataforma no ofrece un reproductor. */
export function AlbumListenPanel({ subject, links, tabs, active, onChange, hasVideo, children }: {
  subject: string;
  links: PlatformLink[];
  tabs: ListenTab[];
  active: string | null;
  onChange: (platform: string) => void;
  hasVideo: boolean;
  children: ReactNode;
}) {
  const panelId = useId();
  const available = [...links, ...tabs.filter((tab) => !links.some((link) => link.platform === tab.platform))];
  const rank = (platform: string) => {
    const index = PLATFORM_ORDER.indexOf(platform);
    return index < 0 ? PLATFORM_ORDER.length : index;
  };
  const ordered = available.sort((a, b) => rank(a.platform) - rank(b.platform));
  const selected = tabs.find((tab) => tab.platform === active);

  return (
    <section className="album-listen" aria-label={`Escuchar ${subject}`}>
      <h2>Escuchar en tu plataforma favorita</h2>
      <p className="album-listen__intro">{ordered.length ? "Disponible en estas plataformas de streaming." : "Todavía no hay plataformas de escucha registradas para este disco."}</p>
      {ordered.length ? (
        <ul className="album-listen__platforms" aria-label="Plataformas de escucha">
          {ordered.map((link) => {
            const { label, color, Icon } = platformMeta(link.platform);
            const playable = tabs.some((tab) => tab.platform === link.platform);
            return (
              <li key={link.platform} className="album-listen__platform" style={{ "--platform-color": color } as CSSProperties}>
                {playable ? <>
                  <button type="button" aria-label={`Escuchar ${subject} en ${label}`} aria-pressed={active === link.platform}
                    aria-controls={panelId} onClick={() => onChange(link.platform)}>
                    <Icon size={28} aria-hidden="true" /><span>{label}</span>
                  </button>
                  <a className="album-listen__open" href={link.url} target="_blank" rel="noreferrer noopener"
                    aria-label={`Abrir ${subject} en ${label} (nueva pestaña)`} title={`Abrir en ${label}`}>
                    <ArrowSquareOut size={16} aria-hidden="true" />
                  </a>
                </> : (
                  <a className="album-listen__external-platform" href={link.url} target="_blank" rel="noreferrer noopener"
                    aria-label={`Abrir ${subject} en ${label} (nueva pestaña)`}>
                    <Icon size={28} aria-hidden="true" /><span>{label}</span><ArrowSquareOut size={14} aria-hidden="true" />
                  </a>
                )}
              </li>
            );
          })}
        </ul>
      ) : null}
      {!hasVideo ? (
        <div className="album-listen__notice">
          <Info size={24} aria-hidden="true" />
          <div><p>Este disco no tiene un video de reproducción registrado.</p>
            {ordered.length ? <p>Puedes escucharlo en las plataformas disponibles.</p> : null}</div>
        </div>
      ) : null}
      <div id={panelId} className={selected ? "album-listen__player" : undefined}
        role={selected ? "region" : undefined} aria-label={selected ? `${subject} en ${platformMeta(selected.platform).label}` : undefined}>
        {children}
        {selected ? <a className="album-listen__player-link" href={selected.url} target="_blank" rel="noreferrer noopener">
          Abrir en {platformMeta(selected.platform).label}<ArrowSquareOut size={14} aria-hidden="true" />
        </a> : null}
      </div>
    </section>
  );
}
