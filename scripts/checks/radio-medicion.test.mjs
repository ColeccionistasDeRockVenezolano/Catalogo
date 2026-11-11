import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const clientFiles = process.env.RADIO_MEASUREMENT_SOURCE && process.env.RADIO_MEASUREMENT_BUNDLE
  ? [process.env.RADIO_MEASUREMENT_SOURCE, process.env.RADIO_MEASUREMENT_BUNDLE]
  : ['../../src/landing/client/radio.js', '../../web/public/landing/radio.js'];

// Se evalúa el código real, incluido el bundle servido. El cliente de la
// tarjeta sale porque no hay DOM; su medidor puro sigue siendo comprobable.
for (const file of clientFiles) {
  const source = readFileSync(new URL(file, import.meta.url), 'utf8');
  function meter() {
    return runInNewContext(source + '\ncreateRadioPlaybackMeter();', { document: { getElementById: () => null } });
  }
  const plan = (id, startMs = 0, endMs = 5000, kind = 'music', offsetMs = 100000) => ({ id, kind, startMs, endMs, offsetMs, videoId: kind === 'music' ? 'video' : null });
  const playing = (id, time, offset = 100000) => ({ id, state: 'playing', matches: true, muted: false, positionMs: offset + time });
  const sample = (m, time, sources, extra = {}) => m.sample({ monoMs: time, serverMs: time, expected: true, sources, ...extra });
  const piece = m => m.flush('test').pieces[0];

  test(`${file}: reproducción puntual, posición real y final acumulado sin duplicar`, () => {
    const m = meter(); m.plan(plan('a'));
    for (let t = 0; t <= 7000; t += 250) sample(m, t, [playing('a', t)]);
    const p = piece(m);
    assert.equal(p.startDelayMs, 0); assert.equal(p.firstDriftMs, 0);
    assert.equal(p.observedMs, 5000); assert.equal(p.interruptedMs, 0);
    assert.equal(p.outcome, 'ended'); assert.deepEqual(Array.from(p.issues), []);
    m.plan(plan('a')); sample(m, 7250, []);
    assert.equal(m.flush('test').pieces.length, 0);
  });

  test(`${file}: mide un corte de 750 ms sin esperar 30 segundos`, () => {
    const m = meter(); m.plan(plan('a'));
    for (let t = 0; t <= 3000; t += 250) {
      const s = playing('a', t);
      if (t >= 1000 && t < 1750) s.state = 'buffering';
      sample(m, t, [s]);
    }
    const p = piece(m);
    assert.equal(p.interruptedMs, 750); assert.equal(p.bufferingMs, 750); assert.ok(p.issues.includes('interruption'));
  });

  test(`${file}: PLAYING con posición inmóvil se distingue de progreso`, () => {
    const m = meter(); m.plan(plan('a'));
    for (let t = 0; t <= 4000; t += 250) sample(m, t, [playing('a', Math.min(t, 1000))]);
    const p = piece(m);
    assert.ok(p.frozenMs >= 1500); assert.ok(p.issues.includes('frozen'));
    assert.equal(p.maxBehindMs, 3000); assert.ok(p.issues.includes('drift'));
  });

  test(`${file}: suspender temporizadores no demuestra silencio`, () => {
    const m = meter(); m.plan(plan('a', 0, 20000));
    sample(m, 0, [playing('a', 0)]); sample(m, 10000, [playing('a', 10000)], { hidden: true });
    const p = piece(m);
    assert.equal(p.unobservedMs, 10000); assert.equal(p.interruptedMs, 0); assert.equal(p.frozenMs, 0);
    assert.equal(m.flush('test').counters.unobservedMs, 10000);
  });

  test(`${file}: corrección del reloj se conserva como intervalo incierto`, () => {
    const m = meter(); m.plan(plan('a', 0, 20000));
    sample(m, 0, [playing('a', 0)]);
    sample(m, 250, [playing('a', 250)], { serverMs: 5250 });
    assert.equal(piece(m).unobservedMs, 250);
    assert.equal(m.flush('test').counters.unobservedMs, 250);
  });

  test(`${file}: pausa y silencio voluntarios quedan excluidos`, () => {
    const m = meter(); m.plan(plan('a'));
    for (let t = 0; t <= 4000; t += 250) {
      const paused = t >= 1000 && t < 3000;
      sample(m, t, paused ? [] : [playing('a', t)], { expected: !paused });
    }
    const p = piece(m);
    assert.equal(p.excludedMs, 2000); assert.equal(p.interruptedMs, 0);
  });

  test(`${file}: registra entrada anticipada, tardía y video equivocado`, () => {
    const m = meter(); m.plan(plan('early', 2000, 7000)); m.plan(plan('late', 2000, 7000, 'music', 200000));
    for (let t = 0; t <= 5000; t += 250) {
      const sources = [playing('early', t)];
      if (t >= 2000) sources.push({ ...playing('late', t - 2000, 200000), matches: t >= 3500 });
      sample(m, t, sources);
    }
    const ps = m.flush('test').pieces;
    const early = ps.find(p => p.id === 'early'), late = ps.find(p => p.id === 'late');
    assert.equal(early.startDelayMs, -2000); assert.ok(early.issues.includes('early_start'));
    assert.equal(late.startDelayMs, 1500); assert.equal(late.wrongVideoMs, 1500);
    assert.ok(late.issues.includes('late_start')); assert.ok(late.issues.includes('wrong_video'));
  });

  test(`${file}: cuña y colas solapadas no cuentan como silencio global`, () => {
    const m = meter();
    m.plan(plan('a', 0, 3000)); m.plan(plan('cue', 2000, 5000, 'identifier', 0)); m.plan(plan('b', 4000, 8000, 'music', 200000));
    for (let t = 0; t <= 7000; t += 250) {
      const s = [];
      if (t < 3000) s.push(playing('a', t));
      if (t >= 2000 && t < 5000) s.push(playing('cue', t - 2000, 0));
      if (t >= 4000) s.push(playing('b', t - 4000, 200000));
      sample(m, t, s);
    }
    const result = m.flush('test');
    assert.equal(result.counters.interruptedMs, 0); assert.equal(result.pieces.length, 3);
    assert.equal(result.pieces.find(p => p.id === 'cue').kind, 'identifier');
  });

  test(`${file}: redondeo de 1 ms, bloqueo de autoplay e incorporación a mitad`, () => {
    const m = meter(); m.plan(plan('a', 0, 10000)); m.plan(plan('alias', 1, 10001));
    m.event('alias', 'autoplay_blocked'); m.event('alias', 'player_error');
    sample(m, 5000, [playing('alias', 5000)]);
    const p = piece(m);
    assert.equal(p.joinedMidPiece, true); assert.equal(p.autoplayBlocks, 1);
    assert.equal(p.playerErrors, 1); assert.ok(!p.issues.includes('late_start'));
    assert.equal(m.flush('test').pieces.length, 1);
  });

  test(`${file}: metadatos ausentes se marcan sin verificar`, () => {
    const m = meter(); m.plan(plan('a'));
    for (let t = 0; t <= 1000; t += 250) sample(m, t, [{ ...playing('a', t), matches: null }]);
    const p = piece(m);
    assert.equal(p.unverifiedMs, 1000); assert.equal(p.wrongVideoMs, 0); assert.equal(p.firstPlayingAt, null);
  });

  test(`${file}: mantiene medición después de veinte canciones`, () => {
    const m = meter(); let count = 0;
    for (let n = 0; n < 35; n += 1) {
      const start = n * 10000, id = String(n);
      m.plan(plan(id, start, start + 5000));
      for (let t = start; t <= start + 7000; t += 250) sample(m, t, [playing(id, t - start)]);
      count += m.flush('periodic').pieces.filter(p => p.outcome === 'ended').length;
    }
    assert.equal(count, 35);
  });
}

