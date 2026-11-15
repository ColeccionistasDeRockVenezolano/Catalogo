// CRV · Pantalla de error del catálogo (modelo «servidores recibiendo cariño»).
// Solo el contenido central: el header y el footer los pone el Layout.
// No dice qué falló ni cómo se maneja; muestra un código de referencia que
// coincide con la entrada del log (ver lib/clientErrors.ts).
//
// Sin hooks de proveedores: también la pinta el ErrorBoundary raíz, fuera
// del router, la sesión y el i18n.
import { useEffect, useId, useRef, useState } from "react";
import { ArrowClockwise, ArrowUpRight, Coffee, Copy, Check } from "@phosphor-icons/react";
import handUrl from "../assets/service-error/mano.webp";
import serverUrl from "../assets/service-error/servidor.webp";
import "../styles/service-error.css";

export type ServiceErrorVariant = "unavailable" | "unexpected";

const DONATION_URL = "https://buymeacoffee.com/rockvenezolano";

const COPY = {
  es: {
    unavailable: { eyebrow: "Servicio temporalmente ocupado", title: "Nuestros servidores están recibiendo", highlight: "mucho cariño.", lead: "Ayúdanos a pagar unos más grandes para que esto no suceda tan a menudo durante tus búsquedas." },
    unexpected: { eyebrow: "Una pausa en la canción", title: "Esta página se nos", highlight: "desafinó.", lead: "Ya lo anotamos para afinarlo. Puedes reintentar o seguir explorando el catálogo mientras tanto." },
    retry: "Reintentar",
    help: "Ayudar",
    helpLabel: "Ayudar a CRV en Buy Me a Coffee (abre en una nueva pestaña)",
    footnote: "Tu apoyo ayuda a mantener viva la memoria del rock venezolano.",
    reference: "Si vuelve a pasar, comparte este código:",
    copy: "Copiar código",
    copied: "Copiado",
  },
  en: {
    unavailable: { eyebrow: "Service temporarily busy", title: "Our servers are getting", highlight: "a lot of love.", lead: "Help us pay for bigger ones so this doesn't happen so often while you search." },
    unexpected: { eyebrow: "A pause in the song", title: "This page went", highlight: "out of tune.", lead: "We've noted it so we can tune it up. You can try again or keep exploring the catalog meanwhile." },
    retry: "Try again",
    help: "Help us",
    helpLabel: "Support CRV on Buy Me a Coffee (opens in a new tab)",
    footnote: "Your support helps keep the memory of Venezuelan rock alive.",
    reference: "If it happens again, share this code:",
    copy: "Copy code",
    copied: "Copied",
  },
} as const;

function currentLang(): "es" | "en" {
  // El I18nProvider sincroniza <html lang>; fuera de él queda la preferencia guardada.
  if (document.documentElement.lang.startsWith("en")) return "en";
  try { return localStorage.getItem("crv-lang") === "en" ? "en" : "es"; } catch { return "es"; }
}

export function ServiceErrorPage({ code, variant = "unavailable", onRetry, heading = "h2" }: {
  code: string;
  variant?: ServiceErrorVariant;
  /** Sin onRetry, «Reintentar» recarga la página. */
  onRetry?: (() => void) | undefined;
  /** h1 cuando la pantalla sustituye a la página entera. */
  heading?: "h1" | "h2";
}) {
  const titleId = useId();
  const text = COPY[currentLang()];
  const copy = text[variant];
  const [retrying, setRetrying] = useState(false);
  const [copied, setCopied] = useState(false);
  const timers = useRef<number[]>([]);
  useEffect(() => () => timers.current.forEach((timer) => window.clearTimeout(timer)), []);
  const later = (fn: () => void, ms: number) => { timers.current.push(window.setTimeout(fn, ms)); };

  const retry = () => {
    setRetrying(true);
    // El giro breve confirma el toque antes de que cambie la pantalla.
    later(() => {
      if (onRetry) { setRetrying(false); onRetry(); } else window.location.reload();
    }, 350);
  };

  const copyCode = () => {
    void navigator.clipboard?.writeText(code).then(() => {
      setCopied(true);
      later(() => setCopied(false), 1800);
    }, () => undefined);
  };

  const Heading = heading;
  return (
    <section className="svc-error" role="alert" aria-labelledby={titleId}>
      <div className="svc-error__layout">
        <div className="svc-error__art" aria-hidden="true">
          <div className="svc-error__frame">
            <span className="svc-error__halo svc-error__halo--a" />
            <span className="svc-error__halo svc-error__halo--b" />
            <img className="svc-error__server" src={serverUrl} alt="" width={640} height={640} decoding="async" />
            <img className="svc-error__hand" src={handUrl} alt="" width={900} height={383} decoding="async" />
          </div>
          <div className="svc-error__label"><span className="svc-error__label-line" /><span>CRV <span className="svc-error__slash">/</span> Archivo</span></div>
        </div>

        <div className="svc-error__message">
          <p className="svc-error__eyebrow"><span className="svc-error__pulse" />{copy.eyebrow}</p>
          <Heading id={titleId} className="svc-error__title">
            {copy.title} <span className="svc-error__highlight">{copy.highlight}</span>
          </Heading>
          <p className="svc-error__lead">{copy.lead}</p>
          <div className="svc-error__actions">
            <button type="button" className={`svc-error__retry${retrying ? " is-loading" : ""}`} onClick={retry} disabled={retrying}>
              <ArrowClockwise className="svc-error__retry-icon" weight="bold" aria-hidden="true" />
              <span>{text.retry}</span>
            </button>
            <a className="svc-error__help" href={DONATION_URL} target="_blank" rel="noopener noreferrer" aria-label={text.helpLabel}>
              <Coffee className="svc-error__help-icon" weight="fill" aria-hidden="true" />
              <span>{text.help}</span>
              <ArrowUpRight className="svc-error__help-external" weight="bold" aria-hidden="true" />
            </a>
          </div>
          <p className="svc-error__reference">
            <span>{text.reference}</span>
            <button type="button" className="svc-error__code" onClick={copyCode} title={text.copy}>
              <code>{code}</code>
              {copied ? <Check weight="bold" aria-hidden="true" /> : <Copy aria-hidden="true" />}
              <span className="visually-hidden" aria-live="polite">{copied ? text.copied : text.copy}</span>
            </button>
          </p>
          <p className="svc-error__footnote"><span className="svc-error__footnote-line" />{text.footnote}</p>
        </div>
      </div>
    </section>
  );
}
