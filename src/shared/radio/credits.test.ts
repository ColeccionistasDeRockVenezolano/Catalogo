import { describe, expect, it } from "vitest";
import { displayArtist, isCompilationArtist, trackCredits, trackDisplay, trackLine, trackTitle } from "./credits.js";

describe("firma de una pista de la radio", () => {
  it("reconoce las marcas de recopilatorio", () => {
    for (const value of ["Various Artists", "various artists", "Varios artistas", "VA", "va", "v.a.", "V. A."]) {
      expect(isCompilationArtist(value), value).toBe(true);
      expect(displayArtist(value), value).toBe("");
    }
  });

  it("conserva el artista real y recorta el aire", () => {
    expect(displayArtist("  Convoy ")).toBe("Convoy");
    expect(displayArtist(null)).toBe("");
    expect(displayArtist(undefined)).toBe("");
    expect(displayArtist("")).toBe("");
    expect(displayArtist("VAnessa")).toBe("VAnessa");
  });

  it("toma el autor del título cuando la fuente dice «Various Artists»", () => {
    const track = { artist: "Various Artists", title: "7 Balazos - Paranoia", album: "Borrachos y Bolingas Vol. 2", year: 2005 };
    expect(trackDisplay(track)).toEqual({ artist: "7 Balazos", title: "Paranoia" });
    expect(trackTitle(track)).toBe("Paranoia");
    expect(trackCredits(track)).toBe("7 Balazos - Borrachos y Bolingas Vol. 2 • 2005");
  });

  it("con artista fiable no parte el título: solo le quita el prefijo si lo repite", () => {
    expect(trackDisplay({ artist: "Convoy", title: "Convoy - Hoy Voy Por Ti" })).toEqual({ artist: "Convoy", title: "Hoy Voy Por Ti" });
    expect(trackDisplay({ artist: "Convoy", title: "Hoy Voy Por Ti" })).toEqual({ artist: "Convoy", title: "Hoy Voy Por Ti" });
    expect(trackCredits({ artist: "Convoy", title: "Hoy Voy Por Ti", album: "Hoy Voy Por Ti", year: 2016 }))
      .toBe("Convoy - Hoy Voy Por Ti • 2016");
  });

  it("sin artista ni guion suelto deja el título entero", () => {
    expect(trackDisplay({ artist: "Various Artists", title: "Paranoia", album: "Vol. 2", year: 2005 }))
      .toEqual({ artist: "", title: "Paranoia" });
    expect(trackCredits({ artist: "Various Artists", title: "Rock-n-Roll", album: "Vol. 2", year: 2005 }))
      .toBe("Vol. 2 • 2005");
    expect(trackCredits(null)).toBe("");
  });

  it("«A continuación» firma artista y nombre de la música", () => {
    expect(trackLine({ artist: "Convoy", title: "Hoy Voy Por Ti" })).toBe("Convoy - Hoy Voy Por Ti");
    expect(trackLine({ artist: "Various Artists", title: "7 Balazos - Paranoia" })).toBe("7 Balazos - Paranoia");
    expect(trackLine({ artist: "Various Artists", title: "Paranoia" })).toBe("Paranoia");
    expect(trackLine(null)).toBe("");
  });
});
