import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "@playwright/test";

const baseUrl = process.env.CRV_WEB_URL ?? "http://127.0.0.1:5173";
const catalogTheme = process.env.CRV_CATALOG_THEME ?? "current";
const requestedViewport = Number(process.env.CRV_PLAYER_QA_VIEWPORT) || null;
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
  pauseVideo() { window.__youtubeCalls.push(['pauseVideo']); this.setState(2); }
  getCurrentTime() { return this.time; }
  getPlayerState() { return this.state; }
  setState(state) { this.state = state; this.events.onStateChange({ target: this, data: state }); }
  destroy() { window.__youtubeCalls.push(['destroy']); this.iframe.remove(); window.__youtubeInstances.splice(window.__youtubeInstances.indexOf(this), 1); }
} };
window.onYouTubeIframeAPIReady();
`;

const streamPlatforms = [
  { platform: "spotify", url: "https://open.spotify.com/album/2gW8sOxyXeAzIqg3Aa4EeC" },
  { platform: "deezer", url: "https://www.deezer.com/album/1029713012" },
  { platform: "bandcamp", url: "https://example.bandcamp.com/album/disco-de-prueba" },
];

const browser = await chromium.launch({ headless: true });
const captureDir = process.env.CRV_PLAYER_CAPTURE_DIR;
if (captureDir) await mkdir(captureDir, { recursive: true });
try {
  for (const scenario of [
    { width: 1440, height: 1000 }, { width: 768, height: 1024 },
    { width: 390, height: 844 }, { width: 320, height: 740 },
    { width: 390, height: 844, admin: true },
  ]) {
    if (requestedViewport && scenario.width !== requestedViewport) continue;
    if (process.env.CRV_PLAYER_QA_ADMIN_ONLY && !scenario.admin) continue;
    const viewport = { width: scenario.width, height: scenario.height };
    const context = await browser.newContext({ viewport, hasTouch: viewport.width <= 760, reducedMotion: scenario.admin ? "reduce" : "no-preference" });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    let apiLoads = 0;
    await page.route("https://www.youtube.com/iframe_api", (route) => {
      apiLoads++;
      return route.fulfill({ contentType: "text/javascript", body: iframeApi });
    });
    await page.route("https://www.youtube-nocookie.com/embed/**", (route) => route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Video de prueba</title><body style='margin:0;background:#111;color:#aaa;display:grid;place-items:center;height:100vh;font:14px sans-serif'>Video de prueba</body>" }));
    await page.route("**/albums/*", (route) => {
      const id = new URL(route.request().url()).pathname.split("/").at(-1);
      if (id === "57") return route.fulfill({ json: album });
      if (id === "58") return route.fulfill({ json: { ...album, id: 58, youtubeUrl: null, youtubeLinks: [] } });
      if (id === "60") return route.fulfill({ json: { ...album, id: 60, youtubeUrl: null, youtubeLinks: [], platforms: streamPlatforms,
        description: "La descripción completa del disco se conserva.", catalogId: "CRV-QA-60", mediaFormat: "CD", releaseDateText: "2000" } });
      if (id === "59") return route.fulfill({ json: { ...album, id: 59, youtubeUrl: `https://youtu.be/${videoId}`, youtubeLinks: [] } });
      return route.fulfill({ json: { items: [], total: 0, page: 1, pageSize: 20 } });
    });
    await page.route("https://open.spotify.com/embed/**", (route) => route.fulfill({ body: "<!doctype html><title>Spotify de prueba</title>" }));
    await page.route("https://widget.deezer.com/**", (route) => route.fulfill({ body: "<!doctype html><title>Deezer de prueba</title>" }));
    await page.route("**/site-appearance", (route) => route.fulfill({ json: { catalogTheme, updatedAt: null } }));
    await page.route("**/auth/me", (route) => route.fulfill({ json: { user: scenario.admin ? { username: "qa", name: "QA", role: "admin" } : null } }));
    await page.route("**/entity-verification/**", (route) => route.fulfill({ json: null }));
    await page.route("**/albums/*/text-rewrites", (route) => route.fulfill({ json: { pending: [] } }));
    await page.route("**/audit**", (route) => route.fulfill({ json: { data: [], pagination: { total: 0, limit: 15, offset: 0 } } }));
    await page.route(/\/changes(?:\?|$)/u, (route) => route.fulfill({ json: { data: [], pagination: { total: 0, limit: 10, offset: 0 } } }));
    await page.route("**/tracks/1", (route) => route.fulfill({ json: { ...album.tracklist[0], aliases: [] } }));

    await page.goto(`${baseUrl}/discos/57`);
    if (scenario.admin) await page.locator(".entity-verification").waitFor();
    await page.locator(".catalog-video-player__screen iframe").waitFor();
    await page.waitForFunction(() => window.__youtubeInstances?.length === 1);
    await page.evaluate(() => { window.__youtubeCalls.length = 0; });
    assert.equal(await page.locator(".catalog-video-player__screen iframe").count(), 1);
    const profileBox = await page.locator(".album-profile").boundingBox();
    const listenBox = await page.locator(".album-listen").boundingBox();
    const listBox = await page.locator(".album-tracks").boundingBox();
    const creditsBox = await page.getByRole("heading", { name: "Créditos", exact: true }).boundingBox();
    if (viewport.width > 760) {
      assert.ok(listenBox.x >= profileBox.x + profileBox.width, "la escucha está a la derecha de la ficha");
      assert.equal(listenBox.y, profileBox.y, "las columnas comienzan juntas");
    } else {
      assert.ok(listenBox.y >= profileBox.y + profileBox.height, "en móvil la escucha sigue a la ficha");
    }
    assert.ok(listBox.y >= listenBox.y + listenBox.height, "las pistas siguen a las plataformas");
    assert.ok(creditsBox.y >= Math.max(profileBox.y + profileBox.height, listBox.y + listBox.height), "los créditos quedan debajo de ambas columnas");
    assert.match(await page.locator(".album-tracks__summary").innerText(), /3 pistas · 6:42 \(parcial\)/u);
    const playerBox = await page.locator(".catalog-video-player__screen").boundingBox();
    const tracksBox = await page.getByRole("heading", { name: "Lista de pistas" }).boundingBox();
    assert.ok(playerBox.y + playerBox.height <= tracksBox.y, "el reproductor precede la lista");
    assert.ok(playerBox.width <= viewport.width && playerBox.height >= 200);
    const iframe = page.locator(".catalog-video-player__screen iframe");
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
    await page.locator(".album-youtube-current").filter({ hasText: "Reproduciendo: Verano" }).waitFor();

    // Cada clic vuelve a reproducir, sin reemplazar ni recargar el iframe.
    for (let count = 0; count < 2; count++) {
      await page.getByRole("button", { name: "Reproducir «Infierno VIP» desde 3:04" }).click();
    }
    assert.deepEqual(await page.evaluate(() => window.__youtubeCalls.slice(2)), [["seekTo", 184, true], ["playVideo"], ["seekTo", 184, true], ["playVideo"]]);
    assert.equal(await page.evaluate(() => window.__youtubeInstances.length), 1);
    assert.equal(apiLoads, 1, "StrictMode comparte la carga de la API");
    assert.match(await page.locator(".album-track-row.is-current").innerText(), /Infierno VIP/u);
    if (catalogTheme !== "current") {
      const row = page.locator(".album-track-row.is-current");
      const beforeHover = await row.evaluate(node => getComputedStyle(node).background);
      await row.hover();
      assert.equal(await row.evaluate(node => getComputedStyle(node).background), beforeHover, "hover conserva el fondo de la pista activa");
      const contrast = await row.locator(".track-youtube-play").evaluate(node => {
        const style = getComputedStyle(node);
        const luminance = color => color.match(/[\d.]+/gu).slice(0, 3).map(Number).map(value => {
          const channel = value / 255;
          return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4;
        }).reduce((total, channel, index) => total + channel * [.2126, .7152, .0722][index], 0);
        const foreground = luminance(style.color), background = luminance(style.backgroundColor);
        return (Math.max(foreground, background) + .05) / (Math.min(foreground, background) + .05);
      });
      assert.ok(contrast >= 4.5, `contraste del control activo en ${catalogTheme}: ${contrast}`);
    }
    await page.locator(".album-youtube-current").filter({ hasText: "Reproduciendo: Infierno VIP" }).waitFor();

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
    await page.getByRole("status").filter({ hasText: "Pulsa reproducir" }).waitFor();
    await page.evaluate(() => window.__youtubeInstances[0].setState(1));
    assert.equal(await page.locator(".catalog-video-player__message").count(), 0);
    await page.getByRole("button", { name: "Reproducir «Verano» desde 0:00" }).focus();
    await page.keyboard.press("Enter");
    await page.locator(".album-track-row.is-current").filter({ hasText: "Verano" }).waitFor();
    await page.evaluate(() => window.__youtubeInstances[0].events.onError());
    await page.getByRole("status").filter({ hasText: "Este video no permite" }).waitFor();
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

    // Navegación SPA: el iframe y su audio permanecen en modo flotante.
    const iframeIdentity = await iframe.elementHandle();
    await page.evaluate(() => { window.history.pushState({}, "", location.pathname.replace("/57", "/58")); window.dispatchEvent(new PopStateEvent("popstate")); });
    await page.getByRole("heading", { name: "Lista de pistas" }).waitFor();
    await page.locator(".catalog-video-player--floating").waitFor();
    await page.evaluate(() => { const instance = window.__youtubeInstances[0]; instance.time = 42; instance.setState(1); });
    assert.ok(await iframeIdentity.evaluate(node => node === document.querySelector(".catalog-video-player iframe")));
    const floating = page.locator(".catalog-video-player--floating");
    const expand = page.getByRole("button", { name: /^Mostrar controles de /u });
    const compactBox = await floating.boundingBox();
    assert.ok(compactBox.width <= 224 && compactBox.height <= 127, "flotante compacto sin cabecera ni pie");
    if (viewport.width <= 760) assert.ok(await page.locator(".main-nav").evaluate((nav, bottom) => nav.getBoundingClientRect().top >= bottom, compactBox.y + compactBox.height), "el compacto no tapa la navegación");
    if (captureDir && !scenario.admin) await page.screenshot({ path: `${captureDir}/compact-${viewport.width}.png` });

    // Arrastrar no abre controles; un toque breve sí. El cierre tiene su propia área.
    await page.mouse.move(compactBox.x + 35, compactBox.y + 35);
    await page.mouse.down();
    await page.mouse.move(48, 160, { steps: 8 });
    await page.mouse.up();
    assert.ok(await floating.evaluate(node => node.classList.contains("catalog-video-player--compact")), "arrastrar no equivale a tocar");
    const movedBox = await floating.boundingBox();
    assert.ok(Math.abs(movedBox.x - compactBox.x) + Math.abs(movedBox.y - compactBox.y) > 30, "el compacto cambia de posición");
    if (viewport.width <= 760) await expand.tap(); else await expand.click();
    await page.getByRole("button", { name: "Acoplar reproductor a un lado", exact: true }).waitFor();
    if (scenario.admin) {
      const motion = await floating.evaluate(node => ({ reduced: matchMedia("(prefers-reduced-motion: reduce)").matches, durations: node.getAnimations().map(animation => animation.effect.getTiming().duration) }));
      // La regla global de movimiento reducido usa transiciones CSS de 0,01 ms.
      assert.ok(motion.reduced && motion.durations.every(duration => duration <= 1), `sin animación perceptible con movimiento reducido: ${JSON.stringify(motion)}`);
    }
    await page.waitForFunction(() => document.querySelector(".catalog-video-player").getAnimations().length === 0);
    assert.ok(!(await floating.evaluate(node => node.classList.contains("catalog-video-player--compact"))));
    const expandedBox = await floating.boundingBox();
    assert.ok(expandedBox.width > compactBox.width && expandedBox.x >= 0 && expandedBox.x + expandedBox.width <= viewport.width, "se amplía dentro de pantalla");
    if (captureDir && !scenario.admin) await page.screenshot({ path: `${captureDir}/expanded-${viewport.width}.png` });
    assert.ok(await iframeIdentity.evaluate(node => node === document.querySelector(".catalog-video-player iframe")), "ampliar no reemplaza iframe");

    // Controles propios conectados al reproductor; el tiempo no se reinicia.
    await page.evaluate(() => { const instance = window.__youtubeInstances[0]; instance.time = 42; instance.setState(1); });
    await page.getByRole("button", { name: "Pausar video", exact: true }).click();
    await page.getByRole("button", { name: "Reproducir video", exact: true }).waitFor();
    assert.match(await page.locator(".catalog-video-player__playback").innerText(), /En pausa · 0:42/u);
    await page.getByRole("button", { name: "Reproducir video", exact: true }).click();
    assert.equal(await page.evaluate(() => window.__youtubeInstances[0].time), 42);
    // La lista sobrevive a la navegación y salta a las marcas del video original.
    const previousTrack = page.getByRole("button", { name: "Pista anterior", exact: true });
    const nextTrack = page.getByRole("button", { name: "Próxima pista", exact: true });
    assert.ok(await previousTrack.isDisabled(), "sin anterior en la primera pista");
    assert.ok(await nextTrack.isEnabled());
    await nextTrack.focus();
    await page.keyboard.press("Enter");
    assert.equal(await page.evaluate(() => window.__youtubeInstances[0].time), 184);
    assert.ok(await nextTrack.isDisabled(), "omite pistas sin marca de tiempo y se detiene en la última");
    assert.match(await page.locator(".catalog-video-player__playback strong").innerText(), /Infierno VIP/u);
    assert.ok(await previousTrack.isEnabled());
    await previousTrack.click();
    assert.equal(await page.evaluate(() => window.__youtubeInstances[0].time), 0);
    assert.ok(await previousTrack.isDisabled());
    assert.ok(await floating.isVisible(), "saltar conserva el modo flotante");
    assert.ok(await iframeIdentity.evaluate(node => node === document.querySelector(".catalog-video-player iframe")), "saltar dentro del video conserva el iframe");
    for (const control of await floating.locator("button:visible, a:visible").all()) {
      const box = await control.boundingBox();
      assert.ok(box.width >= 44 && box.height >= 44, "controles flotantes de al menos 44px");
    }

    // Las flechas ajustan la posición libre; al soltar un arrastre se acopla al lateral más cercano.
    const handle = page.getByRole("button", { name: "Mover reproductor", exact: true });
    await handle.focus();
    const beforeKeyboard = await floating.boundingBox();
    await page.keyboard.press("ArrowDown");
    await page.waitForFunction(y => document.querySelector(".catalog-video-player").getBoundingClientRect().y > y, beforeKeyboard.y, { timeout: 3000 });
    const afterKeyboard = await floating.boundingBox();
    assert.ok(afterKeyboard.y > beforeKeyboard.y, "movimiento libre con teclado");
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => document.activeElement === document.querySelector(".catalog-video-player__expand"));

    // Arrastre táctil real, incluido el umbral que separa toque de arrastre.
    if (viewport.width <= 760) {
      const touch = await context.newCDPSession(page);
      const start = await expand.boundingBox();
      const x = start.x + 35, y = start.y + 35;
      await touch.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
      await touch.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: 12, y: y + 45 }] });
      await touch.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      const end = await expand.boundingBox();
      assert.ok(end.x <= 13 && end.y > start.y + 20 && await expand.isVisible(), "arrastre táctil libre y acoplado sin expansión accidental");
      await touch.detach();
    }

    await expand.focus();
    await page.keyboard.press("Enter");
    await page.getByRole("button", { name: "Mover reproductor", exact: true }).waitFor();
    // Un toque fuera vuelve a compacto, salvo al fijarlo con la chincheta.
    await page.mouse.click(4, 120);
    await page.waitForFunction(() => document.querySelector(".catalog-video-player").classList.contains("catalog-video-player--compact"));
    await expand.click();
    await page.getByRole("button", { name: "Fijar reproductor ampliado", exact: true }).click();
    await page.mouse.click(4, 120);
    assert.ok(!(await floating.evaluate(node => node.classList.contains("catalog-video-player--compact"))), "la chincheta conserva el reproductor ampliado");
    await page.getByRole("button", { name: "Quitar fijación del reproductor", exact: true }).click();
    // El panel ampliado también se arrastra libremente desde su cabecera y se acopla al soltar.
    const handleBox = await handle.boundingBox();
    await page.mouse.move(handleBox.x + 24, handleBox.y + 20);
    await page.mouse.down();
    await page.mouse.move(viewport.width + 500, viewport.height + 500, { steps: 10 });
    await page.mouse.up();
    const edgeBox = await floating.boundingBox();
    assert.ok(edgeBox.x + edgeBox.width >= viewport.width - 13 && edgeBox.y + edgeBox.height <= viewport.height, "al soltar, el arrastre se acopla al borde del viewport");
    if (viewport.width <= 760) assert.ok(await page.locator(".main-nav").evaluate((nav, bottom) => nav.getBoundingClientRect().top >= bottom, edgeBox.y + edgeBox.height), "el ampliado no tapa la navegación");

    if (viewport.width === 1440) {
      await page.setViewportSize({ width: 320, height: 420 });
      await page.waitForFunction(() => { const rect = document.querySelector(".catalog-video-player").getBoundingClientRect(); return rect.x >= 0 && rect.right <= innerWidth && rect.bottom <= document.querySelector(".main-nav").getBoundingClientRect().top; });
      await page.setViewportSize(viewport);
    }
    await page.getByRole("button", { name: "Volver al video en la página", exact: true }).click();
    await page.locator(".catalog-video-player:not(.catalog-video-player--floating)").waitFor();
    assert.ok(await iframeIdentity.evaluate(node => node === document.querySelector(".catalog-video-player iframe")), "volver conserva iframe");
    await page.getByRole("button", { name: "Video flotante", exact: true }).click();
    await expand.waitFor();
    await page.waitForFunction(() => document.activeElement === document.querySelector(".catalog-video-player__expand"));
    await page.evaluate(() => { window.history.pushState({}, "", location.pathname.replace("/57", "/58")); window.dispatchEvent(new PopStateEvent("popstate")); });
    await page.locator(".album-listen__notice").waitFor();
    assert.equal(await page.getByRole("button", { name: /Reproducir «/u }).count(), 0);
    await page.locator(".album-listen__notice").filter({ hasText: "no tiene un video" }).waitFor();
    assert.match(await page.locator(".album-listen__intro").innerText(), /Todavía no hay plataformas/u);
    await page.getByRole("button", { name: "Cerrar video", exact: true }).click();
    await page.waitForFunction(() => window.__youtubeInstances.length === 0);
    assert.ok((await page.evaluate(() => window.__youtubeCalls)).some(call => call[0] === "destroy"));
    await page.evaluate(() => { window.history.pushState({}, "", location.pathname.replace("/58", "/59")); window.dispatchEvent(new PopStateEvent("popstate")); });
    await page.locator(".catalog-video-player__screen iframe").waitFor();
    assert.equal(await page.getByRole("button", { name: /Reproducir «/u }).count(), 2);
    assert.equal(apiLoads, 1, "al navegar reutiliza la API");
    // Sin video: plataformas integradas y enlaces externos conservan su función.
    await page.goto(`${baseUrl}/discos/60`);
    await page.locator(".album-listen__notice").waitFor();
    await page.locator('.album-listen__platform button[aria-pressed="true"]').filter({ hasText: "Spotify" }).waitFor();
    assert.equal(await page.locator(".album-profile .entity-hero__desc").innerText(), "La descripción completa del disco se conserva.");
    assert.match(await page.locator(".album-edition-details").innerText(), /CRV-QA-60/u);
    for (const link of streamPlatforms) assert.equal(await page.locator(`.album-listen__platform a[href="${link.url}"]`).count(), 1, `conserva ${link.platform}`);
    await page.getByRole("button", { name: /Escuchar .* en Deezer/u }).click();
    await page.locator('.album-listen__platform button[aria-pressed="true"]').filter({ hasText: "Deezer" }).waitFor();
    assert.equal(await page.locator('.album-listen iframe[src*="deezer.com"]').count(), 1);
    assert.equal(await page.locator('.album-listen iframe[src*="spotify.com"]').count(), 0);
    // Los embeds de streaming comparten el mismo contrato flotante que el video.
    await page.getByRole("button", { name: /Activar reproductor flotante de .* Deezer/u }).click();
    const floatingEmbed = page.locator(".listen-embed--floating");
    await floatingEmbed.waitFor();
    assert.ok(await floatingEmbed.evaluate(node => node.classList.contains("listen-embed--compact")));
    await page.getByRole("button", { name: /Mostrar controles de .* Deezer/u }).click();
    await page.getByRole("button", { name: "Mover reproductor", exact: true }).last().waitFor();
    await page.mouse.click(4, 120);
    await page.waitForFunction(() => document.querySelector(".listen-embed--floating")?.classList.contains("listen-embed--compact"));
    await page.getByRole("button", { name: /Mostrar controles de .* Deezer/u }).click();
    await page.getByRole("button", { name: "Fijar reproductor ampliado", exact: true }).last().click();
    await page.mouse.click(4, 120);
    assert.ok(!(await floatingEmbed.evaluate(node => node.classList.contains("listen-embed--compact"))), "la chincheta también fija el streaming ampliado");
    await page.getByRole("button", { name: "Volver al reproductor en la página", exact: true }).click();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1));
    if (viewport.width === 1440) {
      const secondVideoId = "abcdefghijk";
      await page.route("**/albums/61", route => route.fulfill({ json: {
        ...album, id: 61,
        discs: [
          { discNumber: 1, title: "Lado A", platforms: [] },
          { discNumber: 2, title: "Lado B", platforms: [{ platform: "youtube", url: `https://youtu.be/${secondVideoId}` }] },
        ],
        tracklist: [album.tracklist[0], { ...album.tracklist[1], discNumber: 2, trackNumber: 1, youtubeStartSeconds: 0 }],
      } }));
      await page.goto(`${baseUrl}/discos/61`);
      await page.waitForFunction(() => window.__youtubeInstances?.length === 1);
      await page.evaluate(() => { const instance = window.__youtubeInstances[0]; instance.events.onReady({ target: instance }); instance.setState(1); });
      await page.getByRole("button", { name: "Video flotante", exact: true }).click();
      await page.getByRole("button", { name: /^Mostrar controles de /u }).click();
      await page.getByRole("button", { name: "Próxima pista", exact: true }).click();
      await page.waitForFunction(id => document.querySelector(".catalog-video-player iframe").src.includes(id), secondVideoId);
      await page.evaluate(() => { const instance = window.__youtubeInstances[0]; instance.events.onReady({ target: instance }); });
      assert.equal(await page.evaluate(() => window.__youtubeInstances[0].time), 0, "el siguiente disco comienza en su propia marca de tiempo");
      assert.match(await page.locator(".catalog-video-player__playback strong").innerText(), /Infierno VIP/u);
      assert.ok(await page.getByRole("button", { name: "Próxima pista", exact: true }).isDisabled());
      await page.getByRole("button", { name: "Pista anterior", exact: true }).click();
      await page.waitForFunction(id => document.querySelector(".catalog-video-player iframe").src.includes(id), videoId);
      await page.evaluate(() => { const instance = window.__youtubeInstances[0]; instance.events.onReady({ target: instance }); });
      assert.ok(await page.getByRole("button", { name: "Pista anterior", exact: true }).isDisabled());
      await page.getByRole("button", { name: "Volver al video en la página", exact: true }).click();
      await page.locator(".album-track-row.is-current").filter({ hasText: "Verano" }).waitFor();
      assert.equal(await page.getByRole("button", { name: "Lado A", exact: true }).getAttribute("aria-pressed"), "true", "la pestaña sigue el video elegido con las flechas");
      await page.getByRole("button", { name: "Cerrar video", exact: true }).click();
      await page.route("**/albums/62", route => route.fulfill({ json: { ...album, id: 62, tracklist: album.tracklist.map(track => ({ ...track, youtubeStartSeconds: null })) } }));
      await page.goto(`${baseUrl}/discos/62`);
      await page.waitForFunction(() => window.__youtubeInstances?.length === 1);
      await page.evaluate(() => { const instance = window.__youtubeInstances[0]; instance.events.onReady({ target: instance }); instance.setState(1); });
      await page.getByRole("button", { name: "Video flotante", exact: true }).click();
      await page.getByRole("button", { name: /^Mostrar controles de /u }).click();
      assert.ok(await page.getByRole("button", { name: "Pista anterior", exact: true }).isDisabled());
      assert.ok(await page.getByRole("button", { name: "Próxima pista", exact: true }).isDisabled(), "sin marcas de tiempo no se inventan saltos");
    }
    assert.deepEqual(errors, []);
    await context.close();
    console.log(`✓ ${viewport.width}px${scenario.admin ? " admin + movimiento reducido" : ""}: pistas, compacto/ampliado, arrastre, límites, pausa, teclado, iframe persistente y navegación`);
  }
} finally {
  await browser.close();
}
