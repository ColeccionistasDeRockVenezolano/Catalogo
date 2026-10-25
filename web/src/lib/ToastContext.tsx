// CRV · Avisos breves, sobre el Toast de Base UI: se pausan al pasar el ratón
// o enfocarlos, se cierran con su X o deslizándolos, nunca se apilan más de
// tres y salen con animación. Los errores se anuncian con prioridad alta.
//
// Un aviso dice una frase y, si hace falta, ofrece una acción. Los informes
// largos (el resultado de un análisis, un lote) van en la página.
//
// Toda escritura con run crea su propio aviso con «Deshacer»
// (components/ChangeFeedback.tsx). El «Disco actualizado.» que la pantalla
// anuncia justo después no abre un segundo aviso: le pone título al del
// cambio, así se ve una sola confirmación con su deshacer.
import { createContext, useCallback, useContext, useEffect, useMemo, type ReactNode } from "react";
import { Toast } from "@base-ui/react/toast";
import { CheckCircle, Info, WarningCircle, X } from "@phosphor-icons/react";

/** Acción opcional de un aviso: un botón junto al texto. */
export interface ToastAction {
  label: string;
  onAction: () => void | Promise<void>;
}

interface ToastOptions {
  action?: ToastAction;
  /** Cuánto dura a la vista; los avisos con acción necesitan más tiempo. */
  durationMs?: number;
  /** Segunda línea, más tenue: el enlace a la ficha, el detalle. */
  description?: ReactNode;
}

export type ToastKind = "success" | "error" | "info";

interface ToastContextValue {
  notify: (kind: ToastKind, message: string, options?: ToastOptions) => void;
}

const DURATION: Record<ToastKind, number> = { success: 4500, info: 6000, error: 9000 };
/** Lo que dura un aviso con «Deshacer» en pantalla (E8.4). */
export const UNDO_TOAST_MS = 30_000;
/** Ventana en la que el «Guardado.» de la pantalla titula el aviso del cambio. */
const MERGE_WINDOW_MS = 3000;

/** Único gestor: también lo usan los avisos de cambios, fuera de React. */
export const toastManager = Toast.createToastManager();

let pendingChange: { id: string; at: number } | null = null;

/** El aviso de un cambio recién guardado espera el título que le dé la pantalla. */
export function registerChangeToast(id: string): void {
  pendingChange = { id, at: Date.now() };
  // Cerrar (también al arrastrar) no debe tragarse el siguiente aviso de éxito.
  toastManager.update(id, { onClose: () => { if (pendingChange?.id === id) pendingChange = null; } });
}

function addToast(kind: ToastKind, message: string, options?: ToastOptions): void {
  if (kind === "success" && !options?.action && pendingChange && Date.now() - pendingChange.at < MERGE_WINDOW_MS) {
    const { id } = pendingChange;
    pendingChange = null;
    toastManager.update(id, { title: message });
    return;
  }
  const id: string = toastManager.add({
    title: message,
    type: kind,
    priority: kind === "error" ? "high" : "low",
    timeout: options?.durationMs ?? (options?.action ? UNDO_TOAST_MS : DURATION[kind]),
    ...(options?.description ? { description: options.description } : {}),
    ...(options?.action ? {
      actionProps: {
        children: options.action.label,
        onClick: () => { toastManager.close(id); void options.action?.onAction(); },
      },
    } : {}),
  });
}

const ToastContext = createContext<ToastContextValue | undefined>(undefined);

export function ToastProvider({ children }: { children: ReactNode }) {
  const notify = useCallback(addToast, []);
  const value = useMemo(() => ({ notify }), [notify]);
  return (
    <ToastContext.Provider value={value}>
      <Toast.Provider toastManager={toastManager} limit={3}>
        {children}
        <Toast.Portal>
          <Toast.Viewport className="toast-stack" data-crv-toasts="">
            <ToastList />
          </Toast.Viewport>
        </Toast.Portal>
      </Toast.Provider>
    </ToastContext.Provider>
  );
}

const ICONS = { success: CheckCircle, error: WarningCircle, info: Info } as const;
const KIND_LABEL = { success: "Hecho", error: "Error", info: "Aviso" } as const;

function ToastList() {
  const { toasts } = Toast.useToastManager();
  useEffect(() => {
    // El límite oculta los antiguos; cerrarlos evita avisos invisibles retenidos.
    for (const toast of toasts) {
      if (toast.limited && toast.transitionStatus !== "ending") toastManager.close(toast.id);
    }
  }, [toasts]);
  return toasts.map((toast) => {
    const kind: ToastKind = toast.type === "error" || toast.type === "info" ? toast.type : "success";
    const Icon = ICONS[kind];
    return (
      <Toast.Root key={toast.id} toast={toast} swipeDirection={["up", "down", "left", "right"]} className={`toast toast--${kind}`}>
        <Toast.Content className="toast__content">
          <Icon className="toast__icon" size={18} weight="fill" aria-hidden="true" />
          <span className="visually-hidden">{KIND_LABEL[kind]}: </span>
          <div className="toast__text">
            <Toast.Title className="toast__title" />
            <Toast.Description className="toast__description" />
          </div>
          {toast.actionProps ? <Toast.Action className="toast__action" /> : null}
          <Toast.Close className="toast__close" aria-label="Cerrar aviso" aria-hidden={false}><X size={14} weight="bold" aria-hidden="true" /></Toast.Close>
        </Toast.Content>
      </Toast.Root>
    );
  });
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast debe usarse dentro de ToastProvider");
  return ctx;
}
