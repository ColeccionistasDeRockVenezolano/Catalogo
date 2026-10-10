import { useEffect, useState } from "react";
import { X } from "@phosphor-icons/react";

const storageKey = "crv.searchExampleHint.hiddenUntil";
const dismissalEvent = "crv:search-example-hint-dismissed";
const day = 24 * 60 * 60 * 1000;
let sessionHiddenUntil = 0;

function readHiddenUntil() {
  try {
    const stored = Number(window.localStorage.getItem(storageKey));
    const until = Number.isFinite(stored) ? Math.max(stored, sessionHiddenUntil) : sessionHiddenUntil;
    return until > Date.now() ? until : 0;
  } catch {
    return sessionHiddenUntil > Date.now() ? sessionHiddenUntil : 0;
  }
}

/** Ocultar el consejo no desactiva el atajo ni los ejemplos. */
export function SearchExampleHint({ id, available }: { id: string; available: boolean }) {
  const [hiddenUntil, setHiddenUntil] = useState(readHiddenUntil);

  useEffect(() => {
    const update = () => setHiddenUntil(readHiddenUntil());
    const onStorage = (event: StorageEvent) => {
      if (event.key === storageKey || event.key === null) update();
    };
    window.addEventListener(dismissalEvent, update);
    window.addEventListener("storage", onStorage);
    window.addEventListener("focus", update);
    const timer = hiddenUntil > Date.now()
      ? window.setTimeout(update, hiddenUntil - Date.now() + 1) : undefined;
    return () => {
      window.removeEventListener(dismissalEvent, update);
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("focus", update);
      window.clearTimeout(timer);
    };
  }, [hiddenUntil]);

  function dismiss() {
    const until = Date.now() + day;
    sessionHiddenUntil = until;
    try { window.localStorage.setItem(storageKey, String(until)); } catch { /* Conservarlo durante esta sesión si no hay almacenamiento. */ }
    setHiddenUntil(until);
    window.dispatchEvent(new Event(dismissalEvent));
  }

  if (!available) return null;
  if (hiddenUntil > Date.now()) return <span id={id} className="visually-hidden">Pulsa Tab para usar la recomendación. Para ir al siguiente campo, pulsa Escape y después Tab.</span>;
  return (
    <div className="search-example-hint">
      <span id={id}>Toca <strong>Usar</strong> o pulsa <kbd>Tab</kbd> para escribir la recomendación.
        <span className="search-example-hint__keyboard">Para ir al siguiente campo: <kbd>Esc</kbd> y después <kbd>Tab</kbd>.</span>
      </span>
      <button type="button" className="search-example-hint__dismiss"
        aria-label="Ocultar consejo de Tab durante 24 horas" title="Ocultar durante 24 horas"
        onMouseDown={event => event.preventDefault()} onClick={dismiss}>
        <X size={16} aria-hidden="true" />
      </button>
    </div>
  );
}
