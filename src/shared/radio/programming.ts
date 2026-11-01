// Programación por bloques de género para la radio.
//
// Sustituye el barajado uniforme del ciclo por un recorrido del grafo de
// afinidad: tramos de 3-5 piezas de estilos compatibles, transición por
// vecinos (80) o puentes (60) y saltos duros (30) solo cuando el catálogo no
// deja otra salida. Todo se deriva de una semilla, así que sigue siendo
// determinista: dos servidores con el mismo catálogo emiten lo mismo.
//
// Reglas aplicadas:
//   1. Bloques de `blockMin`..`blockMax` piezas (3-5 por defecto).
//   2. Afinidad por primario y secundarios (radio-genres.ts).
//   3. Puentes antes de un cambio radical; los 30 se evitan mientras haya ≥60.
//   4. Energía/BPM: si algún día el catálogo trae `energy` (0-1) o `bpm`, el
//      bloque se ordena para acercarse al género siguiente y el desempate usa
//      la energía media. Sin esos datos no cambia nada.
//   5. Variedad: nunca dos piezas del mismo video ni del mismo artista dentro
//      del bloque; ventana de artistas recientes; rotación de visitas para que
//      las familias minoritarias no queden todas al final del ciclo.
import { genreAffinity, genrePrimaryKey, type GenreScore, type RadioItemGenres } from './genres.js';

export interface ProgrammableItem {
  videoId: string;
  artist: string | null;
  startSeconds?: number | null;
  genres?: RadioItemGenres | null;
  // Metadatos opcionales: hoy el catálogo del CRV no los trae.
  energy?: number | null;
  bpm?: number | null;
}

export interface GenreProgrammingOptions {
  blockMin?: number;
  blockMax?: number;
  artistWindow?: number;
}

export interface ProgrammingReport {
  pieces: number;
  genres: number;
  pairs: Record<GenreScore, number>;
  hardJumps: number;
  maxSameGenreRun: number;
  blocksOfThreeOrMore: number;
  repeatedArtists: number;
  coverage: boolean;
}

const DEFAULT_BLOCK_MIN = 3;
const DEFAULT_BLOCK_MAX = 5;
const DEFAULT_ARTIST_WINDOW = 8;
const RECENT_BLOCKS = 3;
// Tras unos cuantos bloques, un género que aún no sonó y es al menos puente
// (60) entra aunque haya vecinos directos: así las minorías no esperan al
// final del ciclo.
const EXPLORE_AFTER_BLOCKS = 4;
const COMPILATION_ARTIST = /^(various artists|varios artistas|v\.?\s?a\.?)$/i;

// mulberry32: mismo tipo de generador que el servicio, sin estado global.
export function seededRandom(seed: number): () => number {
  let state = (seed >>> 0) || 0x9e3779b9;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 0x1_0000_0000;
  };
}

function shuffle<T>(list: T[], rnd: () => number): T[] {
  for (let index = list.length - 1; index > 0; index -= 1) {
    const target = Math.floor(rnd() * (index + 1));
    [list[index], list[target]] = [list[target]!, list[index]!];
  }
  return list;
}

export function artistKey(artist: string | null | undefined): string {
  if (!artist || COMPILATION_ARTIST.test(artist)) return '';
  return artist.trim().toLocaleLowerCase('es');
}

export function itemEnergy(item: ProgrammableItem): number | null {
  if (typeof item.energy === 'number' && Number.isFinite(item.energy)) {
    return Math.min(1, Math.max(0, item.energy));
  }
  if (typeof item.bpm === 'number' && Number.isFinite(item.bpm) && item.bpm > 0) {
    return Math.min(1, Math.max(0, (item.bpm - 60) / 120));
  }
  return null;
}

function meanEnergy(items: readonly ProgrammableItem[]): number | null {
  let sum = 0;
  let count = 0;
  for (const item of items) {
    const energy = itemEnergy(item);
    if (energy === null) continue;
    sum += energy;
    count += 1;
  }
  return count > 0 ? sum / count : null;
}

function pieceKey(item: ProgrammableItem): string {
  return `${item.videoId}:${item.startSeconds ?? ''}`;
}

