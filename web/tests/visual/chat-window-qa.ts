// Sesión larga con API/WS simulados, reutilizando Chromium por CDP.
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { chromium, type WebSocketRoute } from "playwright";
import { expect } from "@playwright/test";
import { EFFECT_CATALOG } from "../../../src/chat/effects-catalog";
import { dailyCycleAt } from "../../../src/shared/daily-cycle";

const endpoint = process.env["CRV_QA_CDP"];
const output = process.env["CRV_QA_OUT"];
assert(endpoint && output, "Fija CRV_QA_CDP y CRV_QA_OUT (staging SSD)");
const baseline = process.env["CRV_QA_BASELINE"] === "1";
const browser = await chromium.connectOverCDP(endpoint);
const results: unknown[] = [];
try {
  for (const viewport of [{ width: 390, height: 844 }, { width: 1440, height: 960 }]) {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    const errors: string[] = [];
    try {
      page.on("pageerror", (error) => errors.push(error.message));
      await page.addInitScript("window.__name = (fn) => fn");
      const equipped = { name: "murcielago", frame: "anillo-fuego", background: null, ambient: null, name_font: null };
      const actor = { id: "fixture-window", handle: "ensayo", displayName: "Nina Discos", avatarSeed: "nina", isBot: false, equipped };
      const message = (id: number) => ({ id, roomId: 1, actorId: actor.id, handle: actor.handle, displayName: actor.displayName,
        kind: "chat", body: `Archivo ${id}`, effectCode: null, createdAt: new Date().toISOString(), equipped });
      const room = { id: 1, slug: "general", name: "La Rockola", description: "", slowModeSeconds: 0, theme: {} };
      const wallet = { coins: 100, credits: 0 };
      const effects = EFFECT_CATALOG.map((effect) => ({ ...effect, owned: true, equipped: Object.values(equipped).includes(effect.code) }));
      let wire: WebSocketRoute;
      let historyCalls = 0;
      let failHistory = false;
      await page.routeWebSocket(/\/chat\/ws\?/, (socket) => {
        wire = socket;
        socket.send(JSON.stringify({ type: "snapshot", actor, room, me: wallet, users: [actor], effects,
          messages: Array.from({ length: 50 }, (_, index) => message(index + 251)) }));
      });
      await page.route((url) => /^\/(?:crv\/)?(?:api\/)?chat\//u.test(url.pathname) && !url.pathname.endsWith("/ws"), async (route) => {
        const url = new URL(route.request().url());
        const path = url.pathname.replace(/^\/crv/, "").replace(/^\/api/, "");
        if (path === "/chat/session") return route.fulfill({ json: { actor, wallet, token: "fixture" } });
        if (path === "/chat/daily-cover") return route.fulfill({ status: 404, json: { error: { code: "no_cover", message: "Sin portada" } } });
        if (path.endsWith("/messages")) {
          historyCalls += 1;
          if (failHistory) { failHistory = false; return route.fulfill({ status: 503, json: { error: { code: "history", message: "Vuelve a intentarlo" } } }); }
          const before = Number(url.searchParams.get("before"));
          return route.fulfill({ json: { messages: Array.from({ length: Math.min(50, before - 1) }, (_, index) => message(Math.max(1, before - 50) + index)) } });
        }
        throw new Error(`Falta fixture: ${path}`);
      });
      await page.route(/\/daily-cycle(?:\?|$)/, (route) => route.fulfill({ json: { ...dailyCycleAt(), serverNow: new Date().toISOString() } }));
      await page.goto(process.env["CRV_QA_URL"] ?? "http://localhost:5173/chat");
      const list = page.locator(".chat-messages");
      const rows = list.locator("[data-message-id]");
      await expect(rows).toHaveCount(50);
      const started = Date.now();
      for (let start = 301; start <= 550; start += 25) {
        for (let id = start; id < start + 25; id++) wire!.send(JSON.stringify({ type: "message", message: message(id) }));
        await expect(rows.last()).toHaveAttribute("data-message-id", String(start + 24));
      }
      const afterBurst = { rows: await rows.count(), nodes: await list.locator("*").count(), elapsedMs: Date.now() - started };
      if (!baseline) {
        assert.equal(afterBurst.rows, 50);
        assert.equal(historyCalls, 0);
        await expect(rows.first()).toHaveAttribute("data-message-id", "501");
        await list.evaluate((element) => { element.scrollTop = 0; });
        await expect(page.getByRole("button", { name: "Ir a los últimos mensajes", exact: true })).toBeVisible();
        const readingY = (await rows.first().boundingBox())!.y;
        wire!.send(JSON.stringify({ type: "message", message: message(551) }));
        wire!.send(JSON.stringify({ type: "message", message: message(551) }));
        await expect(page.getByRole("button", { name: "1 mensaje nuevo", exact: true })).toBeVisible();
        await expect(rows.first()).toHaveAttribute("data-message-id", "501");
        assert(Math.abs((await rows.first().boundingBox())!.y - readingY) < 3);
        failHistory = true;
        await page.getByRole("button", { name: "Cargar mensajes anteriores", exact: true }).click();
        await expect(page.getByRole("alert")).toContainText("Vuelve a intentarlo");
        await page.getByRole("button", { name: "Cargar mensajes anteriores", exact: true }).click();
        await expect(rows.first()).toHaveAttribute("data-message-id", "451");
        await expect(rows).toHaveCount(50);
        await expect(page.getByRole("button", { name: "Cargar mensajes más recientes", exact: true })).toBeVisible();
        await page.getByRole("button", { name: "Cargar mensajes más recientes", exact: true }).click();
        await expect(rows.first()).toHaveAttribute("data-message-id", "501");
        await expect(rows).toHaveCount(50);
        await page.getByRole("button", { name: "1 mensaje nuevo", exact: true }).click();
        await expect(rows.last()).toHaveAttribute("data-message-id", "551");
        await expect(rows.first()).toHaveAttribute("data-message-id", "502");
        await expect(rows).toHaveCount(50);
        await expect.poll(() => list.evaluate((element) => element.scrollHeight - element.clientHeight - element.scrollTop)).toBeLessThan(3);
        await page.screenshot({ path: `${output}/${viewport.width}-window.png` });
        // El agotamiento del historial y la vuelta al presente no dejan la lista vacía.
        for (let pageIndex = 0; pageIndex < 12; pageIndex++) {
          const earlier = page.getByRole("button", { name: "Cargar mensajes anteriores", exact: true });
          if (!(await earlier.count())) break;
          const firstId = Number(await rows.first().getAttribute("data-message-id"));
          const response = page.waitForResponse((value) => value.url().includes(`/messages?before=${firstId}`));
          await earlier.click();
          await response;
          await expect(page.getByRole("button", { name: "Cargando mensajes…", exact: true })).toHaveCount(0);
          await expect(rows.first()).toHaveAttribute("data-message-id", String(Math.max(1, firstId - 50)));
          assert((await rows.count()) <= 50);
        }
        await expect(page.getByRole("button", { name: "Cargar mensajes anteriores", exact: true })).toHaveCount(0);
        assert((await rows.count()) > 0);
        await page.getByRole("button", { name: "Ir a los últimos mensajes", exact: true }).click();
        await expect(rows.last()).toHaveAttribute("data-message-id", "551");
      }
      assert.deepEqual(errors, []);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      results.push({ viewport, baseline, afterBurst, historyCalls, errors });
    } catch (error) {
      console.error({ errors, url: page.url(), body: (await page.locator("body").innerText()).slice(0, 1600) });
      throw error;
    } finally { await context.close(); }
  }
  await writeFile(`${output}/${baseline ? "before" : "after"}.json`, JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
} finally { await browser.close(); }
