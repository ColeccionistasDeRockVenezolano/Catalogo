import { parseDateValue } from "../catalog/date-value.js";

export const ACQUISITION_METHODS = ["http", "raw_archive", "local_archive", "search_snippet", "unknown"] as const;
export type AcquisitionMethod = typeof ACQUISITION_METHODS[number];

/** Optional fields allow reading older reports without inventing provenance. */
export interface SourceProvenance {
  capturedAt?: string | null;
  readAt?: string | null;
  acquisitionMethod?: AcquisitionMethod;
}

export function sourceProvenance(source: { capturedAt?: unknown; readAt?: unknown; acquisitionMethod?: unknown }): Required<SourceProvenance> {
  const method = ACQUISITION_METHODS.includes(source.acquisitionMethod as AcquisitionMethod) ? source.acquisitionMethod as AcquisitionMethod : "unknown";
  return {
    capturedAt: method === "unknown" ? null : acquisitionInstant(source.capturedAt), readAt: acquisitionInstant(source.readAt),
    acquisitionMethod: method,
  };
}
/** A year, local date or rollover date cannot establish when acquisition occurred. */
function acquisitionInstant(value: unknown): string | null {
  if (typeof value !== "string") return null;
  // Accept the ISO instants from HTTP and PostgreSQL's timestamptz text;
  // preserve the original string so JavaScript never truncates microseconds.
  const match = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.\d{1,6})?(?:Z|[+-]\d{2}(?::?\d{2})?)$/u.exec(value);
  if (!match || Number(match[2])>23 || Number(match[3])>59 || Number(match[4])>59 || !Number.isFinite(Date.parse(value))) return null;
  try { parseDateValue(match[1]!); return value; }
  catch { return null; }
}
