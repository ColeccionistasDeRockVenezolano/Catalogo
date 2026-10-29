// Verificación reproducible con API/WS simulados; no escribe en PostgreSQL.
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { chromium } from "playwright";
import { expect } from "@playwright/test";
import { NAME_STYLE_REFERENCES } from "../../../src/chat/name-style";
import { dailyCycleAt } from "../../../src/shared/daily-cycle";

const endpoint = process.env["CRV_QA_CDP"];
const output = process.env["CRV_QA_OUT"];
assert(endpoint && output, "Fija CRV_QA_CDP y CRV_QA_OUT (staging SSD)");
const browser = await chromium.connectOverCDP(endpoint);
const results: unknown[] = [];
try {
 for (const viewport of [{ width: 1440, height: 960 }, { width: 390, height: 844 }]) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript("window.__name = (fn) => fn");
  const equipped = { name: "loby", frame: null, background: null, ambient: null, name_font: null, badge: null };
  const actor = { id: "qa-editor", handle: "editor", displayName: "Coleccionista", avatarSeed: "qa", isBot: false, equipped };
  const room = { id: 1, slug: "general", name: "La Rockola", description: "", slowModeSeconds: 0, theme: {} };
  let effects = NAME_STYLE_REFERENCES.map((ref) => ({ code: ref.code, name: ref.name, kind: "name", description: "Referencia", manifest: { version: 1, layers: [], nameStyle: ref.style, cost: 2, reducedMotion: "static", triggers: ["always"] }, priceCoins: 25, priceCredits: 2, sort: 100, durationDays: null, enabled: true, owned: true, equipped: ref.code === "loby" }));
  const writes: Array<{ priceCoins: number; manifest: { nameStyle: { rotation: number; gradientAngle: number } } }> = [];
  await page.route(/\/curation\//, (route) => route.fulfill({ json: { jobs: [], items: [], queued: 0, running: 0 } }));
  await page.routeWebSocket(/\/chat\/ws\?/, (socket) => socket.send(JSON.stringify({ type: "snapshot", actor, room, me: { coins: 100, credits: 10 }, users: [actor], effects, messages: [1, 2].map((id) => ({ id, roomId: 1, actorId: actor.id, handle: actor.handle, displayName: actor.displayName, kind: "chat", body: `Mensaje ${id}`, effectCode: null, createdAt: new Date().toISOString(), equipped })) })));
  await page.route(/\/(?:api\/)?auth\/me(?:\?.*)?$/, (route) => route.fulfill({ json: { user: { username: "qa", name: "QA", role: "admin" }, csrf: "qa-csrf" } }));
  await page.route((url) => /^\/(?:crv\/)?(?:api\/)?chat\//u.test(url.pathname), async (route) => {
    const path = new URL(route.request().url()).pathname.replace(/^\/(?:crv\/)?(?:api\/)?/, "/");
    if (path.endsWith("/chat/session")) return route.fulfill({ json: { actor, wallet: { coins: 100, credits: 10 }, token: "qa" } });
    if (path.endsWith("/chat/daily-cover")) return route.fulfill({ json: { dailyCycle: dailyCycleAt(), coverUrl: null } });
    if (path.endsWith("/chat/admin/effects") && route.request().method() === "POST") {
      const body = route.request().postDataJSON(); writes.push(body);
      effects = effects.map((effect) => effect.code === body.code ? { ...effect, ...body } : effect);
      return route.fulfill({ json: { ok: true, code: body.code } });
    }
    if (path.endsWith("/chat/admin/effects") || path.endsWith("/chat/effects")) return route.fulfill({ json: { effects: path.endsWith("/admin/effects") ? effects : effects.filter((effect) => effect.enabled) } });
    if (path.endsWith("/chat/inventory")) return route.fulfill({ json: { inventory: [] } });
    if (path.endsWith("/chat/rooms")) return route.fulfill({ json: { rooms: [room] } });
    if (path.endsWith("/messages")) return route.fulfill({ json: { messages: [] } });
    return route.fulfill({ status: 404, json: { error: { code: "qa_unhandled", message: path } } });
  });
  await page.goto("http://127.0.0.1:5173/chat");
  await expect(page.locator(".chat-message .crv-styled-name").first()).toBeVisible();
  const messageBounds = await page.locator(".chat-message").first().evaluate((element) => {
    const nick = element.querySelector(".crv-styled-name")!.getBoundingClientRect();
    const body = element.querySelector(".chat-bubble > p")!.getBoundingClientRect();
    return { nickBottom: nick.bottom, bodyTop: body.top, rowPadding: getComputedStyle(element).paddingTop };
  });
  assert(messageBounds.nickBottom <= messageBounds.bodyTop, "El nombre tampoco invade el mensaje en el chat real");
  assert.equal(messageBounds.rowPadding, "9px");
  await page.getByRole("button", { name: "Tienda de efectos", exact: true }).click();
  await page.getByRole("button", { name: "Abrir editor de estilos", exact: true }).click();
  await page.getByRole("button", { name: "Bunnita", exact: true }).click();
  await page.getByLabel("Precio en monedas", { exact: true }).fill("175");
  await page.getByLabel("Precio en créditos", { exact: true }).fill("12");
  await page.getByLabel("Giro del nombre (°): grados", { exact: true }).fill("37");
  await page.getByLabel("Ángulo del degradado (°): grados", { exact: true }).fill("271");
  await page.getByLabel("Dirección del movimiento (°): grados", { exact: true }).fill("123");
  await page.getByRole("button", { name: "Guardar cambios", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Guardado. El estilo" })).toBeVisible();
  assert.equal(writes[0]!.priceCoins, 175);
  assert.equal(writes[0]!.manifest.nameStyle.rotation, 37);
  assert.equal(writes[0]!.manifest.nameStyle.gradientAngle, 271);
  await page.getByLabel("Producto existente", { exact: true }).selectOption("loby");
  await page.getByLabel("Producto existente", { exact: true }).selectOption("bunnita");
  await expect(page.getByLabel("Precio en monedas", { exact: true })).toHaveValue("175");
  const bounds = await page.locator(".name-editor-scene").evaluate((scene) => {
    const nick = scene.querySelector(".crv-styled-name")!.getBoundingClientRect();
    const message = scene.querySelector("article p")!.getBoundingClientRect();
    const next = scene.querySelectorAll("article")[1]!.getBoundingClientRect();
    return { nicknameBottom: nick.bottom, messageTop: message.top, nextTop: next.top, overflow: document.documentElement.scrollWidth > innerWidth };
  });
  assert(bounds.nicknameBottom <= bounds.messageTop, "El nombre no invade el mensaje");
  assert.equal(bounds.overflow, false, "Sin desbordamiento horizontal");
  await page.locator(".name-editor").evaluate((element) => element.scrollTop = 0);
  await page.screenshot({ path: `${output}/editor-${viewport.width}.png` });
  // Caso extremo: giro vertical y nombre largo, la siguiente línea queda fuera de su huella.
  await page.getByLabel("Giro del nombre (°): grados", { exact: true }).fill("90");
  await page.getByLabel("Nombre para probar", { exact: true }).fill("Nombre muy largo con espacios");
  await page.getByRole("button", { name: "Pausar animación", exact: true }).click();
  await page.waitForFunction(() => {
    const element = document.querySelector(".name-editor-scene .crv-styled-name");
    return element && element.getBoundingClientRect().height > 200;
  });
  assert.deepEqual(errors, []);
  results.push({ viewport, writes, bounds, messageBounds, errors });
  await context.close();
 }
 await writeFile(`${output}/results.json`, JSON.stringify(results, null, 2));
 console.log("Editor QA: guardar precios y ángulos, recargar, márgenes, escritorio y móvil: OK");
} finally { await browser.close(); }
