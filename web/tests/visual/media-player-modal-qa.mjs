import assert from "node:assert/strict";
import { chromium, expect } from "@playwright/test";

const base = process.env.CRV_WEB_URL ?? "http://localhost:5173";
const capture = process.env.CRV_PLAYER_CAPTURE_DIR;
const api = `window.__calls=[];window.__players=[];window.YT={Player:class{
  constructor(frame,options){this.frame=frame;this.events=options.events;this.time=0;this.state=-1;window.__players.push(this);queueMicrotask(()=>this.events.onReady({target:this}));}
  seekTo(t){this.time=t;window.__calls.push(['seek',t]);}
  playVideo(){this.state=1;window.__calls.push(['play']);this.events.onStateChange({target:this,data:1});}
  pauseVideo(){this.state=2;window.__calls.push(['pause']);this.events.onStateChange({target:this,data:2});}
  getCurrentTime(){return this.time;}getPlayerState(){return this.state;}getDuration(){return 240;}
  setVolume(v){window.__calls.push(['volume',v]);}mute(){window.__calls.push(['mute']);}unMute(){}
  destroy(){this.frame.contentWindow.postMessage('destroy','*');window.__calls.push(['destroy']);this.frame.remove();}
}};window.onYouTubeIframeAPIReady();`;
// Like the real widget API, commands require a connected iframe window.
const soundCloudApi = `window.__soundCloudCalls=[];window.SC={Widget:Object.assign(frame=>({
  bind(){frame.contentWindow.postMessage('bind',frame.src.split('?')[0]);window.__soundCloudCalls.push('bind');},
  unbind(){frame.contentWindow.postMessage('unbind',frame.src.split('?')[0]);window.__soundCloudCalls.push('unbind');},
  pause(){frame.contentWindow.postMessage('pause',frame.src.split('?')[0]);window.__soundCloudCalls.push('pause');}
}),{Events:{PLAY:'play'}})};`;
const browser = await chromium.launch({ headless: true });
try {
  for (const width of [1440, 390, 320]) {
    const page = await browser.newPage({ viewport: { width, height: 960 }, reducedMotion: width === 320 ? "reduce" : "no-preference" });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.route("**/src/main.tsx*", route => route.fulfill({ contentType: "text/javascript", body: 'import "/tests/visual/media-player-harness.tsx";' }));
    await page.route("https://www.youtube.com/iframe_api", route => route.fulfill({ contentType: "text/javascript", body: api }));
    await page.route("https://w.soundcloud.com/player/api.js", route => route.fulfill({ contentType: "text/javascript", body: soundCloudApi }));
    await page.route(/https:\/\/www.youtube-nocookie.com\/embed\//, route => route.fulfill({ contentType: "text/html", body: '<html><body style="margin:0;background:#090909;color:#888;display:grid;place-items:center;height:100vh;font:14px system-ui">Vidéo de prueba</body></html>' }));
    await page.route(/https:\/\/w.soundcloud.com\/player\/\?/, route => route.fulfill({ contentType: "text/html", body: '<html><body style="margin:0;background:#171717;color:white;padding:16px;font:14px system-ui"><p>SoundCloud · Audio de prueba</p><button style="padding:12px" onclick="this.textContent=\'Sonando\';window.listenTime=42">Reproducir audio</button></body></html>' }));
    await page.goto(`${base}/__qa_media`);
    // Leaving an inactive embed must unbind before React removes its iframe.
    await page.waitForFunction(() => window.__soundCloudCalls?.includes('bind'));
    await page.getByRole("link", { name: "Otra página", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Contenido de otra página" })).toBeVisible();
    await expect(page.locator('iframe[title="Audio de prueba en SoundCloud"]')).toHaveCount(0);
    assert.deepEqual(errors, [], "inactive widget teardown keeps the app usable");
    assert.ok(await page.evaluate(() => window.__soundCloudCalls.includes('unbind')));
    await page.getByRole("link", { name: "Inicio", exact: true }).click();
    const audio = page.frameLocator('iframe[title="Audio de prueba en SoundCloud"]');
    await expect(audio.getByRole("button", { name: "Reproducir audio" })).toBeVisible();
    await expect(page.locator(".listen-embed__activate")).toHaveCount(0);
    await audio.getByRole("button", { name: "Reproducir audio" }).click();
    await page.evaluate(() => { window.__audioFrame = document.querySelector('iframe[title="Audio de prueba en SoundCloud"]'); });
    await page.getByRole("button", { name: "Video flotante", exact: true }).click();
    await expect(page.locator(".listen-embed--compact")).toBeVisible();
    await page.getByRole("button", { name: "Mostrar reproductor pequeño" }).click();
    await expect(page.getByRole("button", { name: "Anclar reproductor" })).toBeVisible();
    await page.getByRole("button", { name: "Anclar reproductor" }).click();
    await page.getByRole("link", { name: "Otra página", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Contenido de otra página" })).toBeVisible();
    await expect(page.locator(".listen-embed--floating:not(.listen-embed--compact)")).toBeVisible();
    assert.equal(await page.evaluate(() => window.__audioFrame === document.querySelector('iframe[title="Audio de prueba en SoundCloud"]')), true);
    assert.equal(await audio.locator("body").evaluate(() => window.listenTime), 42, "external playback survives route unmount");
    await page.getByRole("button", { name: "Desanclar reproductor" }).click();
    await page.mouse.click(2, 2);
    await expect(page.locator(".listen-embed--compact")).toBeVisible();

    // Starting a video retires the floating external session before playback.
    await page.getByRole("button", { name: "Reproducir video de prueba", exact: true }).click();
    await expect(page.locator(".listen-embed--floating")).toHaveCount(0);
    await expect(page.locator("dialog:modal")).toHaveCount(1);
    await expect(page.getByRole("button", { name: "Pausar video", exact: true })).toBeEnabled();
    await page.evaluate(() => { window.__frame = document.querySelector(".catalog-video-player iframe"); });
    if (capture) await page.screenshot({ path: `${capture}/modal-${width}.png`, animations: "disabled" });
    await page.locator("dialog:modal").click({ position: { x: 2, y: 2 } });
    await expect(page.locator(".catalog-video-player--miniature")).toBeVisible();
    await page.getByRole("button", { name: "Pausar video", exact: true }).click();
    await expect(page.getByRole("button", { name: "Reproducir video", exact: true })).toBeEnabled();
    const box = await page.locator(".catalog-video-player__screen").boundingBox();
    assert.ok(box.width >= 200);
    assert.ok(Math.abs(box.height - box.width * 9 / 16) < 1, "miniature keeps 16:9 without added letterboxing");
    const iframeBox = await page.locator(".catalog-video-player__screen iframe").boundingBox();
    assert.ok(Math.abs(iframeBox.height - box.height) < 1, "video fills miniature height");
    if (capture) await page.screenshot({ path: `${capture}/miniatura-${width}.png`, animations: "disabled" });
    await page.getByRole("button", { name: "Mostrar reproductor pequeño" }).click();
    await expect(page.locator(".catalog-video-player--miniature")).toHaveCount(0);
    await page.getByRole("button", { name: "Anclar reproductor" }).click();
    await page.getByRole("link", { name: "Inicio", exact: true }).click();
    await expect(page.locator(".catalog-video-player--floating")).toBeVisible();
    await expect(page.getByRole("button", { name: "Desanclar reproductor" })).toBeVisible();
    if (capture) await page.screenshot({ path: `${capture}/pequeno-${width}.png`, animations: "disabled" });
    assert.equal(await page.evaluate(() => window.__frame === document.querySelector(".catalog-video-player iframe")), true);
    await page.getByRole("button", { name: "Desanclar reproductor" }).click();
    await page.mouse.click(2, 2);
    await expect(page.locator(".catalog-video-player--miniature")).toBeVisible();
    await page.getByRole("button", { name: "Mostrar reproductor pequeño" }).click();
    await page.getByRole("button", { name: "Abrir en modal", exact: true }).click();
    await expect(page.locator("dialog:modal")).toHaveCount(1);
    await page.getByRole("slider", { name: "Posición del video" }).fill("50");
    await page.getByRole("button", { name: "+10 s", exact: true }).click();
    assert.ok(await page.evaluate(() => window.__calls.some(call => call[0] === "seek" && call[1] === 60)));
    await page.getByRole("button", { name: "Cerrar video", exact: true }).click();
    await expect(page.locator(".catalog-video-player")).toHaveCount(0);

    // Album alone initializes an embedded, paused player and keeps it when floating.
    await page.getByRole("link", { name: "Disco de prueba", exact: true }).click();
    await expect(page.locator(".catalog-video-player--inline")).toBeVisible();
    await expect(page.locator("dialog:modal")).toHaveCount(0);
    await page.getByRole("button", { name: "Reproducir video", exact: true }).click();
    await page.evaluate(() => { window.__albumFrame = document.querySelector(".catalog-video-player iframe"); });
    if (capture) await page.screenshot({ path: `${capture}/album-${width}.png`, animations: "disabled" });
    await page.getByRole("button", { name: "Video flotante", exact: true }).click();
    await page.getByRole("link", { name: "Otra página", exact: true }).click();
    await expect(page.locator(".catalog-video-player--miniature")).toBeVisible();
    assert.equal(await page.evaluate(() => window.__albumFrame === document.querySelector(".catalog-video-player iframe")), true);
    await page.getByRole("button", { name: "Mostrar reproductor pequeño" }).click();
    await page.getByRole("button", { name: "Volver al disco", exact: true }).click();
    await expect(page.locator(".catalog-video-player--inline")).toBeVisible();
    await page.getByRole("button", { name: "Video flotante", exact: true }).click();
    await page.getByRole("link", { name: "Inicio", exact: true }).click();
    // Native audio is directly usable and replaces the video on interaction.
    await audio.getByRole("button", { name: "Reproducir audio" }).click();
    await expect(page.locator(".catalog-video-player")).toHaveCount(0);
    await page.getByRole("button", { name: "Abrir video de Lista de prueba" }).click();
    await expect(page.locator("dialog:modal")).toHaveCount(1);
    await page.locator("dialog:modal").click({ position: { x: 2, y: 2 } });
    await expect(page.locator(".listen-embed--compact.media-player--video")).toBeVisible();
    const playlistBox = await page.locator(".listen-embed--compact.media-player--video .listen-embed__frame").boundingBox();
    assert.ok(Math.abs(playlistBox.height - playlistBox.width * 9 / 16) < 1, "external video miniature keeps 16:9");
    await page.getByRole("button", { name: "Mostrar reproductor pequeño" }).click();
    await page.getByRole("button", { name: "Anclar reproductor" }).click();
    await page.getByRole("link", { name: "Otra página", exact: true }).click();
    await expect(page.locator(".listen-embed--floating.media-player--video:not(.listen-embed--compact)")).toBeVisible();
    await page.getByRole("button", { name: "Cerrar reproductor", exact: true }).click();
    await expect(page.locator(".listen-embed--floating")).toHaveCount(0);
    assert.equal(await page.evaluate(() => document.body.style.overflow), "");
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.deepEqual(errors, []);
    console.log(`PASS ${width}px: four modes, pin, auto-miniature, native audio, route persistence, exclusivity, album embed`);
    await page.close();
  }
} finally { await browser.close(); }
