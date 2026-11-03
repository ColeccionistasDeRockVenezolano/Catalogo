// Radio — cliente progresivo para el player oficial de YouTube.
// El iframe funciona por si solo; este archivo agrega reloj compartido,
// presencia, entrada automatica a la emision y recuperacion de deriva.
//
// Cada pieza es una cancion: un tramo (inicio y fin) de un video de album.
// Un segundo reproductor, invisible y en silencio, deja preparada la cancion
// siguiente unos segundos antes del relevo; al llegar la hora, los dos
// reproductores intercambian papeles y la emision sigue sin esperar la carga.
// Entre cancion y cancion hay un solape (`crossfadeSeconds`): la entrante arranca
// antes de que termine la saliente, tambien con la pantalla apagada. Android corta
// la red en cuanto la pagina se calla, asi que el sonido no debe interrumpirse.
// El identificador propio sí puede dejar su cola sobre el inicio de la música.
// Lo que YouTube rechaza se avisa al servidor: solo si este confirma la baja
// se retira de la emision; una comprobacion local queda disponible para
// iniciar sesion y reintentar.
// ES5 deliberado para navegadores antiguos.
(function () {
  'use strict';

  var root = document.getElementById('radio');
  var frame = document.getElementById('radioPlayer');
  if (!root || !frame) return;

  var apiUrl = root.getAttribute('data-radio-api');
  var listenerUrl = root.getAttribute('data-radio-listener-api');
  var unavailableUrl = root.getAttribute('data-radio-unavailable-api');
  var diagnosticUrl = root.getAttribute('data-radio-diagnostic-api');
  // Para el diagnóstico: qué versión del script tiene este navegador y el
  // rastro de los últimos eventos del reproductor.
  var scriptSrc = (document.currentScript && document.currentScript.src) || '';
  var pageLoadedAt = Date.now();
  var diagTrail = [];
  var syncButton = root.querySelector('[data-radio-sync]');
  var syncLabel = syncButton && syncButton.querySelector('span');
  var statusEl = root.querySelector('[data-radio-status]');
  var titleEl = root.querySelector('[data-radio-title]');
  var artistEl = root.querySelector('[data-radio-artist]');
  var nextEl = root.querySelector('[data-radio-next]');
  var listenersEl = root.querySelector('[data-radio-listeners]');
  var progressEl = root.querySelector('[data-radio-progress]');
  var volumeUI = root.querySelector('[data-radio-volume]');
  var rangeEl = root.querySelector('[data-radio-range]');
  var muteButton = root.querySelector('[data-radio-mute]');
  var csrf = (document.querySelector('meta[name="csrf-token"]') || {}).content || '';
  // Nombre de la estación y del proyecto: los pone la página a partir de la
  // configuración de la radio del proyecto.
  var liveLabel = root.getAttribute('data-radio-live-label') || '';
  var projectName = root.getAttribute('data-radio-project-name') || liveLabel;
  var i18n = window.HerraI18n || { t: function (key) { return key; } };
  // Dos reproductores: el activo suena y se ve; el otro espera en silencio
  // con la cancion siguiente cargada. `key` identifica la pieza que tiene.
  var decks = [
    { player: null, ready: false, key: initialKey(), videoId: root.getAttribute('data-radio-video-id'), startSeconds: 0, preparing: false, prepared: false, ramp: null, dimmed: false, fadeInLevel: null, fadeInSince: 0, touchedAt: 0, heldKey: null },
    { player: null, ready: false, key: null, videoId: null, startSeconds: 0, preparing: false, prepared: false, ramp: null, dimmed: false, fadeInLevel: null, fadeInSince: 0, touchedAt: 0, heldKey: null }
  ];
  var activeIndex = 0;
  var ready = false;
  var started = false;
  // Intencion de escuchar: la pausa del visitante la apaga y ningun relevo
  // automatico la vuelve a encender.
  var listening = false;
  var correcting = false;
  var snapshot = null;
  var serverDeltaMs = 0, clockSet = false;
  var MAX_CLOCK_ROUND_TRIP_MS = 2000;
  var sessionId = listeningSessionId();
  var heartbeatTimer = null;
  var boundaryTimer = null;
  var sweeperTimer = null;
  // Pausas propias (cancion rechazada, fin del tramo): no son del visitante.
  var quietUntil = 0;
  // Relevo en curso: el reproductor entrante informa unos cientos de ms tarde
  // que ya suena y con sonido; ese instante no debe parpadear como pausa.
  var swapGraceUntil = 0;
  // Un rechazo local puede ser una comprobacion de sesion de YouTube, no una
  // baja real del video. Solo el servidor confirma los bloqueos definitivos.
  var blocked = {};
  var restricted = {};
  var reported = {};
  // Entrada automatica. La persona llega y la emision ya esta sonando: si la
  // politica de autoplay del navegador exige un gesto para el sonido, la
  // emision entra igual, en silencio, y el primer clic, toque o tecla lo
  // devuelve (ver silentFallback y enableSound).
  var soundPending = false;
  var attemptTimer = null;
  // Llegada con una cancion rechazada al aire: la entrada automatica espera
  // al relevo siguiente en vez de exigir un clic.
  var joinPending = false;
  // Arranque sin API: la tarjeta lo dice y el boton queda para reintentar.
  var bootFailed = false;
  var bootRequested = false;
  var bootTimer = null;
  var apiRetried = false;
  // Errores del reproductor: un unico reintento por pieza, sin bucles.
  var errorRetryTimer = null;
  var lastErrorVideoId = null;
  // Una pausa informada mientras la pagina esta oculta puede imponerla el
  // navegador. La intencion de escuchar se conserva por separado para que una
  // reproduccion iniciada por la persona sobreviva a minimizar Brave.
  var backgroundPlaybackIntent = false;
  var backgroundResumeAttempted = false;
  var ENDED = 0;
  var PLAYING = 1;
  var PAUSED = 2;
  var BUFFERING = 3;
  // Rechazos definitivos de YouTube: video inexistente, privado o que no
  // admite reproducirse insertado en otra pagina.
  var UNPLAYABLE = { 100: true, 101: true, 150: true };
  // Antelacion con que el reproductor en espera carga la cancion siguiente.
  var PREPARE_LEAD_MS = 45000;
  // Fundidos: salida al final del tramo, entrada al empezar el siguiente.
  var FADE_OUT_MS = 5000;
  var FADE_IN_MS = 1500;
  var FADE_STEP_MS = 80;
  // Oculta y sin segundo reproductor (iOS): la saliente baja hasta el corte del
  // tramo y la entrante sube al empezar a sonar.
  var BACKGROUND_FADE_OUT_MS = 3000;
  var BACKGROUND_FADE_IN_MS = 2000;
  // El reproductor en espera avanza este tiempo en silencio antes de quedar en pausa.
  var PREPARE_PLAY_MS = 1000;
  var WARM_EVERY_MS = 60000;
  var WARM_STOP_MS = 20000;
  var RELAY_REPORTS_MAX = 6;
  var relayReports = 0;
  // Oculta y sin cuña sonando, la entrante arranca cuando a la saliente le queda esto.
  var BACKGROUND_OVERLAP_S = 3.2;
  // Safari, Chrome y los demas navegadores de iPhone/iPad comparten las
  // restricciones multimedia de WebKit. Un segundo iframe puede precargarse
  // en silencio, pero no siempre puede empezar a sonar sin otro gesto. En esos
  // dispositivos el relevo reutiliza el reproductor que la persona ya activo.
  var appleTouchDevice = /iPad|iPhone|iPod/.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  // iOS tampoco permite cambiar el volumen por codigo: ahi el relevo sigue
  // siendo un corte limpio.
  var volumeControl = !appleTouchDevice;
  // Volumen elegido con el control de la tarjeta (0-100). Es la unica fuente de
  // verdad: el iframe ya no trae controles propios (controls=0) y los fundidos
  // se miden contra este nivel. Cero es el altavoz apagado.
  var listenerVolume = storedVolume();
  // Silencio elegido con el altavoz de la tarjeta. No es el bloqueo del
  // navegador (soundPending) ni una pausa: es una decision de la persona.
  var userMuted = listenerVolume === 0;
  // Ultimo nivel audible: el que devuelve el altavoz al reactivarlo.
  var lastAudibleVolume = storedLevel(listenerVolume);
  // Pausa del visitante: apaga la intencion de escuchar y ningun relevo la
  // vuelve a encender.
  var userPaused = false;
  var fadeTimer = null;
  var UNLOCK_EVENTS = ['pointerdown', 'keydown', 'touchstart'];
  var mediaSessionReady = false;
  var mediaSessionKey = null;

  function t(key, vars) { return i18n.t(key, vars); }

  // First-party station identifier. It is an editorial interlude, never a
  // catalog song or a YouTube chapter. The server reserves its exact slot: the
  // head rides over the last seconds of the ending song and the tail fades
  // into the next one.
  var sweeperPanel = root.querySelector('[data-radio-identifier]');
  var sweeperStage = root.querySelector('[data-radio-identifier-stage]');
  var sweeperArt = root.querySelector('[data-radio-identifier-art]');
  var sweeperToggle = root.querySelector('[data-radio-identifier-toggle]');
  var sweeperContext = null, sweeperBuffer = null, sweeperSource = null;
  var sweeperGain = null, sweeperAnalyser = null, sweeperLoading = false;
  var sweeperFailed = false, sweeperFrame = null, sweeperBins = null;
  var sweeperOffset = 0, sweeperBeganAt = 0, sweeperSrc = null;
  var sweeperBars = null, sweeperClock = 0;
  // El tramo que acaba de sonar cerraba con cuña (se recuerda al cambiar de
  // pieza para saber si el relevo es un cruce de música).
  var lastSlotSweeper = false;
  // El arte del identificador se dibuja en su lienzo original (2048 × 682) y
  // se escala completo dentro del panel.
  var SWEEPER_ART_WIDTH = 2048, SWEEPER_ART_HEIGHT = 682, SWEEPER_BARS = 31;
  var reduceSweeperMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)');

  function isSweeper() { return Boolean(snapshot && snapshot.phase === 'sweeper' && snapshot.sweeper); }
  // La pieza en curso cierra su tramo con la cuña. Con `everyPieces` > 1 solo
  // algunas la llevan; el resto entra sin identificador detrás.
  function slotSweeper() { return Boolean(snapshot && snapshot.sweeper && snapshot.sweeperSlot !== false); }
  // Cruce de música: en los tramos sin cuña la siguiente canción empieza antes
  // de que esta termine, así que su audio se solapa con el fundido de salida.
  function crossfadeMs() {
    if (!snapshot || !snapshot.crossfadeSeconds || isSweeper() || slotSweeper()) return 0;
    return Math.max(0, Number(snapshot.crossfadeSeconds) * 1000);
  }
  // El relevo que acaba de ocurrir fue un cruce: el tramo saliente no cerraba
  // con cuña y su música sigue sonando bajo la entrada de la nueva.
  function outgoingCrossfadeMs() {
    if (!snapshot || !snapshot.crossfadeSeconds || isSweeper() || lastSlotSweeper) return 0;
    return Math.max(0, Number(snapshot.crossfadeSeconds) * 1000);
  }
  // Fin real de la música del tramo: sin cuña es posterior al corte del tramo.
  function musicEndMs() { return Date.parse(snapshot.endsAt) + crossfadeMs(); }
  function sweeperLeadSeconds() { return snapshot && snapshot.sweeper ? snapshot.sweeper.leadSeconds || 0 : 0; }
  function sweeperGapSeconds() {
    if (!slotSweeper()) return 0;
    var solo = snapshot.sweeper.durationSeconds - sweeperLeadSeconds() - (snapshot.sweeper.overlapSeconds || 0);
    return Math.max(0, solo);
  }
  // Momento exacto en que arrancó (o arranca) el audio de esta cuña. El
  // servidor puede estar informando la cola de la cuña anterior al entrar en
  // una canción; se elige el candidato que de verdad está sonando ahora.
  function sweeperStartMs() {
    if (!snapshot || !snapshot.sweeper) return NaN;
    var musicEnd = Date.parse(isSweeper() ? snapshot.startsAt : snapshot.endsAt);
    var starts = [];
    // El candidato «lead antes del final» solo vale si este tramo cierra con
    // la cuña; si no, la única fuente es la cola informada por el servidor.
    if (isSweeper() || slotSweeper()) starts.push(musicEnd - sweeperLeadSeconds() * 1000);
    var reported = Date.parse(snapshot.sweeperStartedAt || '');
    if (isFinite(reported)) starts.push(reported);
    var now = serverNow(), duration = snapshot.sweeper.durationSeconds * 1000;
    for (var index = 0; index < starts.length; index += 1) {
      if (isFinite(starts[index]) && now >= starts[index] && now < starts[index] + duration) return starts[index];
    }
    return starts.length ? starts[0] : NaN;
  }
  function hasSweeperAudio() {
    if (!snapshot || !snapshot.sweeper) return false;
    var start = sweeperStartMs();
    return isFinite(start) && serverNow() >= start && serverNow() < start + snapshot.sweeper.durationSeconds * 1000;
  }
  // Segundo exacto en que entra la canción siguiente: ahí termina la cuña
  // sola y empieza su cola sobre la intro. No depende de la fase, así que la
  // cuenta atrás nunca salta al final de la canción entrante.
  function sweeperHandoffMs() {
    if (!snapshot || !snapshot.sweeper) return NaN;
    var start = sweeperStartMs();
    if (!isFinite(start)) return NaN;
    var solo = snapshot.sweeper.durationSeconds - (snapshot.sweeper.overlapSeconds || 0);
    return start + solo * 1000;
  }
  function entryFadeMs() {
    if (document.hidden && !backgroundSweeperPlaying()) return BACKGROUND_FADE_IN_MS;
    if (hasSweeperAudio() && !isSweeper()) return Math.max(FADE_IN_MS, sweeperStartMs() + snapshot.sweeper.durationSeconds * 1000 - serverNow());
    return Math.max(FADE_IN_MS, outgoingCrossfadeMs());
  }
  function sweeperSeed(index, side) {
    var value = Math.sin((index + 1) * 78.233 + side * 91.27) * 43758.5453;
    return value - Math.floor(value);
  }
  // Las barras del espectro son elementos reales (como en el arte original):
  // el pico crece hacia el centro y el resto decae hacia los extremos.
  function buildSweeperBars() {
    if (sweeperBars || !sweeperArt) return;
    sweeperBars = [];
    var sides = [['left', 0], ['right', 1]];
    for (var s = 0; s < sides.length; s += 1) {
      var host = sweeperArt.querySelector('[data-radio-wave="' + sides[s][0] + '"]');
      if (!host) continue;
      var side = sides[s][1];
      for (var i = 0; i < SWEEPER_BARS; i += 1) {
        var bar = document.createElement('span');
        bar.className = 'radio-card__bar';
        bar.setAttribute('aria-hidden', 'true');
        host.appendChild(bar);
        var x = side === 0 ? i / (SWEEPER_BARS - 1) : 1 - i / (SWEEPER_BARS - 1);
        var envelope = Math.pow(Math.max(0, 1 - Math.abs(x - 0.81) / 0.84), 1.7);
        var peak = 12 + 190 * envelope * (0.34 + 0.66 * sweeperSeed(i, side));
        bar.style.setProperty('--bar-h', Math.round(peak * 0.77) + 'px');
        bar.style.setProperty('--bar-o', (0.07 + 0.89 * Math.pow(envelope, 0.8)).toFixed(2));
        sweeperBars.push({ bar: bar, peak: peak, side: side, index: i });
      }
    }
  }
  function scaleSweeper() {
    if (!sweeperArt || !sweeperStage) return;
    var width = sweeperStage.clientWidth, height = sweeperStage.clientHeight;
    if (!width || !height) return;
    var scale = Math.min(width / SWEEPER_ART_WIDTH, height / SWEEPER_ART_HEIGHT);
    sweeperArt.style.transform = 'translate(-50%, -50%) scale(' + scale.toFixed(4) + ')';
  }
  if (window.ResizeObserver && sweeperStage) new window.ResizeObserver(scaleSweeper).observe(sweeperStage);
  else window.addEventListener('resize', scaleSweeper);
  function initialiseSweeper() {
    if (!snapshot || !snapshot.sweeper || sweeperLoading || sweeperBuffer || sweeperFailed) return;
    var Context = window.AudioContext || window.webkitAudioContext;
    if (!Context) { sweeperFailed = true; return; }
    try {
      sweeperContext = window.HerraRadioAudioContext || sweeperContext || new Context();
      window.HerraRadioAudioContext = sweeperContext;
      try { sweeperContext.addEventListener('statechange', function () { trace('audio_ctx', { s: sweeperContext.state }); }); } catch (_) { /* navegador antiguo */ }
      sweeperGain = sweeperContext.createGain();
      sweeperAnalyser = sweeperContext.createAnalyser();
      sweeperAnalyser.fftSize = 1024;
      sweeperAnalyser.smoothingTimeConstant = 0.78;
      sweeperGain.connect(sweeperAnalyser);
      sweeperAnalyser.connect(sweeperContext.destination);
      sweeperSrc = (root.getAttribute('data-radio-static-base') || '/static') + '/' + snapshot.sweeper.src;
      sweeperLoading = true;
      window.fetch(sweeperSrc).then(function (response) {
        if (!response.ok) throw new Error('identifier unavailable');
        return response.arrayBuffer();
      }).then(function (bytes) { return sweeperContext.decodeAudioData(bytes); }).then(function (buffer) {
        sweeperBuffer = buffer; sweeperLoading = false;
        prepareBackgroundSweeper();
        if (hasSweeperAudio()) syncSweeper(false);
      }).catch(function () { sweeperLoading = false; sweeperFailed = true; refreshStatus(); });
    } catch (_) { sweeperFailed = true; }
  }
  // --- Cuña en segundo plano ---------------------------------------------------
  // Con la página oculta la cuña va solapada sobre la canción que termina y la
  // que entra, que arranca en el corte. No se usa el AudioContext porque no
  // mantiene viva la red; este elemento avanza solo y termina aunque se corte.
  // Lleva la bajada grabada en una copia en memoria: oculta, los temporizadores
  // van a saltos y el volumen por código se oiría escalonado.
  // iPhone/iPad quedan fuera: WebKit puede detener la música al arrancar otro
  // audio y no permite bajar el volumen por código.
  var bgSweeper = null, bgSweeperStartMs = NaN, bgSweeperTicker = null, bgSweeperDuration = 0, bgSweeperOverlap = 0;
  var bgSweeperFaded = false;

  // WAV de 16 bits con la bajada lineal de los últimos `overlap` segundos.
  function fadedSweeperUrl(buffer, overlap) {
    var channels = Math.min(2, buffer.numberOfChannels), frames = buffer.length, rate = buffer.sampleRate;
    var bytes = new ArrayBuffer(44 + frames * channels * 2), view = new DataView(bytes);
    function text(at, value) { for (var i = 0; i < value.length; i += 1) view.setUint8(at + i, value.charCodeAt(i)); }
    text(0, 'RIFF'); view.setUint32(4, 36 + frames * channels * 2, true); text(8, 'WAVEfmt ');
    view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, channels, true);
    view.setUint32(24, rate, true); view.setUint32(28, rate * channels * 2, true);
    view.setUint16(32, channels * 2, true); view.setUint16(34, 16, true);
    text(36, 'data'); view.setUint32(40, frames * channels * 2, true);
    var data = [];
    for (var c = 0; c < channels; c += 1) data.push(buffer.getChannelData(c));
    var fadeFrames = Math.floor(overlap * rate), position = 44;
    for (var frame = 0; frame < frames; frame += 1) {
      var left = frames - frame;
      var gain = fadeFrames && left < fadeFrames ? left / fadeFrames : 1;
      for (var channel = 0; channel < channels; channel += 1) {
        var sample = Math.max(-1, Math.min(1, data[channel][frame] * gain));
        view.setInt16(position, sample < 0 ? sample * 32768 : sample * 32767, true);
        position += 2;
      }
    }
    return window.URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' }));
  }
  function prepareBackgroundSweeper() {
    if (appleTouchDevice || !snapshot || !snapshot.sweeper || typeof window.Audio !== 'function') return;
    var wantsCopy = !bgSweeperFaded && sweeperBuffer && !backgroundSweeperPlaying();
    if (bgSweeper && !wantsCopy) return;
    try {
      var source = (root.getAttribute('data-radio-static-base') || '/static') + '/' + snapshot.sweeper.src;
      if (wantsCopy) {
        try {
          source = fadedSweeperUrl(sweeperBuffer, snapshot.sweeper.overlapSeconds || 0);
          bgSweeperFaded = true;
        } catch (_) { /* sigue con el archivo original y volumen por código */ }
      }
      if (bgSweeper) bgSweeper.src = source;
      else { bgSweeper = new window.Audio(source); bgSweeper.preload = 'auto'; }
      if (bgSweeperFaded) bgSweeper.load();
    } catch (_) { bgSweeper = null; bgSweeperFaded = false; }
  }
  function backgroundSweeperPlaying() {
    return Boolean(bgSweeper && bgSweeperTicker && !bgSweeper.paused && !bgSweeper.ended);
  }
  // Mismo perfil que en primer plano: nivel pleno y bajada durante la cola.
  function backgroundSweeperLevel() {
    var left = bgSweeperDuration - (Number(bgSweeper.currentTime) || 0);
    var envelope = !bgSweeperFaded && bgSweeperOverlap && left < bgSweeperOverlap ? Math.max(0, left / bgSweeperOverlap) : 1;
    return Math.max(0, Math.min(1, (chosenVolume() / 100) * envelope));
  }
  function stopBackgroundSweeper() {
    if (bgSweeperTicker) { window.clearInterval(bgSweeperTicker); bgSweeperTicker = null; }
    if (bgSweeper && !bgSweeper.paused) {
      trace('bg_sweeper_stop');
      try { bgSweeper.pause(); } catch (_) { /* ya estaba detenida */ }
    }
  }
  function startBackgroundSweeper() {
    if (appleTouchDevice || !listening || userPaused || userMuted || soundPending) return;
    var start = sweeperStartMs();
    if (!isFinite(start) || start === bgSweeperStartMs) return;
    prepareBackgroundSweeper();
    if (!bgSweeper) return;
    var target = (serverNow() - start) / 1000;
    if (target < 0 || target >= snapshot.sweeper.durationSeconds - 0.5) return;
    bgSweeperStartMs = start;
    bgSweeperDuration = snapshot.sweeper.durationSeconds;
    bgSweeperOverlap = snapshot.sweeper.overlapSeconds || 0;
    var sweeper = bgSweeper;
    try {
      sweeper.currentTime = target;
      sweeper.volume = backgroundSweeperLevel();
      var playing = sweeper.play();
      trace('bg_sweeper_on', { at: Math.round(target * 10) / 10, baked: bgSweeperFaded ? 1 : 0 });
      if (playing && playing.catch) playing.catch(function (error) {
        trace('bg_sweeper_err', { n: error && error.name });
        stopBackgroundSweeper();
      });
    } catch (_) { return; }
    if (bgSweeperTicker) window.clearInterval(bgSweeperTicker);
    bgSweeperTicker = window.setInterval(function () {
      if (sweeper.ended || !listening || userPaused || userMuted) { stopBackgroundSweeper(); return; }
      try { sweeper.volume = backgroundSweeperLevel(); } catch (_) { /* volumen de solo lectura */ }
    }, 200);
  }

  function stopSweeper() {
    if (sweeperSource) {
      trace('sweeper_stop');
      sweeperOffset += sweeperContext.currentTime - sweeperBeganAt;
      try { sweeperSource.stop(); sweeperSource.disconnect(); } catch (_) {}
      sweeperSource = null;
    }
    if (sweeperGain) sweeperGain.gain.cancelScheduledValues(sweeperContext.currentTime);
  }
  function showSweeper() {
    // La cuña se ve desde su solape de entrada, mientras la canción todavía
    // suena: el video se oculta y el arte toma la pantalla.
    // Visible desde el solape de entrada hasta que entra la siguiente canción:
    // la cola de la cuña sigue sonando, pero sin panel ni contador.
    var active = hasSweeperAudio() && serverNow() < sweeperHandoffMs();
    root.classList.toggle('is-sweeper', active);
    if (!sweeperPanel) return;
    sweeperPanel.hidden = !active;
    if (!active) {
      if (sweeperFrame) { window.cancelAnimationFrame(sweeperFrame); sweeperFrame = null; }
      return;
    }
    var nextTitle = root.querySelector('[data-radio-identifier-next]');
    var nextArtist = root.querySelector('[data-radio-identifier-artist]');
    if (nextTitle) nextTitle.textContent = snapshot.next ? snapshot.next.title : '';
    if (nextArtist) nextArtist.textContent = snapshot.next ? snapshot.next.artist || '' : '';
    buildSweeperBars();
    scaleSweeper();
    paintSweeper();
  }
  function syncSweeper(force) {
    if (!hasSweeperAudio()) { stopSweeper(); return; }
    // Oculta, la cuña nunca detiene la música (Android no deja volver a arrancar el
    // reproductor) y va siempre por <audio>: entre el final de una canción y el inicio
    // de la siguiente es lo único que suena, y con solo Web Audio Brave corta la red.
    if (document.hidden) { stopSweeper(); startBackgroundSweeper(); return; }
    // Al volver a primer plano termina la que ya sonaba: otra la duplicaría.
    if (backgroundSweeperPlaying()) return;
    // Only the solo portion pauses YouTube; its tail belongs over the music.
    var deck = activeDeck();
    if (isSweeper() && !sweeperSource && deck.ready && deck.key !== nextPieceKey()) {
      quietUntil = Date.now() + 2500;
      cancelRamp(deck);
      try { deck.player.pauseVideo(); } catch (_) {}
    }
    if (!listening || soundPending || userMuted) { stopSweeper(); return; }
    initialiseSweeper();
    if (!sweeperContext || !sweeperBuffer || sweeperFailed) return;
    var target = Math.max(0, (serverNow() - sweeperStartMs()) / 1000);
    if (sweeperSource && !force && Math.abs(sweeperOffset + sweeperContext.currentTime - sweeperBeganAt - target) < 0.8) return;
    stopSweeper();
    if (target >= Math.min(snapshot.sweeper.durationSeconds, sweeperBuffer.duration)) return;
    if (sweeperContext.state !== 'running') {
      soundPending = true;
      sweeperContext.resume().then(function () {
        if (sweeperContext.state === 'running' && hasSweeperAudio() && listening) { soundPending = false; syncSweeper(false); refreshLabels(); refreshStatus(); }
      }).catch(function () { soundPending = true; refreshLabels(); refreshStatus(); });
      refreshLabels(); refreshStatus(); return;
    }
    sweeperSource = sweeperContext.createBufferSource();
    trace('sweeper_start', { ctx: sweeperContext.state });
    sweeperSource.buffer = sweeperBuffer;
    sweeperSource.connect(sweeperGain);
    var level = (chosenVolume() / 100);
    var overlap = snapshot.sweeper.overlapSeconds || 0;
    var solo = snapshot.sweeper.durationSeconds - overlap;
    var clock = sweeperContext.currentTime;
    sweeperGain.gain.setValueAtTime(overlap && target > solo ? level * (snapshot.sweeper.durationSeconds - target) / overlap : level, clock);
    if (overlap) {
      if (target < solo) sweeperGain.gain.setValueAtTime(level, clock + solo - target);
      sweeperGain.gain.linearRampToValueAtTime(0, clock + snapshot.sweeper.durationSeconds - target);
    }
    sweeperOffset = target; sweeperBeganAt = sweeperContext.currentTime;
    sweeperSource.start(0, target);
    var source = sweeperSource;
    source.onended = function () { if (sweeperSource === source) { sweeperSource = null; source.disconnect(); paintSweeper(); } };
    started = true;
    ensureHeartbeat(); heartbeatLive(); paintSweeper();
  }
  function paintSweeper() {
    if (sweeperFrame) { window.cancelAnimationFrame(sweeperFrame); sweeperFrame = null; }
    if (!sweeperPanel || !hasSweeperAudio()) return;
    var reduced = Boolean(reduceSweeperMotion && reduceSweeperMotion.matches);
    var remaining = Math.max(0, (sweeperHandoffMs() - serverNow()) / 1000);
    var countdown = sweeperPanel.querySelector('[data-radio-identifier-countdown]');
    if (countdown) countdown.textContent = Math.ceil(remaining) + ' s';
    sweeperPanel.classList.toggle('is-next', remaining <= 4);
    if (sweeperToggle) sweeperToggle.textContent = audible() ? t('radio.identifierPause') : soundPending ? t('radio.sound') : t('radio.identifierPlay');
    if (sweeperBars) {
      var bins = null;
      if (!reduced && sweeperAnalyser && sweeperSource && sweeperContext.state === 'running') {
        if (!sweeperBins || sweeperBins.length !== sweeperAnalyser.frequencyBinCount) sweeperBins = new Uint8Array(sweeperAnalyser.frequencyBinCount);
        sweeperAnalyser.getByteFrequencyData(sweeperBins);
        bins = sweeperBins;
      }
      var stamp = Date.now();
      var advance = reduced || stamp - sweeperClock >= 32;
      if (advance) sweeperClock = stamp;
      for (var index = 0; index < sweeperBars.length; index += 1) {
        var item = sweeperBars[index];
        if (!advance) continue;
        var height;
        if (bins) {
          var freq = Math.min(bins.length - 1, Math.round(4 + (item.index / SWEEPER_BARS) * (bins.length * 0.30)));
          height = 4 + item.peak * (0.12 + (bins[freq] / 255) * 1.35);
        } else if (reduced) {
          height = item.peak * 0.55;
        } else {
          var time = stamp * 0.001;
          var factor = 0.55 + 0.22 * Math.sin(time * 2.1 + item.index * 0.67 + item.side * 3.2)
            + 0.16 * Math.sin(time * 3.65 - item.index * 0.96) + 0.075 * Math.sin(time * 7.7 + item.index * 1.83);
          height = 7 + item.peak * Math.max(0.10, Math.min(1.12, factor));
        }
        item.bar.style.setProperty('--bar-h', Math.min(220, Math.max(3, height)).toFixed(1) + 'px');
      }
    }
    if (!reduced) sweeperFrame = window.requestAnimationFrame(paintSweeper);
  }
  if (sweeperToggle) sweeperToggle.addEventListener('click', function () {
    if (audible()) { listening = false; stopSweeper(); }
    else {
      listening = true; started = true; soundPending = false;
      // Escuchar el identificador con el altavoz apagado es pedir sonido.
      if (userMuted) { userMuted = false; if (listenerVolume === 0) listenerVolume = lastAudibleVolume; persistVolume(); paintVolume(); }
      try { activeDeck().player.unMute(); } catch (_) {}
      syncSweeper(true);
    }
    paintSweeper(); refreshLabels(); refreshStatus(); heartbeatLive();
  });
  // Unlock first-party audio during a real gesture, before the next boundary.
  function unlockSweeper(event) {
    if (event.isTrusted === false || !sweeperContext) return;
    sweeperContext.resume().then(function () {
      if (hasSweeperAudio() && listening && (isSweeper() || !playerMuted())) { soundPending = false; syncSweeper(false); }
    }).catch(function () {});
  }
  document.addEventListener('pointerdown', unlockSweeper, { passive: true });
  document.addEventListener('keydown', unlockSweeper, { passive: true });
  window.addEventListener('pagehide', function () { stopSweeper(); stopBackgroundSweeper(); });


  function listeningSessionId() {
    var key = 'herra:radio:session:v1';
    try {
      var existing = window.sessionStorage.getItem(key);
      if (existing && /^[A-Za-z0-9_-]{16,64}$/.test(existing)) return existing;
    } catch (_) { /* modo privado pode negar storage */ }
    var bytes;
    if (typeof window.Uint8Array === 'function') bytes = new window.Uint8Array(18);
    else {
      bytes = [];
      for (var slot = 0; slot < 18; slot += 1) bytes.push(0);
    }
    if (window.crypto && window.crypto.getRandomValues && bytes.buffer) window.crypto.getRandomValues(bytes);
    else for (var index = 0; index < bytes.length; index += 1) bytes[index] = Math.floor(Math.random() * 256);
    var id = '';
    for (var i = 0; i < bytes.length; i += 1) id += ('0' + bytes[i].toString(16)).slice(-2);
    try { window.sessionStorage.setItem(key, id); } catch (_) { /* efimero */ }
    return id;
  }

  function request(method, url, body, callback) {
    if (!url) return;
    var xhr = new XMLHttpRequest();
    var answered = false;
    xhr.open(method, url, true);
    // Una conexión colgada no debe dejar la petición abierta para siempre.
    xhr.timeout = 20000;
    xhr.setRequestHeader('Accept', 'application/json');
    if (body) {
      xhr.setRequestHeader('Content-Type', 'application/json');
      if (csrf) xhr.setRequestHeader('X-CSRF-Token', csrf);
    }
    xhr.onreadystatechange = function () {
      if (xhr.readyState !== 4 || answered) return;
      answered = true;
      noteApiResult(url, xhr.status);
      if (xhr.status < 200 || xhr.status >= 300) { callback(null); return; }
      try { callback(JSON.parse(xhr.responseText)); } catch (_) { callback(null); }
    };
    xhr.send(body ? JSON.stringify(body) : null);
  }

  // --- Diagnóstico de escucha -----------------------------------------------------
  //
  // Cuando la radio debería sonar y no suena durante 30 s, cuando vuelve a sonar
  // tras ese silencio, cuando YouTube da un error o cuando la API deja de
  // responder y vuelve, el reproductor manda al servidor su estado completo y
  // los últimos 80 eventos (rastro). Si no hay red, los avisos esperan en
  // memoria; si la persona recarga la página en pleno silencio, se guardan en
  // localStorage y se envían desde la página siguiente. Nada de esto cambia
  // la reproducción.
  var DIAG_STALL_MS = 30000;
  var DIAG_MAX_REPORTS = 20;
  var DIAG_STORE = 'herra:radio:diagnostics:v1';
  var YT_STATE_NAMES = { '-1': 'unstarted', '0': 'ended', '1': 'playing', '2': 'paused', '3': 'buffering', '5': 'cued' };
  var diag = {
    everAudible: false, silentSince: 0, stallReported: false, stallReason: null,
    lastTick: 0, maxTickGapMs: 0, lastTime: null, lastTimeKey: null, progressAt: 0,
    sent: 0, queue: [], sending: false, retryAt: 0,
    apiFailures: 0, apiFailingSince: 0, apiStatuses: [], snapshotAt: 0,
    hiddenSince: document.hidden ? Date.now() : 0, flags: '', playerErrors: {}
  };

  function trace(event, detail) {
    var entry = { t: Date.now() - pageLoadedAt, e: event };
    if (detail) {
      for (var name in detail) {
        if (Object.prototype.hasOwnProperty.call(detail, name)) entry[name] = detail[name];
      }
    }
    if (document.hidden) entry.h = 1;
    diagTrail.push(entry);
    if (diagTrail.length > 80) diagTrail.shift();
  }

  function deckIndex(deck) { return deck === decks[0] ? 0 : 1; }

  function deckDiagnostic(deck) {
    var info = {
      active: deck === activeDeck(), ready: deck.ready, key: deck.key, videoId: deck.videoId,
      preparing: deck.preparing, prepared: deck.prepared, tail: Boolean(deck.tailPlaying),
      dimmed: deck.dimmed, ramp: Boolean(deck.ramp), fadeInLevel: deck.fadeInLevel
    };
    if (!deck.player) { info.player = false; return info; }
    var state = stateOf(deck);
    info.state = YT_STATE_NAMES[String(state)] || state;
    try { info.time = Number(deck.player.getCurrentTime()); } catch (_) { /* sin API */ }
    try { info.volume = deck.player.getVolume(); } catch (_) { /* sin API */ }
    try { info.muted = deck.player.isMuted(); } catch (_) { /* sin API */ }
    try { info.loaded = deck.player.getVideoLoadedFraction(); } catch (_) { /* sin API */ }
    try {
      var data = deck.player.getVideoData && deck.player.getVideoData();
      if (data) info.loadedVideoId = data.video_id || null;
    } catch (_) { /* sin API */ }
    return info;
  }

  function diagnosticState() {
    var connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    var current = snapshot && snapshot.current;
    var state = {
      script: scriptSrc.replace(/^.*\//, ''),
      pageAgeMs: Date.now() - pageLoadedAt,
      hidden: document.hidden,
      visibility: document.visibilityState,
      hiddenForMs: diag.hiddenSince ? Date.now() - diag.hiddenSince : 0,
      online: navigator.onLine,
      connection: connection ? {
        type: connection.type || null, effective: connection.effectiveType || null,
        downlink: connection.downlink, rtt: connection.rtt, saveData: Boolean(connection.saveData)
      } : null,
      appleTouch: appleTouchDevice,
      flags: {
        ready: ready, started: started, listening: listening, userPaused: userPaused, userMuted: userMuted,
        soundPending: soundPending, joinPending: joinPending, bootFailed: bootFailed,
        backgroundIntent: backgroundPlaybackIntent, backgroundResumeAttempted: backgroundResumeAttempted,
        everAudible: diag.everAudible
      },
      volume: listenerVolume,
      serverDeltaMs: serverDeltaMs,
      snapshotAgeMs: diag.snapshotAt ? Date.now() - diag.snapshotAt : null,
      api: { failures: diag.apiFailures, failingForMs: diag.apiFailingSince ? Date.now() - diag.apiFailingSince : 0, statuses: diag.apiStatuses.slice(-8) },
      timers: { maxTickGapMs: diag.maxTickGapMs },
      restricted: Object.keys(restricted),
      blocked: Object.keys(blocked),
      activeIndex: activeIndex,
      trail: diagTrail.slice()
    };
    // Lo que depende de la emisión o de los reproductores, cada parte por su
    // cuenta: un fallo aquí no debe impedir que el aviso salga.
    try {
      state.phase = snapshot ? snapshot.phase : null;
      state.current = current ? {
        videoId: current.videoId, title: current.title, artist: current.artist,
        startSeconds: current.startSeconds, durationSeconds: current.durationSeconds,
        substituteFor: current.regionSubstituteFor ? current.regionSubstituteFor.videoId : null
      } : null;
      state.next = snapshot && snapshot.upcoming && snapshot.upcoming[0] ? snapshot.upcoming[0].videoId : null;
      state.startsAt = snapshot ? snapshot.startsAt : null;
      state.endsAt = snapshot ? snapshot.endsAt : null;
      state.sweeperSlot = snapshot ? Boolean(snapshot.sweeperSlot) : null;
      state.crossfadeSeconds = snapshot ? snapshot.crossfadeSeconds || 0 : null;
      state.catalogVersion = snapshot ? snapshot.catalogVersion : null;
      state.key = currentKey();
      state.nextKey = nextPieceKey();
      state.background = backgroundMode();
      state.rejected = currentRejected();
      state.audible = audible();
      if (snapshot && !isSweeper()) state.liveSecond = liveSecond();
    } catch (error) { state.snapshotError = String(error && error.message || error); }
    try { state.decks = [deckDiagnostic(decks[0]), deckDiagnostic(decks[1])]; }
    catch (error) { state.decksError = String(error && error.message || error); }
    state.bgSweeper = { playing: backgroundSweeperPlaying(), loaded: bgSweeper ? bgSweeper.readyState : null };
    state.stuck = { sinceMs: stuck.since ? Date.now() - stuck.since : 0, attempts: stuck.attempts };
    state.sweeper = {
      has: hasSweeperAudio(), playing: Boolean(sweeperSource), loaded: Boolean(sweeperBuffer), failed: sweeperFailed,
      context: sweeperContext ? sweeperContext.state : null
    };
    return state;
  }

  function diagnose(kind, extra) {
    if (!diagnosticUrl || diag.sent >= DIAG_MAX_REPORTS) return;
    diag.sent += 1;
    var report;
    try { report = diagnosticState(); } catch (error) { report = { stateError: String(error && error.message || error) }; }
    report.kind = kind;
    report.sessionId = sessionId;
    report.brave = Boolean(navigator.brave);
    report.gesture = navigator.userActivation ? navigator.userActivation.hasBeenActive : null;
    report.clientTime = new Date().toISOString();
    if (extra) {
      for (var name in extra) {
        if (Object.prototype.hasOwnProperty.call(extra, name)) report[name] = extra[name];
      }
    }
    trace('diag', { kind: kind });
    diag.queue.push(report);
    if (diag.queue.length > 10) diag.queue.shift();
    flushDiagnostics();
  }

  function flushDiagnostics() {
    if (!diagnosticUrl || diag.sending || !diag.queue.length || Date.now() < diag.retryAt) return;
    diag.sending = true;
    var report = diag.queue[0];
    var finished = false;
    var xhr;
    function done(delivered) {
      if (finished) return;
      finished = true;
      diag.sending = false;
      if (delivered) {
        if (diag.queue[0] === report) diag.queue.shift();
        diag.retryAt = 0;
        if (diag.queue.length) flushDiagnostics();
      } else {
        diag.retryAt = Date.now() + 30000;
      }
    }
    try {
      xhr = new XMLHttpRequest();
      xhr.open('POST', diagnosticUrl, true);
      xhr.timeout = 20000;
      xhr.setRequestHeader('Content-Type', 'application/json');
      if (csrf) xhr.setRequestHeader('X-CSRF-Token', csrf);
      xhr.onreadystatechange = function () {
        if (xhr.readyState !== 4) return;
        // Un rechazo del servidor (400, 403, 429) no se reintenta: solo la red caída.
        done(xhr.status !== 0 && (xhr.status < 500 || xhr.status === 501));
      };
      xhr.send(JSON.stringify(report));
    } catch (_) { done(false); }
  }

  // Avisos que no salieron antes de cerrar o recargar la página.
  function persistDiagnostics() {
    if (!diag.queue.length) return;
    try { window.localStorage.setItem(DIAG_STORE, JSON.stringify(diag.queue.slice(-5))); } catch (_) { /* sin almacenamiento */ }
  }

  function restoreDiagnostics() {
    var stored = null;
    try {
      stored = window.localStorage.getItem(DIAG_STORE);
      window.localStorage.removeItem(DIAG_STORE);
    } catch (_) { return; }
    if (!stored) return;
    try {
      var list = JSON.parse(stored);
      if (!list || !list.length) return;
      for (var index = 0; index < list.length && index < 5; index += 1) {
        if (!list[index] || typeof list[index] !== 'object') continue;
        list[index].previousPage = true;
        list[index].deliveredFromPageAgeMs = 0;
        diag.queue.push(list[index]);
      }
    } catch (_) { /* aviso ilegible */ }
  }

  // Suena de verdad: la cuña con su AudioContext en marcha, o el reproductor
  // activo en reproducción, sin silenciar y con el tiempo avanzando.
  function soundingNow() {
    if (sweeperSource && sweeperContext && sweeperContext.state === 'running') return true;
    if (backgroundSweeperPlaying()) return true;
    var deck = activeDeck();
    if (!deck.player || soundPending) return false;
    var time = null;
    try { time = Number(deck.player.getCurrentTime()); } catch (_) { time = null; }
    var now = Date.now();
    if (diag.lastTimeKey !== deck.key) diag.progressAt = now;
    else if (time !== null && diag.lastTime !== null && time !== diag.lastTime) diag.progressAt = now;
    diag.lastTime = time;
    diag.lastTimeKey = deck.key;
    if (stateOf(deck) !== PLAYING || mutedOf(deck)) return false;
    return now - diag.progressAt < 5000;
  }

  function silenceReason() {
    var parts = [];
    if (!navigator.onLine) parts.push('offline');
    if (diag.apiFailures >= 2) parts.push('api_down');
    if (currentRejected()) parts.push('video_rejected');
    if (soundPending) parts.push('sound_pending');
    var deck = activeDeck();
    if (!deck.player) parts.push('no_player');
    else {
      if (isSweeper() && !document.hidden) {
        parts.push(sweeperContext ? 'sweeper_ctx_' + sweeperContext.state : 'sweeper_no_ctx');
        if (!sweeperSource) parts.push('sweeper_not_playing');
      }
      var muted = mutedOf(deck);
      if (muted) parts.push('player_muted');
      var state = stateOf(deck);
      var name = YT_STATE_NAMES[String(state)] || String(state);
      // «Atascado» solo si suena con sonido y el tiempo no avanza.
      parts.push('player_' + (state === PLAYING && !muted ? 'playing_stuck' : name));
      if (deck.key && snapshot && deck.key !== currentKey() && deck.key !== nextPieceKey()) parts.push('deck_on_old_piece');
    }
    if (document.hidden) parts.push('hidden');
    return parts.join('+');
  }

  // Se llama una vez por segundo desde el repaso. Un intervalo muy largo entre
  // dos llamadas es el navegador congelando o frenando la página.
  function watchSound() {
    var now = Date.now();
    if (diag.lastTick) {
      var gap = now - diag.lastTick;
      if (gap > diag.maxTickGapMs) diag.maxTickGapMs = gap;
      if (gap > 5000) trace('timer_gap', { ms: gap });
    }
    diag.lastTick = now;
    var flags = [started, listening, userPaused, userMuted, soundPending, ready].map(function (flag) { return flag ? 1 : 0; }).join('');
    if (flags !== diag.flags) {
      trace('flags', { started: started, listening: listening, userPaused: userPaused, userMuted: userMuted, soundPending: soundPending, ready: ready });
      diag.flags = flags;
    }
    var sounding = false;
    try { sounding = soundingNow(); } catch (_) { sounding = false; }
    if (sounding) diag.everAudible = true;
    var expected = diag.everAudible && started && listening && !userPaused && !userMuted;
    if (sounding || !expected) {
      if (diag.silentSince) {
        trace('silence_end', { ms: now - diag.silentSince, by: sounding ? 'sound' : 'not_expected' });
        if (diag.stallReported) {
          diagnose('stall_end', {
            silenceMs: now - diag.silentSince, reason: diag.stallReason,
            resumedBy: sounding ? 'sound' : (userPaused ? 'user_paused' : userMuted ? 'user_muted' : 'not_listening')
          });
        }
      }
      diag.silentSince = 0;
      diag.stallReported = false;
      diag.stallReason = null;
      return;
    }
    if (!diag.silentSince) {
      diag.silentSince = now;
      diag.stallReason = silenceReason();
      trace('silence_start', { reason: diag.stallReason });
      return;
    }
    if (!diag.stallReported && now - diag.silentSince >= DIAG_STALL_MS) {
      diag.stallReported = true;
      diag.stallReason = silenceReason();
      diagnose('stall', { silenceMs: now - diag.silentSince, reason: diag.stallReason });
    }
  }

  // Resultado de cada llamada a la API de la radio. Dos fallos seguidos abren
  // un corte; la primera respuesta buena lo cierra y lo informa.
  function noteApiResult(url, status) {
    var name = url === apiUrl ? 'now' : url === listenerUrl ? 'listener' : url === unavailableUrl ? 'unavailable' : 'other';
    if (name === 'other') return;
    if (status >= 200 && status < 300) {
      if (name === 'now') diag.snapshotAt = Date.now();
      if (diag.apiFailures >= 2) {
        trace('api_back', { after: diag.apiFailures });
        stuck.nextAt = 0;
        diagnose('api_outage_end', {
          outageMs: Date.now() - diag.apiFailingSince, failures: diag.apiFailures, statuses: diag.apiStatuses.slice(-8)
        });
      }
      diag.apiFailures = 0;
      diag.apiFailingSince = 0;
      return;
    }
    if (!diag.apiFailures) diag.apiFailingSince = Date.now();
    diag.apiFailures += 1;
    diag.apiStatuses.push(name + ':' + status);
    if (diag.apiStatuses.length > 20) diag.apiStatuses.shift();
    trace('api_fail', { u: name, s: status, online: navigator.onLine });
  }

  function notePlayerError(deck, code) {
    var videoId = deck.videoId;
    trace('yt_error', { d: deckIndex(deck), code: code, v: videoId });
    var key = (videoId || '') + ':' + code;
    if (diag.playerErrors[key]) return;
    diag.playerErrors[key] = true;
    diagnose('player_error', { code: code, deck: deckIndex(deck), activeDeck: deck === activeDeck(), errorVideoId: videoId });
  }

  document.addEventListener('visibilitychange', function () {
    if (document.hidden) diag.hiddenSince = Date.now();
    else diag.hiddenSince = 0;
    trace(document.hidden ? 'hidden' : 'visible');
  });
  window.addEventListener('online', function () { trace('online'); stuck.nextAt = 0; });
  window.addEventListener('offline', function () { trace('offline'); });
  document.addEventListener('freeze', function () { trace('freeze'); persistDiagnostics(); });
  document.addEventListener('resume', function () { trace('resume'); });
  window.addEventListener('pageshow', function (event) { trace('pageshow', { persisted: Boolean(event && event.persisted) }); });
  window.addEventListener('pagehide', function () {
    trace('pagehide');
    // Recargar o cerrar en pleno silencio es justo el caso que interesa.
    if (diag.silentSince && Date.now() - diag.silentSince >= 5000 && diag.sent < DIAG_MAX_REPORTS) {
      var report;
      try { report = diagnosticState(); } catch (_) { report = {}; }
      report.kind = 'stall_abandoned';
      report.sessionId = sessionId;
      report.brave = Boolean(navigator.brave);
      report.clientTime = new Date().toISOString();
      report.silenceMs = Date.now() - diag.silentSince;
      report.reason = silenceReason();
      diag.queue.push(report);
    }
    persistDiagnostics();
  });
  restoreDiagnostics();
  window.setTimeout(flushDiagnostics, 3000);

  // --- Piezas y reproductores ---------------------------------------------------

  function pieceKey(item, startsAt) {
    return item ? startsAt + '|' + item.videoId + '|' + item.startSeconds : null;
  }

  function initialKey() {
    return root.getAttribute('data-radio-starts-at') + '|' + root.getAttribute('data-radio-video-id')
      + '|' + root.getAttribute('data-radio-start-seconds');
  }

  function currentKey() {
    return snapshot ? pieceKey(snapshot.current, snapshot.startsAt) + (isSweeper() ? ':sweeper' : '') : null;
  }

  function activeDeck() { return decks[activeIndex]; }
  function standbyDeck() { return decks[1 - activeIndex]; }

  function stateOf(deck) {
    try { return deck.player && deck.player.getPlayerState ? deck.player.getPlayerState() : -1; } catch (_) { return -1; }
  }

  function mutedOf(deck) {
    try { return Boolean(deck.player && deck.player.isMuted && deck.player.isMuted()); } catch (_) { return false; }
  }

  function iframeOf(deck) {
    try { return deck.player && deck.player.getIframe ? deck.player.getIframe() : null; } catch (_) { return null; }
  }

  function playerState() { return stateOf(activeDeck()); }
  function playerMuted() { return mutedOf(activeDeck()); }
  function serverNow() { return Date.now() + serverDeltaMs; }

  function currentBlocked() {
    if (isSweeper()) return false;
    return Boolean(snapshot && blocked[snapshot.current.videoId]);
  }

  function videoRejected(videoId) {
    return Boolean(videoId && (blocked[videoId] || restricted[videoId]));
  }

  function currentRestricted() {
    if (isSweeper()) return false;
    return Boolean(snapshot && restricted[snapshot.current.videoId]);
  }

  function currentRejected() {
    if (isSweeper()) return false;
    return Boolean(snapshot && videoRejected(snapshot.current.videoId));
  }

  // Clave de la cancion que entra despues de la pieza en curso (tras la cuña,
  // si este tramo la lleva). Es la misma que tendra currentKey() al llegar.
  function nextPieceKey() {
    if (!snapshot || !snapshot.upcoming || !snapshot.upcoming.length) return null;
    var startsAt = !isSweeper() && slotSweeper()
      ? new Date(Date.parse(snapshot.endsAt) + sweeperGapSeconds() * 1000).toISOString()
      : snapshot.endsAt;
    return pieceKey(snapshot.upcoming[0], startsAt);
  }

  // --- Segundo plano ----------------------------------------------------------
  //
  // Sin segundo reproductor (iOS) el relevo oculto se hace en el mismo, antes de
  // que su tramo termine. Con dos, se cruzan igual que con la pantalla encendida.
  function backgroundMode() {
    return Boolean(document.hidden && started && !userPaused && (listening || backgroundPlaybackIntent) && !standbyDeck().player);
  }

  // Carga ya la cancion siguiente en el reproductor activo, sin esperar a que
  // el tramo termine ni a la cuña. Entra unos segundos antes de su hora.
  function relayNextInBackground() {
    var key = nextPieceKey();
    var deck = activeDeck();
    if (!key || !deck.ready || deck.key === key) return;
    var next = snapshot.upcoming[0];
    if (videoRejected(next.videoId)) return;
    cancelRamp(deck);
    deck.dimmed = false;
    deck.fadeInLevel = null;
    deck.key = key;
    deck.videoId = next.videoId;
    deck.startSeconds = next.startSeconds;
    deck.preparing = false;
    deck.prepared = false;
    deck.tailPlaying = false;
    try {
      levelForBackgroundEntry(deck);
      deck.player.loadVideoById(segment(next, next.startSeconds));
    } catch (_) { /* se recupera al volver a primer plano */ }
  }

  // La entrante arranca en cero y sube al sonar (onDeckState); sin control de
  // volumen o con el sonido pendiente entra directamente a su nivel.
  function levelForBackgroundEntry(deck) {
    var audible = !soundPending && !userMuted;
    if (volumeControl && audible) prepareFadeIn(deck, chosenVolume());
    else { cancelRamp(deck); deck.dimmed = false; deck.fadeInLevel = null; setLevel(deck, chosenVolume()); }
    if (audible) deck.player.unMute();
  }

  // Ya llegó el corte del tramo (o estamos en la cuña). En oculto el relevo
  // ocurre en el corte: la saliente terminó de bajar justo antes.
  function backgroundRelayDue() {
    if (!snapshot) return false;
    return isSweeper() || serverNow() >= Date.parse(snapshot.endsAt) - 250;
  }

  // Fin del fundido de salida: el corte del tramo en oculto, el final de la
  // música (con cruce) en primer plano.
  function fadeOutEndMs() {
    return backgroundMode() ? Date.parse(snapshot.endsAt) : musicEndMs();
  }
  function fadeOutMs() {
    return backgroundMode() ? BACKGROUND_FADE_OUT_MS : FADE_OUT_MS;
  }

  // Integra la radio con los controles de reproducción del sistema. En Brave
  // móvil esto permite reanudar desde la pantalla bloqueada o la notificación,
  // sin depender de que la página vuelva a primer plano.
  function updateMediaSession() {
    if (!('mediaSession' in navigator)) return;
    try {
      if (snapshot && mediaSessionKey !== currentKey() && typeof window.MediaMetadata === 'function') {
        mediaSessionKey = currentKey();
        navigator.mediaSession.metadata = new window.MediaMetadata({
          title: isSweeper() ? t('radio.identifier') : snapshot.current.title || liveLabel,
          artist: snapshot.current.artist || projectName,
          album: snapshot.current.album || liveLabel
        });
      }
      navigator.mediaSession.playbackState = audible() ? 'playing' : (started ? 'paused' : 'none');
    } catch (_) { /* API parcial o controlada por el reproductor insertado */ }
  }

  function setupMediaSession() {
    if (mediaSessionReady || !('mediaSession' in navigator)) return;
    mediaSessionReady = true;
    try {
      navigator.mediaSession.setActionHandler('play', function () {
        backgroundPlaybackIntent = true;
        if (currentRestricted()) delete restricted[snapshot.current.videoId];
        userPaused = false;
        correctDrift(true, false);
      });
      navigator.mediaSession.setActionHandler('pause', function () {
        backgroundPlaybackIntent = false;
        listening = false;
        // La pausa del sistema es una pausa del visitante: la reanudacion
        // automatica no la deshace.
        userPaused = true;
        stopSweeper();
        stopBackgroundSweeper();
        quietUntil = Date.now() + 2000;
        try { activeDeck().player.pauseVideo(); } catch (_) { /* ya estaba en pausa */ }
        heartbeat(false);
        refreshLabels();
        refreshStatus();
      });
    } catch (_) { /* algunos navegadores exponen solo parte de Media Session */ }
    updateMediaSession();
  }

  // Debe ejecutarse en la misma tarea que informa la pausa: Android puede
  // congelar inmediatamente los temporizadores cuando la pestaña queda oculta.
  function resumeBackgroundPlayback(deck) {
    if (!document.hidden || !backgroundPlaybackIntent || backgroundResumeAttempted
      || activeDeck() !== deck || currentRejected()) return;
    backgroundResumeAttempted = true;
    try {
      deck.player.playVideo();
      updateMediaSession();
    } catch (_) { /* se recupera al volver o desde el control multimedia */ }
  }

  // El tramo exacto de la cancion: el reproductor se detiene en su final y
  // nunca deja colar el comienzo de la siguiente del mismo album.
  function segment(item, fromSecond) {
    return { videoId: item.videoId, startSeconds: fromSecond, endSeconds: item.startSeconds + item.durationSeconds };
  }

  // Solo el reproductor activo se ve y recibe foco; el otro queda fuera del
  // orden de tabulacion y de los lectores de pantalla.
  function markDecks() {
    for (var index = 0; index < decks.length; index += 1) {
      var el = iframeOf(decks[index]) || (index === 0 ? frame : null);
      if (!el) continue;
      if (index === activeIndex) {
        el.setAttribute('data-radio-deck', 'active');
        el.removeAttribute('aria-hidden');
        el.removeAttribute('tabindex');
        if (snapshot) el.setAttribute('title', 'YouTube · ' + snapshot.current.title);
      } else {
        el.setAttribute('data-radio-deck', 'standby');
        el.setAttribute('aria-hidden', 'true');
        el.setAttribute('tabindex', '-1');
      }
    }
  }

  // --- Reproductor colgado -------------------------------------------------------
  //
  // YouTube no avisa cuando se queda sin red a mitad de una carga: el iframe
  // sigue en «buffering» o «unstarted» para siempre y, sin evento, nadie lo
  // rescata. Pasa en Android al relevar con la pantalla apagada: al callar la
  // saliente el sistema frena la página y le corta la red. Si debería sonar y
  // no suena, se vuelve a cargar la pieza en el segundo del vivo, con espera
  // creciente. Una pausa (del visitante, de una llamada o de otra app) nunca se
  // fuerza: el sistema es dueño de esa decisión.
  var STUCK_VISIBLE_MS = 8000, STUCK_HIDDEN_MS = 15000, STUCK_RETRY_MAX_MS = 30000, STUCK_NOTICE_MS = 6000;
  var stuck = { since: 0, key: null, attempts: 0, nextAt: 0, reported: false };

  function clearStuck() {
    stuck.since = 0; stuck.key = null; stuck.attempts = 0; stuck.nextAt = 0; stuck.reported = false;
  }

  // Sin sonido hace rato aunque el reproductor siga «cargando»: la tarjeta deja
  // de decir que está al día y el regreso a primer plano recarga en vez de esperar.
  function playerStuck(ms) {
    return Boolean(stuck.since && Date.now() - stuck.since >= ms);
  }

  function watchStuckPlayer() {
    if (!snapshot || !started || !listening || userPaused || isSweeper() || currentRejected()) { clearStuck(); return; }
    var deck = activeDeck();
    if (!deck.player || deck.key === nextPieceKey()) { clearStuck(); return; }
    var state = stateOf(deck);
    var waiting = state === BUFFERING || state === -1 || state === 5;
    // Terminó antes de hora: espera en silencio el corte del tramo, es normal.
    if (state === ENDED && serverNow() >= Date.parse(snapshot.endsAt) + 1000) waiting = true;
    if (!waiting) { clearStuck(); return; }
    var now = Date.now();
    var key = currentKey();
    if (stuck.key !== key) { clearStuck(); stuck.key = key; }
    var first = document.hidden ? STUCK_HIDDEN_MS : STUCK_VISIBLE_MS;
    if (!stuck.since) { stuck.since = now; stuck.nextAt = now + first; return; }
    if (now < stuck.nextAt) return;
    stuck.attempts += 1;
    stuck.nextAt = now + Math.min(STUCK_RETRY_MAX_MS, first * Math.pow(2, stuck.attempts));
    trace('stuck_reload', { n: stuck.attempts, s: YT_STATE_NAMES[String(state)] || state, ms: now - stuck.since });
    if (!stuck.reported) {
      stuck.reported = true;
      diagnose('player_reload', { stuckMs: now - stuck.since, playerState: YT_STATE_NAMES[String(state)] || state });
    }
    try {
      if (!soundPending && !userMuted) deck.player.unMute();
      loadCurrent(deck);
    } catch (_) { /* el siguiente repaso lo reintenta */ }
  }

  function loadCurrent(deck, fromSecond) {
    var item = snapshot.current;
    deck.key = currentKey();
    deck.videoId = item.videoId;
    deck.startSeconds = item.startSeconds;
    deck.preparing = false;
    deck.prepared = false;
    deck.tailPlaying = false;
    deck.player.loadVideoById(segment(item, fromSecond === undefined ? liveSecond() : fromSecond));
  }

  function cueCurrent(deck) {
    var item = snapshot.current;
    deck.key = currentKey();
    deck.videoId = item.videoId;
    deck.startSeconds = item.startSeconds;
    deck.preparing = false;
    deck.prepared = false;
    deck.tailPlaying = false;
    deck.player.cueVideoById(segment(item, liveSecond()));
  }

  // --- Estado visible -------------------------------------------------------------

  // Escucha real: reproduciendo, sin silencio pendiente y sin mute. Con el
  // sonido bloqueado nadie esta oyendo todavia: eso no cuenta como persona
  // escuchando ni enciende el punto de emision.
  function audible() {
    if (userPaused || userMuted) return false;
    if (isSweeper()) return Boolean(listening && !soundPending && sweeperSource && sweeperContext && sweeperContext.state === 'running');
    if (!started || soundPending) return false;
    if (listening && Date.now() < swapGraceUntil) return true;
    var state = playerState();
    if (state === BUFFERING && playerStuck(STUCK_NOTICE_MS)) return false;
    return !playerMuted() && (state === PLAYING || state === BUFFERING);
  }

  function itemLine(item) {
    if (!item) return '';
    var parts = [];
    if (item.artist) parts.push(item.artist);
    if (item.album) parts.push(item.album);
    if (item.year) parts.push(String(item.year));
    return parts.join(' · ');
  }

  function nextLine(item) {
    if (!item) return '';
    return item.artist ? item.artist + ' — ' + item.title : item.title || '';
  }

  function setStatus(text, state) {
    if (statusEl && statusEl.textContent !== text) statusEl.textContent = text;
    var next = state || 'ready';
    if (root.getAttribute('data-radio-state') !== next) root.setAttribute('data-radio-state', next);
    updateMediaSession();
  }

  // El boton solo dice «Estas al dia» cuando el audio esta realmente en
  // marcha; en cualquier otro estado nombra la accion que falta.
  function refreshLabels() {
    if (!syncLabel) return;
    var text;
    if (currentRestricted()) text = t('radio.retry');
    else if (userPaused) text = t('radio.resync');
    else if (soundPending || userMuted) text = t('radio.sound');
    else if (audible()) text = t('radio.synced');
    else if (started) text = t('radio.resync');
    else text = t('radio.join');
    if (syncLabel.textContent !== text) syncLabel.textContent = text;
  }

  // La linea de estado solo declara el vivo con sonido real; en el resto de
  // casos explica lo que falta. Con el audio en marcha la frase pasa a ser la
  // de la emision compartida, porque «Estas al dia» ya vive en el boton.
  function refreshStatus() {
    if (isSweeper()) {
      if (userPaused) { setStatus(t('radio.paused'), 'ready'); return; }
      setStatus(sweeperFailed ? t('radio.identifierError') : soundPending ? t('radio.muted') : userMuted ? t('radio.silenced') : audible() ? t('radio.identifier') : t('radio.ready'), audible() ? 'live' : soundPending || userMuted ? 'sound' : 'ready'); return;
    }
    if (bootFailed && !ready) { setStatus(t('radio.error'), 'error'); return; }
    if (currentBlocked()) { setStatus(t('radio.unavailable'), 'unavailable'); return; }
    if (currentRestricted()) { setStatus(t('radio.restricted'), 'restricted'); return; }
    if (userPaused) { setStatus(t('radio.paused'), 'ready'); return; }
    if (soundPending) { setStatus(t('radio.muted'), 'sound'); return; }
    if (userMuted) { setStatus(t('radio.silenced'), 'sound'); return; }
    if (listening && playerStuck(STUCK_NOTICE_MS)) { setStatus(t('radio.reconnecting'), 'ready'); return; }
    if (audible()) {
      // La pieza programada esta vetada en el pais del oyente: el servidor
      // envio otra para el mismo tramo y la emision sigue sincronizada.
      var replaced = snapshot && snapshot.current && snapshot.current.regionSubstituteFor;
      if (replaced) { setStatus(t('radio.regionSubstitute', { title: itemLine(replaced) }), 'live'); return; }
      setStatus(t('radio.shared'), 'live');
      return;
    }
    setStatus(t('radio.ready'), 'ready');
  }

  function listenerCopy(count) {
    if (!listenersEl) return;
    if (count > 1) listenersEl.textContent = t('radio.listenerMany', { n: count });
    else if (count === 1 && started) listenersEl.textContent = t('radio.listenerOne');
    else listenersEl.textContent = t('radio.listenerQuiet');
  }

  // --- Programacion ---------------------------------------------------------------

  function applySnapshot(data, local, roundTripMs) {
    if (!data || !data.current || !data.startsAt || !data.endsAt) return false;
    if (!local) {
      // Una respuesta que tardó no sirve para poner el reloj: la hora que trae
      // ya pasó, y la emisión retrocedería esos segundos.
      var reportedTime = Date.parse(data.serverTime);
      if (isFinite(reportedTime) && (!clockSet || roundTripMs <= MAX_CLOCK_ROUND_TRIP_MS)) {
        serverDeltaMs = reportedTime + roundTripMs / 2 - Date.now();
        clockSet = true;
      }
      // El relevo local redondea a milisegundos: la misma pieza del servidor
      // puede diferir en uno y no es una pieza nueva, no se recarga.
      if (snapshot && data.phase === snapshot.phase && data.current.videoId === snapshot.current.videoId
        && data.current.startSeconds === snapshot.current.startSeconds
        && Math.abs(Date.parse(data.startsAt) - Date.parse(snapshot.startsAt)) < 1000) data.startsAt = snapshot.startsAt;
    }
    // Una respuesta pedida antes del relevo local y recibida despues describe
    // una cancion que ya termino: no debe devolver la emision hacia atras.
    if (snapshot && Date.parse(data.endsAt) <= Date.parse(snapshot.startsAt) + 500) return true;
    var previousKey = currentKey();
    var leavingSlotSweeper = slotSweeper();
    snapshot = data;
    lastSlotSweeper = leavingSlotSweeper;
    root.setAttribute('data-radio-video-id', data.current.videoId);
    root.setAttribute('data-radio-start-seconds', String(data.current.startSeconds));
    root.setAttribute('data-radio-starts-at', data.startsAt);
    if (data.queueId) root.setAttribute('data-radio-queue-id', data.queueId);
    if (titleEl) titleEl.textContent = isSweeper() ? t('radio.identifier') : data.current.title;
    if (artistEl) artistEl.textContent = isSweeper() ? projectName : itemLine(data.current);
    if (nextEl) nextEl.textContent = nextLine(data.next || (data.upcoming && data.upcoming[0]));
    listenerCopy(Number(data.listeners) || 0);
    initialiseSweeper();
    showSweeper();
    markDecks();
    scheduleBoundary();
    if (previousKey && previousKey !== currentKey()) handlePieceChange();
    else syncSweeper(false);
    updateProgress();
    updateMediaSession();
    return true;
  }

  // Segundos transcurridos de la cancion en curso segun el reloj del servidor.
  function expectedSecond() {
    if (!snapshot) return 0;
    var startMs = Date.parse(snapshot.startsAt);
    var duration = isSweeper() ? sweeperGapSeconds() : Number(snapshot.current.durationSeconds) || 0;
    return isSweeper() ? Math.max(0, Math.min(duration, (serverNow() - startMs) / 1000)) : Math.max(0, Math.min(duration - 1, Math.floor((serverNow() - startMs) / 1000)));
  }

  // El mismo punto, expresado como segundo dentro del video del album.
  function liveSecond() {
    return snapshot ? (Number(snapshot.current.startSeconds) || 0) + expectedSecond() : 0;
  }

  function updateProgress() {
    if (!snapshot || !progressEl) return;
    // La barra recorre el tramo completo (canción + cuña) y solo vuelve a cero
    // cuando entra la canción siguiente: al entrar el identificador no se
    // pierde ni se reinicia a mitad de tramo.
    var songSeconds = Number(snapshot.current.durationSeconds) || 0;
    var slotStart = isSweeper() ? Date.parse(snapshot.startsAt) - songSeconds * 1000 : Date.parse(snapshot.startsAt);
    var slotEnd = isSweeper() ? Date.parse(snapshot.endsAt) : Date.parse(snapshot.endsAt) + sweeperGapSeconds() * 1000;
    var span = slotEnd - slotStart;
    var fraction = span > 0 ? (serverNow() - slotStart) / span : 0;
    progressEl.style.setProperty('--radio-progress-scale', Math.max(0, Math.min(1, fraction)).toFixed(4));
  }

  function scheduleBoundary() {
    if (boundaryTimer) window.clearTimeout(boundaryTimer);
    if (fadeTimer) window.clearTimeout(fadeTimer);
    if (sweeperTimer) window.clearTimeout(sweeperTimer);
    boundaryTimer = null;
    fadeTimer = null;
    sweeperTimer = null;
    if (!snapshot) return;
    var fadeWaitMs = musicEndMs() - FADE_OUT_MS - serverNow();
    if (!isSweeper() && volumeControl && fadeWaitMs > 0 && fadeWaitMs < 2147483000) {
      fadeTimer = window.setTimeout(function () {
        fadeTimer = null;
        startFadeOut();
      }, fadeWaitMs);
    }
    // La cuña entra sobre la música: panel y audio arrancan en el segundo
    // exacto de su solape, no cuando pase el repaso periódico. Solo en los
    // tramos que la llevan.
    if (!isSweeper() && slotSweeper()) {
      var headWaitMs = Date.parse(snapshot.endsAt) - sweeperLeadSeconds() * 1000 - serverNow();
      if (headWaitMs > 0 && headWaitMs < 2147483000) {
        sweeperTimer = window.setTimeout(function () {
          sweeperTimer = null;
          showSweeper(); syncSweeper(true);
        }, headWaitMs);
      }
    }
    var waitMs = Math.max(0, Math.min(Date.parse(snapshot.endsAt) - serverNow(), 2147483000));
    boundaryTimer = window.setTimeout(function () {
      boundaryTimer = null;
      advanceBoundary();
    }, waitMs);
  }

  // Relevo a la hora exacta con las proximas piezas que ya trajo el servidor:
  // no depende de que la consulta llegue a tiempo. Despues se reconcilia.
  function advanceBoundary() {
    if (!snapshot) return;
    var endsAtMs = Date.parse(snapshot.endsAt);
    if (serverNow() < endsAtMs - 1500) { scheduleBoundary(); return; }
    var upcoming = snapshot.upcoming || [];
    if (!upcoming.length) { refresh(); return; }
    var enteringSweeper = Boolean(slotSweeper() && !isSweeper());
    var current = enteringSweeper ? snapshot.current : upcoming[0];
    var nextSlotSweeper = Boolean(snapshot.sweeperNext);
    var cross = nextSlotSweeper ? 0 : Number(snapshot.crossfadeSeconds) || 0;
    var duration = enteringSweeper ? sweeperGapSeconds() : Math.max(0.5, current.durationSeconds - cross);
    applySnapshot({
      phase: enteringSweeper ? 'sweeper' : 'music',
      sweeper: snapshot.sweeper,
      // El relevo local conserva si el tramo que entra (o el que acaba de
      // cerrarse) lleva cuña; el repaso con el servidor lo confirma enseguida.
      sweeperSlot: enteringSweeper ? true : nextSlotSweeper,
      sweeperNext: enteringSweeper ? nextSlotSweeper : false,
      crossfadeSeconds: snapshot.crossfadeSeconds,
      sweeperStartedAt: enteringSweeper
        ? new Date(endsAtMs - sweeperLeadSeconds() * 1000).toISOString()
        : (isSweeper() ? snapshot.sweeperStartedAt || new Date(endsAtMs - sweeperLeadSeconds() * 1000).toISOString() : undefined),
      station: snapshot.station,
      catalogVersion: snapshot.catalogVersion,
      startsAt: snapshot.endsAt,
      endsAt: new Date(endsAtMs + duration * 1000).toISOString(),
      current: current,
      next: enteringSweeper ? upcoming[0] : upcoming[1] || null,
      upcoming: enteringSweeper ? upcoming : upcoming.slice(1),
      listeners: snapshot.listeners
    }, true);
    // Con desfase aleatorio, para que todos los oyentes no consulten a la vez.
    window.setTimeout(function () {
      refresh(function (ok) { if (ok && started) correctDrift(false); });
    }, 1200 + Math.floor(Math.random() * 2500));
  }

  function handlePieceChange() {
    lastErrorVideoId = null;
    if (snapshot) trace('piece', { phase: snapshot.phase, v: snapshot.current.videoId, bg: backgroundMode() ? 1 : 0, slot: snapshot.sweeperSlot ? 1 : 0 });
    // Cada nueva pieza dispone de su propio intento de continuidad si el
    // relevo ocurre con Brave minimizado.
    if (document.hidden) backgroundResumeAttempted = false;
    if (!snapshot) return;
    if (isSweeper() && ready && backgroundMode()) {
      // Sin segundo reproductor la musica sigue en el mismo.
      stopSweeper();
      relayNextInBackground();
      refreshLabels(); refreshStatus(); return;
    }
    if (isSweeper()) {
      if (ready && mutedOf(activeDeck())) soundPending = true;
      syncSweeper(false); refreshLabels(); refreshStatus(); return;
    }
    syncSweeper(false);
    if (!ready) return;
    var active = activeDeck();
    var standby = standbyDeck();
    try {
      if (currentRejected()) {
        if (listening) holdSilent();
      } else if (!listening && joinPending && !started) {
        joinPending = false;
        autoJoin();
        return;
      } else if (!listening) {
        // Una pieza nueva solo releva a lo que ya suena. En pausa o antes de
        // entrar queda lista en el punto del vivo y espera el gesto.
        cueCurrent(active);
      } else if (active.key === currentKey() && (stateOf(active) === PLAYING || stateOf(active) === BUFFERING)) {
        // El cruce ya dejó la pieza entrante sonando en el reproductor activo
        // (la saliente sigue su último tramo): no se recarga ni se reinicia.
        settleVolume();
      } else if (backgroundMode()) {
        // En oculto no se cambia de reproductor: el activo, que sigue sonando
        // la cola de la saliente, carga la entrante al volumen elegido.
        levelForBackgroundEntry(active);
        loadCurrent(active);
      } else if (standby.ready && standby.prepared && standby.key === currentKey()) {
        swapDecks();
      } else {
        var level = chosenVolume(active);
        if (volumeControl && !soundPending && !mutedOf(active)) prepareFadeIn(active, level);
        else if (active.dimmed) { cancelRamp(active); setLevel(active, level); active.dimmed = false; }
        loadCurrent(active);
      }
    } catch (_) {
      setStatus(t('radio.error'), 'error');
      return;
    }
    refreshLabels();
    refreshStatus();
  }

  // --- Volumen y pausa propios --------------------------------------------------

  function readStored(key) {
    try { return window.localStorage.getItem(key); } catch (_) { return null; }
  }

  function storedVolume() {
    var raw = readStored('crv-radio-volume');
    if (raw === null || raw === '') return 100;
    var value = Number(raw);
    if (!isFinite(value)) return 100;
    return Math.max(0, Math.min(100, Math.round(value)));
  }

  function storedLevel(fallback) {
    var value = Number(readStored('crv-radio-level'));
    if (!isFinite(value) || value <= 0) return fallback > 0 ? fallback : 100;
    return Math.max(1, Math.min(100, Math.round(value)));
  }

  function persistVolume() {
    try {
      window.localStorage.setItem('crv-radio-volume', String(Math.round(listenerVolume)));
      window.localStorage.setItem('crv-radio-level', String(Math.round(lastAudibleVolume)));
    } catch (_) { /* sin almacenamiento: el volumen dura la visita */ }
  }

  // Lucide sustituye los <i> por SVG y SVGElement no refleja `hidden`: se usa
  // el atributo, igual que el boton de modo cine.
  function toggleItem(selector, hidden) {
    var item = root.querySelector(selector);
    if (!item) return;
    if (hidden) item.setAttribute('hidden', '');
    else item.removeAttribute('hidden');
  }

  function paintVolume() {
    var level = Math.max(0, Math.min(100, Math.round(listenerVolume)));
    if (rangeEl) {
      if (Number(rangeEl.value) !== level) rangeEl.value = String(level);
      rangeEl.style.setProperty('--radio-volume-level', level + '%');
    }
    toggleItem('[data-radio-volume-on-icon]', userMuted);
    toggleItem('[data-radio-volume-off-icon]', !userMuted);
    if (!muteButton) return;
    muteButton.setAttribute('aria-pressed', userMuted ? 'true' : 'false');
    var label = userMuted ? t('radio.unmute') : t('radio.mute');
    if (muteButton.getAttribute('aria-label') !== label) {
      muteButton.setAttribute('aria-label', label);
      muteButton.setAttribute('title', label);
    }
  }

  // El volumen elegido se aplica a los dos reproductores: el relevo hereda el
  // mismo nivel y no hay saltos entre piezas.
  function applyLevel(level) {
    var standby = standbyDeck();
    setLevel(activeDeck(), level);
    if (standby.ready) setLevel(standby, level);
  }

  function setVolume(value) {
    var level = Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
    var wasMuted = userMuted;
    listenerVolume = level;
    userMuted = level === 0;
    if (level > 0) lastAudibleVolume = level;
    var deck = activeDeck();
    // Si la persona mueve el volumen durante un fundido, el fundido se retira:
    // manda ella. Esta pieza ya no vuelve a fundirse.
    if (deck.ramp || deck.dimmed) deck.heldKey = deck.key;
    cancelRamp(deck);
    deck.dimmed = false;
    deck.fadeInLevel = null;
    setLevel(deck, level);
    var standby = standbyDeck();
    if (standby.dimmed) standby.fadeInLevel = level;
    else if (standby.ready) setLevel(standby, level);
    try {
      if (userMuted) deck.player.mute();
      else if (wasMuted) deck.player.unMute();
    } catch (_) { /* sin reproductor todavia */ }
    persistVolume();
    paintVolume();
    refreshLabels();
    refreshStatus();
    if (!userMuted) heartbeatLive();
  }

  function toggleMute() {
    setVolume(userMuted ? lastAudibleVolume || 100 : 0);
    if (!userMuted) ensureHeartbeat();
  }

  // --- Fundidos de volumen ------------------------------------------------------

  function volumeOf(deck) {
    try {
      var value = Number(deck.player.getVolume());
      return isFinite(value) ? value : null;
    } catch (_) { return null; }
  }

  function setLevel(deck, level) {
    deck.touchedAt = Date.now();
    try { deck.player.setVolume(level); } catch (_) { /* sin reproductor */ }
  }

  // El volumen que la persona eligio con el control de la tarjeta: es la unica
  // fuente de verdad. El reproductor ya no manda porque no tiene controles.
  function chosenVolume() {
    return Math.max(0, Math.min(100, Math.round(listenerVolume)));
  }

  function cancelRamp(deck) {
    if (!deck.ramp) return;
    window.clearInterval(deck.ramp.timer);
    deck.ramp = null;
  }

  function ramp(deck, from, target, durationMs) {
    cancelRamp(deck);
    var startedAt = Date.now();
    // Valores enviados recientemente: el reproductor informa su volumen con
    // retraso, y un valor fuera de este rango solo puede venir de la persona.
    var sent = [from];
    var initial = volumeOf(deck);
    if (initial !== null) sent.push(initial);
    var current = { timer: null };
    deck.ramp = current;
    current.timer = window.setInterval(function () {
      if (deck.ramp !== current) return;
      var elapsed = Date.now() - startedAt;
      if (elapsed > 500) {
        var reported = volumeOf(deck);
        var low = Math.min.apply(null, sent) - 3;
        var high = Math.max.apply(null, sent) + 3;
        var muted = mutedOf(deck);
        if (muted || (reported !== null && (reported < low || reported > high))) {
          // La persona manda: si silencia o mueve el volumen durante el
          // fundido, el fundido se retira y queda lo que ella eligio.
          cancelRamp(deck);
          deck.dimmed = false;
          deck.fadeInLevel = null;
          // Esta cancion ya no vuelve a fundirse: lo decidio la persona.
          deck.heldKey = deck.key;
          if (muted) setLevel(deck, chosenVolume());
          else listenerVolume = reported;
          return;
        }
      }
      var progress = Math.min(1, elapsed / durationMs);
      // Curva de potencia constante: bajada y subida se perciben parejas.
      var eased = target > from ? Math.sin(progress * Math.PI / 2) : 1 - Math.cos(progress * Math.PI / 2);
      var level = Math.round(from + (target - from) * eased);
      setLevel(deck, level);
      sent.push(level);
      if (sent.length > 14) sent.shift();
      if (progress < 1) return;
      cancelRamp(deck);
      if (target >= from) deck.dimmed = false;
    }, FADE_STEP_MS);
  }

  // Deja el reproductor en cero; la subida empieza cuando de verdad suena.
  function prepareFadeIn(deck, level) {
    cancelRamp(deck);
    setLevel(deck, 0);
    deck.dimmed = true;
    deck.fadeInLevel = level;
    deck.fadeInSince = Date.now();
  }

  function inFadeOut(deck) {
    return Boolean(snapshot && deck.key === currentKey()
      && serverNow() >= fadeOutEndMs() - fadeOutMs() - 300);
  }

  function startFadeOut() {
    if (isSweeper()) return;
    if (!volumeControl || !listening || !snapshot || soundPending || currentRejected()) return;
    var deck = activeDeck();
    if (deck.ramp || deck.dimmed || deck.heldKey === deck.key || deck.key !== currentKey()
      || stateOf(deck) !== PLAYING || mutedOf(deck)) return;
    var remainingMs = fadeOutEndMs() - serverNow();
    if (remainingMs > fadeOutMs() + 300 || remainingMs < 900) return;
    var level = chosenVolume(deck);
    deck.dimmed = true;
    // Con cruce, la saliente sigue sonando después del corte del tramo: el
    // fundido dura sus cinco segundos completos y termina con su capítulo.
    ramp(deck, level, 0, Math.min(fadeOutMs(), Math.max(600, remainingMs)));
  }

  // Fuera de un fundido, el reproductor activo suena al volumen elegido. Cubre
  // fundidos interrumpidos: una pausa a mitad de la bajada no deja el volumen
  // en cero para cuando la persona vuelva a darle a reproducir.
  function settleVolume() {
    if (isSweeper()) return;
    if (!volumeControl) return;
    var deck = activeDeck();
    if (!deck.dimmed) {
      if (deck.ramp || stateOf(deck) !== PLAYING || mutedOf(deck)) return;
      // El reproductor puede perder el nivel (recarga, relevo): se reimpone el
      // volumen elegido sin tocar el silencio ni la pausa.
      var level = chosenVolume();
      var reported = volumeOf(deck);
      if (reported === null || Math.abs(reported - level) > 1) setLevel(deck, level);
      return;
    }
    if (deck.ramp || inFadeOut(deck)) return;
    if (deck.fadeInLevel !== null && Date.now() - deck.fadeInSince < 4000) return;
    deck.fadeInLevel = null;
    deck.dimmed = false;
    setLevel(deck, chosenVolume());
  }

  // --- Relevo entre reproductores -------------------------------------------------

  // Carga la cancion siguiente en el reproductor en espera: arranca en
  // silencio, se detiene en cuanto tiene datos y vuelve al inicio del tramo.
  // Android no deja arrancar con la pantalla apagada un reproductor que lleva más de unos
  // minutos en pausa (4 min 22 s falló, 1 min 56 s no), ni recargarlo si solo sonó en silencio.
  // Mientras espera, una preparación temprana se mueve un segundo cada minuto, en silencio.
  function warmStandby(deck) {
    if (!deck.earlyPrepare || appleTouchDevice) return;
    var now = Date.now();
    if (deck.preparing) {
      if (deck.warmAt && now - deck.warmAt > 8000) {
        trace('warm_fail', { s: YT_STATE_NAMES[String(stateOf(deck))] || stateOf(deck) });
        deck.preparing = false;
        deck.prepared = true;
        deck.warmAt = 0;
      }
      return;
    }
    if (!deck.prepared || now - deck.pausedAt < WARM_EVERY_MS) return;
    if (Date.parse(snapshot.endsAt) - serverNow() < WARM_STOP_MS) return;
    trace('warm', { pausedMs: now - deck.pausedAt });
    deck.warmAt = now;
    deck.prepared = false;
    deck.preparing = true;
    try {
      deck.player.mute();
      deck.player.playVideo();
    } catch (_) {
      deck.preparing = false;
      deck.prepared = true;
    }
  }

  function maybePrepare() {
    if (!listening || !snapshot || !snapshot.upcoming || !snapshot.upcoming.length) return;
    var deck = standbyDeck();
    if (!deck.ready) return;
    var next = snapshot.upcoming[0];
    var key = nextPieceKey();
    var leadReached = Date.parse(snapshot.endsAt) - serverNow() <= PREPARE_LEAD_MS;
    if (deck.key === key) { warmStandby(deck); return; }
    if (deck.tailPlaying) return;
    // El activo ya suena esa pieza (entró antes de su hora, con la pantalla apagada).
    if (activeDeck().key === key) return;
    // Android no deja arrancar con la página oculta un reproductor que nunca sonó: la
    // primera preparación se hace mientras se ve, sin esperar al final de la canción.
    var firstWhileVisible = !deck.everPlayed && !document.hidden && stateOf(activeDeck()) === PLAYING;
    if (!firstWhileVisible && !leadReached) return;
    deck.earlyPrepare = !leadReached;
    deck.key = key;
    deck.videoId = next.videoId;
    deck.startSeconds = next.startSeconds;
    deck.prepared = false;
    deck.preparing = false;
    deck.tailPlaying = false;
    if (videoRejected(next.videoId)) return;
    try {
      deck.player.mute();
      deck.preparing = true;
      deck.player.loadVideoById(segment(next, next.startSeconds));
    } catch (_) {
      deck.preparing = false;
    }
  }

  // YouTube puede arrancar en silencio por su cuenta y avisarlo tarde, cuando la
  // entrada ya pasó. Si el gesto sigue vigente se le quita; si no, se pide un toque.
  var autoMutedTicks = 0;
  var autoUnmuteTried = false;
  function watchAutoMute() {
    var deck = activeDeck();
    if (!started || !listening || userPaused || userMuted || soundPending || isSweeper()
      || stateOf(deck) !== PLAYING || !mutedOf(deck)) { autoMutedTicks = 0; return; }
    autoMutedTicks += 1;
    if (autoMutedTicks < 2) return;
    autoMutedTicks = 0;
    var activation = navigator.userActivation;
    if (!autoUnmuteTried && activation && activation.isActive) {
      autoUnmuteTried = true;
      trace('auto_unmute');
      try { deck.player.unMute(); } catch (_) { /* queda el aviso del siguiente repaso */ }
      return;
    }
    trace('sound_pending');
    soundPending = true;
    armSoundUnlock();
    refreshLabels();
    refreshStatus();
  }

  // Queda en pausa al inicio del tramo, a volumen cero y ya sin silenciar: con la
  // pantalla apagada basta con darle play para que suene.
  function finishPrepare(deck, key) {
    if (deck === activeDeck() || !deck.preparing || deck.key !== key) return;
    deck.preparing = false;
    try {
      deck.player.pauseVideo();
      deck.player.seekTo(deck.startSeconds, true);
      if (!soundPending && !userMuted) {
        setLevel(deck, 0);
        deck.player.unMute();
      }
      deck.prepared = true;
      deck.pausedAt = Date.now();
      deck.warmAt = 0;
    } catch (_) {
      deck.prepared = false;
    }
  }

  // Con la pantalla apagada manda lo que le queda a la saliente, no el reloj: si la
  // cuña no sonó, también entra antes del corte, porque un hueco deja sin red.
  function crossInBackground() {
    if (!document.hidden || !ready || !listening || userPaused || !snapshot || isSweeper()) return;
    var from = activeDeck();
    var to = standbyDeck();
    if (!to.ready || !to.prepared || to.key !== nextPieceKey() || from.key !== currentKey()) return;
    if (stateOf(from) !== PLAYING || backgroundSweeperPlaying()) return;
    var at;
    try { at = Number(from.player.getCurrentTime()) || 0; } catch (_) { return; }
    var end = (Number(snapshot.current.startSeconds) || 0) + (Number(snapshot.current.durationSeconds) || 0);
    if (end - at > BACKGROUND_OVERLAP_S) return;
    swapDecks(true);
  }

  // `early`: la entrante arranca antes de su hora, desde el inicio de su tramo.
  function swapDecks(early) {
    var from = activeDeck();
    var to = standbyDeck();
    var pausedMs = to.pausedAt ? Date.now() - to.pausedAt : null;
    trace('swap', { from: activeIndex, early: early ? 1 : 0, pausedMs: pausedMs, prepared: to.prepared ? 1 : 0 });
    // El relevo hereda la eleccion del visitante: silencio y volumen.
    var wantSound = !soundPending && !mutedOf(from);
    var level = chosenVolume(from);
    // En un cruce de música la saliente conserva su último tramo: sigue
    // sonando (con el fundido de salida ya en marcha) bajo la entrada.
    var crossMs = early ? 1 : outgoingCrossfadeMs();
    activeIndex = 1 - activeIndex;
    if (wantSound) swapGraceUntil = Date.now() + 2000;
    to.preparing = false;
    markDecks();
    if (wantSound) {
      // El volumen baja a cero antes de quitar el silencio: nada se oye de
      // golpe y el fundido de entrada arranca cuando el video ya suena.
      if (volumeControl) prepareFadeIn(to, level);
      else setLevel(to, level);
      to.player.unMute();
    } else {
      to.player.mute();
      setLevel(to, level);
    }
    if (!early) {
      // Ya está en su punto si el relevo llegó a tiempo: buscar otra vez solo lo frena.
      var live = liveSecond(), at = NaN;
      try { at = Number(to.player.getCurrentTime()); } catch (_) { /* se busca abajo */ }
      if (!(Math.abs(at - live) < 2)) to.player.seekTo(live, true);
    }
    to.player.playVideo();
    if (!crossMs) {
      cancelRamp(from);
      try {
        from.player.mute();
        from.player.pauseVideo();
      } catch (_) { /* el reproductor saliente ya no importa */ }
    } else {
      // Se apaga solo al terminar su capítulo; mientras tanto no se detiene
      // ni se le retira el fundido.
      from.tailPlaying = true;
    }
    from.key = null;
    from.prepared = false;
    from.preparing = false;
    from.dimmed = false;
    from.fadeInLevel = null;
    // Oculta hay que reaccionar mientras suena la saliente: sin sonido se corta la red.
    window.setTimeout(function () { confirmSwap(to, wantSound, pausedMs); }, document.hidden ? 1200 : 2500);
  }

  // Si el navegador no deja sonar al reproductor entrante sin un gesto, la
  // emision sigue en silencio y el primer clic, toque o tecla la devuelve.
  function confirmSwap(deck, wantSound, pausedMs) {
    if (activeDeck() !== deck || !listening || currentRejected()) return;
    var state = stateOf(deck);
    // Sale mientras la saliente aún suena y hay red: se mide cada relevo, también el que falla.
    if (document.hidden && relayReports < RELAY_REPORTS_MAX) {
      relayReports += 1;
      diagnose('hidden_relay', { relayState: YT_STATE_NAMES[String(state)] || state, pausedMs: pausedMs });
    }
    if (state === PLAYING || state === BUFFERING) return;
    try {
      if (document.hidden) {
        trace('swap_reload', { s: YT_STATE_NAMES[String(state)] || state });
        if (deck.key === nextPieceKey()) deck.player.loadVideoById(segment(snapshot.upcoming[0], deck.startSeconds));
        else loadCurrent(deck, liveSecond());
        return;
      }
      // Sin nadie delante, mutearla solo la callaría: se pide que siga sonando.
      if (wantSound && !document.hidden) {
        soundPending = true;
        deck.player.mute();
        armSoundUnlock();
      }
      deck.player.playVideo();
    } catch (_) {
      soundPending = false;
    }
    refreshLabels();
    refreshStatus();
    heartbeatLive();
  }

  // Cancion rechazada por YouTube en este navegador: no suena nada hasta el
  // relevo siguiente, que mantiene la emision al dia con el resto.
  function holdSilent() {
    trace('hold_silent', { v: snapshot && snapshot.current ? snapshot.current.videoId : null });
    quietUntil = Date.now() + 2000;
    try { activeDeck().player.pauseVideo(); } catch (_) { /* nada que detener */ }
    heartbeat(false);
  }

  // El tramo nunca pasa de su final aunque el reproductor ignore el corte.
  function guardSegmentEnd() {
    if (isSweeper()) return;
    if (!snapshot || playerState() !== PLAYING) return;
    var deck = activeDeck();
    if (deck.key !== currentKey()) return;
    var actual;
    try { actual = Number(deck.player.getCurrentTime()) || 0; } catch (_) { return; }
    if (actual < snapshot.current.startSeconds + snapshot.current.durationSeconds + 0.75) return;
    quietUntil = Date.now() + 2000;
    try { deck.player.pauseVideo(); } catch (_) { /* nada que detener */ }
  }

  function reportUnavailable(videoId) {
    if (!videoId || reported[videoId]) return;
    reported[videoId] = true;
    request('POST', unavailableUrl, { videoId: videoId }, function (data) {
      // Confirmado por el servidor: la emision ya no lo incluye y la nueva
      // programacion entra al momento.
      if (data && data.excluded) {
        blocked[videoId] = true;
        delete restricted[videoId];
        refresh(function (ok) { if (ok && started) correctDrift(false); });
        return;
      }
      // Si el servidor aun encuentra el video, el problema pertenece a esta
      // sesion del navegador (por ejemplo, el control anti-bot de YouTube).
      // Se conserva como recuperable y nunca se anuncia como video retirado.
      delete blocked[videoId];
      refreshLabels();
      refreshStatus();
    });
  }

  // --- Sincronizacion -------------------------------------------------------------

  function refresh(after) {
    if (!started && !bootFailed) setStatus(t('radio.loading'), 'loading');
    else refreshStatus();
    var sentAt = Date.now();
    request('GET', apiUrl, null, function (data) {
      if (!applySnapshot(data, false, Date.now() - sentAt)) {
        setStatus(t('radio.error'), 'error');
        if (after) after(false);
        return;
      }
      refreshStatus();
      if (after) after(true);
    });
  }

  var reloadPaused = false;
  function correctDrift(forcePlay, allowUnmute) {
    // Una entrada forzada (boton de la tarjeta, vuelta al vivo) reanuda la
    // emision y retira la pausa del visitante.
    if (forcePlay && userPaused) userPaused = false;
    if (isSweeper()) {
      if (forcePlay) { started = true; listening = true; if (allowUnmute) soundPending = false; }
      syncSweeper(forcePlay); refreshLabels(); refreshStatus(); heartbeatLive(); return;
    }
    if (!ready || !snapshot || correcting) return;
    if (!forcePlay && playerState() !== PLAYING) return;
    if (forcePlay) { started = true; listening = true; }
    if (currentRejected()) { refreshLabels(); refreshStatus(); return; }
    var deck = activeDeck();
    // El reproductor ya suena la cancion siguiente (relevo en segundo plano):
    // el repaso no lo devuelve a los ultimos segundos de la anterior.
    if (!forcePlay && deck.key && deck.key === nextPieceKey()) return;
    correcting = true;
    try {
      var target = liveSecond();
      // Solo un gesto del visitante (el boton) devuelve el sonido. La
      // continuidad entre piezas no toca el silencio que la persona eligio.
      if (allowUnmute && !soundPending && !userMuted) deck.player.unMute();
      if (forcePlay) settleVolume();
      if (deck.key !== currentKey()) {
        loadCurrent(deck, target);
      } else {
        var deckState = stateOf(deck);
        if (forcePlay && deckState !== PLAYING && (deckState !== PAUSED || reloadPaused)) {
          // Colgado o sin cargar: seek+play no lo despierta, hay que recargar.
          clearStuck();
          loadCurrent(deck, target);
        } else {
          var actual = Number(deck.player.getCurrentTime()) || 0;
          // Con la pantalla apagada puede ir unos segundos adelantada: se corrige al volver.
          if (forcePlay || (!document.hidden && Math.abs(actual - target) > 4)) deck.player.seekTo(target, true);
          if (forcePlay) deck.player.playVideo();
        }
      }
      started = true;
      if (soundPending && !playerMuted()) soundPending = false;
      refreshLabels();
      refreshStatus();
      heartbeatLive();
    } catch (_) {
      setStatus(t('radio.error'), 'error');
    }
    correcting = false;
    syncSweeper(false);
  }

  function heartbeat(active) {
    request('POST', listenerUrl, { sessionId: sessionId, active: active }, function (data) {
      if (data && typeof data.listeners === 'number') listenerCopy(data.listeners);
    });
  }

  // Presencia compartida: la emision solo suma a quien la escucha de verdad;
  // con el sonido bloqueado o en pausa no hay persona escuchando que contar.
  function heartbeatLive() {
    if (!started) return;
    heartbeat(audible());
  }

  function ensureHeartbeat() {
    if (heartbeatTimer) return;
    heartbeatTimer = window.setInterval(function () {
      heartbeatLive();
    }, 30000);
  }

  // --- Entrada automatica ----------------------------------------------------

  function enterLive() {
    if (attemptTimer) { window.clearTimeout(attemptTimer); attemptTimer = null; }
    if (userPaused) return;
    // Entrada con la emision ya en marcha. Si llego muda —arranque en silencio
    // del propio reproductor o respaldo silencioso—, todavia no hay escucha:
    // el punto no late, el recuento espera y el primer gesto devuelve el audio.
    // Con el silencio elegido por la persona no se arma ese gesto.
    if (!started && playerMuted() && !userMuted) { soundPending = true; armSoundUnlock(); }
    started = true;
    listening = true;
    prepareBackgroundSweeper();
    if (soundPending && !playerMuted()) soundPending = false;
    syncSweeper(false);
    refreshLabels();
    refreshStatus();
    heartbeatLive();
    ensureHeartbeat();
    window.setTimeout(function () { correctDrift(false); }, 2500);
  }

  // Replica el gesto que antes pedia el boton: entra al segundo del vivo con
  // sonido. Si el navegador no lo permite todavia, silentFallback mantiene la
  // emision en marcha y deja el sonido a un clic de distancia.
  function autoJoin() {
    if (isSweeper()) { started = true; listening = true; syncSweeper(false); return; }
    if (!ready || !snapshot || soundPending || userPaused) return;
    if (currentRejected()) { joinPending = !started; refreshLabels(); refreshStatus(); return; }
    var deck = activeDeck();
    if (playerState() === PLAYING && deck.key === currentKey()) { enterLive(); return; }
    setStatus(t('radio.loading'), 'loading');
    try {
      if (deck.key !== currentKey()) {
        loadCurrent(deck);
      } else {
        deck.player.seekTo(liveSecond(), true);
        deck.player.playVideo();
      }
    } catch (_) { return; }
    if (attemptTimer) window.clearTimeout(attemptTimer);
    attemptTimer = window.setTimeout(function () {
      attemptTimer = null;
      var state = playerState();
      if (state === PLAYING) { enterLive(); return; }
      if (state === BUFFERING) return; // esta arrancando; onStateChange confirmara
      silentFallback();
    }, 2000);
  }

  // El navegador exige un gesto para que haya sonido: la emision entra igual,
  // muda, y el primer clic, toque o tecla la devuelve al sonido.
  function silentFallback() {
    if (started || userPaused) return;
    // Con el silencio elegido por la persona no hay nada que desbloquear: la
    // emision entra muda y el aviso es el del altavoz, no el del navegador.
    soundPending = !userMuted;
    try {
      activeDeck().player.mute();
      activeDeck().player.playVideo();
    } catch (_) {
      soundPending = false;
    }
    refreshLabels();
    refreshStatus();
    if (!soundPending) return;
    armSoundUnlock();
    window.setTimeout(function () {
      var state = playerState();
      if (state === PLAYING || state === BUFFERING) return;
      // Tampoco pudo arrancar en silencio: queda el boton manual.
      soundPending = false;
      disarmSoundUnlock();
      refreshLabels();
      refreshStatus();
    }, 1600);
  }

  function enableSound() {
    if (isSweeper()) { soundPending = false; listening = true; started = true; try { activeDeck().player.unMute(); } catch (_) {} syncSweeper(true); refreshLabels(); refreshStatus(); return; }
    if (!soundPending) return;
    soundPending = false;
    disarmSoundUnlock();
    try {
      settleVolume();
      activeDeck().player.unMute();
      activeDeck().player.playVideo();
    } catch (_) {
      setStatus(t('radio.error'), 'error');
      return;
    }
    refreshLabels();
    refreshStatus();
    // Con el audio activado, esta persona entra al recuento compartido.
    heartbeatLive();
  }

  // Un click generado por codigo no es un gesto del visitante: no cuenta para
  // la politica de autoplay (navigator.userActivation sigue en falso) y el
  // intento de volver a sonar sin gesto real hace que el navegador pause el
  // video. Solo los eventos confiables desbloquean el sonido.
  function soundUnlockHandler(event) {
    if (event && event.isTrusted === false) return;
    enableSound();
  }

  function armSoundUnlock() {
    for (var index = 0; index < UNLOCK_EVENTS.length; index += 1) {
      document.addEventListener(UNLOCK_EVENTS[index], soundUnlockHandler, { capture: true, passive: true });
    }
  }

  function disarmSoundUnlock() {
    for (var index = 0; index < UNLOCK_EVENTS.length; index += 1) {
      document.removeEventListener(UNLOCK_EVENTS[index], soundUnlockHandler, { capture: true });
    }
  }

  // --- Ciclo de los reproductores ---------------------------------------------

  function onPlayerReady() {
    decks[0].ready = true;
    ready = true;
    bootFailed = false;
    if (bootTimer) { window.clearTimeout(bootTimer); bootTimer = null; }
    if (syncButton) syncButton.disabled = false;
    markDecks();
    setupMediaSession();
    applyLevel(chosenVolume());
    if (userMuted) { try { activeDeck().player.mute(); } catch (_) { /* sin reproductor */ } }
    paintVolume();
    refreshLabels();
    refresh(function (ok) { if (ok) autoJoin(); });
  }

  function onStandbyReady() {
    decks[1].ready = true;
    markDecks();
  }

  function onDeckState(deck, event) {
    var state = event.data;
    if (state === PLAYING) deck.everPlayed = true;
    trace('yt', { d: deckIndex(deck), s: YT_STATE_NAMES[String(state)] || state, a: deck === activeDeck() ? 1 : 0 });
    if (deck !== activeDeck()) {
      // Una saliente en cruce sigue sonando su último tramo con el fundido ya
      // en marcha: se apaga sola al terminar su capítulo, no se detiene.
      if (deck.tailPlaying) {
        if (state !== PLAYING && state !== BUFFERING) { deck.tailPlaying = false; deck.prepared = false; }
        return;
      }
      // En espera nunca suena: tras la primera imagen se detiene y queda
      // listo en el inicio exacto de la cancion.
      if (state !== PLAYING) return;
      if (deck.preparing) {
        if (!deck.prepareTimer) {
          var preparingKey = deck.key;
          deck.prepareTimer = window.setTimeout(function () {
            deck.prepareTimer = null;
            finishPrepare(deck, preparingKey);
          }, PREPARE_PLAY_MS);
        }
        return;
      }
      try { deck.player.pauseVideo(); } catch (_) { /* ya estaba detenido */ }
      return;
    }
    if (isSweeper()) {
      // La cancion siguiente ya relevada (segundo plano) no se detiene.
      if (state === PLAYING && !document.hidden && deck.key !== nextPieceKey()) {
        quietUntil = Date.now() + 2000; try { deck.player.pauseVideo(); } catch (_) {}
      }
      return;
    }
    if (state === PLAYING) {
      // Una reproduccion correcta confirma que cualquier control local de
      // sesion ya fue superado (por ejemplo, despues de iniciar sesion).
      if (deck.videoId) delete restricted[deck.videoId];
      // El video tambien se reanuda desde su propia superficie (clic en la
      // imagen): si vuelve a sonar, la pausa del visitante ya no existe.
      if (userPaused) userPaused = false;
      if (deck.fadeInLevel !== null) {
        var target = deck.fadeInLevel;
        deck.fadeInLevel = null;
        ramp(deck, 0, target, entryFadeMs());
      }
      enterLive();
    } else if (state === ENDED) {
      // El tramo termino: si ya es la hora, releva; si el reproductor iba unos
      // segundos adelantado, espera en silencio al reloj compartido.
      if (snapshot && serverNow() >= Date.parse(snapshot.endsAt) - 1500) advanceBoundary();
    } else if (state === PAUSED) {
      if (Date.now() < quietUntil) return;
      if (document.hidden && backgroundPlaybackIntent) {
        // Un único reintento inmediato por ocultación. Un setTimeout aquí no
        // es fiable: Android puede congelarlo antes de que llegue a ejecutarse.
        heartbeat(false);
        resumeBackgroundPlayback(deck);
        return;
      }
      listening = false;
      stopSweeper();
      heartbeat(false);
      refreshStatus();
    }
  }

  function onDeckError(deck, event) {
    var code = Number(event && event.data);
    var videoId = deck.videoId;
    notePlayerError(deck, code);
    if (deck !== activeDeck()) {
      deck.preparing = false;
      deck.prepared = false;
      if (UNPLAYABLE[code] && videoId) {
        restricted[videoId] = true;
        reportUnavailable(videoId);
      }
      return;
    }
    heartbeat(false);
    if (UNPLAYABLE[code] && videoId) {
      // Primero es un rechazo local recuperable. El servidor decide si el
      // video realmente dejo de estar disponible para toda la emision.
      restricted[videoId] = true;
      if (!started) joinPending = true;
      if (attemptTimer) { window.clearTimeout(attemptTimer); attemptTimer = null; }
      reportUnavailable(videoId);
      refreshLabels();
      refreshStatus();
      return;
    }
    setStatus(t('radio.error'), 'error');
    // Un fallo transitorio no debe dejar la pieza muerta hasta el siguiente
    // cambio: se reintenta una sola vez por emision, respetando pausa y silencio.
    if (!snapshot || !ready) return;
    var key = currentKey();
    if (lastErrorVideoId === key || errorRetryTimer) return;
    lastErrorVideoId = key;
    errorRetryTimer = window.setTimeout(function () {
      errorRetryTimer = null;
      if (!ready || !snapshot || currentKey() !== key || currentRejected()) return;
      var state = playerState();
      if (state === PLAYING || state === BUFFERING || state === PAUSED) return;
      try { loadCurrent(activeDeck()); } catch (_) { /* queda el boton */ }
    }, 4000);
  }

  function deckEvents(index, onReady) {
    return {
      onReady: onReady,
      onStateChange: function (event) { onDeckState(decks[index], event); },
      onError: function (event) { onDeckError(decks[index], event); }
    };
  }

  function bootPlayer() {
    if (decks[0].player || !window.YT || !window.YT.Player) return;
    decks[0].player = new window.YT.Player('radioPlayer', { events: deckEvents(0, onPlayerReady) });
    // El segundo reproductor nace vacio y oculto; solo carga cuando hace falta
    // preparar la cancion siguiente. En iPhone/iPad se conserva un unico iframe
    // para que todos los relevos hereden la autorizacion del gesto inicial.
    if (appleTouchDevice) return;
    var holder = document.createElement('div');
    holder.id = 'radioStandby';
    frame.parentNode.appendChild(holder);
    try {
      decks[1].player = new window.YT.Player(holder, {
        host: 'https://www.youtube.com',
        width: 560,
        height: 315,
        playerVars: { playsinline: 1, rel: 0, autoplay: 0, controls: 0, fs: 0, disablekb: 1, iv_load_policy: 3, origin: window.location.origin },
        events: deckEvents(1, onStandbyReady)
      });
      markDecks();
    } catch (_) {
      // Sin segundo reproductor la radio funciona igual, con carga al relevo.
      decks[1].player = null;
    }
  }

  // Reintento manual del arranque: si el API aun no esta, se intenta traerlo
  // una vez mas; el clic del visitante no puede quedar en el vacio.
  function retryBoot() {
    if (window.YT && window.YT.Player) { bootPlayer(); return; }
    if (apiRetried) return;
    apiRetried = true;
    loadApiScript();
  }

  function loadApiScript() {
    var tag = document.createElement('script');
    tag.src = 'https://www.youtube.com/iframe_api';
    tag.async = true;
    document.head.appendChild(tag);
  }

  // El reproductor de YouTube pesa varios megabytes y no es necesario para
  // leer la portada. Se conecta solo cuando la persona pide entrar al aire;
  // hasta entonces la tarjeta SSR conserva título, artista y progreso.
  function requestBoot() {
    if (bootRequested) return;
    bootRequested = true;
    var source = frame.getAttribute('data-src');
    if (source) {
      // Altavoz apagado guardado: el iframe nace en silencio para que el
      // autoplay no suene ni un instante.
      if (userMuted) source += '&mute=1';
      frame.setAttribute('src', source);
      frame.removeAttribute('data-src');
    }
    setStatus(t('radio.loading'), 'loading');
    if (syncButton) syncButton.disabled = true;
    if (window.YT && window.YT.Player) bootPlayer();
    else loadApiScript();
    bootTimer = window.setTimeout(function () {
      bootTimer = null;
      if (ready) return;
      bootFailed = true;
      setStatus(t('radio.error'), 'error');
      if (syncButton) syncButton.disabled = false;
    }, 9000);
  }

  var previousReady = window.onYouTubeIframeAPIReady;
  window.onYouTubeIframeAPIReady = function () {
    if (typeof previousReady === 'function') previousReady();
    bootPlayer();
  };

  if (syncButton) syncButton.addEventListener('click', function (event) {
    if (event && event.isTrusted === false) return;
    if (!bootRequested) { requestBoot(); return; }
    if (!ready) { if (bootFailed) retryBoot(); return; }
    // El boton dice «Activar sonido» mientras el altavoz este apagado: el clic
    // es el gesto que lo devuelve, con el volumen recordado.
    if (userMuted) setVolume(lastAudibleVolume || 100);
    if (soundPending) { enableSound(); return; }
    if (currentRestricted()) {
      delete restricted[snapshot.current.videoId];
      refreshLabels();
      refreshStatus();
    }
    refresh(function (ok) { if (ok || snapshot) correctDrift(true, true); });
  });
  if (root.getAttribute('data-radio-requested') === 'true') requestBoot();

  // El volumen solo se ofrece en escritorio; en Apple touch el reproductor
  // ignora setVolume y quedan los botones del sistema.
  if (volumeUI && volumeControl && window.matchMedia
    && window.matchMedia('(min-width: 721px)').matches) {
    volumeUI.removeAttribute('hidden');
  }
  if (rangeEl) rangeEl.addEventListener('input', function () { setVolume(rangeEl.value); });
  if (muteButton) muteButton.addEventListener('click', function (event) {
    if (event && event.isTrusted === false) return;
    toggleMute();
  });
  paintVolume();

  document.addEventListener('visibilitychange', function () {
    if (document.hidden) {
      backgroundPlaybackIntent = Boolean(started && listening);
      backgroundResumeAttempted = false;
      if (backgroundPlaybackIntent && ready && playerState() === PAUSED) {
        resumeBackgroundPlayback(activeDeck());
      }
      return;
    }
    var resume = backgroundPlaybackIntent && !userPaused;
    backgroundPlaybackIntent = false;
    backgroundResumeAttempted = false;
    // Si YouTube siguio sonando en segundo plano, no hacemos seek ni play al
    // volver: reiniciar un reproductor sano produce un corte audible. Solo se
    // fuerza la reproduccion cuando el navegador realmente la interrumpio.
    var state = playerState();
    var interrupted = state !== PLAYING && (state !== BUFFERING || playerStuck(STUCK_NOTICE_MS));
    // Un reproductor que el sistema dejó en pausa no se despierta con seek+play, y la pausa
    // que eso provoca no es del visitante: se recarga y no se toma por una pausa suya.
    if (resume && started && interrupted) {
      quietUntil = Date.now() + 3000;
      reloadPaused = true;
      correctDrift(true, false);
      reloadPaused = false;
    }
    refresh(function (ok) {
      if (!ok || !started) return;
      var refreshedState = playerState();
      var stillInterrupted = refreshedState !== PLAYING && (refreshedState !== BUFFERING || playerStuck(STUCK_NOTICE_MS));
      correctDrift(Boolean(resume && stillInterrupted), false);
    });
  });
  window.setInterval(crossInBackground, 500);
  window.setInterval(function () {
    updateProgress();
    if (!document.hidden) refresh(function (ok) { if (ok && started) correctDrift(false); });
  }, 30000);
  // Repaso suave por segundo: el nivel elegido se reimpone, se prepara la
  // cancion siguiente y se cubren los relevos con el temporizador retrasado
  // por el navegador. La pausa y el altavoz son de la tarjeta, no del
  // reproductor, asi que aqui no hay ningun control externo que interpretar.
  window.setInterval(function () {
    try { watchSound(); flushDiagnostics(); } catch (_) { /* el diagnóstico nunca frena la radio */ }
    updateProgress();
    // La cuña es audio propio y no depende del reproductor de YouTube: entra
    // y sale igual aunque el visitante todavía no haya sintonizado.
    if (hasSweeperAudio()) {
      if (!isSweeper() && playerMuted()) stopSweeper();
      else syncSweeper(false);
    } else if (sweeperSource) stopSweeper();
    showSweeper();
    if (!ready) return;
    if (snapshot && serverNow() >= Date.parse(snapshot.endsAt) + 1000) advanceBoundary();
    if (backgroundMode() && backgroundRelayDue()) relayNextInBackground();
    watchStuckPlayer();
    watchAutoMute();
    maybePrepare();
    guardSegmentEnd();
    startFadeOut();
    settleVolume();
    var state = root.getAttribute('data-radio-state');
    if (state === 'loading') return;
    refreshLabels();
    // En error manda el aviso del fallo; la etiqueta del boton si se refresca.
    if (state !== 'error') refreshStatus();
  }, 1000);
}());
