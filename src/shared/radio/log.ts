// CRV · Registro de la radio: una línea JSON, para el diario del servicio.
/* eslint-disable no-console -- el registro de la radio se escribe en el diario del servicio; también corre en scripts sin pino. */
export function radioLog(level: "info" | "warn" | "error", event: string, fields: Record<string, unknown> = {}): void {
  const line = JSON.stringify({ level, event, ...fields });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.info(line);
}
