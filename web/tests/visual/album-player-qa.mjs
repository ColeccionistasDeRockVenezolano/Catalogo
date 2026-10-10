import assert from "node:assert/strict";
import { chromium } from "@playwright/test";

const baseUrl = process.env.CRV_WEB_URL ?? "http://127.0.0.1:5173";
const videoId = "Q-pRpO2sYSI";
const album = {
  id: 57, title: "Disco de prueba", releaseYear: 2000, albumType: "studio",
  genre: null, coverUrl: null, description: null, notes: null,
  youtubeUrl: null, youtubeStatus: "published", instagramUrl: null, instagramStatus: "unknown",
  wordpressUrl: null, wordpressStatus: "unknown", artist: { id: 58, name: "Artista de prueba" }, label: null,
  tracklist: [
    { id: 1, discNumber: 1, trackNumber: 1, title: "Verano", durationSeconds: 184, youtubeStartSeconds: 0, credits: [{ id: 1, creditType: "musician", role: "Guitarra", personId: 9, personName: "Músico de prueba", artistId: null, artistName: null, organizationId: null, organizationName: null }] },
    { id: 2, discNumber: 1, trackNumber: 2, title: "Infierno VIP", durationSeconds: 218, youtubeStartSeconds: 184, credits: [] },
    { id: 3, discNumber: 1, trackNumber: 3, title: "Sin tiempo: un título largo que debe conservarse completo en la lista de pistas de un teléfono pequeño", durationSeconds: null, youtubeStartSeconds: null, credits: [] },
  ],
  credits: [], creditsByType: {}, scopedCreditsByType: {}, formats: [], aliases: [], platforms: [],
  youtubeLinks: [{ videoId, title: "Disco completo", kind: "full_album", isPrimaryLink: true }],
};

// El doble de la API comprueba las órdenes de reproducción sin depender de
// anuncios, bloqueos regionales o disponibilidad del video externo.
const iframeApi = `
window.__youtubeCalls = [];
window.__youtubeInstances = [];
window.YT = { Player: class {
  constructor(iframe, options) {
    this.iframe = iframe;
    this.events = options.events;
    this.time = 0;
    this.state = -1;
    window.__youtubeInstances.push(this);
  }
  seekTo(seconds, allowSeekAhead) { this.time = seconds; window.__youtubeCalls.push(['seekTo', seconds, allowSeekAhead]); }
  playVideo() { window.__youtubeCalls.push(['playVideo']); this.setState(1); }
  getCurrentTime() { return this.time; }
  getPlayerState() { return this.state; }
  setState(state) { this.state = state; this.events.onStateChange({ target: this, data: state }); }
  destroy() { window.__youtubeCalls.push(['destroy']); this.iframe.remove(); window.__youtubeInstances.splice(window.__youtubeInstances.indexOf(this), 1); }
} };
window.onYouTubeIframeAPIReady();
`;

