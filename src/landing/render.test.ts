import { beforeEach, describe, expect, it, vi } from "vitest";
import defaults from "./collaborate-defaults.json" with { type: "json" };
import { resolveBranding } from "./branding.js";
import { resolveLandingTheme } from "./theme.js";

vi.mock("./data.js", () => ({ loadLandingData: vi.fn() }));
import { loadLandingData } from "./data.js";
import { renderLanding, type LandingPage } from "./render.js";

beforeEach(() => {
  vi.mocked(loadLandingData).mockResolvedValue({
    project: { id: 1, slug: "test", name: "Proyecto", theme_json: null, branding_json: null, i18n_json: null, collaborate_json: null, accepts_applications: 0, show_login: 1, visitor_counter: 0, visibility_mode: "full" },
    view: { visibility: "full", overall: { total: 0, completed: 0, percentage: 0 }, categories: [], lastUpdated: null, collaborators: 0 },
    visits: { today: 0, total: 0, online: 0, todayCountries: [], totalCountries: [], onlineCountries: [] },
    theme: resolveLandingTheme("Proyecto", null), branding: resolveBranding(null), form: defaults.es,
    steps: [], projectAssets: {}, catalog: { skills: [], areas: [], linkTypes: [] }, radio: null, radioTexts: null,
  });
});

describe("plantillas EJS de la portada", () => {
  it.each<LandingPage>(["roadmap", "colaborar", "login", "registro", "activar"])("genera %s con parciales completos", async (page) => {
    const html = await renderLanding(page, "es");
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("<meta charset=");
    expect(html).not.toContain("[object Promise]");
    expect(html).not.toContain("undefined");
  });

  it.each<LandingPage>(["registro", "activar"])("muestra enlace inválido en %s sin token", async (page) => {
    const html = await renderLanding(page, "es");
    expect(html).not.toContain('class="login-form"');
    expect(html.toLowerCase()).toMatch(/(?:no es válido|no válido|caducad)/u);
  });
});
