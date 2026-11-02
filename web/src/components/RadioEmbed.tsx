// CRV · La radio dentro del catálogo.
//
// Hay un solo reproductor: el de la portada (radio.js), con sus dos reproductores,
// segundo plano, cuña, avisos y diagnóstico. Vive en su propio documento porque es
// un guion de página completa: dentro de un iframe, salir de la ruta lo apaga sin
// dejar nada sonando. Si la emisión no responde no se pinta el iframe.
import { useEffect, useRef, useState } from "react";
import { useI18n } from "../lib/i18n";
import { radioApi } from "../lib/radio";

export function RadioEmbed({ unavailable }: { unavailable: string }) {
  const { lang } = useI18n();
  const frame = useRef<HTMLIFrameElement>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [height, setHeight] = useState(520);
  const [cinema, setCinema] = useState(false);

  useEffect(() => {
    let alive = true;
    radioApi.now().then(() => { if (alive) setState("ready"); }, () => { if (alive) setState("error"); });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    const onMessage = (event: MessageEvent<unknown>) => {
      if (event.origin !== window.location.origin || event.source !== frame.current?.contentWindow) return;
      const data = event.data as { type?: unknown; cinema?: unknown; height?: unknown } | null;
      if (data?.type !== "crv-radio") return;
      setCinema(data.cinema === true);
      // En modo cine la tarjeta se mide dentro de la pantalla completa: se conserva el alto normal.
      if (data.cinema !== true && typeof data.height === "number" && data.height > 0) setHeight(data.height);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  if (state === "error") return <div className="state-block">{unavailable}</div>;
  if (state === "loading") return <div className="radio-embed" style={{ height }} aria-busy="true" />;
  return (
    <div className="radio-embed" style={{ height }}>
      <iframe
        ref={frame}
        className={cinema ? "radio-embed__frame is-cinema" : "radio-embed__frame"}
        title="Radio CRV"
        src={`${import.meta.env.BASE_URL}radio-embed?lang=${lang}`}
        allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
      />
    </div>
  );
}
