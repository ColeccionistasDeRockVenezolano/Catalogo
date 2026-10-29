// Reproduce UI y rendimiento en un navegador ya abierto por agent-browser.
// Todas las escrituras y eventos son fixtures; nunca envía mensajes a la sala real.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium, type Page, type WebSocketRoute } from "playwright";
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
  const equipped = { name: "murcielago", frame: "anillo-fuego", background: "escenario", ambient: "brasas", badge: null as string | null, name_font: null as string | null };
  const actor = { id: "00000000-0000-4000-8000-000000000003", handle: "ensayo", displayName: "Nina Discos", avatarSeed: "nina", isBot: false, equipped };
  const owned = new Set(["murcielago", "anillo-fuego", "escenario", "brasas", "vinilo-sticker", "pogo", "telon"]);
  const expiry = new Date(Date.now() + 29 * 86400_000).toISOString();
  const wallet = { coins: 800, credits: 100 };
  let purchases = 0;
  const sent: Array<Record<string, unknown>> = [];
  const effects = () => EFFECT_CATALOG.map((effect) => ({ ...effect, owned: owned.has(effect.code), equipped: Object.values(equipped).includes(effect.code) }));
  const room = { id: 1, slug: "general", name: "La Rockola", description: "", slowModeSeconds: 0, theme: { background: "escenario", ambient: "brasas" } };
  const message = (id: number, body: string, effectCode: string | null = null, kind = "chat") => ({ id, roomId: 1, actorId: actor.id, handle: actor.handle, displayName: actor.displayName, kind, body, effectCode, createdAt: new Date().toISOString(), equipped: { ...equipped } });
  const history = Array.from({ length: 32 }, (_, index) => message(index + 1, `Escuchando el archivo ${index + 1}`, null));
  history.push(message(33, "pogo", "pogo", "action"));
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

