import { describe, expect, it } from "vitest";
import { detectEmotionIntent, normalizeQuery } from "../../src/api/repositories/emotions.js";

// «música para tener sexo» no es un nombre: la búsqueda detecta la emoción
// pedida y devuelve artistas del catálogo que la expresan (tags y opiniones).
describe("intención emocional de la búsqueda", () => {
  it("reconoce el pedido de música sexual, con acentos y mayúsculas", () => {
    expect(detectEmotionIntent("musica para tener sexo")).toBe("cachonda");
    expect(detectEmotionIntent("MÚSICA PARA COGER")).toBe("cachonda");
    expect(detectEmotionIntent("algo para ponerme hot")).toBe("cachonda");
    expect(detectEmotionIntent("temas eróticos")).toBe("cachonda");
    expect(detectEmotionIntent("hacer el amor")).toBe("cachonda");
  });

  it("reconoce tristeza, enfoque, libertad, energía y amor", () => {
    expect(detectEmotionIntent("canciones tristes")).toBe("tristeza");
    expect(detectEmotionIntent("música para llorar")).toBe("tristeza");
    expect(detectEmotionIntent("melancolía")).toBe("tristeza");
    expect(detectEmotionIntent("para estudiar")).toBe("enfocado");
    expect(detectEmotionIntent("ponerme a trabajar")).toBe("enfocado");
    expect(detectEmotionIntent("para dormir")).toBe("enfocado");
    expect(detectEmotionIntent("rock rebelde")).toBe("libertad");
    expect(detectEmotionIntent("música para la fiesta")).toBe("aumenta_mi_aura");
    expect(detectEmotionIntent("algo épico")).toBe("aumenta_mi_aura");
    expect(detectEmotionIntent("baladas de amor")).toBe("emocion");
    expect(detectEmotionIntent("algo romántico")).toBe("emocion");
  });

  it("no inventa emoción en búsquedas de nombres", () => {
    expect(detectEmotionIntent("led zeppelin")).toBeNull();
    expect(detectEmotionIntent("Caramelos de Cianuro")).toBeNull();
    expect(detectEmotionIntent("rock venezolano")).toBeNull();
    expect(detectEmotionIntent("")).toBeNull();
    // Palabra completa: «sexologia» no es el pedido «sexo».
    expect(detectEmotionIntent("sexologia")).toBeNull();
  });

  it("normaliza para comparar sin acentos ni signos", () => {
    expect(normalizeQuery("Música  ¡para TENEr sexo!")).toBe("musica para tener sexo");
  });
});
