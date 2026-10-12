import { describe, expect, it } from "vitest";
import { parseCreditStatement, parseRoleColonStatement, parseVenueContinuation } from "../../src/discography/credit-statements.js";
import { instrumentsOf } from "../../src/discography/instruments.js";
import { isCompositeLabel, splitCompositeLabel } from "../../src/discography/labels.js";
import { placeAliasKey, resolvePlace } from "../../src/discography/places.js";
import { seriesLine, seriesTitleOf, volumeOf } from "../../src/discography/series.js";
import { versionFormatOf, versionHasOwnPage } from "../../src/discography/versions.js";

const spans = (line: string, parse = parseCreditStatement) => {
  const parsed = parse(line)!;
  const chars = Array.from(parsed.text);
  return parsed.parts.map((part) => `${part.type}:${chars.slice(part.start, part.end).join("")}`);
};

describe("créditos en frase (plan del primo, punto 8)", () => {
  it("marca rol, persona, estudio, año y lugar sin trocear la línea", () => {
    expect(spans("Mixed & Mastered by José Morales at Casita, 2026 (Chicago, IL)"))
      .toEqual(["role:Mixed & Mastered", "person:José Morales", "organization:Casita", "year:2026", "place:Chicago, IL"]);
  });

  it("deja fuera el conector final de una línea cortada", () => {
    expect(spans("Recorded by James A. Labinski at A&M Studios (Hollywood, California) &"))
      .toEqual(["role:Recorded", "person:James A. Labinski", "organization:A&M Studios", "place:Hollywood, California"]);
  });

  it("lleva el alcance de pistas", () => {
    const parsed = parseCreditStatement("Track 04 Recorded, Mixed & Mastered by Claudio Ramírez, 2013 at AudioLab (Caracas, Venezuela)")!;
    expect(parsed.trackNumbers).toEqual([4]);
    expect(parsed.parts[0]).toMatchObject({ type: "tracks", text: "Track 04" });
  });

  it("lee «Rol: Nombre» con estudio, año y lugar", () => {
    expect(spans("Mastering Engineer: José Blanco at Master House Studio (Miami, FL)", parseRoleColonStatement))
      .toEqual(["role:Mastering Engineer", "person:José Blanco", "organization:Master House Studio", "place:Miami, FL"]);
    expect(spans("Reassembly & Upscaling: Jose I Morales, 2025 (Chicago, IL)", parseRoleColonStatement))
      .toEqual(["role:Reassembly & Upscaling", "person:Jose I Morales", "year:2025", "place:Chicago, IL"]);
  });

  it("no toma correos, webs ni «their respective artists» por nombres o lugares", () => {
    expect(spans("Ilustration: SENK (https://www.flickr.com/people/senkcms/)", parseRoleColonStatement)).toEqual(["role:Ilustration", "person:SENK"]);
    expect(spans("All lyrics by their respective artists")).toEqual(["role:All lyrics"]);
  });

  it("lee la segunda línea de un estudio cortado con «&»", () => {
    expect(spans("El Charquito y El Piel Estudios (Buenos Aires, Argentina)", parseVenueContinuation))
      .toEqual(["organization:El Charquito y El Piel Estudios", "place:Buenos Aires, Argentina"]);
  });
});

describe("lugares", () => {
  it("unifica las variantes de escritura", () => {
    expect(resolvePlace("Hollywood, CA")?.name).toBe("Hollywood, California");
    expect(resolvePlace("Hollywood, California")?.name).toBe("Hollywood, California");
    expect(resolvePlace("Caracas. Venezuela")?.name).toBe("Caracas, Venezuela");
    expect(placeAliasKey("Hollywood, CA")).not.toBe(placeAliasKey("Hollywood, California"));
  });

  it("manda a revisión lo dudoso y descarta lo que no es lugar", () => {
    expect(resolvePlace("Milan, Spain")?.doubt).toMatch(/Italia/u);
    expect(resolvePlace("Puerto Fijo, Venezuela")).toMatchObject({ name: "Punto Fijo, Venezuela" });
    expect(resolvePlace("1989")).toBeNull();
  });
});

describe("instrumentos", () => {
  it("normaliza el rol libre a la lista fija", () => {
    expect(instrumentsOf("Voz y guitarra")).toEqual(expect.arrayContaining(["vocals", "guitar"]));
    expect(instrumentsOf("Guitars (lead)")).toEqual(["lead_guitar"]);
    expect(instrumentsOf("integrante")).toEqual([]);
  });
});

describe("sellos compuestos", () => {
  it("parte el sello y sus socios", () => {
    expect(isCompositeLabel("Sony/BMG")).toBe(false);
    const parts = splitCompositeLabel("Fania / Palacio")!;
    expect(parts.parts.map((part) => [part.name, part.role])).toEqual([["Fania", "label"], ["Palacio", "licensee"]]);
  });
});

describe("series y versiones", () => {
  it("lee el volumen y arma la línea de serie", () => {
    expect(volumeOf("Antología Vol. IV")).toEqual({ number: 4, label: "Vol. IV" });
    expect(volumeOf("Rock contra la dictadura. Venezuela, volumen 02")).toEqual({ number: 2, label: "Vol. 2" });
    expect(seriesTitleOf("Grandes Éxitos, Vol. 2", [])).toBe("Grandes Éxitos");
    expect(seriesLine("Venezuela Electrónica", "Vol. 1")).toBe("Venezuela Electrónica – Vol. 1");
  });

  it("describe la versión y decide si tiene página propia", () => {
    expect(versionFormatOf("Flor De Fuego (CD/DVD)", null)).toMatchObject({ format: "CD + DVD", title: "Edición en CD + DVD" });
    expect(versionFormatOf("Atabal Yémal (CD Reissue)", null)).toMatchObject({ format: "CD", title: "Reedición en CD" });
    expect(versionHasOwnPage({ distinctTracks: false, coverUrl: null, publicNotes: null })).toBe(false);
    expect(versionHasOwnPage({ distinctTracks: true, coverUrl: null, publicNotes: null })).toBe(true);
  });
});