async function measure(page: Page) {
  return page.evaluate(async () => {
    const frames: number[] = []; const tasks: number[] = [];
    const observer = new PerformanceObserver((list) => { for (const entry of list.getEntries()) tasks.push(entry.duration); });
    observer.observe({ type: "longtask" });
    await new Promise<void>((resolve) => {
      let first = 0; let previous = 0;
      const sample = (now: number) => {
        if (!first) first = now;
        if (previous) frames.push(now - previous);
        previous = now;
        if (now - first >= 3000) resolve(); else requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    });
    observer.disconnect();
    const sorted = [...frames].sort((a, b) => a - b);
    const motion = (window as unknown as { __crvMotion: { motionUsage: () => unknown; clockSubscribers: () => number } }).__crvMotion;
    return { fps: +(1000 * frames.length / frames.reduce((sum, value) => sum + value, 0)).toFixed(2), frames: frames.length,
      p95FrameMs: +sorted[Math.floor(sorted.length * .95)]!.toFixed(2), longTasks: tasks.length, maxLongTaskMs: Math.max(0, ...tasks), motion: motion.motionUsage(), renderers: motion.clockSubscribers() };
  });
}

const mobile = await setup({ width: 390, height: 844 });
try {
  const { page } = mobile;
  await expect(page.locator(".crv-scene")).toHaveCount(0); checks.push("El historial no dispara acciones");
  await page.getByRole("button", { name: "Tienda de efectos", exact: true }).click();
  await page.getByRole("button", { name: /Murciélago/ }).click();
  await expect(page.locator(".crv-probador .crv-choreo-bat-orbit.is-live")).toBeVisible();
  assert.equal(mobile.purchases(), 0); checks.push("Probar no compra");
  for (const [label, preset] of [["Murciélago", "bat-orbit"], ["Batería", "drumsticks"], ["Ovni vinilo", "ufo-abduct"], ["Vinilo rodante", "vinyl-roll"], ["Guitarra", "guitar-wave"], ["Rockero", "skull-headbang"], ["Rayo", "lightning"], ["Rockerito", "rockerito"]]) {
    await page.getByRole("button", { name: new RegExp(`^${label} ${label}`) }).click();
    await expect(page.locator(`.crv-probador .crv-choreo-${preset}.is-live`)).toBeVisible();
    await page.waitForFunction(() => document.querySelector(".crv-probador .crv-actor")?.getAnimations().length);
  }
  checks.push("Las ocho coreografías ejecutan WAAPI");
  await page.screenshot({ path: `${output}/mobile-probador.png` });
  const previewPerf = await measure(page);
  await page.getByRole("button", { name: "Fuentes", exact: true }).click();
  const fontCard = page.locator(".chat-effect-card").first(); await fontCard.click();
  await page.getByRole("button", { name: /Comprar por/ }).click();
  await expect(page.getByText("Compra completada.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Equipar", exact: true }).click();
  await expect(page.getByRole("button", { name: "Quitar", exact: true })).toBeVisible();
  checks.push("Comprar, equipar fuente y mostrar alquiler");
  await expect(page.locator(".crv-countdown")).toContainText("quedan");
  await page.getByRole("button", { name: "Equipados", exact: true }).click(); await expect(page.locator(".chat-effect-card")).toHaveCount(1);
  await page.getByRole("button", { name: "Todos", exact: true }).click();
  await page.getByLabel("Ordenar por precio").selectOption("price-asc");
  checks.push("Filtros y orden de precio");
  await page.getByRole("button", { name: "Acciones", exact: true }).click();
  await page.getByRole("button", { name: /Choque de vinilos/ }).click();
  await expect(page.locator(".crv-probador .crv-scene-clash-scene")).toBeVisible();
  await page.screenshot({ path: `${output}/mobile-accion.png` });
  await expect(page.locator(".crv-probador .crv-scene")).toHaveCount(0, { timeout: 3000 });
  await page.getByRole("button", { name: "Reproducir", exact: true }).click();
  await expect(page.locator(".crv-probador .crv-scene")).toHaveCount(1);
  checks.push("Acción en el probador y Reproducir");
  await page.keyboard.press("Escape"); await expect(page.getByRole("dialog", { name: "Efectos" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Tienda de efectos", exact: true })).toBeFocused();
  checks.push("Escape restaura el foco");
  await page.getByRole("button", { name: "Enviar sticker", exact: true }).click();
  await page.getByRole("button", { name: "Enviar Vinilo sticker", exact: true }).click();
  await expect(page.locator(".chat-messages .crv-sticker-art")).toHaveCount(1);
  assert(mobile.sent.some((event) => event["effectCode"] === "vinilo-sticker")); checks.push("Sticker enviado desde la bandeja");
  mobile.emit({ type: "message", message: mobile.message(200, "pogo", "pogo", "action") });
  await expect(page.locator(".crv-scene.is-screen")).toHaveCount(1);
  mobile.emit({ type: "wallet", coins: 700, credits: 100 });
  await expect(page.locator(".crv-scene.is-screen")).toHaveCount(0, { timeout: 3000 });
  mobile.emit(mobile.snapshot()); await expect(page.locator(".crv-scene.is-screen")).toHaveCount(0);
  checks.push("Acción nueva termina y un snapshot no la repite");
  const roomPerf = await measure(page);
  await page.screenshot({ path: `${output}/mobile-sala.png` });
  await expect(page.locator(".chat-messages .crv-choreo.is-live")).toHaveCount(1);
  const animatedBottom = await page.locator(".chat-messages .crv-choreo.is-live").evaluate((element) => element.closest("article,p")?.textContent);
  const usageBottom = await page.evaluate(() => (window as unknown as { __crvMotion: { motionUsage: () => { used: number } } }).__crvMotion.motionUsage());
  await page.locator(".chat-messages").evaluate((element) => { element.scrollTop = 0; });
  await expect.poll(() => page.locator(".chat-messages .crv-name.is-offscreen").count()).toBeGreaterThan(0);
  await expect(page.locator(".chat-messages .chat-message .crv-choreo.is-live")).toHaveCount(1);
  const animatedTop = await page.locator(".chat-messages .crv-choreo.is-live").evaluate((element) => element.closest("article,p")?.textContent);
  assert.notEqual(animatedBottom, animatedTop, "El cupo debe pasar a otro nombre al desplazarse");
  const usageTop = await page.evaluate(() => (window as unknown as { __crvMotion: { motionUsage: () => { used: number } } }).__crvMotion.motionUsage());
  assert(usageTop.used <= 8 && usageBottom.used <= 8); checks.push("El scroll libera y reasigna el presupuesto móvil");
  (results["viewports"] as unknown[]).push({ width: 390, height: 844, previewPerf, roomPerf, usageTop, usageBottom });
  assert.deepEqual(mobile.errors, []);
} finally { await mobile.context.close(); }

for (const quality of ["normal", "low", "reduced"] as const) {
  const run = await setup(quality === "normal" ? { width: 1440, height: 960 } : { width: 390, height: 844 }, quality);
  try {
    await run.page.getByRole("button", { name: "Tienda de efectos", exact: true }).click();
    await run.page.getByRole("button", { name: /Rockerito Rockerito/ }).click();
    const stage = run.page.locator(".crv-probador");
    await expect(stage.locator(`.crv-choreo.is-${quality === "normal" ? "live" : quality === "low" ? "rest" : "soft"}`)).toBeVisible();
    if (quality !== "normal") {
      assert.equal(await stage.locator(".crv-actor").evaluate((element) => element.getAnimations().some((animation) => animation.effect?.getKeyframes().some((frame) => frame["transform"]))), false);
      await expect(run.page.locator(".crv-particle-stage")).toHaveCount(0);
      checks.push(quality === "low" ? "Gama baja estática" : "Movimiento reducido suave, sin desplazamiento ni partículas");
    }
    await run.page.screenshot({ path: `${output}/${quality === "normal" ? "desktop" : quality}-probador.png` });
    assert.deepEqual(run.errors, []);
  } finally { await run.context.close(); }
}
await writeFile(`${output}/qa.json`, JSON.stringify(results, null, 2));
console.log(JSON.stringify(results, null, 2));
await browser.close(); // Desconecta el cliente CDP de Playwright.
