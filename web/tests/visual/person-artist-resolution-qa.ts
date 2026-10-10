import { chromium, expect } from "@playwright/test";
import { getPersonDetail } from "../../../src/api/repositories/persons.js";
import { getIndividualVerification } from "../../../src/verification/store.js";
import { closeDb } from "../../../src/db/client.js";
import type { PersonArtistJob } from "../../../src/curation/ai/person-artist-types.js";

const browser = await chromium.launch();
try {
  const person = await getPersonDetail(15368);
  if (!person) throw new Error("Falta la persona de Jeremías.");
  const report = await getIndividualVerification("person", person.id);
  for (const width of [1280, 390]) {
    const context = await browser.newContext({
      viewport: { width, height: 950 },
    });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    let started = false,
      finished = false,
      posts = 0;
    const job: PersonArtistJob = {
      id: 1,
      personId: person.id,
      status: "running",
      phase: "identity",
      result: null,
      error: null,
      requestedBy: "QA",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await page.route("http://127.0.0.1:8080/**", async (route) => {
      const path = new URL(route.request().url()).pathname;
      let body: unknown = {
        data: [],
        pagination: { total: 0, limit: 20, offset: 0 },
      };
      if (path === "/auth/me")
        body = {
          user: { username: "qa", name: "QA", role: "admin" },
          csrf: "qa",
        };
      else if (path === `/persons/${person.id}`) body = person;
      else if (path.endsWith("/resolve-artist")) {
        if (route.request().method() === "POST") {
          posts++;
          started = true;
          body = job;
        } else
          body = started
            ? {
                ...job,
                ...(finished
                  ? {
                      status: "done",
                      phase: "done",
                      result: {
                        action: "created",
                        artistId: 70000,
                        stageName: "Jeremías",
                        explanation:
                          "Las fuentes unen Carlos Eduardo López Ávila con su nombre artístico Jeremías.",
                        conflicts: [],
                        candidates: [],
                        evidence: [],
                        runId: 99,
                        reports: { person: 21, artist: 22 },
                        pending: [],
                      },
                    }
                  : {}),
              }
            : null;
      } else if (path.includes("/entity-verification/"))
        body = path.endsWith("/latest-job") ? null : report;
      else if (path.endsWith("/identity-research")) body = [];
      else if (path.endsWith("/text-rewrites")) body = { pending: [] };
      else if (path.endsWith("/summary"))
        body = {
          categories: [],
          running: false,
          totals: { open: 0 },
          autofix: { today: { applied: 0 }, alerts: [] },
        };
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(body),
      });
    });
    await page.goto("http://127.0.0.1:5199/personas/15368");
    const action = page.getByRole("button", {
      name: "Resolver artista y buscar información con IA",
      exact: true,
    });
    await expect(action).toBeEnabled();
    await action.click();
    await expect(
      page.getByRole("button", { name: "Resolución en curso…", exact: true }),
    ).toBeDisabled();
    await expect(
      page.getByText("Comprobando la identidad con IA…", { exact: false }),
    ).toBeVisible();
    finished = true;
    await expect(
      page.getByText("Artista creado y vinculado", { exact: true }),
    ).toBeVisible({ timeout: 10000 });
    expect(posts).toBe(1);
    await expect(
      page
        .locator(".person-artist-resolution")
        .getByRole("link", { name: "Jeremías", exact: true }),
    ).toHaveAttribute("href", "/artistas/70000");
    await page.reload();
    await expect(
      page.getByText("Artista creado y vinculado", { exact: true }),
    ).toBeVisible();
    expect(posts).toBe(1);
    await page.locator(".person-artist-resolution").scrollIntoViewIfNeeded();
    await page.screenshot({ path: `/tmp/crv-person-artist-${width}.png` });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
    ).toBe(false);
    expect(errors).toEqual([]);
    console.log(
      `${width}px: acción única, avance, persistencia, vínculo y ancho verificados`,
    );
    await context.close();
  }
} finally {
  await browser.close();
  await closeDb();
}
