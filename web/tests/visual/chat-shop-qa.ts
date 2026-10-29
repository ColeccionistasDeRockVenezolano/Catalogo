// Verifica la tienda y la regresión del scroll en un navegador ya abierto por agent-browser.
// Todas las escrituras y eventos son fixtures; nunca envía mensajes a la sala real.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium, type WebSocketRoute } from "playwright";
import { expect } from "@playwright/test";
import { NAME_STYLE_REFERENCES } from "../../../src/chat/name-style";
import { dailyCycleAt } from "../../../src/shared/daily-cycle";

const endpoint = process.env["CRV_QA_CDP"];
const output = process.env["CRV_QA_OUT"];
assert(endpoint && output, "Fija CRV_QA_CDP y CRV_QA_OUT (staging SSD)");
await mkdir(output, { recursive: true });
const browser = await chromium.connectOverCDP(endpoint);
const base = process.env["CRV_QA_URL"] ?? "http://localhost:5173/chat";
const results: Record<string, unknown> = { fixture: true, viewports: [], checks: [] };
const checks = results["checks"] as string[];

async function setup(viewport: { width: number; height: number }, quality: "normal" | "low" | "reduced" = "normal") {
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
  const equipped = { name: null as string | null, frame: null as string | null, background: null as string | null, ambient: null as string | null, badge: null as string | null, name_font: null as string | null };
  const actor = { id: "00000000-0000-4000-8000-000000000003", handle: "ensayo", displayName: "Nina Discos", avatarSeed: "nina", isBot: false, equipped };
  const owned = new Set<string>();
  const expiry = null;
  const wallet = { coins: 800, credits: 100 };
  let purchases = 0;
  const sent: Array<Record<string, unknown>> = [];
  const effects = () => Array.from({ length: 30 }, (_, index) => {
    const reference = NAME_STYLE_REFERENCES[index % NAME_STYLE_REFERENCES.length]!;
    return { code: `shop-fixture-${index}`, name: `${reference.name} ${index + 1}`, kind: "name", description: "Producto de prueba para verificar el catálogo y el scroll.", priceCoins: 20 + index * 10, priceCredits: 5, durationDays: null, manifest: { version: 1, triggers: ["always"], layers: [], nameStyle: reference.style, cost: 2, reducedMotion: "static" } };
  }).map((effect) => ({ ...effect, owned: owned.has(effect.code), equipped: Object.values(equipped).includes(effect.code) }));
  const room = { id: 1, slug: "general", name: "La Rockola", description: "", slowModeSeconds: 0, theme: {} };
  const message = (id: number, body: string, effectCode: string | null = null, kind = "chat") => ({ id, roomId: 1, actorId: actor.id, handle: actor.handle, displayName: actor.displayName, kind, body, effectCode, createdAt: new Date().toISOString(), equipped: { ...equipped } });
  const history = Array.from({ length: 32 }, (_, index) => message(index + 1, `Escuchando el archivo ${index + 1}`, null));
  const snapshot = () => ({ type: "snapshot", room, actor, me: wallet, users: [actor], messages: history, effects: effects() });
  let wire: WebSocketRoute | undefined;
  await page.routeWebSocket(/\/chat\/ws\?/, (socket) => {
    wire = socket;
    socket.send(JSON.stringify(snapshot()));
    socket.onMessage((data) => {
      const event = JSON.parse(String(data)) as Record<string, unknown>;
      sent.push(event);
      if (event["type"] === "message" || event["type"] === "action") socket.send(JSON.stringify({
        type: "message", message: message(100 + sent.length, String(event["body"] ?? event["code"]), String(event["effectCode"] ?? event["code"] ?? "") || null, event["type"] === "action" ? "action" : event["effectCode"] === "vinilo-sticker" ? "sticker" : "chat"),
      }));
    });
  });
  await page.route((url) => /^\/(?:api\/)?chat\//u.test(url.pathname) && !url.pathname.endsWith("/ws"), async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace(/^\/api/, "");
    let body: unknown;
    if (path === "/chat/session") body = { actor, wallet, token: "fixture-only-no-server-token" };
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
  await expect(page.getByText("Nina Discos", { exact: true }).first()).toBeVisible();
  await expect(page.locator(".chat-room")).toContainText("1 en línea");
  return { context, page, errors, owned, effects, actor, purchases: () => purchases, sent, emit: (event: unknown) => wire!.send(JSON.stringify(event)), snapshot, message };
}

// Fixtures locales: ninguna compra o cambio se envía al servidor.
for (const width of [390, 768, 1440]) {
  const run = await setup({ width, height: 900 });
  try {
    const { page } = run;
    await page.getByRole("button", { name: "Tienda de efectos", exact: true }).click();
    const catalog = page.getByRole("region", { name: "Catálogo de la tienda" });
    const cards = page.locator(".chat-effect-card");
    await expect(cards).toHaveCount(30);
    await cards.nth(15).scrollIntoViewIfNeeded();
    const before = await catalog.evaluate((element) => element.scrollTop);
    assert(before > 0);
    await cards.nth(15).click();
    await expect(cards.nth(15)).toHaveAttribute("aria-pressed", "true");
    const after = await catalog.evaluate((element) => element.scrollTop);
    assert.equal(after, before, "Probar conserva exactamente el scroll del catálogo");
    await expect(page.locator(".crv-probador-tag")).toContainText("Probando");
    assert.equal(run.purchases(), 0);
    await expect(page.locator(".crv-probador")).toBeInViewport();
    await page.getByRole("button", { name: "Dejar de probar" }).click();
    assert.equal(await catalog.evaluate((element) => element.scrollTop), before, "Cerrar detalles conserva el scroll");
    await cards.nth(15).click();
    await page.getByRole("button", { name: /Comprar por/ }).click();
    await expect(page.getByText("Compra completada.", { exact: true })).toBeVisible();
    assert.equal(run.purchases(), 1);
    await page.getByRole("button", { name: "Equipar", exact: true }).click();
    await expect(page.getByRole("button", { name: "Quitar", exact: true })).toBeVisible();
    await catalog.evaluate((element) => { element.scrollTop = 0; });
    await page.screenshot({ path: `${output}/shop-${width}.png` });
    const overflow = await page.locator(".chat-sheet-shop").evaluate((element) => element.scrollWidth > element.clientWidth);
    assert.equal(overflow, false, "La tienda no tiene desbordamiento horizontal");
    await page.getByRole("button", { name: "Placas", exact: true }).click();
    await expect(page.getByText("Pronto habrá productos en esta categoría.")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("button", { name: "Tienda de efectos", exact: true })).toBeFocused();
    assert.deepEqual(run.errors, []);
    checks.push(`${width}px: scroll estable, probador visible, comprar, equipar, estado vacío y Escape`);
  } finally { await run.context.close(); }
}
await writeFile(`${output}/qa.json`, JSON.stringify(results, null, 2));
console.log(JSON.stringify(results, null, 2));
await browser.close();
