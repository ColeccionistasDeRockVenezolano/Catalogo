import { describe, expect, it } from "vitest";
import { decadeHref, genreHref } from "../../src/lib/routes";

describe("enlaces de metadatos del catálogo", () => {
  it("manda los años al filtro de décadas del tipo de entidad correcto", () => {
    expect(decadeHref(1976)).toBe("/discos?decada=1970");
    expect(decadeHref(1948)).toBe("/discos?decada=antes-1950");
    expect(decadeHref(1948, "artist")).toBe("/artistas?decada=1940");
    expect(decadeHref(2000, "artist")).toBe("/artistas?decada=2000");
  });
  it("conserva la jerarquía exacta al enlazar familias, géneros y estilos", () => {
    expect(genreHref({ id: 1, slug: "rock", name: "Rock", family: "rock" })).toBe("/discos?genero=rock");
    expect(genreHref({ id: 2, slug: "thrash-metal", name: "Thrash metal", family: "metal" }, "artist")).toBe("/artistas?genero=metal&subgenero=thrash-metal");
    expect(genreHref({ id: 3, slug: "pasaje", name: "Pasaje", family: "musica-venezolana", parentGenre: "joropo" })).toBe("/discos?genero=musica-venezolana&subgenero=joropo&estilo=pasaje");
  });
});
