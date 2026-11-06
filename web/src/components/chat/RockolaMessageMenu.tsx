// CRV · Menú «⋮» de un mensaje en el widget de La Rockola.
//
// Cualquiera puede reportar un mensaje ajeno; la cuenta administradora además
// borra, silencia, expulsa o banea, igual que en /crv/chat. El servidor vuelve a
// comprobar sesión, CSRF y rol: esto es solo la interfaz.
import { useEffect, useRef, useState } from 'react';
import type { ChatMessage } from '../../../../src/chat/protocol';
import { chatCall as call, errorText } from './rockolaApi';

const REASONS = [
  { value: 'odio', label: 'Odio o discriminación' },
  { value: 'acoso', label: 'Acoso o amenaza' },
  { value: 'spam', label: 'Spam' },
  { value: 'groserias', label: 'Groserías fuera de tono' },
  { value: 'otro', label: 'Otra cosa' },
] as const;

export function RockolaMessageMenu({ message, own, isAdmin, onNotice }: {
  message: ChatMessage; own: boolean; isAdmin: boolean; onNotice: (text: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [up, setUp] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!box.current || event.composedPath().includes(box.current)) return;
      setOpen(false);
      setReporting(false);
    };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [open]);

  if (!(message.id > 0) || (own && !isAdmin)) return null;

  const run = async (work: () => Promise<unknown>, done: string): Promise<void> => {
    setOpen(false);
    setReporting(false);
    try {
      await work();
      onNotice(done);
    } catch (error) {
      onNotice(errorText(error, 'No se pudo completar la acción.'));
    }
  };
  const who = message.displayName ?? 'esta persona';

  return <div className={'rv-msg-menu' + (open ? ' is-open' : '')} ref={box}>
    <button
      type="button" className="rv-msg-menu-toggle" aria-label="Opciones del mensaje"
      aria-expanded={open} onClick={() => {
        // Cerca del borde inferior de la lista, el menú se abre hacia arriba.
        const rect = box.current?.getBoundingClientRect();
        const feedRect = box.current?.closest('.rv-feed')?.getBoundingClientRect();
        setUp(Boolean(rect && feedRect && rect.top - feedRect.top > 250));
        setOpen(value => !value);
        setReporting(false);
      }}
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><path d="M12 6h.01M12 12h.01M12 18h.01"/></svg>
    </button>
    {open ? <div className={'rv-msg-menu-list' + (up ? ' is-up' : '')} role="menu">
      {reporting ? <>
        <p className="rv-msg-menu-title">¿Qué tiene de malo?</p>
        {REASONS.map(reason => <button
          key={reason.value} type="button" role="menuitem"
          onClick={() => void run(async () => {
            const result = await call<{ alreadyReported?: boolean }>(`/chat/messages/${message.id}/report`, { reason: reason.value });
            if (result?.alreadyReported) throw new Error('Ya habías reportado este mensaje.');
          }, 'Gracias: un moderador lo revisará.')}
        >{reason.label}</button>)}
      </> : <>
        {own ? null : <button type="button" role="menuitem" onClick={() => setReporting(true)}>Reportar</button>}
        {isAdmin ? <>
          <button type="button" role="menuitem" onClick={() => void run(() => call(`/chat/admin/messages/${message.id}/delete`, { reason: 'Moderación desde la portada' }), 'Mensaje borrado.')}>Borrar mensaje</button>
          {message.actorId ? <>
            <button type="button" role="menuitem" onClick={() => void run(() => call(`/chat/admin/actors/${message.actorId}/mute`, { minutes: 10 }), `${who} queda en silencio 10 min.`)}>Silenciar 10 min</button>
            <button type="button" role="menuitem" onClick={() => void run(() => call(`/chat/admin/actors/${message.actorId}/mute`, { minutes: 1440 }), `${who} queda en silencio 24 h.`)}>Silenciar 24 h</button>
            <button type="button" role="menuitem" onClick={() => void run(() => call(`/chat/admin/actors/${message.actorId}/kick`), `${who} salió de la sala.`)}>Expulsar</button>
            <button type="button" role="menuitem" className="is-danger" onClick={() => {
              const reason = window.prompt(`Motivo del baneo de ${who}:`)?.trim();
              if (!reason) return;
              void run(() => call(`/chat/admin/actors/${message.actorId}/ban`, { reason, ip: true }), `${who} baneado (cuenta e IP).`);
            }}>Banear (cuenta e IP)</button>
          </> : null}
        </> : null}
      </>}
    </div> : null}
  </div>;
}
