import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';

const base = process.env.CRV_WEB_URL ?? 'http://127.0.0.1:5174';
const out = process.env.CRV_HOME_QA_DIR ?? '/tmp/crv-home-new';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true });
const results = [];
try {
  if (process.env.CRV_HOME_QA_MODE !== "motion") await Promise.all([{ name: 'desktop', width: 1440, height: 1000 }, { name: 'mobile', width: 390, height: 844 }].map(async view => {
    const page = await browser.newPage({ viewport: { width: view.width, height: view.height } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error' && !message.text().startsWith('Failed to load resource:')) errors.push(message.text()); });
    await page.goto(base, { waitUntil: 'networkidle' });
    await page.locator('.home-featured__name').waitFor();
    await page.waitForTimeout(1000);
    await page.screenshot({ path: `${out}/${view.name}-top.png` });
    for (let y = 0; y < await page.evaluate(() => document.body.scrollHeight); y += 650) {
      await page.evaluate(y => window.scrollTo(0, y), y); await page.waitForTimeout(180);
    }
    await page.waitForTimeout(1000); await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: `${out}/${view.name}-full.png`, fullPage: true });
    const visual = await page.evaluate(() => ({
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      broken: [...document.images].filter(image => image.complete && !image.naturalWidth).map(image => image.src),
      photoTransform: getComputedStyle(document.querySelector('.home-featured__media')).transform,
      photoShadow: getComputedStyle(document.querySelector('.home-featured__media')).boxShadow,
      accentBackground: getComputedStyle(document.querySelector('.home-hero__accent')).backgroundImage,
      adviceOverlay: Boolean(document.querySelector('.home-hero .search-example-hint')),
      smallDots: [...document.querySelectorAll('.home-listen__dot')].some(button => button.getBoundingClientRect().height < 44),
      genreTransform: getComputedStyle(document.querySelector('.home-genre')).transform,
      decadeBackground: getComputedStyle(document.querySelector('.home-decades__bar')).backgroundImage,
    }));
    assert.equal(visual.overflow, 0); assert.deepEqual(visual.broken, []);
    assert.equal(visual.photoTransform, 'none'); assert.equal(visual.photoShadow, 'none');
    assert.equal(visual.accentBackground, 'none'); assert.equal(visual.adviceOverlay, false);
    assert.equal(visual.smallDots, false); assert.equal(visual.genreTransform, 'none');
    assert.equal(visual.decadeBackground, 'none'); assert.deepEqual(errors, []);
    const oldAlbum = await page.locator('.home-listen__title').innerText();
    await page.locator('.home-listen__next').click();
    assert.notEqual(await page.locator('.home-listen__title').innerText(), oldAlbum);
    await page.locator('.home-video__open').first().click();
    const player = page.locator('.catalog-video-player'); await player.waitFor();
    assert.match(await player.locator('iframe').getAttribute('src'), /youtube-nocookie\.com\/embed\//);
    await player.getByRole('link', { name: 'Abrir desde YouTube' }).waitFor();
    await page.waitForTimeout(2500);
    await page.screenshot({ path: `${out}/${view.name}-video.png` });
    await player.getByRole('button', { name: 'Cerrar video' }).click(); await player.waitFor({ state: 'hidden' });
    await page.getByRole('link', { name: /Antes de 1950/ }).click();
    await page.waitForURL(/decada=antes-1950/);
    await page.waitForTimeout(1000);
    assert.match(await page.locator('body').innerText(), /Antes de 1950/);
    results.push({ view: view.name, ...visual, nextAlbum: true, videoInline: true, earlyAlbums: true, errors });
    await page.close();
  }));
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.locator('.home-wall__current').first().waitFor();
  console.log("Comprobando rotación y carruseles con el reloj real del navegador");
  const covers = () => page.locator('.home-wall__current').evaluateAll(images => images.map(image => image.src));
  const before = await covers(); await page.waitForTimeout(6600); const after = await covers();
  const replaced = before.filter((src, index) => src !== after[index]).length;
  assert.ok([3, 4, 6].includes(replaced), `Cambió ${replaced} portadas`);
  await page.locator('#home-anniversaries').scrollIntoViewIfNeeded();
  await page.waitForTimeout(500); await page.mouse.move(0, 0);
  const rail = page.locator('#home-anniversaries .home-rail');
  await page.waitForTimeout(7200); await page.waitForTimeout(800);
  const advanced = await rail.evaluate(node => node.scrollLeft); assert.ok(advanced > 0, 'El carrusel debe avanzar solo');
  await page.locator('#home-anniversaries h2').hover();
  const hoverPosition = await rail.evaluate(node => node.scrollLeft);
  await page.waitForTimeout(8000);
  assert.notEqual(await rail.evaluate(node => node.scrollLeft), hoverPosition, 'Hover conserva el avance');
  const group = await page.locator('#home-anniversaries h2').innerText();
  await rail.evaluate(node => node.scrollTo({left:node.scrollWidth,behavior:'instant'}));
  await page.waitForFunction(old => document.querySelector('#home-anniversaries h2').textContent !== old, group, {timeout:8500});
  await page.getByRole('button', { name: /Pausar avance automático de los discos/ }).click();
  await page.mouse.move(0, 0); const pausedAt = await rail.evaluate(node => node.scrollLeft);
  await page.waitForTimeout(15000); await page.waitForTimeout(500);
  assert.equal(await rail.evaluate(node => node.scrollLeft), pausedAt, 'La pausa manual debe mantenerse');
  await page.close();
  const reduced = await browser.newPage({ reducedMotion: 'reduce' });
  await reduced.goto(base, { waitUntil: 'networkidle' });
  const initial = await reduced.locator('.home-wall__current').evaluateAll(images => images.map(image => image.src));
  await reduced.waitForTimeout(16000);
  assert.deepEqual(await reduced.locator('.home-wall__current').evaluateAll(images => images.map(image => image.src)), initial);
  await reduced.close();
  results.push({ randomCovers: replaced, autoRail: true, hoverDoesNotPause: true, singleCycle: true, manualPause: true, reducedMotion: true });
  await writeFile(`${out}/checks.json`, JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
} finally { await browser.close(); }
