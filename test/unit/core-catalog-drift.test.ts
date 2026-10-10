import { describe, expect, it } from "vitest";
import { diffCoreCatalog } from "../../src/doctor/core-catalog.js";

// Grafía de la base viva (y de las listas aprobadas): comprobada contra
// postgres:16 al crear `public.social_links`.
const viva =
  "CONSTRAINT social_links.social_links_platform_ck CHECK (((platform)::text = ANY ((ARRAY['instagram'::character varying, 'facebook'::character varying, 'x'::character varying, 'tiktok'::character varying, 'threads'::character varying, 'bluesky'::character varying])::text[])))";

// Grafía de una copia RESTAURADA con pg_dump custom + pg_restore (postgres:16):
// la restricción se recrea desde su texto deparseado y los casts quedan por
// elemento. Es la misma restricción; el doctor no debe reportarla como drift.
const restaurada =
  "CONSTRAINT social_links.social_links_platform_ck CHECK (((platform)::text = ANY (ARRAY[('instagram'::character varying)::text, ('facebook'::character varying)::text, ('x'::character varying)::text, ('tiktok'::character varying)::text, ('threads'::character varying)::text, ('bluesky'::character varying)::text])))";

describe("diffCoreCatalog · grafías equivalentes tras dump/restore", () => {
  it("una restauración fiel con otra grafía no figura como drift", () => {
    expect(diffCoreCatalog([viva], [])).toEqual({ missing: [], extra: [] });
    expect(diffCoreCatalog([restaurada], [])).toEqual({ missing: [], extra: [] });
    // Forma de producción: actual = copia restaurada + core real; el snapshot
    // esperado no incluye social_links (es una adición aprobada).
    expect(diffCoreCatalog([restaurada, "COL persons.name text"], ["COL persons.name text"])).toEqual({ missing: [], extra: [] });
  });

  it("un cambio real en la lista de valores se sigue delatando", () => {
    const sinBluesky = restaurada.replace(", ('bluesky'::character varying)::text", "");
    const diff = diffCoreCatalog([sinBluesky], []);
    expect(diff.missing).toEqual([]);
    expect(diff.extra).toHaveLength(1);
  });

  it("un operador distinto con la misma grafía de casts sigue delatándose", () => {
    const otroOperador = restaurada.replace("= ANY", "= ALL");
    expect(diffCoreCatalog([otroOperador], []).extra).toHaveLength(1);
  });

  it("las entradas normales no se ven afectadas", () => {
    expect(diffCoreCatalog(["COL persons.otra boolean"], [])).toEqual({
      missing: [],
      extra: ["COL persons.otra boolean"],
    });
    expect(diffCoreCatalog(["COL persons.is_deceased boolean"], [])).toEqual({ missing: [], extra: [] });
  });
});
