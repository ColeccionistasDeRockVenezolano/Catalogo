/** Shared by investigation, proposals and executable curation controls. */
export const EDITORIAL_POLICY_VERSION = 1;
export const EDITORIAL_POLICY_INSTRUCTIONS = `POLÍTICA EDITORIAL CRV v${EDITORIAL_POLICY_VERSION}: el disco más antiguo no demuestra el año de formación; un hueco en las pistas no prueba una numeración incorrecta; una ficha sin vínculos no prueba una identidad inválida. Conserva estos casos como pendientes hasta tener documentación específica o una decisión editorial explícita con motivo. Distingue obra, edición y soporte (CD/DVD); no mezcles pistas ni sellos de ediciones distintas. Conserva la precisión documental de fechas y períodos; un año no permite inventar mes o día. La captura original y la lectura posterior de un archivo son eventos distintos. Autocorrige únicamente transformaciones cuya validez pueda demostrarse y revalídalas contra el estado actual.`;

// Positive allowlist: a new level-0 action must justify its safety before it can run unattended.
const DEMONSTRABLE_AUTOFIX_ACTIONS = new Set(["limpiar_texto", "decodificar_html", "recortar_extremos", "vaciar_duracion"]);
export function permitsAutofix(actionKey: string): boolean { return DEMONSTRABLE_AUTOFIX_ACTIONS.has(actionKey); }

export function requireEditorialBasis(basis: string | undefined): void {
  if (!basis || basis.trim().length < 12) throw new Error("hace falta respaldo documental o un motivo editorial explícito; el hallazgo por sí solo no demuestra la corrección");
}
