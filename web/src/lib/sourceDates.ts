import type { SourceProvenance } from "../../../src/evidence/provenance";

const METHODS = {
  http: "Descarga web", raw_archive: "Archivo conservado", local_archive: "Archivo local",
  search_snippet: "Resumen del buscador", unknown: "Método no registrado",
};

export function sourceDates(source: SourceProvenance & { fetchedAt?: string }): string {
  const format = (value: string | null | undefined): string | null => value && Number.isFinite(Date.parse(value))
    ? new Date(value).toLocaleDateString("es-VE", { timeZone: "UTC" }) : null;
  const captured = format(source.capturedAt);
  const read = format(source.readAt);
  const historical = source.capturedAt === undefined ? format(source.fetchedAt) : null;
  return [captured ? `Capturada ${captured}` : "Captura original sin fecha verificada",
    historical ? `Fecha histórica sin verificar: ${historical}` : null,
    read ? `Leída ${read}` : null, METHODS[source.acquisitionMethod ?? "unknown"]].filter(Boolean).join(" · ");
}
