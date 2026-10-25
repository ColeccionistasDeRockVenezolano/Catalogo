import { createContext, useContext, type ReactNode } from "react";
import { createPortal } from "react-dom";

/** Mismo corte que el CSS: por debajo, la navegación baja al borde inferior. */
export const MOBILE_QUERY = "(max-width: 760px)";

interface TopbarTools {
  /** Hueco de la cabecera móvil donde una página pone sus controles. */
  slot: HTMLElement | null;
  /** Con el buscador abierto, la cabecera entera es el campo: se ocultan la marca y la cuenta. */
  setSearching: (searching: boolean) => void;
}

export const TopbarToolsContext = createContext<TopbarTools>({ slot: null, setSearching: () => {} });

export function useTopbarTools() {
  return useContext(TopbarToolsContext);
}

export function TopbarToolsPortal({ children }: { children: ReactNode }) {
  const { slot } = useTopbarTools();
  return slot ? createPortal(children, slot) : null;
}
