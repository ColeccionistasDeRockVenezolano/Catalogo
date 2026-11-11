// Recuperación con YouTube real; la pausa se introduce solo en esta sesión de QA.
// --bundle permite probar un candidato sin cambiar lo servido a otros oyentes.
/* global window, document */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';

const option = (name, fallback = '') => process.argv.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const base = option('base', 'http://127.0.0.1:3140');
const bundle = option('bundle');
const output = option('salida');
const browser = await chromium.launch();
const errors = [], reports = [];
let result = { base, candidate: Boolean(bundle), ok: false };
let qaPage;
async function pollValue(read, timeout = 20000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    const value = await read();
    if (value) return value;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error('No se confirmó la condición de reproducción dentro del plazo');
}
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  qaPage = page;
  if (bundle) await page.route('**/landing/radio.js?*', route => route.fulfill({ contentType: 'text/javascript', body: readFileSync(bundle, 'utf8') }));
  await page.addInitScript(() => {
    window.__radioQaPlayers = [];
    window.__radioQaDeferred = { enabled: false, boundaries: [], mainTicks: 0, boundaryTicks: 0 };
    const interval = window.setInterval.bind(window), timeout = window.setTimeout.bind(window);
    window.setInterval = function (fn, delay, ...args) {
      if (delay !== 1000 || typeof fn !== 'function') return interval(fn, delay, ...args);
      return interval(function () {
        if (window.__radioQaDeferred.enabled) { window.__radioQaDeferred.mainTicks++; return; }
        fn(...args);
      }, delay);
    };
    window.setTimeout = function (fn, delay, ...args) {
      if (typeof fn !== 'function') return timeout(fn, delay, ...args);
      const due = Date.now() + Number(delay || 0);
      return timeout(function () {
        const qa = window.__radioQaDeferred;
        if (qa.enabled && qa.boundaries.some(at => Math.abs(at - due) < 25)) { qa.boundaryTicks++; return; }
        fn(...args);
      }, delay);
    };
    let callback;
    Object.defineProperty(window, 'onYouTubeIframeAPIReady', {
      configurable: true, get: () => callback,
      set(fn) { callback = function () {
        const Original = window.YT.Player;
        window.YT.Player = function (...args) { const player = new Original(...args); window.__radioQaPlayers.push(player); return player; };
        window.YT.Player.prototype = Original.prototype;
        return fn.apply(this, arguments);
      }; },
    });
  });
  page.on('pageerror', error => errors.push(String(error)));
  page.on('response', response => {
    if (!response.url().endsWith('/api/radio/diagnostic')) return;
    const body = response.request().postDataJSON();
    if (body?.kind === 'playback_quality') reports.push({ status: response.status(), body });
  });
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  const button = page.locator('[data-radio-sync]');
  if (await button.getAttribute('data-radio-action') !== 'synced') { await button.focus(); await button.press('Enter'); }
  try {
    await page.waitForFunction(() => document.querySelector('[data-radio-sync]').getAttribute('data-radio-action') === 'sound'
      || window.__radioQaPlayers.some(p => p.getPlayerState?.() === 1 && !p.isMuted() && p.getVolume() > 0), null, { timeout: 30000 });
    if (await button.getAttribute('data-radio-action') === 'sound') { await button.focus(); await button.press('Enter'); }
    await page.waitForFunction(() => window.__radioQaPlayers.some(p => p.getPlayerState?.() === 1 && !p.isMuted() && p.getVolume() > 0), null, { timeout: 30000 });
  } catch (error) {
    console.error(JSON.stringify(await page.evaluate(() => ({ button: document.querySelector('[data-radio-sync]')?.textContent,
      players: window.__radioQaPlayers.map(p => ({ state: p.getPlayerState?.(), muted: p.isMuted?.(), volume: p.getVolume?.(), video: p.getVideoData?.()?.video_id })) }))));
    throw error;
  }
  // Evita introducir la pausa durante un relevo ajeno al objeto de esta prueba.
  await pollValue(() => page.evaluate(async () => {
    const now = await fetch('/api/radio/now').then(r => r.json());
    return now.phase === 'music' && Date.parse(now.endsAt) - Date.parse(now.serverTime) > 12000;
  }), 30000);
  if (process.argv.includes('--watch-transition')) {
    const plan = await page.evaluate(async () => {
      const now = await fetch('/api/radio/now').then(r => r.json());
      if (!now.sweeperSlot || now.phase !== 'music') throw new Error('Esta canción no cierra con viñeta');
      const end = Date.parse(now.endsAt), handoff = end + (now.sweeper.durationSeconds - now.sweeper.leadSeconds - now.sweeper.overlapSeconds) * 1000;
      window.__radioQaDeferred.boundaries = [end, handoff];
      return { outgoing: now.current.videoId, incoming: now.next.videoId, end, handoff };
    });
    result.plan = plan;
    const cover = await context.newPage(); await cover.goto('about:blank'); await cover.bringToFront();
    const nativeHidden = await page.evaluate(() => document.hidden);
    if (!nativeHidden) await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    const untilCue = Math.max(0, plan.end - Date.now() - 5500);
    await pollValue(() => Date.now() >= plan.end - 5500, untilCue + 5000);
    await page.evaluate(() => { window.__radioQaDeferred.enabled = true; });
    await pollValue(() => page.evaluate(async ({ incoming, handoff }) => {
      if (Date.now() < handoff) return false;
      const now = await fetch('/api/radio/now').then(r => r.json());
      const player = window.__radioQaPlayers.find(p => p.getVideoData?.()?.video_id === incoming && p.getPlayerState?.() === 1 && !p.isMuted() && p.getVolume() > 0);
      if (!player || now.current.videoId !== incoming) return false;
      const target = now.current.startSeconds + (Date.parse(now.serverTime) - Date.parse(now.startsAt)) / 1000;
      const position = player.getCurrentTime();
      window.__radioQaLastAlignment = { position, target, driftMs: Math.round((position - target) * 1000) };
      return Math.abs(position - target) < .75 && document.hidden;
    }, plan), Math.max(20000, plan.handoff - Date.now() + 20000));
    result = { ...result, ok: true, visibility: nativeHidden ? 'browser-tab' : 'simulated-document-hidden',
      observed: await page.evaluate(() => ({ hidden: document.hidden, deferred: window.__radioQaDeferred,
        alignment: window.__radioQaLastAlignment, label: document.querySelector('[data-radio-sync]').innerText })), errors };
    assert.ok(result.observed.deferred.mainTicks > 0);
    assert.ok(result.observed.deferred.boundaryTicks > 0);
    assert.deepEqual(errors, []);
    console.log(JSON.stringify(result, null, 2));
  } else if (process.argv.includes('--reload-entry')) {
    async function readAligned() {
      return page.evaluate(async () => {
        const now = await fetch('/api/radio/now').then(r => r.json());
        const player = window.__radioQaPlayers.find(p => p.getPlayerState?.() === 1 && !p.isMuted() && p.getVolume() > 0);
        if (!player || now.phase !== 'music') return false;
        const target = now.current.startSeconds + (Date.parse(now.serverTime) - Date.parse(now.startsAt)) / 1000;
        const position = player.getCurrentTime();
        window.__radioQaLastAlignment = { videoId: now.current.videoId, position, target, driftMs: Math.round((position - target) * 1000) };
        if (player.getVideoData().video_id !== now.current.videoId || Math.abs(position - target) >= .75) return false;
        return { videoId: now.current.videoId, title: now.current.title, position, target, driftMs: Math.round((position - target) * 1000) };
      });
    }
    const initial = await pollValue(readAligned);
    result.initial = initial;
    await page.reload({ waitUntil: 'domcontentloaded' });
    if (await button.getAttribute('data-radio-action') !== 'synced') { await button.focus(); await button.press('Enter'); }
    await page.waitForFunction(() => document.querySelector('[data-radio-sync]').getAttribute('data-radio-action') === 'sound'
      || window.__radioQaPlayers.some(p => p.getPlayerState?.() === 1 && !p.isMuted() && p.getVolume() > 0), null, { timeout: 30000 });
    if (await button.getAttribute('data-radio-action') === 'sound') { await button.focus(); await button.press('Enter'); }
    const afterReload = await pollValue(readAligned);
    result.afterReload = afterReload;
    const checkAt = Date.now();
    await page.waitForFunction(at => Date.now() - at >= 5000, checkAt);
    const settled = await pollValue(readAligned);
    assert.deepEqual(errors, []);
    result = { ...result, ok: true, initial, afterReload, settled, label: await button.innerText(), errors };
    console.log(JSON.stringify(result, null, 2));
  } else if (process.argv.includes('--pause-controls')) {
    const minimizeChat = page.getByRole('button', { name: 'Minimizar chat', exact: true });
    if (await minimizeChat.isVisible()) await minimizeChat.click();
    await page.waitForFunction(() => document.querySelector('[data-radio-sync]').getAttribute('data-radio-action') === 'synced');
    const restoredLabel = await button.innerText();
    assert.ok(restoredLabel.includes('Estás al día'));
    await page.evaluate(() => window.__radioQaPlayers.find(p => p.getPlayerState?.() === 1 && !p.isMuted()).pauseVideo());
    await page.waitForFunction(() => window.__radioQaPlayers.every(p => p.getPlayerState?.() !== 1));
    if (output && process.argv.includes('--screenshots')) {
      await page.locator('#radio').scrollIntoViewIfNeeded();
      await page.screenshot({ path: join(output, 'pausa-desktop.png') });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.locator('#radio').scrollIntoViewIfNeeded();
      await page.screenshot({ path: join(output, 'pausa-mobile.png') });
      await page.setViewportSize({ width: 1280, height: 800 });
    }
    const stoppedAt = Date.now();
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.waitForFunction(at => Date.now() - at >= 5000, stoppedAt);
    assert.ok(await page.evaluate(() => window.__radioQaPlayers.every(p => p.getPlayerState?.() !== 1)));
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await button.focus(); await button.press('Enter');
    await page.waitForFunction(() => window.__radioQaPlayers.some(p => p.getPlayerState?.() === 1 && !p.isMuted()));
    await page.evaluate(() => window.__radioQaPlayers.find(p => p.getPlayerState?.() === 1 && !p.isMuted()).pauseVideo());
    await page.waitForFunction(() => window.__radioQaPlayers.every(p => p.getPlayerState?.() !== 1));
    const videoStoppedAt = Date.now();
    await page.waitForFunction(at => Date.now() - at >= 5000, videoStoppedAt);
    assert.ok(await page.evaluate(() => window.__radioQaPlayers.every(p => p.getPlayerState?.() !== 1)));
    const directPlay = page.locator('[data-radio-video-resume]');
    assert.ok(await directPlay.isVisible());
    // Clic real sobre la imagen del video; la capa pausada distingue la intención.
    await directPlay.click();
    const directResume = await pollValue(() => page.evaluate(async () => {
      const now = await fetch('/api/radio/now').then(r => r.json());
      const player = window.__radioQaPlayers.find(p => p.getPlayerState?.() === 1 && !p.isMuted() && p.getVolume() > 0);
      if (!player || now.phase !== 'music') return false;
      const target = now.current.startSeconds + (Date.parse(now.serverTime) - Date.parse(now.startsAt)) / 1000;
      const position = player.getCurrentTime();
      if (player.getVideoData().video_id !== now.current.videoId || Math.abs(position - target) >= 0.75) return false;
      return { position, target };
    }), 20000);
    assert.ok(Number.isFinite(directResume.position) && Math.abs(directResume.position - directResume.target) < 0.75, JSON.stringify(directResume));
    assert.deepEqual(errors, []);
    result = { ...result, ok: true, syncedLabelRestored: restoredLabel, videoPauseSurvivesHidden: true, explicitResume: true, visibleVideoPauseRespected: true, directVideoResume: directResume, errors };
    console.log(JSON.stringify(result, null, 2));
  } else {
  const cover = await context.newPage(); await cover.goto('about:blank'); await cover.bringToFront();
  const nativeHidden = await page.evaluate(() => document.hidden);
  if (!nativeHidden) await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  if (process.argv.includes('--defer-main')) await page.evaluate(() => { window.__radioQaDeferred.enabled = true; });
  const introduced = await page.evaluate(() => {
    const player = window.__radioQaPlayers.find(p => p.getPlayerState?.() === 1 && !p.isMuted() && p.getVolume() > 0);
    if (!player) throw new Error('No hay un reproductor activo para introducir la pausa');
    const commands = [], originalPlay = player.playVideo.bind(player), originalLoad = player.loadVideoById.bind(player), originalSeek = player.seekTo.bind(player);
    window.__radioQaRecovery = { player, commands, at: Date.now() };
    player.playVideo = function () {
      commands.push({ kind: 'play', at: Date.now() });
      if (commands.filter(c => c.kind === 'play').length > 1) return originalPlay();
      // Primer intento perdido: el vigilante debe recuperarse sin intervención.
    };
    player.loadVideoById = function (segment) { commands.push({ kind: 'load', at: Date.now(), segment }); return originalLoad(segment); };
    player.seekTo = function (position, allowSeekAhead) { commands.push({ kind: 'seek', at: Date.now(), position }); return originalSeek(position, allowSeekAhead); };
    const videoId = player.getVideoData().video_id;
    player.pauseVideo();
    return { at: Date.now(), videoId, hidden: document.hidden };
  });
  await page.waitForFunction(() => {
    const qa = window.__radioQaRecovery;
    return qa.commands.some(c => c.kind === 'load') && qa.player.getPlayerState() === 1 && !qa.player.isMuted();
  }, null, { timeout: 15000 });
  await pollValue(() => page.evaluate(async () => {
    const qa = window.__radioQaRecovery;
    if (qa.player.getPlayerState() !== 1) return false;
    const now = await fetch('/api/radio/now').then(r => r.json());
    const expected = now.current.startSeconds + (Date.parse(now.serverTime) - Date.parse(now.startsAt)) / 1000;
    return now.phase === 'music' && Math.abs(qa.player.getCurrentTime() - expected) < 1;
  }), 10000);
  const recovered = await page.evaluate(async () => {
    const qa = window.__radioQaRecovery, now = await fetch('/api/radio/now').then(r => r.json());
    const expected = now.current.startSeconds + (Date.parse(now.serverTime) - Date.parse(now.startsAt)) / 1000;
    return { at: Date.now(), commands: qa.commands, currentVideo: qa.player.getVideoData().video_id,
      position: qa.player.getCurrentTime(), expected, phase: now.phase, visible: !document.hidden,
      deferred: window.__radioQaDeferred };
  });
  assert.equal(recovered.currentVideo, introduced.videoId);
  assert.ok(Math.abs(recovered.position - recovered.expected) < 1, 'recuperación fuera del reloj de emisión');
  assert.ok(recovered.at - introduced.at < 15000);
  await page.waitForFunction(() => Boolean(window.__radioQaRecovery), null, { timeout: 1000 });
  // Espera por una medición real que incluya los dos intentos de recuperación.
  const measured = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { clearInterval(poll); reject(new Error('No llegó la medición de recuperación en 40 s')); }, 40000);
    const poll = setInterval(() => {
      const match = reports.find(report => report.body.measurement.pieces.some(p => p.videoId === introduced.videoId && p.recoveryAttempts >= 2));
      if (match) { clearTimeout(timer); clearInterval(poll); resolve(match); }
    }, 100);
  });
  assert.equal(measured.status, 204);
  assert.ok(measured.body.playback, 'falta el contexto interno en el lote periódico');
  assert.deepEqual(errors, []);
  result = { ...result, ok: true, visibility: nativeHidden ? 'browser-tab' : 'simulated-document-hidden', introduced, recovered, measured, errors };
  console.log(JSON.stringify(result, null, 2));
  }
} finally {
  if (!result.ok && qaPage) {
    try { result.debug = await qaPage.evaluate(() => ({ action: document.querySelector('[data-radio-sync]')?.getAttribute('data-radio-action'), label: document.querySelector('[data-radio-sync]')?.textContent,
      lastAlignment: window.__radioQaLastAlignment,
      players: window.__radioQaPlayers.map(p => ({ state: p.getPlayerState?.(), muted: p.isMuted?.(), video: p.getVideoData?.()?.video_id })) })); console.error(JSON.stringify(result.debug)); } catch { /* página cerrada */ }
  }
  await browser.close();
  if (output) writeFileSync(join(output, 'recuperacion-dominio.json'), JSON.stringify({ ...result, reports, errors }, null, 2) + '\n');
}
