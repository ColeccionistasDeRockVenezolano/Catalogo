import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';

// Real provider and album page, deterministic YouTube transport; no database writes.
const baseUrl = process.env.CRV_WEB_URL ?? 'http://127.0.0.1:5173';
const videoId = 'Q-pRpO2sYSI';
const album = {
  id: 57, title: 'Disco de prueba', releaseYear: 2000, albumType: 'studio',
  artist: { id: 58, name: 'Artista de prueba' }, credits: [], creditsByType: {}, scopedCreditsByType: {},
  formats: [], aliases: [], platforms: [],
  tracklist: [
    { id: 1, discNumber: 1, trackNumber: 1, title: 'Primera pista', youtubeStartSeconds: 0, credits: [] },
    { id: 2, discNumber: 1, trackNumber: 2, title: 'Segunda pista con un título extenso para comprobar el ajuste en teléfonos pequeños', youtubeStartSeconds: 184, credits: [] },
  ],
  youtubeLinks: [{ videoId, title: 'Disco completo', kind: 'full_album', isPrimaryLink: true }],
};
const iframeApi = `
window.__youtubeCalls = [];
window.YT = { Player: class {
  constructor(iframe, options) {
    this.iframe = iframe; this.events = options.events; this.time = 0; this.state = 2;
    window.__player = this;
    queueMicrotask(() => this.events.onReady({target:this}));
  }
  getCurrentTime() { return this.time; }
  getDuration() { return 3682; }
  getPlayerState() { return this.state; }
  seekTo(seconds) { this.time=seconds; window.__youtubeCalls.push(['seek', seconds]); }
  playVideo() { this.state=1; this.events.onStateChange({target:this,data:1}); }
  pauseVideo() { this.state=2; this.events.onStateChange({target:this,data:2}); }
  setVolume(value) { this.volume=value; window.__youtubeCalls.push(['volume',value]); }
  mute() { this.muted=true; window.__youtubeCalls.push(['mute']); }
  unMute() { this.muted=false; window.__youtubeCalls.push(['unmute']); }
  destroy() { this.iframe.remove(); }
}};
window.onYouTubeIframeAPIReady();`;
const browser = await chromium.launch({ headless: true });
try {
  for (const viewport of [{width:1920,height:1080}, {width:1366,height:768}, {width:1024,height:768}, {width:844,height:390}, {width:768,height:1024}, {width:600,height:800}, {width:480,height:800}, {width:390,height:844}, {width:360,height:640}, {width:320,height:568}, {width:280,height:653}]) {
    if (process.env.CRV_PLAYER_QA_VIEWPORT && viewport.width !== Number(process.env.CRV_PLAYER_QA_VIEWPORT)) continue;
    const context = await browser.newContext({ viewport, hasTouch: viewport.width < 680, reducedMotion: 'reduce' });
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('https://www.youtube.com/iframe_api', route => route.fulfill({contentType:'text/javascript',body:iframeApi}));
    await page.route('https://www.youtube-nocookie.com/embed/**', route => route.fulfill({contentType:'text/html',body:'<!doctype html><body style="background:#08090b;color:white">Video de prueba</body>'}));
    await page.route('**/albums/57', route => route.fulfill({json:album}));
    await page.route('**/site-appearance', route => route.fulfill({json:{catalogTheme:'current',updatedAt:null}}));
    await page.route('**/auth/me', route => route.fulfill({json:{user:null}}));
    await page.goto(`${baseUrl}/discos/57`);
    const player = page.locator('.catalog-video-player');
    await page.getByRole('button',{name:'Reproducir video',exact:true}).waitFor();
    await page.getByRole('button',{name:'Avanzar 10 segundos',exact:true}).click();
    assert.equal(await page.evaluate(() => window.__player.time),10);
    await page.getByRole('button',{name:'Retroceder 10 segundos',exact:true}).click();
    assert.equal(await page.evaluate(() => window.__player.time),0);
    await page.getByRole('button',{name:'Reproducir video',exact:true}).click();
    await page.getByRole('button',{name:'Pausar video',exact:true}).click();
    const volume = page.locator('.catalog-video-player__volume-trigger');
    const slider = page.getByRole('slider',{name:'Volumen',exact:true});
    if (viewport.width >= 680) {
      await volume.hover();
      await slider.waitFor({state:'visible'});
      // Cruzar el espacio entre botón y barra no debe cerrarla.
      const triggerBox = await volume.boundingBox();
      await page.mouse.move(triggerBox.x+22,triggerBox.y-4);
      await slider.hover();
    } else {
      await volume.tap();
      assert.equal(await page.evaluate(() => window.__player.muted),true,'el toque silencia el motor');
    }
    await slider.fill('35');
    assert.deepEqual(await page.evaluate(() => [window.__player.volume,window.__player.muted]),[35,false]);
    await volume.click();
    assert.equal(await page.evaluate(() => window.__player.muted),true,'clic silencia de verdad');
    await volume.click();
    assert.deepEqual(await page.evaluate(() => [window.__player.volume,window.__player.muted]),[35,false],'recupera el volumen anterior');
    await volume.focus();
    await slider.fill('0');
    assert.equal(await page.evaluate(() => window.__player.muted),true,'volumen cero también silencia');
    await volume.click();
    assert.deepEqual(await page.evaluate(() => [window.__player.volume,window.__player.muted]),[35,false],'desde cero restaura el último volumen audible');
    await slider.press('Escape');
    assert.equal(await volume.getAttribute('aria-expanded'),'false');
    await volume.press('Tab');
    // Volver por teclado abre la barra sin cambiar el sonido.
    await volume.focus();
    await slider.waitFor({state:'visible'});
    await slider.press('ArrowDown');
    await slider.press('Escape');
    await page.locator('.video-player__queue summary').click();
    await page.locator('.video-player__queue button').nth(1).click();
    assert.equal(await page.evaluate(() => window.__player.time),184);
    await page.locator('.video-player__queue summary').click();
    const iframe = await player.locator('iframe').elementHandle();
    await page.getByRole('button',{name:'Modo cine',exact:true}).click();
    assert.ok(await iframe.evaluate(node => node===document.querySelector('.catalog-video-player iframe')));
    assert.ok(await player.evaluate(node => node.scrollWidth <= node.clientWidth), 'el panel no desborda');
    for (const button of await page.locator('.catalog-video-player__playback button').all()) {
      const box = await button.boundingBox();
      assert.ok(box.width>=44 && box.height>=44, 'área táctil mínima');
      assert.ok(box.x>=0 && box.x+box.width<=viewport.width,'control dentro de pantalla');
      await button.focus();
      assert.equal(await button.evaluate(node => getComputedStyle(node).outlineStyle),'none');
    }
    if(process.env.CRV_PLAYER_CAPTURE_DIR) await page.screenshot({path:`${process.env.CRV_PLAYER_CAPTURE_DIR}/controls-${viewport.width}x${viewport.height}.png`});
    await page.getByRole('button',{name:'Video flotante',exact:true}).click();
    await page.getByRole('button',{name:'Mostrar reproductor pequeño',exact:true}).click();
    assert.ok(await iframe.evaluate(node => node===document.querySelector('.catalog-video-player iframe')));
    assert.ok(await player.evaluate(node => node.scrollWidth<=node.clientWidth), 'flotante sin desbordamiento');
    for (const button of await page.locator('.catalog-video-player__playback button').all()) {
      const box = await button.boundingBox();
      const panel = await player.boundingBox();
      assert.ok(box.width>=44 && box.height>=44);
      assert.ok(box.x>=panel.x && box.x+box.width<=panel.x+panel.width+1, 'controles dentro del flotante');
    }
    await volume.hover();
    await slider.waitFor({state:'visible'});
    await slider.fill('62');
    await volume.click();
    assert.equal(await page.evaluate(() => window.__player.muted),true,'silencio real también en flotante');
    if(process.env.CRV_PLAYER_CAPTURE_DIR) await page.screenshot({path:`${process.env.CRV_PLAYER_CAPTURE_DIR}/floating-${viewport.width}x${viewport.height}.png`});
    assert.deepEqual(errors,[]);
    console.log(`OK ${viewport.width}x${viewport.height}: transporte, volumen, lista, foco y modos persistentes`);
    await context.close();
  }
} finally { await browser.close(); }
