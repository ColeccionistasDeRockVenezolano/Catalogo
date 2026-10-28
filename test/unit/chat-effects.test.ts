// CRV · Catálogo de efectos del chat.
//
// Valida el contrato que comparten servidor y navegador: si un efecto se
// publica con un preset que el renderer no conoce (o un coste imposible), el
// test falla antes de que llegue a producción.
import { describe, expect, it } from "vitest";
import {
  EFFECT_CATALOG, EFFECT_KINDS, EFFECT_PRESETS, EFFECTS_BY_CODE, effectManifestSchema,
  isEquippable, type EffectKind,
} from "../../src/chat/effects-catalog.js";
import { clientEventSchema, equippedSchema, MAX_BODY } from "../../src/chat/protocol.js";

describe("catálogo de efectos del chat", () => {
  it("tiene al menos 30 efectos y códigos únicos", () => {
    expect(EFFECT_CATALOG.length).toBeGreaterThanOrEqual(30);
    const codes = EFFECT_CATALOG.map((effect) => effect.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("cada manifiesto cumple el esquema", () => {
    for (const effect of EFFECT_CATALOG) {
      const parsed = effectManifestSchema.safeParse(effect.manifest);
      expect(parsed.success, `${effect.code}: ${parsed.success ? "" : parsed.error.message}`).toBe(true);
    }
  });

  it("solo usa presets que el renderer sabe pintar", () => {
    for (const effect of EFFECT_CATALOG) {
      for (const layer of effect.manifest.layers) {
        expect(EFFECT_PRESETS, `${effect.code}/${layer.preset}`).toContain(layer.preset);
      }
    }
  });

  it("respeta el contrato de precios y duración", () => {
    for (const effect of EFFECT_CATALOG) {
      expect(effect.priceCoins).toBeGreaterThanOrEqual(0);
      expect(effect.priceCredits).toBeGreaterThanOrEqual(0);
      if (effect.durationDays !== null) expect(effect.durationDays).toBeGreaterThan(0);
      expect(EFFECT_KINDS).toContain(effect.kind);
    }
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

  it("el equipado siempre tiene las cuatro ranuras", () => {
    expect(equippedSchema.safeParse({ name: null, frame: null, background: null, ambient: null }).success).toBe(true);
    expect(equippedSchema.safeParse({ name: "neon" }).success).toBe(false);
  });
});
