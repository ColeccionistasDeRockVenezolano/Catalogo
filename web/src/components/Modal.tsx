import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, X } from "@phosphor-icons/react";

interface ModalProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
  /** Hoja inferior en pantallas angostas: el pulgar llega a los botones (PLAN_CURADURIA E8.9). */
  sheet?: boolean;
  /** Editor de fichas: casi a pantalla completa, con su propio menú y bandeja de cambios. */
  editor?: boolean;
  /** Un clic fuera del panel lo cierra; se apaga cuando hay algo escrito que perder. */
  closeOnOverlay?: boolean;
  /** Confirmación destructiva: se anuncia como alertdialog. */
  alert?: boolean;
  /** El foco entra al panel y no al primer campo: hojas de opciones sin nada que escribir. */
  focusPanel?: boolean;
  /** Vista anidada (p. ej. una opción de la hoja de filtros): flecha para volver a la anterior. */
  onBack?: () => void;
}

/**
 * Mientras haya algún diálogo abierto, el resto de la página queda `inert` y
 * oculto para lectores de pantalla. El contador compartido evita que un diálogo
 * anidado (confirmar el descarte, fusionar…) devuelva el fondo a un estado
 * intermedio: el bloqueo se levanta al cerrarse el último.
 */
let openDialogs = 0;
const behindBackup: Array<{ node: HTMLElement; inert: boolean; ariaHidden: string | null }> = [];
/**
 * Diálogos abiertos, del más antiguo al más reciente. Escape y Tab solo los
 * atiende el de arriba: sin esto, un Escape en una confirmación anidada
 * también cerraba (o intentaba cerrar) el editor de debajo.
 */
const dialogStack: symbol[] = [];
/** `overflow` del body antes del primer diálogo: se restaura al cerrar el último, no al cerrar uno anidado. */
let baseOverflow = "";
/** Foco que espera a que la página deje de estar inerte (cierre simultáneo de diálogos anidados). */
let pendingFocus: HTMLElement | null = null;

function lockPageBehind(overlay: HTMLElement | null) {
  if (openDialogs === 0) {
    behindBackup.length = 0;
    for (const node of [...document.body.children]) {
      if (!(node instanceof HTMLElement) || node === overlay) continue;
      // Los avisos siguen al alcance: «Deshacer» de lo que se acaba de guardar
      // desde un panel del editor no puede quedar bloqueado.
      if (node.querySelector("[data-crv-toasts]") || node.hasAttribute("data-crv-toasts")) continue;
      behindBackup.push({ node, inert: node.hasAttribute("inert"), ariaHidden: node.getAttribute("aria-hidden") });
      node.setAttribute("inert", "");
      node.setAttribute("aria-hidden", "true");
    }
  }
  openDialogs += 1;
}

function unlockPageBehind() {
  openDialogs = Math.max(0, openDialogs - 1);
  if (openDialogs > 0) return;
  for (const { node, inert, ariaHidden } of behindBackup) {
    if (!inert) node.removeAttribute("inert");
    if (ariaHidden === null) node.removeAttribute("aria-hidden"); else node.setAttribute("aria-hidden", ariaHidden);
  }
  behindBackup.length = 0;
  if (pendingFocus?.isConnected) pendingFocus.focus({ preventScroll: true });
  pendingFocus = null;
}

export function Modal({ title, onClose, children, wide, sheet, editor, closeOnOverlay = true, alert, focusPanel = false, onBack }: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  const titleId = useId();
  const closeOnOverlayRef = useRef(closeOnOverlay);
  closeOnOverlayRef.current = closeOnOverlay;

  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!dialogStack.length) baseOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.body.classList.add("has-modal");
    // El foco entra al primer campo del contenido, nunca al botón «Cerrar» ni a
    // las pestañas: un Enter por inercia cerraría el diálogo y descartaría la edición.
    const firstField = focusPanel ? null : bodyRef.current?.querySelector<HTMLElement>("input:not([type=hidden]), select, textarea");
    const firstControl = focusPanel ? null : firstField ?? bodyRef.current?.querySelector<HTMLElement>("button, a[href]");
    (firstControl ?? panelRef.current)?.focus({ preventScroll: true });
    lockPageBehind(overlayRef.current);
    const token = Symbol("dialog");
    dialogStack.push(token);

    const onKey = (event: KeyboardEvent) => {
      if (dialogStack.at(-1) !== token) return;
      if (event.key === "Escape") { event.preventDefault(); onCloseRef.current(); return; }
      if (event.key !== "Tab" || !panelRef.current) return;
      const controls = [...panelRef.current.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href]")]
        .filter(control => control.getClientRects().length > 0 && control.tabIndex >= 0);
      if (!controls.length) return;
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      dialogStack.splice(dialogStack.indexOf(token), 1);
      if (!dialogStack.length) {
        document.body.style.overflow = baseOverflow;
        document.body.classList.remove("has-modal");
      }
      unlockPageBehind();
      // Al cerrar a la vez un diálogo y su confirmación (descartar cambios), el
      // de abajo se limpia primero con la página aún inerte: su foco espera al
      // desbloqueo, y el de la confirmación ya no está en la página.
      if (previousFocus?.isConnected) {
        if (previousFocus.closest("[inert]")) pendingFocus = previousFocus;
        else previousFocus.focus({ preventScroll: true });
      }
    };
    // El foco y el bloqueo de scroll pertenecen a la apertura, no a cada render
    // del padre (p. ej. los avances del reproductor o una actualización de datos).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return createPortal(
    <div ref={overlayRef} className={`modal-overlay${editor ? " modal-overlay--editor" : ""}`} onMouseDown={(event) => { if (event.target === event.currentTarget && closeOnOverlayRef.current) onClose(); }}>
      <div ref={panelRef} tabIndex={-1} className={`modal-panel${wide ? " modal-panel--wide" : ""}${sheet ? " modal-panel--sheet" : ""}${editor ? " modal-panel--editor" : ""}`} role={alert ? "alertdialog" : "dialog"} aria-modal="true" aria-labelledby={titleId}>
        <div className="modal-header">
          {onBack ? <button type="button" className="modal-back" onClick={onBack} aria-label="Volver"><ArrowLeft aria-hidden="true" weight="bold" /></button> : null}
          <h2 id={titleId}>{title}</h2>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Cerrar"><X aria-hidden="true" weight="bold" /></button>
        </div>
        <div ref={bodyRef} className="modal-body">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
