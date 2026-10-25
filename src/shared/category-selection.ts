/** Acepta URLs antiguas, listas separadas por comas y parámetros repetidos. */
export function parseCategorySelection(values: readonly string[], allowed?: readonly string[]): string[] {
  return [...new Set(values.flatMap(value => value.split(",")).map(value => value.trim())
    .filter(value => value && (!allowed || allowed.includes(value))))];
}

export function toggleCategorySelection(selected: readonly string[], value: string): string[] {
  return selected.includes(value) ? selected.filter(key => key !== value) : [...selected, value];
}

/** Las categorías seleccionadas se combinan con Y, incluso si no hay resultados. */
export function matchesCategorySelection(available: readonly string[], selected: readonly string[]): boolean {
  return selected.every(key => available.includes(key));
}