// Programación del ciclo: devuelve las mismas piezas, en otro orden.
export function genreProgrammingOrder<T extends ProgrammableItem>(
  items: readonly T[],
  seed: number,
  options: GenreProgrammingOptions = {},
): T[] {
  if (items.length < 2) return items.slice();
  const blockMin = Math.max(2, Math.floor(options.blockMin ?? DEFAULT_BLOCK_MIN));
  const blockMax = Math.max(blockMin, Math.floor(options.blockMax ?? DEFAULT_BLOCK_MAX));
  const artistWindow = Math.max(0, Math.floor(options.artistWindow ?? DEFAULT_ARTIST_WINDOW));
  const rnd = seededRandom(seed);

  // Un género desconocido no rompe nada: se agrupa como pool propio y se
  // relaciona por familia (60), nunca se descarta.
  const pools = new Map<string, T[]>();
  for (const item of items) {
    const key = genrePrimaryKey(item.genres);
    const pool = pools.get(key);
    if (pool) pool.push(item);
    else pools.set(key, [item]);
  }
  for (const pool of pools.values()) shuffle(pool, rnd);

  const refs = new Map<string, RadioItemGenres | null | undefined>();
  const energies = new Map<string, number | null>();
  const targetBlocks = new Map<string, number>();
  for (const [key, pool] of pools) {
    refs.set(key, pool[0]?.genres);
    energies.set(key, meanEnergy(pool));
    targetBlocks.set(key, Math.max(1, Math.ceil(pool.length / ((blockMin + blockMax) / 2))));
  }

  // Matriz de afinidad entre los géneros presentes: se calcula una vez por
  // ciclo (69×69 en el CRV) en lugar de normalizar nombres en cada bloque.
  // Se puntúa por primario + familia: los secundarios son del álbum concreto,
  // no del género, y usarlos aquí acercaría «Rock» a «Electrónica» por un
  // disco suelto con secundario synth-pop.
  const primeRefs = new Map<string, RadioItemGenres | null | undefined>();
  for (const [key, genres] of refs) primeRefs.set(key, { primaryGenre: genres?.primaryGenre ?? null });
  const affinity = new Map<string, GenreScore>();
  const genreOrder = [...pools.keys()];
  const scoreOf = (a: string, b: string): GenreScore => {
    if (a === b) return 100;
    const key = a <= b ? `${a}|${b}` : `${b}|${a}`;
    const cached = affinity.get(key);
    if (cached !== undefined) return cached;
    const score = genreAffinity(primeRefs.get(a), primeRefs.get(b));
    affinity.set(key, score);
    return score;
  };
  for (const a of genreOrder) {
    for (const b of genreOrder) {
      if (a === b) continue;
      const key = a <= b ? `${a}|${b}` : `${b}|${a}`;
      if (affinity.has(key)) continue;
      affinity.set(key, genreAffinity(primeRefs.get(a), primeRefs.get(b)));
    }
  }
  const exits = new Map<string, number>();
  for (const a of genreOrder) {
    exits.set(a, genreOrder.filter(b => b !== a && scoreOf(a, b) >= 60).length);
  }

  const available = (): string[] => [...pools.entries()].filter(([, pool]) => pool.length > 0).map(([key]) => key);
  const visits = new Map<string, number>();
  const lastVisit = new Map<string, number>();
  const recentArtists: string[] = [];
  const order: T[] = [];
  let blockIndex = 0;

  const remember = (item: T): void => {
    const artist = artistKey(item.artist);
    if (!artist) return;
    recentArtists.push(artist);
    if (recentArtists.length > artistWindow) recentArtists.shift();
  };

  const takeBlock = (zone: readonly string[], size: number): T[] => {
    const block: T[] = [];
    const blockArtists = new Set<string>();
    const blockVideos = new Set<string>();
    for (const key of zone) {
      const pool = pools.get(key);
      if (!pool) continue;
      while (pool.length > 0 && block.length < size) {
        // Preferente: artista que no esté ni en el bloque ni en la ventana.
        let index = pool.findIndex(candidate => {
          const artist = artistKey(candidate.artist);
          return !blockVideos.has(candidate.videoId)
            && (!artist || (!blockArtists.has(artist) && !recentArtists.includes(artist)));
        });
        if (index < 0) {
          // Sin alternativa: al menos no repetir álbum dentro del bloque.
          index = pool.findIndex(candidate => !blockVideos.has(candidate.videoId));
        }
        if (index < 0) break;
        const [item] = pool.splice(index, 1);
        if (!item) break;
        block.push(item);
        blockVideos.add(item.videoId);
        const artist = artistKey(item.artist);
        if (artist) blockArtists.add(artist);
      }
      if (block.length >= size) break;
    }
    return block;
  };

  // El siguiente género: primero las minorías que aún no sonaron (siempre que
  // sean al menos puente), después afinidad, y entre iguales cuota de emisión
  // (para que el género dominante se reparta y no caiga todo al final).
  const nextGenre = (from: string): string | null => {
    const candidates = available();
    if (candidates.length === 0) return null;
    const fromEnergy = energies.get(from) ?? null;
    let best: {
      key: string; score: GenreScore; ratio: number; explore: boolean;
      energy: number | null; blockAge: number; exits: number;
    } | null = null;
    const better = (candidate: typeof best, current: typeof best): boolean => {
      if (!candidate) return false;
      if (!current) return true;
      if (candidate.explore !== current.explore) return candidate.explore;
      if (candidate.score !== current.score) return candidate.score > current.score;
      if (Math.abs(candidate.ratio - current.ratio) > 1e-9) return candidate.ratio < current.ratio;
      const candidateRecent = candidate.blockAge <= RECENT_BLOCKS;
      const currentRecent = current.blockAge <= RECENT_BLOCKS;
      if (candidateRecent !== currentRecent) return !candidateRecent;
      if (candidate.energy !== null && current.energy !== null && Math.abs(candidate.energy - current.energy) > 1e-9) {
        return candidate.energy < current.energy;
      }
      if (candidate.exits !== current.exits) return candidate.exits < current.exits;
      return rnd() < 0.5;
    };
    for (const key of candidates) {
      if (key === from && candidates.length > 1) {
        const others = candidates.filter(other => other !== from);
        if (others.some(other => scoreOf(from, other) >= 60)) continue;
      }
      const score = scoreOf(from, key);
      if (score === 0) continue;
      const candidateEnergy = energies.get(key) ?? null;
      const candidate = {
        key,
        score,
        ratio: (visits.get(key) ?? 0) / (targetBlocks.get(key) ?? 1),
        explore: score >= 60 && (visits.get(key) ?? 0) === 0 && blockIndex >= EXPLORE_AFTER_BLOCKS,
        energy: fromEnergy === null || candidateEnergy === null ? null : Math.abs(candidateEnergy - fromEnergy),
        blockAge: blockIndex - (lastVisit.get(key) ?? -RECENT_BLOCKS - 1),
        exits: exits.get(key) ?? 0,
      };
      if (better(candidate, best)) best = candidate;
    }
    return best ? best.key : null;
  };

  // Arranque: uno de los géneros con más piezas, para que el primer tramo
  // suene completo en vez de abrir con un single suelto.
  const bySize = available().sort((a, b) => (pools.get(b)?.length ?? 0) - (pools.get(a)?.length ?? 0));
  let current = bySize[Math.min(bySize.length - 1, Math.floor(rnd() * Math.min(4, bySize.length)))] ?? '';

  let guard = 0;
  const guardLimit = items.length * (blockMax + 2);
  while (order.length < items.length && guard < guardLimit) {
    guard += 1;
    const zone = [current, ...available()
      .filter(key => key !== current)
      .sort((a, b) => scoreOf(current, b) - scoreOf(current, a) || (a < b ? -1 : 1))];
    const size = blockMin + Math.floor(rnd() * (blockMax - blockMin + 1));
    const block = takeBlock(zone, size);
    if (block.length === 0) {
      const next = nextGenre(current);
      if (!next) break;
      current = next;
      continue;
    }
    // Regla de energía: con metadatos, el bloque se ordena para acercarse al
    // género que viene después.
    const next = nextGenre(current);
    const targetEnergy = next ? energies.get(next) ?? null : null;
    const blockEnergy = meanEnergy(block);
    if (targetEnergy !== null && blockEnergy !== null) {
      const ascending = targetEnergy >= blockEnergy;
      block.sort((a, b) => {
        const left = itemEnergy(a) ?? blockEnergy;
        const right = itemEnergy(b) ?? blockEnergy;
        return ascending ? left - right : right - left;
      });
    }
    for (const item of block) {
      order.push(item);
      remember(item);
    }
    visits.set(current, (visits.get(current) ?? 0) + 1);
    lastVisit.set(current, blockIndex);
    blockIndex += 1;
    if (next) current = next;
  }

  // Red de seguridad: si la guarda cortó el recorrido, el resto se añade en
  // orden de pool para no perder piezas del ciclo.
  if (order.length < items.length) {
    for (const key of available()) {
      for (const item of pools.get(key) ?? []) order.push(item);
    }
  }
  separateArtists(order);
  // Reparación de fronteras duras y nueva separación de artistas: el puente
  // puede dejar dos piezas del mismo artista juntas y el separador puede
  // reabrir una frontera. El servicio vuelve a separar (spreadRepeats) al
  // emitir, así que una segunda ronda aquí basta.
  bridgeJumps(order);
  separateArtists(order);
  bridgeJumps(order);
  return order;
}