const browser = await chromium.launch({ headless: true });
try {
  for (const scenario of [
    { width: 1440, height: 1000 }, { width: 768, height: 1024 },
    { width: 390, height: 844 }, { width: 320, height: 740 },
    { width: 390, height: 844, admin: true },
  ]) {
    const viewport = { width: scenario.width, height: scenario.height };
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    let apiLoads = 0;
    await page.route("https://www.youtube.com/iframe_api", (route) => {
      apiLoads++;
      return route.fulfill({ contentType: "text/javascript", body: iframeApi });
    });
    await page.route("https://www.youtube-nocookie.com/embed/**", (route) => route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Video de prueba</title>" }));
    await page.route("**/albums/*", (route) => {
      const id = new URL(route.request().url()).pathname.split("/").at(-1);
      if (id === "57") return route.fulfill({ json: album });
      if (id === "58") return route.fulfill({ json: { ...album, id: 58, youtubeUrl: null, youtubeLinks: [] } });
      if (id === "59") return route.fulfill({ json: { ...album, id: 59, youtubeUrl: `https://youtu.be/${videoId}`, youtubeLinks: [] } });
      return route.fulfill({ json: { items: [], total: 0, page: 1, pageSize: 20 } });
    });
    await page.route("**/auth/me", (route) => route.fulfill({ json: { user: scenario.admin ? { username: "qa", name: "QA", role: "admin" } : null } }));
    await page.route("**/entity-verification/**", (route) => route.fulfill({ json: null }));
    await page.route("**/albums/*/text-rewrites", (route) => route.fulfill({ json: { pending: [] } }));
    await page.route("**/audit**", (route) => route.fulfill({ json: { data: [], pagination: { total: 0, limit: 15, offset: 0 } } }));
    await page.route(/\/changes(?:\?|$)/u, (route) => route.fulfill({ json: { data: [], pagination: { total: 0, limit: 10, offset: 0 } } }));
    await page.route("**/tracks/1", (route) => route.fulfill({ json: { ...album.tracklist[0], aliases: [] } }));

    await page.goto(`${baseUrl}/discos/57`);
    if (scenario.admin) await page.locator(".entity-verification").waitFor();
    await page.locator(".album-youtube-player iframe").waitFor();
    await page.waitForFunction(() => window.__youtubeInstances?.length === 1);
    await page.evaluate(() => { window.__youtubeCalls.length = 0; });
    assert.equal(await page.locator(".album-youtube-player iframe").count(), 1);
    const playerBox = await page.locator(".album-youtube-player").boundingBox();
    const tracksBox = await page.getByRole("heading", { name: "Lista de pistas" }).boundingBox();
    assert.ok(playerBox.y + playerBox.height <= tracksBox.y, "el reproductor precede la lista");
    assert.ok(playerBox.width <= viewport.width && playerBox.height >= 200);
    const iframe = page.locator(".album-youtube-player iframe");
    assert.match(await iframe.getAttribute("src"), /enablejsapi=1.*origin=/u);
    assert.equal(await iframe.getAttribute("referrerpolicy"), "strict-origin-when-cross-origin");
    assert.equal(await page.getByRole("button", { name: /Reproducir «/u }).count(), 2);
    assert.equal(await page.locator(".album-track-row.is-current").count(), 0, "sin pista activa antes de reproducir");
    if (viewport.width <= 760) {
      assert.ok(await page.locator(".album-tracklist").evaluate((table) => table.scrollWidth <= table.clientWidth + 1), "la lista móvil no necesita desplazamiento horizontal");
      for (const button of await page.locator(".track-youtube-play").all()) {
        const box = await button.boundingBox();
        assert.ok(box.x >= 0 && box.x + box.width <= viewport.width && box.width >= 44 && box.height >= 44, "play visible y fácil de pulsar");
      }
    }

    // Antes de onReady conserva la última selección, incluido cero.
    await page.getByRole("button", { name: "Reproducir «Infierno VIP» desde 3:04" }).click();
    await page.getByRole("button", { name: "Reproducir «Verano» desde 0:00" }).click();
    assert.deepEqual(await page.evaluate(() => window.__youtubeCalls), []);
    await page.evaluate(() => { const instance = window.__youtubeInstances[0]; instance.events.onReady({ target: instance }); });
    assert.deepEqual(await page.evaluate(() => window.__youtubeCalls), [["seekTo", 0, true], ["playVideo"]]);
    await page.locator('.album-track-row[aria-current="true"]').filter({ hasText: "Verano" }).waitFor();
    assert.match(await page.locator(".album-youtube-current").innerText(), /Reproduciendo: Verano/u);

    // Cada clic vuelve a reproducir, sin reemplazar ni recargar el iframe.
    for (let count = 0; count < 2; count++) {
      await page.getByRole("button", { name: "Reproducir «Infierno VIP» desde 3:04" }).click();
    }
    assert.deepEqual(await page.evaluate(() => window.__youtubeCalls.slice(2)), [["seekTo", 184, true], ["playVideo"], ["seekTo", 184, true], ["playVideo"]]);
    assert.equal(await page.evaluate(() => window.__youtubeInstances.length), 1);
    assert.equal(apiLoads, 1, "StrictMode comparte la carga de la API");
    assert.match(await page.locator(".album-track-row.is-current").innerText(), /Infierno VIP/u);
    assert.match(await page.locator(".album-youtube-current").innerText(), /Reproduciendo: Infierno VIP/u);

    // El resaltado sigue al video, también cuando se avanza desde sus controles.
    await page.evaluate(() => { window.__youtubeInstances[0].time = 0; });
    await page.locator(".album-track-row.is-current").filter({ hasText: "Verano" }).waitFor();
    await page.evaluate(() => { window.__youtubeInstances[0].time = 184; });
    await page.locator(".album-track-row.is-current").filter({ hasText: "Infierno VIP" }).waitFor();
    await page.evaluate(() => window.__youtubeInstances[0].setState(2));
    await page.locator(".album-youtube-current").filter({ hasText: "En pausa: Infierno VIP" }).waitFor();
    await page.evaluate(() => window.__youtubeInstances[0].setState(0));
    await page.locator(".album-youtube-current").filter({ hasText: "Reproducción finalizada" }).waitFor();
    assert.equal(await page.locator(".album-track-row.is-current").count(), 0);
    await page.evaluate(() => window.__youtubeInstances[0].events.onAutoplayBlocked());
    await page.getByRole("status").filter({ hasText: "Pulsa el botón" }).waitFor();
    await page.evaluate(() => window.__youtubeInstances[0].setState(1));
    assert.equal(await page.locator(".album-youtube-message").count(), 0);
    await page.getByRole("button", { name: "Reproducir «Verano» desde 0:00" }).focus();
    await page.keyboard.press("Enter");
    await page.locator(".album-track-row.is-current").filter({ hasText: "Verano" }).waitFor();
    await page.evaluate(() => window.__youtubeInstances[0].events.onError());
    await page.getByRole("status").filter({ hasText: "Este video no se puede" }).waitFor();
    assert.equal(await page.locator(".album-track-row.is-current").count(), 0, "un error borra el estado de reproducción");
    await page.getByRole("button", { name: "créditos (1)", exact: true }).click();
    await page.locator(".album-track-credits").filter({ hasText: "Músico de prueba" }).waitFor();
    if (scenario.admin) {
      await page.locator(".album-track-actions").first().getByRole("button", { name: "Editar", exact: true }).click();
      await page.getByRole("dialog", { name: "Editar «Verano»" }).waitFor();
      await page.getByRole("button", { name: "Cancelar", exact: true }).click();
    }
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(overflow <= 1, `sin desbordamiento en ${viewport.width}px`);

    // Navegación SPA: salir del disco destruye el reproductor y su audio.
    await page.evaluate(() => { window.history.pushState({}, "", location.pathname.replace("/57", "/58")); window.dispatchEvent(new PopStateEvent("popstate")); });
    await page.waitForFunction(() => window.__youtubeCalls.some((call) => call[0] === "destroy"));
    await page.getByRole("heading", { name: "Lista de pistas" }).waitFor();
    assert.equal(await page.locator(".album-youtube-player").count(), 0);
    assert.equal(await page.getByRole("button", { name: /Reproducir «/u }).count(), 0);
    await page.evaluate(() => { window.history.pushState({}, "", location.pathname.replace("/58", "/59")); window.dispatchEvent(new PopStateEvent("popstate")); });
    await page.locator(".album-youtube-player iframe").waitFor();
    assert.equal(await page.getByRole("button", { name: /Reproducir «/u }).count(), 2);
    assert.equal(apiLoads, 1, "al navegar reutiliza la API");
    assert.deepEqual(errors, []);
    await context.close();
    console.log(`✓ ${viewport.width}px${scenario.admin ? " admin" : ""}: play accesible, pista sincronizada, pausa/final, teclado, créditos, errores y navegación`);
  }
} finally {
  await browser.close();
}
