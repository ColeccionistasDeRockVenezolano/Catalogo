// Plan 20/20, etapa 4 · «Completar la ficha» en la ficha de artista.
// Ficha y discografía reales (lecturas públicas de la API local); plan de IA,
// imágenes candidatas y decisiones simulados: ninguna escritura llega a la base.
// Requiere Vite en 127.0.0.1:5175 apuntando a la API local (8080).
//   npx tsx tests/visual/complete-record-qa.ts
import { chromium, expect, type Page } from "@playwright/test";
import { ENTITY_FIELDS } from "../../../src/api/routes/catalog-writes.js";
import { RELATION_ROUTES } from "../../../src/api/routes/relation-writes.js";
import { describeFields } from "../../../src/curation/ai/fields.js";
import { draftSchema } from "../../../src/curation/ai/schema.js";
import type { CatalogOperation, CatalogPlan, CatalogVocabulary } from "../../../src/curation/ai/types.js";
import { getIndividualVerification } from "../../../src/verification/store.js";
import { closeDb } from "../../../src/db/client.js";

const WEB = process.env.QA_WEB ?? "http://127.0.0.1:5175";
const API = "http://127.0.0.1:8080";
const OUT = process.env.QA_OUT ?? "/tmp/crv-complete-record";
const base = { reason: "La fuente lo documenta", evidenceIds: ["E1"], enabled: true };
const artist = { kind: "artist" as const, id: 58 };
const vocabulary: CatalogVocabulary = {
  configured: true, model: "deepseek-flash", modelLabel: "DeepSeek V4.1 Flash", maxCalls: 2, maxTokens: 6000,
  entities: Object.fromEntries(Object.entries(ENTITY_FIELDS).map(([k, v]) => [k, describeFields(v)])) as CatalogVocabulary["entities"],
  relations: Object.fromEntries(RELATION_ROUTES.map((r) => [r.kind, describeFields(r.create)])) as CatalogVocabulary["relations"],
  genres: [{ slug: "rock", name: "Rock", level: "genre", parentGenreId: null }, { slug: "ska", name: "Ska", level: "genre", parentGenreId: null }],
};
const fixture: CatalogPlan = {
  id: 9001, entityKind: "artist", entityId: 58, instruction: "Investiga y completa todos los datos documentados de la ficha y sus relaciones.",
  status: "ready", phase: "ready", revision: 1,
  draft: draftSchema.parse({
    summary: "Datos documentados y dos dudas.",
    unresolved: ["La fecha de fundación no aparece en ninguna fuente consultada.", "El sello del primer disco tiene dos versiones."],
    operations: [
      { ...base, key: "ska", label: "Añadir género: Ska", op: "assign_genre", target: artist, genreSlug: "ska", role: "secondary" },
      { ...base, key: "ig", label: "Añadir Instagram", op: "add_social_link", target: artist, platform: "instagram", url: "https://www.instagram.com/caramelosdecianuro", handle: "caramelosdecianuro" },
      { ...base, key: "ciudad", label: "Ciudad de origen", op: "replace_fields", target: artist, values: { originCity: "Maracay" } },
      { ...base, key: "anio", label: "Año del disco", op: "replace_fields", target: { kind: "album", id: 57 }, values: { releaseYear: 1994 } },
      { ...base, key: "credito", label: "Crédito de producción", op: "create_relation", kind: "track_credit", endpoints: { trackId: { kind: "track", id: 999999 }, personId: { kind: "person", id: 815 } }, values: { role: "Producción", creditType: "production" } },
    ],
  }),
  evidence: [{ id: "E1", url: "https://fuente.example/caramelos", quote: "Caramelos de Cianuro, banda de ska y rock; Instagram @caramelosdecianuro; su primer disco salió en 1994.", origin: "page", fetchedAt: "2026-10-26", contentHash: "fixture", label: "Historia de la banda" }],
  preview: {
    hash: "a".repeat(64), ready: true, sensitive: false,
    items: [
      { key: "ciudad", op: "replace_fields", label: "", before: { originCity: "Caracas" }, after: { originCity: "Maracay" }, error: "Respaldo insuficiente: ciudad de origen «Maracay».", warnings: [], evidenceGaps: ["ciudad de origen «Maracay»"] },
      { key: "anio", op: "replace_fields", label: "", before: { releaseYear: null }, after: { releaseYear: 1994 }, error: null, warnings: [] },
      { key: "credito", op: "create_relation", label: "", before: null, after: null, error: "La pista #999999 ya no existe.", warnings: [] },
    ],
    affected: [{ kind: "artist", id: 58, label: "Caramelos De Cianuro" }, { kind: "album", id: 57, label: "Las Paticas De La Abuela" }, { kind: "track", id: 999999, label: "Pista retirada" }, { kind: "person", id: 815, label: "Productor" }],
  },
  reviewedKeys: [], decisions: {}, result: null,
  usage: { calls: 3, cachedCalls: 0, tokensIn: 1200, tokensOut: 800, model: "deepseek-flash" },
  requestedBy: "QA", editedBy: null, appliedBy: null, error: null, runId: null, createdAt: "2026-10-26T05:00:00Z", updatedAt: "2026-10-26T05:00:00Z",
};
const candidate = (id: number, source: string) => ({ id, url: `${WEB}/favicon.svg?c=${id}`, source, pageUrl: "https://fuente.example/foto", width: 900, height: 900, score: 0.4, naturalWidth: 900, naturalHeight: 900, effectiveWidth: 900, quality: "high", use: "band_photo", reasons: [], context: null, variantOf: null });
const imageGroups = {
  artist: [{ kind: "artist", entityId: 58, name: "Caramelos De Cianuro", subtitle: null, currentUrl: null, stale: false, candidates: [candidate(1, "deezer"), candidate(2, "discogs")] }],
  album: [{ kind: "album", entityId: 57, name: "Las Paticas De La Abuela", subtitle: "Caramelos De Cianuro · 1994", currentUrl: null, stale: false, candidates: [candidate(3, "discogs")] }],
};