// Si dos piezas del mismo artista quedaron juntas (borde de bloque o cola del
// recorrido), se busca un intercambio que mantenga la afinidad; primero cerca
// para no romper los bloques, luego en todo el ciclo (el borde de un bloque
// grande al final solo se arregla con una pieza lejana). Si no hay intercambio,
// se mueve la pieza a un hueco donde no choque con sus vecinas.
function separateArtists<T extends ProgrammableItem>(order: T[]): void {
  const clash = (a: T | undefined, b: T | undefined): boolean => {
    if (!a || !b) return false;
    const artist = artistKey(a.artist);
    return Boolean(artist) && artist === artistKey(b.artist);
  };
  for (let index = 1; index < order.length; index += 1) {
    const left = order[index - 1]!;
    const current = order[index]!;
    const artist = artistKey(current.artist);
    if (!artist || artistKey(left.artist) !== artist) continue;
    const right = order[index + 1];
    let fixed = false;
    for (const [minimum, reach] of [[60, 40], [60, order.length], [30, order.length]] as const) {
      for (let distance = 1; distance <= reach && !fixed; distance += 1) {
        for (const candidate of [index + distance, index - distance]) {
          if (candidate < 0 || candidate >= order.length || Math.abs(candidate - index) < 2) continue;
          const swap = order[candidate]!;
          if (artistKey(swap.artist) === artist) continue;
          const before = order[candidate - 1];
          const after = order[candidate + 1];
          // El hueco de destino tampoco puede dejar al artista repetido.
          if (before && artistKey(before.artist) === artist) continue;
          if (after && artistKey(after.artist) === artist) continue;
          if (genreAffinity(left.genres, swap.genres) < minimum) continue;
          if (right && genreAffinity(swap.genres, right.genres) < minimum) continue;
          if (before && genreAffinity(before.genres, current.genres) < minimum) continue;
          if (after && genreAffinity(current.genres, after.genres) < minimum) continue;
          order[candidate] = current;
          order[index] = swap;
          fixed = true;
          break;
        }
      }
      if (fixed) break;
    }
    if (fixed) continue;
    // Último recurso: mover la pieza a un hueco posterior sin choques.
    for (let slot = index + 1; slot < order.length; slot += 1) {
      const before = order[slot]!;
      const after = order[slot + 1];
      if (clash(before, current) || clash(after, current)) continue;
      const previous = order[index - 1];
      const following = order[index + 1];
      if (clash(previous, following)) continue;
      order.splice(index, 1);
      order.splice(slot, 0, current);
      break;
    }
  }
}

