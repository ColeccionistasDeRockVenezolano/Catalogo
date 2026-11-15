// CRV · Quién ve el detalle de un error (Brian, 2026-11-12): solo un
// administrador dentro de Curaduría o Administración. El resto ve la pantalla
// de servicio con el código de referencia; el detalle va al log.
import { useOptionalOperator } from "./OperatorContext";

// Por segmento y no por prefijo exacto: el build público vive bajo /crv/.
const ADMIN_AREA = /(?:^|\/)(?:curaduria|administrar)(?:\/|$)/u;

export function isAdminArea(pathname: string): boolean {
  return ADMIN_AREA.test(pathname);
}

export function useShowErrorDetail(): boolean {
  const operator = useOptionalOperator();
  return Boolean(operator?.isAdmin) && isAdminArea(window.location.pathname);
}
