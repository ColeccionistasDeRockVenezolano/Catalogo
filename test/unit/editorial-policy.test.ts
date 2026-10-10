// CRV · Política editorial (E1-06; el gate G15 «Autocorrección» exige «lista
// blanca demostrable, límites, fallo/reversión y ninguna inferencia histórica
// automática»). Estas pruebas fijan esa lista, sus límites y la regla dura:
// solo las transformaciones cuya validez puede demostrarse desde el propio
// valor pueden correr desatendidas (modo `auto` de un lote).
import { describe, expect, it } from "vitest";
import {
  EDITORIAL_POLICY_INSTRUCTIONS, EDITORIAL_POLICY_VERSION, permitsAutofix, requireEditorialBasis,
} from "../../src/curation/editorial-policy.js";
import { FIX_ACTIONS, getFixAction } from "../../src/curation/actions/registry.js";

/** Las únicas transformaciones cuyo resultado es demostrable desde el valor. */
const DEMOSTRABLES = ["limpiar_texto", "decodificar_html", "recortar_extremos", "vaciar_duracion"];

describe("política editorial · lista blanca de autocorrección", () => {
  it("permite exactamente las transformaciones demostrables desde el propio valor", () => {
    for (const key of DEMOSTRABLES) expect(permitsAutofix(key), key).toBe(true);
    for (const key of ["retirar_huerfana", "vaciar_anio", "fijar_anio_formacion", "fusionar", "renumerar_consecutivo", "clave_inexistente"]) {
      expect(permitsAutofix(key), key).toBe(false);
    }
  });

  it("la lista blanca no tiene claves inventadas y todas son candidatas de nivel 0", () => {
    for (const key of DEMOSTRABLES) {
      const action = getFixAction(key);
      expect(action, key).toBeDefined();
      expect(action!.level, key).toBe(0);
    }
  });

  it("ninguna inferencia histórica (año, formación, fechas) corre desatendida", () => {
    const historicas = FIX_ACTIONS.filter((action) => /anio|formacion|fecha/.test(action.key));
    expect(historicas.length).toBeGreaterThan(0);
    for (const action of historicas) {
      expect(permitsAutofix(action.key), action.key).toBe(false);
      expect(action.level, action.key).toBeGreaterThanOrEqual(1);
    }
  });

  it("retirar una ficha huérfana exige motivo editorial y no es nivel 0", () => {
    const huerfana = getFixAction("retirar_huerfana");
    expect(huerfana).toBeDefined();
    expect(huerfana!.level).toBe(2);
    expect(huerfana!.paramsSchema.safeParse({ kind: "person", id: 1, editorialBasis: "no" }).success).toBe(false);
    expect(huerfana!.paramsSchema.safeParse({ kind: "person", id: 1, editorialBasis: "Ficha basura confirmada contra la fuente citada" }).success).toBe(true);
  });

  it("el motivo editorial exige texto real (no vacío ni recortado)", () => {
    expect(() => requireEditorialBasis(undefined)).toThrow();
    expect(() => requireEditorialBasis("   ")).toThrow();
    expect(() => requireEditorialBasis("corto")).toThrow();
    expect(() => requireEditorialBasis("Motivo editorial explícito de prueba")).not.toThrow();
  });

  it("las instrucciones compartidas llevan la versión de la política", () => {
    expect(EDITORIAL_POLICY_INSTRUCTIONS).toContain(`v${EDITORIAL_POLICY_VERSION}`);
    expect(EDITORIAL_POLICY_VERSION).toBeGreaterThanOrEqual(1);
  });
});
