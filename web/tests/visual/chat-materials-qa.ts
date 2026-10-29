// Reproduce UI y rendimiento en un navegador ya abierto por agent-browser.
// Todas las escrituras y eventos son fixtures; nunca envía mensajes a la sala real.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium, type Page, type WebSocketRoute } from "playwright";
import { expect } from "@playwright/test";
import { EFFECT_CATALOG } from "../../../src/chat/effects-catalog";
import { dailyCycleAt } from "../../../src/shared/daily-cycle";

type MaterialWindow = Window & { __crvMaterials: { usage: () => { emitters: number; textures: number; canvases: number; pixelRatio: number; throttled: boolean } } };
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

// The same fixture tests real renderers, without purchases or production writes.
const families = [
  ["chidori", "chidori"], ["sello-maldito", "curse-aura"], ["karma-azul", "karma-aura"],
  ["entidad-sombras", "shadow-entity"], ["rainbow-pastel", "pastel-rainbow"], ["sangre-realista", "viscous-blood"],
] as const;
for (const viewport of [{ width: 390, height: 844 }, { width: 1440, height: 960 }]) {
  const run = await setup(viewport);
  try {
    const { page } = run;
    const atlasRequests = new Set<string>();
    page.on("response", (response) => { if (response.url().includes("rock-material-atlas")) atlasRequests.add(response.url()); });
    await page.getByRole("button", { name: "Tienda de efectos", exact: true }).click();
    await expect.poll(() => page.locator(".crv-probador .crv-backdrop.fx-stage").evaluate((node) => getComputedStyle(node).backgroundImage)).toContain("stage-realistic");
    for (const [code, preset] of families) {
      for (const kind of ["name", "frame", "message"]) {
        const effectCode = kind === "frame" ? `marco-${code}` : kind === "message" ? `mensaje-${code}` : code;
        const effect = EFFECT_CATALOG.find((effect) => effect.code === effectCode)!;
        await page.getByRole("button", { name: kind === "name" ? "Nombres" : kind === "frame" ? "Marcos" : "Mensajes", exact: true }).click();
        const card = page.locator(".chat-effect-card").filter({ has: page.locator(".chat-effect-name", { hasText: new RegExp(`^${effect.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`) }) });
        await card.click();
        const target = page.locator(`.crv-probador ${kind === "frame" ? ".crv-avatar" : kind === "message" ? "p" : ".crv-name"}.crv-material-${preset}`);
        await expect(target).toBeVisible();
        if (kind === "name" && code === "karma-azul") {
          const bounds = await target.boundingBox();
          assert(bounds);
          await expect.poll(() => page.locator(".crv-material-stage").evaluate((node, rect) => {
            const canvas = node as HTMLCanvasElement;
            const scale = canvas.width / innerWidth;
            const pixels = canvas.getContext("2d")!.getImageData(Math.round(rect.x * scale), Math.round((rect.y - 20) * scale), Math.max(1, Math.round(rect.width * scale)), Math.round(19 * scale)).data;
            let painted = 0; for (let i = 3; i < pixels.length; i += 4) if (pixels[i]! > 20) painted++;
            return painted;
          }, bounds)).toBeGreaterThan(20);
        }
        await expect.poll(() => page.evaluate(() => (window as unknown as MaterialWindow).__crvMaterials.usage().emitters)).toBeGreaterThan(0);
        await expect(page.locator(".crv-material-stage")).toHaveCount(1);
        // Ensure the overlay actually contains drawing, not just a registered emitter.
        await expect.poll(() => page.locator(".crv-material-stage").evaluate((node) => {
          const canvas = node as HTMLCanvasElement; const pixels = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data;
          let painted = 0; for (let i = 3; i < pixels.length; i += 4) if (pixels[i]! > 10) painted++;
          return painted;
        })).toBeGreaterThan(8);
        if (kind === "name") await page.screenshot({ path: `${output}/${viewport.width}-${code}.png` });
        if (code === "sangre-realista" && kind === "frame") {
          (results["viewports"] as unknown[]).push({ ...viewport, perf: await measure(page), usage: await page.evaluate(() => (window as unknown as MaterialWindow).__crvMaterials.usage()) });
        }
      }
    }
    checks.push(`${viewport.width}: las seis familias se prueban en nombre, avatar y mensaje; canvas con píxeles reales`);
    await page.getByRole("button", { name: "Nombres", exact: true }).click();
    await page.getByRole("button", { name: /^Murciélago Murciélago/ }).click();
    await expect(page.locator(".crv-probador .crv-real-bat")).toBeVisible();
    assert.equal(await page.locator(".crv-probador .crv-real-bat").evaluate((node) => getComputedStyle(node).overflow), "hidden");
    const atlas = page.locator(".crv-probador .crv-real-bat image").first();
    const href = await atlas.getAttribute("href");
    assert(href?.endsWith(".webp"));
    await expect.poll(() => atlas.evaluate((node) => (node as SVGImageElement).getBBox().width)).toBeGreaterThan(0);
    await page.screenshot({ path: `${output}/${viewport.width}-bat-realistic.png` });
    await page.keyboard.press("Escape");
    await page.locator(".chat-messages").evaluate((node) => { node.scrollTop = 0; });
    await expect.poll(() => page.locator(".chat-messages .crv-name.is-offscreen").count()).toBeGreaterThan(0);
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    assert.deepEqual(run.errors, []);
    assert.equal(run.purchases(), 0);
    checks.push(`${viewport.width}: atlas WebP compartido, scroll, sin compras, errores ni desbordamiento`);
  } finally { await run.context.close(); }
}
for (const mode of ["low", "reduced"] as const) {
  const run = await setup({ width: 390, height: 844 }, mode);
  try {
    await run.page.getByRole("button", { name: "Tienda de efectos", exact: true }).click();
    for (const [code, preset] of families) {
      const effect = EFFECT_CATALOG.find((effect) => effect.code === code)!;
      await run.page.locator(".chat-effect-card").filter({ has: run.page.locator(".chat-effect-name", { hasText: effect.name }) }).click();
      await expect(run.page.locator(`.crv-probador .crv-material-${preset}`)).toBeVisible();
      await expect(run.page.locator(".crv-material-stage")).toHaveCount(0);
      assert.equal(await run.page.evaluate(() => (window as unknown as MaterialWindow).__crvMaterials.usage().emitters), 0);
    }
    await run.page.screenshot({ path: `${output}/${mode}-material.png` });
    assert.deepEqual(run.errors, []);
    checks.push(`${mode}: las seis familias legibles sin canvas ni emisores`);
  } finally { await run.context.close(); }
}
// Fresh pages avoid CPU canvas readback from the pixel assertions affecting
// the performance sample. Other fixture contexts are already closed.
for (const viewport of [{ width: 390, height: 844 }, { width: 1440, height: 960 }]) {
  const run = await setup(viewport);
  try {
    await run.page.getByRole("button", { name: "Tienda de efectos", exact: true }).click();
    await run.page.locator(".chat-effect-card").filter({ has: run.page.locator(".chat-effect-name", { hasText: /^Karma azul$/ }) }).click();
    await expect(run.page.locator(".crv-probador .crv-material-karma-aura")).toBeVisible();
    const first = await measure(run.page);
    const steady = await measure(run.page);
    (results["viewports"] as unknown[]).push({ ...viewport, freshCanvas: true, first, steady, usage: await run.page.evaluate(() => (window as unknown as MaterialWindow).__crvMaterials.usage()) });
    await run.page.emulateMedia({ reducedMotion: "reduce" });
    await expect(run.page.locator(".crv-material-stage")).toHaveCount(0);
    await expect.poll(() => run.page.evaluate(() => (window as unknown as MaterialWindow).__crvMaterials.usage().emitters)).toBe(0);
    checks.push(`${viewport.width}: medición sin lectura de píxeles y cambio dinámico a movimiento reducido`);
  } finally { await run.context.close(); }
}
await writeFile(`${output}/qa.json`, JSON.stringify(results, null, 2));
console.log(JSON.stringify(results, null, 2));
await browser.close();
