// CRV · Moderación del chat en la propia sala.
//
// Cualquiera puede reportar un mensaje ajeno; la cuenta administradora de CRV
// además borra, silencia, expulsa o banea desde el mismo menú y tiene la hoja
// «Moderación» con la cola de reportes, la auditoría y el modo lento. El
// servidor vuelve a comprobar todo (sesión, CSRF, propiedad): esto es solo la
// interfaz.
import { useCallback, useEffect, useState } from "react";
import { DotsThreeVertical, Flag, X } from "@phosphor-icons/react";
import { chatApi, type ChatModerationEntry, type ChatReport, type ChatReportReason } from "../../lib/api";
import type { ChatMessage, ChatRoom, ModerationAlert } from "../../../../src/chat/protocol";

const REASONS: Array<{ value: ChatReportReason; label: string }> = [
  { value: "odio", label: "Odio o discriminación" },
  { value: "acoso", label: "Acoso o amenaza" },
  { value: "spam", label: "Spam" },
  { value: "groserias", label: "Groserías fuera de tono" },
  { value: "otro", label: "Otra cosa" },
];

const SOURCE_LABEL: Record<ChatReport["source"], string> = {
  user: "persona", ai: "Laya", detector: "detector", filter: "filtro",
};

const ACTION_LABEL: Record<string, string> = {
  delete: "borró", restore: "restauró", mute: "silenció", unmute: "quitó el silencio a", kick: "expulsó",
  ban: "baneó", unban: "levantó el baneo a", ip_ban: "baneó la IP", ip_unban: "levantó el baneo de IP",
  slow_mode: "cambió el modo lento", report_resolve: "cerró un reporte", auto_mute: "silencio automático",
  auto_hide: "ocultó automáticamente",
};

const SLOW_STEPS = [0, 5, 15, 30, 60, 120];