// Integra el medidor con el cliente, los eventos y el transporte reales.
function clientHarness(file, { apple = false, android = false, diagnosticStatuses = [] } = {}) {
  let time = 1794355200000, mono = 0;
  const timers = [], requests = [], handlers = {}, players = [];
  const element = () => {
    const attrs = new Map();
    return { getAttribute: key => attrs.get(key) ?? null, setAttribute: (key, value) => attrs.set(key, String(value)),
      removeAttribute: key => attrs.delete(key), querySelector: () => null, appendChild() {},
      classList: { toggle() {}, add() {}, remove() {} }, style: { setProperty() {} } };
  };
  const item = { videoId: 'abcdefghijk', title: 'Canción de prueba', artist: 'Prueba', startSeconds: 100, durationSeconds: 300 };
  const snapshot = { phase: 'music', current: item, upcoming: [], next: null, sweeperSlot: false, crossfadeSeconds: 0,
    startsAt: new Date(time).toISOString(), endsAt: new Date(time + 300000).toISOString(), serverTime: new Date(time).toISOString() };
  const root = element(), frame = { ...element(), parentNode: element() };
  for (const [name, value] of Object.entries({ 'data-radio-api': '/now', 'data-radio-listener-api': '/listener', 'data-radio-diagnostic-api': '/diagnostic',
    'data-radio-video-id': item.videoId, 'data-radio-starts-at': snapshot.startsAt, 'data-radio-start-seconds': '100' })) root.setAttribute(name, value);
  class Clock extends Date { constructor(...args) { super(...(args.length ? args : [time])); } static now() { return time; } }
  class Xhr {
    open(method, url) { this.url = url; this.method = method; }
    setRequestHeader() {}
    send(body) {
      requests.push({ url: this.url, body: body ? JSON.parse(body) : null });
      this.status = this.url === '/diagnostic' ? (diagnosticStatuses.shift() ?? 204) : 200;
      this.readyState = 4;
      this.responseText = JSON.stringify(this.url === '/now' ? { ...snapshot, serverTime: new Date(time).toISOString() } : { listeners: 1 });
      this.onreadystatechange?.();
    }
  }
  const window = {
    location: { origin: 'http://localhost' }, performance: { now: () => mono },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    setInterval(fn, ms) { timers.push({ fn, ms }); }, clearInterval() {}, setTimeout() {}, clearTimeout() {},
    matchMedia: () => ({ matches: false }), addEventListener(name, fn) { (handlers[name] ??= []).push(fn); },
    YT: { Player: function (_id, options) {
      const player = { events: options.events, state: -1, at: 100, muted: false, volume: 100,
        getPlayerState() { return this.state; }, getCurrentTime() { return this.at; },
        getVideoData: () => ({ video_id: item.videoId }), getIframe: element,
        getVideoLoadedFraction: () => 1, getVolume() { return this.volume; }, isMuted() { return this.muted; },
        setVolume(v) { this.volume = v; }, mute() { this.muted = true; }, unMute() { this.muted = false; },
        seekTo(at) { this.at = at; }, pauseVideo() { this.state = 2; }, playVideo() { this.state = 1; },
        loadVideoById(segment) { this.at = segment.startSeconds; this.state = 1; }, cueVideoById() {},
      };
      players.push(player); return player;
    } },
  };
  runInNewContext(readFileSync(new URL(file, import.meta.url), 'utf8'), {
    window, XMLHttpRequest: Xhr, Date: Clock, Blob,
    navigator: { userAgent: apple ? 'Mozilla/5.0 Macintosh Safari' : android ? 'Android Mobile Chrome' : 'Windows Chrome',
      platform: apple ? 'MacIntel' : '', maxTouchPoints: apple ? 5 : 0, onLine: true },
    document: { getElementById: id => id === 'radio' ? root : frame, querySelector: () => null, createElement: element,
      hidden: false, addEventListener(name, fn) { (handlers[name] ??= []).push(fn); }, removeEventListener() {} },
  });
  window.onYouTubeIframeAPIReady();
  players[0].events.onReady({ target: players[0] });
  players[0].state = 1;
  players[0].events.onStateChange({ target: players[0], data: 1 });
  const tick = timers.find(timer => timer.ms === 250).fn;
  return { players, requests, handlers,
    tick(ms = 250) { time += ms; mono += ms; players[0].at += ms / 1000; tick(); },
    event(name) { for (const fn of handlers[name] ?? []) fn({}); },
  };
}

