import { describe, expect, it } from "vitest";
import { albumTitleCharacteristics, albumTitleEdition } from "../../src/normalization/album-characteristics.js";

describe("características y ediciones indicadas en títulos", () => {
  it.each([
    ["Acústico", ["Acústico"]], ["Rarezas Acústicas Vol.1", ["Acústico"]],
    ["Lost // Found (Acoustic Demo)", ["Acústico"]], ["Desenchufado", ["Acústico"]],
    ["Children Of Tomorrow (Pythius Remix) (Instrumental)", ["Instrumental", "Remix"]],
    ["Con Cariño Remezclas", ["Remix"]], ["Instrumentales", ["Instrumental"]],
    ["Normal", []], ["Remastered", []],
  ])("%s conserva dimensiones independientes", (title, expected) => {
    expect(albumTitleCharacteristics(title)).toEqual(expected);
  });
  it("extrae la edición sin inventar año ni contraparte original", () => {
    expect(albumTitleEdition("Respira (Deluxe)")).toEqual({ title: "Deluxe", types: ["deluxe"] });
    expect(albumTitleEdition("Álbum (Deluxe Remastered Edition)")).toEqual({ title: "Deluxe Remastered Edition", types: ["deluxe", "remastered"] });
    expect(albumTitleEdition("Álbum (CD Reissue)")).toEqual({ title: "CD Reissue", types: ["reissue"] });
    expect(albumTitleEdition("Edición Limitada")).toEqual({ title: "Edición Limitada", types: ["limited_edition"] });
    expect(albumTitleEdition("Álbum (USA Edition)")).toEqual({ title: "USA Edition", types: ["other_edition"] });
    expect(albumTitleEdition("Feliz Aniversario")).toBeNull();
    expect(albumTitleEdition("Tema (Bonus Track)")).toBeNull();
  });
});
