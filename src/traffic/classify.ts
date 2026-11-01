// Clasificación de una petición: persona probable, sospechosa, IA, buscador u
// otro bot.
//
// Portado de Herra 1.1.36 (`dist/traffic/classify.js`) para la ventana 3.7.
// Es PROBABILÍSTICA y se presenta así en el panel. Un rastreador que se declara
// se reconoce siempre; un agente que conduce un Chrome real con un User-Agent
// normal no deja rastro fiable en las cabeceras y pasará por persona. Lo que sí
// se puede detectar es la imitación torpe: un User-Agent de navegador moderno
// sin las cabeceras que ese navegador manda siempre.
//
// La función es pura a propósito: recibe señales ya extraídas y devuelve una
// decisión, así que se prueba sin servidor (classify.test.ts).
import { isbot } from "isbot";
import {
  CHATGPT_AGENT_KEY, matchAgent, NO_USER_AGENT_KEY, OTHER_BOT_KEY, SIGNED_AGENT_KEY, type AgentCategory,
} from "./agents.js";

export type TrafficCategory = "human" | "suspicious" | AgentCategory;
export const TRAFFIC_CATEGORIES: readonly TrafficCategory[] = ["human", "ai", "search", "bot", "suspicious"];

// `navigation`: una página pedida por la barra de direcciones o un enlace.
// `beacon`: el aviso que manda el JavaScript de la portada tras cargar.
export type RequestKind = "navigation" | "beacon";

/** Cabeceras tal como las expone Fastify (`request.headers`). */
export type RequestHeaders = Record<string, string | string[] | undefined>;

export interface RequestSignals {
  kind: RequestKind;
  userAgent: string;
  accept: string;
  acceptLanguage: string;
  secFetchMode: string;
  secFetchSite: string;
  // Web Bot Auth: los agentes que firman sus peticiones declaran aquí de quién
  // es la clave (p. ej. «https://chatgpt.com»).
  signatureAgent: string;
  // Solo en el aviso: navigator.webdriver, que Chrome, Firefox y Safari ponen a
  // true cuando los maneja un programa por WebDriver o CDP.
  webdriver: boolean;
}

export interface Classification {
  category: TrafficCategory;
  // Clave del catálogo (agents.ts) o '' para personas y sospechosos.
  agent: string;
  // Por qué se tomó la decisión. No se guarda: sirve a las pruebas y al
  // registro de depuración.
  reason: string;
}

function header(headers: RequestHeaders, name: string): string {
  const raw = headers[name];
  const value = Array.isArray(raw) ? raw[0] : raw;
  // Se recorta: una cabecera enorme no aporta nada a la clasificación y así no
  // se pasean kilobytes por las expresiones regulares.
  return typeof value === "string" ? value.slice(0, 512) : "";
}

export function signalsFromRequest(headers: RequestHeaders, kind: RequestKind, webdriver = false): RequestSignals {
  return {
    kind,
    userAgent: header(headers, "user-agent"),
    accept: header(headers, "accept"),
    acceptLanguage: header(headers, "accept-language"),
    secFetchMode: header(headers, "sec-fetch-mode"),
    secFetchSite: header(headers, "sec-fetch-site"),
    signatureAgent: header(headers, "signature-agent"),
    webdriver,
  };
}

// Versiones a partir de las cuales cada motor manda Sec-Fetch-* en todas las
// peticiones: Chromium 76, Firefox 90 y Safari 16.4. Un User-Agent que dice
// ser más nuevo y no las trae está mintiendo sobre lo que es.
function sendsFetchMetadata(userAgent: string): boolean {
  const chromium = /(?:Chrome|CriOS|Edg|OPR)\/(\d+)/.exec(userAgent);
  if (chromium) return Number(chromium[1]) >= 76;
  const firefox = /(?:Firefox|FxiOS)\/(\d+)/.exec(userAgent);
  if (firefox) return Number(firefox[1]) >= 90;
  const safari = /Version\/(\d+)(?:\.(\d+))?.*Safari\//.exec(userAgent);
  if (safari) {
    const major = Number(safari[1]);
    const minor = Number(safari[2] ?? 0);
    return major > 16 || (major === 16 && minor >= 4);
  }
  return false;
}

function looksLikeBrowser(userAgent: string): boolean {
  return /^Mozilla\/5\.0 \(/.test(userAgent)
    && /(?:Chrome|CriOS|Firefox|FxiOS|Safari|Edg|OPR)\//.test(userAgent);
}

export function classifySignals(signals: RequestSignals): Classification {
  const ua = signals.userAgent.trim();
  if (!ua) return { category: "bot", agent: NO_USER_AGENT_KEY, reason: "sin user-agent" };

  // 1. Agentes con nombre. Van primero porque muchos se presentan con un
  //    «Mozilla/5.0 … compatible; GPTBot» que, si no, parecería un navegador.
  const known = matchAgent(ua);
  if (known) return { category: known.category, agent: known.key, reason: `catálogo: ${known.key}` };

  // 2. Agentes que firman sus peticiones (Web Bot Auth). La firma no se
  //    verifica aquí —Cloudflare lo hace en el borde—, así que cuenta como
  //    agente declarado, nunca como persona.
  if (signals.signatureAgent) {
    const agent = /chatgpt\.com/i.test(signals.signatureAgent) ? CHATGPT_AGENT_KEY : SIGNED_AGENT_KEY;
    return { category: "ai", agent, reason: "signature-agent" };
  }

  // 3. La lista mantenida de isbot cubre cientos de rastreadores menores.
  if (isbot(ua)) return { category: "bot", agent: OTHER_BOT_KEY, reason: "isbot" };

  // 4. Lo que queda dice ser un navegador. Se buscan contradicciones.
  if (!looksLikeBrowser(ua)) return { category: "bot", agent: OTHER_BOT_KEY, reason: "user-agent no es de navegador" };
  if (signals.webdriver) return { category: "suspicious", agent: "", reason: "navigator.webdriver" };
  if (!signals.acceptLanguage) return { category: "suspicious", agent: "", reason: "sin accept-language" };
  // Ningún navegador manda un comodín: lo ponen por defecto clientes HTTP como
  // undici (el fetch de Node), no las preferencias de una persona.
  if (signals.acceptLanguage.trim() === "*") return { category: "suspicious", agent: "", reason: "accept-language comodín" };
  if (sendsFetchMetadata(ua) && !signals.secFetchMode) {
    return { category: "suspicious", agent: "", reason: "navegador moderno sin sec-fetch" };
  }
  if (signals.kind === "navigation") {
    // Una navegación real siempre acepta HTML; `*/*` a secas es de herramienta.
    if (!/text\/html/i.test(signals.accept)) return { category: "suspicious", agent: "", reason: "navegación sin text/html" };
  } else if (signals.secFetchSite && signals.secFetchSite !== "same-origin") {
    // El aviso solo sale del JavaScript de la propia página.
    return { category: "suspicious", agent: "", reason: "aviso desde otro origen" };
  }
  return { category: "human", agent: "", reason: "navegador coherente" };
}

export function classifyRequest(headers: RequestHeaders, kind: RequestKind, webdriver = false): Classification {
  return classifySignals(signalsFromRequest(headers, kind, webdriver));
}
