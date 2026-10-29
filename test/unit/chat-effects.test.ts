// CRV · Catálogo de efectos del chat.
//
// Valida el contrato que comparten servidor y navegador: si un efecto se
// publica con un preset que el renderer no conoce (o un coste imposible), el
// test falla antes de que llegue a producción.
import { describe, expect, it } from "vitest";
import {
  EFFECT_CATALOG, EFFECT_KINDS, EFFECT_PRESETS, EFFECTS_BY_CODE, NAME_SHADER_PRESETS, effectManifestSchema,
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
    expect(isEquippable("badge")).toBe(true);
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

  it("el equipado siempre tiene las seis ranuras", () => {
    expect(equippedSchema.safeParse({ name: null, frame: null, background: null, ambient: null, name_font: null, badge: null }).success).toBe(true);
    expect(equippedSchema.safeParse({ name: "neon" }).success).toBe(false);
  });

  it("acepta una fuente en su propia ranura", () => {
    expect(clientEventSchema.safeParse({ type: "equip", slot: "name_font", effectCode: "math-fraktur-bold" }).success).toBe(true);
    expect(EFFECTS_BY_CODE.get("math-fraktur-bold")?.kind).toBe("name_font");
    expect(isEquippable("name_font")).toBe(true);
  });

  it("acepta una placa en su propia ranura", () => {
    expect(clientEventSchema.safeParse({ type: "equip", slot: "badge", effectCode: "cassette" }).success).toBe(true);
    expect(EFFECTS_BY_CODE.get("cassette")?.kind).toBe("badge");
  });

  it("no permite presets fuera del catálogo del renderer", () => {
    for (const effect of EFFECT_CATALOG) {
      for (const layer of effect.manifest.layers) {
        expect(EFFECT_PRESETS).toContain(layer.preset);
      }
    }
  });
});


describe("nombres, placas y escenas", () => {
  it("cada efecto de nombre pinta las letras con un shader y no lleva objetos", () => {
    const names = EFFECT_CATALOG.filter((effect) => effect.kind === "name");
    expect(names.length).toBeGreaterThanOrEqual(20);
    for (const effect of names) {
      const layers = effect.manifest.layers;
      expect(layers.some((layer) => layer.type === "shader"), effect.code).toBe(true);
      expect(layers.some((layer) => layer.type === "sprite" || layer.type === "choreo"), effect.code).toBe(false);
      for (const layer of layers) {
        if (layer.type === "shader") expect(NAME_SHADER_PRESETS as readonly string[]).toContain(layer.preset);
      }
    }
  });

  it("los objetos que se vendían como nombre son placas con su código", () => {
    for (const code of ["vinilo", "cassette", "ampli", "cuernos", "micro", "corazon-rock", "rockero",
      "guitarra", "murcielago", "bateria", "ovni", "vinilo-rodante", "rockerito"]) {
      const effect = EFFECTS_BY_CODE.get(code);
      expect(effect?.kind, code).toBe("badge");
      expect(effect?.manifest.layers.every((layer) => layer.type === "sprite"), code).toBe(true);
    }
  });

  it("la sangre corre por las letras y gotea (no es una línea)", () => {
    for (const code of ["sangre", "sangre-realista"]) {
      const layer = EFFECTS_BY_CODE.get(code)?.manifest.layers[0];
      expect(layer?.type).toBe("shader");
      expect(layer?.preset).toBe("blood-flow");
    }
  });

  it("las escenas duran entre 1,5 y 2,5 segundos y los stickers tienen arte", () => {
    for (const effect of EFFECT_CATALOG) {
      if (effect.manifest.layers.some((layer) => layer.type === "scene")) {
        expect(effect.manifest.durationMs).toBeGreaterThanOrEqual(1500);
        expect(effect.manifest.durationMs).toBeLessThanOrEqual(2500);
      }
      if (effect.kind === "sticker") expect(effect.manifest.layers.some((layer) => layer.type === "sprite")).toBe(true);
    }
  });
});
