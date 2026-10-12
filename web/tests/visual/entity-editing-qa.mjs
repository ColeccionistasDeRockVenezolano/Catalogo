import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const base = process.env.CRV_WEB_URL ?? "http://127.0.0.1:5173";
const out = fileURLToPath(new URL("../../../docs/ui-qa/entity-editing/", import.meta.url));
await mkdir(out, { recursive: true });
const initialPerson = { id: 9, name: "Persona de prueba", realName: "Nombre real de prueba", birthCity: "Caracas", gender: "male", deathCause: null, trivia: "Compositor y guitarrista", nationality: "Venezolana", isVenezuelan: true, isDeceased: false, isDeceasedFlag: null, birthDate: "1970-02-03", deathDate: null, pictureUrl: null, biography: "Biografía", notes: "Notas", creditCount: 0, bandCount: 0, nameClass: "ok", nameClassReason: "", bands: [], albumCredits: [], trackCredits: [], organizations: [], aliases: [] };
const initialArtist = { id: 58, name: "Artista de prueba", artistType: "solo_artist", originCountry: "Venezuela", originCity: "Caracas", formedYear: 1990, disbandedYear: null, status: "on_hold", themes: "Historia", yearsActive: "1990–2000, 2005–presente", pictureUrl: null, logoUrl: null, biography: "Biografía", notes: "Notas", members: [], discography: [], aliases: [], links: [], platforms: [], socials: [], related: [], similar: [], similarDecade: null, genres: [], primaryGenre: null };
const initialAlbum = { id: 57, title: "Disco de prueba", albumType: "studio_album", releaseYear: 2000, releaseDateText: "Octubre de 2000", catalogId: "CRV-001", mediaFormat: "CD", genre: null, genres: [], primaryGenre: null, artist: { id: 58, name: "Artista de prueba" }, label: { id: 2, name: "Sello de prueba" }, coverUrl: null, description: "Descripción", notes: "Notas", youtubeUrl: null, youtubeStatus: "unknown", instagramUrl: null, instagramStatus: "unknown", wordpressUrl: null, wordpressStatus: "unknown", tracklist: [{ id: 1, title: "Pista de prueba", discNumber: 1, trackNumber: 1, durationSeconds: 123, youtubeStartSeconds: null, notes: "Nota existente de la pista", credits: [] }], credits: [], creditsByType: {}, scopedCreditsByType: {}, formats: [], aliases: [], youtubeLinks: [], platforms: [] };
const initialOrg = { id: 2, name: "Sello de prueba", organizationType: "record_label", biography: "Descripción", pictureUrl: null, country: "Venezuela", websiteUrl: "https://example.com", notes: "Notas", labelAlbums: [], creditedArtists: [], associatedPersons: [], aliases: [] };
const browser = await chromium.launch({ headless: true });
try {
  for (const width of [1440, 390]) {
    for (const role of ["admin", "reader", null]) {
      const context = await browser.newContext({ viewport: { width, height: 950 } });
      const page = await context.newPage();
      const artist = structuredClone(initialArtist), person = structuredClone(initialPerson), album = structuredClone(initialAlbum), org = structuredClone(initialOrg);
      const socialLinks = [];
      const writes = [], errors = [];
      page.on("pageerror", (err) => errors.push(err.message));
      await page.route("**/*", async (route) => {
        const req = route.request();
        if (!["fetch", "xhr"].includes(req.resourceType())) return route.continue();
        const pathname = new URL(req.url()).pathname.replace(/^\/crv\/api/u, "");
        if (pathname === "/auth/me") return route.fulfill({ json: { user: role ? { name: "QA", username: "qa", role } : null, csrf: "qa-token" } });
        if (req.method() !== "GET") {
          const body = req.postDataJSON(); writes.push({ path: pathname, method: req.method(), body });
          if (pathname.startsWith("/artist-members")) {
            if (req.method() === "DELETE") artist.members = [];
            else artist.members = [{ ...body, id: 10, personName: person.name, personRealName: person.realName, personBirthDate: person.birthDate, personDeathDate: null }];
          }
          if (pathname.startsWith("/catalog-links") && req.method() === "PATCH") socialLinks.push({ platform: pathname.split("/").at(-1), ...body });
          if (pathname.startsWith("/catalog-links") && req.method() === "DELETE") socialLinks.length = 0;
          if (pathname === "/artists/58") Object.assign(artist, body);
          if (pathname === "/persons/9") Object.assign(person, body);
          if (pathname === "/albums/57") Object.assign(album, body);
          if (pathname === "/organizations/2") Object.assign(org, body);
          return route.fulfill({ json: { id: 10, runId: 1, kind: "artist", fields: [], created: true } });
        }
        if (pathname === "/artists/58") return route.fulfill({ json: artist });
        if (pathname === "/persons/9") return route.fulfill({ json: person });
        if (pathname === "/organizations/2") return route.fulfill({ json: org });
        if (pathname === "/albums/57") return route.fulfill({ json: album });
        if (pathname === "/tracks/1") return route.fulfill({ json: { ...album.tracklist[0], aliases: [] } });
        if (pathname === "/persons") return route.fulfill({ json: { data: [person], pagination: { limit: 8, offset: 0, total: 1 } } });
        if (pathname === "/genres/vocabulary") return route.fulfill({ json: [{ slug: "rock", name: "Rock", level: "family" }] });
        if (pathname.startsWith("/catalog-links")) return route.fulfill({ json: pathname.endsWith("social") ? socialLinks : [] });
        if (pathname.startsWith("/entity-verification")) return route.fulfill({ json: null });
        if (pathname.startsWith("/catalog-model/")) return route.fulfill({ json: { identities: [], editions: [], works: [], supports: [], genres: [] } });
        if (pathname.endsWith("/text-rewrites")) return route.fulfill({ json: { pending: [] } });
        if (pathname === "/claims" || pathname === "/audit" || pathname === "/changes") return route.fulfill({ json: { data: [], pagination: { limit: 10, offset: 0, total: 0 } } });
        return route.fulfill({ json: [] });
      });
      await page.goto(`${base}/artistas/58`);
      await page.getByRole("heading", { name: artist.name, exact: true }).waitFor();
      const edit = page.locator(".page-actions").getByRole("button", { name: "Editar", exact: true });
      if (role !== "admin") {
        assert.equal(await edit.count(), 0);
        for (const path of ["/personas/9", "/discos/57", "/organizaciones/2"]) {
          await page.goto(`${base}${path}`);
          await page.locator(".entity-hero").waitFor();
          assert.equal(await page.locator(".page-actions").getByRole("button", { name: "Editar", exact: true }).count(), 0);
        }
        assert.equal(writes.length, 0);
        await context.close();
        console.log(`✓ ${width}px ${role ?? "visitante"}: fichas sin controles de escritura`);
        continue;
      }
      await edit.click();
      const dialog = page.getByRole("dialog");
      assert.equal(await dialog.getByLabel("Estado de actividad").inputValue(), "on_hold");
      assert.equal(await dialog.getByLabel("Períodos de actividad").inputValue(), artist.yearsActive);
      await dialog.locator("#f-name").fill("Borrador sin perder");
      await dialog.getByRole("button", { name: "Identidad e integrantes", exact: true }).click();
      await dialog.getByRole("button", { name: "Asociar persona titular", exact: true }).click();
      await dialog.getByRole("combobox", { name: "Persona *" }).fill("Persona");
      await dialog.getByRole("option").first().click();
      await dialog.getByLabel("Motivo", { exact: false }).filter({ visible: true }).fill("Confirmar titular");
      await dialog.getByRole("button", { name: "Guardar vínculo", exact: true }).click();
      await dialog.getByRole("button", { name: /Quitar vínculo con/ }).waitFor();
      assert.equal(writes.at(-1).body.role, "Titular del proyecto");
      assert.equal(await dialog.locator('input[id="f-name"]').inputValue(), "Borrador sin perder");
      await page.screenshot({ animations: "disabled", path: `${out}/artist-members-${width}.png` });
      await dialog.getByRole("button", { name: /Quitar vínculo con/ }).click();
      await dialog.getByLabel("Motivo", { exact: false }).filter({ visible: true }).fill("Retirar titular equivocado");
      await dialog.getByRole("button", { name: "Quitar vínculo", exact: true }).click();
      await dialog.getByText("Sin vínculos registrados.").first().waitFor();
      assert.equal(writes.at(-1).method, "DELETE");
      await dialog.getByRole("button", { name: "Añadir integrante", exact: true }).click();
      await dialog.getByRole("combobox", { name: "Persona *" }).fill("Persona");
      await dialog.getByRole("option").first().click();
      await dialog.getByLabel("Rol *", { exact: true }).fill("Guitarra");
      await dialog.getByLabel("Motivo", { exact: false }).filter({ visible: true }).fill("Añadir integrante");
      await dialog.getByRole("button", { name: "Guardar vínculo", exact: true }).click();
      await dialog.getByText("Guitarra", { exact: true }).waitFor();
      assert.equal(writes.at(-1).body.role, "Guitarra");
      await dialog.getByRole("button", { name: "Redes sociales", exact: true }).click();
      await dialog.getByRole("button", { name: "Añadir red social" }).click();
      await dialog.getByLabel("URL *", { exact: true }).fill("https://instagram.com/prueba");
      await dialog.getByLabel("Identidad confirmada", { exact: true }).check();
      await dialog.getByLabel("Motivo", { exact: false }).filter({ visible: true }).fill("Perfil oficial");
      await dialog.getByRole("button", { name: "Guardar enlace" }).click();
      await dialog.getByRole("button", { name: "Editar Instagram" }).waitFor();
      await page.screenshot({ animations: "disabled", path: `${out}/artist-socials-${width}.png` });
      await dialog.getByRole("button", { name: "Datos de la ficha" }).click();
      assert.equal(await dialog.locator("#f-name").inputValue(), "Borrador sin perder");
      await dialog.getByLabel("Motivo", { exact: false }).filter({ visible: true }).fill("Corregir ficha");
      await dialog.getByRole("button", { name: "Guardar", exact: true }).click();
      await page.getByRole("heading", { name: "Borrador sin perder", exact: true }).waitFor();
      assert.equal(writes.at(-1).body.status, "on_hold");
      for (const [path, key, expected] of [["/personas/9", "Nombre real", person.realName], ["/discos/57", "Número de catálogo", album.catalogId], ["/organizaciones/2", "Sitio web", org.websiteUrl]]) {
        await page.goto(`${base}${path}`); await page.locator(".page-actions").getByRole("button", { name: "Editar", exact: true }).click();
        assert.equal(await dialog.getByLabel(key, { exact: true }).inputValue(), expected);
        if (path.includes("personas")) {
          await dialog.getByLabel("Fecha de nacimiento").fill("");
          await dialog.getByLabel("Motivo", { exact: false }).filter({ visible: true }).fill("Corregir fecha");
          await dialog.getByRole("button", { name: "Guardar", exact: true }).click();
          await page.getByRole("dialog").waitFor({ state: "hidden" });
          assert.equal(writes.at(-1).body.birthDate, null);
        } else {
          await page.screenshot({ animations: "disabled", path: `${out}/${path.includes("discos") ? "album" : "organization"}-fields-${width}.png` });
          assert.ok(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth + 1), "modal sin desbordamiento");
          await dialog.getByRole("button", { name: "Cerrar", exact: true }).click();
        }
      }
      await page.goto(`${base}/discos/57`);
      await page.locator(".album-track-actions").first().getByRole("button", { name: "Editar", exact: true }).click();
      assert.equal(await dialog.getByLabel("Notas internas").inputValue(), "Nota existente de la pista");
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      assert.deepEqual(errors, []);
      await context.close();
      console.log(`✓ ${width}px admin: campos, borrador preservado, asociar/quitar titular, redes, fecha vacía, notas de pista y layout`);
    }
  }
} finally { await browser.close(); }
