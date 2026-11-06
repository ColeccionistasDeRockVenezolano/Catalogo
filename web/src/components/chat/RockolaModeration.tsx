// CRV · Moderación dentro del widget de La Rockola (portada).
//
// Es la misma moderación de /crv/chat —cola de reportes, auditoría, modo lento
// y avisos de la sesión— más la limpieza de la sala, que aquí vive entre las
// acciones del moderador. El servidor vuelve a comprobar sesión, CSRF y rol:
// esto es solo la interfaz. Se habla con la API del mismo origen usando la
// cabecera CSRF del documento, sin depender del estado del catálogo.
import { useCallback, useEffect, useState } from 'react';
import type { ChatModerationEntry, ChatReport } from '../../lib/api';
import type { ChatRoom, ModerationAlert } from '../../../../src/chat/protocol';
import { chatCall as call, errorText } from './rockolaApi';

const SOURCE_LABEL: Record<ChatReport['source'], string> = {
  user: 'persona', ai: 'Laya', detector: 'detector', filter: 'filtro',
};

const ACTION_LABEL: Record<string, string> = {
  delete: 'borró', restore: 'restauró', mute: 'silenció', unmute: 'quitó el silencio a', kick: 'expulsó',
  ban: 'baneó', unban: 'levantó el baneo a', ip_ban: 'baneó la IP', ip_unban: 'levantó el baneo de IP',
  slow_mode: 'cambió el modo lento', report_resolve: 'cerró un reporte', auto_mute: 'silencio automático',
  auto_hide: 'ocultó automáticamente', clear: 'limpió la conversación',
};

const SLOW_STEPS = [0, 5, 15, 30, 60, 120];

