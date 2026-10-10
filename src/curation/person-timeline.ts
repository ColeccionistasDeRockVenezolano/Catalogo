// CRV · Trayectoria de una persona en el tiempo (Brian, 2026-10-06, caso Víctor
// Valerio): una ficha no puede tener créditos antes de que la persona naciera,
// ni de intérprete o técnico años después de su muerte, ni dos carreras
// separadas por ≥20 años sin un proyecto ni colegas en común. Lo último es
// la firma de dos homónimos fusionados (el Valerio de Niuno Niotro, 2010, y el
// ingeniero de Los Melódicos, 1978).
//
// Puro, sin base de datos: lo usan el detector de Curaduría
// («trayectoria_imposible») y el veto de fusiones (src/merge/era-guard.ts).
//
// Qué NO cuenta para fechar a la persona:
//   · compositor y letrista: una canción vieja se versiona décadas después;
//   · roles de reedición (remasterización, notas, compilación): el disco
//     guarda el año original y el crédito es de la reedición;
//   · recopilatorios y Various Artists: reúnen grabaciones de otras épocas.
// Después de la muerte solo cuentan los roles técnicos (producir, grabar,
// mezclar, masterizar) y las membresías: una voz, un instrumento o una obra
// visual sí se publican tarde (grabaciones de archivo, duetos póstumos,
// reediciones: Sadel, Pirela, Sojo o Lauro en el catálogo), y ningún muerto
// mezcla un disco (el James Brown de Caramelos de Cianuro era otro).

export const ERA_GAP_YEARS = 20;
export const MIN_ACTIVE_AGE = 12;
export const POSTHUMOUS_GRACE_YEARS = 3;
export const VARIOUS_ARTISTS_ID = 257;

const TIMELESS = new Set(["composer", "writer"]);
const TECHNICAL = new Set(["producer", "recording", "mixing", "mastering"]);
const PERFORMER = new Set(["musician", "guest", "member"]);
const VISUAL = new Set(["artwork", "photography"]);
const REISSUE_ROLE = /remaster|re-?issue|reedici|liner|compil|recopil|restaur|transfer|\bnotas?\b|\bnotes\b|supervis/iu;

export interface TimelineEvent {
  year: number;
  source: "album" | "track" | "member";
  /** id del crédito o de la membresía. */
  refId: number;
  creditType: string;
  role: string;
  artistId: number;
  albumId: number | null;
  albumType: string | null;
}

export interface PersonTimeline {
  personId: number;
  birthYear: number | null;
  deathYear: number | null;
  events: TimelineEvent[];
  /** Artistas de los que es integrante: sus discos después de morir son póstumos. */
  ownArtists: ReadonlySet<number>;
}

export type RoleFamily = "técnico" | "intérprete" | "autor" | "visual" | "otro";

export function roleFamily(event: Pick<TimelineEvent, "creditType">): RoleFamily {
  if (TECHNICAL.has(event.creditType)) return "técnico";
  if (PERFORMER.has(event.creditType)) return "intérprete";
  if (TIMELESS.has(event.creditType)) return "autor";
  if (VISUAL.has(event.creditType)) return "visual";
  return "otro";
}

export function isReissueRole(event: Pick<TimelineEvent, "role">): boolean {
  return REISSUE_ROLE.test(event.role);
}

/** El crédito fecha a la persona: estaba activa ese año. */
export function isDated(event: TimelineEvent): boolean {
  return !TIMELESS.has(event.creditType) && !isReissueRole(event)
    && event.artistId !== VARIOUS_ARTISTS_ID && event.albumType !== "compilation";
}

export type LifeIssueKind = "antes_de_nacer" | "menor_de_edad" | "despues_de_morir";

export interface LifeIssue {
  kind: LifeIssueKind;
  events: TimelineEvent[];
  detail: string;
}

function yearsOf(events: readonly TimelineEvent[]): string {
  const years = [...new Set(events.map((event) => event.year))].sort((a, b) => a - b);
  return years.length > 4 ? `${years.slice(0, 4).join(", ")}…` : years.join(", ");
}

/** Créditos que la vida de la persona (nacimiento y muerte) hace imposibles. */
export function lifeIssues(timeline: PersonTimeline): LifeIssue[] {
  const out: LifeIssue[] = [];
  const { birthYear: birth, deathYear: death } = timeline;
  if (birth !== null) {
    // Antes de nacer nada vale, ni siquiera una composición: solo la reedición.
    const before = timeline.events.filter((event) => event.year < birth && !isReissueRole(event));
    if (before.length) out.push({ kind: "antes_de_nacer", events: before, detail: `nació en ${birth} y tiene créditos de ${yearsOf(before)}` });
    const young = timeline.events.filter((event) => event.year >= birth && event.year < birth + MIN_ACTIVE_AGE
      && isDated(event) && roleFamily(event) !== "autor");
    if (young.length) out.push({ kind: "menor_de_edad", events: young, detail: `nació en ${birth} y figura activo en ${yearsOf(young)} (menos de ${MIN_ACTIVE_AGE} años)` });
  }
  if (death !== null) {
    const late = timeline.events.filter((event) => {
      if (event.source === "member") return event.year > death + 1;
      if (event.year <= death + POSTHUMOUS_GRACE_YEARS || !isDated(event)) return false;
      return roleFamily(event) === "técnico" && !timeline.ownArtists.has(event.artistId);
    });
    if (late.length) out.push({ kind: "despues_de_morir", events: late, detail: `murió en ${death} y figura activo en ${yearsOf(late)}` });
  }
  return out;
}

