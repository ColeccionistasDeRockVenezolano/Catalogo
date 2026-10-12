// CRV · Sellos compuestos y su rol en el disco (plan del primo, etapa 2, punto 7).
//
// Las fuentes escriben el sello de un disco venezolano como «PolyGram/Rodven»,
// «Lyric/AVR» o «Independent/Cendis»: no es un sello, son dos empresas con
// papeles distintos. Decisión de Brian (2026-10-12): partir cada compuesto en
// sus sellos reales, cada uno con su rol en el disco —sello, distribuidor o
// licenciatario— y NO deducir de «dos sellos» un traspaso entre empresas (la
// sucesión solo se registra con fuente, en `organization_relations`).
//
// Reglas del rol, en orden:
//   1. «Independent» no es un sello: marca una edición del propio artista; lo
//      que le acompaña es quien la distribuye.
//   2. La primera parte es el sello.
//   3. Las demás, distribuidor; salvo que el sello sea un sello extranjero y la
//      parte, una disquera venezolana que publicaba catálogos ajenos (Palacio,
//      Rodven, Promus…): entonces es el licenciatario.
//   4. Lo que no encaja (patrocinantes, más de dos empresas) se marca para
//      revisar: el rol propuesto es «distribuidor».
import { normalizeEntityName } from "../normalization/entity-name.js";

export type LabelRole = "label" | "distributor" | "licensee";

export interface LabelPart {
  /** Tal como aparece en el compuesto («Polygram »→«Polygram»). */
  name: string;
  role: LabelRole;
}

export interface CompositeSplit {
  source: string;
  parts: LabelPart[];
  /** La fuente marca la edición como del propio artista («Independent/…»). */
  selfReleased: boolean;
  /** Motivo por el que el rol propuesto no es seguro. */
  doubt: string | null;
}

/** Nombres con barra que son UN sello (estilizados o empresas conjuntas). */
const NOT_COMPOSITE = new Set(["sony bmg", "lov recs", "m saves", "ac dc"]);

const INDEPENDENT = /^(?:independ[a-z]*|independiente|indie|autoedici[oó]n|self[- ]released)$/iu;

/** Sellos extranjeros cuyo catálogo se publicaba en Venezuela bajo licencia. */
const FOREIGN_LABELS = new Set([
  "fania", "london", "polygram", "columbia", "a y m records", "a y m", "basf", "areito", "cbs", "rca", "emi", "philips",
  "decca", "atlantic", "warner", "capitol", "mercury", "tropical", "alma records",
]);

/** Disqueras venezolanas que licenciaban catálogos ajenos. */
const VENEZUELAN_LICENSEES = new Set([
  "palacio", "rodven", "th rodven", "promus", "sonografica", "discos leon", "leon", "integra", "velvet", "discomoda",
]);

const key = (value: string): string => normalizeEntityName(value).secondaryKey;
export const looseKey = (value: string): string => normalizeEntityName(value).secondaryKey.replace(/\s+(?:records?|music|discos?)$/u, "").trim();

/** ¿Es un compuesto de varias empresas? «Sony/BMG» y «LOV/RECS» son un solo sello. */
export function isCompositeLabel(name: string): boolean {
  if (!name.includes("/")) return false;
  if (NOT_COMPOSITE.has(normalizeEntityName(name).secondaryKey)) return false;
  const parts = name.split("/").map((part) => part.trim()).filter(Boolean);
  return parts.length >= 2 && parts.every((part) => part.length >= 2);
}

/**
 * Parte «London-Palacio/Rodven» en London, Palacio y Rodven con su rol. El
 * guion solo separa cuando sus dos lados son sellos conocidos (TH-Rodven y
 * EMI-Odeon son un nombre).
 */
export function splitCompositeLabel(name: string): CompositeSplit | null {
  if (!isCompositeLabel(name)) return null;
  const raw = name.split("/").map((part) => part.trim()).filter(Boolean)
    .flatMap((part) => {
      const dash = part.split(/\s*-\s*/u);
      return dash.length === 2 && FOREIGN_LABELS.has(looseKey(dash[0]!)) && VENEZUELAN_LICENSEES.has(looseKey(dash[1]!)) ? dash : [part];
    });
  const selfReleased = raw.some((part) => INDEPENDENT.test(part));
  const companies = raw.filter((part) => !INDEPENDENT.test(part));
  const doubts: string[] = [];
  const parts: LabelPart[] = [];
  if (companies.length === 0) return null;
  if (selfReleased && INDEPENDENT.test(raw[0]!)) {
    // «Independent/Cendis»: edición del artista que distribuye Cendis.
    for (const company of companies) parts.push({ name: company, role: "distributor" });
  } else {
    const [label, ...rest] = companies;
    parts.push({ name: label!, role: "label" });
    const foreign = FOREIGN_LABELS.has(looseKey(label!));
    for (const company of rest) {
      const licensee = foreign && VENEZUELAN_LICENSEES.has(looseKey(company));
      parts.push({ name: company, role: licensee ? "licensee" : "distributor" });
    }
    if (selfReleased) doubts.push("«Independent» va después del sello: el sello figura como propio del artista");
  }
  if (companies.length > 2) doubts.push(`${companies.length} empresas en un compuesto: el orden de los papeles no es seguro`);
  return { source: name, parts, selfReleased, doubt: doubts.length ? doubts.join("; ") : null };
}

/** Clave para emparejar una parte con una organización del catálogo. */
export function labelMatchKeys(name: string): string[] {
  return [...new Set([key(name), looseKey(name), normalizeEntityName(name).compactSecondaryKey])].filter(Boolean);
}

export const LABEL_ROLE_LABEL: Readonly<Record<LabelRole, string>> = {
  label: "Sello",
  distributor: "Distribuidor",
  licensee: "Licenciatario",
};
