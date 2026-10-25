import { describe, expect, it } from "vitest";
import { mediaImage, mediaUrl } from "../../src/lib/media";

describe("copias optimizadas de las imágenes del catálogo", () => {
  it("pide la copia del ancho indicado solo a las imágenes locales", () => {
    expect(mediaUrl("/crv/media/album/12.jpg", 320)).toBe("/crv/media/album/12.jpg?w=320");
    expect(mediaUrl("https://i.ytimg.com/vi/x/hqdefault.jpg", 320)).toBe("https://i.ytimg.com/vi/x/hqdefault.jpg");
    expect(mediaUrl("/crv/media/album/12.jpg?w=640", 320)).toBe("/crv/media/album/12.jpg?w=640");
  });

  it("elige la copia justa y la del doble para pantallas densas", () => {
    expect(mediaImage("/crv/media/artist/7.png", 240)).toEqual({
      src: "/crv/media/artist/7.png?w=320",
      srcSet: "/crv/media/artist/7.png?w=320 1x, /crv/media/artist/7.png?w=640 2x",
    });
    expect(mediaImage("/crv/media/person/3.jpg", 42)).toEqual({ src: "/crv/media/person/3.jpg?w=160" });
    expect(mediaImage("/crv/media/album/1.jpg", 900)).toEqual({ src: "/crv/media/album/1.jpg?w=1200" });
    expect(mediaImage("https://example.org/a.jpg", 240)).toEqual({ src: "https://example.org/a.jpg" });
  });
});
