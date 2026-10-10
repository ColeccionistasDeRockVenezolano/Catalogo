import { describe, expect, it } from "vitest";
import {
  chooseArtist,
  validateSoloEvidence,
  type SoloIdentity,
} from "../../src/curation/ai/person-artist.js";
import type { ArtistIdentityCandidate } from "../../src/curation/ai/person-artist-types.js";
import type { CatalogEvidence } from "../../src/curation/ai/types.js";
const identity: SoloIdentity = {
  isSolo: true,
  stageName: "Jeremías",
  role: "cantautor",
  explanation: "Identidad documentada",
  conflicts: [],
  evidence: [],
};
const evidence: CatalogEvidence = {
  id: "E1",
  url: "https://fuente.example/jeremias",
  quote:
    "Carlos Eduardo López Ávila, conocido por su nombre artístico Jeremías, es un cantautor venezolano.",
  origin: "page",
  fetchedAt: "",
  contentHash: "fixture",
  label: "Jeremías",
};
const artist: ArtistIdentityCandidate = {
  id: 1,
  name: "Jeremias",
  artistType: "solo_artist",
  biography: null,
  originCountry: "Venezuela",
  aliases: [],
  members: [],
};
describe("identidad automática de persona y solista", () => {
  it("relaciona el rol con una identidad documentada en la misma página", () => {
    const nameQuote = {
      ...evidence,
      quote:
        "Carlos Eduardo López Ávila, nombre real de Jeremías, publicó sus canciones.",
    };
    const roleQuote = {
      ...evidence,
      id: "E2",
      quote: "El cantautor fue claro al hablar de su trayectoria.",
    };
    expect(
      validateSoloEvidence(["Carlos Eduardo López Ávila"], identity, [
        nameQuote,
        roleQuote,
      ]),
    ).toEqual([]);
    expect(
      validateSoloEvidence(["Carlos Eduardo López Ávila"], identity, [
        nameQuote,
        { ...roleQuote, url: "https://otra.example/musico" },
      ]),
    ).toHaveLength(1);
  });
  it("requiere una cita que una explícitamente ambos nombres y respalde el rol", () => {
    expect(
      validateSoloEvidence(["Carlos Eduardo López Ávila"], identity, [
        evidence,
      ]),
    ).toEqual([]);
    expect(
      validateSoloEvidence(["Carlos Eduardo López Ávila"], identity, [
        {
          ...evidence,
          quote:
            "Carlos Eduardo López Ávila es venezolano. Jeremías es cantautor.",
        },
      ]),
    ).toHaveLength(1);
    expect(
      validateSoloEvidence(["Otra persona"], identity, [evidence]),
    ).toHaveLength(1);
  });
  it("los snippets no autorizan la creación aunque contengan los nombres", () => {
    expect(
      validateSoloEvidence(["Carlos Eduardo López Ávila"], identity, [
        { ...evidence, origin: "search_snippet" },
      ]),
    ).toHaveLength(2);
  });
  it("no inventa el rol a partir de un nombre artístico", () => {
    expect(
      validateSoloEvidence(
        ["Carlos Eduardo López Ávila"],
        { ...identity, role: "guitarrista" },
        [evidence],
      ),
    ).toHaveLength(1);
  });
  it("recupera un solista con alias exacto sin confundir tildes", () => {
    expect(chooseArtist(identity, [artist], 4).conflicts).toEqual([]);
    expect(
      chooseArtist(
        identity,
        [{ ...artist, name: "Carlos López", aliases: ["Jeremías"] }],
        4,
      ).conflicts,
    ).toEqual([]);
  });
  it("bloquea bandas, otras personas, candidatos múltiples y coincidencias aproximadas", () => {
    expect(
      chooseArtist(identity, [{ ...artist, artistType: "band" }], 4).conflicts,
    ).toHaveLength(1);
    expect(
      chooseArtist(
        identity,
        [
          {
            ...artist,
            members: [{ personId: 5, name: "Homónimo", realName: null }],
          },
        ],
        4,
      ).conflicts,
    ).toHaveLength(1);
    expect(
      chooseArtist(identity, [artist, { ...artist, id: 2 }], 4).conflicts,
    ).toHaveLength(1);
    expect(
      chooseArtist(identity, [{ ...artist, name: "Jeremías López" }], 4)
        .conflicts,
    ).toHaveLength(1);
  });
  it("un vínculo previo con la misma persona permite retomar la investigación", () => {
    expect(
      chooseArtist(
        identity,
        [
          {
            ...artist,
            members: [{ personId: 4, name: "Carlos", realName: null }],
          },
        ],
        4,
      ).conflicts,
    ).toEqual([]);
  });
});
