// Verificación reproducible con API/WS simulados; no escribe en PostgreSQL.
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { chromium, type WebSocketRoute } from "playwright";
import { expect } from "@playwright/test";
import { NOX_PRODUCTS } from "../../../src/chat/nox";
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
  let socket: WebSocketRoute;
  const equipped: Record<string, string | null> = { name: "nox-blood-name", bubble: "nox-blood-bubble", frame: "nox-blood-frame", background: null, ambient: null, name_font: null, badge: null };
  const actor = { id: "qa-editor", handle: "editor", displayName: "Coleccionista", avatarSeed: "qa", isBot: false, equipped };
  const room = { id: 1, slug: "general", name: "La Rockola", description: "", slowModeSeconds: 0, theme: {} };
  let effects = NOX_PRODUCTS.map(ref => ({ ...ref, enabled: true, owned: true, equipped: Object.values(equipped).includes(ref.code) }));
  const writes: Array<{ priceCoins: number; manifest: { nox: { preset: string; bloodfall: string } } }> = [];
  await page.route(/\/curation\//, (route) => route.fulfill({ json: { jobs: [], items: [], queued: 0, running: 0 } }));
  await page.routeWebSocket(/\/chat\/ws\?/, (opened) => { socket = opened; socket.send(JSON.stringify({ type: "snapshot", actor, room, me: { coins: 100, credits: 10 }, users: [actor], effects, messages: [1, 2].map((id) => ({ id, roomId: 1, actorId: actor.id, handle: actor.handle, displayName: actor.displayName, kind: "chat", body: `Mensaje ${id}`, effectCode: null, createdAt: new Date().toISOString(), equipped })) })); });
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
    if (path.endsWith("/chat/equip")) {
      const body = route.request().postDataJSON(); equipped[body.slot] = body.code;
      effects = effects.map(effect => ({ ...effect, equipped: Object.values(equipped).includes(effect.code) }));
      socket.send(JSON.stringify({ type: "equipped", actorId: actor.id, equipped }));
      return route.fulfill({ json: { equipped, effects } });
    }
    if (path.endsWith("/chat/inventory")) return route.fulfill({ json: { inventory: [] } });
    if (path.endsWith("/chat/rooms")) return route.fulfill({ json: { rooms: [room] } });
    if (path.endsWith("/messages")) return route.fulfill({ json: { messages: [] } });
    return route.fulfill({ status: 404, json: { error: { code: "qa_unhandled", message: path } } });
  });
  await page.goto("http://127.0.0.1:5173/chat");
  await expect(page.locator(".chat-message .nox-bloodfall").first()).toBeVisible();
  await expect(page.locator(".chat-message .nox-bubble.nox-blood").first()).toBeVisible();
  const bounds = await page.locator(".chat-message").first().evaluate(row => {
    const name = row.querySelector(".nox-bloodfall")!.getBoundingClientRect();
    const message = row.querySelector(".nox-bubble")!.getBoundingClientRect();
    return { nameBottom: name.bottom, messageTop: message.top, overflow: document.documentElement.scrollWidth > innerWidth };
  });
  assert(bounds.nameBottom <= bounds.messageTop, "El goteo no invade el mensaje");
  assert.equal(bounds.overflow, false);
  await page.getByRole("button", { name: "Tienda de efectos", exact: true }).click();
  await page.getByRole("button", { name: "Burbujas", exact: true }).click();
  await expect(page.locator(".chat-effect-card")).toHaveCount(11);
  await page.locator(".chat-effect-card").filter({ has: page.locator(".chat-effect-name", { hasText: "Frostbite" }) }).click();
  await expect(page.locator(".crv-probador .nox-bubble.nox-ice")).toBeVisible();
  await page.getByRole("button", { name: "Equipar", exact: true }).click();
  await expect(page.getByRole("button", { name: "Quitar", exact: true })).toBeVisible();
  assert.equal(equipped.bubble, "nox-ice-bubble");
  assert.equal(equipped.name, "nox-blood-name");
  assert.equal(equipped.frame, "nox-blood-frame");
  await page.screenshot({ path: `${output}/shop-${viewport.width}.png` });
  await page.getByRole("button", { name: "Abrir editor de estilos", exact: true }).click();
  await page.getByLabel("Colección NOX · 33 variantes", { exact: true }).selectOption("nox-blood-name");
  await page.getByLabel("Versión de Bloodfall", { exact: true }).selectOption("classic");
  await expect(page.locator(".name-editor .nox-blood-drip")).toHaveCount(5);
  await page.getByLabel("Versión de Bloodfall", { exact: true }).selectOption("enhanced");
  await expect(page.locator(".name-editor .nox-bloodfall")).toBeVisible();
  await page.getByLabel("Precio en monedas", { exact: true }).fill("950");
  await page.getByRole("button", { name: "Guardar cambios", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Guardado. El estilo" })).toBeVisible();
  assert.equal(writes[0]!.priceCoins, 950);
  assert.deepEqual(writes[0]!.manifest.nox, { preset: "blood", bloodfall: "enhanced" });
  await page.getByRole("button", { name: "Pausar animación", exact: true }).click();
  await expect(page.locator(".name-editor .nox-still")).toBeVisible();
  assert.deepEqual(errors, []);
  results.push({ viewport, writes, bounds });
  await context.close();
 }
 await writeFile(`${output}/shop-results.json`, JSON.stringify(results, null, 2));
 console.log("NOX tienda/editor: 33 recetas, 11 burbujas, equipamiento independiente, guardado y pausa, móvil/escritorio OK");
} finally { await browser.close(); }
