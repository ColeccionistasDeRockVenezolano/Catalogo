// CRV · Detectores de identidad y edición que faltaban en Curaduría (etapa 5).
//
// Complementan a los detectores existentes sin escribir nada:
//  - personas homónimas dentro de un mismo artista (el caso que dejó una fusión);
//  - retratos repetidos entre fichas;
//  - discos del mismo título y año con listas de pistas distintas (edición,
//    reedición o vivo): no se fusionan, se revisan.
import type { Finding, SnapshotMembership } from "../types.js";
import type { AnalysisContext, Detector } from "./shared.js";
import { nameKey } from "../lexicon.js";
import { normalizeEntityName } from "../../normalization/entity-name.js";

const COHERENCE = "datos_incoherentes";
const DUPLICATES = "fichas_repetidas";
const PLACEHOLDER = /(placeholder|sin[-_ ]?foto|default|no[-_ ]?image)/iu;

function pair(a: number, b: number): [number, number] {
  return a <= b ? [a, b] : [b, a];
}

function tracklistSignature(tracks: Array<{ disc: number; number: number; title: string }>): string {
  return tracks
    .slice()
    .sort((left, right) => left.disc - right.disc || left.number - right.number)
    .map((track) => normalizeEntityName(track.title).secondaryKey)
    .join("|");
}

/** Personas con el mismo nombre exacto dentro del mismo artista. */
export const homonymPersons: Detector = {
  key: "personas_homonimas_en_artista",
  category: DUPLICATES,
  label: "Personas homónimas en un artista",
  description: "Dos fichas de persona con el mismo nombre comparten membresía en el mismo artista. Suelen ser la misma persona duplicada por una fusión; verifica rol y período antes de unir.",
  actionability: "actionable",
  actions: { "*": ["fusionar"] },
  run(context: AnalysisContext): Finding[] {
    const byArtist = new Map<number, Map<string, SnapshotMembership[]>>();
    for (const membership of context.snapshot.memberships ?? []) {
      const person = context.persons.get(membership.personId);
      if (!person) continue;
      const key = nameKey(person.name);
      if (!key) continue;
      const groups = byArtist.get(membership.artistId) ?? new Map<string, SnapshotMembership[]>();
      groups.set(key, [...(groups.get(key) ?? []), membership]);
      byArtist.set(membership.artistId, groups);
    }
    const findings: Finding[] = [];
    for (const [artistId, groups] of byArtist) {
      const artist = context.artists.get(artistId);
      if (!artist) continue;
      for (const memberships of groups.values()) {
        const byPerson = new Map<number, SnapshotMembership[]>();
        for (const membership of memberships) byPerson.set(membership.personId, [...(byPerson.get(membership.personId) ?? []), membership]);
        const people = [...byPerson.keys()];
        if (people.length < 2) continue;
        for (let i = 0; i < people.length; i += 1) {
          for (let j = i + 1; j < people.length; j += 1) {
            const left = context.persons.get(people[i]!);
            const right = context.persons.get(people[j]!);
            if (!left || !right) continue;
            const leftMemberships = byPerson.get(left.id) ?? [];
            const rightMemberships = byPerson.get(right.id) ?? [];
            const roles = [...new Set([...leftMemberships, ...rightMemberships].map((item) => item.role).filter(Boolean))];
            findings.push({
              detector: homonymPersons.key, category: DUPLICATES, signature: "mismo_nombre",
              signatureLabel: roles.length > 1 ? "Mismo nombre, roles distintos" : "Mismo nombre en el mismo artista",
              severity: roles.length > 1 ? "low" : "medium",
              entity: { kind: "person", id: left.id, label: left.name },
              field: "name", value: left.name,
              title: `${left.name} aparece dos veces en ${artist.name}`,
              suggestion: "Compara rol y período; si es la misma persona, fusiona. Si no, anota el motivo.",
              related: [{ kind: "person", id: right.id, label: right.name }],
              pair: pair(left.id, right.id),
              evidence: {
                pair: pair(left.id, right.id), artistId, roles,
                left: leftMemberships.map((item) => ({ role: item.role, from: item.fromYear, to: item.toYear })),
                right: rightMemberships.map((item) => ({ role: item.role, from: item.fromYear, to: item.toYear })),
              },
            });
          }
        }
      }
    }
    return findings;
  },
};