export function RockolaModeration({ room, alerts, onClose }: {
  room: ChatRoom | null; alerts: ModerationAlert[]; onClose: () => void;
}) {
  const [tab, setTab] = useState<'reports' | 'log' | 'room'>('reports');
  const [reports, setReports] = useState<ChatReport[] | null>(null);
  const [entries, setEntries] = useState<ChatModerationEntry[] | null>(null);
  const [failure, setFailure] = useState('');
  const [notice, setNotice] = useState('');
  const [slow, setSlow] = useState(room?.slowModeSeconds ?? 0);
  const [clearing, setClearing] = useState(false);
  const [clearBusy, setClearBusy] = useState(false);

  const load = useCallback(async () => {
    setFailure('');
    try {
      const [open, log] = await Promise.all([
        call<{ reports: ChatReport[] }>('/chat/admin/reports?status=open'),
        call<{ entries: ChatModerationEntry[] }>('/chat/admin/log'),
      ]);
      setReports(open.reports);
      setEntries(log.entries);
    } catch (error) {
      setFailure(errorText(error, 'No se pudo cargar la moderación.'));
    }
  }, []);

  useEffect(() => { void load(); }, [load, alerts.length]);

  const act = async (work: () => Promise<unknown>, done: string): Promise<void> => {
    try {
      await work();
      setNotice(done);
      setFailure('');
      await load();
    } catch (error) {
      setFailure(errorText(error, 'No se pudo completar la acción.'));
    }
  };

  const roomSlug = room?.slug ?? 'general';

  return <div className="rv-mod">
    <div className="rv-mod-tabs" role="tablist" aria-label="Secciones de moderación">
      <button type="button" role="tab" aria-selected={tab === 'reports'} onClick={() => setTab('reports')}>Reportes{reports?.length ? <span>{reports.length}</span> : null}</button>
      <button type="button" role="tab" aria-selected={tab === 'log'} onClick={() => setTab('log')}>Auditoría</button>
      <button type="button" role="tab" aria-selected={tab === 'room'} onClick={() => setTab('room')}>Sala</button>
    </div>
    {notice && <p className="rv-mod-notice" role="status">{notice}</p>}
    {failure && <p className="rv-mod-error" role="alert">{failure}</p>}

    {tab === 'reports' && (reports === null
      ? <p className="rv-mod-empty">Cargando…</p>
      : reports.length === 0
        ? <p className="rv-mod-empty">No hay reportes abiertos.</p>
        : <ul className="rv-mod-list">
          {reports.map(report => <li key={report.id}>
            <p className="rv-mod-meta"><strong>{report.target?.displayName ?? '—'}</strong><span>{SOURCE_LABEL[report.source]} · {report.reason}{report.reports > 1 ? ` · ${report.reports} reportes` : ''}</span></p>
            {report.message ? <blockquote className={report.message.hidden ? 'is-hidden' : undefined}>{report.message.body}{report.message.hidden ? <em> (oculto)</em> : null}</blockquote> : null}
            {report.target ? <p className="rv-mod-sub">{report.target.messages} mensajes · cuenta del {new Date(report.target.createdAt).toLocaleDateString('es-VE')}{report.target.lastIp ? ` · IP ${report.target.lastIp}` : ''}{report.target.mutedUntil && new Date(report.target.mutedUntil) > new Date() ? ' · silenciado' : ''}{report.target.bannedAt ? ' · baneado' : ''}</p> : null}
            <div className="rv-mod-actions">
              {report.message && !report.message.hidden ? <button type="button" onClick={() => void act(async () => {
                await call(`/chat/admin/messages/${report.message!.id}/delete`, { reason: report.reason });
                await call(`/chat/admin/reports/${report.id}/resolve`, { status: 'actioned' });
              }, 'Mensaje borrado y reporte cerrado.')}>Borrar</button> : null}
              {report.target ? <>
                <button type="button" onClick={() => void act(async () => {
                  await call(`/chat/admin/actors/${report.target!.id}/mute`, { minutes: 60, reason: report.reason });
                  await call(`/chat/admin/reports/${report.id}/resolve`, { status: 'actioned' });
                }, 'Silenciado 1 h.')}>Silenciar 1 h</button>
                <button type="button" className="is-danger" onClick={() => {
                  const reason = window.prompt('Motivo del baneo:', report.reason)?.trim();
                  if (!reason) return;
                  void act(async () => {
                    await call(`/chat/admin/actors/${report.target!.id}/ban`, { reason, ip: true });
                    await call(`/chat/admin/reports/${report.id}/resolve`, { status: 'actioned' });
                  }, 'Baneado (cuenta e IP).');
                }}>Banear</button>
              </> : null}
              <button type="button" onClick={() => void act(() => call(`/chat/admin/reports/${report.id}/resolve`, { status: 'dismissed' }), 'Reporte descartado.')}>Descartar</button>
            </div>
          </li>)}
        </ul>)}

    {tab === 'log' && (entries === null
      ? <p className="rv-mod-empty">Cargando…</p>
      : entries.length === 0
        ? <p className="rv-mod-empty">Todavía no hay acciones.</p>
        : <ul className="rv-mod-list is-log">
          {entries.map(entry => <li key={entry.id}>
            <p className="rv-mod-meta"><strong>{entry.moderator}</strong><span>{ACTION_LABEL[entry.action] ?? entry.action}{entry.targetName ? ` · ${entry.targetName}` : ''}{entry.ip ? ` · ${entry.ip}` : ''}</span></p>
            <p className="rv-mod-sub">{new Date(entry.createdAt).toLocaleString('es-VE', { dateStyle: 'short', timeStyle: 'short' })}{entry.reason ? ` · ${entry.reason}` : ''}</p>
          </li>)}
        </ul>)}

    {tab === 'room' && <div className="rv-mod-room">
      <p className="rv-mod-hint">Modo lento: segundos mínimos entre dos mensajes de la misma persona en {room?.name ?? 'la sala'}. Los moderadores no lo sufren.</p>
      <div className="rv-mod-actions">
        {SLOW_STEPS.map(seconds => <button
          key={seconds} type="button" aria-pressed={slow === seconds} disabled={!room}
          onClick={() => void act(async () => {
            await call(`/chat/admin/rooms/${encodeURIComponent(roomSlug)}/slow-mode`, { seconds });
            setSlow(seconds);
          }, seconds ? `Modo lento: ${seconds} s.` : 'Modo lento apagado.')}
        >{seconds ? `${seconds} s` : 'Apagado'}</button>)}
      </div>
      {alerts.length ? <>
        <h3 className="rv-mod-title">Avisos de esta sesión</h3>
        <ul className="rv-mod-list is-log">
          {alerts.map((alert, index) => <li key={`${alert.at}-${index}`}>
            <p className="rv-mod-meta"><strong>{alert.displayName ?? '—'}</strong><span>{alert.text}</span></p>
            <p className="rv-mod-sub">{new Date(alert.at).toLocaleTimeString('es-VE')}</p>
          </li>)}
        </ul>
      </> : null}
      <h3 className="rv-mod-title">Limpiar conversación</h3>
      {clearing
        ? <div className="rv-mod-clear">
          <p className="rv-mod-hint">Se ocultarán todos los mensajes de la sala. ¿Seguro?</p>
          <div className="rv-mod-actions">
            <button type="button" className="is-danger" disabled={clearBusy} onClick={() => {
              setClearBusy(true);
              void act(async () => { await call(`/chat/admin/rooms/${encodeURIComponent(roomSlug)}/clear`, { reason: 'Limpieza desde la portada' }); setClearing(false); }, 'Conversación limpiada.').finally(() => setClearBusy(false));
            }}>{clearBusy ? 'Limpiando…' : 'Sí, limpiar'}</button>
            <button type="button" onClick={() => setClearing(false)}>Cancelar</button>
          </div>
        </div>
        : <button type="button" className="rv-mod-clear-toggle" onClick={() => setClearing(true)}>Limpiar conversación</button>}
    </div>}

    <div className="rv-mod-footer"><button type="button" className="rv-mod-close" onClick={onClose}>Cerrar</button></div>
  </div>;
}