// Repara las transiciones duras que quedaron tras el recorrido. Si entre dos
// piezas poco relacionadas existe un género puente (≥60 con las dos), se
// intercambia una pieza de ese género (o se inserta si no hay hueco) para que
// la frontera pase por él. Devuelve cuántas fronteras arregló.
function bridgeJumps<T extends ProgrammableItem>(order: T[]): number {
  const affinity = (a: T | undefined, b: T | undefined): GenreScore => {
    if (!a || !b) return 60;
    return genreAffinity(a.genres, b.genres);
  };
  let fixed = 0;
  for (let index = 1; index < order.length; index += 1) {
    if (affinity(order[index - 1], order[index]) > 30) continue;
    const left = order[index - 1]!;
    const right = order[index]!;
    // Vecino derecho que quedará junto al puente si se intercambia.
    const next = order[index + 1];
    let solved = false;
    for (let distance = 2; distance < order.length && !solved; distance += 1) {
      for (const candidateIndex of [index + distance, index - distance]) {
        if (candidateIndex < 0 || candidateIndex >= order.length) continue;
        if (Math.abs(candidateIndex - index) < 2) continue;
        const bridge = order[candidateIndex]!;
        if (affinity(left, bridge) < 60) continue;
        const before = order[candidateIndex - 1];
        const after = order[candidateIndex + 1];
        const rightArtist = artistKey(right.artist);
        const beforeClash = Boolean(rightArtist) && (rightArtist === artistKey(before?.artist) || rightArtist === artistKey(after?.artist));
        const bridgeArtist = artistKey(bridge.artist);
        // El puente no puede quedar junto a un artista repetido: ni con el
        // vecino izquierdo, ni con el derecho (que es `right` al insertar y
        // `next` al intercambiar: se comprueban los dos).
        if (bridgeArtist && (bridgeArtist === artistKey(left.artist)
          || bridgeArtist === artistKey(right.artist) || bridgeArtist === artistKey(next?.artist))) continue;
        if (beforeClash) continue;
        // Intercambio: el puente ocupa la frontera (entre left y next) y la
        // pieza dura se va al hueco del puente.
        if (affinity(bridge, next) >= 60 && affinity(before, right) >= 60 && affinity(right, after) >= 60) {
          order[candidateIndex] = right;
          order[index] = bridge;
          solved = true;
          break;
        }
        // Inserción: se mueve el puente a la frontera si su hueco no se rompe.
        if (affinity(bridge, right) >= 60 && affinity(before, after) >= 60) {
          const [moved] = order.splice(candidateIndex, 1);
          if (!moved) continue;
          order.splice(candidateIndex < index ? index - 1 : index, 0, moved);
          solved = true;
          break;
        }
      }
    }
    if (solved) fixed += 1;
  }
  return fixed;
}

