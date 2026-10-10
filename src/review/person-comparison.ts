import { jaroWinkler } from "../er/string-similarity.js";
import type { PersonFacts } from "./person-candidates.js";

export interface ComparisonCitation {
  url: string; title: string; quote: string; origin: "page" | "search_snippet";
}
export interface ComparedProject {
  name: string; album: string | null; year: number | null; role: string;
  evidence: ComparisonCitation[];
  checks?: { project: boolean; album: boolean; year: boolean; role: boolean };
  coverage?: number;
}
export interface ComparedPerson {
  id: number; name: string; aliases: string[]; birthDate: string | null; deathDate: string | null;
  chronology?: { birthYear: number | null; activeYears: number[]; aliveOnlyYears: number[] };
  projects: ComparedProject[]; evidence: ComparisonCitation[]; missing: string[];
}
export interface ComparisonRow {
  key: string; label: string; a: string[]; b: string[];
  status: "match" | "partial" | "different" | "missing" | "unverified";
  points: number; maximum: number; explanation: string; evidence: ComparisonCitation[];
}
export interface PersonComparison {
  rationale: string;
  conclusion: "same" | "different" | "mixed" | "unknown";
  version: 3; catalogSignature: string; stale: boolean;
  a: ComparedPerson; b: ComparedPerson; rows: ComparisonRow[];
  bridge: ComparisonCitation[]; contradictions: string[];
  documentary: { a: number; b: number; bridge: number };
}

const fold = (value: string) => value.normalize("NFKD").replace(/\p{M}/gu, "").toLocaleLowerCase("es").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const rounded = (value: number) => Math.round(value * 10) / 10;
function overlap(a: readonly number[], b: readonly number[]) {
  const x = new Set(a); const y = new Set(b);
  return x.size && y.size ? 2 * [...x].filter((id) => y.has(id)).length / (x.size + y.size) : 0;
}
export function catalogSignature(a: PersonFacts, b: PersonFacts): string {
  const stable = (person: PersonFacts) => ({ id: person.id, name: person.name, aliases: [...person.aliases].sort(),
    birthDate: person.birthDate, deathDate: person.deathDate, bands: [...new Set(person.bandIds)].sort((x, y) => x - y),
    albums: [...new Set(person.albumIds)].sort((x, y) => x - y), projects: person.projects ?? [] });
  return JSON.stringify([a, b].sort((x, y) => x.id - y.id).map(stable));
}