export interface EraSide {
  from: number;
  to: number;
  artistIds: number[];
  families: RoleFamily[];
  events: TimelineEvent[];
}

export interface EraSplit {
  gap: number;
  before: EraSide;
  after: EraSide;
  sharedArtists: number;
  sharedColleagues: number;
}

function side(events: TimelineEvent[]): EraSide {
  const years = events.map((event) => event.year);
  return {
    from: Math.min(...years), to: Math.max(...years),
    artistIds: [...new Set(events.map((event) => event.artistId))],
    families: [...new Set(events.map(roleFamily))].sort(),
    events,
  };
}

/**
 * Corta la trayectoria en su hueco más largo. Devuelve el corte solo si mide
 * ≥ ERA_GAP_YEARS y los dos lados no comparten artista ni ≥2 colegas: con un
 * proyecto o colegas en común es una reedición o un regreso, no un homónimo.
 * `colleagues` da las otras personas acreditadas en esos discos.
 */
export function eraSplit(timeline: PersonTimeline, colleagues: (albumIds: number[]) => Set<number>): EraSplit | null {
  const dated = timeline.events.filter(isDated);
  const years = [...new Set(dated.map((event) => event.year))].sort((a, b) => a - b);
  if (years.length < 2) return null;
  let gap = 0; let cut = 0;
  for (let index = 0; index + 1 < years.length; index += 1) {
    const width = years[index + 1]! - years[index]!;
    if (width > gap) { gap = width; cut = years[index]!; }
  }
  if (gap < ERA_GAP_YEARS) return null;
  const before = side(dated.filter((event) => event.year <= cut));
  const after = side(dated.filter((event) => event.year > cut));
  const sharedArtists = before.artistIds.filter((id) => after.artistIds.includes(id)).length;
  const albumsOf = (s: EraSide) => [...new Set(s.events.map((event) => event.albumId).filter((id): id is number => id !== null))];
  const colleaguesBefore = colleagues(albumsOf(before));
  const colleaguesAfter = colleagues(albumsOf(after));
  colleaguesBefore.delete(timeline.personId); colleaguesAfter.delete(timeline.personId);
  const sharedColleagues = [...colleaguesBefore].filter((id) => colleaguesAfter.has(id)).length;
  if (sharedArtists > 0 || sharedColleagues >= 2) return null;
  return { gap, before, after, sharedArtists, sharedColleagues };
}

export interface MergeLink {
  sharedArtists: number;
  sharedAlbums: number;
  sharedColleagues: number;
}

/**
 * ¿Pueden ser la misma persona? Devuelve el motivo para NO fusionar sin una
 * persona que lo confirme, o null. Cada ficha por separado puede tener ya sus
 * propios problemas: aquí solo cuenta lo que la fusión crearía.
 */
export function mergeEraConflict(a: PersonTimeline, b: PersonTimeline, link: MergeLink): string | null {
  const own = new Set([...a.ownArtists, ...b.ownArtists]);
  for (const [life, other] of [[a, b], [b, a]] as const) {
    if (life.birthYear === null && life.deathYear === null) continue;
    const merged: PersonTimeline = { ...life, events: other.events, ownArtists: own };
    const issue = lifeIssues(merged).find((item) => item.kind !== "menor_de_edad");
    if (issue) return `${issue.detail.replace(/ y (tiene|figura)/u, "; la otra ficha $1")}`;
  }
  const yearsA = a.events.filter(isDated).map((event) => event.year);
  const yearsB = b.events.filter(isDated).map((event) => event.year);
  if (!yearsA.length || !yearsB.length) return null;
  const gap = Math.max(Math.min(...yearsB) - Math.max(...yearsA), Math.min(...yearsA) - Math.max(...yearsB));
  if (gap >= ERA_GAP_YEARS && link.sharedArtists === 0 && link.sharedAlbums === 0 && link.sharedColleagues < 2) {
    const range = (years: number[]) => `${Math.min(...years)}–${Math.max(...years)}`;
    return `épocas separadas por ${gap} años (${range(yearsA)} / ${range(yearsB)}) sin proyecto ni colegas en común`;
  }
  return null;
}
