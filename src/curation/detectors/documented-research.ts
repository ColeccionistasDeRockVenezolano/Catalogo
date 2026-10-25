// Investigación editorial revisada: permanece en la misma cola que los
// detectores. Nunca ejecuta su recomendación ni convierte una coincidencia
// de repertorio en una orden de fusionar.
import { createHash } from "node:crypto";
import albumTracklists from "../research/album-tracklists-2026-10-15.json" with { type: "json" };
import type { Finding, SnapshotAlbum, SnapshotTrack } from "../types.js";
import type { Detector } from "./shared.js";

export function researchAlbumHash(album: SnapshotAlbum, tracks: readonly SnapshotTrack[]): string {
  const list = tracks.map((track) => [track.disc, track.number, track.title, track.durationSeconds] as const)
    .sort((a, b) => a[0] - b[0] || a[1] - b[1] || (a[2] < b[2] ? -1 : a[2] > b[2] ? 1 : 0));
  return createHash("sha256").update(JSON.stringify([album.title, album.releaseYear, album.albumType, list])).digest("hex");
}

export const documentedResearch: Detector = {
  key: "investigacion_documentada",
  category: "investigacion_documentada",
  label: "Discos con repertorio coincidente",
  description: "Casos investigados individualmente: conclusión, fuentes y recomendación editorial pendientes de decisión.",
  run(context) {
    const out: Finding[] = [];
    const hashes = new Map<number, string>();
    for (const item of albumTracklists.cases) {
      const [first, second] = item.albums;
      if (!first || !second) continue;
      const a = context.albums.get(first.id);
      const b = context.albums.get(second.id);
      // La investigación pertenece a este catálogo y a estas identidades;
      // los mismos ids en otra base o en fixtures no heredan sus conclusiones.
      if (!a || !b || a.artistId !== first.artistId || b.artistId !== second.artistId
        || context.artists.get(a.artistId)?.name !== first.artist
        || context.artists.get(b.artistId)?.name !== second.artist) continue;
      const pair: [number, number] = [Math.min(a.id, b.id), Math.max(a.id, b.id)];
      if (context.snapshot.distinctPairs.has(`album:${pair[0]}-${pair[1]}`)) continue;
      const changed = item.albums.filter((baseline) => {
        let hash = hashes.get(baseline.id);
        if (!hash) {
          hash = researchAlbumHash(context.albums.get(baseline.id)!, context.tracksByAlbum.get(baseline.id) ?? []);
          hashes.set(baseline.id, hash);
        }
        return hash !== baseline.stateHash;
      }).map((album) => album.id);
      const needsRepair = ["corregir_pistas_no_fusionar", "fuentes_mezcladas"].includes(item.verdict);
      out.push({
        detector: this.key, category: this.category,
        signature: item.verdict, signatureLabel: item.label,
        severity: needsRepair ? "high" : item.verdict === "consolidar" ? "medium" : "low",
        entity: { kind: "album", id: a.id, label: `${first.artist} — ${a.title}` },
        field: "tracklist", title: `${a.title} ↔ ${b.title}`,
        suggestion: item.recommendation, pair,
        related: [{ kind: "album", id: b.id, label: b.title }, { kind: "artist", id: a.artistId, label: first.artist }],
        evidence: {
          signatureLabel: item.label,
          research: {
            dossier: albumTracklists.id, caseId: item.id, researchedAt: albumTracklists.researchedAt,
            verdict: item.verdict, label: item.label, finding: item.finding,
            recommendation: item.recommendation, suggestedKeep: item.suggestedKeep,
            albums: item.albums, sources: item.sources,
            changedAlbumIds: changed, mergePreview: item.mergePreview,
          },
        },
      });
    }
    return out;
  },
};
