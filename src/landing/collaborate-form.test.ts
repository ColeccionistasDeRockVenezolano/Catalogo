import { describe, expect, it } from "vitest";
import { resolveCollaborateForm, visibleSteps } from "./collaborate-form.js";

describe("formulario público", () => {
  it("usa valores predeterminados localizados y combina ajustes y traducciones", () => {
    const form = resolveCollaborateForm({ fields: { ideas: "off" }, labels: { email: "Correo personalizado" } }, "en", { "collab.labels.email": "Your email" });
    expect(form.labels.email).toBe("Your email");
    expect(visibleSteps(form).map((step) => step.key)).not.toContain("ideas");
    expect(form.steps.about).not.toBe("");
  });

  it("no inserta atributos o etiquetas peligrosas en el título", () => {
    const form = resolveCollaborateForm({ heroTitleHtml: '<span onclick="x()">Únete</span><img src=x' }, "es");
    expect(form.heroTitleHtml).toBe("<span>Únete</span>&lt;img src=x");
  });
});
