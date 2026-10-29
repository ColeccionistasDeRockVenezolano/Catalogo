// CRV · Catálogo de efectos del chat.
//
// Valida el contrato que comparten servidor y navegador: si un efecto se
// publica con un preset que el renderer no conoce (o un coste imposible), el
// test falla antes de que llegue a producción.
import { describe, expect, it } from "vitest";
import {
  EFFECT_CATALOG, EFFECT_PRESETS, EFFECTS_BY_CODE, effectManifestSchema, effectProductSchema,
  isEquippable, type EffectKind,
} from "../../src/chat/effects-catalog.js";
import { clientEventSchema, equippedSchema, MAX_BODY } from "../../src/chat/protocol.js";

describe("catálogo de efectos del chat", () => {
  it("no publica efectos antiguos en ninguna categoría", () => {
    expect(EFFECT_CATALOG).toEqual([]);
    expect(EFFECTS_BY_CODE.size).toBe(0);
  });

  it("un efecto de nombre o marco se puede equipar; uno de mensaje, no", () => {
    expect(isEquippable("name")).toBe(true);
    expect(isEquippable("frame")).toBe(true);
    expect(isEquippable("background")).toBe(true);
    expect(isEquippable("ambient")).toBe(true);
    const notEquippable: EffectKind[] = ["entry", "message", "action", "sticker"];
    for (const kind of notEquippable) expect(isEquippable(kind)).toBe(false);
  });

  it("el índice por código coincide con el catálogo", () => {
    for (const effect of EFFECT_CATALOG) expect(EFFECTS_BY_CODE.get(effect.code)).toBe(effect);
  });

  it("rechaza manifiestos con presets desconocidos o coste fuera de rango", () => {
    const base = { version: 1, triggers: ["always"], reducedMotion: "static", cost: 3 };
    expect(effectManifestSchema.safeParse({
      ...base, layers: [{ type: "css", preset: "inventado" }],
    }).success).toBe(false);
    expect(effectManifestSchema.safeParse({
      ...base, cost: 99, layers: [{ type: "css", preset: "glow" }],
    }).success).toBe(false);
    expect(effectManifestSchema.safeParse({
      ...base, layers: [],
    }).success).toBe(false);
  });
});

describe("protocolo del chat", () => {
  it("acepta un mensaje normal y rechaza uno vacío o gigante", () => {
    expect(clientEventSchema.safeParse({ type: "message", body: "hola" }).success).toBe(true);
    expect(clientEventSchema.safeParse({ type: "message", body: "   " }).success).toBe(false);
    expect(clientEventSchema.safeParse({ type: "message", body: "x".repeat(MAX_BODY + 1) }).success).toBe(false);
  });

  it("acepta cambiar el apodo y equipar, y rechaza ranuras inventadas", () => {
    expect(clientEventSchema.safeParse({ type: "profile", displayName: "Ana" }).success).toBe(true);
    expect(clientEventSchema.safeParse({ type: "profile", displayName: "A" }).success).toBe(false);
    expect(clientEventSchema.safeParse({ type: "equip", slot: "name", effectCode: "neon" }).success).toBe(true);
    expect(clientEventSchema.safeParse({ type: "equip", slot: "cabeza", effectCode: "neon" }).success).toBe(false);
  });

  it("el equipado incluye la ranura independiente de placas", () => {
    expect(equippedSchema.safeParse({ name: null, frame: null, background: null, ambient: null, name_font: null }).success).toBe(true);
    expect(equippedSchema.safeParse({ name: "neon" }).success).toBe(false);
  });

  it("acepta una fuente en su propia ranura", () => {
    expect(clientEventSchema.safeParse({ type: "equip", slot: "name_font", effectCode: "math-fraktur-bold" }).success).toBe(true);
    expect(isEquippable("name_font")).toBe(true);
  });

  it("no permite presets fuera del catálogo del renderer", () => {
    for (const effect of EFFECT_CATALOG) {
      for (const layer of effect.manifest.layers) {
        expect(EFFECT_PRESETS).toContain(layer.preset);
      }
    }
  });
});

describe("placas como producto independiente", () => {
  const base = { version: 1, triggers: ["always"], layers: [], cost: 1 };
  it("admite placas estáticas y animadas con alternativa estática", () => {
    expect(effectProductSchema.safeParse({ kind: "badge", manifest: {
      ...base, badge: { imageUrl: "/media/placa.webp" },
    } }).success).toBe(true);
    expect(effectProductSchema.safeParse({ kind: "badge", manifest: {
      ...base, badge: { imageUrl: "/media/placa-animada.webp", animated: true, staticImageUrl: "/media/placa.webp" },
    } }).success).toBe(true);
    expect(effectProductSchema.safeParse({ kind: "badge", manifest: {
      ...base, badge: { imageUrl: "/media/placa-animada.webp", animated: true },
    } }).success).toBe(false);
  });
  it("no mezcla placas y adornos con los efectos de nombre", () => {
    expect(effectProductSchema.safeParse({ kind: "name", manifest: {
      ...base, badge: { imageUrl: "/media/placa.webp" },
    } }).success).toBe(false);
    expect(effectProductSchema.safeParse({ kind: "name", manifest: {
      ...base, layers: [{ type: "sprite", preset: "guitar" }],
    } }).success).toBe(false);
    expect(effectProductSchema.safeParse({ kind: "name", manifest: {
      ...base, layers: [{ type: "css", preset: "glow" }],
    } }).success).toBe(true);
    expect(isEquippable("badge")).toBe(true);
    expect(clientEventSchema.safeParse({ type: "equip", slot: "badge", effectCode: "placa-test" }).success).toBe(true);
  });
});
