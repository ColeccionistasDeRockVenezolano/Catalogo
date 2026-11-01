// Grafo de afinidad entre los géneros del catálogo de la radio.
//
// El catálogo v3 anota el género del álbum en cada pieza (`genres`): un género
// primario, cero o más secundarios y las familias a las que pertenece. La
// programación usa ese grafo para que el ciclo recorra estilos compatibles en
// vez de saltar de un extremo a otro.
//
// Escala de compatibilidad (la misma que se acordó para CRV):
//   100  mismo género
//    80  géneros muy cercanos (vecinos declarados del mapa)
//    60  género puente (misma familia o familia enlazada)
//    30  poco relacionados (familias sin puente; solo si no queda alternativa)
//     0  contraste extremo (bloqueado; nadie lo usa para programar)
//
// Los pares declarados se leen en las dos direcciones: si el mapa dice que
// Rock acepta Hard rock, Hard rock acepta Rock aunque no se repita la fila.
export type GenreScore = 100 | 80 | 60 | 30 | 0;

export interface RadioGenreRef {
  slug?: string | null;
  name?: string | null;
  family?: string | null;
}

// Bloque `genres` del catálogo v3: lo escribe el anotador del repo CRV.
export interface RadioItemGenres {
  primaryGenre?: RadioGenreRef | null;
  secondaryGenres?: RadioGenreRef[] | null;
  families?: Array<string | RadioGenreRef> | null;
  genreOrigin?: string | null;
  genreStatus?: string | null;
}

// Vecinos directos (80). Es el mapa acordado, transcrito sin interpretación.
const DECLARED_NEIGHBOURS: Record<string, readonly string[]> = {
  'rock': ['rock-and-roll', 'pop-rock', 'rock-alternativo', 'hard-rock'],
  'pop-rock': ['rock', 'pop', 'indie-rock', 'rock-alternativo'],
  'rock-alternativo': ['indie-rock', 'post-punk', 'pop-rock', 'metal-alternativo'],
  'ska': ['reggae', 'punk-rock', 'rock-latino'],
  'electronica': ['house', 'downtempo', 'synth-pop'],
  'pop': ['pop-rock', 'pop-latino', 'synth-pop'],
  'punk-rock': ['punk', 'hardcore-punk', 'post-punk', 'ska'],
  'punk': ['punk-rock', 'hardcore-punk', 'post-punk'],
  'indie-rock': ['rock-alternativo', 'pop-rock', 'post-punk'],
  'rock-progresivo': ['rock-sinfonico', 'rock-psicodelico', 'experimental'],
  'reggae': ['ska', 'fusion-latina', 'funk'],
  'hard-rock': ['rock', 'heavy-metal', 'rock-and-roll'],
  'metal-alternativo': ['heavy-metal', 'metal-latino', 'hard-rock', 'rock-alternativo'],
  'rock-latino': ['rock', 'pop-rock', 'fusion-latina', 'ska'],
  'experimental': ['rock-psicodelico', 'rock-progresivo', 'electronica'],
  'rock-and-roll': ['rock', 'rockabilly', 'hard-rock'],
  'hip-hop': ['funk', 'downtempo', 'electronica'],
  'fusion-latina': ['rock-latino', 'reggae', 'ska', 'pop-latino'],
  'rock-sinfonico': ['rock-progresivo', 'rock-psicodelico'],
  'downtempo': ['electronica', 'house', 'synth-pop'],
  'pop-latino': ['pop', 'pop-rock', 'fusion-latina'],
  'hardcore-punk': ['punk', 'punk-rock', 'metal-alternativo'],
  'heavy-metal': ['hard-rock', 'metal-alternativo', 'metal-latino'],
  'rockabilly': ['rock-and-roll', 'rock'],
  'funk': ['jazz', 'hip-hop', 'reggae'],
  'house': ['electronica', 'downtempo', 'synth-pop'],
  'jazz': ['funk', 'rock-progresivo', 'fusion-latina'],
  'post-punk': ['punk-rock', 'indie-rock', 'rock-alternativo', 'synth-pop'],
  'synth-pop': ['pop', 'electronica', 'house', 'post-punk'],
  'rock-psicodelico': ['rock-progresivo', 'rock-sinfonico', 'experimental'],
  'metal-latino': ['heavy-metal', 'metal-alternativo', 'hard-rock'],
  // Puentes declarados para familias que no son un estilo en sí.
  'musica-venezolana': ['fusion-latina'],
  'blues': ['rock-and-roll'],
  'folk': ['fusion-latina', 'rock-latino'],
  'spoken-word': ['downtempo', 'hip-hop'],
};

// Familias que conviven bien: puente a 60 cuando los dos géneros no son
// vecinos declarados. El par se normaliza en orden alfabético.
const FAMILY_BRIDGES: ReadonlyArray<readonly [string, string]> = [
  ['blues', 'folk'], ['blues', 'jazz'], ['blues', 'rock'],
  ['electronica', 'experimental'], ['electronica', 'folk'], ['electronica', 'funk-y-soul'],
  ['electronica', 'fusion-latina'], ['electronica', 'hip-hop'], ['electronica', 'jazz'],
  ['electronica', 'pop'], ['electronica', 'rock'],
  ['experimental', 'fusion-latina'], ['experimental', 'jazz'], ['experimental', 'metal'],
  ['experimental', 'rock'],
  ['folk', 'fusion-latina'], ['folk', 'jazz'], ['folk', 'musica-venezolana'], ['folk', 'rock'],
  ['funk-y-soul', 'fusion-latina'], ['funk-y-soul', 'hip-hop'], ['funk-y-soul', 'jazz'],
  ['funk-y-soul', 'pop'], ['funk-y-soul', 'reggae-y-ska'], ['funk-y-soul', 'rock'],
  ['fusion-latina', 'hip-hop'], ['fusion-latina', 'jazz'], ['fusion-latina', 'musica-venezolana'],
  ['fusion-latina', 'pop'], ['fusion-latina', 'reggae-y-ska'], ['fusion-latina', 'rock'],
  ['hip-hop', 'pop'], ['hip-hop', 'reggae-y-ska'],
  ['jazz', 'rock'],
  ['metal', 'punk'], ['metal', 'rock'],
  ['musica-venezolana', 'rock'],
  ['pop', 'rock'], ['punk', 'reggae-y-ska'], ['punk', 'rock'], ['reggae-y-ska', 'rock'],
];

