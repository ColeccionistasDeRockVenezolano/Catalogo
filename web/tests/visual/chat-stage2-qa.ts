// Reproduce UI y rendimiento en un navegador ya abierto por agent-browser.
// Todas las escrituras y eventos son fixtures; nunca envía mensajes a la sala real.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium, type WebSocketRoute } from "playwright";
import { expect } from "@playwright/test";
import { EFFECT_CATALOG } from "../../../src/chat/effects-catalog";
import { dailyCycleAt } from "../../../src/shared/daily-cycle";

const endpoint = process.env["CRV_QA_CDP"];
const output = process.env["CRV_QA_OUT"];
assert(endpoint && output, "Fija CRV_QA_CDP y CRV_QA_OUT (staging SSD)");
await mkdir(output, { recursive: true });
const browser = await chromium.connectOverCDP(endpoint);
const base = process.env["CRV_QA_URL"] ?? "http://localhost:5173/chat";
const results: Record<string, unknown> = { fixture: true, viewports: [], checks: [] };
const checks = results["checks"] as string[];

async function setup(viewport: { width: number; height: number }, quality: "normal" | "low" | "reduced" = "low", invalidSession = false) {
  const context = await browser.newContext({ viewport, reducedMotion: quality === "reduced" ? "reduce" : "no-preference" });
  const page = await context.newPage();
  // tsx conserva nombres de funciones al serializar callbacks de Playwright.
  await page.addInitScript("window.__name = (fn) => fn");
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(({ memory }) => {
    Object.defineProperty(navigator, "deviceMemory", { get: () => memory });
    Object.defineProperty(navigator, "hardwareConcurrency", { get: () => 8 });
  }, { memory: quality === "low" ? 1 : 8 });
  const equipped = { name: "sangre", frame: "anillo-fuego", background: "escenario", ambient: "brasas", name_font: null as string | null, badge: "murcielago" as string | null };
  const actor = { id: "00000000-0000-4000-8000-000000000003", handle: "ensayo", displayName: "Nina Discos", avatarSeed: "nina", isBot: false, equipped };
  const owned = new Set(["sangre", "murcielago", "anillo-fuego", "escenario", "brasas", "vinilo-sticker", "pogo", "telon"]);
  const expiry = new Date(Date.now() + 29 * 86400_000).toISOString();
  const wallet = { coins: 800, credits: 100 };
  let purchases = 0;
  let sessionCalls = 0;
  let connections = 0;
  let historyCalls = 0;
  const sent: Array<Record<string, unknown>> = [];
  const effects = () => EFFECT_CATALOG.map((effect) => ({ ...effect, owned: owned.has(effect.code), equipped: Object.values(equipped).includes(effect.code) }));
  const room = { id: 1, slug: "general", name: "La Rockola", description: "", slowModeSeconds: 0, theme: { background: "escenario", ambient: "brasas" } };
  const message = (id: number, body: string, effectCode: string | null = null, kind = "chat") => ({ id, roomId: 1, actorId: actor.id, handle: actor.handle, displayName: actor.displayName, kind, body, effectCode, createdAt: new Date().toISOString(), equipped: { ...equipped } });
  const history = Array.from({ length: 50 }, (_, index) => message(index + 51, `Escuchando el archivo ${index + 51}`, null));

  const snapshot = () => ({ type: "snapshot", room, actor, me: wallet, users: [actor], messages: history, effects: effects() });
  let wire: WebSocketRoute | undefined;
  await page.routeWebSocket(/\/chat\/ws\?/, (socket) => {
    connections += 1;
    if (invalidSession) { void socket.close({ code: 4401, reason: "sin sesión" }); return; }
    wire = socket;
    socket.send(JSON.stringify(snapshot()));
    socket.onMessage((data) => {
      const event = JSON.parse(String(data)) as Record<string, unknown>;
      sent.push(event);
      if (event["type"] === "message" || event["type"] === "action") socket.send(JSON.stringify({
        type: "message", message: message(1000 + sent.length, String(event["body"] ?? event["code"]), String(event["effectCode"] ?? event["code"] ?? "") || null, event["type"] === "action" ? "action" : event["effectCode"] === "vinilo-sticker" ? "sticker" : "chat"),
      }));
    });
  });
  await page.route((url) => /^\/(?:api\/)?chat\//u.test(url.pathname) && !url.pathname.endsWith("/ws"), async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace(/^\/api/, "");
    let body: unknown;
    if (path === "/chat/session") { sessionCalls += 1; body = { actor, wallet, token: "fixture-only-no-server-token" }; }
    else if (path === "/chat/rooms/general/messages") {
      historyCalls += 1;
      if (historyCalls === 1) { await route.fulfill({ status: 503, json: { error: { code: "history_unavailable", message: "No se pudo cargar el historial. Vuelve a intentarlo." } } }); return; }
      const before = Number(new URL(request.url()).searchParams.get("before"));
      body = { messages: before === 51 ? Array.from({ length: 50 }, (_, index) => message(index + 1, `Mensaje anterior ${index + 1}`)) : [] };
    }
    else if (path === "/chat/inventory") body = { inventory: [...owned].map((code) => ({ code, expiresAt: expiry })), equipped };
    else if (path === "/chat/effects") body = { effects: effects() };
    else if (path === "/chat/equip") {
      const input = request.postDataJSON() as { slot: keyof typeof equipped; code: string | null };
      Object.assign(equipped, { [input.slot]: input.code }); body = { equipped, effects: effects() };
    } else if (path.endsWith("/buy")) {
      const code = path.split("/").at(-2)!; const effect = effects().find((item) => item.code === code)!;
      purchases += 1; owned.add(code); wallet.coins -= effect.priceCoins;
      body = { wallet, effect, rentedUntil: expiry, effects: effects() };
    } else if (path === "/chat/daily-cover") {
      await route.fulfill({ status: 404, json: { error: { code: "no_cover", message: "Fixture sin portada" } } }); return;
    } else throw new Error(`API de chat sin fixture: ${request.method()} ${path}`);
    await route.fulfill({ json: body });
  });
  await page.route(/\/daily-cycle(?:\?|$)/, (route) => route.fulfill({ json: { ...dailyCycleAt(), serverNow: new Date().toISOString() } }));
  await page.goto(base);
  if (!invalidSession) {
    await expect(page.getByText("Nina Discos", { exact: true }).first()).toBeVisible();
    await expect(page.locator(".chat-room")).toContainText("1 en línea");
  }
  return { context, page, errors, sessionCalls: () => sessionCalls, connections: () => connections, historyCalls: () => historyCalls, owned, effects, actor, purchases: () => purchases, sent, emit: (event: unknown) => wire!.send(JSON.stringify(event)), snapshot, message };
}

