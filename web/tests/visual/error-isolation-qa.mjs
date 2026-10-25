import assert from "node:assert/strict";
import { chromium, expect } from "@playwright/test";

const base = process.env.CRV_WEB_URL ?? "http://localhost:5173";
const youtube = `window.__players=[];window.YT={Player:class{
  constructor(frame,options){this.frame=frame;this.events=options.events;this.time=0;this.state=-1;window.__players.push(this);queueMicrotask(()=>this.events.onReady({target:this}));}
  seekTo(t){this.time=t;} playVideo(){this.state=1;this.events.onStateChange({target:this,data:1});}
  pauseVideo(){if(window.__failPause)throw Error('QA pause');this.state=2;this.events.onStateChange({target:this,data:2});}
  getCurrentTime(){if(window.__failPoll)throw Error('QA poll');return this.time;}
  getPlayerState(){return this.state;} getDuration(){return 240;}
  setVolume(){} mute(){} unMute(){}
  destroy(){if(window.__failDestroy)throw Error('QA destroy');this.frame.remove();}
}};window.onYouTubeIframeAPIReady();`;
const soundcloud = `window.__bindings=0;window.__unbindings=0;window.SC={Widget:Object.assign(frame=>({
  bind(){frame.contentWindow.postMessage('bind',frame.src.split('?')[0]);window.__bindings++;},
  unbind(){window.__unbindings++;if(window.__failUnbind)throw Error('QA unbind');frame.contentWindow.postMessage('unbind',frame.src.split('?')[0]);},
  pause(){if(window.__failPause)throw Error('QA pause');}
}),{Events:{PLAY:'play'}})};`;

