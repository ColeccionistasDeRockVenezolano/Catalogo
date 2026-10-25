import { useCallback, useEffect, useId, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { ArrowSquareOut, Play } from "@phosphor-icons/react";
import { platformMeta } from "./PlatformLinks";
import { preferredPlatform, type EmbedOption } from "../lib/embeds";
import { useExternalMedia } from "./ExternalMediaPlayer";

const STORAGE_KEY = "crv:escuchar-en";
function readStored(): string | null {
  try { return window.localStorage.getItem(STORAGE_KEY); } catch { return null; }
}
export function useListenChoice(resetKey: string | number) {
  const [chosen, setChosen] = useState<{ key: string | number; platform: string } | null>(null);
  const choose = useCallback((platform: string) => {
    setChosen({ key: resetKey, platform });
    try { window.localStorage.setItem(STORAGE_KEY, platform); } catch { /* Solo esta página. */ }
  }, [resetKey]);
  return [chosen?.key === resetKey ? chosen.platform : null, choose] as const;
}
export function resolveListenPlatform(available: readonly string[], chosen: string | null, prefer?: string): string | null {
  if (chosen && available.includes(chosen)) return chosen;
  if (prefer && available.includes(prefer)) return prefer;
  return preferredPlatform(available, readStored());
}
export interface ListenTab { platform: string; url: string }
export function ListenSection({ heading, subject, tabs, active, onChange, children }: {
  heading: string | null; subject: string; tabs: ListenTab[]; active: string; onChange: (platform: string) => void; children: ReactNode;
}) {
  const id = useId();
  const list = useRef<HTMLDivElement>(null);
  const activeTab = tabs.find(tab => tab.platform === active) ?? tabs[0];
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const keys: Record<string, number> = { ArrowRight: 1, ArrowLeft: -1, Home: -Infinity, End: Infinity };
    if (!(event.key in keys)) return;
    event.preventDefault();
    const index = tabs.findIndex(tab => tab.platform === active);
    const step = keys[event.key]!;
    const next = step === -Infinity ? 0 : step === Infinity ? tabs.length - 1 : (index + step + tabs.length) % tabs.length;
    onChange(tabs[next]!.platform);
    list.current?.querySelectorAll<HTMLButtonElement>("[role=tab]")[next]?.focus();
  };
  useEffect(() => { list.current?.querySelector<HTMLElement>("[aria-selected=true]")?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "instant" }); }, [active]);
  if (!activeTab) return null;
  const meta = platformMeta(activeTab.platform);
  return <div className="section listen-section" aria-label={heading ? undefined : `Escuchar ${subject}`} role={heading ? undefined : "region"}>
    {heading ? <h2>{heading}<a className="album-youtube-link" href={activeTab.url} target="_blank" rel="noreferrer">Abrir en {meta.label}<ArrowSquareOut size={13} aria-hidden="true" /></a></h2> : null}
    {tabs.length > 1 ? <div ref={list} className="listen-switch" role="tablist" aria-label={`Escuchar ${subject} en`} onKeyDown={onKeyDown}>
      {tabs.map(tab => {
        const { label, color, Icon } = platformMeta(tab.platform);
        const selected = tab.platform === activeTab.platform;
        return <button key={tab.platform} type="button" role="tab" id={`${id}-${tab.platform}`} aria-selected={selected} aria-controls={`${id}-panel`} tabIndex={selected ? 0 : -1} className="listen-switch__tab" style={{ "--platform-color": color } as CSSProperties} onClick={() => onChange(tab.platform)}><Icon size={18} aria-hidden="true" /><span>{label}</span></button>;
      })}
    </div> : null}
    <div id={`${id}-panel`} role={tabs.length > 1 ? "tabpanel" : undefined} aria-labelledby={tabs.length > 1 ? `${id}-${activeTab.platform}` : undefined}>{children}</div>
  </div>;
}

/** Native widgets are visible immediately; their persistent host survives route changes. */
export function EmbedPanel({ option, subject, fullElsewhere, previewNote = true, embeddedVideo = false }: {
  option: EmbedOption; subject: string; fullElsewhere: string | null; previewNote?: boolean; embeddedVideo?: boolean;
}) {
  const [chosenKey, setChosenKey] = useState<string | null>(null);
  const [opened, setOpened] = useState(false);
  const target = option.targets.find(item => item.key === chosenKey) ?? option.targets[0];
  const { register, show } = useExternalMedia();
  const { pathname, search } = useLocation();
  const source = useMemo(() => target ? ({ id: target.key, subject, label: platformMeta(option.platform).label, url: target.url, path: `${pathname}${search}`, embed: target.embed,
    video: !embeddedVideo && (target.embed.height === null || /embed\.tidal\.com\/videos\//.test(target.embed.src)),
  }) : null, [target, subject, option.platform, pathname, search, embeddedVideo]);
  const slot = useCallback((node: HTMLDivElement | null) => {
    if (source && (!source.video || opened)) register(source, node);
  }, [source, opened, register]);
  if (!source) return null;
  return <>
    {option.targets.length > 1 ? <div className="album-disc-videos" role="group" aria-label={`Reproductores de ${source.label}`}>
      {option.targets.map(item => <button key={item.key} type="button" className={`album-disc-video album-disc-video--text${item.key === target?.key ? " is-active" : ""}`} aria-pressed={item.key === target?.key} onClick={() => setChosenKey(item.key)}><span>{item.label ?? "Disco completo"}</span></button>)}
    </div> : null}
    {source.video ? <button type="button" className="btn media-video-launch" onClick={() => { setOpened(true); show(source.id); }}><Play size={20} weight="fill" /> Abrir video de {subject}</button> : null}
    <div ref={slot} className={`external-media-slot${source.video ? " external-media-slot--video" : ""}`} />
    {previewNote && source.embed.previewsWithoutLogin ? <p className="album-youtube-current">Sin sesión iniciada en {source.label} suenan fragmentos de 30 segundos.{fullElsewhere ? ` En ${platformMeta(fullElsewhere).label} suena completo.` : ""}</p> : null}
  </>;
}
