import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';

// Exercise both real providers under StrictMode. No production data or YouTube calls.
const base = process.env.CRV_WEB_URL ?? 'http://127.0.0.1:5173';
const api = `window.YT={Player:class {
  constructor(frame,options){this.frame=frame;this.events=options.events;this.state=2;queueMicrotask(()=>options.events.onReady({target:this}));}
  getCurrentTime(){return 0;}getDuration(){return 240;}getPlayerState(){return this.state;}
  seekTo(){}setVolume(){}mute(){}unMute(){}
  playVideo(){this.state=1;this.events.onStateChange({target:this,data:1});}
  pauseVideo(){this.state=2;this.events.onStateChange({target:this,data:2});}
  destroy(){this.frame.remove();}
}};window.onYouTubeIframeAPIReady();`;
const browser = await chromium.launch({headless:true});
try {
  for (const width of [1440,390,320]) {
    const page = await browser.newPage({viewport:{width,height:960},reducedMotion:'reduce'});
    page.setDefaultTimeout(10000);
    const errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.route('**/src/main.tsx*',route=>route.fulfill({contentType:'text/javascript',body:'import "/tests/visual/media-player-harness.tsx";'}));
    await page.route('https://www.youtube.com/iframe_api',route=>route.fulfill({contentType:'text/javascript',body:api}));
    await page.route(/https:\/\/www.youtube-nocookie.com\/embed\//,route=>route.fulfill({contentType:'text/html',body:'<body><button>Reproducir plataforma</button></body>'}));
    await page.route(/https:\/\/w.soundcloud.com\//,route=>route.fulfill(route.request().url().endsWith('api.js') ? {contentType:'text/javascript',body:'window.SC={Widget:Object.assign(()=>({bind(){},unbind(){},pause(){}}),{Events:{PLAY:"play"}})};'} : {contentType:'text/html',body:'<body>Audio</body>'}));
    const go = name=>page.getByRole('link',{name,exact:true}).click();
    const catalog=page.locator('.catalog-video-player');
    const external=page.locator('.listen-embed');
    const floats=page.locator('.video-layer--floating');
    await page.goto(`${base}/__qa_media`);

    // Loading a paused album is not a request for a persistent window.
    await go('Disco de prueba');
    await expect(catalog).toBeVisible();
    await go('Otra página');
    await expect(catalog).toHaveCount(0);
    await expect(floats).toHaveCount(0);

    // The reported sequence: album floating -> artist embed untouched -> home.
    await go('Disco de prueba');
    await catalog.getByRole('button',{name:'Modo cine',exact:true}).click();
    await catalog.getByRole('button',{name:'Video flotante',exact:true}).click();
    await page.evaluate(()=>{window.__originalFrame=document.querySelector('.catalog-video-player iframe');});
    await go('Artista de prueba');
    await expect(page.locator('.listen-embed:not(.listen-embed--floating)')).toBeVisible();
    await expect(floats).toHaveCount(1);
    await go('Inicio');
    await expect(page.locator('iframe[title="Artista de prueba en YouTube"]')).toHaveCount(0);
    await expect(floats).toHaveCount(1);
    assert.equal(await page.evaluate(()=>window.__originalFrame===document.querySelector('.catalog-video-player iframe')),true);

    // Returning to inline removes the persistence choice for the next departure.
    await catalog.getByRole('button',{name:'Mostrar reproductor pequeño',exact:true}).click();
    await catalog.getByRole('button',{name:'Volver al disco',exact:true}).click();
    await expect(page.locator('.catalog-video-player--inline')).toBeVisible();
    assert.equal(await page.evaluate(()=>window.__originalFrame===document.querySelector('.catalog-video-player iframe')),true);
    await go('Otra página');
    await expect(catalog).toHaveCount(0);
    await go('Disco de prueba');
    await catalog.getByRole('button',{name:'Modo cine',exact:true}).click();
    await catalog.getByRole('button',{name:'Video flotante',exact:true}).click();

    // Explicitly floating the artist replaces even an unplayed album window.
    await go('Artista de prueba');
    await external.locator('.media-player__toolbar').getByRole('button',{name:'Modo cine',exact:true}).click();
    await external.getByRole('button',{name:'Video flotante',exact:true}).click();
    await expect(catalog).toHaveCount(0);
    await expect(floats).toHaveCount(1);
    await page.evaluate(()=>{window.__externalFrame=document.querySelector('.listen-embed iframe');});
    await go('Inicio');
    await expect(floats).toHaveCount(1);
    assert.equal(await page.evaluate(()=>window.__externalFrame===document.querySelector('.listen-embed--floating iframe')),true);

    // A second paused album may render inline; floating it claims the single window.
    await go('Disco de prueba');
    await expect(catalog).toBeVisible();
    await expect(floats).toHaveCount(1);
    await catalog.getByRole('button',{name:'Modo cine',exact:true}).click();
    await catalog.getByRole('button',{name:'Video flotante',exact:true}).click();
    await expect(external).toHaveCount(0);
    await expect(floats).toHaveCount(1);
    await catalog.getByRole('button',{name:'Cerrar video',exact:true}).click();
    await expect(floats).toHaveCount(0);

    // Focusing an inline cross-origin iframe is playback intent, not float intent.
    await go('Artista de prueba');
    await page.frameLocator('iframe[title="Artista de prueba en YouTube"]').getByRole('button').click();
    await expect(external.locator('.media-player__identity')).toContainText('Sesión activa');
    await go('Otra página');
    await expect(external).toHaveCount(0);
    await expect(floats).toHaveCount(0);

    // A playing album must also leave with its page unless floated explicitly.
    await go('Disco de prueba');
    await catalog.getByRole('button',{name:'Reproducir video',exact:true}).click();
    await go('Otra página');
    await expect(catalog).toHaveCount(0);
    await expect(floats).toHaveCount(0);
    assert.deepEqual(errors,[]);
    assert.equal(await page.evaluate(()=>document.body.style.overflow),'');
    console.log(`PASS ${width}px: passive navigation, explicit float persistence, cross-provider replacement, focus without auto-float`);
    await page.close();
  }
} finally {await browser.close();}
