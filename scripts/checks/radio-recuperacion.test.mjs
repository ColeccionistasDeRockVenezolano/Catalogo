import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const files = process.env.RADIO_RECOVERY_SOURCE && process.env.RADIO_RECOVERY_BUNDLE
  ? [process.env.RADIO_RECOVERY_SOURCE, process.env.RADIO_RECOVERY_BUNDLE]
  : ['../../src/landing/client/radio.js', '../../web/public/landing/radio.js'];
const epoch = Date.parse('2026-11-10T13:29:54.024Z');
// Caso real: Cheesy City termina su turno a +225 s; Papa Frita dura 140 s,
// cuña de 13,404 s con entrada de 4,5 s y cola de 6 s; Sentimiento a +367,904.
const a = { videoId: 'ew7dw4_yRa4', title: 'Cheesy City', artist: 'Laberinto', startSeconds: 1506, durationSeconds: 228 };
const b = { videoId: '6cxx7GVwVv4', title: 'Papa Frita', artist: 'DespuésDeVieja', startSeconds: 1120, durationSeconds: 140 };
const c = { videoId: '1trMHfDNJbQ', title: 'Sentimiento', artist: 'La Misma Gente', startSeconds: 938, durationSeconds: 327 };
const cue = { src: 'cue.wav', durationSeconds: 13.404, leadSeconds: 4.5, overlapSeconds: 6 };
const iso = seconds => new Date(epoch + seconds * 1000).toISOString();
function broadcast(ms) {
  const at = ms / 1000;
  let current, starts, ends, phase = 'music', slot = false, nextSlot = false, upcoming;
  if (at < 225) { current = a; starts = 0; ends = 225; upcoming = [b, c]; nextSlot = true; }
  else if (at < 365) { current = b; starts = 225; ends = 365; upcoming = [c]; slot = true; }
  else if (at < 367.904) { current = b; starts = 365; ends = 367.904; upcoming = [c]; slot = true; phase = 'sweeper'; }
  else { current = c; starts = 367.904; ends = 691.904; upcoming = []; }
  return { phase, current, startsAt: iso(starts), endsAt: iso(ends), serverTime: iso(at), upcoming,
    next: upcoming[0], sweeper: cue, sweeperSlot: slot, sweeperNext: nextSlot, crossfadeSeconds: 3,
    ...(at >= 360.5 && at < 373.904 ? { sweeperStartedAt: iso(360.5) } : {}) };
}

