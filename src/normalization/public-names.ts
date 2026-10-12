// CRV · Nombres tal como los ve el público (plan del primo, etapa 1, puntos 2 y 10).
//
// Nada de esto cambia la base: los alias redundantes siguen guardados (sirven
// para la búsqueda y para emparejar ingestas) y el nombre de la persona sigue
// siendo su nombre real. Solo decide qué se muestra.

/** Clave de comparación de pantalla: sin mayúsculas, tildes ni espacios repetidos. */
export function displayKey(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[“”«»„]/gu, '"')
    .toLocaleLowerCase("es")
    .replace(/\s+/gu, " ")
    .trim();
}

export interface AliasLike {
  alias: string;
  aliasType: string;
}

/**
 * Marca los alias que el público no ve: los iguales al nombre de la ficha
 * (también si solo cambian mayúsculas o tildes, «Dj Afro» en «DJ Afro»), los
 * repetidos entre sí y los que un curador marcó como variante de fuente.
 */
export function markPublicAliases<T extends AliasLike>(name: string, aliases: readonly T[], alsoShownAs: readonly string[] = []): Array<T & { publicHidden: boolean }> {
  // `alsoShownAs`: otras formas que la ficha ya muestra (el nombre con apodo del título).
  const seen = new Set<string>([name, ...alsoShownAs].map(displayKey));
  return aliases.map((alias) => {
    const key = displayKey(alias.alias);
    const hidden = alias.aliasType === "source_variant" || seen.has(key);
    seen.add(key);
    return { ...alias, publicHidden: hidden };
  });
}

// Segundo nombre de pila frecuente: en «José Luis Pardo» el apodo va después de
// «Luis»; en «Tirone González Orama», después de «Tirone».
const SECOND_GIVEN_NAMES = new Set([
  "adolfo", "agustin", "alberto", "alejandro", "alexander", "alfonso", "alfredo", "andres", "angel", "antonio",
  "armando", "arturo", "augusto", "carlos", "cesar", "cristina", "daniel", "david", "eduardo", "elena", "elias",
  "emilio", "enrique", "ernesto", "esteban", "eugenia", "felipe", "fernando", "francisco", "gabriel", "gabriela",
  "gerardo", "gregorio", "guillermo", "gustavo", "ignacio", "isabel", "javier", "jesus", "jose", "josefina", "juan",
  "julio", "leonardo", "lucia", "luis", "luisa", "manuel", "marcos", "margarita", "maria", "mariana", "mario",
  "miguel", "nicolas", "pablo", "patricia", "pedro", "rafael", "ramon", "ricardo", "roberto", "rodolfo", "rosa",
  "salvador", "santiago", "teresa", "tomas", "vicente", "victor",
]);

const QUOTED = /^(.*?)\s*["“«]([^"”»]+)["”»]\s*(.*)$/u;

/**
 * «Nombre "Apodo" Apellido» a partir del nombre y de su alias de apodo
 * (`nickname`). Si alguna fuente ya lo escribió intercalado («José Luis "Cheo"
 * Pardo»), se respeta esa posición; si no, el apodo va tras el nombre de pila.
 * Devuelve null cuando no hay nada que componer.
 */
export function composeNicknameName(name: string, aliases: readonly AliasLike[]): string | null {
  const words = name.trim().split(/\s+/u).filter(Boolean);
  if (words.length < 2) return null;
  const nameKey = displayKey(name);
  const nicknames = aliases
    .filter((alias) => alias.aliasType === "nickname")
    .map((alias) => alias.alias.trim())
    .filter((nick) => nick && !nameKey.split(" ").includes(displayKey(nick)) && !nameKey.includes(displayKey(nick)));
  if (!nicknames.length) return null;
  const nickKeys = new Set(nicknames.map(displayKey));
  for (const alias of aliases) {
    const match = QUOTED.exec(alias.alias.trim());
    if (!match || !nickKeys.has(displayKey(match[2] ?? ""))) continue;
    const before = (match[1] ?? "").trim();
    const after = (match[3] ?? "").trim();
    if (!before || !after) continue;
    if (displayKey(`${before} ${after}`) !== nameKey) continue;
    const at = before.split(/\s+/u).length;
    return [...words.slice(0, at), `"${match[2]!.trim()}"`, ...words.slice(at)].join(" ");
  }
  const nick = nicknames[0]!;
  const at = words.length === 2 ? 1 : words.length >= 4 ? 2 : SECOND_GIVEN_NAMES.has(displayKey(words[1]!)) ? 2 : 1;
  return [...words.slice(0, at), `"${nick}"`, ...words.slice(at)].join(" ");
}