const browser = await chromium.launch({ headless: true });
try {
  for (const width of [1440, 390]) {
    // Exercise the real App, providers and navigation, replacing only page contents.
    const page = await browser.newPage({ viewport: { width, height: 960 } });
    let loads = 0;
    page.on("load", () => loads++);
    await page.route("**/src/pages/SearchPage.tsx*", route => route.fulfill({ contentType: "text/javascript", body: 'import React from "/node_modules/.vite/deps/react.js";export function SearchPage(){if(!window.__pageHealthy)throw Error("QA page render");return React.createElement("h1",null,"Página recuperada");}' }));
    await page.route("**/src/pages/ArtistsListPage.tsx*", route => route.fulfill({ contentType: "text/javascript", body: 'import React from "/node_modules/.vite/deps/react.js";export function ArtistsListPage(){return React.createElement("h1",null,"Catálogo disponible");}' }));
    await page.route("**/auth/me", route => route.fulfill({ json: { user: null } }));
    await page.route("**/site-appearance", route => route.fulfill({ json: { catalogTheme: "current", updatedAt: null } }));
    const openCatalog = async () => {
      const nav = page.getByRole("navigation", { name: "Principal" });
      if (width > 760) {
        await nav.getByRole("button", { name: "Catálogo", exact: true }).click();
        await nav.getByRole("link", { name: /^Artistas/ }).click();
      } else await nav.getByRole("link", { name: "Catálogo", exact: true }).click();
    };
    await page.goto(base);
    await expect(page.getByRole("alert", { name: "esta página" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Principal" })).toBeVisible();
    assert.equal(await page.getByRole("heading", { name: "La interfaz encontró un error" }).count(), 0);
    await page.evaluate(() => { window.__pageHealthy = true; });
    await page.getByRole("button", { name: "Reintentar", exact: true }).click();
    await expect(page.getByText("Página recuperada", { exact: true })).toBeVisible();
    await page.evaluate(() => { window.__pageHealthy = false; });
    await openCatalog();
    await expect(page.getByText("Catálogo disponible", { exact: true })).toBeVisible();
    await page.getByRole("navigation", { name: "Principal" }).getByRole("link", { name: "Home", exact: true }).click();
    await expect(page.getByRole("alert", { name: "esta página" })).toBeVisible();
    await openCatalog();
    await expect(page.getByText("Catálogo disponible", { exact: true })).toBeVisible();
    assert.equal(loads, 1, "retry and navigation recover without a page reload");
    await page.close();

    const media = await browser.newPage({ viewport: { width, height: 960 }, reducedMotion: "reduce" });
    const errors = [];
    media.on("pageerror", error => errors.push(error.message));
    await media.addInitScript(() => {
      const show = HTMLDialogElement.prototype.show;
      HTMLDialogElement.prototype.show = function () {
        if (window.__failDialog) throw Error("QA external render");
        return show.call(this);
      };
      const showModal = HTMLDialogElement.prototype.showModal;
      HTMLDialogElement.prototype.showModal = function () {
        if (window.__failModal) throw Error("QA modal render");
        return showModal.call(this);
      };
      const create = document.createElement.bind(document);
      document.createElement = function (tag, options) {
        if (tag === "iframe" && window.__failIframe) throw Error("QA iframe setup");
        return create(tag, options);
      };
      window.__failDialog = true;
    });
    await media.route("**/src/main.tsx*", route => route.fulfill({ contentType: "text/javascript", body: 'import "/tests/visual/media-player-harness.tsx";' }));
    await media.route("https://www.youtube.com/iframe_api", route => route.fulfill({ contentType: "text/javascript", body: youtube }));
    await media.route("https://w.soundcloud.com/player/api.js", route => route.fulfill({ contentType: "text/javascript", body: soundcloud }));
    await media.route(/https:\/\/(?:www.youtube-nocookie.com\/embed\/|w.soundcloud.com\/player\/\?)/, route => route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Prueba de aislamiento</title>" }));
    await media.goto(`${base}/__qa_media`);
    await expect(media.getByRole("alert", { name: "el reproductor de SoundCloud" })).toBeVisible();
    await expect(media.getByRole("heading", { name: "Prueba del reproductor", exact: true })).toBeVisible();
    await media.evaluate(() => { window.__failDialog = false; });
    await media.getByRole("button", { name: "Reintentar", exact: true }).click();
    await media.waitForFunction(() => window.__bindings > 0);

    // Cleanup errors must be contained even when their boundary is being removed.
    await media.evaluate(() => { window.__failUnbind = true; });
    await media.getByRole("link", { name: "Otra página", exact: true }).click();
    await expect(media.getByRole("heading", { name: "Contenido de otra página" })).toBeVisible();
    await expect(media.locator("iframe")).toHaveCount(0);
    assert.ok(await media.evaluate(() => window.__unbindings > 0));
    await media.getByRole("link", { name: "Inicio", exact: true }).click();
    await media.waitForFunction(() => window.__bindings > 1);
    await media.getByRole("button", { name: "Video flotante", exact: true }).click();
    await media.evaluate(() => { window.__failPause = true; });
    await media.getByRole("button", { name: "Cerrar reproductor", exact: true }).click();
    await media.waitForFunction(() => window.__bindings > 2);
    await media.evaluate(() => { window.__failPause = false; window.__failUnbind = false; window.__failIframe = true; });

    await media.getByRole("button", { name: "Reproducir video de prueba", exact: true }).click();
    await expect(media.getByRole("alert", { name: "el reproductor de YouTube" })).toBeVisible();
    await media.evaluate(() => { window.__failIframe = false; });
    await media.getByRole("button", { name: "Reintentar", exact: true }).click();
    await expect(media.getByRole("button", { name: "Pausar video", exact: true })).toBeEnabled();

    await media.evaluate(() => { window.__failPause = true; });
    await media.getByRole("button", { name: "Pausar video", exact: true }).click();
    await expect(media.getByRole("status")).toContainText("No se pudo controlar el video");
    await media.evaluate(() => { window.__failPause = false; });
    await media.getByRole("button", { name: "Reintentar", exact: true }).click();
    await expect(media.getByRole("button", { name: "Pausar video", exact: true })).toBeEnabled();
    await media.evaluate(() => { window.__failPoll = true; });
    await expect(media.getByRole("status")).toContainText("No se pudo controlar el video");
    await media.evaluate(() => { window.__failPoll = false; window.__failDestroy = true; });
    await media.getByRole("button", { name: "Cerrar video", exact: true }).click();
    await expect(media.locator(".catalog-video-player")).toHaveCount(0);
    await media.getByRole("link", { name: "Otra página", exact: true }).click();
    await expect(media.getByRole("heading", { name: "Contenido de otra página" })).toBeVisible();
    // A failed modal setup must restore scrolling and expose a usable local retry.
    await media.evaluate(() => { window.__failDestroy = false; window.__failModal = true; });
    await media.getByRole("button", { name: "Reproducir video de prueba", exact: true }).click();
    await expect(media.getByRole("alert", { name: "el reproductor de YouTube" })).toBeVisible();
    assert.equal(await media.evaluate(() => document.body.style.overflow), "");
    const failureBox = await media.locator(".video-player-failure").boundingBox();
    assert.ok(failureBox.x >= 0 && failureBox.x + failureBox.width <= width, "local error stays inside the viewport");
    await media.evaluate(() => { window.__failModal = false; });
    await media.getByRole("button", { name: "Reintentar", exact: true }).click();
    await expect(media.getByRole("button", { name: "Pausar video", exact: true })).toBeEnabled();
    await media.getByRole("button", { name: "Cerrar video", exact: true }).click();
    assert.equal(await media.evaluate(() => document.body.style.overflow), "");
    assert.equal(await media.getByRole("heading", { name: "La interfaz encontró un error" }).count(), 0);
    // React development reports caught lifecycle errors to window as well.
    assert.ok(errors.every(message => /QA (external render|iframe setup|modal render)/.test(message)), JSON.stringify(errors));
    await media.close();
    console.log(`PASS ${width}px: page retry, navigation recovery, isolated player setup, SDK controls, polling and teardown failures`);
  }
} finally { await browser.close(); }