const LONG_URL = `https://archivo.example/${"coleccion-de-rock-venezolano-".repeat(8)}caramelos`;
function withLongContent(plan: CatalogPlan): CatalogPlan {
  plan.draft!.operations.push({ ...base, key: "web", label: `Añadir sitio oficial con una descripción muy extensa ${"y detallada ".repeat(12)}`, op: "add_social_link", target: artist, platform: "website", url: LONG_URL, handle: null } as CatalogOperation);
  plan.draft!.unresolved.push(`Sin separar: ${"Caramelos".repeat(30)}`, `La fuente ${LONG_URL} no da el año.`);
  plan.evidence.push({ ...plan.evidence[0]!, id: "E2", url: LONG_URL, label: `Entrevista ${"extensa ".repeat(15)}` });
  return plan;
}

interface Calls { decisions: Array<{ key: string; decision: string }>; starts: number; imageTasks: unknown[]; unauthorized: Set<string> }
async function open(page: Page, calls: Calls, state: { plan: CatalogPlan }) {
  await page.route(`${API}/**`, async (route) => {
    const req = route.request(), url = new URL(req.url()), path = url.pathname;
    const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (path === "/auth/me") return json({ user: { username: "qa", name: "QA", role: "admin" }, csrf: "qa" });
    if (path === "/curation/ai/vocabulary") return json(vocabulary);
    if (path === "/entity-verification/artist/58") return json(verification);
    if (path === "/entity-verification/budget") return json(null);
    if (path === "/curation/ai/plans" && req.method() === "GET") return json(url.searchParams.get("entityId") === "58" || url.searchParams.get("id") === "58" ? [state.plan] : [state.plan]);
    if (path === "/curation/ai/plans" && req.method() === "POST") { calls.starts++; return json(state.plan); }
    if (path === `/curation/ai/plans/${fixture.id}` && req.method() === "GET") return json(state.plan);
    if (path === `/curation/ai/plans/${fixture.id}/decisions`) {
      const payload = req.postDataJSON() as { key: string; decision: "accepted" | "rejected"; revision: number };
      expect(payload.revision).toBe(state.plan.revision);
      calls.decisions.push({ key: payload.key, decision: payload.decision });
      const runId = payload.decision === "accepted" ? 40 + calls.decisions.length : null;
      state.plan = { ...state.plan, revision: state.plan.revision + 1, decisions: { ...state.plan.decisions, [payload.key]: { decision: payload.decision, decidedBy: "QA", decidedAt: "2026-10-26", runId } } };
      return json(state.plan);
    }
    if (path === "/curation/images" && req.method() === "GET") {
      const kind = url.searchParams.get("kind") as "artist" | "album";
      const own = kind === "artist" ? url.searchParams.get("entityId") === "58" : url.searchParams.get("artistId") === "58";
      const data = own ? imageGroups[kind] : [];
      return json({ data, pagination: { total: data.length, limit: 50, offset: 0 } });
    }
    // La cola del servidor conserva el trabajo hasta procesarlo, como la real.
    const jobs = () => (calls.imageTasks as Array<{ requestId: string; kind: string; entityId: number; candidateId: number | null }>).map((task, index) => ({ id: 500 + index, requestId: task.requestId, type: "decision", groups: [{ kind: task.kind, entityId: task.entityId, name: "x" }], candidateId: task.candidateId, status: "queued", error: null, conflict: false, result: null, runId: null, attempts: 0, createdAt: "", updatedAt: "" }));
    if (path === "/curation/images/jobs" && req.method() === "GET") return json(jobs());
    if (path === "/curation/images/jobs" && req.method() === "POST") {
      const { tasks } = req.postDataJSON() as { tasks: unknown[] };
      const before = calls.imageTasks.length;
      calls.imageTasks.push(...tasks);
      return json(jobs().slice(before));
    }
    if (path.startsWith("/changes/")) return json({ error: { code: "not_found", message: "Cambio simulado: no existe en la prueba." } }, 404);
    if (req.method() !== "GET") return json({ error: { code: "qa", message: `Escritura no simulada: ${path}` } }, 500);
    // Lecturas públicas reales; las protegidas que no estén simuladas se vacían y se anotan.
    const response = await route.fetch({ headers: { ...req.headers(), cookie: "" } });
    if (response.status() === 401 || response.status() === 403) { calls.unauthorized.add(path); return json({ data: [], pagination: { total: 0, limit: 20, offset: 0 } }); }
    return route.fulfill({ status: response.status(), contentType: response.headers()["content-type"] ?? "application/json", body: await response.body() });
  });
}

