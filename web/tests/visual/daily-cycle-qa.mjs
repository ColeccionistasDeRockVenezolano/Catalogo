import assert from "node:assert/strict";
import { chromium, expect } from "@playwright/test";

// Read-only QA against the development API; only the server clock is simulated.
const base = process.env.CRV_WEB_URL ?? "http://127.0.0.1:5173";
const api = process.env.CRV_QA_API_URL ?? "http://127.0.0.1:8087";
const artistId = process.env.CRV_QA_ARTIST_ID ?? "159";
const before = "2026-10-15T03:59:59.000Z";
const after = "2026-10-15T04:00:00.100Z";
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  const clientDate = new Date("2035-01-01T12:00:00.000Z");
  await page.clock.install({ time: clientDate });
  await page.clock.pauseAt(clientDate);
  let serverNow = before;
  let holdNext = false;
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  const dates = [];
  const clock = () => {
    const next = serverNow === before;
    return { date: next ? "2026-10-14" : "2026-10-15", day: next ? 20740 : 20741,
      timeZone: "America/Caracas", startsAt: next ? "2026-10-14T04:00:00.000Z" : "2026-10-15T04:00:00.000Z",
      changesAt: next ? "2026-10-15T04:00:00.000Z" : "2026-10-16T04:00:00.000Z", serverNow };
  };
  await page.route("**/daily-cycle", route => route.fulfill({ json: clock() }));
  await page.route("**/artists/*", async route => {
    const url = new URL(route.request().url());
    if (url.pathname !== `/artists/${artistId}`) return route.continue();
    const date = url.searchParams.get("date"); dates.push(["artist", date]);
    if (holdNext && date === "2026-10-15") await pending;
    const response = await route.fetch({ url: `${api}${url.pathname}${url.search}` });
    await route.fulfill({ response });
  });
  await page.goto(`${base}/artistas/${artistId}`, { waitUntil: "domcontentloaded" });
  const button = page.locator(".artist-listen__platform").filter({ hasText: "YouTube · CRV" });
  await expect(button).toBeVisible();
  await button.click();
  const first = await page.locator(".artist-listen iframe").getAttribute("src");
  assert.ok(first?.includes("youtube-nocookie.com/embed/"));
  assert.equal(dates[0][1], "2026-10-14", "The client date must not choose the editorial day");

  holdNext = true; serverNow = after;
  await page.clock.runFor(1100);
  await expect.poll(() => dates.some(([, date]) => date === "2026-10-15")).toBe(true);
  await expect(page.locator(".artist-listen iframe")).toHaveCount(0);
  release();
  await expect(button).toBeVisible();
  await expect.poll(() => page.locator(".artist-listen iframe").getAttribute("src")).not.toBe(first);
  console.log("PASS: server clock, midnight rollover, delayed response, no stale video, retained CRV selection");

  await page.route("**/home?*", async route => {
    const url = new URL(route.request().url()); dates.push(["home", url.searchParams.get("date")]);
    await route.fulfill({ response: await route.fetch({ url: `${api}/home${url.search}` }) });
  });
  await page.route("**/discovery/search-suggestions?*", async route => {
    const url = new URL(route.request().url()); dates.push(["discovery", url.searchParams.get("date")]);
    await route.fulfill({ response: await route.fetch({ url: `${api}/discovery/search-suggestions${url.search}` }) });
  });
  serverNow = before;
  await page.goto(base, { waitUntil: "domcontentloaded" });
  await expect.poll(() => dates.some(([kind, date]) => kind === "home" && date === "2026-10-14")).toBe(true);
  await expect.poll(() => dates.some(([kind, date]) => kind === "discovery" && date === "2026-10-14")).toBe(true);
  serverNow = after;
  await page.clock.runFor(1100);
  for (const surface of ["home", "discovery"]) {
    await expect.poll(() => dates.some(([kind, date]) => kind === surface && date === "2026-10-15")).toBe(true);
  }
  assert.deepEqual(errors, []);
  console.log("PASS: home and discovery renew together without navigation or a local-date dependency");
  await page.unrouteAll({ behavior: "ignoreErrors" });
  await context.close();
} finally { await browser.close(); }
