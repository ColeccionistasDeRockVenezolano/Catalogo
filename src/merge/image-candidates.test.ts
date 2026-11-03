import { describe, expect, it } from "vitest";
import { isPlaceholderImageSha256, isPlaceholderImageUrl } from "./image-candidates.js";

describe("marcadores de «sin foto»", () => {
  it("reconoce el marcador de RHV en cualquiera de sus sitios", () => {
    expect(isPlaceholderImageUrl("https://rockhechovenezuela.com/a/wp-content/uploads/sites/2/2022/01/RHV-banda_sinfoto.jpg")).toBe(true);
    expect(isPlaceholderImageUrl("https://rockhechovenezuela.com/k/wp-content/uploads/sites/18/2022/01/RHV-banda_sinfoto.jpg?x=1")).toBe(true);
    expect(isPlaceholderImageUrl("https://rockhechovenezuela.com/g/wp-content/uploads/sites/13/2022/01/RHV-banda_sinfoto-768x383.jpg")).toBe(true);
  });
  it("reconoce la copia local por su hash", () => {
    expect(isPlaceholderImageUrl("https://cdn-images.dzcdn.net/images/artist//1000x1000-000000-80-0-0.jpg")).toBe(true);
    expect(isPlaceholderImageUrl("/crv/media/curated/3f6cda9d663034075039e4be52b8a6559cb7799ad865bf397cdd2b0792cd716e.jpg")).toBe(true);
    expect(isPlaceholderImageSha256("3F6CDA9D663034075039E4BE52B8A6559CB7799AD865BF397CDD2B0792CD716E")).toBe(true);
  });
  it("no toca una foto real de la misma fuente", () => {
    expect(isPlaceholderImageUrl("https://rockhechovenezuela.com/a/wp-content/uploads/sites/2/2022/01/Almendra.jpg")).toBe(false);
    expect(isPlaceholderImageSha256("0".repeat(64))).toBe(false);
  });
});