const verification = await getIndividualVerification("artist", 58);
await closeDb();
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
const results: string[] = [];
try {
  // 1. Recorrido completo a 1440 px.
  {
    const calls: Calls = { decisions: [], starts: 0, imageTasks: [], unauthorized: new Set() };
    const state = { plan: structuredClone(fixture) };
    const errors: string[] = [];
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    page.on("pageerror", (e) => errors.push(e.message));
    // M10: every module the task visits, from the record onwards (SPA navigations included).
    const modules: string[] = [];
    page.on("framenavigated", (frame) => { if (frame === page.mainFrame()) { const path = new URL(frame.url()).pathname; if (modules.at(-1) !== path) modules.push(path); } });
    await open(page, calls, state);
    await page.goto(`${WEB}/artistas/58`);
    const region = page.getByRole("region", { name: "Completar la ficha" });
    await expect(region).toBeVisible({ timeout: 20000 });
    // Entrada principal arriba, en «Administrar»: lleva al panel y deja el foco en su título.
    await page.evaluate(() => scrollTo(0, 0));
    await page.getByRole("toolbar", { name: "Administrar esta ficha" }).getByRole("button", { name: "Investigar y completar" }).click();
    await expect(region.getByRole("heading", { name: "Completar la ficha" })).toBeFocused();
    await expect(region.getByRole("heading", { name: "Completar la ficha" })).toBeInViewport();
    const tabs = region.getByRole("tab");
    await expect(tabs).toHaveText([/^Resumen/u, /^Datos/u, /^Discografía/u, /^Imágenes/u, /^Dudas/u]);
    await expect(region.getByRole("tab", { name: /^Resumen/u })).toHaveAttribute("aria-selected", "true");
    await expect(region.getByText("propone lo que está documentado y deja como dudas", { exact: false })).toBeVisible();
    const next = region.getByRole("list").filter({ hasText: "Siguientes pasos" }).or(region.locator(".record-complete__next"));
    await expect(next.getByRole("button")).toHaveText([
      "Decide 2 cambios documentados en Datos.", "Decide 1 cambio documentado en Discografía.", "Elige imagen en 2 fichas (Imágenes).",
      "Revisa 1 cambio que requiere tu criterio: falta respaldo o se parece a otra ficha.", "Consulta 2 dudas sin resolver con lo que falta para resolverlas.",
    ]);
    // Paso siguiente → sección, con la URL y el foco en la pestaña.
    await next.getByRole("button", { name: "Decide 2 cambios documentados en Datos." }).click();
    await expect(region.getByRole("tab", { name: /^Datos/u })).toHaveAttribute("aria-selected", "true");
    await expect(region.getByRole("tab", { name: /^Datos/u })).toBeFocused();
    expect(new URL(page.url()).searchParams.get("completar")).toBe("datos");
    // Teclado: flechas, Inicio, Fin.
    await page.keyboard.press("ArrowRight");
    await expect(region.getByRole("tab", { name: /^Discografía/u })).toBeFocused();
    expect(new URL(page.url()).searchParams.get("completar")).toBe("discografia");
    await page.keyboard.press("End");
    await expect(region.getByRole("tab", { name: /^Dudas/u })).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("Home");
    expect(new URL(page.url()).searchParams.get("completar")).toBeNull();
    // La sección se conserva al recargar.
    await page.goto(`${WEB}/artistas/58?completar=datos`);
    await expect(region.getByRole("tab", { name: /^Datos/u })).toHaveAttribute("aria-selected", "true");
    const own = region.getByRole("region", { name: "Caramelos De Cianuro (esta ficha)" });
    await expect(own.getByText("3 por decidir")).toBeVisible();
    await expect(own.locator(".record-complete__state--judgement")).toHaveText("Requiere tu criterio");
    // Aceptar en grupo exige dos pasos y no toca lo que requiere criterio.
    await own.getByRole("button", { name: "Aceptar los 2 documentados…" }).click();
    expect(calls.decisions).toEqual([]);
    const confirm = own.getByRole("group", { name: "Confirmar aceptación del grupo" });
    await expect(confirm.getByRole("listitem")).toHaveCount(2);
    await confirm.getByRole("button", { name: "Cancelar" }).click();
    await expect(confirm).toHaveCount(0);
    expect(calls.decisions).toEqual([]);
    await own.getByRole("button", { name: "Aceptar los 2 documentados…" }).click();
    await own.getByRole("button", { name: "Confirmar y aplicar 2" }).click();
    await expect(page.getByText("2 cambios aplicados. Cada uno se puede deshacer por separado.")).toBeVisible();
    expect(calls.decisions).toEqual([{ key: "ska", decision: "accepted" }, { key: "ig", decision: "accepted" }]);
    await expect(own.getByText("1 por decidir · 2 decididos")).toBeVisible();
    // Lo que requiere criterio se rechaza por separado y el dato se conserva.
    await own.getByRole("article", { name: /Maracay/u }).getByRole("button", { name: "No", exact: true }).click();
    await expect(page.getByText("Propuesta rechazada. El dato se conserva.")).toBeVisible();
    expect(calls.decisions.at(-1)).toEqual({ key: "ciudad", decision: "rejected" });
    await expect(own.getByText("Todo decidido · 3 decididos")).toBeVisible();
    // Discografía: un cambio por separado y su «Deshacer» abre el diálogo de deshacer.
    await region.getByRole("tab", { name: /^Discografía/u }).click();
    const album = region.getByRole("region", { name: "Las Paticas De La Abuela" });
    await expect(album.getByRole("heading", { level: 4 }).getByRole("link")).toHaveAttribute("href", "/discos/57");
    await album.getByRole("button", { name: "Sí, aceptar" }).click();
    await expect(page.getByText("Cambio aplicado.", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Deshacer", exact: true }).first().click();
    await expect(page.getByRole("dialog", { name: "Deshacer cambio" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "Deshacer cambio" })).toHaveCount(0);
    // Imágenes: la ficha y la portada de su disco, sin salir; la decisión va a la cola compartida.
    await region.getByRole("tab", { name: /^Imágenes/u }).click();
    await expect(region.getByRole("article")).toHaveCount(2);
    await region.getByRole("article", { name: "Las Paticas De La Abuela" }).getByRole("button", { name: "Usar esta" }).click();
    await expect.poll(() => calls.imageTasks.length).toBe(1);
    expect(calls.imageTasks[0]).toMatchObject({ type: "decision", kind: "album", entityId: 57, candidateId: 3 });
    await expect(region.getByRole("article")).toHaveCount(1);
    // Dudas: lo que falta y lo bloqueado, sin botones de aplicar.
    await region.getByRole("tab", { name: /^Dudas/u }).click();
    const panel = region.getByRole("tabpanel");
    await expect(panel.getByText("La fecha de fundación no aparece en ninguna fuente consultada.")).toBeVisible();
    await expect(panel.getByText("La pista #999999 ya no existe.", { exact: false })).toBeVisible();
    await expect(panel.getByRole("button", { name: /aceptar|aplicar/iu })).toHaveCount(0);
    // Herramientas avanzadas plegadas: fiabilidad y la curaduría con IA completa.
    await region.getByText("Fiabilidad, comparación e investigaciones anteriores", { exact: true }).click();
    await expect(region.getByRole("heading", { name: "Fiabilidad de la ficha" })).toBeVisible();
    await expect(region.getByRole("link", { name: /^Pedir otro cambio con IA/u })).toHaveAttribute("href", "/curaduria/ia?kind=artist&id=58");
    expect(calls.starts).toBe(0);
    expect(errors).toEqual([]);
    // Decide data, discography, a cover and undo without leaving the record: zero module changes.
    expect(modules).toEqual(["/artistas/58"]);
    results.push(`1440 px: recorrido completo; ${calls.decisions.length} decisiones explícitas, 0 consultas a la IA, módulos visitados: ${modules.join(" → ")} (0 cambios de módulo); lecturas protegidas vaciadas: ${[...calls.unauthorized].join(", ") || "ninguna"}.`);
    await page.close();
  }
  // 2. Anchos 320–1440, con 360 y 720 = ventana de 1440 px al 400 % y al 200 % de zoom, y contenido largo
  //    (URL sin espacios, etiqueta y duda extensas): sin desplazamiento lateral, objetivos táctiles y nombres accesibles.
  for (const width of [320, 360, 390, 720, 768, 1440]) {
    const calls: Calls = { decisions: [], starts: 0, imageTasks: [], unauthorized: new Set() };
    const state = { plan: withLongContent(structuredClone(fixture)) };
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await open(page, calls, state);
    for (const section of ["resumen", "datos", "discografia", "imagenes", "dudas"]) {
      await page.goto(`${WEB}/artistas/58${section === "resumen" ? "" : `?completar=${section}`}`);
      const region = page.getByRole("region", { name: "Completar la ficha" });
      await expect(region.getByRole("tabpanel")).toBeVisible({ timeout: 20000 });
      await page.waitForTimeout(300);
      const audit = await page.evaluate(() => {
        const root = document.querySelector(".record-complete")!;
        const overflow = document.documentElement.scrollWidth > innerWidth + 1;
        const unnamed = [...root.querySelectorAll("button, a[href], [role=tab], summary")].filter((el) => {
          const name = (el.getAttribute("aria-label") ?? el.textContent ?? "").trim();
          return !name && el.checkVisibility();
        }).map((el) => el.outerHTML.slice(0, 80));
        const small = [...root.querySelectorAll("[role=tab]")].filter((el) => el.getBoundingClientRect().height < 44).length;
        const ids = [...document.querySelectorAll("[id]")].map((el) => el.id);
        const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
        const tab = root.querySelector("[role=tab][aria-selected=true]")!;
        const controlled = document.getElementById(tab.getAttribute("aria-controls")!);
        const wide = [...root.querySelectorAll("*")].filter((el) => el.getBoundingClientRect().right > innerWidth + 1 && !el.closest(".record-complete__tabs")).map((el) => `${el.tagName.toLowerCase()}.${el.className}«${(el.textContent ?? "").slice(0, 40)}»<${el.parentElement?.className}`).slice(0, 4);
        return { overflow, unnamed, small, duplicates, controlled: controlled?.getAttribute("role"), wide };
      });
      expect(audit, `${width}px ${section}`).toEqual({ overflow: false, unnamed: [], small: 0, duplicates: [], controlled: "tabpanel", wide: [] });
      await region.screenshot({ path: `${OUT}-${width}-${section}.png` });
    }
    expect(errors).toEqual([]);
    results.push(`${width} px${width === 720 ? " (1440 al 200 %)" : width === 360 ? " (1440 al 400 %)" : ""}: 5 secciones con contenido largo sin desplazamiento lateral, pestañas ≥44 px, controles con nombre, ids únicos.`);
    await page.close();
  }
  console.log(results.join("\n"));
} finally { await browser.close(); }