/** Mismo retrato (misma URL) en dos fichas de artista. */
export const repeatedPortraits: Detector = {
  key: "retratos_repetidos",
  category: DUPLICATES,
  label: "Retratos repetidos",
  description: "Dos artistas usan exactamente la misma imagen. Puede ser la misma ficha o un proyecto de la misma persona: no se fusiona sin evidencia; se revisa.",
  actionability: "informational",
  run(context: AnalysisContext): Finding[] {
    const byUrl = new Map<string, Array<{ id: number; name: string }>>();
    for (const facts of context.snapshot.artistFacts ?? []) {
      const url = facts.pictureUrl?.trim();
      if (!url || PLACEHOLDER.test(url)) continue;
      byUrl.set(url, [...(byUrl.get(url) ?? []), { id: facts.id, name: facts.name }]);
    }
    const findings: Finding[] = [];
    for (const [url, artists] of byUrl) {
      if (artists.length < 2) continue;
      for (let i = 0; i < artists.length; i += 1) {
        for (let j = i + 1; j < Math.min(artists.length, i + 6); j += 1) {
          const left = artists[i]!;
          const right = artists[j]!;
          findings.push({
            detector: repeatedPortraits.key, category: DUPLICATES, signature: "mismo_retrato",
            signatureLabel: "Mismo retrato", severity: "low",
            entity: { kind: "artist", id: left.id, label: left.name },
            field: "picture_url", value: url,
            title: `${left.name} y ${right.name} usan el mismo retrato`,
            suggestion: "Comprueba si es la misma ficha; si son proyectos distintos, cambia una de las fotos.",
            related: [{ kind: "artist", id: right.id, label: right.name }],
            pair: pair(left.id, right.id),
            evidence: { pair: pair(left.id, right.id), pictureUrl: url, artists: artists.map((item) => item.id) },
          });
        }
      }
    }
    return findings;
  },
};

/** Mismo título y año con listas de pistas distintas: edición, no duplicado. */
export const editionConflicts: Detector = {
  key: "ediciones_en_conflicto",
  category: COHERENCE,
  label: "Ediciones distintas del mismo disco",
  description: "Dos discos del mismo artista con el mismo título y año tienen listas de pistas diferentes. Son ediciones, reediciones o versiones en vivo: no se fusionan; se documentan.",
  actionability: "informational",
  run(context: AnalysisContext): Finding[] {
    const tracksByAlbum = new Map<number, Array<{ disc: number; number: number; title: string }>>();
    for (const track of context.snapshot.tracks) {
      tracksByAlbum.set(track.albumId, [...(tracksByAlbum.get(track.albumId) ?? []), { disc: track.disc, number: track.number, title: track.title }]);
    }
    const byKey = new Map<string, Array<{ id: number; title: string; year: number | null; signature: string }>>();
    for (const album of context.snapshot.albums) {
      const titleKey = normalizeEntityName(album.title).secondaryKey;
      if (!titleKey) continue; // «@@@@@», «^^^^^» y similares quedan fuera.
      const tracks = tracksByAlbum.get(album.id) ?? [];
      if (!tracks.length) continue;
      const key = `${album.artistId}|${titleKey}|${album.releaseYear ?? ""}`;
      byKey.set(key, [...(byKey.get(key) ?? []), { id: album.id, title: album.title, year: album.releaseYear, signature: tracklistSignature(tracks) }]);
    }
    const findings: Finding[] = [];
    for (const albums of byKey.values()) {
      if (albums.length < 2) continue;
      const signatures = new Set(albums.map((album) => album.signature));
      if (signatures.size < 2) continue; // duplicado exacto: lo cubre `discos_repetidos`.
      const [first, ...rest] = albums;
      findings.push({
        detector: editionConflicts.key, category: COHERENCE, signature: "listas_distintas",
        signatureLabel: "Mismo título y año con listas distintas", severity: "low",
        entity: { kind: "album", id: first!.id, label: first!.title },
        field: "title", value: first!.title,
        title: `«${first!.title}» tiene ${albums.length} versiones con listas de pistas distintas`,
        suggestion: "No fusionar: documenta formato, edición o reedición en cada disco.",
        related: rest.map((album) => ({ kind: "album" as const, id: album.id, label: album.title })),
        evidence: { albumIds: albums.map((album) => album.id), tracklistSignatures: [...signatures] },
      });
    }
    return findings;
  },
};