async function client(file, { apple = false, android = false, loadDelayMs = 0,
  initialAtMs = 0, initialPlaying = false, initialBehindMs = 0, initialMuted = false, playDelayMs = 0, seekSettleLagMs = 0 } = {}) {
  let time = initialAtMs, nextTimer = 0, offline = false, deferMainTimer = false;
  const timers = new Map(), handlers = {}, players = [], audios = [], calls = [], requests = [], audioCalls = [];
  const element = () => {
    const attrs = new Map();
    return { style: { setProperty() {} }, classList: { toggle() {}, add() {}, remove() {} },
      getAttribute: k => attrs.get(k) ?? null, setAttribute: (k, v) => attrs.set(k, String(v)), removeAttribute: k => attrs.delete(k),
      querySelector: () => null, appendChild() {}, removeEventListener() {}, events: {},
      addEventListener(name, fn) { this.events[name] = fn; } };
  };
  const screen = element(), controls = [];
  screen.appendChild = el => controls.push(el);
  const root = element(), frame = { ...element(), parentNode: screen };
  const sync = element(), identifier = element(), label = { textContent: '' };
  sync.querySelector = key => key === 'span' ? label : null;
  root.querySelector = key => key === '[data-radio-sync]' ? sync : key === '[data-radio-identifier-toggle]' ? identifier : null;
  for (const [key, value] of Object.entries({ 'data-radio-api': '/now', 'data-radio-listener-api': '/listener',
    'data-radio-diagnostic-api': '/diagnostic', 'data-radio-video-id': a.videoId, 'data-radio-starts-at': iso(0), 'data-radio-start-seconds': a.startSeconds, 'data-radio-requested': 'true' })) root.setAttribute(key, value);
  const doc = { hidden: false, currentScript: { src: 'radio.js?v=recovery-test' },
    getElementById: id => id === 'radio' ? root : frame, querySelector: () => null, createElement: element,
    addEventListener(name, fn) { (handlers[name] ??= []).push(fn); }, removeEventListener() {} };
  const schedule = (fn, ms = 0, repeat = 0) => { const id = ++nextTimer; timers.set(id, { fn, at: time + ms, repeat }); return id; };
  function elapse(to) {
    const seconds = (to - time) / 1000;
    for (const p of players) if (p.state === 1) p.at += seconds;
    for (const audio of audios) if (!audio.paused) {
      audio.currentTime += seconds;
      if (audio.currentTime >= 13.404) { audio.currentTime = 13.404; audio.paused = true; audio.ended = true; }
    }
    time = to;
    for (const p of players) if (p.state === 1 && p.end && p.at >= p.end) { p.at = p.end; p.state = 0; schedule(() => p.events.onStateChange({ target: p, data: 0 })); }
  }
  function advance(ms) {
    const until = time + ms;
    let safety = 0;
    while (true) {
      const next = [...timers].filter(([, t]) => t.at <= until).sort((x, y) => x[1].at - y[1].at || x[0] - y[0])[0];
      if (!next) break;
      assert.ok(++safety < 100000, 'bucle de temporizadores');
      const [id, timer] = next;
      elapse(Math.max(time, timer.at));
      if (timer.repeat) timer.at = time + timer.repeat; else timers.delete(id);
      if (!(deferMainTimer && (timer.repeat === 1000 || (!timer.repeat && Math.abs(timer.at - 367904) < 1)))) timer.fn();
    }
    elapse(until);
  }
  class Clock extends Date { constructor(...args) { super(...(args.length ? args : [epoch + time])); } static now() { return epoch + time; } }
  class Xhr {
    open(method, url) { this.url = url; this.method = method; }
    setRequestHeader() {}
    send(body) { schedule(() => {
      requests.push({ at: time, url: this.url, body: body ? JSON.parse(body) : null });
      this.status = offline && this.url === '/now' ? 503 : this.url === '/diagnostic' ? 204 : 200;
      this.readyState = 4; this.responseText = JSON.stringify(this.url === '/now' ? broadcast(time) : { listeners: 1 }); this.onreadystatechange?.();
    }); }
  }
  class Context {
    state = 'running';
    get currentTime() { return time / 1000; }
    destination = {};
    addEventListener() {}
    createGain() { return { connect() {}, gain: { cancelScheduledValues() {}, setValueAtTime() {}, linearRampToValueAtTime() {} } }; }
    createAnalyser() { return { connect() {} }; }
    decodeAudioData() { return Promise.resolve({ duration: 13.404 }); }
    createBufferSource() {
      let endTimer;
      const source = { connect() {}, disconnect() {}, start(_when, offset) {
        audioCalls.push({ at: time, offset, kind: 'web-audio' });
        endTimer = schedule(() => source.onended?.(), (source.buffer.duration - offset) * 1000);
      }, stop() { timers.delete(endTimer); } };
      return source;
    }
  }
  class Audio {
    constructor() { audios.push(this); }
    paused = true; ended = false; currentTime = 0; volume = 1; muted = false;
    play() { this.paused = false; this.ended = false; audioCalls.push({ at: time, offset: this.currentTime, kind: 'html-audio' }); return Promise.resolve(); }
    pause() { this.paused = true; }
    load() {}
  }
  const mediaActions = {};
  const win = { location: { origin: 'http://localhost' }, performance: { now: () => time },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    setTimeout: (fn, ms) => schedule(fn, ms), clearTimeout: id => timers.delete(id),
    setInterval: (fn, ms) => schedule(fn, ms, ms), clearInterval: id => timers.delete(id),
    matchMedia: () => ({ matches: false }), addEventListener(name, fn) { (handlers[name] ??= []).push(fn); },
    AudioContext: Context, Audio, fetch: async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(0) }),
    YT: { Player: function (_id, options) {
      const first = players.length === 0;
      const p = { events: options.events, state: first && initialPlaying ? 1 : -1,
        at: a.startSeconds + (first ? initialAtMs - initialBehindMs : 0) / 1000,
        videoId: a.videoId, muted: first && initialMuted, volume: 100, end: a.startSeconds + a.durationSeconds, refuse: false,
        getPlayerState() { return this.state; }, getCurrentTime() { return this.at; }, getVideoData() { return { video_id: this.videoId }; },
        getIframe: element, getVideoLoadedFraction: () => 1, getVolume() { return this.volume; }, isMuted() { return this.muted; },
        setVolume(value) { this.volume = value; }, mute() { this.muted = true; }, unMute() { this.muted = false; },
        seekTo(at) {
          calls.push({ at: time, kind: 'seek', videoId: this.videoId, position: at }); this.at = at;
          if (first && seekSettleLagMs && !this.settleLagApplied) {
            this.settleLagApplied = true;
            schedule(() => { this.at -= seekSettleLagMs / 1000; }, seekSettleLagMs);
          }
        },
        change(state) { if (this.state === state) return; this.state = state; schedule(() => this.events.onStateChange({ target: this, data: state })); },
        playVideo() {
          calls.push({ at: time, kind: 'play', videoId: this.videoId, position: this.at });
          if (!this.refuse && this.state !== 1) {
            if (playDelayMs) { this.change(3); schedule(() => this.change(1), playDelayMs); }
            else this.change(1);
          }
        },
        pauseVideo() { this.change(2); },
        loadVideoById(segment) {
          calls.push({ at: time, kind: 'load', ...segment }); this.videoId = segment.videoId; this.at = segment.startSeconds; this.end = segment.endSeconds;
          if (!this.refuse) {
            if (loadDelayMs) { this.change(3); schedule(() => this.change(1), loadDelayMs); }
            else this.change(1);
          }
        },
        cueVideoById(segment) { this.videoId = segment.videoId; this.at = segment.startSeconds; this.end = segment.endSeconds; this.change(5); },
      }; players.push(p); return p;
    } },
  };
  runInNewContext(readFileSync(new URL(file, import.meta.url), 'utf8'), { window: win, document: doc, Date: Clock, Blob, XMLHttpRequest: Xhr,
    navigator: { onLine: true, userAgent: apple ? 'Macintosh Safari' : android ? 'Android Mobile Chrome' : 'Linux Chrome',
      platform: apple ? 'MacIntel' : '', maxTouchPoints: apple ? 5 : 0,
      mediaSession: { setActionHandler: (name, fn) => { mediaActions[name] = fn; } } } });
  win.onYouTubeIframeAPIReady();
  players[0].events.onReady({ target: players[0] });
  if (players[1]) players[1].events.onReady({ target: players[1] });
  advance(0);
  for (let n = 0; n < 8; n++) await Promise.resolve();
  advance(2000);
  return { players, audios, calls, requests, audioCalls, advance, mediaActions,
    action: () => sync.getAttribute('data-radio-action'),
    click(name = 'sync') { (name === 'sync' ? sync : identifier).events.click({ isTrusted: true }); advance(0); },
    videoPlay(flush = true) { const button = controls.find(el => el.getAttribute?.('data-radio-video-resume') !== null && el.getAttribute?.('data-radio-video-resume') !== undefined); assert.ok(button && !button.hidden); button.events.click({ isTrusted: true }); if (flush) advance(0); },
    get time() { return time; },
    active: () => players.find(p => p.videoId === root.getAttribute('data-radio-video-id') && !p.muted && p.volume > 0) ?? players[0],
    hide() { doc.hidden = true; for (const fn of handlers.visibilitychange ?? []) fn({}); advance(0); },
    show() { doc.hidden = false; for (const fn of handlers.visibilitychange ?? []) fn({}); advance(0); },
    jump(ms) { elapse(time + ms); },
    offline(value) { offline = value; },
    deferMainTimer(value) { deferMainTimer = value; },
    reports() { for (const fn of handlers.pagehide ?? []) fn({}); advance(0); return requests.filter(r => r.body?.kind === 'playback_quality').flatMap(r => r.body.measurement.pieces); },
  };
}

