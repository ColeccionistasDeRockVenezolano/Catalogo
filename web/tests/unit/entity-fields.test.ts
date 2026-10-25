import { describe, expect, it } from "vitest";
import { ENTITY_FIELDS } from "../../../src/api/routes/catalog-writes";
import { ALBUM_FIELDS, ARTIST_FIELDS, PERSON_FIELDS, ORGANIZATION_FIELDS, TRACK_FIELDS, entityFormValues } from "../../src/lib/entityFields";

describe("edición completa de fichas", () => {
  it.each([
    // `pickerKeys` son campos del formulario que la API valida aparte por ser
    // selectores de relación; `apiOnlyKeys` son datos que la API también valida
    // aparte (clasificaciones y fecha de publicación estructurada); `omitKeys`
    // son datos de la API que el formulario ya no edita —las marcas de tiempo
    // viven en el editor de marcas por video—.
    ["artist", ARTIST_FIELDS, [], [], []], ["person", PERSON_FIELDS, [], [], []], ["organization", ORGANIZATION_FIELDS, [], [], []],
    ["album", ALBUM_FIELDS, ["labelId"], ["classifications", "releaseDate"], []], ["track", TRACK_FIELDS, [], [], ["youtubeStartSeconds"]],
  ] as const)("ofrece todos los campos de escritura de %s (incluidos selectores de relación)", (kind, fields, pickerKeys, apiOnlyKeys, omitKeys) => {
    const apiKeys = [...Object.keys(ENTITY_FIELDS[kind]), ...apiOnlyKeys].filter((key) => !(omitKeys as readonly string[]).includes(key));
    expect([...fields.map((field) => field.key), ...pickerKeys].sort()).toEqual(apiKeys.sort());
  });
  it("precarga valores vacíos, falsos y cero sin incluir campos derivados", () => {
    expect(entityFormValues(PERSON_FIELDS, { id: 1, name: "Nombre artístico", realName: "Nombre real", isVenezuelan: false, gender: null, bands: [] })).toEqual({ name: "Nombre artístico", realName: "Nombre real", isVenezuelan: false, gender: null });
    expect(entityFormValues(TRACK_FIELDS, { discNumber: 1, trackNumber: 2, durationSeconds: 0, notes: "Nota existente" })).toEqual({ discNumber: 1, trackNumber: 2, durationSeconds: 0, notes: "Nota existente" });
  });
  it("omite campos ausentes de una API anterior para conservar el dato guardado", () => {
    const values = entityFormValues(ARTIST_FIELDS, { name: "Proyecto", status: undefined });
    expect(values).toEqual({ name: "Proyecto" });
    expect(values).not.toHaveProperty("logoUrl");
  });
});