for (const file of clientFiles) {
  for (const device of ['ipad', 'android', 'pc']) test(`${file}: cliente ${device} envía mediciones sin agotar el cupo de fallos`, () => {
    const h = clientHarness(file, { apple: device === 'ipad', android: device === 'android' });
    assert.equal(h.players.length, device === 'ipad' ? 1 : 2);
    for (let n = 0; n < 22; n += 1) h.players[0].events.onError({ data: 2 + n, target: h.players[0] });
    for (let n = 0; n < 244; n += 1) h.tick();
    const quality = h.requests.filter(r => r.body?.kind === 'playback_quality');
    assert.equal(quality.length, 2);
    assert.equal(quality[0].body.device.type, device === 'pc' ? 'desktop' : device === 'ipad' ? 'tablet' : 'phone');
    assert.equal(quality[0].body.device.decks, device === 'ipad' ? 1 : 2);
    assert.equal(quality[0].body.measurement.pieces[0].firstDriftMs, 0);
    assert.ok(quality[1].body.measurement.pieces[0].observedMs > quality[0].body.measurement.pieces[0].observedMs);
    h.players[0].events.onAutoplayBlocked({ target: h.players[0] });
    h.event('pagehide');
    const final = h.requests.filter(r => r.body?.kind === 'playback_quality').at(-1).body;
    assert.equal(final.measurement.reason, 'pagehide');
    assert.ok(final.measurement.pieces[0].autoplayBlocks > 0);
  });
}

for (const file of clientFiles) test(`${file}: reintenta 429 sin perder ni duplicar la identidad del lote`, () => {
  const h = clientHarness(file, { diagnosticStatuses: [429, 204, 204] });
  for (let n = 0; n < 244; n += 1) h.tick();
  const quality = h.requests.filter(r => r.body?.kind === 'playback_quality');
  assert.equal(quality.length, 3);
  assert.equal(quality[0].body.reportId, quality[1].body.reportId);
  assert.notEqual(quality[1].body.reportId, quality[2].body.reportId);
});