for (const file of files) {
  for (const device of ['pc', 'ipad', 'android']) {
    const options = { apple: device === 'ipad', android: device === 'android' };
    test(`${file}: ${device}, recarga a mitad de canción con iframe ya sonando 2,16 s tarde`, async () => {
      const h = await client(file, { ...options, initialAtMs: 30000, initialPlaying: true, initialBehindMs: 2160 });
      assert.ok(Math.abs(h.active().at - (1506 + h.time / 1000)) < 0.001);
      assert.ok(h.calls.some(call => call.kind === 'seek'));
      assert.equal(h.action(), 'synced');
    });
    test(`${file}: ${device}, autoplay tarda 2,1 s y confirma el punto vigente al empezar`, async () => {
      const h = await client(file, { ...options, initialAtMs: 30000, playDelayMs: 2100, loadDelayMs: 2100 }); h.advance(1000);
      assert.equal(h.active().state, 1);
      assert.ok(Math.abs(h.active().at - (1506 + h.time / 1000)) < 0.001);
    });
    test(`${file}: ${device}, confirma también el atraso que aparece al estabilizarse la carga`, async () => {
      const h = await client(file, { ...options, initialAtMs: 30000, initialPlaying: true, initialBehindMs: 2160, seekSettleLagMs: 1500 });
      h.advance(5000);
      assert.ok(Math.abs(h.active().at - (1506 + h.time / 1000)) < 0.001);
      assert.ok(h.calls.filter(call => call.kind === 'seek' && call.videoId === a.videoId).length <= 3);
    });
    test(`${file}: ${device}, activar sonido de un iframe ya reproduciendo también vuelve al vivo`, async () => {
      const h = await client(file, { ...options, initialAtMs: 30000, initialPlaying: true, initialMuted: true });
      h.players[0].at -= 2.16; h.click(); h.advance(250);
      assert.ok(!h.players[0].muted);
      assert.ok(Math.abs(h.players[0].at - (1506 + h.time / 1000)) < 0.001);
    });
    test(`${file}: ${device}, recupera la pausa de Cheesy City en el segundo exacto sin esperar 62 s`, async () => {
      const h = await client(file, options); h.hide(); h.advance(157377);
      const p = h.active(); p.change(2); h.advance(0);
      assert.equal(p.state, 1);
      const seek = h.calls.filter(c => c.kind === 'seek' && c.videoId === a.videoId).at(-1);
      assert.ok(Math.abs(seek.position - (1506 + h.time / 1000)) < 0.001);
      assert.ok(h.reports().some(p => p.title === a.title && p.recoveryAttempts === 1));
    });
    test(`${file}: ${device}, primer play falla, reintenta y recarga en el vivo con espera acotada`, async () => {
      const h = await client(file, options); h.hide(); h.advance(15000);
      const p = h.active(); p.refuse = true; p.change(2); h.advance(0);
      const first = h.time; h.advance(1000);
      assert.equal(h.calls.filter(c => c.kind === 'load' && c.at > first && c.videoId === a.videoId).length, 0);
      p.refuse = false; h.advance(1000);
      const load = h.calls.filter(c => c.kind === 'load' && c.at > first && c.videoId === a.videoId).at(-1);
      assert.ok(load); assert.equal(p.state, 1); assert.equal(load.endSeconds, 1734);
      assert.ok(Math.abs(load.startSeconds - (1506 + load.at / 1000)) < 0.001);
    });
    test(`${file}: ${device}, una pausa del sistema elegida por la persona no se reanuda`, async () => {
      const h = await client(file, options); h.hide(); h.mediaActions.pause(); h.advance(0);
      const last = h.calls.length; h.advance(10000); h.show(); h.advance(1000);
      assert.equal(h.active().state, 2);
      assert.equal(h.calls.slice(last).filter(c => c.kind === 'play' || c.kind === 'load').length, 0);
    });
    test(`${file}: ${device}, pausa visible del video se respeta al ocultar y volver`, async () => {
      const h = await client(file, options); h.advance(15000); h.active().change(2); h.advance(0);
      const last = h.calls.length; h.hide(); h.advance(10000); h.show(); h.advance(1000);
      assert.equal(h.active().state, 2);
      assert.ok(!h.calls.slice(last).some(c => c.kind === 'play' || c.kind === 'load'));
    });
    test(`${file}: ${device}, play sobre la imagen del video vuelve al punto actual aunque cambió la canción`, async () => {
      const h = await client(file, options); h.advance(15000); h.active().change(2); h.advance(0);
      h.advance(370000); h.videoPlay(); h.advance(1000);
      assert.equal(h.active().state, 1); assert.equal(h.active().videoId, c.videoId);
      assert.ok(Math.abs(h.active().at - (938 + h.time / 1000 - 367.904)) < 0.001);
    });
    test(`${file}: ${device}, otra pausa cancela el play pendiente de actualizar la transmisión`, async () => {
      const h = await client(file, options); h.mediaActions.pause(); h.advance(0);
      const last = h.calls.length; h.videoPlay(false); h.mediaActions.pause(); h.advance(1000);
      assert.ok(h.players.every(p => p.state !== 1));
      assert.ok(!h.calls.slice(last).some(call => call.kind === 'play' || call.kind === 'load'));
    });
    test(`${file}: ${device}, parar el video durante el solape y reanudar con el botón vuelve al vivo`, async () => {
      const h = await client(file, options); h.advance(223100); h.active().change(2); h.advance(0);
      assert.ok(h.players.every(p => p.state !== 1));
      const last = h.calls.length; h.hide(); h.advance(150000); h.show(); h.advance(1000);
      assert.ok(h.players.every(p => p.state !== 1));
      assert.ok(!h.calls.slice(last).some(c => c.kind === 'play' || c.kind === 'load'));
      h.click(); h.advance(1000);
      assert.equal(h.active().state, 1);
      assert.equal(h.active().videoId, c.videoId);
      assert.equal(h.action(), 'synced');
    });
    test(`${file}: ${device}, parar desde la cuña también detiene música y audio de fondo`, async () => {
      const h = await client(file, options); h.hide(); h.advance(360000); h.click('identifier');
      assert.ok(h.players.every(p => p.state !== 1));
      assert.ok(h.audios.every(audio => audio.paused));
      h.advance(15000); h.show();
      assert.ok(h.players.every(p => p.state !== 1));
      h.click('identifier'); h.advance(1000);
      assert.equal(h.active().state, 1); assert.equal(h.active().videoId, c.videoId);
    });
    test(`${file}: ${device}, el corte música/cu\u00f1a/música respeta el horario aunque el video se adelante`, async () => {
      const h = await client(file, options); h.hide(); h.active().at += 5;
      h.advance(222900);
      assert.ok(!h.calls.some(c => c.kind === 'play' && c.videoId === b.videoId && c.at >= 210000));
      h.advance(100);
      h.advance(1000);
      // Al relevar tarde no se empieza la pista desde cero ni se cambia su final.
      assert.ok(h.reports().some(p => p.title === b.title && Math.abs(p.startDelayMs) <= 250));
      h.advance(140000);
      assert.ok(h.audioCalls.some(c => Math.abs(c.at - 360500) <= 250));
      assert.ok(!h.calls.some(call => call.kind === 'load' && call.videoId === c.videoId && call.at >= 365000 && call.at < 367904));
      h.advance(10000);
      const pieces = h.reports();
      assert.ok(pieces.some(p => p.title === 'Sentimiento' && Math.abs(p.startDelayMs) <= 250));
      const identifier = pieces.filter(p => p.kind === 'identifier' && p.startMs === epoch + 360500).at(-1);
      assert.ok(identifier);
      assert.ok(Math.abs(identifier.firstPlayingAt - (epoch + 360500)) <= 250);
      assert.ok(Math.abs(identifier.lastPlayingAt - (epoch + 373904)) <= 250);
    });
    test(`${file}: ${device}, el respaldo oculto sale de la cuña aunque se retrase el temporizador principal`, async () => {
      const h = await client(file, options); h.hide(); h.advance(364000);
      h.deferMainTimer(true); h.advance(5000);
      assert.equal(h.active().videoId, c.videoId);
      assert.equal(h.active().state, 1);
      assert.ok(Math.abs(h.active().at - (938 + h.time / 1000 - 367.904)) <= 0.25);
    });
    test(`${file}: ${device}, detecta la entrante pausada sin evento ni temporizador principal y vuelve al vivo`, async () => {
      const h = await client(file, options); h.hide(); h.advance(373000);
      h.advance(1000);
      const p = h.active(); p.state = 2; p.refuse = true;
      h.deferMainTimer(true); h.advance(2000); p.refuse = false; h.advance(4000);
      assert.equal(p.state, 1);
      assert.ok(Math.abs(p.at - (938 + h.time / 1000 - 367.904)) < 0.001);
      assert.ok(h.reports().some(piece => piece.title === c.title && piece.recoveryAttempts > 0));
    });
  }
  test(`${file}: el solape musical de tres segundos conserva la cola y el final del capítulo`, async () => {
    const h = await client(file); h.hide(); h.advance(223100);
    assert.ok(h.players.every(p => p.state === 1));
    h.advance(5500);
    assert.equal(h.players.find(p => p.videoId === a.videoId).state, 0);
    const pieces = h.reports(), outgoing = pieces.filter(p => p.title === a.title).at(-1), incoming = pieces.filter(p => p.title === b.title).at(-1);
    assert.ok(Math.abs(outgoing.lastPlayingAt - incoming.firstPlayingAt - 3000) <= 250);
    assert.equal(outgoing.endMs, epoch + 228000);
    assert.equal(incoming.startMs, epoch + 225000);
  });
  test(`${file}: volver a una pestaña sana no reinicia ni recarga el reproductor`, async () => {
    const h = await client(file); h.hide(); h.advance(10000); const last = h.calls.length;
    h.show(); h.advance(1000);
    assert.ok(!h.calls.slice(last).some(c => c.kind === 'load' || c.kind === 'seek' || c.kind === 'play'));
  });
  test(`${file}: al confirmar PLAYING corrige también los dos segundos que tardó la recarga`, async () => {
    const h = await client(file, { loadDelayMs: 2000 }); h.hide(); h.advance(15000);
    const p = h.active(); p.refuse = true; p.change(2); h.advance(0);
    p.refuse = false; h.advance(4500);
    assert.equal(p.state, 1);
    assert.ok(Math.abs(p.at - (1506 + h.time / 1000)) < 0.001);
  });
  test(`${file}: una confirmación PLAYING tardía no deshace la pausa voluntaria`, async () => {
    const h = await client(file); h.hide(); h.mediaActions.pause(); h.advance(0);
    h.active().change(1); h.advance(0);
    assert.equal(h.active().state, 2);
  });
  test(`${file}: play voluntario después de una suspensión conserva la intención al actualizar el horario`, async () => {
    const h = await client(file); h.hide(); h.mediaActions.pause(); h.advance(0);
    h.jump(380000); h.mediaActions.play(); h.advance(0);
    assert.ok(h.calls.some(c => c.kind === 'load' && c.videoId === '1trMHfDNJbQ'));
    assert.equal(h.active().state, 1);
  });
  test(`${file}: suspensión que cruza dos canciones consulta el servidor sin reproducir tramos vencidos`, async () => {
    const h = await client(file); h.hide(); const last = h.calls.length;
    h.jump(380000); h.advance(0);
    const loads = h.calls.slice(last).filter(c => c.kind === 'load');
    assert.ok(loads.some(c => c.videoId === '1trMHfDNJbQ'));
    assert.ok(!loads.some(c => c.videoId === '6cxx7GVwVv4'));
    const load = loads.find(c => c.videoId === '1trMHfDNJbQ');
    assert.ok(Math.abs(load.startSeconds - (938 + load.at / 1000 - 367.904)) < 0.001);
  });
  test(`${file}: sin API no revive una canción cuyo tramo ya venció`, async () => {
    const h = await client(file); h.hide(); h.offline(true); const last = h.calls.length;
    h.jump(380000); h.active().change(2); h.advance(0);
    assert.ok(!h.calls.slice(last).some(c => c.kind === 'load' || c.kind === 'play'));
    h.offline(false); h.advance(1000);
    assert.ok(h.calls.slice(last).some(c => c.kind === 'load' && c.videoId === '1trMHfDNJbQ'));
  });
}