function errorText(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

/** Menú «⋮» de un mensaje: reportar y, para moderadores, sanciones. */
export function MessageMenu({ message, own, isAdmin, onNotice }: {
  message: ChatMessage; own: boolean; isAdmin: boolean; onNotice: (text: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [reporting, setReporting] = useState(false);
  if (message.id <= 0 || (own && !isAdmin)) return null;

  const run = async (work: () => Promise<unknown>, done: string): Promise<void> => {
    setOpen(false);
    try {
      await work();
      onNotice(done);
    } catch (error) {
      onNotice(errorText(error, "No se pudo completar la acción."));
    }
  };
  const who = message.displayName ?? "esta persona";

  return (
    <div className="chat-msg-menu">
      <button
        type="button" className="chat-msg-menu-toggle" aria-label="Opciones del mensaje"
        aria-expanded={open} onClick={() => { setOpen((value) => !value); setReporting(false); }}
      >
        <DotsThreeVertical size={16} weight="bold" aria-hidden="true" />
      </button>
      {open ? (
        <div className="chat-msg-menu-list" role="menu">
          {reporting ? (
            <>
              <p className="chat-msg-menu-title">¿Qué tiene de malo?</p>
              {REASONS.map((reason) => (
                <button
                  key={reason.value} type="button" role="menuitem"
                  onClick={() => void run(async () => {
                    const result = await chatApi.report(message.id, reason.value);
                    if (result.alreadyReported) throw new Error("Ya habías reportado este mensaje.");
                  }, "Gracias: un moderador lo revisará.")}
                >{reason.label}</button>
              ))}
            </>
          ) : (
            <>
              {own ? null : (
                <button type="button" role="menuitem" onClick={() => setReporting(true)}>
                  <Flag size={14} weight="bold" aria-hidden="true" /> Reportar
                </button>
              )}
              {isAdmin ? (
                <>
                  <button type="button" role="menuitem" onClick={() => void run(() => chatApi.deleteMessage(message.id), "Mensaje borrado.")}>
                    Borrar mensaje
                  </button>
                  {message.actorId ? (
                    <>
                      <button type="button" role="menuitem" onClick={() => void run(() => chatApi.mute(message.actorId!, 10), `${who} queda en silencio 10 min.`)}>
                        Silenciar 10 min
                      </button>
                      <button type="button" role="menuitem" onClick={() => void run(() => chatApi.mute(message.actorId!, 24 * 60), `${who} queda en silencio 24 h.`)}>
                        Silenciar 24 h
                      </button>
                      <button type="button" role="menuitem" onClick={() => void run(() => chatApi.kick(message.actorId!), `${who} salió de la sala.`)}>
                        Expulsar
                      </button>
                      <button
                        type="button" role="menuitem" className="is-danger"
                        onClick={() => {
                          const reason = window.prompt(`Motivo del baneo de ${who}:`)?.trim();
                          if (!reason) return;
                          void run(() => chatApi.ban(message.actorId!, reason, true), `${who} baneado (cuenta e IP).`);
                        }}
                      >Banear (cuenta e IP)</button>
                    </>
                  ) : null}
                </>
              ) : null}
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}

/** Hoja de moderación: cola de reportes, auditoría, modo lento y avisos en vivo. */
export function ModerationSheet({ room, alerts, onClose, onNotice }: {
  room: ChatRoom | null; alerts: ModerationAlert[]; onClose: () => void; onNotice: (text: string) => void;
}) {
  const [tab, setTab] = useState<"reports" | "log" | "room">("reports");
  const [reports, setReports] = useState<ChatReport[] | null>(null);
  const [entries, setEntries] = useState<ChatModerationEntry[] | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const load = useCallback(async () => {
    setFailure(null);
    try {
      const [open, log] = await Promise.all([chatApi.reports("open"), chatApi.moderationLog()]);
      setReports(open.reports);
      setEntries(log.entries);
    } catch (error) {
      setFailure(errorText(error, "No se pudo cargar la moderación."));
    }
  }, []);

  // Recarga al abrir y cuando llega un aviso nuevo.
  useEffect(() => { void load(); }, [load, alerts.length]);

  const act = async (work: () => Promise<unknown>, done: string): Promise<void> => {
    try {
      await work();
      onNotice(done);
      await load();
    } catch (error) {
      onNotice(errorText(error, "No se pudo completar la acción."));
    }
  };

  return (
    <div className="chat-sheet-backdrop" role="dialog" aria-modal="true" aria-label="Moderación" onClick={onClose}>
      <section className="chat-sheet chat-mod-sheet" onClick={(event) => event.stopPropagation()}>
        <header>
          <h2>Moderación</h2>
          <button type="button" onClick={onClose} aria-label="Cerrar"><X size={20} weight="bold" /></button>
        </header>
        <nav className="chat-mod-tabs" aria-label="Secciones de moderación">
          <button type="button" aria-pressed={tab === "reports"} onClick={() => setTab("reports")}>
            Reportes{reports?.length ? <span>{reports.length}</span> : null}
          </button>
          <button type="button" aria-pressed={tab === "log"} onClick={() => setTab("log")}>Auditoría</button>
          <button type="button" aria-pressed={tab === "room"} onClick={() => setTab("room")}>Sala</button>
        </nav>
        <div className="chat-sheet-body">
          {failure ? <p className="chat-mod-empty">{failure}</p> : null}

          {tab === "reports" ? (
            reports === null ? <p className="chat-mod-empty">Cargando…</p>
              : reports.length === 0 ? <p className="chat-mod-empty">No hay reportes abiertos.</p>
                : (
                  <ul className="chat-mod-list">
                    {reports.map((report) => (
                      <li key={report.id}>
                        <p className="chat-mod-meta">
                          <strong>{report.target?.displayName ?? "—"}</strong>
                          <span>{SOURCE_LABEL[report.source]} · {report.reason}{report.reports > 1 ? ` · ${report.reports} reportes` : ""}</span>
                        </p>
                        {report.message ? (
                          <blockquote className={report.message.hidden ? "is-hidden" : undefined}>
                            {report.message.body}
                            {report.message.hidden ? <em> (oculto)</em> : null}
                          </blockquote>
                        ) : null}
                        {report.target ? (
                          <p className="chat-mod-sub">
                            {report.target.messages} mensajes · cuenta del {new Date(report.target.createdAt).toLocaleDateString("es-VE")}
                            {report.target.lastIp ? ` · IP ${report.target.lastIp}` : ""}
                            {report.target.mutedUntil && new Date(report.target.mutedUntil) > new Date() ? " · silenciado" : ""}
                            {report.target.bannedAt ? " · baneado" : ""}
                          </p>
                        ) : null}
                        <div className="chat-mod-actions">
                          {report.message && !report.message.hidden ? (
                            <button type="button" onClick={() => void act(async () => {
                              await chatApi.deleteMessage(report.message!.id, report.reason);
                              await chatApi.resolveReport(report.id, "actioned");
                            }, "Mensaje borrado y reporte cerrado.")}>Borrar</button>
                          ) : null}
                          {report.target ? (
                            <>
                              <button type="button" onClick={() => void act(async () => {
                                await chatApi.mute(report.target!.id, 60, report.reason);
                                await chatApi.resolveReport(report.id, "actioned");
                              }, "Silenciado 1 h.")}>Silenciar 1 h</button>
                              <button type="button" className="is-danger" onClick={() => {
                                const reason = window.prompt("Motivo del baneo:", report.reason)?.trim();
                                if (!reason) return;
                                void act(async () => {
                                  await chatApi.ban(report.target!.id, reason, true);
                                  await chatApi.resolveReport(report.id, "actioned");
                                }, "Baneado (cuenta e IP).");
                              }}>Banear</button>
                            </>
                          ) : null}
                          <button type="button" onClick={() => void act(
                            () => chatApi.resolveReport(report.id, "dismissed"), "Reporte descartado.",
                          )}>Descartar</button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )
          ) : null}

          {tab === "log" ? (
            entries === null ? <p className="chat-mod-empty">Cargando…</p>
              : entries.length === 0 ? <p className="chat-mod-empty">Todavía no hay acciones.</p>
                : (
                  <ul className="chat-mod-list is-log">
                    {entries.map((entry) => (
                      <li key={entry.id}>
                        <p className="chat-mod-meta">
                          <strong>{entry.moderator}</strong>
                          <span>{ACTION_LABEL[entry.action] ?? entry.action}{entry.targetName ? ` · ${entry.targetName}` : ""}{entry.ip ? ` · ${entry.ip}` : ""}</span>
                        </p>
                        <p className="chat-mod-sub">
                          {new Date(entry.createdAt).toLocaleString("es-VE", { dateStyle: "short", timeStyle: "short" })}
                          {entry.reason ? ` · ${entry.reason}` : ""}
                        </p>
                      </li>
                    ))}
                  </ul>
                )
          ) : null}

          {tab === "room" ? (
            <div className="chat-mod-room">
              <p>Modo lento: segundos mínimos entre dos mensajes de la misma persona en {room?.name ?? "la sala"}. Los moderadores no lo sufren.</p>
              <div className="chat-mod-actions">
                {SLOW_STEPS.map((seconds) => (
                  <button
                    key={seconds} type="button" aria-pressed={(room?.slowModeSeconds ?? 0) === seconds}
                    disabled={!room}
                    onClick={() => room && void act(() => chatApi.slowMode(room.slug, seconds),
                      seconds ? `Modo lento: ${seconds} s.` : "Modo lento apagado.")}
                  >{seconds ? `${seconds} s` : "Apagado"}</button>
                ))}
              </div>
              {alerts.length ? (
                <>
                  <h3>Avisos de esta sesión</h3>
                  <ul className="chat-mod-list is-log">
                    {alerts.map((alert, index) => (
                      <li key={`${alert.at}-${index}`}>
                        <p className="chat-mod-meta"><strong>{alert.displayName ?? "—"}</strong><span>{alert.text}</span></p>
                        <p className="chat-mod-sub">{new Date(alert.at).toLocaleTimeString("es-VE")}</p>
                      </li>
                    ))}
                  </ul>
                </>
              ) : null}
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}
