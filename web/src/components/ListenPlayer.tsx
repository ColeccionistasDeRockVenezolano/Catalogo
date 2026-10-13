import { useCallback, useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
import { ArrowSquareOut } from "@phosphor-icons/react";
import { platformMeta } from "./PlatformLinks";
import { preferredPlatform, type EmbedOption } from "../lib/embeds";

const STORAGE_KEY = "crv:escuchar-en";

function readStored(): string | null {
  try { return window.localStorage.getItem(STORAGE_KEY); } catch { return null; }
}

/**
 * Plataforma elegida a mano en esta página. La elección se recuerda en este navegador: quien
 * escucha en Spotify ve Spotify primero en cada disco que lo tenga. Va antes de cualquier
 * retorno temprano de la página; la activa se resuelve luego con `resolveListenPlatform`.
 */
export function useListenChoice(resetKey: string | number) {
  const [chosen, setChosen] = useState<{ key: string | number; platform: string } | null>(null);
  const choose = useCallback((platform: string) => {
    setChosen({ key: resetKey, platform });
    try { window.localStorage.setItem(STORAGE_KEY, platform); } catch { /* sin almacenamiento: solo esta página */ }
  }, [resetKey]);
  return [chosen?.key === resetKey ? chosen.platform : null, choose] as const;
}

export function resolveListenPlatform(available: readonly string[], chosen: string | null): string | null {
  return chosen && available.includes(chosen) ? chosen : preferredPlatform(available, readStored());
}

export interface ListenTab { platform: string; url: string }

/** Encabezado, selector de plataformas y el panel del reproductor activo. */
export function ListenSection({ heading, subject, tabs, active, onChange, children }: {
  heading: string; subject: string; tabs: ListenTab[]; active: string; onChange: (platform: string) => void; children: ReactNode;
}) {
  const id = useId();
  const list = useRef<HTMLDivElement>(null);
  const activeTab = tabs.find((tab) => tab.platform === active) ?? tabs[0];
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const keys: Record<string, number> = { ArrowRight: 1, ArrowLeft: -1, Home: -Infinity, End: Infinity };
    if (!(event.key in keys)) return;
    event.preventDefault();
    const index = tabs.findIndex((tab) => tab.platform === active);
    const step = keys[event.key]!;
    const next = step === -Infinity ? 0 : step === Infinity ? tabs.length - 1 : (index + step + tabs.length) % tabs.length;
    onChange(tabs[next]!.platform);
    list.current?.querySelectorAll<HTMLButtonElement>("[role=tab]")[next]?.focus();
  };
  // La pestaña activa siempre a la vista cuando la fila se desplaza (móvil).
  useEffect(() => {
    list.current?.querySelector<HTMLElement>("[aria-selected=true]")?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "instant" });
  }, [active]);
  if (!activeTab) return null;
  const meta = platformMeta(activeTab.platform);
  return (
    <div className="section listen-section">
      <h2>
        {heading}
        <a className="album-youtube-link" href={activeTab.url} target="_blank" rel="noreferrer">
          Abrir en {meta.label}<ArrowSquareOut size={13} aria-hidden="true" />
        </a>
      </h2>
      {tabs.length > 1 ? (
        <div ref={list} className="listen-switch" role="tablist" aria-label={`Escuchar ${subject} en`} onKeyDown={onKeyDown}>
          {tabs.map((tab) => {
            const { label, color, Icon } = platformMeta(tab.platform);
            const selected = tab.platform === activeTab.platform;
            return (
              <button key={tab.platform} type="button" role="tab" id={`${id}-${tab.platform}`} aria-selected={selected} aria-controls={`${id}-panel`}
                tabIndex={selected ? 0 : -1} className="listen-switch__tab" style={{ "--platform-color": color } as CSSProperties}
                onClick={() => onChange(tab.platform)}>
                <Icon size={18} aria-hidden="true" /><span>{label}</span>
              </button>
            );
          })}
        </div>
      ) : null}
      <div id={`${id}-panel`} role={tabs.length > 1 ? "tabpanel" : undefined} aria-labelledby={tabs.length > 1 ? `${id}-${activeTab.platform}` : undefined}>
        {children}
      </div>
    </div>
  );
}

/** El reproductor oficial de la plataforma; con varios (disco entero, «Lado A»…), uno a la vez. */
export function EmbedPanel({ option, subject, fullElsewhere }: { option: EmbedOption; subject: string; fullElsewhere: string | null }) {
  const [chosenKey, setChosenKey] = useState<string | null>(null);
  const target = option.targets.find((item) => item.key === chosenKey) ?? option.targets[0];
  const [loaded, setLoaded] = useState<string | null>(null);
  if (!target) return null;
  const { label } = platformMeta(option.platform);
  const { embed } = target;
  const style: CSSProperties = embed.height ? { height: embed.height } : { aspectRatio: "16 / 9" };
  return (
    <>
      {option.targets.length > 1 ? (
        <div className="album-disc-videos" role="group" aria-label={`Reproductores de ${label}`}>
          {option.targets.map((item) => (
            <button key={item.key} type="button" className={`album-disc-video album-disc-video--text${item.key === target.key ? " is-active" : ""}`}
              aria-pressed={item.key === target.key} onClick={() => setChosenKey(item.key)}>
              <span>{item.label ?? "Disco completo"}</span>
            </button>
          ))}
        </div>
      ) : null}
      <div className={`listen-embed${embed.height ? "" : " listen-embed--video"}${loaded === embed.src ? " is-loaded" : ""}`} style={style}>
        <iframe key={embed.src} src={embed.src} title={`${subject} en ${label}${target.label ? ` · ${target.label}` : ""}`}
          loading="lazy" allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture" allowFullScreen
          referrerPolicy="strict-origin-when-cross-origin" onLoad={() => setLoaded(embed.src)} />
      </div>
      {embed.previewsWithoutLogin ? (
        <p className="album-youtube-current">
          Sin sesión iniciada en {label} suenan fragmentos de 30 segundos.{fullElsewhere ? ` En ${platformMeta(fullElsewhere).label} suena completo.` : ""}
        </p>
      ) : null}
    </>
  );
}
