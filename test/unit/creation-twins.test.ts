import { describe, expect, it } from "vitest";
import type { PoolClient } from "pg";
import { creationTwin, identityForm, nameVariants } from "../../src/curation/ai/creation-twins.js";
import type { CatalogOperation } from "../../src/curation/ai/types.js";

const base = { label: "", reason: "", evidenceIds: ["E1"], enabled: true };
const create = (key: string, kind: "artist" | "organization" | "person", values: Record<string, string>) =>
  ({ ...base, key, label: `Crear ${values["name"]}`, op: "create_entity", kind, values }) as Extract<CatalogOperation, { op: "create_entity" }>;
/** Answers each table with its rows; the SQL filter is a pre-selection, the comparison is the module's. */
const catalog = (rows: Record<string, Array<{ id: number; name: string; forms: string }>>) =>
  ({ query: async (sql: string) => ({ rows: Object.entries(rows).find(([table]) => sql.includes(`FROM ${table} e`))?.[1] ?? [] }) }) as unknown as PoolClient;

describe("altas que repiten una ficha", () => {
  it("lee los ordinales escritos y separa las variantes que declara el nombre", () => {
    expect(identityForm("4to. Poder")).toBe("cuarto poder");
    expect(identityForm("Velásquez")).toBe("velasquez");
    expect(nameVariants("4to Poder - Cuarto Poder")).toEqual(["cuarto poder cuarto poder", "cuarto poder"]);
    expect(nameVariants("César Velásquez (Cotur)")).toEqual(["cesar velasquez cotur", "cesar velasquez", "cotur"]);
  });
  it("una banda con otra grafía es el artista existente, también si se propone como organización", async () => {
    const client = catalog({ "public.artists": [{ id: 1905, name: "Cuarto Poder", forms: "Cuarto Poder" }] });
    const artist = create("a", "artist", { name: "4to Poder - Cuarto Poder" });
    expect(await creationTwin(client, artist, [artist], () => undefined)).toMatch(/probablemente ya existe: artista «Cuarto Poder» \(#1905\)/u);
    const org = create("o", "organization", { name: "4to Poder" });
    expect(await creationTwin(client, org, [org], () => undefined)).toMatch(/artista «Cuarto Poder» \(#1905\)/u);
  });
  it("una persona cuyo nombre es el nombre real de otra ficha del catálogo o del plan", async () => {
    const person = create("p", "person", { name: "Larry Porfirio Rada Herrera" });
    const realName: CatalogOperation = { ...base, key: "r", label: "Nombre real", op: "replace_fields", target: { kind: "person", id: 337 }, values: { realName: "Larry Porfirio Rada Herrera" } };
    expect(await creationTwin(catalog({}), person, [realName, person], () => "Apache")).toMatch(/nombre real en la persona «Apache» \(#337\)/u);
    const stored = catalog({ "public.persons": [{ id: 337, name: "Apache", forms: "Apache | Larry Porfirio Rada Herrera" }] });
    expect(await creationTwin(stored, person, [person], () => undefined)).toMatch(/persona «Apache» \(#337\)/u);
  });
  it("dos altas del mismo plan: la segunda pide decidir una sola", async () => {
    const first = create("a", "artist", { name: "Cuarto Poder" }), second = create("b", "organization", { name: "4to Poder" });
    expect(await creationTwin(catalog({}), first, [first, second], () => undefined)).toBeNull();
    expect(await creationTwin(catalog({}), second, [first, second], () => undefined)).toMatch(/la propuesta «Crear Cuarto Poder» ya crea esta ficha/u);
  });
  it("un nombre igual del mismo tipo queda para la comprobación del catálogo; nombres distintos no se marcan", async () => {
    const client = catalog({ "public.artists": [{ id: 1905, name: "Cuarto Poder", forms: "Cuarto Poder" }, { id: 7, name: "Poder Joven", forms: "Poder Joven" }] });
    const same = create("a", "artist", { name: "Cuarto Poder" });
    expect(await creationTwin(client, same, [same], () => undefined)).toBeNull();
    const other = create("b", "artist", { name: "Quinto Poder" });
    expect(await creationTwin(client, other, [other], () => undefined)).toBeNull();
  });
});