// Familias transversales: conviven con cualquier estilo porque describen el
// soporte o el uso, no el sonido. Se puntúan como puente y se afinan con los
// géneros secundarios cuando el catálogo los trae.
const TRANSVERSAL_FAMILIES = new Set(['bandas-sonoras', 'instrumental', 'spoken-word', 'musica-cristiana']);

// Pares de contraste extremo (0). Hoy no hay ninguno declarado: la escala se
// conserva para poder bloquear un cruce concreto sin tocar la programación.
const EXTREME_PAIRS: ReadonlyArray<readonly [string, string]> = [];

const declared = new Set<string>();
for (const [from, list] of Object.entries(DECLARED_NEIGHBOURS)) {
  for (const to of list) declared.add(`${from}>${to}`);
}
const bridged = new Set(FAMILY_BRIDGES.map(([a, b]) => pairKey(a, b)));
const extreme = new Set(EXTREME_PAIRS.map(([a, b]) => pairKey(a, b)));

function pairKey(a: string, b: string): string {
  return a <= b ? `${a}|${b}` : `${b}|${a}`;
}

// Clave estable de un género: sin acentos, minúsculas y con guiones.
export function genreKey(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

interface GenreKeys {
  primary: string;
  secondary: string[];
  families: string[];
}

function keysOf(genres: RadioItemGenres | null | undefined): GenreKeys {
  if (!genres) return { primary: '', secondary: [], families: [] };
  const primary = typeof genres.primaryGenre?.slug === 'string' && genres.primaryGenre.slug.trim()
    ? genreKey(genres.primaryGenre.slug)
    : genreKey(genres.primaryGenre?.name);
  const secondary: string[] = [];
  for (const ref of genres.secondaryGenres ?? []) {
    const key = typeof ref?.slug === 'string' && ref.slug.trim() ? genreKey(ref.slug) : genreKey(ref?.name);
    if (key && key !== primary && !secondary.includes(key)) secondary.push(key);
  }
  const families: string[] = [];
  const primaryFamily = genreKey(genres.primaryGenre?.family);
  if (primaryFamily) families.push(primaryFamily);
  for (const family of genres.families ?? []) {
    const key = genreKey(typeof family === 'string' ? family : (family as { name?: unknown })?.name);
    if (key && !families.includes(key)) families.push(key);
  }
  return { primary, secondary, families };
}

function familyScore(a: GenreKeys, b: GenreKeys): GenreScore {
  if (!a.families.length || !b.families.length) return 30;
  const best: GenreScore = 30;
  for (const familyA of a.families) {
    for (const familyB of b.families) {
      if (familyA === familyB) return 60;
      if (TRANSVERSAL_FAMILIES.has(familyA) || TRANSVERSAL_FAMILIES.has(familyB)) return 60;
      if (bridged.has(pairKey(familyA, familyB))) return 60;
    }
  }
  return best;
}

// Compatibilidad entre dos géneros sueltos (sin mirar el resto del ítem). Sin
// familias, solo se aplica la tabla declarada; genreAffinity es la que conoce
// la familia real de cada género.
export function pairScore(a: string, b: string): GenreScore {
  const left = genreKey(a);
  const right = genreKey(b);
  if (!left || !right) return 60;
  if (left === right) return 100;
  if (extreme.has(pairKey(left, right))) return 0;
  if (declared.has(`${left}>${right}`) || declared.has(`${right}>${left}`)) return 80;
  return familyScore({ primary: left, secondary: [], families: [left] }, { primary: right, secondary: [], families: [right] });
}

// Compatibilidad entre dos piezas: manda el primario y los secundarios pueden
// subir un escalón (nunca hasta 100, que queda para el mismo género).
export function genreAffinity(
  a: RadioItemGenres | null | undefined,
  b: RadioItemGenres | null | undefined,
): GenreScore {
  const left = keysOf(a);
  const right = keysOf(b);
  // Sin género en alguno de los dos: no hay salto que castigar.
  if (!left.primary || !right.primary) return 60;
  if (left.primary === right.primary) return 100;

  let best: GenreScore = pairScore(left.primary, right.primary);
  const familyBase = familyScore(
    { primary: left.primary, secondary: left.secondary, families: left.families },
    { primary: right.primary, secondary: right.secondary, families: right.families },
  );
  if (familyBase > best) best = familyBase;

  for (const secondary of [...left.secondary, ...right.secondary]) {
    const score = pairScore(left.primary, secondary) > pairScore(right.primary, secondary)
      ? pairScore(left.primary, secondary)
      : pairScore(right.primary, secondary);
    if (score >= 80) return 80;
    if (score === 60 && best < 60) best = 60;
  }
  return best;
}

export function genrePrimaryKey(genres: RadioItemGenres | null | undefined): string {
  return keysOf(genres).primary;
}
