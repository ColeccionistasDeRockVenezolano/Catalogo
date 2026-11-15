import { describe, expect, it } from "vitest";
import { emotionFallbackMode, FALLBACK_BASES } from "../../src/api/repositories/emotions.js";

describe("emoción de respaldo por capas", () => {
  it("está apagada salvo que se pida shadow u on", () => {
    expect(emotionFallbackMode({})).toBe("off");
    expect(emotionFallbackMode({ CRV_EMOTION_FALLBACK: "yes" })).toBe("off");
    expect(emotionFallbackMode({ CRV_EMOTION_FALLBACK: "shadow" })).toBe("shadow");
    expect(emotionFallbackMode({ CRV_EMOTION_FALLBACK: "on" })).toBe("on");
  });
  it("ordena las capas de la evidencia propia a lo típico del género", () => {
    expect(FALLBACK_BASES).toEqual(["resenas", "descriptor_rym", "genero", "genero_artista"]);
  });
});