for (const viewport of [{ width: 390, height: 844 }, { width: 1440, height: 960 }]) {
  const run = await setup(viewport);
  try {
    const { page } = run;
    const list = page.locator(".chat-messages");
    await expect(list.locator(".chat-message")).toHaveCount(50);
    await list.evaluate((element) => { element.scrollTop = 0; });
    await page.getByRole("button", { name: "Cargar mensajes anteriores", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("Vuelve a intentarlo");
    await page.getByRole("button", { name: "Cargar mensajes anteriores", exact: true }).click();
    await expect(list.locator(".chat-message")).toHaveCount(50);
    await expect(list.locator(".chat-message").first()).toHaveAttribute("data-message-id", "1");
    checks.push(`${viewport.width}: paginación en ventanas de 50 y reintento tras error`);
    await list.evaluate((element) => { element.scrollTop = 0; });
    run.emit({ type: "message", message: run.message(101, "Un mensaje nuevo") });
    await expect(page.getByRole("button", { name: "1 mensaje nuevo", exact: true })).toBeVisible();
    run.emit({ type: "message", message: run.message(102, "Otro mensaje nuevo") });
    run.emit({ type: "message", message: run.message(101, "Un mensaje nuevo") });
    await expect(page.getByRole("button", { name: "2 mensajes nuevos", exact: true })).toBeVisible();
    await expect(list.locator(".chat-message")).toHaveCount(50);
    await page.screenshot({ path: `${output}/${viewport.width}-historial.png` });
    await page.getByRole("button", { name: "2 mensajes nuevos", exact: true }).click();
    await expect(page.getByRole("button", { name: /mensajes nuevos/ })).toHaveCount(0);
    await expect.poll(() => list.evaluate((element) => element.scrollHeight - element.clientHeight - element.scrollTop)).toBeLessThan(3);
    checks.push(`${viewport.width}: mensajes nuevos sin salto ni duplicados y regreso al final`);
    await list.evaluate((element) => { element.scrollTop = 0; });
    await page.getByRole("button", { name: "Cargar mensajes anteriores", exact: true }).click();
    await expect(page.getByRole("button", { name: "Cargar mensajes anteriores", exact: true })).toHaveCount(0);
    checks.push(`${viewport.width}: final del historial`);
    const shop = page.getByRole("button", { name: "Tienda de efectos", exact: true });
    await shop.click();
    const dialog = page.getByRole("dialog", { name: "Efectos" });
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Shift+Tab");
    assert(await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]')));
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0); await expect(shop).toBeFocused();
    checks.push(`${viewport.width}: Tab dentro de la hoja, Escape y foco restaurado`);
    await shop.click();
    await page.getByRole("button", { name: "Fuentes", exact: true }).click();
    await page.locator(".chat-effect-card").first().click();
    await page.getByRole("button", { name: /Comprar por/ }).click();
    await expect(page.getByText("Compra completada.", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Equipar", exact: true }).click();
    await expect(page.getByRole("button", { name: "Quitar", exact: true })).toBeVisible();
    await page.screenshot({ path: `${output}/${viewport.width}-fuente.png` });
    checks.push(`${viewport.width}: compra y equipado de fuente desde tienda`);
    await page.keyboard.press("Escape");
    const input = page.getByPlaceholder("Escribe en La Rockola…");
    await input.fill("Mensaje de prueba de la etapa dos");
    await input.press("Enter");
    await expect(list).toContainText("Mensaje de prueba de la etapa dos");
    assert(run.sent.some((event) => event["body"] === "Mensaje de prueba de la etapa dos"));
    checks.push(`${viewport.width}: envío desde compositor`);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    assert.equal(overflow, false); assert.deepEqual(run.errors, []);
    (results["viewports"] as unknown[]).push({ ...viewport, historyCalls: run.historyCalls(), purchases: run.purchases(), overflow, errors: run.errors });
  } finally { await run.context.close(); }
}
const invalid = await setup({ width: 390, height: 844 }, "low", true);
try {
  await expect.poll(invalid.connections).toBe(2);
  await expect(invalid.page.locator(".chat-room")).toContainText("sin conexión");
  await expect(invalid.page.getByRole("status")).toContainText("Tu sesión no es válida");
  await invalid.page.clock.install(); await invalid.page.clock.fastForward(60_000);
  assert.equal(invalid.connections(), 2); assert.equal(invalid.sessionCalls(), 2);
  checks.push("4401 repetido: una renovación y ningún bucle durante el minuto siguiente");
  assert.deepEqual(invalid.errors, []);
} finally { await invalid.context.close(); }
await writeFile(`${output}/qa.json`, JSON.stringify(results, null, 2));
console.log(JSON.stringify(results, null, 2));
await browser.close();
