import type { VerificationFinding, VerificationReport } from "./types.js";

/** Full review queue: pagination belongs to the interface, never to this selection. */
export function curationFindings(report: Pick<VerificationReport, "suggestions" | "findings">): VerificationFinding[] {
  const seen = new Set<string>();
  return [...(report.suggestions ?? []), ...report.findings.filter(f => f.status === "missing" || f.status === "contradicted")]
    .filter(f => { if (seen.has(f.key)) return false; seen.add(f.key); return true; });
}

export function findingInstruction(item: VerificationFinding): string {
  const genreScope = item.area === "genres" ? " Revisa también todos los géneros documentados para esta misma ficha en las citas del hallazgo; propone cada género faltante por separado. Conserva los ya confirmados. Si la fuente no jerarquiza los géneros, propone los nuevos como secundarios y explica que es un criterio editorial, sin cambiar el principal." : "";
  const imageScope = item.area === "images" ? " Comprueba que la URL sea una imagen del artista o la portada de la edición indicada. Prioriza el original de mayor resolución; revisa nitidez y marcas de agua. No des por comprobada la calidad solo por las dimensiones declaradas ni reemplaces una imagen mejor por una miniatura." : "";
  return `Prepara ${item.area === "genres" ? "la revisión de géneros a partir" : "la corrección"} del hallazgo ${item.key} (${item.label}). Dato actual: ${item.value ?? "Sin dato"}. Dato encontrado: ${item.observed ?? "Consultar fuentes"}. Contexto: ${item.context.join(" · ")}. ${item.explanation} Usa las citas del informe, cruza los hallazgos con la ficha y conserva los datos válidos. Aprovecha también cualquier información adicional documentada para esta ficha y sus relaciones: propone cada mejora por separado, con sus propias fuentes. Si falta respaldo o un campo compatible, conserva el dato, la entidad y la fuente como pendiente.${genreScope}${imageScope} Si falta el valor, investiga las fuentes; si no se puede determinar, explica la duda sin inventarlo.`.slice(0, 5500);
}
