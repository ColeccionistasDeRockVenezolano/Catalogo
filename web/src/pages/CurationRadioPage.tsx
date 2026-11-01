// CRV · Curaduría › Radio en sombra (Fase 3).
//
// Estado del motor propio: catálogo, configuración y comparación con la
// emisión viva de herra-crv al mismo segundo. No emite al público.
import { Link } from "react-router-dom";
import { ArrowSquareOut, Broadcast, CheckCircle, WarningCircle } from "@phosphor-icons/react";
import { radioApi, type RadioStatus } from "../lib/radio";
import { useAsync } from "../lib/useAsync";
import { ErrorState, LoadingState } from "../components/StateViews";
import "../styles/community-ui.css";

function hours(seconds: number): string {
  return `${(seconds / 3600).toFixed(2)} h`;
}

function formatTime(value: string | undefined): string {
  if (!value) return "—";
  try {
    return new Intl.DateTimeFormat("es-VE", { dateStyle: "short", timeStyle: "medium", timeZone: "America/Caracas" }).format(new Date(value));
  } catch { return value; }
}

export function CurationRadioPage() {
  const status = useAsync<RadioStatus>(() => radioApi.status(), []);

  if (status.loading) return <div className="community-page"><LoadingState label="Consultando la sombra de radio…" /></div>;
  if (status.error) return <div className="community-page"><ErrorState message={status.error} onRetry={() => void status.reload()} /></div>;
  const data = status.data;
  if (!data?.configured) {
    return (
      <div className="community-page">
        <div className="page-header"><div><h1>Radio en sombra</h1><p className="hint">La feature `radio` no está activa o su configuración no es válida.</p></div></div>
        <div className="state-block">No hay estación configurada.</div>
      </div>
    );
  }

  const diffs = data.live?.diffs ?? [];
  const aligned = data.live?.reachable === true && diffs.length === 0;
  return (
    <div className="community-page">
      <div className="page-header">
        <div>
          <h1>Radio en sombra</h1>
          <p className="hint">El catálogo calcula la misma emisión que la portada. Esta fase no sirve radio al público.</p>
        </div>
        <Link to="/radio" className="btn btn--sm" target="_blank" rel="noreferrer">Abrir reproductor <ArrowSquareOut size={14} /></Link>
      </div>

      <div className={`roadmap-admin__stats`}>
        <div><strong>{data.catalog?.items ?? 0}</strong><span>piezas</span></div>
        <div><strong>{data.catalog?.genres ?? 0}</strong><span>géneros</span></div>
        <div><strong>{data.catalog ? hours(data.catalog.totalDurationSeconds) : "—"}</strong><span>duración del ciclo</span></div>
        <div><strong>{data.local?.position ?? "—"}</strong><span>posición actual</span></div>
        <div><strong>{data.live ? (aligned ? "0" : diffs.length) : "—"}</strong><span>divergencias</span></div>
      </div>

      <section className="community-card">
        <h2><Broadcast size={18} aria-hidden="true" /> Emisión local</h2>
        <p className="community-muted">Catálogo: {data.catalog?.file} · versión <code>{data.catalog?.version ?? "—"}</code> · modificado {formatTime(data.catalog?.lastModified ?? undefined)}</p>
        {data.local ? (
          <div className="community-table-wrap">
            <table className="community-table">
              <tbody>
                <tr><th>Estación</th><td>{data.station?.name}</td></tr>
                <tr><th>Ahora</th><td>{data.local.current.title}{data.local.current.artist ? ` · ${data.local.current.artist}` : ""}</td></tr>
                <tr><th>Siguiente</th><td>{data.local.next.title}</td></tr>
                <tr><th>Tramo</th><td>{formatTime(data.local.startsAt)} → {formatTime(data.local.endsAt)} ({data.local.phase})</td></tr>
                <tr><th>Queue</th><td><code>{data.local.queueId}</code></td></tr>
                <tr><th>Oyentes</th><td>{data.local.listeners}</td></tr>
                <tr><th>Config</th><td>epoch {data.station?.epoch} · cruce {data.station?.crossfadeSeconds}s · cuña cada {data.station?.sweeper?.everyPieces ?? 1}</td></tr>
              </tbody>
            </table>
          </div>
        ) : <div className="state-block">El motor local no puede emitir: revisa el catálogo.</div>}
      </section>

      <section className="community-card">
        <h2>Comparación con la emisión viva</h2>
        {!data.live ? <p className="community-muted">`CRV_RADIO_LIVE_URL` no está configurada: la sombra no se está comparando.</p> : null}
        {data.live && !data.live.reachable ? <p className="community-error"><WarningCircle size={16} /> {data.live.error ?? "La emisión viva no responde."}</p> : null}
        {data.live?.reachable ? (
          <>
            <p className={aligned ? "community-ok" : "community-error"}>
              {aligned ? <CheckCircle size={16} weight="fill" /> : <WarningCircle size={16} />}
              {aligned ? " Misma pieza, mismo tramo y misma cola que la emisión viva." : ` ${diffs.length} diferencias frente a la emisión viva.`}
            </p>
            <p className="community-muted">Viva: {data.live.current?.title} · {formatTime(data.live.serverTime)} · queue <code>{data.live.queueId}</code></p>
            {diffs.length > 0 ? (
              <div className="community-table-wrap">
                <table className="community-table">
                  <thead><tr><th>Campo</th><th>Viva</th><th>Local</th></tr></thead>
                  <tbody>
                    {diffs.map((diff) => (
                      <tr key={diff.field}><td>{diff.field}</td><td>{String(diff.live)}</td><td>{String(diff.local)}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </>
        ) : null}
      </section>
    </div>
  );
}
