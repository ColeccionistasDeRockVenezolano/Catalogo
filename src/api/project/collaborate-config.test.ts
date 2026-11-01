// CRV · Pruebas del formulario de colaboración (ventana 3.8).
//
// Solo la parte pura: qué se guarda y qué se descarta. La escritura en
// PostgreSQL y el efecto en /colaborar se comprueban contra staging.
import { describe, expect, it } from "vitest";
import { sanitizeCollaborateConfig } from "./collaborate-config.js";

describe("sanitizeCollaborateConfig", () => {
  it("conserva textos, pasos, etiquetas y máximos válidos", () => {
    const clean = sanitizeCollaborateConfig({
      heroSub: "Texto de portada",
      submitLabel: "Enviar",
      maxLinks: 3,
      steps: { about: "Sobre ti", skills: "Qué sabes hacer" },
      labels: { lastName: "Apellido" },
      placeholders: { availability: "Ej. dos tardes" },
      pillars: ["Conocimiento", "Archivo"],
      nextSteps: ["Uno", "Dos"],
    });
    expect(clean["heroSub"]).toBe("Texto de portada");
    expect(clean["maxLinks"]).toBe(3);
    expect(clean["steps"]).toEqual({ about: "Sobre ti", skills: "Qué sabes hacer" });
    expect(clean["pillars"]).toEqual(["Conocimiento", "Archivo"]);
  });

  it("descarta claves que no existen en el formulario", () => {
    const clean = sanitizeCollaborateConfig({ inventada: "x", steps: { noExiste: "y" }, fields: { inventado: "required" } });
    expect(clean).toEqual({ steps: {}, fields: {} });
  });

  it("sanea el titular de portada y quita atributos", () => {
    const clean = sanitizeCollaborateConfig({
      heroTitleHtml: "NO BUSCAMOS<br>SOLO<br>PROGRAMADORES",
    });
    expect(clean["heroTitleHtml"]).toBe("NO BUSCAMOS<br>SOLO<br>PROGRAMADORES");
    const conAtributos = sanitizeCollaborateConfig({ heroTitleHtml: "<span onclick=\"alert(1)\">Hola</span>" });
    expect(conAtributos["heroTitleHtml"]).toBe("<span>Hola</span>");
  });

  it("solo admite off, optional y required en los campos", () => {
    const clean = sanitizeCollaborateConfig({
      fields: { lastName: "required", birthDate: "off", email: "obligatorio" },
    });
    expect(clean["fields"]).toEqual({ lastName: "required", birthDate: "off" });
  });

  it("acota maxLinks a 0–10 y descarta lo que no es entero", () => {
    expect(sanitizeCollaborateConfig({ maxLinks: 11 })).toEqual({});
    expect(sanitizeCollaborateConfig({ maxLinks: -1 })).toEqual({});
    expect(sanitizeCollaborateConfig({ maxLinks: 2.5 })).toEqual({});
    expect(sanitizeCollaborateConfig({ maxLinks: 0 })).toEqual({ maxLinks: 0 });
  });

  it("recorta listas largas a 10 elementos y rechaza textos gigantes", () => {
    const list = Array.from({ length: 15 }, (_, index) => `Paso ${index}`);
    expect((sanitizeCollaborateConfig({ nextSteps: list })["nextSteps"] as string[])).toHaveLength(10);
    expect(sanitizeCollaborateConfig({ heroSub: "x".repeat(1001) })).toEqual({});
  });

  it("rechaza cuerpos que no son objetos", () => {
    expect(() => sanitizeCollaborateConfig("[]")).toThrow(/no es un objeto/);
    expect(() => sanitizeCollaborateConfig([])).toThrow(/no es un objeto/);
    expect(() => sanitizeCollaborateConfig(null)).toThrow(/no es un objeto/);
  });
});
