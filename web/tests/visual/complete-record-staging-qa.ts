// Plan 20/20, etapa 4 · «Completar la ficha» de punta a punta sobre una COPIA de la base.
// API desechable (sin IA ni red) en 127.0.0.1:8091 contra el contenedor crv-staging-e4,
// Vite en 127.0.0.1:5176. Cada decisión se comprueba en la copia, nunca en la base de desarrollo.
//   QA_PASSWORD=… npx tsx tests/visual/complete-record-staging-qa.ts
import { execFileSync } from "node:child_process";
import { chromium, expect, type Locator, type Page } from "@playwright/test";

const WEB = "http://127.0.0.1:5176", API = "http://127.0.0.1:8091";
const OUT = process.env.QA_OUT ?? "/tmp/crv-complete-staging";
const sql = (query: string) => execFileSync("docker", ["exec", "crv-staging-e4", "psql", "-U", "crv", "-d", "crv", "-tAc", query], { encoding: "utf8" }).trim();
if (!sql("SELECT current_database()").includes("crv") || execFileSync("docker", ["port", "crv-staging-e4"], { encoding: "utf8" }).indexOf("55499") < 0)
  throw new Error("No es la copia crv-staging-e4");

const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
const log: string[] = [];
const decision = (key: string) => sql(`SELECT coalesce(decisions->'${key}'->>'decision','') FROM ingest.ai_curation_plans WHERE id=86`);
const runOf = (key: string) => Number(sql(`SELECT decisions->'${key}'->>'runId' FROM ingest.ai_curation_plans WHERE id=86`));
const APPLIED = "SELECT count(*) FROM ingest.ai_curation_plans p, jsonb_each(p.decisions) d WHERE p.id=86 AND d.value->>'runId' IS NOT NULL";
const card = (scope: Locator, text: string) => scope.locator("article.ai-proposal").and(scope.page().getByRole("article", { name: text }));
async function login(page: Page): Promise<string> {
  const response = await page.request.post(`${API}/auth/login`, { data: { username: "qa-staging", password: process.env.QA_PASSWORD }, headers: { origin: WEB } });
  expect(response.status()).toBe(200);
  return ((await response.json()) as { csrf: string }).csrf;
}
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const csrf = await login(page);
  // A previous run on this copy is undone through the API (newest first); rejections wrote nothing.
  const decisionsOf = async () => ((await (await page.request.get(`${API}/curation/ai/plans/86`)).json()) as { decisions: Record<string, { runId: number | null; undone?: boolean }> }).decisions ?? {};
  for (const runId of Object.values(await decisionsOf()).filter((d) => d.runId && !d.undone).map((d) => d.runId!).sort((a, b) => b - a)) {
    const undone = await page.request.post(`${API}/changes/${runId}/undo`, { data: { note: "Restaurar la copia antes de repetir la prueba de la ficha" }, headers: { origin: WEB, "x-crv-csrf": csrf } });
    expect(undone.status(), `deshacer ${runId}`).toBe(200);
  }
  sql("UPDATE ingest.ai_curation_plans SET decisions='{}'::jsonb, revision=revision+1 WHERE id=86");
  const t0 = Date.now(); const timings: string[] = [];
  const timed = async (label: string, action: () => Promise<void>) => { const t = Date.now(); await action(); timings.push(`${label} ${((Date.now() - t) / 1000).toFixed(1)} s`); };
  const modules: string[] = [];
  page.on("framenavigated", (frame) => { if (frame === page.mainFrame()) { const path = new URL(frame.url()).pathname; if (modules.at(-1) !== path) modules.push(path); } });

  // ── Caramelos De Cianuro (plan 86) ──
  await page.goto(`${WEB}/artistas/58`);
  const region = page.getByRole("region", { name: "Completar la ficha" });
  await expect(region.getByRole("button", { name: "Actualizar con la ficha actual" })).toBeVisible({ timeout: 30000 });
  await region.getByRole("button", { name: "Actualizar con la ficha actual" }).click();
  await expect(region.getByRole("tabpanel")).toHaveAttribute("aria-busy", "false", { timeout: 120000 });
  await region.getByRole("tab", { name: /^Datos/u }).click();
  const own = region.getByRole("region", { name: "Caramelos De Cianuro (esta ficha)" });
  await expect(own).toBeVisible();

  // Wrong proposals are rejected one by one; the catalog does not change.
  const aliasesBefore = sql("SELECT count(*) FROM ingest.artist_aliases WHERE artist_id=58");
  await timed("rechazar", async () => {
    await card(own, "Asier Cazalis").getByRole("button", { name: "No", exact: true }).click();
    await expect(page.getByText("Propuesta rechazada. El dato se conserva.").first()).toBeVisible({ timeout: 60000 });
  });
  await expect.poll(() => decision("t5c1422d772068dd3_alias-asier-cazalis"), { timeout: 60000 }).toBe("rejected");
  await card(own, "Actualizar imagen del artista desde la fuente").getByRole("button", { name: "No", exact: true }).click();
  await expect.poll(() => decision("td8a70c492f018819_replacePicture"), { timeout: 60000 }).toBe("rejected");
  expect(sql("SELECT count(*) FROM ingest.artist_aliases WHERE artist_id=58")).toBe(aliasesBefore);
  expect(sql("SELECT picture_url FROM public.artists WHERE id=58")).toBe("/crv/media/artist/58.jpg");
  log.push("Rechazos: alias «Asier Cazalis» (integrante) y foto externa; alias y foto intactos en la copia.");

  // One documented proposal: Apple Music.
  await timed("aceptar uno", async () => {
    await card(own, "music.apple.com").getByRole("button", { name: "Sí, aceptar" }).click();
    await expect(page.getByText("Cambio aplicado.", { exact: true }).first()).toBeVisible({ timeout: 60000 });
  });
  expect(sql("SELECT count(*) FROM public.social_links WHERE artist_id=58 AND url LIKE '%74344267%'")).toBe("1");
  const appleRun = runOf("tfc573103654cdaae_apple-music-link");
  expect(appleRun).toBeGreaterThan(0);
  log.push(`Aceptar uno: Apple Music en social_links (run ${appleRun}).`);

  // A coherent set, with an explicit two-step confirmation.
  const groupButton = own.getByRole("button", { name: /^Aceptar los \d+ documentados…$/u });
  const n = Number((await groupButton.textContent())!.match(/\d+/u)![0]);
  await groupButton.click();
  const confirm = own.getByRole("group", { name: "Confirmar aceptación del grupo" });
  await expect(confirm.getByRole("listitem")).toHaveCount(n);
  const listed = await confirm.getByRole("listitem").allTextContents();
  const appliedBefore = Number(sql(APPLIED));
  await confirm.getByRole("button", { name: `Confirmar y aplicar ${n}` }).click();
  await expect(page.getByText(`${n} cambios aplicados. Cada uno se puede deshacer por separado.`)).toBeVisible({ timeout: 120000 });
  expect(Number(sql(APPLIED)) - appliedBefore).toBe(n);
  expect(Number(sql("SELECT count(DISTINCT (d.value->>'runId')) FROM ingest.ai_curation_plans p, jsonb_each(p.decisions) d WHERE p.id=86 AND d.value->>'runId' IS NOT NULL"))).toBe(Number(sql(APPLIED)));
  expect(Number(sql(`SELECT count(*) FROM ingest.scrape_runs WHERE id IN (SELECT (d.value->>'runId')::bigint FROM ingest.ai_curation_plans p, jsonb_each(p.decisions) d WHERE p.id=86 AND d.value->>'runId' IS NOT NULL)`))).toBe(Number(sql(APPLIED)));
  if (listed.some((label) => /1989-presente/u.test(label))) expect(sql("SELECT years_active FROM public.artists WHERE id=58")).toBe("1989-presente");
  log.push(`Aceptar en grupo con confirmación: ${n} cambios (${listed.join("; ")}), cada uno con su propio run en la copia.`);

  // Relations: reject the contradictory end, accept Pablo Martínez's end, then undo it.
  const relations = region;
  await card(relations, "Corregir fin de Luis Golding").getByRole("button", { name: "No", exact: true }).click();
  await expect.poll(() => decision("tfd58a60358adc52e_golding_until"), { timeout: 60000 }).toBe("rejected");
  expect(sql("SELECT to_year FROM public.artist_members WHERE id=12853")).toBe("1994");
  await card(relations, "Añadir fin de Pablo Martínez").getByRole("button", { name: "Sí, aceptar" }).click();
  await expect.poll(() => sql("SELECT to_year FROM public.artist_members WHERE id=506"), { timeout: 30000 }).toBe("1998");
  const pabloRun = runOf("tfd58a60358adc52e_pablo_until");
  // The decided card moves to its group's «Decididos» list, where it keeps its own undo.
  const closed = region.locator("details.record-complete__decided:not([open]) > summary");
  while (await closed.count()) await closed.first().click();
  const pablo = card(region, "Añadir fin de Pablo Martínez");
  await pablo.getByRole("button", { name: "Deshacer", exact: true }).click();
  const undo = page.getByRole("dialog", { name: /^Deshacer/u });
  await expect(undo).toBeVisible();
  await undo.getByPlaceholder("Por qué se deshace").fill("Prueba de deshacer desde la ficha (copia de staging)");
  await undo.getByRole("button", { name: "Deshacer este cambio" }).click();
  await expect(page.getByText("Cambio deshecho.", { exact: true })).toBeVisible({ timeout: 30000 });
  await expect.poll(() => sql("SELECT coalesce(to_year::text,'null') FROM public.artist_members WHERE id=506")).toBe("null");
  await expect.poll(async () => (await decisionsOf())["tfd58a60358adc52e_pablo_until"]?.undone).toBe(true);
  await expect(pablo).toContainText("Deshecho");
  log.push(`Rechazar el fin contradictorio de Golding (12853 sigue en 1994); aceptar el fin de Pablo Martínez (run ${pabloRun}) y deshacerlo: to_year vuelve a vacío y la decisión queda deshecha.`);
  await region.screenshot({ path: `${OUT}-datos.png` });

  // Images: a cover from the record's own discography, through the shared queue.
  await region.getByRole("tab", { name: /^Imágenes/u }).click();
  const pick = region.locator("article[data-entity-key^=\"album:\"]").filter({ has: page.getByRole("button", { name: "Usar esta" }) }).first();
  const albumName = await pick.getAttribute("aria-label");
  const albumId = Number((await pick.getAttribute("data-entity-key"))!.split(":")[1]);
  const before = sql(`SELECT coalesce(cover_url,'') FROM public.albums WHERE id=${albumId}`);
  await pick.getByRole("button", { name: "Usar esta" }).first().click();
  await expect.poll(() => sql(`SELECT count(*) FROM ingest.image_candidates WHERE album_id=${albumId} AND status='chosen' AND decided_at > now() - interval '10 minutes'`), { timeout: 120000 }).toBe("1");
  const after = sql(`SELECT coalesce(cover_url,'') FROM public.albums WHERE id=${albumId}`);
  expect(after).not.toBe(before);
  log.push(`Imagen: portada elegida para «${albumName}» (#${albumId}) desde la ficha del artista; cover_url cambió en la copia.`);
  await region.screenshot({ path: `${OUT}-imagenes.png` });

  // ── Apache (plan 85): the repeated records ask for judgement ──
  await page.goto(`${WEB}/artistas/1681?completar=datos`);
  await expect(region.getByRole("button", { name: "Actualizar con la ficha actual" })).toBeVisible({ timeout: 30000 });
  await region.getByRole("button", { name: "Actualizar con la ficha actual" }).click();
  await expect(region.getByRole("tabpanel")).toHaveAttribute("aria-busy", "false", { timeout: 180000 });
  await expect(region.getByText("probablemente ya existe: artista «Cuarto Poder» (#1905)", { exact: false }).first()).toBeVisible({ timeout: 30000 });
  await expect(region.getByText("otra propuesta registra este nombre real en la persona", { exact: false })).toBeVisible();
  const judgement = await region.locator(".record-complete__state--judgement").count();
  expect(judgement).toBeGreaterThanOrEqual(3);
  log.push(`Apache: tras actualizar, ${judgement} propuestas «Requiere tu criterio», entre ellas las altas repetidas de Cuarto Poder y de Larry Rada.`);
  await region.screenshot({ path: `${OUT}-apache.png` });

  expect(errors).toEqual([]);
  log.push(`Tiempos: ${timings.join(" · ")} · total ${((Date.now() - t0) / 1000).toFixed(0)} s.`);
  log.push(`Módulos visitados: ${modules.join(" → ")} (el cambio de módulo es solo de una ficha a la otra).`);
  console.log(log.join("\n"));
} catch (error) {
  for (const context of browser.contexts()) for (const open of context.pages()) await open.screenshot({ path: `${OUT}-fallo.png`, fullPage: true }).catch(() => undefined);
  throw error;
} finally { await browser.close(); }