// Métricas del orden resultante; sirven a los informes y a las pruebas.
export function programmingReport(order: readonly ProgrammableItem[]): ProgrammingReport {
  const pairs: Record<GenreScore, number> = { 100: 0, 80: 0, 60: 0, 30: 0, 0: 0 };
  let hardJumps = 0;
  let repeatedArtists = 0;
  let maxRun = 0;
  let blocks = 0;
  let currentRun = 0;
  let previousKey = '';
  let previousArtist = '';

  for (let index = 0; index < order.length; index += 1) {
    const item = order[index]!;
    const key = genrePrimaryKey(item.genres);
    if (index > 0) {
      const score = genreAffinity(order[index - 1]!.genres, item.genres);
      pairs[score] += 1;
      if (score <= 30) hardJumps += 1;
    }
    const artist = artistKey(item.artist);
    if (artist && artist === previousArtist) repeatedArtists += 1;
    previousArtist = artist;
    if (index === 0 || key !== previousKey) {
      if (currentRun >= 3) blocks += 1;
      currentRun = 1;
    } else {
      currentRun += 1;
      maxRun = Math.max(maxRun, currentRun);
    }
    previousKey = key;
  }
  if (currentRun >= 3) blocks += 1;

  // Un video puede tener varias piezas (capítulos): se comparan piezas, no vídeos.
  const distinct = new Set(order.map(pieceKey));
  return {
    pieces: order.length,
    genres: new Set(order.map(item => genrePrimaryKey(item.genres))).size,
    pairs,
    hardJumps,
    maxSameGenreRun: maxRun,
    blocksOfThreeOrMore: blocks,
    repeatedArtists,
    coverage: distinct.size === order.length,
  };
}
