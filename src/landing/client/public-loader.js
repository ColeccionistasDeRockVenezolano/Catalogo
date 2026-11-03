// Hidratación progresiva de la portada. El SSR pinta primero y es íntegro; los
// clientes llegan después del primer frame y la radio se sintoniza sola con el
// primer gesto de la persona, sin competir con el LCP.
(function () {
  'use strict';

  var tag = document.currentScript;
  if (!tag) return;

  function load(source, done) {
    if (!source) return;
    var script = document.createElement('script');
    script.src = source;
    script.async = true;
    if (done) script.addEventListener('load', done, { once: true });
    document.head.appendChild(script);
  }

  function loadStyle(source) {
    if (!source || document.querySelector('link[data-public-full-style]')) return;
    var link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = source;
    link.dataset.publicFullStyle = 'true';
    document.head.appendChild(link);
  }

  function whenIdle(task) {
    if ('requestIdleCallback' in window) window.requestIdleCallback(task, { timeout: 1500 });
    else window.setTimeout(task, 1);
  }

  function afterLoad(task) {
    if (document.readyState === 'complete') whenIdle(task);
    else window.addEventListener('load', function () { whenIdle(task); }, { once: true });
  }

  // radio.js lee window.HerraI18n al arrancar: debe esperar al cliente de idioma
  // o mostraría las claves en crudo.
  var i18nWaiting = [];
  function whenI18n(task) {
    if (window.HerraI18n || !tag.dataset.i18nClient) task();
    else i18nWaiting.push(task);
  }
  function i18nReady() {
    var tasks = i18nWaiting;
    i18nWaiting = [];
    tasks.forEach(function (task) { task(); });
  }

  // Iconos, menú, idioma y contador: pequeños y justo después del primer frame.
  window.requestAnimationFrame(function () {
    window.requestAnimationFrame(function () {
      load(tag.dataset.i18nClient, i18nReady);
      load(tag.dataset.lucideClient, function () { load(tag.dataset.iconsClient); });
      load(tag.dataset.navClient);
      load(tag.dataset.visitsClient);
    });
  });

  var radio = document.getElementById('radio');
  var radioButton = radio && radio.querySelector('[data-radio-sync]');
  var cinemaButton = radio && radio.querySelector('[data-radio-cinema]');
  var cinemaBackdrop = document.querySelector('[data-radio-cinema-backdrop]');
  var cinemaActive = false;

  // La cuña suena por Web Audio: el contexto debe crearse o reanudarse dentro
  // de un gesto real de la persona.
  function unlockRadioAudio(event) {
    if (!radio || radio.getAttribute('data-radio-sweeper') !== 'true' || (event && event.isTrusted === false)) return;
    var AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;
    try {
      var context = window.HerraRadioAudioContext || (window.HerraRadioAudioContext = new AudioContextClass());
      if (context.state !== 'running') context.resume().catch(function () {});
    } catch (error) { /* Un fallo aquí no debe impedir que arranque la radio. */ }
  }
  document.addEventListener('pointerdown', unlockRadioAudio, { passive: true });
  document.addEventListener('touchstart', unlockRadioAudio, { passive: true });
  document.addEventListener('keydown', unlockRadioAudio, { passive: true });

  // La tarjeta no se mueve ni se vuelve a crear: el iframe conserva su estado
  // y el modo cine es solo una capa de presentacion alrededor de la radio.
  function setCinema(active) {
    if (!radio || !cinemaButton || cinemaActive === active) return;
    cinemaActive = active;
    radio.classList.toggle('is-cinema', active);
    document.body.classList.toggle('radio-cinema-open', active);
    cinemaButton.setAttribute('aria-pressed', active ? 'true' : 'false');
    var label = cinemaButton.getAttribute(active ? 'data-exit-label' : 'data-enter-label');
    if (label) {
      cinemaButton.setAttribute('aria-label', label);
      cinemaButton.setAttribute('title', label);
    }
    if (cinemaBackdrop) cinemaBackdrop.hidden = !active;
    var enterIcon = cinemaButton.querySelector('[data-radio-cinema-enter-icon]');
    var exitIcon = cinemaButton.querySelector('[data-radio-cinema-exit-icon]');
    // Lucide sustituye los <i> por SVG, y SVGElement no refleja la propiedad
    // `hidden`: usamos el atributo para que funcione antes y despues del cambio.
    if (enterIcon) {
      if (active) enterIcon.setAttribute('hidden', '');
      else enterIcon.removeAttribute('hidden');
    }
    if (exitIcon) {
      if (active) exitIcon.removeAttribute('hidden');
      else exitIcon.setAttribute('hidden', '');
    }
    if (active) {
      radio.setAttribute('role', 'dialog');
      radio.setAttribute('aria-modal', 'true');
    } else {
      radio.removeAttribute('role');
      radio.removeAttribute('aria-modal');
    }
  }

  function cinemaFocusable() {
    if (!radio) return [];
    return Array.prototype.slice.call(radio.querySelectorAll('a[href], button:not([disabled]), iframe, [tabindex]:not([tabindex="-1"])'))
      .filter(function (element) { return !element.hidden; });
  }

  function onCinemaKeydown(event) {
    if (!cinemaActive) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      setCinema(false);
      cinemaButton.focus();
      return;
    }
    if (event.key !== 'Tab') return;
    var focusable = cinemaFocusable();
    if (!focusable.length) return;
    var first = focusable[0];
    var last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  if (cinemaButton) cinemaButton.addEventListener('click', function () { setCinema(!cinemaActive); });
  if (cinemaBackdrop) cinemaBackdrop.addEventListener('click', function () {
    setCinema(false);
    if (cinemaButton) cinemaButton.focus();
  });
  document.addEventListener('keydown', onCinemaKeydown);

  var radioStarted = false;
  function startRadio() {
    if (radioStarted || !radio || !tag.dataset.radioClient) return;
    radioStarted = true;
    if (radioButton) {
      radioButton.removeEventListener('click', onRadioClick);
      radioButton.disabled = true;
    }
    radio.setAttribute('data-radio-requested', 'true');
    radio.setAttribute('data-radio-state', 'loading');
    whenI18n(function () {
      var status = radio.querySelector('[data-radio-status]');
      if (status && window.HerraI18n) status.textContent = window.HerraI18n.t('radio.loading');
      load(tag.dataset.radioClient);
    });
  }
  function onRadioClick(event) {
    if (event && event.isTrusted === false) return;
    unlockRadioAudio(event);
    startRadio();
  }
  if (radioButton) radioButton.addEventListener('click', onRadioClick);

  // La radio arranca al terminar la carga. En iPhone y iPad espera al primer
  // gesto de la persona (tocar, desplazarse o teclear), porque sin gesto el
  // navegador no deja sonar.
  var waitForGesture = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  var radioGestures = ['pointerdown', 'touchstart', 'keydown', 'wheel', 'scroll', 'mousemove'];
  function onFirstGesture() {
    radioGestures.forEach(function (eventName) {
      window.removeEventListener(eventName, onFirstGesture, { passive: true });
    });
    startRadio();
  }
  if (radio && waitForGesture) {
    radioGestures.forEach(function (eventName) {
      window.addEventListener(eventName, onFirstGesture, { passive: true });
    });
  } else if (radio) {
    afterLoad(startRadio);
  }

  // Con la carga terminada, la hoja completa llega sin bloquear el pintado.
  afterLoad(function () {
    loadStyle(tag.dataset.fullStyle);
  });

  // Sin contador público, la portada avisa igualmente de que la abrió un
  // navegador que ejecuta JavaScript: es lo que separa en las métricas a las
  // personas de los rastreadores. Un único aviso, en reposo y tras el load.
  if (tag.dataset.presenceUrl && window.fetch) {
    afterLoad(function () {
      var token = document.querySelector('meta[name="csrf-token"]');
      window.fetch(tag.dataset.presenceUrl, {
        method: 'POST',
        keepalive: true,
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': token ? token.content : '' },
        body: JSON.stringify({ webdriver: navigator.webdriver === true }),
      }).catch(function () { /* Métrica, no función: un fallo no molesta a nadie. */ });
    });
  }

  var roadmap = document.getElementById('roadmap');
  var roadmapSource = tag.dataset.roadmapClient;
  if (!roadmap || !roadmapSource) return;
  var roadmapList = roadmap.querySelector('[data-roadmap-category-list]');
  var roadmapLoaded = false;
  function loadRoadmap() {
    if (roadmapLoaded) return;
    roadmapLoaded = true;
    loadStyle(tag.dataset.fullStyle);
    if (roadmapList) roadmapList.classList.remove('roadmap-category-list--deferred');
    load(roadmapSource);
  }
  // El documento SSR ya permite leer todo el roadmap. Su cliente solo hace
  // falta cuando la persona empieza a interactuar o desplazarse.
  ['wheel', 'scroll', 'pointerdown', 'touchstart', 'keydown'].forEach(function (eventName) {
    window.addEventListener(eventName, loadRoadmap, { once: true, passive: true });
  });
})();
