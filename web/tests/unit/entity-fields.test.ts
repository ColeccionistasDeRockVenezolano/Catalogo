import { describe, expect, it } from "vitest";
import { ENTITY_FIELDS } from "../../../src/api/routes/catalog-writes";
import { ALBUM_FIELDS, ARTIST_FIELDS, PERSON_FIELDS, ORGANIZATION_FIELDS, TRACK_FIELDS, entityFormValues } from "../../src/lib/entityFields";

describe("edición completa de fichas", () => {
  it.each([
    ["artist", ARTIST_FIELDS, []], ["person", PERSON_FIELDS, []], ["organization", ORGANIZATION_FIELDS, []],
    ["album", ALBUM_FIELDS, ["labelId"]], ["track", TRACK_FIELDS, []],
  ] as const)("ofrece todos los campos de escritura de %s (incluidos selectores de relación)", (kind, fields, pickerKeys) => {
    expect([...fields.map((field) => field.key), ...pickerKeys].sort()).toEqual(Object.keys(ENTITY_FIELDS[kind]).sort());
  });
  it("precarga valores vacíos, falsos y cero sin incluir campos derivados", () => {
    expect(entityFormValues(PERSON_FIELDS, { id: 1, name: "Nombre artístico", realName: "Nombre real", isVenezuelan: false, gender: null, bands: [] })).toEqual({ name: "Nombre artístico", realName: "Nombre real", isVenezuelan: false, gender: null });
    expect(entityFormValues(TRACK_FIELDS, { discNumber: 1, trackNumber: 2, youtubeStartSeconds: 0, notes: "Nota existente" })).toEqual({ discNumber: 1, trackNumber: 2, youtubeStartSeconds: 0, notes: "Nota existente" });
  });
  it("omite campos ausentes de una API anterior para conservar el dato guardado", () => {
    const values = entityFormValues(ARTIST_FIELDS, { name: "Proyecto", status: undefined });
    expect(values).toEqual({ name: "Proyecto" });
    expect(values).not.toHaveProperty("logoUrl");
  });
});
