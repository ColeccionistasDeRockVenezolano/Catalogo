import { describe, expect, it } from "vitest";
import { NOX_EFFECTS, NOX_PRESETS, NOX_PRODUCTS } from "../../src/chat/nox.js";
import { effectProductSchema, effectPublicationSchema, isEquippable } from "../../src/chat/effects-catalog.js";
import { clientEventSchema, equippedSchema } from "../../src/chat/protocol.js";
import { equippedFromRows } from "../../src/chat/repository.js";
import { rarityOf } from "../../src/chat/rarity.js";
import { bloodfallAnchors } from "../../web/src/lib/bloodfall.js";

describe("colección NOX", () => {
  // 49bab941 añadió «bats» (enjambre de murciélagos), solo nombre: doce efectos, 34 productos.
  it("conserva los doce efectos en sus superficies y sus monedas y rarezas", () => {
    expect(NOX_PRESETS).toHaveLength(12);
    expect(NOX_PRODUCTS).toHaveLength(34);
    expect(new Set(NOX_PRODUCTS.map(p => p.code)).size).toBe(34);
    for (const effect of NOX_EFFECTS) {
      const products = NOX_PRODUCTS.filter(p => p.manifest.nox?.preset === effect.id);
      expect(products.map(p => p.kind)).toEqual("kinds" in effect ? effect.kinds : ["name", "frame", "bubble"]);
      for (const product of products) {
        const parsed = effectPublicationSchema.parse(product);
        expect(effectProductSchema.parse(parsed).manifest.nox?.preset).toBe(effect.id);
        expect(parsed.priceCoins).toBe(effect.price);
        expect(rarityOf(product)).toBe(effect.rarity);
      }
    }
  });
  it("no mezcla los motores ni coloca un NOX en placas, fuentes o acciones", () => {
    const manifest = NOX_PRODUCTS[0]!.manifest;
    for (const kind of ["badge", "name_font", "entry", "action", "ambient", "message"]) expect(effectProductSchema.safeParse({ kind, manifest }).success).toBe(false);
    expect(effectProductSchema.safeParse({ kind: "bubble", manifest: { ...manifest, nox: { preset: "inventado" } } }).success).toBe(false);
    expect(effectProductSchema.safeParse({ kind: "name", manifest: { ...manifest, layers: [{ type: "css", preset: "blood" }] } }).success).toBe(false);
  });
  it("equipa burbujas y conserva compatibilidad con sesiones anteriores", () => {
    expect(isEquippable("bubble")).toBe(true);
    expect(isEquippable("message")).toBe(false);
    expect(clientEventSchema.parse({ type: "equip", slot: "bubble", effectCode: "nox-ice-bubble" }).type).toBe("equip");
    const old = { name: null, frame: null, background: null, ambient: null, name_font: null, badge: null };
    expect(equippedSchema.safeParse(old).success).toBe(true);
    expect(equippedSchema.parse({ ...old, bubble: "nox-ice-bubble" }).bubble).toBe("nox-ice-bubble");
    expect(equippedFromRows([{ slot: "bubble", code: "nox-blood-bubble" }]).bubble).toBe("nox-blood-bubble");
  });
});

describe("anclajes de Bloodfall", () => {
  it("elige tinta real y el borde inferior; nunca espacios ni columnas transparentes", () => {
    const width = 30, height = 20, rgba = new Uint8ClampedArray(width * height * 4);
    for (const [left, right, bottom] of [[2, 8, 10], [20, 27, 16]]) {
      for (let x = left!; x <= right!; x++) for (let y = 2; y <= bottom!; y++) rgba[(y * width + x) * 4 + 3] = 255;
    }
    const anchors = bloodfallAnchors(rgba, width, height, 6);
    expect(anchors).toHaveLength(6);
    expect(new Set(anchors.map(a => a.x)).size).toBe(6);
    for (const a of anchors) {
      expect(a.x <= 8 || a.x >= 20).toBe(true);
      expect(a.y).toBe(a.x <= 8 ? 10 : 16);
      expect(rgba[(a.y * width + a.x) * 4 + 3]).toBe(255);
    }
    expect(bloodfallAnchors(new Uint8ClampedArray(width * height * 4), width, height, 5)).toEqual([]);
  });
});
