// CRV · Alta de videos del canal: lectura del video y política de altas seguras.
import { describe, expect, it } from "vitest";
import { artistCandidates, intakeInstruction, isSafeOperation, parseIntake } from "../../src/youtube/intake.js";
import type { CatalogOperation } from "../../src/curation/ai/types.js";

const DESCRIPCION = `Tracklist:
01 - Cristo 00:00
02 - Firmes Hasta El Final 04:34
03 - Furia De Una Victima 10:46

Musicians
Lead Vocals: Jolfre Brito
Bass: Gregorys Davalillo
`;

describe("parseIntake", () => {
  it("lee artista, disco, año y pistas de un disco completo", () => {
    const parsed = parseIntake({ title: "Revoltas - Transformación Total (2016) || Full Album ||", description: DESCRIPCION });
    expect(parsed).not.toBeNull();
    expect(parsed!.artist).toBe("Revoltas");
    expect(parsed!.album).toBe("Transformación Total");
    expect(parsed!.year).toBe(2016);
    expect(parsed!.trackCount).toBe(3);
    expect(parsed!.tracklist[0]).toEqual({ title: "Cristo", startSeconds: 0 });
    expect(parsed!.credits.length).toBeGreaterThan(0);
  });

  it("no inventa un disco a partir de un videoclip o un concierto", () => {
    expect(parseIntake({ title: "Claroscuro - Mantarraya (Official 4K Video)", description: null })).toBeNull();
    expect(parseIntake({ title: "Salpachino - Live Sessions at @MetroTacubaya (2010) || Full Concert ||", description: null })).toBeNull();
  });

  it("devuelve null si el título no trae artista", () => {
    expect(parseIntake({ title: "Cortometraje reseña sobre el canal", description: null })).toBeNull();
  });
});

describe("artistCandidates", () => {
  const directory = new Map([
    ["revoltas", [{ id: 8922, name: "Revoltas" }]],
    ["sentimientomuerto", [{ id: 220, name: "Sentimiento Muerto" }]],
  ]);

  it("encuentra primero la coincidencia exacta sin tildes ni artículos", () => {
    expect(artistCandidates("REVOLTAS", directory)).toEqual([{ id: 8922, name: "Revoltas" }]);
    expect(artistCandidates("Revoltas ", directory)[0]?.id).toBe(8922);
  });

  it("no devuelve cualquier artista cuando el nombre no se parece", () => {
    expect(artistCandidates("Pocz & Pacheko", directory)).toEqual([]);
  });
});

describe("intakeInstruction", () => {
  it("nombra el video y pide no inventar", () => {
    const parsed = parseIntake({ title: "Revoltas - Transformación Total (2016) || Full Album ||", description: DESCRIPCION })!;
    const instruction = intakeInstruction({
      id: 1, videoId: "Di3YDDyQraY", title: "Revoltas - Transformación Total (2016) || Full Album ||",
      description: DESCRIPCION, durationSeconds: null, publishedAt: null, thumbnailUrl: null, publicationStatus: "published",
    }, parsed);
    expect(instruction).toContain("yt:intake:v1");
    expect(instruction).toContain("https://www.youtube.com/watch?v=Di3YDDyQraY");
    expect(instruction).toContain("unresolved");
    expect(instruction).toContain("Transformación Total");
  });
});

describe("isSafeOperation", () => {
  const base = { key: "k", label: "x", reason: "y", evidenceIds: ["YT1"], enabled: true };
  const operation = (extra: Record<string, unknown>) => ({ ...base, ...extra }) as unknown as CatalogOperation;

  it("acepta altas y datos sin destruir nada", () => {
    expect(isSafeOperation(operation({ op: "create_album" }))).toBe(true);
    expect(isSafeOperation(operation({ op: "create_entity", kind: "artist", values: { name: "X" } }))).toBe(true);
    expect(isSafeOperation(operation({ op: "assign_genre", genreSlug: "rock", role: "primary" }))).toBe(true);
    expect(isSafeOperation(operation({ op: "add_social_link", platform: "instagram" }))).toBe(true);
    expect(isSafeOperation(operation({ op: "replace_fields", target: { kind: "artist", id: 1 }, values: { biography: "Texto" } }))).toBe(true);
  });

  it("deja para una persona fusiones, retiradas y renombres", () => {
    expect(isSafeOperation(operation({ op: "merge_entities" }))).toBe(false);
    expect(isSafeOperation(operation({ op: "remove_entity" }))).toBe(false);
    expect(isSafeOperation(operation({ op: "remove_relation" }))).toBe(false);
    expect(isSafeOperation(operation({ op: "replace_fields", target: { kind: "artist", id: 1 }, values: { name: "Otro" } }))).toBe(false);
  });
});