/** Presupuestos 20/20/60. Los datos ausentes nunca se convierten en coincidencias. */
export function compareCatalog(a: PersonFacts, b: PersonFacts, saved: PersonComparison | null = null): PersonComparison {
  const signature = catalogSignature(a, b);
  const stale = saved !== null && saved.catalogSignature !== signature;
  const left = fold(a.name); const right = fold(b.name);
  const complete = left.split(" ").length >= 2 && right.split(" ").length >= 2;
  const alias = a.aliases.some((name) => fold(name) === right) || b.aliases.some((name) => fold(name) === left);
  const similarity = left && right ? jaroWinkler(left, right) : 0;
  const namePoints = rounded((complete ? 20 : 5) * (alias ? 1 : similarity >= 0.92 ? similarity ** 4 : 0));
  const bandOverlap = overlap(a.bandIds, b.bandIds);
  const projectPoints = rounded(8 * Math.max(bandOverlap, overlap(a.artistIds ?? [], b.artistIds ?? []) * 0.75));
  const albumPoints = rounded(8 * overlap(a.albumIds, b.albumIds));
  const datePoints = (a.birthDate && a.birthDate === b.birthDate ? 2 : 0) + (a.deathDate && a.deathDate === b.deathDate ? 2 : 0);
  const rows: ComparisonRow[] = [
    { key: "names", label: "Nombres y alias", a: [a.name, ...a.aliases], b: [b.name, ...b.aliases],
      status: !left || !right ? "missing" : left === right || alias ? "match" : namePoints ? "partial" : "different",
      points: namePoints, maximum: 20, evidence: [], explanation: complete
        ? "Las variantes del nombre se evalúan una sola vez. La coincidencia no prueba identidad por sí sola."
        : "Un nombre de una sola palabra aporta como máximo 5 puntos; falta una identificación más completa." },
    { key: "projects", label: "Bandas y artistas del catálogo", a: [...new Set((a.projects ?? []).map((p) => p.name))], b: [...new Set((b.projects ?? []).map((p) => p.name))],
      status: !a.artistIds?.length || !b.artistIds?.length ? "missing" : projectPoints ? "partial" : "different",
      points: projectPoints, maximum: 8, evidence: [], explanation: "Puntos proporcionales al solapamiento de bandas; los artistas de discos aportan menos que una membresía compartida." },
    { key: "albums", label: "Discos acreditados", a: [...new Set((a.projects ?? []).flatMap((p) => p.album ? [p.album] : []))], b: [...new Set((b.projects ?? []).flatMap((p) => p.album ? [p.album] : []))],
      status: !a.albumIds.length || !b.albumIds.length ? "missing" : albumPoints ? "partial" : "different",
      points: albumPoints, maximum: 8, evidence: [], explanation: "Puntos proporcionales a los discos comunes respecto a los discos de ambas fichas. Proyectos distintos no prueban personas distintas." },
    { key: "life", label: "Fechas biográficas", a: [a.birthDate ?? "Nacimiento sin dato", a.deathDate ?? "Fallecimiento sin dato"], b: [b.birthDate ?? "Nacimiento sin dato", b.deathDate ?? "Fallecimiento sin dato"],
      status: (a.birthDate && b.birthDate && a.birthDate !== b.birthDate) || (a.deathDate && b.deathDate && a.deathDate !== b.deathDate) ? "different" : datePoints ? "partial" : "missing",
      points: datePoints, maximum: 4, evidence: [], explanation: "Cada fecha aporta 2 puntos solo si existe y coincide en ambas fichas. Los datos ausentes aportan 0." },
  ];
  const side = (person: PersonFacts, old: ComparedPerson | undefined): ComparedPerson => {
    const projects = (person.projects ?? []).map((p) => {
      const evaluated = !stale ? old?.projects.find((x) => x.name === p.name && x.album === p.album && x.year === p.year
        && x.role.split(/,\s*/u).sort().join(",") === p.role.split(/,\s*/u).sort().join(",")) : undefined;
      return { ...p, evidence: evaluated?.evidence ?? [], ...(evaluated?.checks ? { checks: evaluated.checks, coverage: evaluated.coverage ?? 0 } : {}) };
    });
    return { id: person.id, name: person.name, aliases: person.aliases, birthDate: person.birthDate, deathDate: person.deathDate,
      projects, evidence: !stale ? old?.evidence ?? [] : [],
      ...(!stale && old?.chronology ? { chronology: old.chronology } : {}),
      missing: [!person.birthDate ? "Fecha de nacimiento" : "", !person.deathDate ? "Fecha de fallecimiento, si corresponde" : "", !person.projects?.length ? "Trayectoria y créditos" : "",
        ...projects.filter((p) => (p.coverage ?? 0) < 1).map((p) => `Respaldo incompleto: ${p.name}${p.album ? ` · ${p.album}` : ""}`)].filter(Boolean) };
  };
  return { rationale: stale ? "La investigación debe actualizarse porque cambiaron los datos evaluados." : saved?.rationale ?? "Aún no se han contrastado fuentes web de ambas fichas.", conclusion: stale ? "unknown" : saved?.conclusion ?? "unknown", version: 3, catalogSignature: signature, stale, rows, a: side(a, saved?.a.id === a.id ? saved.a : saved?.b),
    b: side(b, saved?.b.id === b.id ? saved.b : saved?.a), bridge: stale ? [] : saved?.bridge ?? [],
    contradictions: [...(stale ? [] : saved?.contradictions ?? []), ...(rows.find((row) => row.key === "life")?.status === "different" ? ["Las fechas biográficas registradas no coinciden entre ambas fichas."] : [])],
    documentary: stale || !saved ? { a: 0, b: 0, bridge: 0 } : saved.a.id === a.id ? saved.documentary
      : { a: saved.documentary.b, b: saved.documentary.a, bridge: saved.documentary.bridge } };
}

export function comparisonRows(comparison: PersonComparison): ComparisonRow[] {
  const documentRow = (person: ComparedPerson, points: number, key: string): ComparisonRow => ({
    key, label: `Evidencia de ${person.name} · ficha #${person.id}`, a: [], b: [],
    status: points >= 20 ? "match" : points > 0 ? "partial" : "unverified", points, maximum: 20,
    evidence: person.evidence, explanation: `${person.projects.filter((p) => p.evidence.length).length} de ${person.projects.length} registros de trayectoria tienen respaldo web. En membresías se verifica proyecto (50 %), año (25 %) y función (25 %); en discos, proyecto (30 %), disco (30 %), año (20 %) y función (20 %). Los resúmenes del buscador aportan una cuarta parte del peso de una página leída.`,
  });
  return [...comparison.rows, documentRow(comparison.a, comparison.documentary.a, "web_a"), documentRow(comparison.b, comparison.documentary.b, "web_b"),
    { key: "bridge", label: "Conexión documental entre ambas fichas", a: [], b: [],
      status: comparison.documentary.bridge ? "match" : "unverified", points: comparison.documentary.bridge, maximum: 20,
      evidence: comparison.bridge, explanation: comparison.bridge.length ? "Una prueba conecta las trayectorias; el respaldo de otro sitio añade corroboración. La misma cita no se cuenta varias veces."
        : "Falta una prueba documental que conecte las dos trayectorias. Tener el mismo nombre no basta." }];
}
