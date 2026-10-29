import { describe, expect, it } from "vitest";
import { EFFECT_CATALOG, effectManifestSchema } from "../../../src/chat/effects-catalog";
import { bloodPhase, boltPoints, drift, MATERIAL_PRESETS, materialPreset } from "../../src/lib/chatMaterials";
import { manifestOf } from "../../src/lib/chatEffects";
import type { ChatEffect } from "../../../src/chat/protocol";

describe("materiales del chat", () => {
  it("cada familia se ofrece para avatar y mensaje con contrato válido en ambos extremos", () => {
    // El nombre de cada familia lo pinta el motor de shader (chat-name-shaders.test.ts).
    for (const preset of MATERIAL_PRESETS) {
      const variants = EFFECT_CATALOG.filter((effect) => effect.manifest.layers.some((layer) => layer.type === "material" && layer.preset === preset));
      expect(variants.map((effect) => effect.kind).sort()).toEqual(["frame", "message"]);
      for (const effect of variants) {
        expect(effectManifestSchema.safeParse(effect.manifest).success).toBe(true);
        expect(manifestOf(effect as unknown as ChatEffect)?.layers[0]?.type).toBe("material");
        expect(effect.manifest.layers[0]?.colors).toHaveLength(6);
      }
    }
  });
  it("las compras anteriores conservan código y reciben el material compatible", () => {
    for (const [preset, material] of [["electric-ring", "chidori"], ["blood", "viscous-blood"], ["fire-ring", "fire"], ["rainbow", "pastel-rainbow"], ["plasma", "karma-aura"]]) {
      expect(materialPreset(preset)).toBe(material);
    }
    expect(materialPreset("inventado")).toBeNull();
    expect(materialPreset("wave")).toBeNull();
  });
  it("la sangre estrecha el cuello antes de separarse y acelera en la caída", () => {
    const phaseAt = (phase: number) => {
      const state = bloodPhase(0, 42);
      return bloodPhase((phase - state.phase + 1) * state.period, 42);
    };
    expect(phaseAt(.76).neck).toBeLessThan(phaseAt(.64).neck);
    expect(phaseAt(.78).falling).toBe(false);
    expect(phaseAt(.82).falling).toBe(true);
    const a = phaseAt(.82).fallDistance; const b = phaseAt(.85).fallDistance; const c = phaseAt(.88).fallDistance;
    expect(c - b).toBeGreaterThan(b - a);
    expect(phaseAt(.87).remnant).toBeLessThan(phaseAt(.8).remnant);
  });
  it("los goteos tienen periodos independientes y los rayos regeneran su geometría", () => {
    const periods = Array.from({ length: 9 }, (_, i) => bloodPhase(0, i).period);
    expect(new Set(periods).size).toBe(9);
    expect(periods.every((period) => period >= 2.4 && period <= 6)).toBe(true);
    expect(boltPoints(100, 12, 1)).not.toEqual(boltPoints(100, 12, 2));
    expect(boltPoints(100, 12, 1)).toEqual(boltPoints(100, 12, 1));
  });
  it("el humo evoluciona suavemente sin saltos ni depender del número de fotogramas", () => {
    for (let t = 0; t < 15; t += .037) {
      expect(Math.abs(drift(t + .001, 4) - drift(t, 4))).toBeLessThan(.005);
      expect(Math.abs(drift(t, 4))).toBeLessThanOrEqual(1);
    }
    expect(drift(1, 4)).not.toBe(drift(7, 4));
  });
});
